import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import {
  FIXTURES,
  FIXTURE_PALETTE,
  visitFixtureCells,
  type FixtureSpec,
} from "./fixtures/maps";
import expected from "./fixtures/expected.json" with { type: "json" };
import { grass } from "./fixtures/recolor";
import { OVERVIEW_BYTES } from "../src/renderer/overview";

// Complete stored-value fingerprint (outside all latency measurements). Hash
// bounded batches, then their ordered digests, without retaining the full map.
async function audit(page: Page) {
  return page.evaluate(async () => {
    const d = window.tileProbe.session.document;
    const hex = (bytes: ArrayBuffer) =>
      Array.from(new Uint8Array(bytes), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
    const digest = async (value: string) =>
      hex(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      );
    const batches: Promise<string>[] = [];
    let batch: string[] = [],
      runs = 0,
      grassCells = 0;
    const occupiedByLayer: Record<string, number> = {};
    for (const r of d.iterateRuns()) {
      runs++;
      occupiedByLayer[r.layerId] = (occupiedByLayer[r.layerId] ?? 0) + r.length;
      if (r.value.kind === "registered" && r.value.registryId === "grass")
        grassCells += r.length;
      batch.push(JSON.stringify(r));
      if (batch.length === 4096) {
        batches.push(digest(batch.join("\n")));
        batch = [];
      }
    }
    if (batch.length) batches.push(digest(batch.join("\n")));
    return {
      contentHash: await digest((await Promise.all(batches)).join("\n")),
      runs,
      grassCells,
      occupiedByLayer,
      storage: d.storageStats(),
      bounds: d.bounds,
      layers: d.layers,
      registry: d.registryEntries,
      annotations: d.annotations,
    };
  });
}

/** Independent fixture recipe, composited before averaging at actual pixel centers. */
function oracle(
  spec: FixtureSpec,
  points: [number, number][],
  view: { x: number; y: number; zoom: number },
  color: string,
  overview: boolean,
) {
  const scale = 24 * view.zoom;
  const step = overview
    ? 2 ** Math.max(0, Math.floor(Math.log2(1 / (scale * 2))))
    : 1;
  return points.map(([x, y]) => {
    const sx = Math.floor((24 + (x + 0.5 - view.x) * scale) * 2);
    const sy = Math.floor((24 + (y + 0.5 - view.y) * scale) * 2);
    const wx = view.x + ((sx + 0.5) / 2 - 24) / scale,
      wy = view.y + ((sy + 0.5) / 2 - 24) / scale;
    const bx = Math.floor(wx / step) * step,
      by = Math.floor(wy / step) * step;
    const cells = new Map<string, number>();
    visitFixtureCells(
      spec,
      (_layer, x, y, paint) => cells.set(`${x},${y}`, paint),
      { minX: bx, minY: by, maxX: bx + step, maxY: by + step },
    );
    const sums = [0, 0, 0, 0];
    for (const paint of cells.values()) {
      const rgba =
        FIXTURE_PALETTE[paint].key === "grass"
          ? color
          : FIXTURE_PALETTE[paint].rgba;
      [1, 3, 5, 7].forEach(
        (offset, c) =>
          (sums[c] += parseInt(rgba.slice(offset, offset + 2), 16)),
      );
    }
    const premult = sums.map((n) => Math.round(n / step ** 2));
    return [29, 39, 50]
      .map((bg, c) => Math.round(premult[c] + bg * (1 - premult[3] / 255)))
      .concat(255);
  });
}

for (const kind of ["frontier", "heartland"] as const) {
  test(`${kind}: feature recolor command and cache-refresh latency on the complete populated target map`, async ({
    browser,
  }, info) => {
    // Keep the complete populated-map audits and every recolor/undo/redo sample
    // even on slower hosted software rendering. Latencies are reported below.
    test.setTimeout(600000);
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(
      async ({ kind, grass }) => {
        await window.tileProbe.load(kind);
        window.tileProbe.resize(1024, 640);
        window.tileProbe.session.selectRegisteredColor(grass);
      },
      { kind, grass },
    );
    const before = await audit(page);
    expect(before.storage.occupiedCells).toBe(
      expected[`${kind}-v1`].occupiedLayerCells,
    );
    expect(Object.values(before.occupiedByLayer)).toEqual(
      expected[`${kind}-v1`].occupiedByLayer,
    );
    expect(before.grassCells).toBeGreaterThan(1_000_000);
    const spec = FIXTURES.find((f) => f.id === `${kind}-v1`)!;
    const modes = [];
    for (const mode of ["detail", "overview"] as const) {
      const points: [number, number][] =
        mode === "detail"
          ? [
              [280, 280],
              [350, 350],
              [319, 319],
            ]
          : [
              [280, 280],
              [350, 350],
              [319, 319],
              [5908, 5908],
              [108, 108],
              [6308, 6308],
              [1908, 3508],
            ];
      const run = await page.evaluate(
        async ({ mode, points, grass }) => {
          const p = window.tileProbe,
            s = p.session;
          const frame = () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          const ready = async () => {
            while (p.stats().overview.pending) await frame();
          };
          const zoom = (640 - 48) / 6400 / 24;
          const view =
            mode === "detail"
              ? { x: 272, y: 272, zoom: 4 / 24 }
              : { x: 3200 - (512 - 24) / (24 * zoom), y: 0, zoom };
          const start = performance.now();
          p.view(view.x, view.y, view.zoom);
          await ready();
          const coldReadyMs = performance.now() - start;
          const coldStats = p.stats();
          const samples = [];
          for (const color of ["#557755ff", "#446644ff", "#336633ff"]) {
            for (const operation of ["recolor", "undo", "redo"] as const) {
              p.resetQueries();
              const before = p.stats();
              const start = performance.now();
              let prepareMs = 0;
              if (operation === "recolor") {
                const plan = s.registryCommands.prepare({
                  kind: "edit",
                  id: grass,
                  name: "Grass",
                  color,
                });
                prepareMs = performance.now() - start;
                if (!s.commitRegistry(plan))
                  throw new Error(s.feedback.getSnapshot().message);
              } else s.perform(operation);
              const synchronousMs = performance.now() - start;
              const synchronousQueries = p.queries().length;
              await ready();
              const readyMs = performance.now() - start;
              const stats = p.stats();
              const queries = p.queries();
              const unboundedQueries = queries.filter(({ bounds }) => {
                const b = bounds as
                  | { minX: number; minY: number; maxX: number; maxY: number }
                  | undefined;
                return !b || b.maxX - b.minX > 256 || b.maxY - b.minY > 32;
              }).length;
              samples.push({
                operation,
                color: s.color.getSnapshot(),
                prepareMs,
                synchronousMs,
                readyMs,
                synchronousQueries,
                queries: queries.length,
                unboundedQueries,
                rebuiltDetail: stats.builds - before.builds,
                rebuiltOverview: stats.overview.builds - before.overview.builds,
                overviewWorkMs: stats.overview.workMs - before.overview.workMs,
                stats,
                pixels: p.sample(points),
              });
            }
          }
          p.resetQueries();
          return { mode, view, points, coldReadyMs, coldStats, samples };
        },
        { mode, points, grass },
      );
      for (const sample of run.samples) {
        const wanted = oracle(
          spec,
          points,
          run.view,
          sample.color,
          mode === "overview",
        );
        sample.pixels.forEach((pixel, i) =>
          pixel.forEach((value, c) =>
            expect(
              Math.abs(value - wanted[i][c]),
              JSON.stringify({
                kind,
                mode,
                sample: sample.operation,
                point: points[i],
                pixel,
                wanted: wanted[i],
              }),
            ).toBeLessThanOrEqual(1),
          ),
        );
        expect(sample.unboundedQueries).toBe(0);
        expect(sample.stats.overview.pending).toBe(0);
        expect(sample.stats.overview.bytes).toBeLessThanOrEqual(OVERVIEW_BYTES);
        if (mode === "overview") {
          expect(sample.synchronousQueries).toBe(0);
          expect(sample.rebuiltOverview).toBe(sample.stats.overview.visible);
          expect(sample.rebuiltDetail).toBe(0);
        } else {
          expect(sample.rebuiltDetail).toBeGreaterThan(0);
          expect(sample.rebuiltOverview).toBe(0);
        }
      }
      modes.push(run);
    }
    const after = await audit(page);
    expect(after).toEqual({
      ...before,
      registry: before.registry.map(([id, record]) => [
        id,
        id === grass ? { ...record, rgba: "#336633ff" } : record,
      ]),
    });
    expect(errors).toEqual([]);
    await page
      .locator("canvas")
      .screenshot({ path: info.outputPath(`${kind}-recolor.png`) });
    const sources = Object.fromEntries(
      await Promise.all(
        [
          "package-lock.json",
          "src/domain/registry.ts",
          "src/domain/document.ts",
          "src/domain/history.ts",
          "src/editor/session.ts",
          "src/editor/invalidation.ts",
          "src/RegistryControls.tsx",
          "src/renderer/tileScene.ts",
          "src/renderer/overview.ts",
          "src/renderer/overviewScene.ts",
          "src/renderer/createRenderer.ts",
          "src/renderer/chunks.ts",
          "src/renderer/colors.ts",
          "tests/fixtures/maps.ts",
          "tests/fixtures/populated.ts",
          "tests/tiles-harness.ts",
          "tests/recolor-scale.spec.ts",
        ].map(async (path) => [
          path,
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        ]),
      ),
    );
    const report = {
      date: new Date().toISOString(),
      fixture: expected[`${kind}-v1`],
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0].model,
        ram: totalmem(),
        node: process.version,
        browser: browser.version(),
        canvas: { width: 1024, height: 640, dpr: 2 },
        mode: "Chromium WebGL2 / Vite development",
      },
      sources,
      before,
      after,
      modes,
      errors,
      limitations:
        "One fresh browser context per fixture; 3 recolor/undo/redo cycles in detail and 3 at Fit. Timings use performance.now: prepareMs is feature validation/planning, synchronousMs includes planning, history, notifications and synchronous detail rendering, readyMs ends after all visible overview regions publish and render. Not native presented-frame latency or a budget pass. Complete stored-run hashes and occupancy are checked outside timing. No native physical-memory measurement. Conservative all-overview invalidation retained; TW-049/TW-050 own refinement.",
    };
    const path = info.outputPath(`${kind}-recolor.json`);
    await writeFile(path, JSON.stringify(report, null, 2) + "\n");
    await info.attach(`${kind}-recolor`, {
      path,
      contentType: "application/json",
    });
    await context.close();
  });
}
