import assert from "node:assert/strict";
import test from "node:test";
import {
  MapDocument,
  type DocumentChange,
  type TileWrite,
} from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { type DocumentCommand } from "../../src/domain/commands.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
  type Cell,
} from "../../src/domain/values.ts";

const terrain = layerId("terrain"),
  buildings = layerId("buildings"),
  furniture = layerId("furniture");
const black = rawColor("#000000ff"),
  white = rawColor("#ffffffff"),
  grassId = registryId("grass"),
  houseId = annotationId("house");
const grass = registeredColor(grassId);
const tile = (
  id = buildings,
  x = 63,
  y = 63,
  value: Cell = black,
  length = 1,
): DocumentCommand => ({
  kind: "tiles",
  writes: [{ layerId: id, x, y, length, value }],
});
function setup(options: ConstructorParameters<typeof CommandHistory>[1] = {}) {
  const map = new MapDocument({
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
      { id: furniture, name: "Furniture" },
    ],
  });
  return { map, history: new CommandHistory(map, options) };
}
const snapshot = (map: MapDocument) => ({
  bounds: map.bounds,
  layers: map.layers,
  cells: [...map.iterateCells()],
  registry: map.registryEntries,
  annotations: map.annotations,
});

test("a staged multilayer overlapping gesture commits once and restores every overwritten cell", () => {
  const { map, history } = setup();
  history.execute("seed", [
    tile(terrain, 60, 63, grass, 16),
    tile(buildings, 60, 63, black, 8),
    tile(buildings, 68, 63, white, 3),
    tile(furniture, 63, 63, white, 2),
  ]);
  history.markSaved(history.captureCheckpoint());
  const before = snapshot(map),
    initial = history.state,
    version = map.version,
    events: DocumentChange[] = [];
  const stop = map.subscribe((event) => {
    events.push(event);
    assert.equal(history.state.revision, 2);
    assert.equal(map.getCell(buildings, 60, 63), null);
  });
  const gesture = history.beginGesture("move house");
  gesture
    .append(tile(buildings, 60, 63, null, 8))
    .append(tile(buildings, 63, 63, black, 8));
  gesture
    .append(tile(furniture, 63, 63, null, 2))
    .append(tile(furniture, 66, 63, white, 2));
  assert.deepEqual(snapshot(map), before);
  const committed = gesture.commit();
  assert.equal(committed.observerErrors.length, 0);
  assert.equal(events.length, 1);
  assert.equal(map.version, version + 1);
  assert.equal(history.state.undoSteps, initial.undoSteps + 1);
  const after = snapshot(map);
  stop();
  const change = committed.change;
  assert.equal(change?.kind, "transaction");
  if (change?.kind !== "transaction") throw new Error("Missing transaction");
  const tiles = change.changes.find((part) => part.kind === "tiles");
  assert.ok(tiles?.kind === "tiles");
  assert.deepEqual(
    new Set(tiles.runs.map((run) => run.layerId)),
    new Set([buildings, furniture]),
  );
  assert.ok(
    tiles.runs.some(
      (run) =>
        run.x === 68 &&
        run.before?.kind === "raw" &&
        run.before.rgba === "#ffffffff",
    ),
  );
  history.undo();
  assert.deepEqual(snapshot(map), before);
  assert.equal(history.state.dirty, false);
  history.redo();
  assert.deepEqual(snapshot(map), after);
  assert.equal(history.state.dirty, true);
});

