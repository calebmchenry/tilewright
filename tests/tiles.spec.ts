import { expect, test, type Page } from "@playwright/test";
import type { TileProbe } from "./tiles-harness";

declare global {
  interface Window {
    tileProbe: TileProbe;
  }
}
async function ready(page: Page) {
  await page.goto("/tests/tiles.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
}
const red = [255, 0, 0, 255],
  blue = [0, 0, 255, 255],
  white = [255, 255, 255, 255];

test("WebGL pixels match opaque/empty/alpha/reference layers and boundary cells at DPR 1 and 2", async ({
  browser,
}) => {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ deviceScaleFactor });
    const page = await context.newPage();
    await ready(page);
    expect(
      await page.evaluate(() =>
        window.tileProbe.sample([
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
          [4, 0],
          [5, 0],
          [6, 0],
          [7, 0],
          [8, 0],
        ]),
      ),
    ).toEqual([
      blue,
      red,
      [0, 0, 0, 255],
      [0, 255, 0, 255],
      [127, 0, 128, 255],
      white,
      red,
      [255, 0, 255, 255],
      [29, 39, 50, 255],
    ]);
    for (const [x, y, points] of [
      [
        30,
        30,
        [
          [31, 31],
          [32, 31],
        ],
      ],
      [
        62,
        62,
        [
          [63, 63],
          [64, 63],
          [63, 64],
          [64, 64],
        ],
      ],
      [
        -65,
        -65,
        [
          [-65, -65],
          [-64, -64],
        ],
      ],
      [-2, -2, [[-1, -1]]],
      [99, 68, [[100, 69]]],
    ] as [number, number, [number, number][]][]) {
      expect(
        await page.evaluate(
          ({ x, y, points }) => {
            window.tileProbe.view(x, y, 0.5);
            return window.tileProbe.sample(points);
          },
          { x, y, points },
        ),
      ).toEqual(points.map(() => white));
    }
    await context.close();
  }
});

