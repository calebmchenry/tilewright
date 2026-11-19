import { expect, test, type Page } from "@playwright/test";

const action = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=eraser-sampling");
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
async function click(page: Page, x: number, y: number) {
  await move(page, x, y);
  await page.mouse.down();
  await page.mouse.up();
}
const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      bounds: s.document.bounds,
      layers: s.document.layers,
      registry: s.document.registryEntries,
      history: s.history.state,
      version: s.document.version,
      invalidations: window.editorProbe.invalidations.length,
    };
  });
const paint = (page: Page) =>
  page.evaluate(() => window.editorProbe.session.currentPaint());
async function tilePixels(page: Page, x: number, y: number) {
  const p = await point(page, x, y);
  return page.screenshot({
    clip: { x: p.x - 4, y: p.y - 4, width: 8, height: 8 },
  });
}

for (const dpr of [1, 2]) {
  test(`shipping eraser preview, lower-layer reveal and exact atomic undo/redo at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage(),
      host = await setup(page),
      canvas = host.locator("canvas");
    await host.focus();
    await host.press("e");
    await expect(action(page, "Eraser")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page
      .locator("main")
      .getByLabel("Eraser size", { exact: true })
      .selectOption("3");
    await page.mouse.move(10, 10);
    const before = await state(page),
      pixels = await canvas.screenshot();
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      s.setLayerVisible(s.activeLayer.getSnapshot(), false);
    });
    const lowerPixels = await canvas.screenshot();
    expect(lowerPixels).not.toEqual(pixels);
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      s.setLayerVisible(s.activeLayer.getSnapshot(), true);
    });
    await move(page, 60, 63);
    expect(
      await canvas.screenshot({
        path: info.outputPath(`eraser-hover-dpr${dpr}.png`),
      }),
    ).not.toEqual(pixels);
    expect(await state(page)).toEqual(before);
    await page.mouse.down();
    await move(page, 70, 63); // crosses both the 32-cell and 64-cell boundary
    expect(await state(page)).toEqual(before);
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.drawing.preview
          .getSnapshot()!
          .writes.every((w) => w.value === null),
      ),
    ).toBe(true);
    await canvas.screenshot({
      path: info.outputPath(`eraser-stroke-dpr${dpr}.png`),
    });
    await page.mouse.up();
    await page.mouse.move(10, 10);
    const after = await state(page);
    expect(after.runs.filter((r) => r.layerId === "buildings")).toEqual([]);
    expect(after.runs.filter((r) => r.layerId === "terrain")).toEqual(
      before.runs.filter((r) => r.layerId === "terrain"),
    );
    expect(after.history.undoSteps).toBe(1);
    expect(after.history.undoLabel).toBe("Eraser");
    expect(after.invalidations).toBe(1);
    expect(after.bounds).toEqual(before.bounds);
    expect(
      await canvas.screenshot({
        path: info.outputPath(`eraser-revealed-dpr${dpr}.png`),
      }),
    ).toEqual(lowerPixels);
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(before.runs);
    expect((await state(page)).history.dirty).toBe(false);
    expect(await canvas.screenshot()).toEqual(pixels);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(after.runs);
    expect(await canvas.screenshot()).toEqual(lowerPixels);
    const redone = await state(page);
    await click(page, 62, 63); // already empty: lower content is never erased
    expect(await state(page)).toEqual(redone);
    await context.close();
  });

  test(`eyedropper samples stored Grass/raw identity, paints and follows only registered recolors at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage(),
      host = await setup(page);
    const before = await state(page);
    await action(page, "Eyedropper").click();
    await expect(action(page, "Eyedropper")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await click(page, 62, 63);
    expect(await paint(page)).toEqual({
      kind: "registered",
      registryId: "grass",
    });
    await expect(
      page.locator("main").getByTestId("color-association"),
    ).toHaveText("Named color · Grass");
    expect(await state(page)).toEqual(before);
    await host.press("b");
    await click(page, 62, 65);
    // Author a raw tile with exactly the same bytes, then sample and paint it.
    await page
      .locator("main")
      .getByLabel("Hex color", { exact: true })
      .fill("#00ff00");
    await action(page, "Apply color").click();
    await click(page, 64, 65);
    await host.press("d");
    const beforeRawSample = await state(page);
    await click(page, 64, 65);
    expect(await paint(page)).toEqual({ kind: "raw", rgba: "#00ff00ff" });
    expect(await state(page)).toEqual(beforeRawSample);
    await host.press("b");
    await click(page, 66, 65);
    await host.press("d");
    await click(page, 70, 63); // empty upper layer exposes unregistered terrain
    expect(await paint(page)).toEqual({ kind: "raw", rgba: "#335c46ff" });
    await click(page, 62, 65);
    await page.mouse.move(10, 10);
    const registeredPixels = await tilePixels(page, 62, 65);
    expect(await tilePixels(page, 66, 65)).toEqual(registeredPixels);
    await action(page, "Edit Grass").click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Named color hex").fill("#557755");
    await dialog
      .getByRole("button", { name: "Edit named color", exact: true })
      .click();
    await expect(page.locator("main").getByLabel("Selected color")).toHaveText(
      "#557755",
    );
    await page.mouse.move(10, 10);
    expect(await tilePixels(page, 62, 65)).not.toEqual(registeredPixels);
    expect(await tilePixels(page, 66, 65)).toEqual(registeredPixels);
    expect(
      await page.evaluate(() => {
        const s = window.editorProbe.session,
          id = s.activeLayer.getSnapshot();
        return [62, 64, 66].map((x) => s.document.getCell(id, x, 65));
      }),
    ).toEqual([
      { kind: "registered", registryId: "grass" },
      ...Array(2).fill({ kind: "raw", rgba: "#00ff00ff" }),
    ]);
    await page.screenshot({
      path: info.outputPath(`sampled-paint-recolored-dpr${dpr}.png`),
    });
    await host.focus();
    await host.press("ControlOrMeta+z");
    expect(await tilePixels(page, 62, 65)).toEqual(registeredPixels);
    await host.press("ControlOrMeta+Shift+z");
    expect(await tilePixels(page, 62, 65)).not.toEqual(registeredPixels);
    expect(await tilePixels(page, 66, 65)).toEqual(registeredPixels);
    await context.close();
  });
}

