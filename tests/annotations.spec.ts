import { expect, test, type Page } from "@playwright/test";
import { trackGpu } from "./gpu";

const panel = (page: Page) =>
  page
    .locator("main")
    .getByRole("region", { name: "Annotations", exact: true });
const action = (page: Page, name: string) =>
  page.locator("main").getByRole("button", { name, exact: true });
const host = (page: Page) => page.locator(".canvas-host");
async function setup(page: Page) {
  await page.goto("/tests/editor.html");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  await page.evaluate(() => {
    const s = window.editorProbe.session;
    s.viewport.set({ x: 55, y: 55, zoom: 1 });
    s.history.markSaved(s.history.captureCheckpoint());
  });
}
async function move(page: Page, x: number, y: number) {
  const b = (await host(page).boundingBox())!;
  const v = await page.evaluate(() =>
    window.editorProbe.session.viewport.getSnapshot(),
  );
  await page.mouse.move(
    b.x + 24 + (x + 0.5 - v.x) * 24 * v.zoom,
    b.y + 24 + (y + 0.5 - v.y) * 24 * v.zoom,
  );
}
const persistent = (page: Page) =>
  page.evaluate(() => {
    const s = window.editorProbe.session;
    return {
      records: s.document.annotations,
      runs: [...s.document.iterateRuns()],
      history: s.history.state,
      version: s.document.version,
    };
  });
async function numeric(
  page: Page,
  name: string,
  tier = "detail",
  description = "",
  bounds = [60, 60, 68, 68],
) {
  await action(page, "New area").click();
  await panel(page).getByLabel("Area name", { exact: true }).fill(name);
  await panel(page)
    .getByLabel("Description", { exact: true })
    .fill(description);
  await panel(page).getByLabel("Tier", { exact: true }).selectOption(tier);
  for (const [i, label] of [
    "Minimum X",
    "Minimum Y",
    "Maximum X",
    "Maximum Y",
  ].entries())
    await panel(page)
      .getByLabel(label, { exact: true })
      .fill(String(bounds[i]));
  await action(page, "Apply area").click();
}