test("cancel, empty, and net no-op gestures do not notify, revise, or destroy redo", () => {
  const { map, history } = setup({ initiallySaved: true });
  history.execute("first", [tile()]);
  history.undo();
  const initial = history.state,
    version = map.version;
  let notifications = 0;
  map.subscribe(() => notifications++);
  history.subscribe(() => notifications++);
  const canceled = history.beginGesture("cancel").append(tile());
  canceled.cancel();
  canceled.cancel();
  assert.throws(() => canceled.commit(), /closed/);
  history.beginGesture("empty").commit();
  history.execute("restored", [
    tile(),
    tile(buildings, 63, 63, null),
    { kind: "rename-layer", id: terrain, name: "Changed" },
    { kind: "rename-layer", id: terrain, name: "Terrain" },
    { kind: "registry", id: grassId, value: { color: "green" } },
    { kind: "registry", id: grassId, value: null },
    { kind: "add-layer", layer: { id: layerId("temporary"), name: "Temp" } },
    { kind: "remove-layer", id: layerId("temporary") },
  ]);
  assert.deepEqual(history.state, initial);
  assert.equal(map.version, version);
  assert.equal(notifications, 0);
  assert.equal(map.storageStats().paletteEntries, 0);
  history.redo();
  assert.deepEqual(map.getCell(buildings, 63, 63), black);
});

test("late command failures, throwing producers and capacity rejection are atomic", () => {
  const { map, history } = setup();
  history.execute("seed", [
    tile(),
    {
      kind: "annotation",
      id: houseId,
      value: { name: "House", nested: { tier: "detail" } },
    },
  ]);
  const before = snapshot(map),
    initial = history.state,
    version = map.version;
  let notifications = 0;
  map.subscribe(() => notifications++);
  const commands: DocumentCommand[] = [
    tile(buildings, 63, 63, white),
    { kind: "remove-layer", id: buildings },
    { kind: "bounds", bounds: { minX: -64, minY: -64, maxX: 320, maxY: 320 } },
    { kind: "registry", id: grassId, value: { color: "green" } },
    { kind: "annotation", id: houseId, value: null },
    tile(terrain, 320, 0),
  ];
  assert.throws(() => history.execute("invalid end", commands), /inside/);
  assert.throws(
    () =>
      history.execute(
        "producer",
        (function* () {
          yield tile();
          throw new Error("input failure");
        })(),
      ),
    /input failure/,
  );
  assert.throws(
    () =>
      history.execute(
        "reentrant",
        (function* () {
          yield tile();
          map.clearCell(buildings, 63, 63);
        })(),
      ),
    /Reentrant/,
  );
  assert.deepEqual(snapshot(map), before);
  assert.deepEqual(history.state, initial);
  assert.equal(map.version, version);
  assert.equal(notifications, 0);
  const limited = new CommandHistory(new MapDocument(), {
    limits: { maxBytes: 1 },
  });
  assert.throws(
    () => limited.execute("too large", [tile(layerId("layer-1"))]),
    /byte limit/,
  );
  assert.equal(limited.state.undoSteps, 0);
  assert.equal(limited.state.revision, 0);
  assert.equal(limited.document.storageStats().occupiedCells, 0);
  assert.equal(limited.document.version, 0);
});

test("one command can restore removed layers, order, registry, annotations and bounds", () => {
  const { map, history } = setup();
  history.execute("initial", [
    tile(terrain, 63, 63, grass),
    tile(),
    tile(furniture),
    {
      kind: "registry",
      id: grassId,
      value: { name: "Grass", rgba: "#00ff00ff" },
    },
    {
      kind: "annotation",
      id: houseId,
      value: { name: "House", bounds: [60, 60, 68, 68], tier: "detail" },
    },
  ]);
  const before = snapshot(map),
    extra = layerId("extra");
  history.execute("all domains", [
    { kind: "remove-layer", id: buildings },
    { kind: "add-layer", layer: { id: extra, name: "Extra" }, index: 0 },
    { kind: "rename-layer", id: terrain, name: "Land" },
    { kind: "reorder-layers", ids: [extra, furniture, terrain] },
    { kind: "bounds", bounds: { minX: -64, minY: -64, maxX: 320, maxY: 320 } },
    tile(extra, -1, -1, white),
    {
      kind: "registry",
      id: grassId,
      value: { name: "Grass", rgba: "#118800ff" },
    },
    {
      kind: "annotation",
      id: houseId,
      value: { name: "Home", tier: "locality" },
    },
  ]);
  const after = snapshot(map);
  history.undo();
  assert.deepEqual(snapshot(map), before);
  history.redo();
  assert.deepEqual(snapshot(map), after);
  history.undo();
  history.undo();
  assert.equal(map.storageStats().occupiedCells, 0);
  assert.equal(map.registryEntries.length, 0);
  assert.equal(map.annotations.length, 0);
  history.redo();
  history.redo();
  assert.deepEqual(snapshot(map), after);
});

