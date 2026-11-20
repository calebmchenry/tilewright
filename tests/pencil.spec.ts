import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=pencil");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const host = page.locator(".canvas-host");
  await host.focus();
  await host.press("b");
  await expect(
    page.locator("main").getByRole("button", { name: "Pencil", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  return host;
}
async function move(page: Page, x: number, y: number) {
  const box = (await page.locator(".canvas-host").boundingBox())!;
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await page.mouse.move(
    box.x + 24 + (x + 0.5 - view.x) * 24 * view.zoom,
    box.y + 24 + (y + 0.5 - view.y) * 24 * view.zoom,
  );
}
async function state(page: Page) {
  return page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      history: s.history.state,
      bounds: s.document.bounds,
      version: s.document.version,
      invalidations: window.editorProbe.invalidations.length,
    };
  });
}

for (const dpr of [1, 2])
  test(`large brushes paint and erase in cached overview with exact undo at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    const host = await setup(page),
      canvas = host.locator("canvas");
    // Compare map pixels independently of mouse/keyboard focus-ring changes.
    const snapshot = (stage?: string) =>
      canvas.screenshot({
        path: stage
          ? info.outputPath(`overview-brush-${stage}-dpr${dpr}.png`)
          : undefined,
        style: ".canvas-host { outline: none !important; }",
      });
    const button = (name: string) =>
      page.locator("main").getByRole("button", { name, exact: true });
    await page
      .locator("main")
      .getByLabel("Pencil size", { exact: true })
      .selectOption("32");
    // Leave Pencil selected while crossing the old cutoff into cached overview.
    await page.evaluate(() =>
      window.editorProbe.session.viewport.set({ x: -65, y: -65, zoom: 1 / 16 }),
    );
    await expect(button("Pencil")).toBeEnabled();
    await expect(button("Eraser")).toBeEnabled();
    await expect(button("Line")).toBeDisabled();
    await expect(
      page.getByRole("status", { name: "Editing availability" }),
    ).toHaveCount(0);
    await host.press("i");
    await expect(
      page.getByRole("status", { name: "Editing availability" }),
    ).toContainText("Pencil and Eraser work at any zoom");
    // Toolbar and keyboard activation both work while already zoomed out.
    await button("Pencil").click();
    await expect(button("Pencil")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(10, 10);
    const before = await state(page),
      pixels = await snapshot("before");
    await move(page, 60, 63);
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.drawing.footprint
          .getSnapshot()!
          .writes.map(({ x, y, length }) => ({ x, y, length })),
      ),
    ).toEqual(
      Array.from({ length: 32 }, (_, i) => ({ x: 45, y: 48 + i, length: 32 })),
    );
    await page.mouse.down();
    await move(page, 100, 63);
    expect(await state(page)).toEqual(before);
    await snapshot("preview");
    await page.mouse.up();
    await page.mouse.move(10, 10);
    const painted = await state(page);
    expect(painted.history.undoSteps).toBe(1);
    expect(painted.bounds).toEqual(before.bounds);
    expect(painted.runs.filter((r) => r.layerId === "terrain")).toEqual(
      before.runs.filter((r) => r.layerId === "terrain"),
    );
    expect(painted.runs.filter((r) => r.layerId === "buildings")).toEqual(
      Array.from({ length: 32 }, (_, i) => ({
        layerId: "buildings",
        x: 45,
        y: 48 + i,
        length: 72,
        value: { kind: "raw", rgba: "#ff0000ff" },
      })),
    );
    const paintedPixels = await snapshot("painted");
    expect(paintedPixels).not.toEqual(pixels);
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(before.runs);
    await expect
      .poll(async () => (await snapshot("undone")).equals(pixels))
      .toBe(true);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(painted.runs);
    await expect
      .poll(async () => (await snapshot()).equals(paintedPixels))
      .toBe(true);
    await host.press("e");
    await expect(button("Eraser")).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator("main").getByLabel("Eraser size", { exact: true }),
    ).toHaveValue("32");
    await move(page, 60, 63);
    await page.mouse.down();
    await move(page, 100, 63);
    await page.mouse.up();
    await page.mouse.move(10, 10);
    const erased = await state(page);
    expect(erased.history.undoSteps).toBe(2);
    expect(erased.runs).toEqual(
      before.runs.filter((r) => r.layerId === "terrain"),
    );
    const erasedPixels = await snapshot("erased");
    expect(erasedPixels).not.toEqual(paintedPixels);
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(painted.runs);
    await expect
      .poll(async () => (await snapshot()).equals(paintedPixels))
      .toBe(true);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(erased.runs);
    await expect
      .poll(async () => (await snapshot()).equals(erasedPixels))
      .toBe(true);
    await context.close();
  });

for (const dpr of [1, 2])
  test(`shipping pencil hover, diagonal stroke, layer isolation and exact visual undo at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    const host = await setup(page),
      canvas = host.locator("canvas");
    await page
      .locator("main")
      .getByLabel("Pencil size", { exact: true })
      .selectOption("3");
    await page.mouse.move(10, 10);
    const before = await state(page),
      pixels = await canvas.screenshot();
    await move(page, 60, 60);
    const footprint = await page.evaluate(() =>
      window.editorProbe.session.drawing.footprint.getSnapshot(),
    );
    expect(
      footprint!.writes.map(({ x, y, length }) => ({ x, y, length })),
    ).toEqual([59, 60, 61].map((y) => ({ x: 59, y, length: 3 })));
    expect(
      await canvas.screenshot({
        path: info.outputPath(`pencil-hover-dpr${dpr}.png`),
      }),
    ).not.toEqual(pixels);
    expect(await state(page)).toEqual(before);
    await page.mouse.down();
    await move(page, 70, 70); // one fast sample, not ten artificial steps
    expect(await state(page)).toEqual(before);
    await canvas.screenshot({
      path: info.outputPath(`pencil-stroke-preview-dpr${dpr}.png`),
    });
    await page.mouse.up();
    await page.mouse.move(10, 10);
    const after = await state(page);
    expect(after.history.undoSteps).toBe(1);
    expect(after.invalidations).toBe(1);
    expect(after.bounds).toEqual(before.bounds);
    expect(after.runs.filter((r) => r.layerId === "terrain")).toEqual(
      before.runs.filter((r) => r.layerId === "terrain"),
    );
    const painted = await page.evaluate(() => {
      const s = window.editorProbe.session;
      return Array.from({ length: 11 }, (_, i) =>
        s.document.getCell(s.activeLayer.getSnapshot(), 60 + i, 60 + i),
      );
    });
    expect(painted).toEqual(Array(11).fill({ kind: "raw", rgba: "#ff0000ff" }));
    const committedPixels = await canvas.screenshot({
      path: info.outputPath(`pencil-committed-dpr${dpr}.png`),
    });
    expect(committedPixels).not.toEqual(pixels);
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(before.runs);
    expect((await state(page)).history.dirty).toBe(false);
    expect(await canvas.screenshot()).toEqual(pixels);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(after.runs);
    expect(await canvas.screenshot()).toEqual(committedPixels);
    await context.close();
  });

