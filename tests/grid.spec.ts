import { expect, test } from "@playwright/test";
import type { TileProbe } from "./tiles-harness";
import type { EditorSession } from "../src/editor/session";

// Other suites declare these same test-only globals.
declare global {
  interface Window {
    tileProbe: TileProbe;
  }
}

for (const density of [1, 2]) {
  test(`grid pixels align at 0/63/64/127/128 and partial map edges at DPR ${density}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ deviceScaleFactor: density });
    const page = await context.newPage();
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.tileProbe.load("grid"));
    for (const zoom of [1 / 3, 0.5, 1, 1.37, 4])
      for (const edge of [-64, 0, 63, 64, 127, 128]) {
        const result = await page.evaluate(
          ({ zoom, edge, density }) => {
            const x = edge - 2.123,
              y = 5.25;
            window.tileProbe.view(x, y, zoom);
            const sx = 24 + (edge - x) * 24 * zoom;
            const sy = 24 + (10.5 - y) * 24 * zoom;
            const width = edge % 64 === 0 ? 2 : 1;
            const start = Math.round(sx * density - (width * density) / 2);
            const points: [number, number][] = [];
            for (let offset = -1; offset <= width * density; offset++)
              points.push([(start + offset + 0.5) / density, sy]);
            return window.tileProbe.sampleScreen(points);
          },
          { zoom, edge, density },
        );
        const terrain = [51, 92, 70, 255];
        expect(result[0]).toEqual(terrain);
        expect(result.at(-1)).toEqual(terrain);
        for (const pixel of result.slice(1, -1)) {
          expect(pixel[0]).toBeGreaterThan(terrain[0]);
          expect(pixel[1]).toBeGreaterThan(terrain[1]);
          if (edge % 64 === 0) expect(pixel[0]).toBeGreaterThan(110);
        }
      }
    const edgePixels = await page.evaluate(() => {
      window.tileProbe.view(128, 130, 1);
      return window.tileProbe.sampleScreen([
        [95.5, 60],
        [96.5, 60],
        [60, 95.5],
        [60, 96.5],
      ]);
    });
    expect(edgePixels[0][0]).toBeGreaterThan(100);
    expect(edgePixels[1]).toEqual([21, 27, 37, 255]);
    expect(edgePixels[2][0]).toBeGreaterThan(100);
    expect(edgePixels[3]).toEqual([21, 27, 37, 255]);
    await context.close();
  });

  test(`Inspect measures an 8×8 footprint and readouts survive detail/overview at DPR ${density}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      deviceScaleFactor: density,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    await page.goto("/tests/editor.html?fixture=grid");
    const canvas = page.locator(".canvas-host").first();
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    const before = await page.evaluate(() => {
      const session: EditorSession = window.editorProbe.session;
      session.viewport.set({ x: 55.125, y: 55.125, zoom: 1 });
      return {
        version: session.document.version,
        runs: [...session.document.iterateRuns()],
        history: session.history.state,
      };
    });
    const point = async (x: number, y: number) => {
      const box = (await canvas.boundingBox())!;
      return {
        x: box.x + 24 + (x + 0.5 - 55.125) * 24,
        y: box.y + 24 + (y + 0.5 - 55.125) * 24,
      };
    };
    const start = await point(67, 67),
      end = await point(60, 60);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("rectangle-readout")).toHaveText(
      "Rectangle 8 × 8 tiles",
    );
    await expect(page.getByTestId("chunk-readout")).toHaveText(
      "Chunk 0, 0 · Local 60, 60",
    );
    await expect(page.getByTestId("map-dimensions").first()).toHaveText(
      "196 × 198 tiles3.0625 × 3.09375 chunks",
    );
    await page.screenshot({
      path: testInfo.outputPath(`grid-detail-dpr${density}.png`),
    });
    for (const tile of [63, 64]) {
      const position = await point(tile, tile);
      await page.mouse.move(position.x, position.y);
      await expect(page.getByTestId("coordinate-readout")).toHaveText(
        `Tile ${tile}, ${tile}`,
      );
      await expect(page.getByTestId("chunk-readout")).toHaveText(
        tile === 63 ? "Chunk 0, 0 · Local 63, 63" : "Chunk 1, 1 · Local 0, 0",
      );
    }
    // Cancellation restores the previous rectangle, including lost capture.
    await page.mouse.down();
    await canvas.dispatchEvent("pointercancel");
    await page.mouse.up();
    await expect(page.getByTestId("rectangle-readout")).toHaveText(
      "Rectangle 8 × 8 tiles",
    );
    await page.mouse.down();
    await canvas.dispatchEvent("lostpointercapture");
    await page.mouse.up();
    await expect(page.getByTestId("rectangle-readout")).toHaveText(
      "Rectangle 8 × 8 tiles",
    );
    await canvas.press("f");
    await expect(page.getByTestId("grid-scale")).toContainText(
      "64-tile chunk lines",
    );
    await expect(page.getByTestId("grid-scale")).not.toContainText("Tile grid");
    await page.screenshot({
      path: testInfo.outputPath(`grid-overview-dpr${density}.png`),
    });
    await canvas.press("Escape");
    await expect(page.getByTestId("rectangle-readout")).toHaveText(
      "Rectangle —",
    );
    expect(
      await page.evaluate(() => {
        const session = window.editorProbe.session;
        return {
          version: session.document.version,
          runs: [...session.document.iterateRuns()],
          history: session.history.state,
        };
      }),
    ).toEqual(before);
    await page.setViewportSize({ width: 640, height: 452 });
    await expect(page.getByTestId("grid-scale")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(640);
    await context.close();
  });
}
