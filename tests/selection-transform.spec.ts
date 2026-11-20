import { expect, test, type Page } from "@playwright/test";
const host = (page: Page) => page.locator(".canvas-host");
const panel = (page: Page) =>
  page.getByRole("region", { name: "Tile selection", exact: true });
const button = (page: Page, name: string) =>
  panel(page).getByRole("button", { name, exact: true });
async function move(page: Page, x: number, y: number) {
  const box = (await host(page).boundingBox())!;
  const v = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await page.mouse.move(
    box.x + 24 + (x + 0.5 - v.x) * 24 * v.zoom,
    box.y + 24 + (y + 0.5 - v.y) * 24 * v.zoom,
  );
}
async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=selection-move");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await host(page).press("v");
  await move(page, 67, 65);
  await page.mouse.down();
  await move(page, 60, 60);
  await page.mouse.up();
  await page
    .getByRole("checkbox", {
      name: "Include Furniture",
      exact: true,
    })
    .check();
}
const content = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      bounds: s.document.bounds,
      layers: s.document.layers,
      registry: s.document.registryEntries,
      annotations: s.document.annotations,
    };
  });
const persistent = async (page: Page) => ({
  ...(await content(page)),
  ...(await page.evaluate(() => ({
    version: window.editorProbe.session.document.version,
    history: window.editorProbe.session.history.state,
    invalidations: window.editorProbe.invalidations.length,
  }))),
});
const preview = (page: Page) =>
  page.evaluate(() =>
    window.editorProbe.session.selection.preview.getSnapshot(),
  );
