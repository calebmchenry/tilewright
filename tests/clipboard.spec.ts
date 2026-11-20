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
  test(`layered house copy/paste preview, repeated placement and recolor preserve identities at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
        deviceScaleFactor: dpr,
        viewport: { width: 1400, height: 900 },
      }),
      page = await context.newPage();
    await setup(page);
    // Raw color matching the named wall remains raw after recolor.
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      s.execute("Raw furniture", [
        {
          kind: "tiles",
          writes: [
            {
              layerId: s.document.layers[2].id,
              x: 62,
              y: 62,
              length: 1,
              value: { kind: "raw", rgba: "#b18b4dff" },
            },
          ],
        },
      ]);
    });
    const original = await content(page),
      before = await persistent(page);
    await button(page, "Copy").click();
    expect(await persistent(page)).toEqual(before);
    await page
      .locator("main")
      .getByLabel("Layer name: Terrain", { exact: true })
      .click();
    await move(page, 70, 60);
    await host(page).press("Control+v");
    expect((await preview(page))!.bounds).toEqual({
      minX: 70,
      minY: 60,
      maxX: 78,
      maxY: 68,
    });
    expect(await persistent(page)).toEqual(before);
    await expect(button(page, "Copy")).toBeDisabled();
    await expect(button(page, "Cut")).toBeDisabled();
    expect(
      await pixels(page, [
        [60, 60],
        [70, 60],
        [70, 61],
        [71, 61],
        [74, 61],
        [70, 66],
      ]),
    ).toEqual([
      [177, 139, 77, 255],
      [177, 139, 77, 255],
      [170, 187, 204, 255],
      [221, 238, 255, 255],
      [177, 139, 77, 255],
      [255, 0, 0, 255],
    ]);
    await host(page).screenshot({
      path: info.outputPath(`paste-preview-${dpr}.png`),
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    expect(await persistent(page)).toEqual(before);
    await page.keyboard.press("Enter");
    const pasted = await content(page);
    expect((await persistent(page)).history.undoSteps).toBe(
      before.history.undoSteps + 1,
    );
    expect(pasted.annotations).toEqual(original.annotations);
    expect(pasted.runs.filter((r) => r.layerId === "terrain")).toEqual(
      original.runs.filter((r) => r.layerId === "terrain"),
    );
    // No cascade: same pointer and clipboard create an identical no-op placement.
    const first = await persistent(page);
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Enter");
    expect(await persistent(page)).toEqual(first);
    await page.keyboard.press("Control+v");
    await move(page, 80, 60);
    await page.mouse.down();
    await page.mouse.up();
    expect((await persistent(page)).history.undoSteps).toBe(
      first.history.undoSteps + 1,
    );
    await host(page).press("Control+z");
    expect(await content(page)).toEqual(pasted);
    await host(page).press("Control+z");
    expect(await content(page)).toEqual(original);
    await host(page).press("Control+Shift+z");
    expect(await content(page)).toEqual(pasted);
    // Actual registry Edit control, then framebuffer verification on both copies.
    await page
      .locator("main")
      .getByRole("button", { name: "Edit Stone", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Named color hex", { exact: true }).fill("#112233");
    await dialog
      .getByRole("button", { name: "Edit named color", exact: true })
      .click();
    await button(page, "Paste").click(); // preview uses current entry; original anchor fallback
    await host(page).focus();
    await move(page, 70, 60);
    expect(
      await pixels(page, [
        [60, 60],
        [70, 60],
        [62, 62],
        [72, 62],
      ]),
    ).toEqual([
      [17, 34, 51, 255],
      [17, 34, 51, 255],
      [177, 139, 77, 255],
      [177, 139, 77, 255],
    ]);
    await page.keyboard.press("Escape");
    const identities = await page.evaluate(() => {
      const doc = window.editorProbe.session.document,
        wall = doc.layers[1].id,
        furnishing = doc.layers[2].id;
      return [
        doc.getCell(wall, 60, 60),
        doc.getCell(wall, 70, 60),
        doc.getCell(furnishing, 72, 62),
        doc.getCell(furnishing, 74, 61),
      ];
    });
    expect(identities).toEqual([
      { kind: "registered", registryId: "stone" },
      { kind: "registered", registryId: "stone" },
      { kind: "raw", rgba: "#b18b4dff" },
      { kind: "raw", rgba: "#00000000" },
    ]);
    await context.close();
  });

test("cut then cancel remains cut, invalid boundaries remain adjustable, pointer reset and panel Apply/Cancel are explicit", async ({
  page,
}) => {
  await setup(page);
  const original = await content(page);
  await host(page).press("Control+x");
  const cut = await persistent(page);
  expect(cut.history.undoLabel).toBe("Cut");
  await host(page).press("Control+v");
  await page.keyboard.press("Escape");
  expect(await persistent(page)).toEqual(cut);
  await expect(page.getByTestId("selection-dimensions")).toContainText("8 × 8");
  await button(page, "Paste").click();
  await button(page, "Cancel paste").press("Enter");
  expect(await preview(page)).toBeNull();
  await host(page).press("Control+z");
  expect(await content(page)).toEqual(original);
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 120, y: 120, zoom: 1 }),
  );
  await move(page, 130, 132);
  await host(page).press("Control+v");
  await expect(
    page.getByRole("status", { name: "Selection preview" }),
  ).toContainText("entire pasted rectangle");
  const before = await persistent(page);
  await page.keyboard.press("Enter");
  expect(await persistent(page)).toEqual(before);
  expect(await preview(page)).not.toBeNull();
  await expect(button(page, "Apply paste")).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  expect((await preview(page))!.bounds.minX).toBe(129);
  await page.keyboard.press("Control+v");
  expect((await preview(page))!.bounds.minX).toBe(130);
  await move(page, 123, 125);
  await expect(button(page, "Apply paste")).toBeEnabled();
  await button(page, "Apply paste").click();
  expect((await persistent(page)).history.undoLabel).toBe("Paste");
  expect(
    await page.evaluate(
      () => window.editorProbe.session.selection.state.getSnapshot()!.bounds,
    ),
  ).toEqual({ minX: 123, minY: 125, maxX: 131, maxY: 133 });
});

test("paste cancellation preserves clipboard, stale layers reject and native text clipboard is not overridden", async ({
  page,
  context,
}) => {
  await setup(page);
  await button(page, "Copy").click();
  const before = await persistent(page);
  for (const cause of [
    "blur",
    "cancel",
    "capture",
    "space",
    "tool",
    "resize",
  ]) {
    await button(page, "Paste").click();
    expect(await preview(page)).not.toBeNull();
    if (cause === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (cause === "cancel")
      await host(page).dispatchEvent("pointercancel", {
        pointerId: 1,
        isPrimary: true,
      });
    if (cause === "capture")
      await host(page).dispatchEvent("lostpointercapture", {
        pointerId: 1,
        isPrimary: true,
      });
    if (cause === "space") await host(page).press("Space");
    if (cause === "tool") await host(page).press("h");
    if (cause === "resize")
      await page.setViewportSize({ width: 1100, height: 780 });
    await expect.poll(() => preview(page)).toBeNull();
    expect(await persistent(page)).toEqual(before);
  }
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.removeLayer(s.document.layers[2].id, true);
  });
  await expect(button(page, "Paste")).toBeDisabled();
  await expect(panel(page)).toContainText("missing");
  await host(page).press("Control+z");
  await expect(button(page, "Paste")).toBeEnabled();
  const state = await persistent(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("abcdef"));
  const input = page.locator("main").getByLabel("Hex color", { exact: true });
  await input.fill("123456");
  await input.selectText();
  await input.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "123456",
  );
  await input.press("ControlOrMeta+x");
  await expect(input).toHaveValue("");
  await input.press("ControlOrMeta+v");
  await expect(input).toHaveValue("123456");
  expect(await persistent(page)).toEqual(state);
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.contentEditable = "true";
    el.id = "native-edit";
    el.textContent = "Native text";
    document.querySelector("main")!.append(el);
  });
  const editable = page.locator("#native-edit");
  await editable.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+x");
  await expect(editable).toHaveText("");
  await page.keyboard.press("ControlOrMeta+v");
  await expect(editable).toHaveText("Native text");
  expect(await persistent(page)).toEqual(state);
  await page.setViewportSize({ width: 640, height: 452 });
  await button(page, "Paste").click();
  await button(page, "Cancel paste").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