test("size controls, even dab, registered fast horizontal stroke, clipping and cancellation use the shipping tool", async ({
  page,
}) => {
  const host = await setup(page);
  const size = page.locator("main").getByLabel("Pencil size", { exact: true });
  await size.selectOption("2");
  const before = await state(page);
  await move(page, 63, 63);
  await page.mouse.down();
  await page.mouse.up();
  const dab = await page.evaluate(() => {
    const s = window.editorProbe.session,
      layer = s.activeLayer.getSnapshot();
    return [
      s.document.getCell(layer, 63, 63),
      s.document.getCell(layer, 64, 63),
      s.document.getCell(layer, 63, 64),
      s.document.getCell(layer, 64, 64),
      s.document.getCell(layer, 62, 64),
    ];
  });
  expect(dab).toEqual([
    ...Array(4).fill({ kind: "raw", rgba: "#ff0000ff" }),
    null,
  ]);
  await host.press("ControlOrMeta+z");
  expect((await state(page)).runs).toEqual(before.runs);
  await page
    .locator("main")
    .getByRole("button", { name: "Paint with Grass", exact: true })
    .click();
  await move(page, 60, 63);
  await page.mouse.down();
  await move(page, 70, 63);
  await page.mouse.up();
  const refs = await page.evaluate(() => {
    const s = window.editorProbe.session;
    return Array.from({ length: 12 }, (_, i) =>
      s.document.getCell(s.activeLayer.getSnapshot(), 60 + i, 64),
    );
  });
  expect(refs).toEqual(
    Array(12).fill({ kind: "registered", registryId: "grass" }),
  );
  await host.press("ControlOrMeta+z");
  const undone = await state(page);
  await move(page, 62, 62);
  await page.mouse.down();
  await move(page, 69, 69);
  await host.press("]");
  await expect(size).toHaveValue("3");
  expect(
    await page.evaluate(() => window.editorProbe.session.drawing.pointerId),
  ).toBeNull();
  await page.mouse.up();
  expect(await state(page)).toEqual(undone);
  // Changing the preference does not consume redo, even when canceling a stroke.
  await host.press("ControlOrMeta+Shift+z");
  expect((await state(page)).history.undoSteps).toBe(1);
  await page
    .locator("main")
    .getByLabel("Hex color", { exact: true })
    .fill("#123456");
  await page
    .locator("main")
    .getByLabel("Hex color", { exact: true })
    .press("]");
  await expect(size).toHaveValue("3");
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.viewport.set({ x: 125, y: 125, zoom: 1 });
    s.setPencilSize(4);
  });
  const bounds = (await state(page)).bounds;
  await move(page, 130, 132);
  await page.mouse.down();
  await page.mouse.up();
  expect((await state(page)).bounds).toEqual(bounds);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.drawing.preview.getSnapshot(),
    ),
  ).toBeNull();
  await page.mouse.move(10, 10);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.drawing.footprint.getSnapshot(),
    ),
  ).toBeNull();
  await page.setViewportSize({ width: 640, height: 452 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(false);
});