for (const dpr of [1, 2])
  test(`explicit bounds drawing and redraw have exact overlays and reversible history at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    await trackGpu(page);
    await setup(page);
    const before = await persistent(page);
    await action(page, "New area").click();
    await panel(page)
      .getByLabel("Area name", { exact: true })
      .fill("Blacksmith's house");
    await panel(page)
      .getByLabel("Description", { exact: true })
      .fill("Forge downstairs.\nHome upstairs.");
    await action(page, "Draw bounds").click();
    await move(page, 67, 67);
    await page.mouse.down();
    await move(page, 60, 60);
    await expect(panel(page).getByLabel("Area dimensions")).toHaveText(
      "8 × 8 tiles",
    );
    expect(await persistent(page)).toEqual(before);
    await page.mouse.up();
    await expect(
      panel(page).getByLabel("Minimum X", { exact: true }),
    ).toHaveValue("60");
    const pixels = await page.evaluate(() => {
      const s = window.editorProbe.session,
        v = s.viewport.getSnapshot();
      const canvas = document.querySelector<HTMLCanvasElement>(
          ".canvas-host canvas",
        )!,
        gl = canvas.getContext("webgl2")!;
      s.viewport.set({ ...v, x: v.x + 0.001 });
      s.viewport.set(v);
      return [
        [60, 62.5],
        [68, 62.5],
        [62.5, 60],
        [62.5, 68],
        [61.5, 61.5],
      ].map(([x, y]) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(
          Math.floor((24 + (x - v.x) * 24 * v.zoom) * devicePixelRatio),
          canvas.height -
            1 -
            Math.floor((24 + (y - v.y) * 24 * v.zoom) * devicePixelRatio),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return [...pixel];
      });
    });
    for (const pixel of pixels.slice(0, 4))
      expect(pixel).toEqual([221, 166, 255, 255]);
    expect(pixels[4]).toEqual([29, 39, 50, 255]);
    await host(page).screenshot({
      path: info.outputPath(`area-draft-dpr${dpr}.png`),
    });
    await action(page, "Apply area").click();
    const created = await persistent(page);
    expect(created.history.undoSteps).toBe(1);
    expect(created.history.dirty).toBe(true);
    expect(created.runs).toEqual(before.runs);
    expect(created.records[0][1]).toMatchObject({
      name: "Blacksmith's house",
      description: "Forge downstairs.\nHome upstairs.",
      tier: "detail",
      bounds: { minX: 60, minY: 60, maxX: 68, maxY: 68 },
      label: { placement: "center" },
    });
    await action(page, "Edit area").click();
    await action(page, "Redraw bounds").click();
    await move(page, 63, 60);
    await page.mouse.down();
    await move(page, 70, 67);
    await page.mouse.up();
    expect((await persistent(page)).records).toEqual(created.records);
    await action(page, "Apply area").click();
    const changed = await persistent(page);
    expect(changed.records[0][0]).toBe(created.records[0][0]);
    expect(changed.records[0][1].bounds).toEqual({
      minX: 63,
      minY: 60,
      maxX: 71,
      maxY: 68,
    });
    await page.locator(".canvas-host").press("Meta+z");
    expect((await persistent(page)).records).toEqual(created.records);
    await page.locator(".canvas-host").press("Meta+Shift+z");
    expect((await persistent(page)).records).toEqual(changed.records);
    await action(page, "Delete area").click();
    expect((await persistent(page)).records).toEqual([]);
    await page.locator(".canvas-host").press("Meta+z");
    expect((await persistent(page)).records).toEqual(changed.records);
    await page.evaluate(() => window.editorProbe.dispose());
    expect(await page.evaluate(() => window.gpuProbe())).toEqual({
      contexts: 0,
      textures: 0,
      buffers: 0,
    });
    await context.close();
  });

test("house/village/region controls, field feedback, native text editing, no-op Apply and overview editing", async ({
  page,
}, info) => {
  await setup(page);
  await numeric(page, "House", "detail", "Home\nForge");
  await numeric(page, "Village", "locality", "", [0, 0, 128, 128]);
  await numeric(page, "Region", "region", "Valley", [0, 0, 256, 256]);
  const all = await persistent(page);
  expect(all.records.map(([, r]) => r.tier).sort()).toEqual([
    "detail",
    "locality",
    "region",
  ]);
  await panel(page)
    .getByRole("button", { name: /^House detail/ })
    .click();
  await panel(page)
    .getByLabel("Area name", { exact: true })
    .fill("Renamed house");
  await panel(page)
    .getByLabel("Description", { exact: true })
    .fill("Changed description");
  await panel(page)
    .getByLabel("Tier", { exact: true })
    .selectOption("locality");
  const field = panel(page).getByLabel("Minimum X", { exact: true });
  await field.fill("-1");
  await action(page, "Apply area").click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(panel(page)).toContainText(
    "Bounds must form a nonempty rectangle inside the map",
  );
  expect(await persistent(page)).toEqual(all);
  await field.fill("");
  await action(page, "Apply area").click();
  expect(await persistent(page)).toEqual(all);
  await field.fill("60.5");
  await action(page, "Apply area").click();
  expect(await persistent(page)).toEqual(all);
  await field.fill("60");
  await panel(page).getByLabel("Area name", { exact: true }).fill("  ");
  await action(page, "Apply area").click();
  await expect(panel(page)).toContainText(
    "Enter a nonblank, single-line area name",
  );
  expect(await persistent(page)).toEqual(all);
  await panel(page)
    .getByLabel("Area name", { exact: true })
    .fill("Renamed house");
  await panel(page)
    .getByLabel("Description", { exact: true })
    .press("ControlOrMeta+z");
  expect(await persistent(page)).toEqual(all);
  // Native undo may target the last text edit across fields. Restore valid input
  // before testing a document Apply, without assuming a browser text-undo stack.
  await panel(page)
    .getByLabel("Area name", { exact: true })
    .fill("Renamed house");
  await panel(page)
    .getByLabel("Description", { exact: true })
    .fill("Changed description");
  await page.evaluate(() =>
    window.editorProbe.session.viewport.set({ x: 0, y: 0, zoom: 0.01 }),
  );
  await expect(action(page, "Redraw bounds")).toBeDisabled();
  await expect(panel(page)).toContainText("Numeric bounds remain available");
  await action(page, "Apply area").click();
  const edited = await persistent(page);
  expect(edited.history.undoSteps).toBe(4);
  for (const [id, record] of all.records.filter(([, r]) => r.name !== "House"))
    expect(edited.records.find(([key]) => key === id)![1]).toEqual(record);
  await action(page, "Edit area").click();
  await action(page, "Apply area").click();
  expect(await persistent(page)).toEqual(edited);
  await page.setViewportSize({ width: 640, height: 452 });
  await action(page, "Edit area").click();
  await action(page, "Apply area").scrollIntoViewIfNeeded();
  await expect(action(page, "Apply area")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("area-minimum-window.png") });
});

test("captured bounds cancel safely on capture loss, blur, Escape, tool switches and resize", async ({
  page,
}) => {
  await setup(page);
  await numeric(page, "House");
  const before = await persistent(page);
  for (const cause of [
    "pointercancel",
    "lostpointercapture",
    "blur",
    "escape",
    "tool",
    "resize",
  ] as const) {
    await panel(page)
      .getByRole("button", { name: /^House detail/ })
      .click();
    const draft = await page.evaluate(() =>
      window.editorProbe.session.areas.draft.getSnapshot(),
    );
    await action(page, "Redraw bounds").click();
    await move(page, 61, 61);
    await page.mouse.down();
    await move(page, 65, 65);
    if (cause === "pointercancel" || cause === "lostpointercapture")
      await host(page).evaluate((element, type) => {
        const id = window.editorProbe.session.areas.pointerId!;
        element.dispatchEvent(
          new PointerEvent(type, { pointerId: id, isPrimary: true }),
        );
      }, cause);
    else if (cause === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else if (cause === "escape") await host(page).press("Escape");
    else if (cause === "tool") await host(page).press("b");
    else await page.setViewportSize({ width: 1100, height: 780 });
    await page.mouse.up();
    expect(await persistent(page)).toEqual(before);
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.areas.preview.getSnapshot(),
      ),
    ).toBeNull();
    const after = await page.evaluate(() =>
      window.editorProbe.session.areas.draft.getSnapshot(),
    );
    expect(after).toEqual(
      cause === "escape" || cause === "tool" ? null : draft,
    );
  }
});
