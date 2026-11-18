import { trackGpu } from "./gpu";
import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { FIXTURES, FIXTURE_PALETTE, visitFixtureCells } from "./fixtures/maps";
import expected from "./fixtures/expected.json" with { type: "json" };
import type { TileProbe } from "./tiles-harness";

declare global {
  interface Window {
    tileProbe: TileProbe;
    gpuProbe(): { contexts: number; textures: number; buffers: number };
  }
}

for (const kind of ["frontier", "heartland"] as const) {
  test(`${kind}: populated target-scale pan keeps visible resources bounded and releases them`, async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    await trackGpu(page);
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const imported = await page.evaluate(async (kind) => {
      const start = performance.now();
      await window.tileProbe.load(kind);
      return {
        milliseconds: performance.now() - start,
        storage: window.tileProbe.session.document.storageStats(),
      };
    }, kind);
    const golden = expected[`${kind}-v1`];
    expect(imported.storage.occupiedCells).toBe(golden.occupiedLayerCells);
    const spec = FIXTURES.find((fixture) => fixture.id === `${kind}-v1`)!;
    // Independent recipe oracle, including terrain below empty upper cells.
    for (const [x, y] of [
      [314, 314],
      [5900, 5900],
      [90, 90],
    ]) {
      const colors = new Map<string, number>();
      visitFixtureCells(
        spec,
        (_layer, x, y, paint) => colors.set(`${x},${y}`, paint),
        { minX: x, minY: y, maxX: x + 12, maxY: y + 12 },
      );
      const points: [number, number][] = [];
      for (let py = y; py < y + 12; py++)
        for (let px = x; px < x + 12; px++) points.push([px, py]);
      const pixels = await page.evaluate(
        ({ x, y, points }) => {
          window.tileProbe.view(x, y);
          return window.tileProbe.sample(points);
        },
        { x, y, points },
      );
      expect(pixels).toEqual(
        points.map(([x, y]) => {
          const paint = colors.get(`${x},${y}`);
          if (paint === undefined) return [29, 39, 50, 255];
          const rgba = FIXTURE_PALETTE[paint].rgba;
          return [1, 3, 5, 7].map((offset) =>
            parseInt(rgba.slice(offset, offset + 2), 16),
          );
        }),
      );
    }
    await page.evaluate(() => window.tileProbe.view(300, 300, 0.5));
    await page
      .locator("canvas")
      .screenshot({ path: testInfo.outputPath(`${kind}-detail.png`) });
    const stable = await page.evaluate(() => {
      const before = window.tileProbe.stats();
      window.tileProbe.resetQueries();
      for (let i = 0; i < 20; i++)
        window.tileProbe.view(300 + i / 100, 300 + i / 100, 0.5);
      return {
        before,
        after: window.tileProbe.stats(),
        queries: window.tileProbe.queries(),
      };
    });
    expect(stable.after.builds).toBe(stable.before.builds);
    expect(stable.queries).toEqual([]);
    const cdp = await page.context().newCDPSession(page);
    const sweeps = [];
    for (let sweep = 0; sweep < 3; sweep++) {
      const samples = await page.evaluate(async () => {
        const samples = [];
        const route = Array.from({ length: 80 }, (_, i) => [
          i * 79,
          300 + (i % 8) * 64,
        ]);
        route.push([5900, 5900], [6380, 6380], [320, 320]);
        for (const [x, y] of route) {
          window.tileProbe.resetQueries();
          const start = performance.now();
          window.tileProbe.view(x, y, 0.5);
          const milliseconds = performance.now() - start;
          const stats = window.tileProbe.stats();
          const queryCount = window.tileProbe.queries().length;
          samples.push({
            x,
            y,
            milliseconds,
            ...stats,
            queryCount,
            gpu: window.gpuProbe(),
          });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        window.tileProbe.resetQueries();
        return samples;
      });
      for (const sample of samples) {
        expect(sample.chunks).toBeLessThanOrEqual(48);
        expect(sample.textures).toBeLessThanOrEqual(sample.chunks);
        expect(sample.created - sample.released).toBe(sample.textures);
        expect(sample.textureBytes).toBe(sample.textures * 4096);
        expect(sample.queryCount).toBeLessThanOrEqual(48);
        expect(sample.gpu.contexts).toBe(1);
        // Pixi owns a small constant set of default/shared textures beyond tiles.
        expect(sample.gpu.textures - sample.textures).toBeLessThanOrEqual(4);
        expect(sample.gpu.buffers).toBeLessThanOrEqual(12);
      }
      expect(samples.find((sample) => sample.x === 5900)?.textures).toBe(0);
      await cdp.send("HeapProfiler.collectGarbage");
      sweeps.push({
        samples,
        postGcHeap: await cdp.send("Runtime.getHeapUsage"),
      });
    }
    // Compare after warm-up at the identical final viewport. Generous leak guard,
    // not an app memory/performance target or a claim about physical GPU memory.
    expect(
      sweeps[2].postGcHeap.usedSize - sweeps[0].postGcHeap.usedSize,
    ).toBeLessThan(8 * 1024 * 1024);
    const replacement = await page.evaluate(async () => {
      await window.tileProbe.load("empty");
      return {
        old: window.tileProbe.disposed(),
        current: window.tileProbe.stats(),
        gpu: window.gpuProbe(),
      };
    });
    expect(replacement.old?.created).toBe(replacement.old?.released);
    expect(replacement.current.textures).toBe(0);
    await cdp.send("HeapProfiler.collectGarbage");
    const replacementHeap = await cdp.send("Runtime.getHeapUsage");
    expect(replacementHeap.usedSize).toBeLessThan(
      sweeps[2].postGcHeap.usedSize,
    );
    await page.evaluate(() => window.tileProbe.dispose());
    await expect
      .poll(() => page.evaluate(() => window.gpuProbe()))
      .toEqual({ contexts: 0, textures: 0, buffers: 0 });
    const files = [
      "package-lock.json",
      "src/domain/document.ts",
      "src/renderer/chunks.ts",
      "src/renderer/colors.ts",
      "src/renderer/tileScene.ts",
      "src/renderer/createRenderer.ts",
      "tests/fixtures/maps.ts",
      "tests/tiles-scale.spec.ts",
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
      fixture: golden,
      environment: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0].model,
        ram: totalmem(),
        node: process.version,
        browser: browser.version(),
        mode: "Chromium WebGL2 / Vite development; CDP post-GC heap",
        canvas: { width: 800, height: 600, dpr: 1, zoom: 0.5 },
      },
      sources,
      imported,
      stable,
      sweeps,
      replacement,
      replacementHeap,
      disposed: await page.evaluate(() => window.tileProbe.stats()),
      limitations:
        "CPU submission time, not presented-frame latency. Pixel-buffer accounting excludes driver/shared resources. CDP heap is not process RSS or native WKWebView memory. No overview caches or full-map-zoom budgets claimed.",
    };
    const path = testInfo.outputPath(`${kind}-renderer.json`);
    await writeFile(path, JSON.stringify(report, null, 2) + "\n");
    await testInfo.attach(`${kind}-renderer`, {
      path,
      contentType: "application/json",
    });
  });
}