test("removing and re-adding the same layer identity restores its contents and metadata", () => {
  const { map, history } = setup();
  history.execute("seed", [tile()]);
  const before = snapshot(map);
  history.execute("replace", [
    { kind: "remove-layer", id: buildings },
    { kind: "add-layer", layer: { id: buildings, name: "Replaced" } },
    tile(buildings, 65, 65, white),
  ]);
  const after = snapshot(map);
  history.undo();
  assert.deepEqual(snapshot(map), before);
  history.redo();
  assert.deepEqual(snapshot(map), after);
});

test("saved checkpoints survive undo, branch replacement, pruning and asynchronous completion", () => {
  const { history } = setup({
    initiallySaved: true,
    limits: { maxEntries: 2 },
  });
  assert.equal(history.state.dirty, false);
  history.execute("A", [tile()]);
  const saveA = history.captureCheckpoint();
  history.execute("B", [tile(buildings, 64)]);
  history.markSaved(saveA);
  assert.equal(history.state.dirty, true);
  history.undo();
  assert.equal(history.state.dirty, false);
  history.redo();
  assert.equal(history.state.dirty, true);
  history.markRecovery(history.captureCheckpoint());
  assert.equal(history.state.dirty, true);
  history.undo();
  history.execute("C", [tile(buildings, 65)]);
  assert.equal(history.state.redoSteps, 0);
  assert.equal(history.state.revision, 3);
  history.undo();
  assert.equal(history.state.dirty, false);
  history.redo();
  history.execute("D", [tile(buildings, 66)]);
  assert.equal(history.state.undoSteps, 2);
  history.undo();
  history.undo();
  assert.equal(history.state.dirty, false);
  assert.equal(history.state.revision, saveA.revision);
  assert.equal(history.undo().change, null);
  const original = history.state;
  assert.throws(() => history.markSaved({ revision: 1 }), /forged/);
  assert.throws(() => setup().history.markSaved(saveA), /another/);
  assert.deepEqual(history.state, original);
  const fresh = setup().history;
  assert.equal(fresh.state.dirty, true);
  fresh.markRecovery(fresh.captureCheckpoint());
  assert.equal(fresh.state.dirty, true);
  fresh.markSaved(fresh.captureCheckpoint());
  assert.equal(fresh.state.dirty, false);
});

test("an abandoned saved branch never becomes clean through a reused revision", () => {
  const { history } = setup({ initiallySaved: true });
  history.execute("A", [tile()]);
  history.markSaved(history.captureCheckpoint());
  history.undo();
  history.execute("B", [tile(buildings, 64)]);
  assert.equal(history.state.revision, 2);
  assert.equal(history.state.savedRevision, 1);
  assert.equal(history.state.dirty, true);
  history.undo();
  assert.equal(history.state.dirty, true);
});

test("history byte budget is shared by undo/redo and evicts only oldest complete steps", () => {
  const probe = setup().history;
  probe.execute("x", [tile()]);
  const bytes = probe.state.retainedBytes;
  const { history } = setup({ limits: { maxBytes: bytes * 2 } });
  for (let x = 0; x < 5; x++) history.execute("x", [tile(buildings, x)]);
  assert.ok(history.state.retainedBytes <= bytes * 2);
  assert.equal(history.state.undoSteps, 2);
  const retained = history.state.retainedBytes;
  history.undo();
  history.undo();
  assert.equal(history.state.retainedBytes, retained);
  assert.equal(history.state.redoSteps, 2);
  history.execute("x", [tile(buildings, 9)]);
  assert.equal(history.state.redoSteps, 0);
  assert.equal(history.state.undoSteps, 1);
});

