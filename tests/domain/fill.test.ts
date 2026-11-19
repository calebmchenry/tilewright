import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { prepareFloodFill } from "../../src/domain/fill.ts";
import {
  equalCells,
  layerId,
  rawColor,
  registeredColor,
  registryId,
  type Cell,
} from "../../src/domain/values.ts";

const active = layerId("active"),
  other = layerId("other");
const red = rawColor("#ff0000ff"),
  blue = rawColor("#0000ffff"),
  named = registeredColor(registryId("red"));
const fast = { yieldControl: async () => {} };
const snapshot = (d: MapDocument, h: CommandHistory) => ({
  runs: [...d.iterateRuns()],
  bounds: d.bounds,
  layers: d.layers,
  registry: d.registryEntries,
  annotations: d.annotations,
  version: d.version,
  storage: d.storageStats(),
  history: h.state,
});
function setup(width = 130, height = 130, min = -65) {
  const d = new MapDocument({
    bounds: { minX: min, minY: min, maxX: min + width, maxY: min + height },
    layers: [
      { id: active, name: "Active" },
      { id: other, name: "Other" },
    ],
  });
  d.applyCommands([
    {
      kind: "registry",
      id: registryId("red"),
      value: { name: "Red", rgba: "#ff0000ff" },
    },
  ]);
  d.setCell(other, min, min, named);
  return d;
}

// Independent, deliberately simple cell BFS oracle, only for small test maps.
function oracle(d: MapDocument, x: number, y: number): Set<string> {
  const b = d.bounds,
    source = d.getCell(active, x, y),
    found = new Set<string>();
  const queue = [[x, y]];
  while (queue.length) {
    const [x, y] = queue.pop()!,
      key = `${x}/${y}`;
    if (
      found.has(key) ||
      x < b.minX ||
      y < b.minY ||
      x >= b.maxX ||
      y >= b.maxY ||
      !equalCells(d.getCell(active, x, y), source)
    )
      continue;
    found.add(key);
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }
  return found;
}

test("fill matches four-neighbor oracle for enclosed/open/edge/diagonal/empty/raw/registered regions across signed partitions", async () => {
  for (let trial = 0; trial < 10; trial++) {
    const d = setup(),
      b = d.bounds;
    const values: Cell[] = [null, red, named, rawColor("#ff000080"), blue];
    for (let y = -65; y < 65; y++)
      for (let x = -65; x < 65; x++) {
        const wall = x === -33 || x === 33 || y === -33 || y === 33;
        const value =
          trial < 5
            ? wall && !(trial % 2 && x === 0)
              ? blue
              : values[trial]
            : values[Math.abs((x * 13 + y * 7 + x * y + trial) % 5)];
        if (value) d.setCell(active, x, y, value);
      }
    const seed = trial % 2 ? { x: -65, y: -65 } : { x: 0, y: 0 };
    const expected = oracle(d, seed.x, seed.y),
      before = [...d.iterateRuns()],
      oldCells = new Map(
        [...d.iterateCells(active)].map((c) => [`${c.x}/${c.y}`, c.value]),
      );
    const replacement = rawColor("#112233ff"),
      h = new CommandHistory(d, { initiallySaved: true });
    h.markRecovery(h.captureCheckpoint());
    const state = snapshot(d, h);
    let events = 0;
    d.subscribe(() => {
      events++;
      assert.equal(h.state.undoSteps, events === 2 ? 0 : 1);
    });
    const plan = await prepareFloodFill(d, active, seed, replacement, fast);
    assert.equal(plan.changedCells, expected.size);
    assert.deepEqual(snapshot(d, h), state);
    const result = h.executePrepared("Fill", plan);
    assert.equal(result.observerErrors.length, 0);
    assert.equal(events, 1);
    for (let y = b.minY; y < b.maxY; y++)
      for (let x = b.minX; x < b.maxX; x++)
        assert.deepEqual(
          d.getCell(active, x, y),
          expected.has(`${x}/${y}`)
            ? replacement
            : (oldCells.get(`${x}/${y}`) ?? null),
        );
    assert.deepEqual(
      [...d.iterateRuns(other)],
      before.filter((r) => r.layerId === other),
    );
    const after = [...d.iterateRuns()];
    h.undo();
    assert.deepEqual([...d.iterateRuns()], before);
    assert.equal(h.state.dirty, false);
    h.redo();
    assert.deepEqual([...d.iterateRuns()], after);
    assert.equal(events, 3);
  }
});

