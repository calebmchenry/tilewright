import { expect, test, type Page } from "@playwright/test";

const action = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
const style = (page: Page) =>
  page.locator("main").getByLabel("Rectangle style", { exact: true });
async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=shapes");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  return page.locator(".canvas-host");
}
async function point(page: Page, x: number, y: number) {
  const box = (await page.locator(".canvas-host").boundingBox())!;
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  return {
    x: box.x + 24 + (x + 0.5 - view.x) * 24 * view.zoom,
    y: box.y + 24 + (y + 0.5 - view.y) * 24 * view.zoom,
  };
}
async function move(page: Page, x: number, y: number) {
  const p = await point(page, x, y);
  await page.mouse.move(p.x, p.y);
}
const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      bounds: s.document.bounds,
      registry: s.document.registryEntries,
      layers: s.document.layers,
      version: s.document.version,
      history: s.history.state,
      invalidations: window.editorProbe.invalidations.length,
    };
  });
const preview = (page: Page) =>
  page.evaluate(
    () => window.editorProbe.session.drawing.preview.getSnapshot()!.writes,
  );

for (const dpr of [1, 2])
  test(`shipping filled terrain and reverse 8 by 8 house outline: exact preview, layer isolation and visual undo/redo at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1200, height: 800 },
      }),
      page = await context.newPage();
    const host = await setup(page),
      canvas = host.locator("canvas");
    await page
      .locator("main")
      .getByLabel("Layer name: Terrain", { exact: true })
      .click();
    await action(page, "Paint with Grass").click();
    await action(page, "Rectangle").click();
    await expect(style(page)).toHaveValue("filled");
    // Compare persisted pixels with the same keyboard focus outline; explicit
    // panel activation now moves focus away from the canvas.
    await host.press("Shift");
    const before = await state(page),
      originalPixels = await canvas.screenshot();
    await move(page, 60, 60);
    await page.mouse.down();
    await move(page, 67, 67);
    expect(await state(page)).toEqual(before);
    const terrainPreview = await preview(page);
    expect(
      terrainPreview.map(({ x, y, length, value }) => ({
        x,
        y,
        length,
        value,
      })),
    ).toEqual(
      Array.from({ length: 8 }, (_, i) => ({
        x: 60,
        y: 60 + i,
        length: 8,
        value: { kind: "registered", registryId: "grass" },
      })),
    );
    expect(
      await canvas.screenshot({
        path: info.outputPath(`terrain-preview-dpr${dpr}.png`),
      }),
    ).not.toEqual(originalPixels);
    await page.mouse.up();
    await page.mouse.move(10, 10);
    await host.press("Shift");
    const terrain = await state(page),
      terrainPixels = await canvas.screenshot();
    expect(terrain.history.undoSteps).toBe(1);
    expect(terrain.invalidations).toBe(1);
    expect(terrain.runs.filter((w) => w.layerId === "buildings")).toEqual(
      before.runs.filter((w) => w.layerId === "buildings"),
    );
    for (const w of terrainPreview)
      expect(
        await page.evaluate(
          (w) =>
            window.editorProbe.session.document.getCell(w.layerId, w.x, w.y),
          w,
        ),
      ).toEqual(w.value);
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(before.runs);
    expect(await canvas.screenshot()).toEqual(originalPixels);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(terrain.runs);
    expect(await canvas.screenshot()).toEqual(terrainPixels);
    await page
      .locator("main")
      .getByLabel("Layer name: Buildings", { exact: true })
      .click();
    await page
      .locator("main")
      .getByLabel("Hex color", { exact: true })
      .fill("#ff0000");
    await style(page).selectOption("outline");
    const beforeHouse = await state(page);
    await move(page, 67, 67);
    await page.mouse.down();
    await move(page, 70, 70);
    await move(page, 60, 60);
    const outline = await preview(page);
    expect(outline.reduce((n, w) => n + w.length, 0)).toBe(28);
    expect(outline.map(({ x, y, length }) => ({ x, y, length }))).toEqual([
      { x: 60, y: 60, length: 8 },
      ...Array.from({ length: 6 }, (_, i) => [
        { x: 60, y: 61 + i, length: 1 },
        { x: 67, y: 61 + i, length: 1 },
      ]).flat(),
      { x: 60, y: 67, length: 8 },
    ]);
    expect(await state(page)).toEqual(beforeHouse);
    await canvas.screenshot({
      path: info.outputPath(`house-preview-dpr${dpr}.png`),
    });
    await page.mouse.up();
    await page.mouse.move(10, 10);
    await host.press("Shift");
    const house = await state(page),
      housePixels = await canvas.screenshot({
        path: info.outputPath(`terrain-house-dpr${dpr}.png`),
      });
    expect(house.history.undoSteps).toBe(2);
    expect(house.history.undoLabel).toBe("Rectangle");
    expect(house.invalidations).toBe(4);
    expect(house.bounds).toEqual(before.bounds);
    expect(house.runs.filter((w) => w.layerId === "terrain")).toEqual(
      terrain.runs.filter((w) => w.layerId === "terrain"),
    );
    const expected = new Map<string, unknown>();
    for (const w of terrain.runs.filter((w) => w.layerId === "buildings"))
      for (let x = w.x; x < w.x + w.length; x++)
        expected.set(`${x}/${w.y}`, w.value);
    for (const w of outline)
      for (let x = w.x; x < w.x + w.length; x++)
        expected.set(`${x}/${w.y}`, w.value);
    const actual = house.runs
      .filter((w) => w.layerId === "buildings")
      .flatMap((w) =>
        Array.from({ length: w.length }, (_, i) => [
          `${w.x + i}/${w.y}`,
          w.value,
        ]),
      );
    expect(actual.sort()).toEqual([...expected].sort());
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(terrain.runs);
    expect(await canvas.screenshot()).toEqual(terrainPixels);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(house.runs);
    expect(await canvas.screenshot()).toEqual(housePixels);
    await context.close();
  });

test("shipping Line uses original anchor, release endpoint, one-tile width and exact visual undo", async ({
  page,
}, info) => {
  const host = await setup(page),
    canvas = host.locator("canvas");
  await host.focus();
  await host.press("b");
  await page
    .locator("main")
    .getByLabel("Pencil size", { exact: true })
    .selectOption("32");
  await host.focus();
  await host.press("l");
  await expect(action(page, "Line")).toHaveAttribute("aria-pressed", "true");
  const before = await state(page),
    pixels = await canvas.screenshot();
  await move(page, 60, 60);
  await page.mouse.down();
  await move(page, 70, 70);
  await move(page, 64, 62);
  expect(
    (await preview(page)).flatMap((w) =>
      Array.from({ length: w.length }, (_, i) => `${w.x + i}/${w.y}`),
    ),
  ).toEqual(["60/60", "61/61", "62/61", "63/62", "64/62"]);
  expect(await state(page)).toEqual(before);
  await canvas.screenshot({ path: info.outputPath("line-preview.png") });
  // A release-only position must replace the last preview, not append its path.
  const end = await point(page, 60, 67);
  await host.dispatchEvent("pointerup", {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    buttons: 0,
    clientX: end.x,
    clientY: end.y,
  });
  await page.mouse.up();
  await page.mouse.move(10, 10);
  const after = await state(page);
  expect(after.history.undoSteps).toBe(1);
  expect(after.history.undoLabel).toBe("Line");
  expect(after.invalidations).toBe(1);
  expect(
    await page.evaluate(() => {
      const s = window.editorProbe.session,
        id = s.activeLayer.getSnapshot();
      return Array.from({ length: 8 }, (_, i) =>
        s.document.getCell(id, 60, 60 + i),
      );
    }),
  ).toEqual(Array(8).fill({ kind: "raw", rgba: "#ff0000ff" }));
  expect(
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      return s.document.getCell(s.activeLayer.getSnapshot(), 61, 61);
    }),
  ).toBeNull();
  const drawn = await canvas.screenshot({
    path: info.outputPath("line-committed.png"),
  });
  await host.press("ControlOrMeta+z");
  expect((await state(page)).runs).toEqual(before.runs);
  expect(await canvas.screenshot()).toEqual(pixels);
  await host.press("ControlOrMeta+Shift+z");
  expect((await state(page)).runs).toEqual(after.runs);
  expect(await canvas.screenshot()).toEqual(drawn);
});

test("rectangle style cancellation, map-edge clipping, thin shapes, shortcuts and minimum-window controls", async ({
  page,
}) => {
  const host = await setup(page);
  await host.focus();
  await host.press("r");
  await expect(action(page, "Rectangle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const before = await state(page);
  await move(page, 60, 60);
  await page.mouse.down();
  await move(page, 67, 67);
  await page.evaluate(() =>
    window.editorProbe.session.setRectangleMode("outline"),
  );
  await page.mouse.up();
  expect(await state(page)).toEqual(before);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.drawing.preview.getSnapshot(),
    ),
  ).toBeNull();
  await expect(style(page)).toHaveValue("outline");
  await move(page, 60, 60);
  await page.mouse.down();
  await move(page, 67, 67);
  await host.press("Escape");
  await page.mouse.up();
  expect(await state(page)).toEqual(before);
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 125, y: 127, zoom: 1 }),
  );
  await move(page, 129, 131);
  await page.mouse.down();
  await move(page, 135, 138);
  expect(
    (await preview(page)).map(({ x, y, length }) => ({ x, y, length })),
  ).toEqual([
    { x: 129, y: 131, length: 2 },
    { x: 129, y: 132, length: 1 },
  ]);
  await page.mouse.up();
  const clipped = await state(page);
  expect(clipped.bounds).toEqual(before.bounds);
  expect(clipped.history.undoSteps).toBe(1);
  await host.press("ControlOrMeta+z");
  expect((await state(page)).runs).toEqual(before.runs);
  const undone = await state(page);
  await move(page, 135, 138);
  await page.mouse.down();
  await page.mouse.up();
  expect(await state(page)).toEqual(undone);
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 55, y: 55, zoom: 1 }),
  );
  // A one-cell-wide rectangle and a click stay solid in either style.
  for (const mode of ["filled", "outline"]) {
    await style(page).selectOption(mode);
    await move(page, 60, 60);
    await page.mouse.down();
    await move(page, 60, 67);
    expect(
      (await preview(page)).map(({ x, y, length }) => ({ x, y, length })),
    ).toEqual(
      Array.from({ length: 8 }, (_, i) => ({ x: 60, y: 60 + i, length: 1 })),
    );
    await page.mouse.up();
    await host.press("ControlOrMeta+z");
    await move(page, 61, 61);
    await page.mouse.down();
    expect(
      (await preview(page)).map(({ x, y, length }) => ({ x, y, length })),
    ).toEqual([{ x: 61, y: 61, length: 1 }]);
    await page.mouse.up();
    await host.press("ControlOrMeta+z");
  }
  const input = page.locator("main").getByLabel("Hex color", { exact: true });
  await input.focus();
  await input.press("l");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.activeTool.getSnapshot(),
    ),
  ).toBe("rectangle");
  await page.setViewportSize({ width: 640, height: 452 });
  await style(page).scrollIntoViewIfNeeded();
  await expect(style(page)).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(false);
  await page
    .locator("main")
    .locator('.layer-row[data-active="true"] .layer-visibility-button')
    .click();
  await expect(action(page, "Line")).toBeDisabled();
  await expect(action(page, "Rectangle")).toBeDisabled();
});
