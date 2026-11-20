import { expect, test, type Page } from "@playwright/test";

const action = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
const panel = (page: Page) =>
  page.getByRole("region", { name: "Tile selection", exact: true });
const include = (page: Page, name: string) =>
  panel(page).getByRole("checkbox", {
    name: `Include ${name}`,
    exact: true,
  });
async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=selection");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const host = page.locator(".canvas-host");
  await host.press("v");
  await expect(action(page, "Select")).toHaveAttribute("aria-pressed", "true");
  return host;
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
async function selectHouse(page: Page) {
  await move(page, 67, 67);
  await page.mouse.down();
  await move(page, 60, 60);
  await page.mouse.up();
}
const persistent = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      bounds: s.document.bounds,
      layers: s.document.layers,
      annotations: s.document.annotations,
      registry: s.document.registryEntries,
      version: s.document.version,
      history: s.history.state,
      invalidations: window.editorProbe.invalidations.length,
    };
  });
const selected = (page: Page) =>
  page.evaluate(() => window.editorProbe.session.selection.state.getSnapshot());
const candidate = (page: Page) =>
  page.evaluate(() =>
    window.editorProbe.session.selection.preview.getSnapshot(),
  );

for (const dpr of [1, 2])
  test(`reverse 8x8 cross-chunk selection, exact overlay and explicit walls/furniture scope at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1200, height: 800 },
      }),
      page = await context.newPage();
    const host = await setup(page),
      canvas = host.locator("canvas");
    const before = await persistent(page),
      original = await canvas.screenshot({
        path: info.outputPath("original.png"),
      });
    await move(page, 67, 67);
    await page.mouse.down();
    await move(page, 60, 60);
    expect((await candidate(page))!.bounds).toEqual({
      minX: 60,
      minY: 60,
      maxX: 68,
      maxY: 68,
    });
    await expect(page.getByTestId("selection-dimensions")).toHaveText(
      "8 × 8 tiles · 64 positions",
    );
    expect(await persistent(page)).toEqual(before);
    await page.mouse.up();
    await expect(page.getByTestId("selection-bounds")).toHaveText(
      "X [60, 68) · Y [60, 68) · end excluded",
    );
    await expect(include(page, "Walls")).toBeChecked();
    await expect(include(page, "Walls")).toBeDisabled();
    await expect(include(page, "Terrain")).not.toBeChecked();
    await expect(panel(page).getByRole("button")).toHaveCount(0);
    await expect(include(page, "Walls").locator("..")).toHaveText(
      "Walls64 occupied",
    );
    await include(page, "Furniture").check();
    await expect(include(page, "Furniture").locator("..")).toHaveText(
      "Furniture3 occupied",
    );
    await page
      .locator("main")
      .getByLabel("Layer name: Terrain", { exact: true })
      .click();
    expect((await selected(page))!.layers.map((l) => l.layerId)).toEqual([
      "walls",
      "furniture",
    ]);
    expect((await selected(page))!.layers.map((l) => l.occupiedCount)).toEqual([
      64, 3,
    ]);
    expect(await persistent(page)).toEqual(before);
    const overlay = await canvas.screenshot({
      path: info.outputPath(`selection-dpr${dpr}.png`),
    });
    expect(overlay).not.toEqual(original);
    // Read actual framebuffer pixels at all four rectangle edges and just outside.
    const pixels = await page.evaluate(() => {
      const s = window.editorProbe.session,
        v = s.viewport.getSnapshot();
      const canvas = document.querySelector<HTMLCanvasElement>(
          ".canvas-host canvas",
        )!,
        gl = canvas.getContext("webgl2")!;
      s.viewport.set({ ...v, x: v.x + 0.001 });
      s.viewport.set(v);
      const read = (x: number, y: number) => {
        const data = new Uint8Array(4),
          scale = devicePixelRatio;
        gl.readPixels(
          Math.floor((24 + (x - v.x) * 24 * v.zoom) * scale),
          canvas.height -
            1 -
            Math.floor((24 + (y - v.y) * 24 * v.zoom) * scale),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data,
        );
        return [...data];
      };
      return [
        read(60, 62.5),
        read(68, 62.5),
        read(62.5, 60),
        read(62.5, 68),
        read(59.5, 62.5),
        read(68.5, 62.5),
      ];
    });
    for (const pixel of pixels.slice(0, 4))
      expect(pixel).toEqual([135, 223, 255, 255]);
    for (const pixel of pixels.slice(4))
      expect(pixel).toEqual([51, 92, 70, 255]);
    await host.press("h");
    expect(await selected(page)).not.toBeNull();
    await host.press("i");
    expect(await selected(page)).not.toBeNull();
    await host.press("v");
    await page.screenshot({
      path: info.outputPath(`selection-controls-dpr${dpr}.png`),
    });
    await host.press("Escape");
    expect(await selected(page)).toBeNull();
    // Restore keyboard focus-visible styling before comparing complete pixels.
    await host.press("v");
    expect(
      await canvas.screenshot({ path: info.outputPath("deselected.png") }),
    ).toEqual(original);
    expect(await persistent(page)).toEqual(before);
    await context.close();
  });

test("selection creation clips each map edge, captures outside-host releases and supports one-cell/empty rectangles", async ({
  page,
}) => {
  const host = await setup(page),
    before = await persistent(page);
  for (const [x, y, endX, endY, viewX, viewY, expected] of [
    [
      -58,
      -58,
      -1000,
      -1000,
      -70,
      -70,
      { minX: -65, minY: -65, maxX: -57, maxY: -57 },
    ],
    [
      123,
      125,
      1000,
      1000,
      120,
      122,
      { minX: 123, minY: 125, maxX: 131, maxY: 133 },
    ],
  ] as const) {
    await page.evaluate(
      ({ x, y }) => window.editorProbe.session.viewport.set({ x, y, zoom: 1 }),
      { x: viewX, y: viewY },
    );
    await move(page, x, y);
    await page.mouse.down();
    const end = await point(page, endX, endY);
    // Real pointer capture, release endpoint outside host supplied without a move.
    await host.dispatchEvent("pointerup", {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: end.x,
      clientY: end.y,
    });
    await page.mouse.up();
    expect((await selected(page))!.bounds).toEqual(expected);
    expect((await selected(page))!.tileCount).toBe(64);
    expect((await selected(page))!.layers[0].occupiedCount).toBe(0);
    await host.press("Escape");
  }
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 125, y: 127, zoom: 1 }),
  );
  await move(page, 130, 132);
  await page.mouse.click(
    (await point(page, 130, 132)).x,
    (await point(page, 130, 132)).y,
  );
  expect((await selected(page))!.tileCount).toBe(1);
  const single = await selected(page);
  await move(page, 131, 132);
  await page.mouse.down();
  await page.mouse.up();
  expect(await selected(page)).toEqual(single);
  await host.press("Escape");
  await move(page, 130, 132);
  await page.mouse.down();
  const box = (await host.boundingBox())!;
  await page.mouse.move(box.x + box.width + 10, box.y + box.height + 10);
  await page.mouse.up();
  expect((await selected(page))!.bounds).toEqual(single!.bounds);
  expect(await persistent(page)).toEqual(before);
});

test("Escape, capture loss, blur, missing buttons and context changes cancel replacement while preserving the previous selection", async ({
  page,
}) => {
  const host = await setup(page);
  await selectHouse(page);
  await include(page, "Furniture").check();
  const previous = await selected(page),
    before = await persistent(page);
  for (const reason of [
    "escape",
    "cancel",
    "capture",
    "blur",
    "buttons",
    "layer",
    "camera",
    "tool",
    "space",
    "readiness",
    "resize",
    "capture-failure",
  ]) {
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      s.canvasState.set("ready");
      s.viewport.set({ x: 55, y: 55, zoom: 1 });
      s.perform("select");
    });
    await host.focus();
    if (reason === "capture-failure")
      await host.evaluate((el) => {
        el.setPointerCapture = () => {
          throw new Error("Test capture failure");
        };
      });
    await move(page, 56, 56);
    await page.mouse.down();
    await move(page, 58, 58);
    if (reason !== "capture-failure")
      expect(await candidate(page)).not.toBeNull();
    if (reason === "escape") await page.keyboard.press("Escape");
    if (reason === "cancel")
      await host.dispatchEvent("pointercancel", {
        pointerId: 1,
        isPrimary: true,
      });
    if (reason === "capture")
      await host.evaluate((el) => el.releasePointerCapture(1));
    if (reason === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (reason === "buttons")
      await host.dispatchEvent("pointermove", {
        pointerId: 1,
        isPrimary: true,
        buttons: 0,
      });
    if (reason === "layer")
      await page.evaluate(() =>
        window.editorProbe.session.selectLayer(
          window.editorProbe.session.document.layers[0].id,
        ),
      );
    if (reason === "camera")
      await page.evaluate(() => window.editorProbe.session.pan(24, 0));
    if (reason === "tool")
      await page.evaluate(() => window.editorProbe.session.perform("pan"));
    if (reason === "space") await page.keyboard.press("Space");
    if (reason === "readiness")
      await page.evaluate(() =>
        window.editorProbe.session.canvasState.set("loading"),
      );
    if (reason === "resize")
      await page.setViewportSize({ width: 1201, height: 801 });
    await page.mouse.up();
    expect(await candidate(page)).toBeNull();
    expect(await selected(page)).toEqual(previous);
    expect(await persistent(page)).toEqual(before);
  }
});

test("scope controls, text shortcuts, gates, painting and small-window layout respect selection lifetime", async ({
  page,
}) => {
  const host = await setup(page);
  await selectHouse(page);
  await include(page, "Furniture").check();
  await include(page, "Walls").uncheck();
  await expect(include(page, "Furniture")).toBeDisabled();
  await include(page, "Walls").check();
  await page
    .locator("main")
    .getByLabel("Layer name: Terrain", { exact: true })
    .click();
  await page
    .locator("main")
    .locator('.layer-row[data-active="true"] .layer-visibility-button')
    .click();
  await expect(include(page, "Terrain")).toBeDisabled();
  await expect(action(page, "Select")).toBeDisabled();
  expect((await selected(page))!.layers.map((l) => l.layerId)).toEqual([
    "furniture",
    "walls",
  ]);
  await page
    .locator("main")
    .getByLabel("Layer name: Furniture", { exact: true })
    .click();
  await page
    .locator("main")
    .locator('.layer-row[data-active="true"] .layer-visibility-button')
    .click();
  expect(await selected(page)).toBeNull();
  await expect(
    page.getByRole("status", { name: "Action feedback" }),
  ).toContainText("Selection cleared");
  await page
    .locator("main")
    .locator('.layer-row[data-active="true"] .layer-visibility-button')
    .click();
  expect(await selected(page)).toBeNull();
  await selectHouse(page);
  await page.setViewportSize({ width: 640, height: 452 });
  await include(page, "Walls").scrollIntoViewIfNeeded();
  await expect(include(page, "Walls")).toBeVisible();
  await expect(panel(page).getByRole("button")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth > innerWidth ||
        document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(false);
  await host.press("b");
  expect(await selected(page)).toBeNull();
  const input = page.locator("main").getByLabel("Hex color", { exact: true });
  await input.press("v");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.activeTool.getSnapshot(),
    ),
  ).toBe("pencil");
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 55, y: 55, zoom: 0.1 }),
  );
  await expect(action(page, "Select")).toBeDisabled();
  await host.press("v");
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.activeTool.getSnapshot(),
    ),
  ).toBe("pencil");
});
