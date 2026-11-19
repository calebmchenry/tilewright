import { expect, test, type Page } from "@playwright/test";

const action = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
async function setup(page: Page, fixture = "fill") {
  await page.goto(`/tests/editor.html?fixture=${fixture}`);
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  return page.locator(".canvas-host");
}
async function point(page: Page, x: number, y: number) {
  const b = (await page.locator(".canvas-host").boundingBox())!,
    view = await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    );
  return {
    x: b.x + 24 + (x + 0.5 - view.x) * 24 * view.zoom,
    y: b.y + 24 + (y + 0.5 - view.y) * 24 * view.zoom,
  };
}
const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      history: s.history.state,
      version: s.document.version,
      storage: s.document.storageStats(),
      bounds: s.document.bounds,
      registry: s.document.registryEntries,
      invalidations: window.editorProbe.invalidations.length,
    };
  });
for (const dpr of [1, 2])
  test(`shipping fill click, exact identity and visual undo/redo at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1200, height: 800 },
      }),
      page = await context.newPage();
    const host = await setup(page),
      canvas = host.locator("canvas");
    await host.press("g");
    const before = await state(page),
      beforePixels = await canvas.screenshot({
        path: info.outputPath("before.png"),
      });
    await expect(action(page, "Fill")).toHaveAttribute("aria-pressed", "true");
    const p = await point(page, 64, 63);
    await page.mouse.click(p.x, p.y);
    await expect(action(page, "Undo Fill")).toBeEnabled();
    await expect(
      page.getByRole("status", { name: "Fill progress" }),
    ).toHaveCount(0);
    const after = await state(page),
      afterPixels = await canvas.screenshot({
        path: info.outputPath(`fill-dpr${dpr}.png`),
      });
    expect(after.history.undoSteps).toBe(1);
    expect(after.invalidations).toBe(1);
    expect(after.runs.filter((r) => r.layerId === "buildings")).toEqual([
      {
        layerId: "buildings",
        x: 60,
        y: 63,
        length: 8,
        value: { kind: "raw", rgba: "#ff0000ff" },
      },
    ]);
    expect(after.runs.filter((r) => r.layerId === "terrain")).toEqual(
      before.runs.filter((r) => r.layerId === "terrain"),
    );
    expect(afterPixels).not.toEqual(beforePixels);
    await host.press("ControlOrMeta+z");
    expect((await state(page)).runs).toEqual(before.runs);
    expect(
      await canvas.screenshot({ path: info.outputPath("undo.png") }),
    ).toEqual(beforePixels);
    await host.press("ControlOrMeta+Shift+z");
    expect((await state(page)).runs).toEqual(after.runs);
    expect(await canvas.screenshot()).toEqual(afterPixels);
    await page.mouse.click(p.x, p.y);
    await expect(
      page.getByRole("status", { name: "Fill progress" }),
    ).toHaveCount(0);
    expect(await state(page)).toEqual({
      ...after,
      version: after.version + 2,
      invalidations: 3,
    });
    await action(page, "Paint with Grass").click();
    await page.mouse.click(p.x, p.y);
    await expect
      .poll(async () => (await state(page)).history.undoSteps)
      .toBe(2);
    expect((await state(page)).runs).toEqual(before.runs);
    await context.close();
  });

test("fill gates, no outside clamping, native text keys, and narrow layout", async ({
  page,
}) => {
  const host = await setup(page),
    before = await state(page);
  await page.locator("main").getByLabel("Hex color", { exact: true }).fill("g");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.activeTool.getSnapshot(),
    ),
  ).toBe("inspect");
  await host.press("g");
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: -70, y: -70, zoom: 1 }),
  );
  const p = await point(page, -68, -68);
  await page.mouse.click(p.x, p.y);
  expect(await state(page)).toEqual(before);
  await page.evaluate(() =>
    window.editorProbe.session.setLayerVisible(
      window.editorProbe.session.activeLayer.getSnapshot(),
      false,
    ),
  );
  await expect(action(page, "Fill")).toBeDisabled();
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.setLayerVisible(s.activeLayer.getSnapshot(), true);
    s.setZoom(0.1);
  });
  await expect(action(page, "Fill")).toBeDisabled();
  await page.setViewportSize({ width: 640, height: 452 });
  await host.press("0");
  await expect(action(page, "Fill")).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Escape and Cancel discard a running background fill while navigation and narrow controls remain usable", async ({
  page,
}, info) => {
  const host = await setup(page);
  await page.evaluate(() =>
    window.editorProbe.session.growCanvas({
      left: 0,
      top: 0,
      right: 90,
      bottom: 90,
    }),
  );
  const before = await state(page);
  for (const cancel of ["escape", "button"] as const) {
    if (cancel === "button")
      await page.setViewportSize({ width: 640, height: 452 });
    await host.press("g");
    const p = await point(page, 56, 56);
    await page.mouse.click(p.x, p.y);
    await expect(
      page.getByRole("status", { name: "Fill progress" }),
    ).toBeVisible();
    expect(await state(page)).toEqual(before);
    if (cancel === "escape") {
      await host.press("ArrowRight");
      await host.press("Escape");
      await page.evaluate(() =>
        window.editorProbe.session.viewport.set({ x: 55, y: 55, zoom: 1 }),
      );
    } else {
      await page.screenshot({ path: info.outputPath("narrow-progress.png") });
      await page
        .getByRole("button", { name: "Cancel fill", exact: true })
        .click();
    }
    await expect(
      page.getByRole("status", { name: "Fill progress" }),
    ).toHaveCount(0);
    expect(await state(page)).toEqual(before);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