test("immutable inputs/events, observer errors, stale gestures and out-of-band writes", () => {
  const { map, history } = setup();
  const value = { name: "House", nested: { labels: ["detail"] } };
  const gesture = history
    .beginGesture("metadata")
    .append({ kind: "annotation", id: houseId, value });
  value.nested.labels.push("region");
  map.subscribe(() => {
    throw new Error("renderer failed");
  });
  map.subscribe(() => history.undo());
  history.subscribe(() => {
    throw new Error("UI failed");
  });
  let observed = 0;
  history.subscribe((state) => {
    observed++;
    assert.equal(state.revision, 1);
  });
  const result = gesture.commit();
  assert.equal(result.observerErrors.length, 3);
  assert.equal(observed, 1);
  assert.deepEqual(map.getAnnotation(houseId), {
    name: "House",
    nested: { labels: ["detail"] },
  });
  assert.ok(Object.isFrozen(map.getAnnotation(houseId)));
  assert.ok(Object.isFrozen(result.change));
  assert.ok(
    result.change?.kind === "transaction" &&
      Object.isFrozen(result.change.changes),
  );
  const stale = history.beginGesture("stale").append(tile());
  history.execute("other", [tile(buildings, 64)]);
  assert.throws(() => stale.commit(), /stale/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(
    () =>
      history.execute("invalid metadata", [
        { kind: "registry", id: grassId, value: cyclic as never },
      ]),
    /JSON/,
  );
  map.setCell(terrain, 0, 0, black);
  assert.throws(() => history.undo(), /outside command history/);
});

test("bounds replay supports disjoint safe-integer extremes without an overflowing union", () => {
  const n = Number.MAX_SAFE_INTEGER;
  const map = new MapDocument({
    bounds: { minX: -n, minY: 0, maxX: -n + 100, maxY: 100 },
    layers: [{ id: terrain, name: "Terrain" }],
  });
  const history = new CommandHistory(map);
  history.execute("seed", [tile(terrain, -n, 0)]);
  const before = snapshot(map);
  history.execute("relocate", [
    tile(terrain, -n, 0, null),
    { kind: "bounds", bounds: { minX: n - 100, minY: 0, maxX: n, maxY: 100 } },
    tile(terrain, n - 1, 0, white),
  ]);
  const after = snapshot(map);
  history.undo();
  assert.deepEqual(snapshot(map), before);
  history.redo();
  assert.deepEqual(snapshot(map), after);
});

test("seeded overlapping transactions, net compaction and inverse replay match a per-cell oracle", () => {
  const { map, history } = setup();
  let seed = 65539;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const values = [null, black, white, grass];
  const oracle = new Map<string, Cell>();
  for (let step = 0; step < 80; step++) {
    const before = snapshot(map);
    const writes: TileWrite[] = Array.from({ length: 30 }, () => ({
      layerId: [terrain, buildings, furniture][random() % 3],
      x: 60 + (random() % 16),
      y: 60 + (random() % 5),
      length: 1 + (random() % 20),
      value: values[random() % 4],
    }));
    for (const write of writes)
      for (let x = write.x; x < write.x + write.length; x++) {
        const key = `${write.layerId}/${x}/${write.y}`;
        if (write.value === null) oracle.delete(key);
        else oracle.set(key, write.value);
      }
    const result = history.execute(
      `edit ${step}`,
      writes.map((write) => ({ kind: "tiles", writes: [write] })),
    );
    assert.deepEqual(
      new Map(
        [...map.iterateCells()].map((cell) => [
          `${cell.layerId}/${cell.x}/${cell.y}`,
          cell.value,
        ]),
      ),
      oracle,
    );
    const after = snapshot(map);
    if (result.change) {
      history.undo();
      assert.deepEqual(snapshot(map), before);
      history.redo();
      assert.deepEqual(snapshot(map), after);
    }
  }
});

test("notifications identify net tiles, all metadata IDs and structural changes on undo/redo", () => {
  const { map, history } = setup();
  history.execute("seed", [
    tile(terrain, 0, 0, grass),
    tile(buildings, 0, 0, grass),
  ]);
  const events: DocumentChange[] = [],
    summaries: number[] = [];
  map.subscribe((change) => {
    events.push(change);
    summaries.push(history.state.revision);
  });
  history.execute("metadata", [
    { kind: "registry", id: grassId, value: { rgba: "#001100ff" } },
    { kind: "annotation", id: houseId, value: { name: "House" } },
    { kind: "rename-layer", id: terrain, name: "Land" },
    { kind: "bounds", bounds: { minX: -64, minY: 0, maxX: 256, maxY: 256 } },
  ]);
  history.undo();
  history.redo();
  assert.deepEqual(summaries, [2, 1, 2]);
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.equal(event.kind, "transaction");
    if (event.kind !== "transaction") throw new Error("Missing transaction");
    assert.deepEqual(
      new Set(event.changes.map((change) => change.kind)),
      new Set(["registry", "annotation", "layers", "bounds"]),
    );
    assert.ok(
      event.changes.some(
        (change) => change.kind === "registry" && change.id === grassId,
      ),
    );
    assert.ok(
      event.changes.some(
        (change) => change.kind === "annotation" && change.id === houseId,
      ),
    );
    assert.ok(Object.isFrozen(event.changes));
  }
  assert.deepEqual(map.getCell(terrain, 0, 0), grass);
  assert.deepEqual(map.getCell(buildings, 0, 0), grass);
});

