import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MapDocument, type TileWrite } from "../src/domain/document.ts";
import { CommandHistory } from "../src/domain/history.ts";
import { containsTile } from "../src/domain/coordinates.ts";
import {
  captureSelection,
  planSelectionMove,
  planSelectionTransform,
  transformSelection,
} from "../src/domain/selection.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
  equalCells,
  type LayerId,
} from "../src/domain/values.ts";
import { rasterizeChunk, visibleChunks } from "../src/renderer/chunks.ts";
import {
  loadFixtureDocument,
  fixtureRunsFromDocument,
} from "../tests/fixtures/document.ts";
import { FIXTURES, FIXTURE_PALETTE } from "../tests/fixtures/maps.ts";
import { inspectFixture } from "../tests/fixtures/inspect.ts";
import {
  movementDocument,
  house,
  walls,
  furniture,
} from "../tests/fixtures/selection.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const edits = [layerId("selection-a"), layerId("selection-b")];
const palette = [
  null,
  registeredColor(registryId("stone")),
  rawColor("#8d939cff"),
  rawColor("#12345600"),
];
const originalCell = (layer: number, x: number, y: number) =>
  palette[
    (Math.floor(x / 32) + Math.floor(y / 16) + layer * 2) % palette.length
  ];
function hash(
  doc: MapDocument,
  ids: readonly LayerId[] = doc.layers.map((l) => l.id),
) {
  const digest = createHash("sha256");
  digest.update(
    JSON.stringify([
      doc.bounds,
      doc.layers,
      doc.registryEntries,
      doc.annotations,
    ]),
  );
  for (const id of ids)
    for (const run of doc.iterateRuns(id))
      digest.update(JSON.stringify(run) + "\n");
  return digest.digest("hex");
}
function memory() {
  if (!global.gc) throw new Error("Use --expose-gc for child measurements.");
  global.gc();
  return process.memoryUsage();
}
function measure(id: string, size: number) {
  const fixture = FIXTURES.find((f) => f.id === id);
  assert.ok(fixture);
  const doc = loadFixtureDocument(fixture);
  const golden = JSON.parse(
    readFileSync(resolve(root, "tests/fixtures/expected.json"), "utf8"),
  )[id];
  assert.deepEqual(
    inspectFixture(fixture, fixtureRunsFromDocument(doc)),
    golden,
  );
  // Complete backgrounds retain their identities and get real renderer colors.
  for (const paint of FIXTURE_PALETTE)
    if (paint.meaning)
      doc.applyCommands([
        {
          kind: "registry",
          id: registryId(paint.key),
          value: { name: paint.meaning, rgba: paint.rgba },
        },
      ]);
  for (const layer of edits) doc.addLayer({ id: layer, name: layer });
  const source = {
    minX: 252,
    minY: 252,
    maxX: 252 + size,
    maxY: 252 + (size * 3) / 4,
  };
  const region = { minX: 240, minY: 240, maxX: 288 + size, maxY: 288 + size };
  const writes: TileWrite[] = [];
  for (const [l, layer] of edits.entries())
    for (let y = region.minY; y < region.maxY; y++)
      for (let x = region.minX; x < region.maxX;) {
        const length = Math.min(32 - (x % 32), region.maxX - x);
        writes.push({
          layerId: layer,
          x,
          y,
          length,
          value: originalCell(l, x, y),
        });
        x += length;
      }
  doc.writeBatch(writes);
  writes.length = 0;
  const backgroundIds = doc.layers.slice(0, 4).map((l) => l.id);
  const original = hash(doc),
    background = hash(doc, backgroundIds);
  const history = new CommandHistory(doc, {
    initiallySaved: true,
    limits: { maxEntries: 1 },
  });
  const timing: Record<
    string,
    { ms: number; afterOperation: NodeJS.MemoryUsage }
  > = {};
  const timed = <T>(name: string, operation: () => T): T => {
    const start = performance.now();
    const value = operation();
    timing[name] = {
      ms: performance.now() - start,
      afterOperation: process.memoryUsage(),
    };
    return value;
  };
  const before = memory();
  const payload = timed("snapshot", () => captureSelection(doc, source, edits));
  const captured = memory();
  const transformed = timed("transform", () =>
    transformSelection(
      transformSelection(payload, "rotate-clockwise"),
      "flip-horizontal",
    ),
  );
  const transformedMemory = memory();
  const destination = {
    minX: 255,
    minY: 257,
    maxX: 255 + transformed.width,
    maxY: 257 + transformed.height,
  };
  const plan = timed("plan", () =>
    planSelectionTransform(doc, payload, transformed, destination),
  );
  const planned = memory();
  const chunks = visibleChunks(
    doc.bounds,
    { x: 248, y: 248, zoom: 1 },
    1024,
    640,
  );
  const raster = (preview: readonly TileWrite[] = []) =>
    doc.layers.flatMap((l) =>
      chunks.map((c) => rasterizeChunk(doc, l.id, c, preview)),
    );
  const preview = timed("previewRaster", () => raster(plan.writes));
  const previewed = memory();
  const result = timed("commit", () =>
    history.execute("Large composed transform", [
      { kind: "tiles", writes: plan.writes },
    ]),
  );
  assert.ok(result.change);
  assert.deepEqual(result.observerErrors, []);
  const committed = memory(),
    retainedHistory = history.state;
  assert.equal(retainedHistory.undoSteps, 1);
  // CW then horizontal flip is a transpose. Derive every expected world cell
  // from the fixture's formula, never from the production plan or payload.
  let holesPreserved = 0,
    overwrites = 0;
  for (const [l, layer] of edits.entries()) {
    let expectedOccupied = 0;
    for (let y = region.minY; y < region.maxY; y++)
      for (let x = region.minX; x < region.maxX; x++) {
        let expected = originalCell(l, x, y);
        if (containsTile(destination, x, y)) {
          const incoming = originalCell(
            l,
            source.minX + y - destination.minY,
            source.minY + x - destination.minX,
          );
          if (incoming === null && expected !== null) holesPreserved++;
          if (
            incoming !== null &&
            expected !== null &&
            !equalCells(incoming, expected)
          )
            overwrites++;
          expected = incoming ?? expected;
        } else if (containsTile(source, x, y)) expected = null;
        expectedOccupied += Number(expected !== null);
        assert.ok(
          equalCells(doc.getCell(layer, x, y), expected),
          `${layer} (${x},${y})`,
        );
      }
    // Together with every cell above, the global count proves no stray writes
    // escaped the checked region into the rest of the 6400x6400 layer.
    assert.equal(
      [...doc.iterateRuns(layer)].reduce((n, run) => n + run.length, 0),
      expectedOccupied,
    );
  }
  assert.ok(holesPreserved > 0 && overwrites > 0);
  const actualRaster = raster();
  actualRaster.forEach((r, i) => {
    assert.deepEqual(r.pixels, preview[i].pixels);
    assert.equal(r.cells, preview[i].cells);
  });
  assert.equal(hash(doc, backgroundIds), background);
  const changed = hash(doc);
  timed("undo", () => history.undo());
  const undone = memory();
  assert.equal(hash(doc), original);
  assert.equal(history.state.dirty, false);
  timed("redo", () => history.redo());
  const redone = memory();
  assert.equal(hash(doc), changed);
  history.execute("Evict large entry", [
    {
      kind: "tiles",
      writes: [
        {
          layerId: edits[0],
          x: 0,
          y: 0,
          length: 1,
          value: rawColor("#ffffffff"),
        },
      ],
    },
  ]);
  const evicted = memory();
  assert.ok(history.state.retainedBytes < 2048);
  const delta = (a: NodeJS.MemoryUsage, b: NodeJS.MemoryUsage) =>
    a.heapUsed + a.arrayBuffers - b.heapUsed - b.arrayBuffers;
  return {
    fixture: id,
    seed: fixture.seed,
    size,
    source,
    destination,
    occupiedSelectedCells: payload.layers.reduce(
      (n, l) => n + l.occupiedCount,
      0,
    ),
    sourceRuns: payload.layers.reduce((n, l) => n + l.runs.length, 0),
    transformedRuns: transformed.layers.reduce((n, l) => n + l.runs.length, 0),
    planWrites: plan.writes.length,
    previewChunks: chunks.length,
    layers: doc.layers.length,
    holesPreserved,
    overwrites,
    golden,
    originalHash: original,
    changedHash: changed,
    checks: {
      goldenBackground: true,
      everyEditedCell: true,
      backgroundUnchanged: true,
      previewMatchesCommit: true,
      exactUndoRedo: true,
    },
    timing,
    retainedHistory,
    evictedHistory: history.state,
    memoryBytes: {
      before,
      captured,
      transformed: transformedMemory,
      planned,
      previewed,
      committed,
      undone,
      redone,
      evicted,
      snapshotDelta: delta(captured, before),
      transformDelta: delta(transformedMemory, captured),
      planDelta: delta(planned, transformedMemory),
      commitDelta: delta(committed, previewed),
      releasedByHistoryEviction: delta(redone, evicted),
    },
    processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
  };
}

