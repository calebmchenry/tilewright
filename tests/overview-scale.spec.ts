import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { FIXTURES, FIXTURE_PALETTE, visitFixtureCells } from "./fixtures/maps";
import expected from "./fixtures/expected.json" with { type: "json" };
import { trackGpu } from "./gpu";
import { OVERVIEW_BYTES } from "../src/renderer/overview";

for (const kind of ["frontier", "heartland"] as const) {
  test(`${kind}: bounded overview rebuilds and navigation at 100 by 100 chunks`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180000);
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1200, height: 800 },
    });
    const page = await context.newPage();
    await trackGpu(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(async (kind) => {
      await window.tileProbe.load(kind);
      window.tileProbe.resize(1024, 640);
    }, kind);
    const cdp = await context.newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    const beforeHeap = await cdp.send("Runtime.getHeapUsage");
    const cold = await page.evaluate(async () => {
      const probe = window.tileProbe;
      const zoom = (640 - 48) / 6400 / 24;
      const view = { x: 3200 - (512 - 24) / (24 * zoom), y: 0, zoom };
      probe.resetQueries();
      const start = performance.now();
      probe.view(view.x, view.y, view.zoom);
      const submissionMs = performance.now() - start;
      const frames: number[] = [];
      const navigationDuringBuildMs: number[] = [];
      let previous = performance.now();
      while (probe.stats().overview.pending) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
        const panStart = performance.now();
        probe.view(view.x + Math.sin(frames.length) * 32, view.y, view.zoom);
        navigationDuringBuildMs.push(performance.now() - panStart);
      }
      probe.view(view.x, view.y, view.zoom);
      const result = {
        view,
        submissionMs,
        readyMs: performance.now() - start,
        frames,
        navigationDuringBuildMs,
        stats: probe.stats(),
        queries: probe.queries().length,
        gpu: window.gpuProbe(),
      };
      probe.resetQueries();
      return result;
    });
    expect(cold.stats.mode).toBe("overview");
    expect(cold.stats.chunks).toBe(0);
    expect(cold.stats.textures).toBe(0);
    expect(cold.stats.overview.visible).toBeLessThanOrEqual(256);
    expect(cold.stats.overview.pending).toBe(0);
    expect(cold.stats.overview.bytes).toBeLessThanOrEqual(OVERVIEW_BYTES);
    expect(cold.stats.overview.created - cold.stats.overview.released).toBe(
      cold.stats.overview.textures,
    );
    expect(
      cold.gpu.textures - cold.stats.overview.textures,
    ).toBeLessThanOrEqual(4);
    expect(
      await page.evaluate(
        () => window.tileProbe.session.document.storageStats().occupiedCells,
      ),
    ).toBe(expected[`${kind}-v1`].occupiedLayerCells);

    // Independent recipe oracle at the actual physical pixel centers and LOD bins.
    const spec = FIXTURES.find((f) => f.id === `${kind}-v1`)!;
    const points: [number, number][] = [
      [319, 319],
      [280, 280],
      [350, 350],
      [5908, 5908],
      [108, 108],
      [6308, 6308],
      [1908, 3508],
    ];
    const scale = 24 * cold.view.zoom,
      step = 2 ** Math.max(0, Math.floor(Math.log2(1 / (scale * 2))));
    const samples = points.map(([x, y]) => {
      const sx = Math.floor((24 + (x + 0.5 - cold.view.x) * scale) * 2);
      const sy = Math.floor((24 + (y + 0.5 - cold.view.y) * scale) * 2);
      const wx = cold.view.x + ((sx + 0.5) / 2 - 24) / scale;
      const wy = cold.view.y + ((sy + 0.5) / 2 - 24) / scale;
      // Avoid exact nearest-filter texel ties: CPU and GPU float precision can
      // legitimately choose opposite sides of the same boundary.
      expect(Math.abs(wx / step - Math.round(wx / step))).toBeGreaterThan(
        0.00001,
      );
      expect(Math.abs(wy / step - Math.round(wy / step))).toBeGreaterThan(
        0.00001,
      );
      const bx = Math.floor(wx / step) * step,
        by = Math.floor(wy / step) * step;
      const colors = new Map<string, number>();
      visitFixtureCells(
        spec,
        (_layer, x, y, paint) => colors.set(`${x},${y}`, paint),
        { minX: bx, minY: by, maxX: bx + step, maxY: by + step },
      );
      const sums = [0, 0, 0, 0];
      for (const paint of colors.values()) {
        const rgba = FIXTURE_PALETTE[paint].rgba;
        [1, 3, 5, 7].forEach(
          (offset, c) =>
            (sums[c] += parseInt(rgba.slice(offset, offset + 2), 16)),
        );
      }
      const premult = sums.map((n) => Math.round(n / (step * step)));
      const rgba = [29, 39, 50]
        .map((bg, c) => Math.round(premult[c] + bg * (1 - premult[3] / 255)))
        .concat(255);
      return { point: [x, y], bin: { x: bx, y: by, step }, rgba };
    });
    const actual = await page.evaluate(
      (points) => window.tileProbe.sample(points),
      points,
    );
    actual.forEach((pixel, i) =>
      pixel.forEach((value, c) =>
        expect(
          Math.abs(value - samples[i].rgba[c]),
          JSON.stringify({ sample: samples[i], pixel, channel: c }),
        ).toBeLessThanOrEqual(1),
      ),
    );
    await page
      .locator("canvas")
      .screenshot({ path: testInfo.outputPath(`${kind}-overview.png`) });
    await cdp.send("HeapProfiler.collectGarbage");
    const overviewHeap = await cdp.send("Runtime.getHeapUsage");

    const warm = await page.evaluate(async (view) => {
      const probe = window.tileProbe;
      const passes = [];
      // Same LOD/coverage: cache hits must not enumerate document content.
      for (let pass = 0; pass < 3; pass++) {
        const frames: number[] = [],
          submissionMs: number[] = [];
        probe.resetQueries();
        const before = probe.stats().overview.builds;
        let previous = performance.now();
        for (let i = 0; i < 120; i++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          const now = performance.now();
          frames.push(now - previous);
          previous = now;
          const start = performance.now();
          probe.view(
            view.x + Math.sin(i / 12) * 32,
            view.y + Math.cos(i / 12) * 16,
            view.zoom,
          );
          submissionMs.push(performance.now() - start);
        }
        passes.push({
          frames,
          submissionMs,
          before,
          after: probe.stats().overview.builds,
          queries: probe.queries().length,
          stats: probe.stats(),
          gpu: window.gpuProbe(),
        });
      }
      probe.view(view.x, view.y, view.zoom);
      probe.resetQueries();
      return passes;
    }, cold.view);
    for (const pass of warm) {
      expect(pass.after).toBe(pass.before);
      expect(pass.queries).toBe(0);
    }

    const rebuilds = await page.evaluate(async (view) => {
      const probe = window.tileProbe,
        samples = [];
      for (let i = 0; i < 20; i++) {
        for (const operation of ["edit", "undo", "redo"] as const) {
          const start = performance.now(),
            before = probe.stats().overview.builds;
          if (operation === "edit")
            probe.edit(
              "buildings",
              316,
              318,
              i % 2 ? "#ffff00ff" : "#ff0000ff",
              8,
            );
          else probe.session.perform(operation);
          const submissionMs = performance.now() - start;
          while (probe.stats().overview.pending)
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            );
          samples.push({
            operation,
            submissionMs,
            readyMs: performance.now() - start,
            rebuilt: probe.stats().overview.builds - before,
          });
          probe.resetQueries();
        }
      }
      // Exercise new LOD, pan away/back and detail return without leaking older images.
      const levels = [];
      for (const zoom of [view.zoom * 2, view.zoom * 4, 1, view.zoom]) {
        const start = performance.now();
        probe.view(300, 300, zoom);
        while (probe.stats().overview.pending)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        levels.push({
          zoom,
          readyMs: performance.now() - start,
          stats: probe.stats(),
          gpu: window.gpuProbe(),
        });
        probe.resetQueries();
      }
      probe.view(view.x, view.y, view.zoom);
      while (probe.stats().overview.pending)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      probe.resetQueries();
      return { samples, levels, stats: probe.stats() };
    }, cold.view);
    for (const sample of rebuilds.samples) expect(sample.rebuilt).toBe(1);
    for (const level of rebuilds.levels) {
      expect(level.stats.overview.bytes).toBeLessThanOrEqual(OVERVIEW_BYTES);
      expect(
        level.gpu.textures -
          level.stats.overview.textures -
          level.stats.textures,
      ).toBeLessThanOrEqual(4);
    }
    await cdp.send("HeapProfiler.collectGarbage");
    const afterHeap = await cdp.send("Runtime.getHeapUsage");
    await page.evaluate(() => window.tileProbe.load("empty"));
    const disposed = await page.evaluate(() => window.tileProbe.disposed()!);
    expect(disposed.overview.bytes).toBe(0);
    expect(disposed.overview.created).toBe(disposed.overview.released);
    await cdp.send("HeapProfiler.collectGarbage");
    const replacementHeap = await cdp.send("Runtime.getHeapUsage");
    await page.evaluate(() => window.tileProbe.dispose());
    await expect
      .poll(() => page.evaluate(() => window.gpuProbe()))
      .toEqual({ contexts: 0, textures: 0, buffers: 0 });
    expect(errors).toEqual([]);
    const files = [
      "package-lock.json",
      "src/renderer/overview.ts",
      "src/renderer/overviewScene.ts",
      "src/renderer/tileScene.ts",
      "src/renderer/createRenderer.ts",
      "tests/fixtures/maps.ts",
      "tests/overview-scale.spec.ts",
    ];
    const sources = Object.fromEntries(
      await Promise.all(
        files.map(async (path) => [
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
      cold,
      samples,
      actual,
      warm,
      rebuilds,
      memory: { beforeHeap, overviewHeap, afterHeap, replacementHeap },
      disposed,
      errors,
      limitations:
        "rAF intervals and CPU render submission are proxies, not native presented frames. Cache bytes are exact RGBA payload (CPU plus an equal GPU payload); CDP memory is not native physical footprint. Cold warmup once, 3x120 warm frames, 20 edit/undo/redo cycles; TW-011 owns the release performance gate.",
    };
    const path = testInfo.outputPath(`${kind}-overview.json`);
    await writeFile(path, JSON.stringify(report, null, 2) + "\n");
    await testInfo.attach(`${kind}-overview`, {
      path,
      contentType: "application/json",
    });
    await context.close();
  });
}