test("raw same shade and different registry IDs never merge; diagonal contact does not connect", async () => {
  const d = setup(6, 4, 0),
    second = registeredColor(registryId("second"));
  d.writeBatch(
    [red, named, second, null, red, null].map((value, x) => ({
      layerId: active,
      x,
      y: 0,
      length: 1,
      value,
    })),
  );
  d.setCell(active, 1, 1, red);
  const h = new CommandHistory(d);
  for (const x of [0, 1, 2]) {
    const before = [...d.iterateRuns()];
    const plan = await prepareFloodFill(d, active, { x, y: 0 }, blue, fast);
    assert.equal(plan.changedCells, 1);
    h.executePrepared("Fill", plan);
    h.undo();
    assert.deepEqual([...d.iterateRuns()], before);
  }
  const plan = await prepareFloodFill(d, active, { x: 0, y: 0 }, named, fast);
  h.executePrepared("Fill", plan);
  assert.deepEqual(d.getCell(active, 0, 0), named);
  assert.deepEqual(d.getCell(active, 1, 1), red);
});

test("cancel during staging/final yield and no-op retain content, allocation, redo, checkpoints and notifications", async () => {
  const d = setup(1024, 1024, 0),
    h = new CommandHistory(d, { initiallySaved: true });
  h.execute("Seed", [
    {
      kind: "tiles",
      writes: [{ layerId: active, x: 0, y: 0, length: 1, value: red }],
    },
  ]);
  h.undo();
  h.markRecovery(h.captureCheckpoint());
  const before = snapshot(d, h);
  let events = 0;
  d.subscribe(() => events++);
  for (const final of [false, true]) {
    const signal = { aborted: false };
    await assert.rejects(
      prepareFloodFill(d, active, { x: 0, y: 0 }, blue, {
        signal,
        onProgress: (count) => {
          assert.deepEqual(snapshot(d, h), before);
          if (count && (!final || count === 1024 ** 2)) signal.aborted = true;
        },
        yieldControl: async () => {},
      }),
      /canceled/,
    );
    assert.deepEqual(snapshot(d, h), before);
  }
  for (const seed of [
    { x: 0, y: 0 },
    { x: 1024, y: 0 },
    { x: -1, y: 0 },
  ]) {
    const plan = await prepareFloodFill(d, active, seed, null, fast);
    assert.equal(h.executePrepared("Fill", plan).change, null);
    assert.deepEqual(snapshot(d, h), before);
  }
  assert.equal(events, 0);
});

test("stale, foreign, forged, consumed and over-budget plans reject atomically; staging errors leave no changes", async () => {
  const d = setup(5, 5, 0),
    h = new CommandHistory(d),
    before = snapshot(d, h);
  const plan = await prepareFloodFill(d, active, { x: 0, y: 0 }, blue, fast);
  assert.throws(() => new MapDocument().applyPreparedTiles(plan), /Unknown/);
  assert.throws(
    () => h.executePrepared("Fill", { changedCells: 25 }),
    /Unknown/,
  );
  const small = new CommandHistory(d, { limits: { maxBytes: 1 } });
  assert.throws(() => small.executePrepared("Fill", plan), /byte limit/);
  assert.deepEqual(snapshot(d, h), before);
  assert.throws(() => h.executePrepared("Fill", plan), /Unknown/);
  const next = await prepareFloodFill(d, active, { x: 0, y: 0 }, blue, fast);
  h.execute("Edit", [
    {
      kind: "tiles",
      writes: [{ layerId: active, x: 0, y: 0, length: 1, value: red }],
    },
  ]);
  const edited = snapshot(d, h);
  assert.throws(() => h.executePrepared("Fill", next), /changed/);
  assert.deepEqual(snapshot(d, h), edited);
  await assert.rejects(
    d.prepareTiles(
      [
        { layerId: active, x: 1, y: 0, length: 1, value: blue },
        { layerId: active, x: 5, y: 0, length: 1, value: blue },
      ],
      fast,
    ),
    /bounds/,
  );
  assert.deepEqual(snapshot(d, h), edited);
  let once = false;
  await assert.rejects(
    prepareFloodFill(d, active, { x: 2, y: 0 }, blue, {
      yieldControl: async () => {
        if (!once) {
          once = true;
          h.undo();
        }
      },
    }),
    /changed/,
  );
  assert.deepEqual([...d.iterateRuns()], before.runs);
});

test("long scanlines join across work batches; registered replacement and subsequent edits retain palette accounting", async () => {
  const d = setup(1301, 5, 0),
    h = new CommandHistory(d);
  const before = [...d.iterateRuns()];
  const plan = await prepareFloodFill(d, active, { x: 650, y: 2 }, named, fast);
  assert.equal(plan.changedCells, 6505);
  h.executePrepared("Fill", plan);
  for (const run of d.iterateRuns(active)) {
    assert.equal(run.x, 0);
    assert.equal(run.length, 1301);
    assert.deepEqual(run.value, named);
  }
  const full = [...d.iterateRuns()];
  const noop = await prepareFloodFill(d, active, { x: 0, y: 0 }, named, fast);
  const state = snapshot(d, h);
  h.executePrepared("Fill", noop);
  assert.deepEqual(snapshot(d, h), state);
  h.execute("Clear", [
    {
      kind: "tiles",
      writes: [{ layerId: active, x: 0, y: 0, length: 1301, value: null }],
    },
  ]);
  h.undo();
  assert.deepEqual([...d.iterateRuns()], full);
  h.undo();
  assert.deepEqual([...d.iterateRuns()], before);
  assert.equal(d.storageStats().paletteEntries, 1);
  h.redo();
  assert.deepEqual([...d.iterateRuns()], full);
});

