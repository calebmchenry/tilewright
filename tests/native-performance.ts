import {
  createRenderer,
  type CanvasRenderer,
} from "../src/renderer/createRenderer";
import { bindDocument } from "../src/renderer/bindDocument";
import { EditorSession } from "../src/editor/session";
import type { TileWrite } from "../src/domain/document";
import { layerId, rawColor } from "../src/domain/values";
import type { Viewport } from "../src/editor/viewport";
import { populatedDocument } from "./fixtures/populated";
import { FIXTURES, FIXTURE_PALETTE, visitFixtureCells } from "./fixtures/maps";
import expected from "./fixtures/expected.json";

const native = (
  window as unknown as {
    __TAURI_INTERNALS__: { invoke<T>(name: string, args?: object): Promise<T> };
  }
).__TAURI_INTERNALS__;
const host = document.getElementById("map")!;
const status = document.getElementById("status")!;
const raf = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function report(kind: string, data: object = {}) {
  await native.invoke("performance_event", {
    payload: JSON.stringify({ kind, at: Date.now(), ...data }),
  });
}
function summary(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number) => sorted[Math.ceil(p * sorted.length) - 1];
  return {
    count: samples.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted.at(-1),
    missed60HzIntervals: samples.reduce(
      (n, ms) => n + Math.max(0, Math.round(ms / (1000 / 60)) - 1),
      0,
    ),
  };
}
let session: EditorSession;
let renderer: CanvasRenderer;
let stops: (() => void)[] = [];
let queries = 0,
  maxQueryArea = 0;
