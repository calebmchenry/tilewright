import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { cpus, totalmem, release } from "node:os";

type FillReport = {
  ok: boolean;
  durationMs: number;
  cancellationMs: number | null;
  frames: number;
  timerGapsMs: number[];
  progress: { ms: number; cells: number }[];
  commitNotificationMs: number | null;
};
declare global {
  interface Window {
    fillRun: Promise<FillReport>;
    fillCancelAt: number | null;
  }
}
async function audit(page: Page) {
  return page.evaluate(async () => {
    const s = window.editorProbe.session,
      d = s.document;
    const digest = async (text: string) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
        ),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
    const hashes: Record<string, string> = {};
    for (const layer of d.layers) {
      let batch: string[] = [],
        chunks: Promise<string>[] = [];
      for (const run of d.iterateRuns(layer.id)) {
        batch.push(JSON.stringify(run));
        if (batch.length === 4096) {
          chunks.push(digest(batch.join("\n")));
          batch = [];
        }
      }
      if (batch.length) chunks.push(digest(batch.join("\n")));
      hashes[layer.id] = await digest((await Promise.all(chunks)).join("\n"));
    }
    return {
      hashes,
      storage: d.storageStats(),
      bounds: d.bounds,
      layers: d.layers,
      registry: d.registryEntries,
      annotations: d.annotations,
      version: d.version,
      history: s.history.state,
      invalidations: window.editorProbe.invalidations.length,
    };
  });
}
async function start(page: Page) {
  await page.evaluate(() => {
    const s = window.editorProbe.session,
      started = performance.now();
    const progress: FillReport["progress"] = [],
      timerGapsMs: number[] = [];
    let last = started,
      frames = 0,
      raf = 0,
      commitNotificationMs: number | null = null;
    window.fillCancelAt = null;
    const frame = () => {
      frames++;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const interval = setInterval(() => {
      const now = performance.now();
      timerGapsMs.push(now - last);
      last = now;
    }, 16);
    const stopProgress = s.fill.progress.subscribe(() => {
      const p = s.fill.progress.getSnapshot();
      if (p) progress.push({ ms: performance.now() - started, cells: p.cells });
    });
    const stopDoc = s.document.subscribe(() => {
      commitNotificationMs = performance.now() - started;
    });
    const click = (event: Event) => {
      if (
        (event.target as HTMLElement).closest("button")?.textContent ===
        "Cancel fill"
      )
        window.fillCancelAt = performance.now();
    };
    document.addEventListener("click", click, true);
    const view = s.viewport.getSnapshot(),
      point = {
        x: 24 + (300.5 - view.x) * 24 * view.zoom,
        y: 24 + (300.5 - view.y) * 24 * view.zoom,
      };
    window.fillRun = s.fill.start(point).then((ok) => {
      const finished = performance.now();
      cancelAnimationFrame(raf);
      clearInterval(interval);
      stopProgress();
      stopDoc();
      document.removeEventListener("click", click, true);
      return {
        ok,
        durationMs: finished - started,
        cancellationMs:
          window.fillCancelAt === null ? null : finished - window.fillCancelAt,
        frames,
        timerGapsMs,
        progress,
        commitNotificationMs,
      };
    });
  });
}

for (const [fixture, occupied] of [
  ["frontier", 6620700],
  ["heartland", 24025200],
] as const)
  test(`${fixture}: million-cell fill and cancel on complete populated target map`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    await page.goto(`/tests/editor.html?fixture=${fixture}`);
    await expect(
      page.getByRole("status", { name: "Canvas status" }),
    ).toHaveText("Canvas ready");
    const original = await audit(page);
    expect(original.storage.occupiedCells).toBe(occupied);
    // Deliberate 1024-square contiguous region on existing terrain, preserving
    // the full four-layer fixture elsewhere and all overlapping upper content.
    await page.evaluate(() => {
      const s = window.editorProbe.session,
        layerId = s.document.layers[0].id;
      s.execute("Contiguous fixture region", [
        {
          kind: "tiles",
          writes: Array.from({ length: 1024 }, (_, i) => ({
            layerId,
            x: 256,
            y: 256 + i,
            length: 1024,
            value: { kind: "raw" as const, rgba: "#102030ff" },
          })),
        },
      ]);
      s.selectLayer(layerId);
      s.setColor("#d04020");
      s.viewport.set({ x: 290, y: 290, zoom: 1 });
      s.perform("fill");
      s.history.markSaved(s.history.captureCheckpoint());
      s.history.markRecovery(s.history.captureCheckpoint());
    });
    const before = await audit(page),
      host = page.locator(".canvas-host");
    await start(page);
    const progress = page.getByRole("status", { name: "Fill progress" });
    await expect(progress).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.editorProbe.session.fill.progress.getSnapshot()?.cells ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    const view = await page.evaluate(() =>
      window.editorProbe.session.viewport.getSnapshot(),
    );
    await host.press("ArrowRight");
    expect(
      await page.evaluate(() =>
        window.editorProbe.session.viewport.getSnapshot(),
      ),
    ).not.toEqual(view);
    expect(
      await page.evaluate(() => window.editorProbe.session.document.version),
    ).toBe(before.version);
    await page.screenshot({ path: info.outputPath("fill-progress.png") });
    await page
      .getByRole("button", { name: "Cancel fill", exact: true })
      .click();
    const canceled = await page.evaluate(() => window.fillRun);
    expect(canceled.ok).toBe(false);
    expect(canceled.frames).toBeGreaterThan(0);
    expect(canceled.cancellationMs).not.toBeNull();
    expect(canceled.commitNotificationMs).toBeNull();
    expect(await audit(page)).toEqual(before);
    await page.evaluate(() =>
      window.editorProbe.session.viewport.set({ x: 290, y: 290, zoom: 1 }),
    );
    await start(page);
    await expect(progress).toBeVisible();
    const filled = await page.evaluate(() => window.fillRun);
    expect(filled.ok).toBe(true);
    expect(filled.frames).toBeGreaterThan(0);
    expect(filled.progress.at(-1)?.cells).toBe(1024 ** 2);
    await expect(progress).toHaveCount(0);
    const after = await audit(page);
    expect(after.history.undoSteps).toBe(before.history.undoSteps + 1);
    expect(after.invalidations).toBe(before.invalidations + 1);
    for (const id of ["buildings", "furniture", "canopy"])
      expect(after.hashes[id]).toBe(before.hashes[id]);
    expect(after.bounds).toEqual(before.bounds);
    expect(after.registry).toEqual(before.registry);
    expect(after.annotations).toEqual(before.annotations);
    expect(
      await page.evaluate(() => {
        const s = window.editorProbe.session,
          id = s.document.layers[0].id;
        const runs = [
          ...s.document.iterateRuns(id, {
            minX: 256,
            minY: 256,
            maxX: 1280,
            maxY: 1280,
          }),
        ];
        return (
          runs.length === 1024 &&
          runs.every(
            (r) =>
              r.x === 256 &&
              r.length === 1024 &&
              r.value.kind === "raw" &&
              r.value.rgba === "#d04020ff",
          )
        );
      }),
    ).toBe(true);
    const undoMs = await page.evaluate(() => {
      const s = window.editorProbe.session,
        t = performance.now();
      s.perform("undo");
      return performance.now() - t;
    });
    const undone = await audit(page);
    expect(undone.hashes).toEqual(before.hashes);
    expect(undone.history.dirty).toBe(false);
    const redoMs = await page.evaluate(() => {
      const s = window.editorProbe.session,
        t = performance.now();
      s.perform("redo");
      return performance.now() - t;
    });
    expect((await audit(page)).hashes).toEqual(after.hashes);
    const report = {
      fixture,
      original,
      before,
      after,
      canceled,
      filled,
      undoMs,
      redoMs,
      environment: {
        browser: page.context().browser()?.version(),
        cpu: cpus()[0].model,
        ram: totalmem(),
        os: release(),
        node: process.version,
        dpr: await page.evaluate(() => devicePixelRatio),
      },
      limits:
        "Chromium development; timer/rAF proxies, no native presentation or physical-memory budget claim.",
    };
    await writeFile(
      info.outputPath("fill-measurement.json"),
      JSON.stringify(report, null, 2),
    );
  });
