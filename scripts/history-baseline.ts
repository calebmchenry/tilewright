import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { CommandHistory } from "../src/domain/history.ts";
import {
  type MapDocument,
  type TileWrite,
  type MutationResult,
} from "../src/domain/document.ts";
import { layerId, rawColor, equalCells } from "../src/domain/values.ts";
import {
  fixtureRunsFromDocument,
  loadFixtureDocument,
  MODEL_LAYERS,
} from "../tests/fixtures/document.ts";
import { inspectFixture } from "../tests/fixtures/inspect.ts";
import { FIXTURES } from "../tests/fixtures/maps.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const editLayers = [layerId("edit-a"), layerId("edit-b")];
const beforePaint = rawColor("#202020ff"),
  afterPaint = rawColor("#ffcc00ff");
const expected = JSON.parse(
  readFileSync(resolve(root, "tests/fixtures/expected.json"), "utf8"),
);
function* writes(length: number, value = beforePaint): Generator<TileWrite> {
  for (const id of editLayers)
    for (let y = 0; y < 6400; y += 32)
      for (let x = 60; x < 6400; x += 64)
        yield { layerId: id, x, y, length: Math.min(length, 6400 - x), value };
}
// Last span is clipped at the fixed edge: 318,400 touched cells / 40,000 writes.
const editedCells = [...writes(8)].reduce((n, run) => n + run.length, 0);
function backgroundHash(document: MapDocument) {
  const hash = createHash("sha256");
  for (const layer of MODEL_LAYERS)
    for (const run of document.iterateRuns(layer.id))
      hash.update(JSON.stringify(run) + "\n");
  return hash.digest("hex");
}
function validateEditLayers(document: MapDocument, edited: boolean) {
  const actual = editLayers.flatMap((id) => [...document.iterateRuns(id)]);
  assert.deepEqual(actual, [
    ...writes(edited ? 8 : 4, edited ? afterPaint : beforePaint),
  ]);
}
function measure(id: string) {
  if (!global.gc) throw new Error("Measurement requires --expose-gc.");
  const fixture = FIXTURES.find((item) => item.id === id);
  if (!fixture && id !== "empty") throw new Error(`Unknown fixture ${id}`);
  const document = loadFixtureDocument(fixture);
  if (fixture)
    assert.deepEqual(
      inspectFixture(fixture, fixtureRunsFromDocument(document)),
      expected[id],
    );
  const originalHash = backgroundHash(document),
    backgroundStorage = document.storageStats();
  for (const layer of editLayers) document.addLayer({ id: layer, name: layer });
  document.writeBatch(writes(4));
  const history = new CommandHistory(document, {
    initiallySaved: true,
    limits: { maxEntries: 1 },
  });
  const notifications: {
    direction: string;
    runs: number;
    cells: number;
    layers: string[];
  }[] = [];
  let direction = "commit";
  const stop = document.subscribe((event) => {
    assert.equal(event.kind, "transaction");
    if (event.kind !== "transaction") throw new Error("Expected transaction");
    assert.equal(event.changes.length, 1);
    const tiles = event.changes[0];
    assert.equal(tiles.kind, "tiles");
    if (tiles.kind !== "tiles") throw new Error("Expected tiles");
    let cells = 0;
    const layers = new Set<string>();
    for (const run of tiles.runs) {
      assert.ok(editLayers.includes(run.layerId));
      assert.equal(run.y % 32, 0);
      assert.ok(run.x % 64 === 60 || run.x % 64 === 0);
      assert.equal(run.length, 4);
      const original = run.x % 64 === 60 ? beforePaint : null;
      assert.ok(
        equalCells(run.before, direction === "undo" ? afterPaint : original),
      );
      assert.ok(
        equalCells(run.after, direction === "undo" ? original : afterPaint),
      );
      cells += run.length;
      layers.add(run.layerId);
    }
    assert.equal(cells, editedCells);
    assert.equal(history.state.dirty, direction !== "undo");
    notifications.push({
      direction,
      runs: tiles.runs.length,
      cells,
      layers: [...layers].sort(),
    });
  });
  const snapshot = () => {
    global.gc!();
    return process.memoryUsage();
  };
  const before = snapshot();
  const timed = (name: string, operation: () => MutationResult) => {
    direction = name;
    const start = performance.now();
    const result = operation();
    const ms = performance.now() - start;
    assert.deepEqual(result.observerErrors, []);
    assert.ok(result.change);
    return { ms, afterOperation: process.memoryUsage() };
  };
  const commit = timed("commit", () =>
    history.execute("large sparse edit", [
      { kind: "tiles", writes: [...writes(8, afterPaint)] },
    ]),
  );
  const committed = snapshot(),
    retainedHistory = history.state;
  validateEditLayers(document, true);
  const undo = timed("undo", () => history.undo());
  const undone = snapshot();
  validateEditLayers(document, false);
  assert.equal(history.state.dirty, false);
  const redo = timed("redo", () => history.redo());
  const redone = snapshot();
  validateEditLayers(document, true);
  assert.equal(history.state.dirty, true);
  assert.equal(notifications.length, 3);
  const originalAfter = backgroundHash(document);
  assert.equal(originalAfter, originalHash);
  assert.deepEqual(
    document.storageStats().layers.slice(0, MODEL_LAYERS.length),
    backgroundStorage.layers,
  );
  stop();
  // A tiny second transaction evicts the large history entry; edited content stays.
  history.execute("evict", [
    {
      kind: "tiles",
      writes: [
        { layerId: editLayers[0], x: 0, y: 1, length: 1, value: afterPaint },
      ],
    },
  ]);
  const pruned = snapshot();
  assert.equal(history.state.undoSteps, 1);
  assert.ok(history.state.retainedBytes < 2048);
  const delta = (a: NodeJS.MemoryUsage, b: NodeJS.MemoryUsage) =>
    a.heapUsed + a.arrayBuffers - b.heapUsed - b.arrayBuffers;
  return {
    id,
    backgroundGoldenMatched: fixture ? true : null,
    backgroundContentHash: originalHash,
    backgroundUnchanged: true,
    backgroundStorage,
    editedCells,
    overwrittenCells: 160000,
    inputRuns: 40000,
    notifications,
    retainedHistory,
    prunedHistory: history.state,
    timing: { commit, undo, redo },
    memoryBytes: {
      before,
      committed,
      undone,
      redone,
      pruned,
      commitHeapAndBuffersDelta: delta(committed, before),
      undoHeapAndBuffersDelta: delta(undone, before),
      redoHeapAndBuffersDelta: delta(redone, before),
      releasedByHistoryEviction: delta(redone, pruned),
    },
    processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

if (args.length === 2 && args[0] === "--measure")
  console.log(JSON.stringify(measure(args[1])));
else {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output"))
    throw new Error("Usage: npm run perf:history -- [--output path.json]");
  const measurements = ["empty", "heartland-v1"].map((id) => {
    const passes = [1, 2].map((pass) => {
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          ["--expose-gc", fileURLToPath(import.meta.url), "--measure", id],
          { encoding: "utf8", maxBuffer: 1024 * 1024 },
        ),
      ) as ReturnType<typeof measure>;
      console.log(
        `${id} pass ${pass}: commit/undo/redo ${result.timing.commit.ms.toFixed(2)}/${result.timing.undo.ms.toFixed(2)}/${result.timing.redo.ms.toFixed(2)} ms; retained delta ${(result.memoryBytes.commitHeapAndBuffersDelta / 2 ** 20).toFixed(2)} MiB; history eviction released ${(result.memoryBytes.releasedByHistoryEviction / 2 ** 20).toFixed(2)} MiB`,
      );
      return { pass, ...result };
    });
    assert.deepEqual(passes[0].notifications, passes[1].notifications);
    assert.deepEqual(passes[0].retainedHistory, passes[1].retainedHistory);
    return { id, passes };
  });
  const native = (command: string, argv: string[]) =>
    execFileSync(command, argv, { encoding: "utf8" }).trim();
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    scope:
      "Atomic large sparse edit and undo/redo with verified notification content; domain only, no rendered-frame or desktop performance budget claim.",
    method:
      "Two fresh Node --expose-gc processes per background. Full 6400x6400 four-layer background (empty or golden-verified heartland). Two edit layers each seed 200 rows x 100 four-cell runs. Replace with eight-cell runs crossing storage/visual boundaries, clipped only in fixture construction at x=6400. Timing includes command generation/copies, storage, inverse capture, compaction, history accounting and validating notification listener. Post-GC heapUsed + arrayBuffers deltas include runtime/JIT and changed storage/history, not physical app footprint. External already includes ArrayBuffers. Before/after memory snapshots do not establish transient heap peak; maxRSS is the whole process high-water mark. A tiny edit under maxEntries=1 evicts the large history entry for a release measurement; GC outside timing. Full edited-layer equality and background hashing outside operation timing. No percentile claim from two samples.",
    inputsSha256: Object.fromEntries(
      [
        "package.json",
        "package-lock.json",
        ".nvmrc",
        "src/domain/coordinates.ts",
        "src/domain/values.ts",
        "src/domain/storage.ts",
        "src/domain/document.ts",
        "src/domain/commands.ts",
        "src/domain/history.ts",
        "tests/fixtures/document.ts",
        "tests/fixtures/maps.ts",
        "tests/fixtures/inspect.ts",
        "tests/fixtures/expected.json",
        "scripts/history-baseline.ts",
      ].map((path) => [
        path,
        createHash("sha256")
          .update(readFileSync(resolve(root, path)))
          .digest("hex"),
      ]),
    ),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      model:
        process.platform === "darwin"
          ? native("sysctl", ["-n", "hw.model"])
          : null,
      macOS:
        process.platform === "darwin"
          ? native("sw_vers", ["-productVersion"])
          : null,
      macOSBuild:
        process.platform === "darwin"
          ? native("sw_vers", ["-buildVersion"])
          : null,
    },
    measurements,
  };
  const output = args.length
    ? resolve(args[1])
    : resolve(root, "artifacts/performance/history-baseline.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${output}`);
}