async function pixels(page: Page, positions: number[][]) {
  return page.evaluate((positions) => {
    const s = window.editorProbe.session,
      v = s.viewport.getSnapshot();
    const canvas = document.querySelector<HTMLCanvasElement>(
        ".canvas-host canvas",
      )!,
      gl = canvas.getContext("webgl2")!;
    // Synchronous redraw before reading a non-preserved drawing buffer.
    const p = s.selection.preview.getSnapshot();
    if (p) s.selection.preview.set({ ...p });
    else s.selection.state.set({ ...s.selection.state.getSnapshot()! });
    return positions.map(([x, y]) => {
      const data = new Uint8Array(4);
      gl.readPixels(
        Math.floor((24 + (x + 0.5 - v.x) * 24 * v.zoom) * devicePixelRatio),
        canvas.height -
          1 -
          Math.floor((24 + (y + 0.5 - v.y) * 24 * v.zoom) * devicePixelRatio),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      return [...data];
    });
  }, positions);
}
for (const dpr of [1, 2])
  test(`non-square multilayer house rotation, both flips, actual pixels and complete undo at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1400, height: 900 },
      }),
      page = await context.newPage();
    await setup(page);
    const original = await content(page),
      before = await persistent(page);
    // Layer checkbox focus can start a transform, then returns to the canvas.
    await page.keyboard.press("z");
    await expect(host(page)).toBeFocused();
    await expect(panel(page).getByTestId("selection-dimensions")).toHaveText(
      "6 × 8 tiles · 48 positions",
    );
    expect((await preview(page))!.bounds).toEqual({
      minX: 60,
      minY: 60,
      maxX: 66,
      maxY: 68,
    });
    expect(await persistent(page)).toEqual(before);
    expect(
      await pixels(page, [
        [64, 60],
        [64, 61],
        [64, 64],
        [67, 60],
        [70, 66],
      ]),
    ).toEqual([
      [170, 187, 204, 255],
      [221, 238, 255, 255],
      [177, 139, 77, 255],
      [51, 92, 70, 255],
      [255, 0, 0, 255],
    ]);
    await host(page).screenshot({ path: info.outputPath("house-rotate.png") });
    // Returning focus and moving the pointer do not move a live transform anchor.
    await move(page, 70, 70);
    await host(page).focus();
    expect((await preview(page))!.bounds.minX).toBe(60);
    await page.keyboard.press("Enter");
    expect((await persistent(page)).history.undoSteps).toBe(1);
    await host(page).press("x");
    expect(
      await pixels(page, [
        [61, 60],
        [65, 61],
        [64, 61],
        [67, 60],
      ]),
    ).toEqual([
      [170, 187, 204, 255],
      [170, 187, 204, 255],
      [221, 238, 255, 255],
      [51, 92, 70, 255],
    ]);
    await host(page).screenshot({
      path: info.outputPath("house-horizontal.png"),
    });
    await button(page, "Apply transform").click();
    await host(page).press("y");
    expect(
      await pixels(page, [
        [61, 67],
        [61, 66],
        [65, 66],
        [67, 60],
      ]),
    ).toEqual([
      [170, 187, 204, 255],
      [221, 238, 255, 255],
      [170, 187, 204, 255],
      [51, 92, 70, 255],
    ]);
    await host(page).screenshot({
      path: info.outputPath("house-vertical.png"),
    });
    await button(page, "Apply transform").press("Enter");
    expect((await persistent(page)).history.undoSteps).toBe(3);
    const transformed = await content(page);
    expect(transformed.annotations).toEqual(original.annotations);
    expect(transformed.registry).toEqual(original.registry);
    expect(transformed.runs.filter((r) => r.layerId === "terrain")).toEqual(
      original.runs.filter((r) => r.layerId === "terrain"),
    );
    for (let i = 0; i < 3; i++) await host(page).press("Control+z");
    expect(await content(page)).toEqual(original);
    expect((await persistent(page)).history.dirty).toBe(false);
    await host(page).screenshot({ path: info.outputPath("house-undone.png") });
    await context.close();
  });

test("composed transforms are exact preview identities; transformed paste resets and retains its stored clipboard", async ({
  page,
}) => {
  await setup(page);
  await host(page).press("ControlOrMeta+c");
  const before = await persistent(page),
    original = await content(page);
  for (const [key, count] of [
    ["z", 4],
    ["Shift+z", 4],
    ["x", 2],
    ["y", 2],
  ] as const) {
    for (let i = 0; i < count; i++) await host(page).press(key);
    await expect(panel(page).getByTestId("selection-dimensions")).toHaveText(
      "8 × 6 tiles · 48 positions",
    );
    await button(page, "Apply transform").click();
    expect(await persistent(page)).toEqual(before);
  }
  await host(page).press("ControlOrMeta+v");
  await move(page, 70, 70);
  await host(page).press("z");
  expect((await preview(page))!.bounds).toEqual({
    minX: 70,
    minY: 70,
    maxX: 76,
    maxY: 78,
  });
  await host(page).press("y");
  await button(page, "Apply paste").click();
  expect((await persistent(page)).history.undoLabel).toBe("Paste");
  await host(page).press("ControlOrMeta+v");
  await expect(panel(page).getByTestId("selection-dimensions")).toHaveText(
    "8 × 6 tiles · 48 positions",
  );
  await button(page, "Cancel paste").press("Enter");
  expect(await preview(page)).toBeNull();
  await host(page).press("Control+z");
  expect(await content(page)).toEqual(original);
  expect((await persistent(page)).history.undoSteps).toBe(0);
});

test("invalid edge rotation can be corrected with arrows; cancellation, controls, text and minimum-window layout", async ({
  page,
}) => {
  await setup(page);
  const before = await persistent(page);
  for (const cause of [
    "escape",
    "button",
    "blur",
    "capture",
    "cancel",
    "space",
    "resize",
  ]) {
    await host(page).press("z");
    if (cause === "escape")
      await button(page, "Apply transform").press("Escape");
    if (cause === "button")
      await button(page, "Cancel transform").press("Enter");
    if (cause === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (cause === "capture")
      await host(page).dispatchEvent("lostpointercapture", {
        pointerId: 1,
        isPrimary: true,
      });
    if (cause === "cancel")
      await host(page).dispatchEvent("pointercancel", {
        pointerId: 1,
        isPrimary: true,
      });
    if (cause === "space") await host(page).press("Space");
    if (cause === "resize")
      await page.setViewportSize({ width: 1100, height: 780 });
    await expect.poll(() => preview(page)).toBeNull();
    expect(await persistent(page)).toEqual(before);
  }
  // An empty edge-adjacent 3x2 still rejects its third row after rotation.
  await host(page).press("Escape");
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 120, y: 120, zoom: 1 }),
  );
  await move(page, 128, 131);
  await page.mouse.down();
  await move(page, 130, 132);
  await page.mouse.up();
  await host(page).press("z");
  await expect(button(page, "Apply transform")).toBeDisabled();
  await expect(
    page.getByRole("status", { name: "Selection preview" }),
  ).toContainText("entire selection");
  await host(page).press("Enter");
  expect(await persistent(page)).toEqual(before);
  expect(await preview(page)).not.toBeNull();
  await host(page).press("ArrowUp");
  await expect(button(page, "Apply transform")).toBeEnabled();
  await button(page, "Apply transform").click();
  expect(await persistent(page)).toEqual(before);
  await expect(panel(page).getByTestId("selection-bounds")).toContainText(
    "Y [130, 133)",
  );
  await page.setViewportSize({ width: 640, height: 452 });
  await host(page).press("x");
  await button(page, "Apply transform").scrollIntoViewIfNeeded();
  await expect(button(page, "Apply transform")).toBeInViewport();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  const input = page.locator("main").getByLabel("Hex color", { exact: true });
  await input.focus();
  await input.press("Enter");
  expect(await preview(page)).not.toBeNull();
  expect(await persistent(page)).toEqual(before);
  await button(page, "Cancel transform").click();
  expect(await preview(page)).toBeNull();
});