let fixture = 0;
function resetQueries() {
  queries = 0;
  maxQueryArea = 0;
}
function viewCenter(x: number, y: number, scale: number): Viewport {
  return {
    x: x - (512 - 24) / scale,
    y: y - (320 - 24) / scale,
    zoom: scale / 24,
  };
}
function setView(view: Viewport) {
  session.viewport.set(view);
}
async function ready() {
  const start = performance.now();
  while (renderer.snapshot().overview.pending) {
    check(performance.now() - start < 30000, "Overview timed out");
    await raf();
  }
  await raf();
}
async function load(index: number, scenario: string) {
  status.textContent = `${FIXTURES[index].id} · ${scenario}`;
  for (const stop of stops) stop();
  renderer?.destroy();
  session?.dispose();
  await report("loading", { fixture: FIXTURES[index].id, scenario });
  await raf();
  const start = performance.now();
  fixture = index;
  const map = populatedDocument(index);
  check(
    map.storageStats().occupiedCells ===
      expected[FIXTURES[index].id as keyof typeof expected].occupiedLayerCells,
    "Wrong occupied count",
  );
  check(map.layers.length === 4, "Missing layers");
  const iterate = map.iterateRuns.bind(map);
  map.iterateRuns = (id, bounds) => {
    queries++;
    check(bounds, "Renderer must use bounded queries");
    maxQueryArea = Math.max(
      maxQueryArea,
      (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY),
    );
    return iterate(id, bounds);
  };
  session = new EditorSession(map);
  session.setCanvasSize(1024, 640);
  session.viewport.set(viewCenter(320, 320, 16));
  renderer = await createRenderer(host, session, (error) => {
    throw error;
  });
  stops = [
    bindDocument(session, (change) => renderer.invalidate(change)),
    session.viewport.subscribe(() => renderer.resize()),
    session.hiddenLayers.subscribe(() => renderer.resize()),
    session.rectangle.subscribe(() => renderer.resize()),
  ];
  renderer.resize();
  await raf();
  await report("loaded", {
    fixture: FIXTURES[index].id,
    scenario,
    ms: performance.now() - start,
    storage: map.storageStats(),
  });
  resetQueries();
}
// Synchronous pixel checks are outside every timed interval. All fixtures are opaque.
function verifyDetail() {
  setView(viewCenter(320, 320, 16));
  renderer.resize();
  const canvas = host.querySelector("canvas")!;
  const gl = canvas.getContext("webgl2")!;
  const points: [number, number][] = [
    [314, 314],
    [316, 316],
    [319, 319],
    [321, 321],
    [325, 325],
    [330, 330],
  ];
  const colors = new Map<string, string>();
  visitFixtureCells(
    FIXTURES[fixture],
    (_layer, x, y, paint) =>
      colors.set(`${x},${y}`, FIXTURE_PALETTE[paint].rgba),
    { minX: 314, minY: 314, maxX: 331, maxY: 331 },
  );
  const view = session.viewport.getSnapshot();
  for (const [x, y] of points) {
    const pixel = new Uint8Array(4);
    gl.readPixels(
      Math.floor((24 + (x + 0.5 - view.x) * 16) * devicePixelRatio),
      canvas.height -
        1 -
        Math.floor((24 + (y + 0.5 - view.y) * 16) * devicePixelRatio),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );
    const rgba = colors.get(`${x},${y}`) ?? "#1d2732ff";
    check(
      [...pixel].every(
        (v, c) =>
          Math.abs(v - parseInt(rgba.slice(1 + c * 2, 3 + c * 2), 16)) <= 1,
      ),
      `Wrong native pixel ${x},${y}: ${pixel} expected ${rgba}`,
    );
  }
}
function detailRoute(ms: number): Viewport {
  const t = ms % 12000;
  const corners = [
    [280, 280],
    [360, 280],
    [360, 360],
    [280, 360],
    [280, 280],
  ];
  if (t < 8000) {
    const i = Math.floor(t / 2000),
      f = (t % 2000) / 2000;
    return viewCenter(
      corners[i][0] + (corners[i + 1][0] - corners[i][0]) * f,
      corners[i][1] + (corners[i + 1][1] - corners[i][1]) * f,
      16,
    );
  }
  return viewCenter(320, 320, 16 + 16 * (1 - Math.abs((t - 8000) / 2000 - 1)));
}
function overviewRoute(ms: number): Viewport {
  const t = ms % 10000;
  if (t < 2000) return viewCenter(3200, 3200, 0.1);
  if (t < 4000) return viewCenter(3200, 3200, 0.1 + (0.1 * (t - 2000)) / 2000);
  if (t < 6000) return viewCenter(3200 + (640 * (t - 4000)) / 2000, 3200, 0.2);
  if (t < 8000) return viewCenter(3840 - (640 * (t - 6000)) / 2000, 3200, 0.2);
  return viewCenter(3200, 3200, 0.2 - (0.1 * (t - 8000)) / 2000);
}
async function navigation(
  index: number,
  scenario: "detail" | "overview",
  repetition: number,
  full: boolean,
) {
  await load(index, `${scenario} ${repetition}`);
  verifyDetail();
  const route = scenario === "detail" ? detailRoute : overviewRoute;
  let started = performance.now();
  setView(route(0));
  await ready();
  const initialReadyMs = performance.now() - started;
  await report("cold", {
    fixture: FIXTURES[index].id,
    scenario,
    repetition,
    initialReadyMs,
    stats: renderer.snapshot(),
  });
  started = await raf();
  while ((await raf()) - started < (full ? 5000 : 1000))
    setView(route(performance.now() - started));
  resetQueries();
  const frames: number[] = [],
    cpu: number[] = [],
    nextFrameProxy: number[] = [];
  const inputs: {
    id: number;
    delivered: number;
    committed: number;
    nextRaf: number;
  }[] = [];
  let previous = await raf();
  started = previous;
  await report("navigation-start", {
    fixture: FIXTURES[index].id,
    scenario,
    repetition,
  });
  while (previous - started < (full ? 60000 : 3000)) {
    const now = await raf();
    frames.push(now - previous);
    if (inputs.length) {
      inputs.at(-1)!.nextRaf = now;
      nextFrameProxy.push(now - inputs.at(-1)!.delivered);
    }
    previous = now;
    const delivered = performance.now();
    setView(route(now - started));
    const committed = performance.now();
    cpu.push(committed - delivered);
    inputs.push({ id: inputs.length, delivered, committed, nextRaf: 0 });
  }
  inputs.at(-1)!.nextRaf = await raf();
  nextFrameProxy.push(inputs.at(-1)!.nextRaf - inputs.at(-1)!.delivered);
  await report("navigation", {
    fixture: FIXTURES[index].id,
    scenario,
    repetition,
    frames,
    cpu,
    nextFrameProxy,
    inputs,
    frameSummary: summary(frames),
    cpuSummary: summary(cpu),
    proxySummary: summary(nextFrameProxy),
    queries,
    maxQueryArea,
    stats: renderer.snapshot(),
    hidden: document.hidden,
  });
  verifyDetail();
  await report("pixels", {
    fixture: FIXTURES[index].id,
    scenario,
    repetition,
    passed: true,
  });
}
function smallMove(): TileWrite[] {
  const source = { minX: 316, minY: 316, maxX: 324, maxY: 324 };
  const writes: TileWrite[] = [],
    moved: TileWrite[] = [];
  for (const id of [layerId("buildings"), layerId("furniture")])
    for (const run of session.document.iterateRuns(id, source)) {
      writes.push({ ...run, value: null });
      moved.push({ ...run, x: run.x + 3 });
    }
  return [...writes, ...moved];
}
async function edits(index: number, full: boolean, memory = false) {
  await load(index, "commands and invalidation");
  verifyDetail();
  const bounds = { minX: 312, minY: 312, maxX: 332, maxY: 332 };
  const original = JSON.stringify([
    ...session.document.iterateRuns(undefined, bounds),
  ]);
  if (memory) await delay(10000);
  await report("memory-before-cycles", {
    fixture: FIXTURES[index].id,
    stats: renderer.snapshot(),
  });
  for (const size of [8, 512, 1024]) {
    const operations = [];
    for (let trial = 0; trial < (full ? 20 : 2); trial++) {
      const writes: TileWrite[] =
        size === 8
          ? smallMove()
          : Array.from({ length: size }, (_, i) => ({
              layerId: layerId("terrain"),
              x: 256,
              y: 256 + i,
              length: size,
              value: rawColor("#ff00ffff"),
            }));
      for (const action of ["edit", "undo", "redo"] as const) {
        resetQueries();
        const before = renderer.snapshot();
        await raf();
        const start = performance.now();
        if (action === "edit")
          check(
            session.execute("Performance edit", [{ kind: "tiles", writes }]),
            "Edit rejected",
          );
        else session.perform(action);
        const submitted = performance.now();
        await ready();
        const after = renderer.snapshot();
        operations.push({
          trial,
          action,
          submissionMs: submitted - start,
          nextFrameProxyMs: performance.now() - start,
          queries,
          maxQueryArea,
          detailBuilds: after.builds - before.builds,
          overviewBuilds: after.overview.builds - before.overview.builds,
        });
        if (size === 8) {
          check(
            queries <= 10 && maxQueryArea <= 1024,
            "Small edit traversed beyond affected detail chunks",
          );
          if (action === "undo")
            check(
              JSON.stringify([
                ...session.document.iterateRuns(undefined, bounds),
              ]) === original,
              "Undo failed to restore overwritten cells",
            );
        }
      }
      session.perform("undo"); // Reset the fixture before the next trial.
      await ready();
    }
    await report("edits", {
      fixture: FIXTURES[index].id,
      size,
      operations,
      stats: renderer.snapshot(),
    });
  }
  verifyDetail();
  if (memory) await delay(10000);
  await report("memory-after-cycles", {
    fixture: FIXTURES[index].id,
    stats: renderer.snapshot(),
  });
  setView(viewCenter(3200, 3200, 0.1));
  await ready();
  const rebuilds = [];
  for (let trial = 0; trial < (full ? 20 : 2); trial++) {
    const writes = smallMove();
    for (const action of ["edit", "undo", "redo"] as const) {
      const before = renderer.snapshot().overview.builds;
      resetQueries();
      const start = performance.now();
      if (action === "edit")
        session.execute("Overview move", [{ kind: "tiles", writes }]);
      else session.perform(action);
      const submitted = performance.now();
      await ready();
      const rebuilt = renderer.snapshot().overview.builds - before;
      check(
        rebuilt === 1,
        "Small edit rebuilt more than its one overview region",
      );
      check(maxQueryArea <= 4096, "Overview query not bounded");
      rebuilds.push({
        trial,
        action,
        submissionMs: submitted - start,
        nextFrameProxyMs: performance.now() - start,
        rebuilt,
        queries,
        maxQueryArea,
      });
    }
    session.perform("undo");
    await ready();
  }
  await report("invalidation", {
    fixture: FIXTURES[index].id,
    rebuilds,
    stats: renderer.snapshot(),
  });
  if (memory) await delay(10000);
  // Stay on the overview briefly for native visual inspection/capture.
  await delay(full ? 3000 : 1000);
}
async function run() {
  const mode = await native.invoke<string>("performance_mode");
  const full = mode !== "quick";
  await report("environment", {
    mode,
    userAgent: navigator.userAgent,
    origin: location.origin,
    canvas: {
      width: host.clientWidth,
      height: host.clientHeight,
      dpr: devicePixelRatio,
    },
    measurement:
      "rAF intervals and next-rAF latency are proxies, not presented frames; native trace required separately.",
  });
  check(devicePixelRatio === 2, "Baseline requires DPR 2");
  await delay(3000);
  for (let index = 0; index < 2; index++) {
    if (mode !== "memory")
      for (const scenario of ["detail", "overview"] as const)
        for (let repetition = 1; repetition <= (full ? 3 : 1); repetition++)
          await navigation(index, scenario, repetition, full);
    await edits(index, full, mode === "memory");
  }
  status.textContent = "Benchmark complete · inspect overview";
  await report("complete");
}
void run().catch(async (error: unknown) => {
  status.textContent = `FAILED: ${String(error)}`;
  await report("failure", {
    error: String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
});