test("8 by 8 multilayer move by three tiles restores overwritten destinations and leaves annotations fixed", () => {
  const { map, history } = setup();
  const seed: DocumentCommand[] = [
    {
      kind: "annotation",
      id: houseId,
      value: { bounds: [60, 60, 68, 68], name: "House" },
    },
  ];
  for (let y = 60; y < 68; y++) {
    seed.push(
      tile(terrain, 60, y, grass, 11),
      tile(buildings, 60, y, black, 8),
      tile(buildings, 68, y, white, 3),
    );
  }
  seed.push(
    tile(furniture, 62, 62, white, 2),
    tile(furniture, 65, 62, black, 2),
  );
  history.execute("seed", seed);
  const before = snapshot(map),
    annotation = map.getAnnotation(houseId),
    terrainRuns = [...map.iterateRuns(terrain)];
  const selected = [
    ...map.iterateRuns(buildings, { minX: 60, minY: 60, maxX: 68, maxY: 68 }),
    ...map.iterateRuns(furniture, { minX: 60, minY: 60, maxX: 68, maxY: 68 }),
  ];
  history.execute("move", [
    { kind: "tiles", writes: selected.map((run) => ({ ...run, value: null })) },
    {
      kind: "tiles",
      writes: selected.map((run) => ({ ...run, x: run.x + 3 })),
    },
  ]);
  assert.deepEqual(map.getAnnotation(houseId), annotation);
  assert.deepEqual([...map.iterateRuns(terrain)], terrainRuns);
  const after = snapshot(map);
  history.undo();
  assert.deepEqual(snapshot(map), before);
  history.redo();
  assert.deepEqual(snapshot(map), after);
});

test("layer replacement can be a net no-op and the last layer cannot be removed", () => {
  const { map, history } = setup();
  history.execute("seed", [tile()]);
  const version = map.version,
    state = history.state;
  const result = history.execute("replace identically", [
    { kind: "remove-layer", id: buildings },
    {
      kind: "add-layer",
      layer: { id: buildings, name: "Buildings" },
      index: 1,
    },
    tile(),
  ]);
  assert.equal(result.change, null);
  assert.equal(map.version, version);
  assert.deepEqual(history.state, state);
  assert.throws(
    () =>
      history.execute(
        "remove all",
        [terrain, buildings, furniture].map((id) => ({
          kind: "remove-layer",
          id,
        })),
      ),
    /at least one/,
  );
  assert.equal(map.layers.length, 3);
  assert.deepEqual(map.getCell(buildings, 63, 63), black);
  assert.deepEqual(history.state, state);
});
