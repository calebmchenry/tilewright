import { expect, test, type Page } from "@playwright/test";
import type { TileProbe } from "./tiles-harness";
import { trackGpu } from "./gpu";

declare global {
  interface Window {
    tileProbe: TileProbe;
  }
}

async function createMap(page: Page, width: number, height: number) {
  await page.getByRole("button", { name: "New map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New map" });
  await dialog.getByLabel("Width (tiles)").fill(String(width));
  await dialog.getByLabel("Height (tiles)").fill(String(height));
  await dialog.getByLabel("Discard the current unsaved map").check();
  await dialog.getByRole("button", { name: "Create map" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await expect(page.getByTestId("map-dimensions")).toHaveText(
    `${width} × ${height} tiles${width / 64} × ${height / 64} chunks`,
  );
}

test("New Map validates dimensions, cancels safely, and replaces sessions without stale canvases", async ({
  page,
}, testInfo) => {
  await trackGpu(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const original = await page.locator("canvas").elementHandle();
  await page.getByLabel("Layer name", { exact: true }).fill("Keep this layer");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("button", { name: "New map", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New map" });
  await expect(dialog.getByLabel("Width (tiles)")).toHaveValue("256");
  await expect(dialog.getByLabel("Height (tiles)")).toHaveValue("256");
  await expect(dialog).toContainText("4 × 4 chunks");
  await expect(
    dialog.getByRole("button", { name: "Create map" }),
  ).toBeDisabled();
  await dialog.getByLabel("Discard the current unsaved map").check();
  for (const width of [
    "",
    "0",
    "-1",
    "2.5",
    "1e9",
    "65537",
    "9007199254740993",
  ]) {
    await dialog.getByLabel("Width (tiles)").fill(width);
    await expect(dialog.getByRole("status")).toContainText(/whole|at most/);
    await expect(
      dialog.getByRole("button", { name: "Create map" }),
    ).toBeDisabled();
  }
  await dialog.getByRole("button", { name: "Cancel" }).focus();
  await page.keyboard.press("Meta+z");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue(
    "Keep this layer",
  );
  expect(await original!.evaluate((canvas) => canvas.isConnected)).toBe(true);
  for (const [width, height] of [
    [1, 1],
    [101, 130],
    [6400, 6400],
  ]) {
    await createMap(page, width, height);
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue(
      "Layer 1",
    );
    await expect
      .poll(() => page.evaluate(() => window.gpuProbe().contexts))
      .toBe(1);
  }
  expect(await original!.evaluate((canvas) => canvas.isConnected)).toBe(false);
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("target-new-map.png") });
  await page.setViewportSize({ width: 640, height: 452 });
  await page.getByRole("button", { name: "New map", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({
    path: testInfo.outputPath("new-map-small-window.png"),
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    640,
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(errors).toEqual([]);
});

test("Grow Canvas supports every edge, combined increments, validation and chronological undo/redo", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await createMap(page, 101, 130);
  const original = await page.locator("canvas").elementHandle();
  for (const edge of ["Left", "Right", "Top", "Bottom"]) {
    await page
      .getByRole("button", { name: "Grow canvas", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Grow canvas" });
    await expect(
      dialog.getByRole("button", { name: "Apply growth" }),
    ).toBeDisabled();
    await dialog.getByLabel(`${edge} edge`, { exact: true }).check();
    await expect(dialog.getByLabel(`${edge} increments`)).toHaveValue("1");
    await dialog.getByRole("button", { name: "Apply growth" }).click();
    const dimensions = ["Left", "Right"].includes(edge)
      ? "165 × 130"
      : "101 × 194";
    await expect(page.getByTestId("map-dimensions")).toContainText(
      `${dimensions} tiles`,
    );
    await page
      .getByRole("button", { name: "Undo Grow canvas", exact: true })
      .click();
    await expect(page.getByTestId("map-dimensions")).toContainText(
      "101 × 130 tiles",
    );
    await page
      .getByRole("button", { name: "Redo Grow canvas", exact: true })
      .click();
    await expect(page.getByTestId("map-dimensions")).toContainText(
      `${dimensions} tiles`,
    );
    await page
      .getByRole("button", { name: "Undo Grow canvas", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Grow canvas", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Grow canvas" });
  await dialog.getByLabel("Left edge", { exact: true }).check();
  for (const value of ["", "0", "-1", "1.5", "1024", "9007199254740993"]) {
    await dialog.getByLabel("Left increments").fill(value);
    await expect(
      dialog.getByRole("button", { name: "Apply growth" }),
    ).toBeDisabled();
  }
  await dialog.getByLabel("Left increments").fill("2");
  await dialog.getByLabel("Top edge", { exact: true }).check();
  await expect(dialog).toContainText("229 × 194 tiles");
  await expect(dialog).toContainText("World bounds: [-128, 101) × [-64, 130)");
  await page.screenshot({ path: testInfo.outputPath("growth-preview.png") });
  await dialog.getByRole("button", { name: "Apply growth" }).click();
  await expect(page.getByTestId("map-dimensions")).toContainText(
    "229 × 194 tiles",
  );
  expect(await original!.evaluate((canvas) => canvas.isConnected)).toBe(true);
  await page
    .getByRole("button", { name: "Undo Grow canvas", exact: true })
    .click();
  await expect(page.getByTestId("map-dimensions")).toContainText(
    "101 × 130 tiles",
  );
  // An Inspect drag across the exclusive right/bottom edge never expands bounds.
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const canvas = page.locator(".canvas-host");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(page.getByTestId("map-dimensions")).toContainText(
    "101 × 130 tiles",
  );
  await expect(
    page.getByRole("button", { name: "Redo Grow canvas", exact: true }),
  ).toBeEnabled();
});

for (const density of [1, 2]) {
  test(`growth preserves populated multilayer detail/overview pixels and rebuilds edges at DPR ${density}`, async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({ deviceScaleFactor: density });
    const page = await context.newPage();
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.tileProbe.load("grid"));
    const settled = async () =>
      expect
        .poll(() =>
          page.evaluate(() => window.tileProbe.stats().overview.pending),
        )
        .toBe(0);
    for (const zoom of [1, 1 / 24]) {
      await page.evaluate(
        (zoom) =>
          window.tileProbe.view(
            zoom === 1 ? 55 : -80,
            zoom === 1 ? 55 : -80,
            zoom,
          ),
        zoom,
      );
      await settled();
      const before = await page.evaluate(() => ({
        pixels: window.tileProbe.sample([
          [61, 61],
          [70, 61],
        ]),
        view: window.tileProbe.session.viewport.getSnapshot(),
        storage: window.tileProbe.session.document.storageStats(),
        stats: window.tileProbe.stats(),
      }));
      expect(before.pixels).toEqual([
        [177, 139, 77, 255],
        [51, 92, 70, 255],
      ]);
      await page.evaluate(() =>
        window.tileProbe.session.growCanvas({
          left: 1,
          right: 1,
          top: 1,
          bottom: 1,
        }),
      );
      await settled();
      const after = await page.evaluate(() => ({
        pixels: window.tileProbe.sample([
          [61, 61],
          [70, 61],
        ]),
        view: window.tileProbe.session.viewport.getSnapshot(),
        storage: window.tileProbe.session.document.storageStats(),
        stats: window.tileProbe.stats(),
      }));
      expect(after.pixels).toEqual(before.pixels);
      expect(after.view).toEqual(before.view);
      expect(after.storage).toEqual(before.storage);
      if (zoom === 1 / 24) {
        expect(after.stats.overview.released).toBeGreaterThan(
          before.stats.overview.released,
        );
        expect(
          await page.evaluate(() => window.tileProbe.sample([[-70, 10]])),
        ).toEqual([[29, 39, 50, 255]]);
      }
      await page.evaluate(() => window.tileProbe.session.perform("undo"));
      await settled();
      expect(
        await page.evaluate(() =>
          window.tileProbe.sample([
            [61, 61],
            [70, 61],
          ]),
        ),
      ).toEqual(before.pixels);
      if (zoom === 1 / 24)
        expect(
          await page.evaluate(() => window.tileProbe.sample([[-70, 10]])),
        ).toEqual([[21, 27, 37, 255]]);
      await page.evaluate(() => window.tileProbe.session.perform("redo"));
      await settled();
      expect(
        await page.evaluate(() =>
          window.tileProbe.sample([
            [61, 61],
            [70, 61],
          ]),
        ),
      ).toEqual(before.pixels);
      await page.screenshot({
        path: testInfo.outputPath(
          `growth-${zoom === 1 ? "detail" : "overview"}.png`,
        ),
      });
      await page.evaluate(() => window.tileProbe.session.perform("undo"));
      await settled();
    }
    await context.close();
  });
}