test("edits refresh only affected chunks, reorder reuses textures, visibility and registry update composition", async ({
  page,
}) => {
  await ready(page);
  const initial = await page.evaluate(() => window.tileProbe.stats());
  const edited = await page.evaluate(() => {
    window.tileProbe.resetQueries();
    window.tileProbe.edit("upper", 0, 0, null);
    return {
      stats: window.tileProbe.stats(),
      queries: window.tileProbe.queries(),
      pixels: window.tileProbe.sample([[0, 0]]),
    };
  });
  expect(edited.stats.uploads - initial.uploads).toBe(1);
  expect(edited.queries).toHaveLength(1);
  expect(edited.queries[0].layer).toBe("upper");
  expect(edited.pixels).toEqual([red]);
  const offscreen = await page.evaluate(() => {
    const before = window.tileProbe.stats();
    window.tileProbe.edit("upper", 99, 69, "#abcdefFF");
    return { before, after: window.tileProbe.stats() };
  });
  expect(offscreen.after).toEqual(offscreen.before);
  const order = await page.evaluate(() => {
    const before = window.tileProbe.stats();
    window.tileProbe.reorder(["upper", "terrain"]);
    return {
      before,
      after: window.tileProbe.stats(),
      pixels: window.tileProbe.sample([[3, 0]]),
    };
  });
  expect(order.after.uploads).toBe(order.before.uploads);
  expect(order.after.created).toBe(order.before.created);
  expect(order.pixels).toEqual([red]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.hide("terrain", true);
      return window.tileProbe.sample([
        [3, 0],
        [1, 0],
      ]);
    }),
  ).toEqual([
    [0, 255, 0, 255],
    [29, 39, 50, 255],
  ]);
  const recolor = await page.evaluate(() => {
    const before = window.tileProbe.stats();
    window.tileProbe.registry("grass", "#123456ff");
    return {
      before,
      after: window.tileProbe.stats(),
      pixels: window.tileProbe.sample([[3, 0]]),
    };
  });
  expect(recolor.after.uploads - recolor.before.uploads).toBe(1);
  expect(recolor.pixels).toEqual([[18, 52, 86, 255]]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.registry("grass", null);
      return window.tileProbe.sample([[3, 0]]);
    }),
  ).toEqual([[255, 0, 255, 255]]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.view(98, 68);
      return window.tileProbe.sample([[99, 69]]);
    }),
  ).toEqual([[171, 205, 239, 255]]);
  const disposed = await page.evaluate(async () => {
    await window.tileProbe.load("empty");
    return {
      old: window.tileProbe.disposed(),
      current: window.tileProbe.stats(),
    };
  });
  expect(disposed.old?.textures).toBe(0);
  expect(disposed.old?.chunks).toBe(0);
  expect(disposed.old?.created).toBe(disposed.old?.released);
  expect(disposed.current.textures).toBe(0);
  await page.evaluate(() => {
    window.tileProbe.dispose();
    window.tileProbe.dispose();
  });
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("cross-chunk undo, shared recoloring, hidden edits, growth and resizing preserve pixels and release obsolete data", async ({
  page,
}) => {
  await ready(page);
  const spanning = await page.evaluate(() => {
    window.tileProbe.view(30, 30);
    const before = window.tileProbe.stats();
    window.tileProbe.edit("upper", 31, 31, "#0000ffff", 2);
    return {
      before,
      after: window.tileProbe.stats(),
      pixels: window.tileProbe.sample([
        [31, 31],
        [32, 31],
      ]),
    };
  });
  expect(spanning.after.uploads - spanning.before.uploads).toBe(2);
  expect(spanning.pixels).toEqual([blue, blue]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.session.perform("undo");
      return window.tileProbe.sample([
        [31, 31],
        [32, 31],
      ]);
    }),
  ).toEqual([white, white]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.session.perform("redo");
      return window.tileProbe.sample([
        [31, 31],
        [32, 31],
      ]);
    }),
  ).toEqual([blue, blue]);
  const recolored = await page.evaluate(() => {
    window.tileProbe.reference("terrain", 31, 32, "grass");
    window.tileProbe.reference("upper", 32, 32, "grass");
    const before = window.tileProbe.stats();
    window.tileProbe.registry("grass", "#123456ff");
    return {
      before,
      after: window.tileProbe.stats(),
      pixels: window.tileProbe.sample([
        [31, 32],
        [32, 32],
      ]),
    };
  });
  // The original grass at (3,0) also belongs to a viewport-intersecting chunk.
  expect(recolored.after.uploads - recolored.before.uploads).toBe(3);
  expect(recolored.pixels).toEqual([
    [18, 52, 86, 255],
    [18, 52, 86, 255],
  ]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.hide("upper", true);
      window.tileProbe.edit("upper", 31, 31, "#ff0000ff");
      window.tileProbe.registry("grass", "#00ff00ff");
      window.tileProbe.hide("upper", false);
      return window.tileProbe.sample([
        [31, 31],
        [32, 32],
      ]);
    }),
  ).toEqual([red, [0, 255, 0, 255]]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.remove("upper");
      return window.tileProbe.sample([[31, 31]]);
    }),
  ).toEqual([white]);
  expect(
    await page.evaluate(() => {
      window.tileProbe.session.perform("undo");
      return window.tileProbe.sample([[31, 31]]);
    }),
  ).toEqual([red]);
  const sizing = await page.evaluate(() => {
    window.tileProbe.resize(1600, 1200);
    const big = window.tileProbe.stats();
    window.tileProbe.resize(48, 48);
    const small = window.tileProbe.stats();
    return { big, small };
  });
  expect(sizing.small.chunks).toBeLessThan(sizing.big.chunks);
  expect(sizing.small.released).toBeGreaterThan(sizing.big.released);
  expect(
    await page.evaluate(() => {
      window.tileProbe.resize(800, 600);
      window.tileProbe.view(99, 68);
      window.tileProbe.grow();
      window.tileProbe.edit("terrain", 102, 70, "#ffffffff");
      return window.tileProbe.sample([
        [100, 69],
        [102, 70],
      ]);
    }),
  ).toEqual([white, white]);
  await page.evaluate(() => window.tileProbe.dispose());
  const disposed = await page.evaluate(() => window.tileProbe.stats());
  expect(disposed.created).toBe(disposed.released);
  expect(disposed.textureBytes).toBe(0);
});
