import { expect, test, type Page } from "@playwright/test";

const host = (page: Page) => page.locator(".canvas-host");
const action = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=selection-move");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await host(page).press("v");
  await move(page, 67, 67);
  await page.mouse.down();
  await move(page, 60, 60);
  await page.mouse.up();
  await page
    .getByRole("checkbox", {
      name: "Include Furniture (furniture)",
      exact: true,
    })
    .check();
}
async function point(page: Page, x: number, y: number) {
  const box = (await host(page).boundingBox())!;
  const v = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  return {
    x: box.x + 24 + (x + 0.5 - v.x) * 24 * v.zoom,
    y: box.y + 24 + (y + 0.5 - v.y) * 24 * v.zoom,
  };
}
async function move(page: Page, x: number, y: number) {
  const p = await point(page, x, y);
  await page.mouse.move(p.x, p.y);
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
const selected = (page: Page) =>
  page.evaluate(() => window.editorProbe.session.selection.state.getSnapshot());
const preview = (page: Page) =>
  page.evaluate(() =>
    window.editorProbe.session.selection.preview.getSnapshot(),
  );

for (const dpr of [1, 2])
  test(`house drag three tiles previews exact composition and commits one reversible multilayer edit at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1200, height: 800 },
      }),
      page = await context.newPage();
    await setup(page);
    await action(page, "Terrain").click();
    const before = await persistent(page),
      original = await content(page);
    await move(page, 62, 62);
    await page.mouse.down();
    await move(page, 65, 62);
    const direct = await preview(page);
    await move(page, 63, 62);
    await move(page, 66, 62);
    await move(page, 65, 62);
    expect(await preview(page)).toEqual(direct);
    expect(await persistent(page)).toEqual(before);
    await expect(
      page.getByRole("status", { name: "Selection preview" }),
    ).toContainText("Move 3, 0 tiles");
    const pixels = await page.evaluate(() => {
      const s = window.editorProbe.session,
        v = s.viewport.getSnapshot();
      const canvas = document.querySelector<HTMLCanvasElement>(
          ".canvas-host canvas",
        )!,
        gl = canvas.getContext("webgl2")!;
      s.selection.preview.set({ ...s.selection.preview.getSnapshot()! });
      return [
        [60, 60],
        [69, 60],
        [63, 61],
        [64, 61],
        [67, 61],
        [70, 66],
      ].map(([x, y]) => {
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
    });
    expect(pixels).toEqual([
      [51, 92, 70, 255],
      [177, 139, 77, 255],
      [170, 187, 204, 255],
      [221, 238, 255, 255],
      [177, 139, 77, 255],
      [255, 0, 0, 255],
    ]);
    await host(page).screenshot({
      path: info.outputPath(`move-preview-dpr${dpr}.png`),
    });
    await page.mouse.up();
    expect((await selected(page))!.bounds).toEqual({
      minX: 63,
      minY: 60,
      maxX: 71,
      maxY: 68,
    });
    const after = await content(page),
      state = await persistent(page);
    expect(state.history.undoSteps).toBe(1);
    expect(state.history.undoLabel).toBe("Move selection");
    expect(state.invalidations).toBe(before.invalidations + 1);
    expect(after.annotations).toEqual(original.annotations);
    expect(after.bounds).toEqual(original.bounds);
    expect(after.runs.filter((r) => r.layerId === "terrain")).toEqual(
      original.runs.filter((r) => r.layerId === "terrain"),
    );
    expect(
      await page.evaluate(() => {
        const doc = window.editorProbe.session.document;
        return doc.layers.map((l) => [
          l.id,
          [...doc.iterateRuns(l.id)].reduce((n, r) => n + r.length, 0),
        ]);
      }),
    ).toEqual([
      ["terrain", 38808],
      ["walls", 64],
      ["furniture", 4],
    ]);
    await host(page).press("Control+z");
    expect(await content(page)).toEqual(original);
    expect(await selected(page)).toBeNull();
    await host(page).press("Control+Shift+z");
    expect(await content(page)).toEqual(after);
    await context.close();
  });

test("arrow repeats use independent history, Shift uses ten tiles, text/modifiers stay native and Space/middle navigation wins", async ({
  page,
}) => {
  await setup(page);
  const original = await content(page);
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await host(page).focus();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect((await selected(page))!.bounds.minX).toBe(63);
  expect((await persistent(page)).history.undoSteps).toBe(3);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual(view);
  await page.keyboard.press("Shift+ArrowDown");
  expect((await selected(page))!.bounds.minY).toBe(70);
  const before = await content(page),
    bounds = (await selected(page))!.bounds;
  for (const modifier of ["Alt", "Control", "Meta"])
    await page.keyboard.press(`${modifier}+ArrowLeft`);
  await page
    .locator("main")
    .getByLabel("Hex color", { exact: true })
    .press("ArrowLeft");
  expect(await content(page)).toEqual(before);
  expect((await selected(page))!.bounds).toEqual(bounds);
  await host(page).focus();
  await page.keyboard.down("Space");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Space");
  expect(await content(page)).toEqual(before);
  expect((await selected(page))!.bounds).toEqual(bounds);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).not.toEqual(view);
  await move(page, 64, 72);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(
    (await point(page, 64, 72)).x + 20,
    (await point(page, 64, 72)).y,
  );
  await page.mouse.up({ button: "middle" });
  expect(await content(page)).toEqual(before);
  for (let i = 0; i < 4; i++) await host(page).press("Control+z");
  expect(await content(page)).toEqual(original);
  for (let i = 0; i < 4; i++) await host(page).press("Control+Shift+z");
  expect(await content(page)).toEqual(before);
});

test("move cancellation, origin return, boundary rejection and empty selection movement leave persistent state intact", async ({
  page,
}) => {
  await setup(page);
  const before = await persistent(page),
    selection = await selected(page);
  for (const reason of [
    "escape",
    "cancel",
    "capture",
    "blur",
    "buttons",
    "space",
    "camera",
    "tool",
    "layer",
    "scope",
    "readiness",
    "resize",
    "origin",
  ]) {
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      s.canvasState.set("ready");
      s.viewport.set({ x: 55, y: 55, zoom: 1 });
      s.selectLayer(s.document.layers[1].id);
      s.perform("select");
    });
    await move(page, 62, 62);
    await page.mouse.down();
    await move(page, 65, 62);
    expect((await preview(page))!.move).toBeTruthy();
    if (reason === "escape") await page.keyboard.press("Escape");
    if (reason === "cancel")
      await host(page).dispatchEvent("pointercancel", {
        pointerId: 1,
        isPrimary: true,
      });
    if (reason === "capture")
      await host(page).evaluate((el) => el.releasePointerCapture(1));
    if (reason === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (reason === "buttons")
      await host(page).dispatchEvent("pointermove", {
        pointerId: 1,
        isPrimary: true,
        buttons: 0,
      });
    if (reason === "space") await page.keyboard.press("Space");
    if (reason === "camera")
      await page.evaluate(() => window.editorProbe.session.pan(24, 0));
    if (reason === "tool")
      await page.evaluate(() => window.editorProbe.session.perform("pan"));
    if (reason === "layer")
      await page.evaluate(() =>
        window.editorProbe.session.selectLayer(
          window.editorProbe.session.document.layers[0].id,
        ),
      );
    if (reason === "scope")
      await page.evaluate(() => {
        const s = window.editorProbe.session;
        s.selection.setIncluded(s.document.layers[2].id, false);
        s.selection.setIncluded(s.document.layers[2].id, true);
      });
    if (reason === "readiness")
      await page.evaluate(() =>
        window.editorProbe.session.canvasState.set("loading"),
      );
    if (reason === "resize")
      await page.setViewportSize({ width: 1201, height: 801 });
    if (reason === "origin") await move(page, 62, 62);
    await page.mouse.up();
    expect(await preview(page)).toBeNull();
    expect(await persistent(page), reason).toEqual(before);
    expect(await selected(page), reason).toEqual(selection);
  }
  // Right map edge, including all-hole extents: no clamp, growth or partial commit.
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.selection.deselect();
    s.viewport.set({ x: 120, y: 120, zoom: 1 });
  });
  await move(page, 123, 125);
  await page.mouse.down();
  await move(page, 130, 132);
  await page.mouse.up();
  const empty = await selected(page);
  await move(page, 125, 127);
  await page.mouse.down();
  await move(page, 126, 127);
  await expect(
    page.getByRole("status", { name: "Selection preview" }),
  ).toContainText("entire selection must fit");
  await host(page).screenshot({
    path: ".wrk-runs/wrk-9bab6495-validation/invalid-preview.png",
  });
  expect((await preview(page))!.bounds.maxX).toBe(132);
  await page.mouse.up();
  expect(await selected(page)).toEqual(empty);
  expect(await persistent(page)).toEqual(before);
  await host(page).press("ArrowRight");
  expect(await selected(page)).toEqual(empty);
  await host(page).press("ArrowLeft");
  expect((await selected(page))!.bounds.minX).toBe(122);
  expect(await persistent(page)).toEqual(before);
});

test("removing an included layer during movement cancels all layers while preserving a ready renderer", async ({
  page,
}) => {
  await setup(page);
  const before = await content(page);
  await move(page, 62, 62);
  await page.mouse.down();
  await move(page, 65, 62);
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.removeLayer(s.document.layers[2].id, true);
  });
  await page.mouse.up();
  expect(await preview(page)).toBeNull();
  expect(await selected(page)).toBeNull();
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  expect(
    (await content(page)).runs.filter((r) => r.layerId !== "furniture"),
  ).toEqual(before.runs.filter((r) => r.layerId !== "furniture"));
  expect((await persistent(page)).history.undoSteps).toBe(1);
  await host(page).press("Control+z");
  expect(await content(page)).toEqual(before);
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
});
