import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import { trackGpu } from "./gpu";
import expected from "./fixtures/expected.json" with { type: "json" };

for (const kind of ["frontier", "heartland"] as const)
  test(`${kind}: 1089 named areas on the complete populated map retain bounded labels through navigation and replacement`, async ({
    browser,
  }, info) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      deviceScaleFactor: 2,
      viewport: { width: 1080, height: 720 },
    });
    const page = await context.newPage();
    await trackGpu(page);
    await page.goto("/tests/tiles.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const imported = await page.evaluate(async (kind) => {
      await window.tileProbe.load(kind, true);
      window.tileProbe.resize(960, 640);
      return {
        annotations: JSON.stringify(
          window.tileProbe.session.document.annotations,
        ),
        storage: window.tileProbe.session.document.storageStats(),
      };
    }, kind);
    expect(JSON.parse(imported.annotations)).toHaveLength(1089);
    expect(imported.storage.occupiedCells).toBe(
      expected[`${kind}-v1`].occupiedLayerCells,
    );
    const cdp = await context.newCDPSession(page);
    const passes = [];
    for (let pass = 0; pass < 3; pass++) {
      const samples = await page.evaluate(async () => {
        const samples = [];
        const p = window.tileProbe;
        for (let i = 0; i < 120; i++) {
          const pixels = [24, 12, 8, 7.999999, 3, 2, 1, 0.999999, 0.24, 0.09][
            i % 10
          ];
          const x = (Math.floor(i / 10) % 10) * 640 + 320 + Math.sin(i) * 12;
          const y = (Math.floor(i / 30) % 10) * 640 + 320;
          const start = performance.now();
          p.view(x - (480 - 24) / pixels, y - (320 - 24) / pixels, pixels / 24);
          const submissionMs = performance.now() - start;
          const state = p.stats();
          samples.push({
            pixels,
            x,
            y,
            submissionMs,
            candidates: state.labels.candidates,
            live: state.labels.live,
            measurements: state.labels.measurements,
            created: state.labels.created,
            released: state.labels.released,
            tiers: [...new Set(state.labels.labels.map((l) => l.tier))],
            gpu: window.gpuProbe(),
            tileTextures: state.textures,
            overviewTextures: state.overview.textures,
          });
          p.resetQueries();
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
        p.view(300, 300, 0.5);
        return samples;
      });
      for (const sample of samples) {
        const tier =
          sample.pixels >= 8
            ? "detail"
            : sample.pixels >= 1
              ? "locality"
              : "region";
        expect(sample.tiers.every((t) => t === tier)).toBe(true);
        expect(sample.created - sample.released).toBe(sample.live);
        expect(sample.live).toBeLessThanOrEqual(sample.candidates);
        expect(sample.measurements).toBe(sample.candidates);
        expect(sample.gpu.contexts).toBe(1);
        expect(sample.gpu.textures).toBeLessThanOrEqual(
          sample.live + sample.tileTextures + sample.overviewTextures + 4,
        );
      }
      await cdp.send("HeapProfiler.collectGarbage");
      passes.push({
        samples,
        postGcHeap: await cdp.send("Runtime.getHeapUsage"),
      });
    }
    expect(
      await page.evaluate(() =>
        JSON.stringify(window.tileProbe.session.document.annotations),
      ),
    ).toBe(imported.annotations);
    expect(
      passes[2].postGcHeap.usedSize - passes[0].postGcHeap.usedSize,
    ).toBeLessThan(16 * 1024 * 1024);
    await page
      .locator("canvas")
      .screenshot({ path: info.outputPath(`${kind}-detail-labels.png`) });
    await page.evaluate(() => {
      const p = window.tileProbe;
      p.view(320 - (480 - 24) / 3, 320 - (320 - 24) / 3, 3 / 24);
    });
    await page
      .locator("canvas")
      .screenshot({ path: info.outputPath(`${kind}-locality-labels.png`) });
    await page.evaluate(() =>
      window.tileProbe.view(-253.333333, -242.222222, 0.09 / 24),
    );
    // Hosted software rendering takes longer to finish a complete overview.
    // This is a completion deadline, not the deferred presentation budget.
    await expect(page.locator("canvas")).toHaveAttribute("aria-busy", "false", {
      timeout: 60_000,
    });
    await page
      .locator("canvas")
      .screenshot({ path: info.outputPath(`${kind}-region-labels.png`) });
    const replacements = [];
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.tileProbe.load("empty"));
      const state = await page.evaluate(() => ({
        previous: window.tileProbe.disposed()!.labels,
        current: window.tileProbe.stats().labels,
        gpu: window.gpuProbe(),
      }));
      expect(state.previous.created).toBe(state.previous.released);
      expect(state.previous).toMatchObject({
        live: 0,
        measurements: 0,
        candidates: 0,
        labels: [],
      });
      expect(state.current.live).toBe(0);
      expect(state.gpu.contexts).toBe(1);
      expect(state.gpu.textures).toBeLessThanOrEqual(4);
      replacements.push(state);
      if (i < 2) await page.evaluate(() => window.tileProbe.load("areas"));
    }
    await page.evaluate(() => window.tileProbe.dispose());
    const teardown = await page.evaluate(() => window.gpuProbe());
    expect(teardown).toEqual({ contexts: 0, textures: 0, buffers: 0 });
    const sources: Record<string, string> = {};
    for (const file of [
      "src/renderer/areaLabels.ts",
      "src/renderer/areaLabelScene.ts",
      "src/renderer/createRenderer.ts",
      "tests/fixtures/areas.ts",
      "tests/area-labels-scale.spec.ts",
      "package-lock.json",
    ])
      sources[file] = createHash("sha256")
        .update(await readFile(file))
        .digest("hex");
    const percentile = (samples: number[], p: number) =>
      [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * p) - 1];
    const report = {
      fixture: `${kind}-v1`,
      golden: expected[`${kind}-v1`],
      occupiedLayerCells: imported.storage.occupiedCells,
      annotations: 1089,
      timestamp: new Date().toISOString(),
      mode: "Chromium WebGL 2, CPU navigation/render submission proxy; no native presentation or physical-memory claim",
      browser: browser.version(),
      node: process.version,
      os: release(),
      cpu: cpus()[0].model,
      ramBytes: totalmem(),
      canvas: { width: 960, height: 640, dpr: 2 },
      sources,
      summary: passes.map(({ samples }) => ({
        count: samples.length,
        p50: percentile(
          samples.map((s) => s.submissionMs),
          0.5,
        ),
        p95: percentile(
          samples.map((s) => s.submissionMs),
          0.95,
        ),
        p99: percentile(
          samples.map((s) => s.submissionMs),
          0.99,
        ),
        max: Math.max(...samples.map((s) => s.submissionMs)),
        maxLabels: Math.max(...samples.map((s) => s.live)),
        maxCandidates: Math.max(...samples.map((s) => s.candidates)),
      })),
      passes,
      replacements,
      teardown,
    };
    await writeFile(
      info.outputPath(`${kind}-label-profile.json`),
      JSON.stringify(report, null, 2),
    );
    await context.close();
  });