function measureHouse(multi: boolean) {
  const doc = movementDocument(),
    history = new CommandHistory(doc, { initiallySaved: true });
  const initial = hash(doc),
    scope = multi ? [walls, furniture] : [walls];
  const samples = [];
  const time = (fn: () => unknown) => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  const before = memory();
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const plan = planSelectionMove(
      doc,
      captureSelection(doc, house, scope),
      3,
      0,
    );
    const snapshotAndPlanMs = performance.now() - start;
    const commitMs = time(() =>
      history.execute("House move", [{ kind: "tiles", writes: plan.writes }]),
    );
    const moved = hash(doc);
    const undoMs = time(() => history.undo());
    assert.equal(hash(doc), initial);
    const redoMs = time(() => history.redo());
    assert.equal(hash(doc), moved);
    history.undo();
    assert.equal(hash(doc), initial);
    samples.push({ snapshotAndPlanMs, commitMs, undoMs, redoMs });
  }
  const after = memory();
  return {
    scope,
    repetitions: 20,
    exactUndoRedo: true,
    samples,
    memoryBytes: { before, after },
    retainedHistory: history.state,
  };
}

if (args[0] === "--measure") {
  const size = Number(args[2]);
  assert.ok(args.length === 3 && [512, 1024].includes(size));
  console.log(JSON.stringify(measure(args[1], size)));
} else if (args[0] === "--house") {
  console.log(JSON.stringify([measureHouse(false), measureHouse(true)]));
} else {
  assert.ok(
    args.length === 0 || (args.length === 2 && args[0] === "--output"),
    "Usage: npm run perf:selection -- [--output path.json]",
  );
  const child = (argv: string[]) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ["--expose-gc", fileURLToPath(import.meta.url), ...argv],
        { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      ),
    );
  const measurements = [];
  for (const fixture of FIXTURES)
    for (const size of [512, 1024])
      for (const pass of [1, 2]) {
        const result = child(["--measure", fixture.id, String(size)]);
        console.log(
          `${fixture.id} ${size} pass ${pass}: snapshot/transform/preview/commit ${["snapshot", "transform", "previewRaster", "commit"].map((k) => result.timing[k].ms.toFixed(1)).join("/")} ms`,
        );
        measurements.push({ pass, ...result });
      }
  for (let i = 0; i < measurements.length; i += 2)
    for (const key of [
      "originalHash",
      "changedHash",
      "retainedHistory",
      "occupiedSelectedCells",
      "holesPreserved",
      "overwrites",
    ])
      assert.deepEqual(measurements[i][key], measurements[i + 1][key]);
  const inputs = [
    "scripts/selection-baseline.ts",
    "src/domain/selection.ts",
    "src/domain/clipboard.ts",
    "src/domain/document.ts",
    "src/domain/storage.ts",
    "src/domain/commands.ts",
    "src/domain/history.ts",
    "src/renderer/chunks.ts",
    "src/renderer/colors.ts",
    "tests/fixtures/selection.ts",
    "tests/fixtures/document.ts",
    "tests/fixtures/maps.ts",
    "tests/fixtures/inspect.ts",
    "tests/fixtures/expected.json",
    "package-lock.json",
    ".nvmrc",
  ];
  const report = {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    scope:
      "Node domain and CPU raster baseline; no UI/controller, WebGL upload, presented-frame or native physical-memory budget claim.",
    method:
      "Two fresh processes per complete golden-verified background and size. Two extra overlapping striped layers with 25% holes, registered stone, identical raw stone, and alpha-zero paint; source 512x384 or 1024x768 crosses 32/64 boundaries. CW+horizontal transpose then offset (3,5), one atomic commit. CPU preview raster covers all six layers in a 1024x640 CSS detail viewport. Timings exclude GC and correctness checks. Retained snapshots and plans remain alive through history eviction, isolating released history approximately. heapUsed+arrayBuffers is a V8 estimate, external already includes buffers; snapshots are not a transient heap peak and maxRSS is whole-process high-water including load/verification. Two samples are not percentiles. House samples are 20 resets per scope with full document hash checks, separate CPU timing only. Performance gate deferred to TW-049/TW-050.",
    inputsSha256: Object.fromEntries(
      inputs.map((p) => [
        p,
        createHash("sha256")
          .update(readFileSync(resolve(root, p)))
          .digest("hex"),
      ]),
    ),
    machine: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: cpus()[0]?.model,
      totalMemoryBytes: totalmem(),
      macOS:
        process.platform === "darwin"
          ? execFileSync("sw_vers", ["-productVersion"], {
              encoding: "utf8",
            }).trim()
          : null,
      macOSBuild:
        process.platform === "darwin"
          ? execFileSync("sw_vers", ["-buildVersion"], {
              encoding: "utf8",
            }).trim()
          : null,
      model:
        process.platform === "darwin"
          ? execFileSync("sysctl", ["-n", "hw.model"], {
              encoding: "utf8",
            }).trim()
          : null,
    },
    house: child(["--house"]),
    measurements,
  };
  const output = resolve(
    root,
    args[1] ?? "artifacts/performance/selection-baseline.json",
  );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${output}`);
}
