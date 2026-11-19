import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import type { AnnotationId } from "../src/domain/values";
import { trackGpu } from "./gpu";

async function setup(page: Page) {
  await trackGpu(page);
  await page.goto("/tests/tiles.html");
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  await page.evaluate(async () => {
    await window.tileProbe.load("areas");
    window.tileProbe.resize(960, 640);
  });
}
async function center(page: Page, pixels: number, x = 64, y = 64) {
  await page.evaluate(
    ({ pixels, x, y }) =>
      window.tileProbe.view(
        x - (480 - 24) / pixels,
        y - (320 - 24) / pixels,
        pixels / 24,
      ),
    { pixels, x, y },
  );
  await expect(page.locator("canvas")).toHaveAttribute("aria-busy", "false");
}
const stats = (page: Page) => page.evaluate(() => window.tileProbe.stats());

for (const dpr of [1, 2])
  test(`label tiers, threshold screenshots, actual text pixels and one selected exception at DPR ${dpr}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      deviceScaleFactor: dpr,
      viewport: { width: 1080, height: 720 },
    });
    const page = await context.newPage();
    await setup(page);
    const records = await page.evaluate(
      () => window.tileProbe.session.document.annotations,
    );
    const scales = [
      24, 8.000001, 8, 7.999999, 3, 2, 1.000001, 1, 0.999999, 0.24,
    ];
    const evidence = [];
    for (const p of [...scales, ...[...scales].reverse()]) {
      await center(page, p, p < 1 ? 480 : 64, p < 1 ? 480 : 64);
      const state = await stats(page);
      const tier = p >= 8 ? "detail" : p >= 1 ? "locality" : "region";
      expect(state.labels.labels.map((label) => label.tier)).toEqual([tier]);
      expect(state.labels.labels[0].height).toBe(
        tier === "detail" ? 25 : tier === "locality" ? 27 : 29,
      );
      expect(state.labels.live).toBe(1);
      expect(state.labels.created - state.labels.released).toBe(1);
      const lightPixels = await page.evaluate(() => {
        const probe = window.tileProbe;
        probe.resize(960, 640); // Redraw the non-preserved WebGL buffer before readback.
        const label = probe.stats().labels.labels[0];
        const canvas = document.querySelector("canvas")!,
          gl = canvas.getContext("webgl2")!;
        const width = Math.floor(label.width * devicePixelRatio),
          height = Math.floor(label.height * devicePixelRatio);
        const data = new Uint8Array(width * height * 4);
        gl.readPixels(
          Math.floor(label.x * devicePixelRatio),
          canvas.height -
            Math.floor((label.y + label.height) * devicePixelRatio),
          width,
          height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          data,
        );
        let light = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] > 190 && data[i + 1] > 190 && data[i + 2] > 190) light++;
        return light;
      });
      expect(lightPixels).toBeGreaterThan(40 * dpr);
      if (evidence.length < scales.length)
        await page
          .locator("canvas")
          .screenshot({ path: info.outputPath(`tier-${p}-dpr${dpr}.png`) });
      evidence.push({ p, lightPixels, labels: state.labels.labels });
    }
    await page.evaluate(() => {
      const s = window.tileProbe.session;
      s.areas.select("area-house" as AnnotationId);
      s.areas.cancelDraft();
    });
    await center(page, 0.24, 480, 480);
    const selected = (await stats(page)).labels.labels;
    expect(selected.map((label) => [label.id, label.selected])).toEqual([
      ["area-house", true],
      ["area-region", false],
    ]);
    await page.locator("canvas").screenshot({
      path: info.outputPath(`selected-house-region-dpr${dpr}.png`),
    });
    expect(
      await page.evaluate(() => window.tileProbe.session.document.annotations),
    ).toEqual(records);
    await page.evaluate(() => window.tileProbe.dispose());
    expect(
      await page.evaluate(() => window.tileProbe.disposed()!.labels),
    ).toMatchObject({ live: 0, measurements: 0, candidates: 0, labels: [] });
    expect(await page.evaluate(() => window.gpuProbe())).toEqual({
      contexts: 0,
      textures: 0,
      buffers: 0,
    });
    await writeFile(
      info.outputPath("threshold-evidence.json"),
      JSON.stringify({ dpr, evidence }, null, 2),
    );
    await context.close();
  });

test("collisions, plain Unicode names, inset placement, culling and tiny hosts keep document data intact", async ({
  page,
}, info) => {
  await setup(page);
  await center(page, 24);
  await page.evaluate(() => {
    const s = window.tileProbe.session;
    const house = s.document.getAnnotation("area-house" as AnnotationId)!;
    s.execute("Overlap", [
      {
        kind: "annotation",
        id: "area-house-b" as AnnotationId,
        value: { ...house, name: "Storehouse" },
      },
    ]);
  });
  expect((await stats(page)).labels.labels.map((l) => l.id)).toEqual([
    "area-house",
  ]);
  await page.evaluate(() =>
    window.tileProbe.session.areas.select("area-house-b" as AnnotationId),
  );
  expect((await stats(page)).labels.labels.map((l) => l.id)).toEqual([
    "area-house-b",
  ]);
  await page
    .locator("canvas")
    .screenshot({ path: info.outputPath("selected-collision.png") });
  await page.evaluate(() => {
    const s = window.tileProbe.session;
    s.areas.update({
      name: "<b>Forge 👩🏽‍🔧 é</b> ".repeat(20),
      bounds: { minX: "0", minY: "0", maxX: "1", maxY: "1" },
    });
    s.areas.apply();
    // The anchor is three CSS pixels from top/left; inset shifts only the box.
    window.tileProbe.view(1.375, 1.375, 1);
  });
  const before = await page.evaluate(
    () => window.tileProbe.session.document.annotations,
  );
  let box = (await stats(page)).labels.labels[0];
  expect(box).toMatchObject({
    id: "area-house-b",
    selected: true,
    x: 4,
    y: 4,
    anchor: { x: 3, y: 3 },
  });
  expect(box.text).toContain("<b>Forge 👩🏽‍🔧 é</b>");
  expect(box.text.endsWith("…")).toBe(true);
  expect(box.width).toBeLessThanOrEqual(240);
  await page
    .locator("canvas")
    .screenshot({ path: info.outputPath("unicode-edge.png") });
  await page.evaluate(() => window.tileProbe.resize(140, 80));
  box = (await stats(page)).labels.labels[0];
  expect(box.width).toBeLessThanOrEqual(132);
  expect(box.x).toBe(4);
  await page.evaluate(() => window.tileProbe.resize(20, 20));
  expect((await stats(page)).labels.live).toBe(0);
  await page.evaluate(() => {
    window.tileProbe.resize(960, 640);
    window.tileProbe.view(1.500001, 1.5, 1);
  });
  expect((await stats(page)).labels.live).toBe(0);
  expect(
    await page.evaluate(() => window.tileProbe.session.document.annotations),
  ).toEqual(before);
});

test("annotation edits update only affected visuals; tiles, transforms and descriptions reuse labels", async ({
  page,
}) => {
  await setup(page);
  await center(page, 24);
  await page.evaluate(() => {
    const s = window.tileProbe.session;
    const house = s.document.getAnnotation("area-house" as AnnotationId)!;
    s.execute("Second house", [
      {
        kind: "annotation",
        id: "area-second" as AnnotationId,
        value: {
          ...house,
          name: "Mill",
          bounds: { minX: 72, minY: 60, maxX: 80, maxY: 68 },
        },
      },
    ]);
  });
  const initial = await stats(page);
  expect(initial.labels.live).toBe(2);
  const edit = async (field: string, value: string) =>
    page.evaluate(
      ({ field, value }) => {
        const s = window.tileProbe.session,
          id = "area-house" as AnnotationId;
        s.execute("Edit area", [
          {
            kind: "annotation",
            id,
            value: { ...s.document.getAnnotation(id)!, [field]: value },
          },
        ]);
      },
      { field, value },
    );
  await edit("description", "Changed description\nExact whitespace  ");
  let current = await stats(page);
  expect(current.labels.labels).toEqual(initial.labels.labels);
  expect(current.labels.textUpdates).toBe(initial.labels.textUpdates);
  expect(current.builds).toBe(initial.builds);
  expect(current.uploads).toBe(initial.uploads);
  await edit("name", "Forge");
  current = await stats(page);
  expect(current.labels.textUpdates).toBe(initial.labels.textUpdates + 1);
  expect(current.labels.labels.find((l) => l.id === "area-second")).toEqual(
    initial.labels.labels.find((l) => l.id === "area-second"),
  );
  expect(current.builds).toBe(initial.builds);
  expect(current.uploads).toBe(initial.uploads);
  await page.evaluate(() => window.tileProbe.session.history.undo());
  expect((await stats(page)).labels.labels[0].text).toBe("Blacksmith's house");
  await page.evaluate(() => window.tileProbe.session.history.redo());
  expect((await stats(page)).labels.labels[0].text).toBe("Forge");
  const tilesBefore = await stats(page);
  const dataBefore = await page.evaluate(
    () => window.tileProbe.session.document.annotations,
  );
  const transforms = await page.evaluate(() => {
    const s = window.tileProbe.session;
    s.canvasState.set("ready");
    s.setCanvasSize(960, 640);
    s.selectLayer(s.document.layers[1].id);
    s.perform("select");
    const v = s.viewport.getSnapshot(),
      point = (x: number, y: number) => ({
        x: 24 + (x + 0.5 - v.x) * 24 * v.zoom,
        y: 24 + (y + 0.5 - v.y) * 24 * v.zoom,
      });
    const results = [
      s.selection.begin(1, point(60, 60)),
      s.selection.commit(1, point(67, 67)),
      s.selection.nudge(3, 0),
      s.selection.transform("rotate-clockwise"),
      s.selection.commitPlacement(),
    ];
    return results;
  });
  expect(transforms.every(Boolean)).toBe(true);
  expect((await stats(page)).labels).toEqual(tilesBefore.labels);
  expect(
    await page.evaluate(() => window.tileProbe.session.document.annotations),
  ).toEqual(dataBefore);
  await page.evaluate(() => {
    window.tileProbe.session.history.undo();
    window.tileProbe.session.history.undo();
    window.tileProbe.session.history.redo();
    window.tileProbe.session.history.redo();
  });
  expect((await stats(page)).labels).toEqual(tilesBefore.labels);
  await center(page, 0.24, 480, 480);
  const overview = await stats(page);
  await edit("name", "Hidden renamed house");
  expect((await stats(page)).labels.live).toBe(1);
  expect((await stats(page)).labels.textUpdates).toBe(
    overview.labels.textUpdates,
  );
  expect((await stats(page)).overview).toEqual(overview.overview);
  await center(page, 24);
  expect((await stats(page)).labels.labels[0].text).toBe(
    "Hidden renamed house",
  );
});

test("DPR changes reuse label objects and CSS geometry; draft geometry and invalid drafts replace selected labels", async ({
  page,
}) => {
  await setup(page);
  await center(page, 24);
  const initial = (await stats(page)).labels;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1080,
    height: 720,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await page.evaluate(() => window.tileProbe.resize(960, 640));
  const density = (await stats(page)).labels;
  expect(density.labels).toEqual(initial.labels);
  expect(density.textUpdates).toBe(initial.textUpdates + 1);
  expect(
    await page
      .locator("canvas")
      .evaluate((canvas) => (canvas as HTMLCanvasElement).width),
  ).toBe(1920);
  const document = await page.evaluate(
    () => window.tileProbe.session.document.annotations,
  );
  await page.evaluate(() => {
    const s = window.tileProbe.session;
    s.areas.select("area-house" as AnnotationId);
    s.areas.update({
      name: "New forge",
      bounds: { minX: "63", minY: "60", maxX: "71", maxY: "68" },
    });
  });
  let labels = (await stats(page)).labels.labels;
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({
    text: "New forge",
    selected: true,
    anchor: {
      x: initial.labels[0].anchor.x + 72,
      y: initial.labels[0].anchor.y,
    },
  });
  await page.evaluate(() =>
    window.tileProbe.session.areas.update({
      bounds: { minX: "63", minY: "60", maxX: "63", maxY: "68" },
    }),
  );
  expect((await stats(page)).labels.live).toBe(0);
  await page.evaluate(() => window.tileProbe.session.areas.cancelDraft());
  labels = (await stats(page)).labels.labels;
  expect(labels[0]).toMatchObject({
    text: "Blacksmith's house",
    selected: true,
    anchor: initial.labels[0].anchor,
  });
  expect(
    await page.evaluate(() => window.tileProbe.session.document.annotations),
  ).toEqual(document);
});

test("area label clicks work in overview; pencil and tile selection pass through labels, with selected overlays retained", async ({
  page,
}, info) => {
  await trackGpu(page);
  await page.goto("/tests/editor.html?fixture=areas");
  await expect(page.getByRole("status", { name: "Canvas status" })).toHaveText(
    "Canvas ready",
  );
  const host = page.locator(".canvas-host");
  const box = (await host.boundingBox())!;
  await page.evaluate(({ width, height }) => {
    const s = window.editorProbe.session;
    s.viewport.set({
      x: 480 - (width / 2 - 24) / 0.24,
      y: 480 - (height / 2 - 24) / 0.24,
      zoom: 0.01,
    });
    s.activeTool.set("area");
  }, box);
  const original = await page.evaluate(
    () => window.editorProbe.session.document.annotations,
  );
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.areas.selected.getSnapshot(),
    ),
  ).toBe("area-region");
  await page.evaluate(({ width, height }) => {
    const s = window.editorProbe.session;
    s.areas.select("area-house" as AnnotationId);
    s.areas.cancelDraft();
    s.viewport.set({
      x: 64 - (width / 2 - 24) / 24,
      y: 64 - (height / 2 - 24) / 24,
      zoom: 1,
    });
    s.setColor("#ff0000");
    s.perform("pencil");
  }, box);
  await page.mouse.click(
    box.x + box.width / 2 + 12,
    box.y + box.height / 2 + 5,
  );
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.document.getCell(
        window.editorProbe.session.activeLayer.getSnapshot(),
        64,
        64,
      ),
    ),
  ).toEqual({ kind: "raw", rgba: "#ff0000ff" });
  await host.screenshot({ path: info.outputPath("selected-with-pencil.png") });
  await host.press("v");
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 5);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 60,
  );
  await page.mouse.up();
  expect(
    await page.evaluate(
      () => window.editorProbe.session.selection.state.getSnapshot()?.bounds,
    ),
  ).toEqual({ minX: 64, minY: 64, maxX: 67, maxY: 67 });
  expect(
    await page.evaluate(() =>
      window.editorProbe.session.areas.selected.getSnapshot(),
    ),
  ).toBe("area-house");
  expect(
    await page.evaluate(() => window.editorProbe.session.document.annotations),
  ).toEqual(original);
  await host.screenshot({
    path: info.outputPath("selected-with-tile-selection.png"),
  });
  await page.evaluate(() => window.editorProbe.dispose());
  expect(await page.evaluate(() => window.gpuProbe())).toEqual({
    contexts: 0,
    textures: 0,
    buffers: 0,
  });
});
