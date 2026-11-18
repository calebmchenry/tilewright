import { expect, test, type Page } from "@playwright/test";
import type { TileProbe } from "./tiles-harness";

declare global {
  interface Window {
    tileProbe: TileProbe;
  }
}
async function settled(page: Page) {
  await expect
    .poll(() => page.evaluate(() => window.tileProbe.stats().overview.pending))
    .toBe(0);
  await expect(page.locator("canvas")).toHaveAttribute("aria-busy", "false");
}
const red = [255, 0, 0, 255],
  purple = [127, 0, 128, 255];
for (const density of [1, 2]) {
  test(`overview preserves region seams, composition, edges and detail switching at DPR ${density}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ deviceScaleFactor: density });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.tileProbe.load("overview"));
    for (const zoom of [3 / 24, 1.5 / 24, 0.75 / 24, 1 / 24, 3 / 24]) {
      await page.evaluate((zoom) => window.tileProbe.view(220, 10, zoom), zoom);
      await settled(page);
      expect(
        await page.evaluate(() =>
          window.tileProbe.sample([
            [253, 30],
            [259, 30],
            [280, 30],
            [253, 50],
          ]),
        ),
      ).toEqual([purple, purple, red, red]);
      const stats = await page.evaluate(() => window.tileProbe.stats());
      expect(stats.mode).toBe(zoom < 2 / 24 ? "overview" : "detail");
      if (stats.mode === "overview") {
        expect(stats.chunks).toBe(0);
        expect(stats.textures).toBe(0);
      }
    }
    // Partial right/bottom edges, neither a region nor a 64-tile boundary.
    await page.evaluate(() => window.tileProbe.view(1080, 520, 1 / 24));
    await settled(page);
    expect(
      await page.evaluate(() =>
        window.tileProbe.sample([
          [1098, 530],
          [1103, 530],
          [1090, 538],
          [1090, 543],
        ]),
      ),
    ).toEqual([red, [21, 27, 37, 255], red, [21, 27, 37, 255]]);
    await page.evaluate(() => window.tileProbe.view(-70, -40, 1 / 24));
    await settled(page);
    expect(
      await page.evaluate(() =>
        window.tileProbe.sample([
          [-60, -25],
          [-68, -25],
          [-60, -36],
        ]),
      ),
    ).toEqual([red, [21, 27, 37, 255], [21, 27, 37, 255]]);
    await page
      .locator("canvas")
      .screenshot({ path: testInfo.outputPath(`overview-dpr${density}.png`) });
    expect(errors).toEqual([]);
    await page.evaluate(() => window.tileProbe.dispose());
    const disposed = await page.evaluate(
      () => window.tileProbe.stats().overview,
    );
    expect(disposed.entries).toBe(0);
    expect(disposed.created).toBe(disposed.released);
    expect(disposed.scheduled).toBe(false);
    await context.close();
  });
}

test("overview refreshes edits, offscreen recolors, visibility, order, undo/redo and document changes", async ({
  page,
}) => {
  await page.goto("/tests/tiles.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(() => window.tileProbe.load("overview"));
  await page.evaluate(() => window.tileProbe.view(780, 90, 1 / 24));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[0, 255, 0, 255]]);
  await page.evaluate(() => window.tileProbe.view(-50, 0, 1 / 24));
  await settled(page);
  const previous = await page.evaluate(
    () => window.tileProbe.stats().overview.builds,
  );
  await page.evaluate(() => window.tileProbe.registry("grass", "#ffffffff"));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.stats().overview.builds),
  ).toBeGreaterThan(previous);
  await page.evaluate(() => window.tileProbe.view(780, 90, 1 / 24));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[255, 255, 255, 255]]);
  await page.evaluate(() => window.tileProbe.view(-50, 0, 1 / 24));
  await settled(page);
  await page.evaluate(() =>
    window.tileProbe.edit("upper", 810, 110, "#000000ff", 4),
  );
  await page.evaluate(() => window.tileProbe.view(780, 90, 1 / 24));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[0, 0, 0, 255]]);
  await page.evaluate(() => window.tileProbe.session.perform("undo"));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[255, 255, 255, 255]]);
  await page.evaluate(() => window.tileProbe.session.perform("redo"));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[0, 0, 0, 255]]);
  await page.evaluate(() => window.tileProbe.hide("upper", true));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([red]);
  await page.evaluate(() => window.tileProbe.hide("upper", false));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[0, 0, 0, 255]]);
  await page.evaluate(() => window.tileProbe.reorder(["upper", "terrain"]));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([red]);
  await page.evaluate(() => window.tileProbe.session.perform("undo"));
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[810, 110]])),
  ).toEqual([[0, 0, 0, 255]]);
  await page.evaluate(() => {
    const session = window.tileProbe.session;
    session.execute("Grow overview", [
      { kind: "bounds", bounds: { ...session.document.bounds, maxX: 1165 } },
    ]);
    window.tileProbe.edit("terrain", 1120, 110, "#0000ffff", 8);
    window.tileProbe.view(1100, 90, 1 / 24);
  });
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[1122, 110]])),
  ).toEqual([[0, 0, 255, 255]]);
  await page.evaluate(() => {
    window.tileProbe.session.perform("undo");
    window.tileProbe.session.perform("undo");
  });
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[1122, 110]])),
  ).toEqual([[21, 27, 37, 255]]);
  // Invalidate after a partial job, then replace the entire owning document/session.
  await page.evaluate(async () => {
    window.tileProbe.view(-50, 0, 1 / 24);
    window.tileProbe.registry("grass", "#0000ffff");
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await window.tileProbe.load("empty");
    window.tileProbe.view(10, 10, 1 / 24);
  });
  await settled(page);
  expect(
    await page.evaluate(() => window.tileProbe.sample([[20, 20]])),
  ).toEqual([[29, 39, 50, 255]]);
  const old = await page.evaluate(() => window.tileProbe.disposed()!.overview);
  expect(old.entries).toBe(0);
  expect(old.created).toBe(old.released);
  expect(old.scheduled).toBe(false);
});