test("prepared overlapping writes compact net changes; observer errors do not make a successful commit fail", async () => {
  const d = setup(10, 10, 0),
    h = new CommandHistory(d),
    before = [...d.iterateRuns()];
  const plan = await d.prepareTiles(
    [
      { layerId: active, x: 0, y: 0, length: 10, value: red },
      { layerId: active, x: 0, y: 0, length: 5, value: blue },
      { layerId: active, x: 5, y: 0, length: 5, value: null },
    ],
    fast,
  );
  assert.equal(plan.changedCells, 5);
  d.subscribe(() => {
    throw new Error("View failed");
  });
  const result = h.executePrepared("Fill", plan);
  assert.equal(result.observerErrors.length, 1);
  assert.equal(h.state.undoSteps, 1);
  assert.deepEqual(d.getCell(active, 0, 0), blue);
  assert.equal(d.getCell(active, 5, 0), null);
  h.undo();
  assert.deepEqual([...d.iterateRuns()], before);
});

test("all 3x3 binary regions match a cell BFS without missed islands or diagonal leaks", async () => {
  for (let mask = 0; mask < 512; mask++) {
    const d = setup(3, 3, 0);
    for (let i = 0; i < 9; i++)
      if (mask & (1 << i)) d.setCell(active, i % 3, Math.floor(i / 3), red);
    const h = new CommandHistory(d);
    const before = [...d.iterateRuns()];
    for (let i = 0; i < 9; i++) {
      const seed = { x: i % 3, y: Math.floor(i / 3) },
        expected = oracle(d, seed.x, seed.y);
      const plan = await prepareFloodFill(d, active, seed, blue, fast);
      assert.equal(plan.changedCells, expected.size);
      h.executePrepared("Fill", plan);
      for (let j = 0; j < 9; j++)
        assert.equal(
          equalCells(d.getCell(active, j % 3, Math.floor(j / 3)), blue),
          expected.has(`${j % 3}/${Math.floor(j / 3)}`),
        );
      h.undo();
      assert.deepEqual([...d.iterateRuns()], before);
    }
  }
});

test("session fill gates, captured target and cancellation leave navigation and other edits safe", async () => {
  const { EditorSession } = await import("../../src/editor/session.ts");
  const { tileToScreen } = await import("../../src/editor/viewport.ts");
  const d = setup(1024, 1024, 0),
    s = new EditorSession(d);
  const point = tileToScreen(10, 10, s.viewport.getSnapshot());
  assert.ok(s.action("fill").reason);
  s.canvasState.set("ready");
  s.perform("fill");
  s.history.markSaved(s.history.captureCheckpoint());
  const before = snapshot(d, s.history);
  for (const cancel of [
    () => s.fill.cancel(),
    () => s.setColor("#222222"),
    () => s.perform("pencil"),
    () => s.selectLayer(other),
    () => s.setLayerVisible(active, false),
    () => s.canvasState.set("loading"),
  ]) {
    const operation = s.fill.start(point);
    assert.ok(s.fill.progress.getSnapshot());
    assert.equal(await s.fill.start(point), false);
    cancel();
    assert.equal(await operation, false);
    assert.equal(s.fill.progress.getSnapshot(), null);
    assert.deepEqual(snapshot(d, s.history), before);
    s.canvasState.set("ready");
    s.selectLayer(active);
    s.setLayerVisible(active, true);
    s.perform("fill");
  }
  const pending = s.fill.start(point);
  s.pan(-10, -10);
  s.setZoom(0.1);
  s.setCanvasSize(900, 600);
  assert.ok(s.fill.progress.getSnapshot());
  s.fill.cancel();
  assert.equal(await pending, false);
  assert.deepEqual(snapshot(d, s.history), before);
  assert.ok(s.action("fill").reason); // overview blocks new fill
  s.setZoom(1);
  s.setLayerVisible(active, false);
  assert.ok(s.action("fill").reason);
  s.setLayerVisible(active, true);
  assert.equal(s.routeKey({ key: "g" }, "text"), false);
  assert.equal(s.routeKey({ key: "g", isComposing: true }, "canvas"), false);
  assert.equal(s.routeKey({ key: "g" }, "canvas"), true);
  const last = s.fill.start(point);
  s.dispose();
  assert.equal(await last, false);
  assert.deepEqual(snapshot(d, s.history), before);
});