test("sampling routing, hidden/empty cells, eraser size cancellation and small-window controls", async ({
  page,
}) => {
  const host = await setup(page),
    before = await state(page);
  await host.focus();
  await host.press("d");
  // Only primary unmodified down samples; motion/up is not a continuous sampler.
  await move(page, 62, 63);
  await page.mouse.down();
  await move(page, 70, 63);
  await page.mouse.up();
  expect(await paint(page)).toEqual({
    kind: "registered",
    registryId: "grass",
  });
  expect(await state(page)).toEqual(before);
  await click(page, 60, 60); // empty
  expect(await paint(page)).toEqual({
    kind: "registered",
    registryId: "grass",
  });
  await page
    .locator("main")
    .getByRole("checkbox", { name: "Show active layer" })
    .uncheck();
  await expect(action(page, "Eraser")).toBeDisabled();
  await expect(action(page, "Eyedropper")).toBeEnabled();
  await click(page, 62, 63);
  expect(await paint(page)).toEqual({ kind: "raw", rgba: "#335c46ff" });
  expect(await state(page)).toEqual(before);
  await page
    .locator("main")
    .getByRole("checkbox", { name: "Show active layer" })
    .check();
  const raw = await paint(page);
  for (const modifier of ["Alt", "Meta", "Control"]) {
    await page.keyboard.down(modifier);
    await click(page, 62, 63);
    await page.keyboard.up(modifier);
    expect(await paint(page)).toEqual(raw);
  }
  await move(page, 62, 63);
  await page.mouse.click(
    (await point(page, 62, 63)).x,
    (await point(page, 62, 63)).y,
    { button: "right" },
  );
  await host.dispatchEvent("pointerdown", {
    button: 0,
    isPrimary: false,
    pointerId: 99,
    clientX: (await point(page, 62, 63)).x,
    clientY: (await point(page, 62, 63)).y,
  });
  for (const button of ["middle", "left"] as const) {
    await host.focus();
    if (button === "left") await page.keyboard.down("Space");
    await clickWithButton();
    if (button === "left") await page.keyboard.up("Space");
    async function clickWithButton() {
      await move(page, 62, 63);
      await page.mouse.down({ button });
      await page.mouse.up({ button });
    }
  }
  expect(await paint(page)).toEqual(raw);
  const input = page.locator("main").getByLabel("Hex color", { exact: true });
  await input.focus();
  await input.press("e");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.activeTool.getSnapshot(),
    ),
  ).toBe("eyedropper");
  await host.focus();
  await host.press("e");
  await host.press("]");
  const size = page.locator("main").getByLabel("Eraser size", { exact: true });
  await expect(size).toHaveValue("2");
  await move(page, 62, 63);
  await page.mouse.down();
  await host.press("]");
  await page.mouse.up();
  expect(await state(page)).toEqual(before);
  await expect(size).toHaveValue("3");
  await host.press("b");
  await expect(
    page.locator("main").getByLabel("Pencil size", { exact: true }),
  ).toHaveValue("3");
  await host.press("d");
  await host.press("f");
  await expect(action(page, "Eyedropper")).toBeDisabled();
  await host.click();
  expect(await paint(page)).toEqual(raw);
  expect(await state(page)).toEqual(before);
  await page.setViewportSize({ width: 640, height: 452 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(false);
});
