import { expect, test, type Page } from "@playwright/test";
import type { TileProbe } from "./tiles-harness";
declare global {
  interface Window {
    tileProbe: TileProbe;
  }
}

async function setup(page: Page) {
  await page.goto("/tests/editor.html?fixture=drawing");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await page
    .locator("main")
    .getByRole("button", { name: "Pencil", exact: true })
    .click();
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
async function persistent(page: Page) {
  return page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      runs: [...s.document.iterateRuns()],
      bounds: s.document.bounds,
      version: s.document.version,
      history: s.history.state,
      invalidations: window.editorProbe.invalidations,
    };
  });
}

for (const dpr of [1, 2])
  test(`drawing preview, rapid samples, release endpoint, one undo and saved state at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    const host = await setup(page);
    const before = await persistent(page);
    await move(page, 60, 63);
    await page.mouse.down();
    await move(page, 68, 63);
    expect(await persistent(page)).toEqual(before);
    expect(
      await host.evaluate((e) =>
        e.hasPointerCapture(window.editorProbe.session.drawing.pointerId!),
      ),
    ).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.editorProbe.session.drawing.preview.getSnapshot()?.writes
              .length,
        ),
      )
      .toBe(1);
    await page.screenshot({
      path: info.outputPath(`drawing-preview-dpr${dpr}.png`),
    });
    // An up at a new coordinate must be sampled even without a preceding move.
    const release = await point(page, 70, 63);
    await host.dispatchEvent("pointerup", {
      pointerId: 1,
      isPrimary: true,
      button: 0,
      clientX: release.x,
      clientY: release.y,
    });
    await page.mouse.up();
    const after = await persistent(page);
    expect(after.history.undoSteps).toBe(1);
    expect(after.history.dirty).toBe(true);
    expect(after.invalidations).toHaveLength(1);
    expect(after.invalidations[0].regions).toEqual([
      { layerId: "buildings", minX: 60, minY: 63, maxX: 68, maxY: 64 },
      { layerId: "buildings", minX: 68, minY: 63, maxX: 71, maxY: 64 },
    ]);
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.drawing.preview.getSnapshot(),
      ),
    ).toBeNull();
    await host.press("ControlOrMeta+z");
    expect((await persistent(page)).runs).toEqual(before.runs);
    expect((await persistent(page)).history.dirty).toBe(false);
    await host.press("ControlOrMeta+Shift+z");
    expect((await persistent(page)).runs).toEqual(after.runs);
    await context.close();
  });

test("pointer cancel, capture loss, Escape, blur and context changes discard previews and release capture", async ({
  page,
}) => {
  const host = await setup(page);
  for (const reason of [
    "pointercancel",
    "capture",
    "escape",
    "window-blur",
    "focus",
    "tool",
    "camera",
    "hidden",
    "resize",
    "edit",
  ] as const) {
    await page.evaluate(() => {
      const s = window.editorProbe.session;
      s.setLayerVisible(s.activeLayer.getSnapshot(), true);
      s.viewport.set({ x: 55, y: 55, zoom: 1 });
      s.perform("pencil");
    });
    const before = await persistent(page);
    await move(page, 60, 63);
    await page.mouse.down();
    await move(page, 68, 63);
    const id = await page.evaluate(
      () => window.editorProbe.session.drawing.pointerId!,
    );
    if (reason === "pointercancel")
      await host.dispatchEvent("pointercancel", { pointerId: id });
    if (reason === "capture") {
      await host.evaluate((e, id) => e.releasePointerCapture(id), id);
      await move(page, 69, 63);
    }
    if (reason === "escape") await page.keyboard.press("Escape");
    if (reason === "window-blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (reason === "focus")
      await page
        .locator("main")
        .getByLabel("Layer name", { exact: true })
        .focus();
    if (reason === "tool")
      await page.evaluate(() => window.editorProbe.session.perform("inspect"));
    if (reason === "camera")
      await page.evaluate(() => window.editorProbe.session.setZoom(0.1));
    if (reason === "hidden")
      await page.evaluate(() => {
        const s = window.editorProbe.session;
        s.setLayerVisible(s.activeLayer.getSnapshot(), false);
      });
    if (reason === "resize")
      await page.setViewportSize({ width: 1100, height: 740 });
    if (reason === "edit")
      await page.evaluate(() => {
        const s = window.editorProbe.session;
        s.renameLayer(s.activeLayer.getSnapshot(), "Renamed");
      });
    await expect
      .poll(() =>
        page.evaluate(() => window.editorProbe.session.drawing.pointerId),
      )
      .toBeNull();
    expect(await host.evaluate((e, id) => e.hasPointerCapture(id), id)).toBe(
      false,
    );
    await page.mouse.up();
    const after = await persistent(page);
    expect(after.runs).toEqual(before.runs);
    if (reason !== "edit") expect(after).toEqual(before);
    else expect(after.history.undoSteps).toBe(before.history.undoSteps + 1);
  }
});

test("captured canvas exit commits clipped edge cells; outside-only and same-color clicks are no-ops", async ({
  page,
}) => {
  const host = await setup(page);
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 125, y: 125, zoom: 1 }),
  );
  const before = await persistent(page);
  await move(page, 129, 130);
  await page.mouse.down();
  const box = (await host.boundingBox())!;
  const y = (await point(page, 130, 130)).y;
  await page.mouse.move(box.x + box.width + 80, y);
  expect(await persistent(page)).toEqual(before);
  expect(await host.evaluate((e) => e.hasPointerCapture(1))).toBe(true);
  await page.mouse.up();
  const after = await persistent(page);
  expect(after.bounds).toEqual(before.bounds);
  expect(after.history.undoSteps).toBe(1);
  expect(after.invalidations[0].regions).toEqual([
    { layerId: "buildings", minX: 129, minY: 130, maxX: 131, maxY: 131 },
  ]);
  await move(page, 130, 130);
  await page.mouse.down();
  await page.mouse.up();
  expect(await persistent(page)).toEqual(after);
  await host.press("ControlOrMeta+z");
  const undone = await persistent(page);
  await move(page, 133, 130);
  await page.mouse.down();
  await page.mouse.up();
  expect(await persistent(page)).toEqual(undone);
  // Begin in outside map margin, then enter a negative edge. Do not clamp to -65.
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: -70, y: -5, zoom: 1 }),
  );
  await move(page, -68, 0);
  await page.mouse.down();
  await move(page, -63, 0);
  await page.mouse.up();
  expect((await persistent(page)).invalidations.at(-1)?.regions).toEqual([
    { layerId: "buildings", minX: -65, minY: 0, maxX: -62, maxY: 1 },
  ]);
});

test("navigation, panel/text input, nonprimary pointers and overview are isolated from drawing", async ({
  page,
}) => {
  const host = await setup(page),
    before = await persistent(page);
  const input = page.locator("main").getByLabel("Layer name", { exact: true });
  await input.focus();
  await input.press("Space");
  const box = (await input.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await move(page, 62, 63);
  await page.mouse.up();
  expect(await persistent(page)).toEqual(before);
  for (const kind of ["space", "middle", "pan"] as const) {
    if (kind === "pan")
      await page.evaluate(() => window.editorProbe.session.perform("pan"));
    await host.focus();
    if (kind === "space") await page.keyboard.down("Space");
    await move(page, 62, 63);
    await page.mouse.down({ button: kind === "middle" ? "middle" : "left" });
    await page.mouse.move(
      (await point(page, 62, 63)).x + 48,
      (await point(page, 62, 63)).y,
    );
    await page.mouse.up({ button: kind === "middle" ? "middle" : "left" });
    if (kind === "space") await page.keyboard.up("Space");
    expect(await persistent(page)).toEqual(before);
  }
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.viewport.set({ x: 55, y: 55, zoom: 1 });
    s.perform("pencil");
  });
  await move(page, 62, 63);
  await page.mouse.down();
  const preview = await page.evaluate(() =>
    window.editorProbe.session.drawing.preview.getSnapshot(),
  );
  await host.dispatchEvent("pointercancel", {
    pointerId: 99,
    isPrimary: false,
  });
  await host.dispatchEvent("pointermove", {
    pointerId: 99,
    isPrimary: false,
    buttons: 1,
    clientX: 0,
    clientY: 0,
  });
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.drawing.preview.getSnapshot(),
    ),
  ).toEqual(preview);
  const view = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await host.dispatchEvent("wheel", { deltaY: 100, ctrlKey: true });
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    ),
  ).toEqual(view);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await host.press("f");
  await expect(
    page.locator("main").getByRole("button", { name: "Pencil", exact: true }),
  ).toBeDisabled();
  await host.click();
  expect(await persistent(page)).toEqual(before);
  await host.press("0");
  // Even a text input nested in the host cannot initiate editing or Space navigation.
  await host.evaluate((e) => {
    const input = document.createElement("input");
    input.id = "nested-text";
    e.append(input);
  });
  const nested = page.locator("#nested-text");
  await nested.dispatchEvent("pointerdown", {
    pointerId: 1,
    isPrimary: true,
    button: 0,
  });
  await nested.press("Space");
  expect(await persistent(page)).toEqual(before);
  expect(
    await page.evaluate(() => window.editorProbe.session.drawing.pointerId),
  ).toBeNull();
  await nested.evaluate((e) => e.remove());
});

test("coalesced samples, replacement footprints, lost buttons, capture failure and disposal", async ({
  page,
}) => {
  const host = await setup(page),
    before = await persistent(page);
  await move(page, 60, 60);
  await page.mouse.down();
  const points = await Promise.all(
    [
      [61, 61],
      [62, 62],
      [63, 63],
    ].map(([x, y]) => point(page, x, y)),
  );
  await host.evaluate((element, points) => {
    const event = new PointerEvent("pointermove", {
      pointerId: 1,
      isPrimary: true,
      buttons: 1,
      clientX: points[2].x,
      clientY: points[2].y,
    });
    Object.defineProperty(event, "getCoalescedEvents", {
      value: () =>
        points.slice(0, 2).map((p) => ({ clientX: p.x, clientY: p.y })),
    });
    element.dispatchEvent(event);
  }, points);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.drawing.preview
        .getSnapshot()
        ?.writes.map((w) => w.y),
    ),
  ).toEqual([60, 61, 62, 63]);
  await host.dispatchEvent("pointermove", {
    pointerId: 1,
    isPrimary: true,
    buttons: 0,
  });
  await page.mouse.up();
  expect(await persistent(page)).toEqual(before);
  await page
    .locator("main")
    .getByRole("button", { name: "Rectangle", exact: true })
    .click();
  await move(page, 60, 60);
  await page.mouse.down();
  await move(page, 68, 68);
  await move(page, 61, 61);
  await page.mouse.up();
  const after = await persistent(page);
  expect(after.history.undoSteps).toBe(1);
  expect(after.invalidations[0].regions).toEqual(
    [60, 61].map((y) => ({
      layerId: "buildings",
      minX: 60,
      minY: y,
      maxX: 62,
      maxY: y + 1,
    })),
  );
  // Failed capture cannot leave a staged preview that commits on a later pointerup.
  await host.evaluate((e) => {
    e.setPointerCapture = () => {
      throw new Error("capture unavailable");
    };
  });
  await move(page, 65, 65);
  await page.mouse.down();
  await page.mouse.up();
  expect(await persistent(page)).toEqual(after);
  await expect(page.getByRole("alert")).toContainText("capture failed");
  await host.evaluate((e) => {
    delete (e as unknown as { setPointerCapture?: unknown }).setPointerCapture;
  });
  await move(page, 65, 65);
  await page.mouse.down();
  const disposed = await host.evaluate((e) => {
    const s = window.editorProbe.session,
      before = s.history.state;
    window.editorProbe.dispose();
    e.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0 }));
    return {
      before,
      after: s.history.state,
      preview: s.drawing.preview.getSnapshot(),
      capture: e.hasPointerCapture(1),
    };
  });
  expect(disposed.after).toEqual(disposed.before);
  expect(disposed.preview).toBeNull();
  expect(disposed.capture).toBe(false);
});

for (const dpr of [1, 2])
  test(`preview pixels never enter detail or overview caches; commit targets only touched chunks at DPR ${dpr}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(async () => {
      await window.tileProbe.load("drawing");
      window.tileProbe.view(-70, -70, 1 / 24);
    });
    await expect
      .poll(() =>
        page.evaluate(() => window.tileProbe.stats().overview.pending),
      )
      .toBe(0);
    const overviewBefore = await page.evaluate(
      () => window.tileProbe.stats().overview.builds,
    );
    const result = await page.evaluate(() => {
      const p = window.tileProbe,
        s = p.session;
      p.view(55, 55, 1);
      const at = (x: number, y = 63) => ({
        x: 24 + (x + 0.5 - 55) * 24,
        y: 24 + (y + 0.5 - 55) * 24,
      });
      const original = p.sample([
          [63, 63],
          [64, 63],
        ]),
        before = p.stats(),
        state = s.history.state;
      p.resetQueries();
      s.drawing.begin(1, at(60));
      s.drawing.sample(1, at(68));
      const preview = p.sample([
          [63, 63],
          [64, 63],
        ]),
        during = p.stats(),
        queries = p.queries().length;
      const isolated = s.history.state;
      s.drawing.commit(1, at(70));
      const committed = p.sample([
          [63, 63],
          [64, 63],
        ]),
        after = p.stats();
      s.history.undo();
      const undone = p.sample([
        [63, 63],
        [64, 63],
      ]);
      s.history.redo();
      return {
        original,
        before,
        state,
        preview,
        during,
        queries,
        isolated,
        committed,
        after,
        undone,
      };
    });
    expect(result.original).toEqual([
      [0, 255, 0, 255],
      [0, 255, 0, 255],
    ]);
    expect(result.preview).not.toEqual(result.original);
    for (const pixel of result.preview) {
      expect(pixel[0]).toBeGreaterThan(100);
      expect(pixel[1]).toBeGreaterThan(50);
    }
    expect(result.isolated).toEqual(result.state);
    expect(result.queries).toBe(0);
    expect(result.during.builds).toBe(result.before.builds);
    expect(result.during.uploads).toBe(result.before.uploads);
    expect(result.committed).toEqual([
      [255, 0, 0, 255],
      [255, 0, 0, 255],
    ]);
    expect(result.undone).toEqual(result.original);
    expect(result.after.builds - result.before.builds).toBe(2);
    expect(result.after.overview.builds).toBe(overviewBefore);
    await page.evaluate(() => window.tileProbe.view(-70, -70, 1 / 24));
    await expect
      .poll(() =>
        page.evaluate(() => window.tileProbe.stats().overview.pending),
      )
      .toBe(0);
    expect(
      await page.evaluate(() => window.tileProbe.stats().overview.builds),
    ).toBe(overviewBefore + 1);
    // Registered paint and erasure retain their semantics through the same preview/commit path.
    const erased = await page.evaluate(() => {
      const p = window.tileProbe,
        s = p.session;
      p.view(55, 55, 1);
      s.perform("eraser");
      const at = { x: 24 + (63.5 - 55) * 24, y: 24 + (63.5 - 55) * 24 };
      s.drawing.begin(2, at);
      const preview = p.sample([[63, 63]]);
      s.drawing.commit(2, at);
      const committed = p.sample([[63, 63]]);
      s.history.undo();
      const undone = p.sample([[63, 63]]);
      return { preview, committed, undone };
    });
    expect(erased.preview).not.toEqual(erased.committed);
    expect(erased.committed).toEqual([[51, 92, 70, 255]]);
    expect(erased.undone).toEqual([[255, 0, 0, 255]]);
    await context.close();
  });
