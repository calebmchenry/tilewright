import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MapDocument,
  type DocumentChange,
  type TileWrite,
} from "../../src/domain/document.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
  type Cell,
  type LayerId,
  type RegistryId,
  type AnnotationId,
} from "../../src/domain/values.ts";

const terrain = layerId("terrain"),
  buildings = layerId("buildings");
const black = rawColor("#000000ff"),
  white = rawColor("#ffffffff");
const grass = registeredColor(registryId("grass"));
function document() {
  return new MapDocument({
    bounds: { minX: -128, minY: -128, maxX: 6400, maxY: 6400 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
}

test("target-size empty documents allocate no partitions or palette; black/transparent/registered are occupied", () => {
  const map = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 6400, maxY: 6400 },
  });
  const id = map.layers[0].id;
  assert.equal(map.storageStats().partitions, 0);
  assert.equal(map.storageStats().typedArrayBytes, 0);
  assert.equal(map.storageStats().paletteEntries, 0);
  assert.equal(map.getCell(id, 6399, 6399), null);
  assert.equal(map.clearCell(id, 6399, 6399).change, null);
  for (const [x, value] of [black, rawColor("#00000000"), grass].entries())
    map.setCell(id, x, 0, value);
  assert.equal(map.storageStats().occupiedCells, 3);
  assert.equal(map.storageStats().partitions, 1);
  assert.equal(map.storageStats().typedArrayBytes, 0);
  assert.deepEqual(map.getCell(id, 0, 0), black);
  assert.deepEqual(map.getCell(id, 2, 0), grass);
  map.writeBatch([{ layerId: id, x: 0, y: 0, length: 3, value: null }]);
  assert.equal(map.storageStats().occupiedCells, 0);
  assert.equal(map.storageStats().partitions, 0);
  assert.equal(map.storageStats().paletteEntries, 0);
  assert.equal(map.version, 4);
});

test("layer IDs, underlying cells, and registry associations survive renaming and reordering", () => {
  const map = document();
  map.setCell(terrain, 63, 64, grass);
  map.setCell(buildings, 63, 64, black);
  const before = map.layers;
  map.renameLayer(terrain, "Ground");
  map.reorderLayers([buildings, terrain]);
  assert.deepEqual(map.layers, [
    { id: buildings, name: "Buildings" },
    { id: terrain, name: "Ground" },
  ]);
  assert.equal(before[0].name, "Terrain");
  assert.deepEqual(map.getCell(terrain, 63, 64), grass);
  assert.deepEqual(map.getCell(buildings, 63, 64), black);
  map.clearCell(buildings, 63, 64);
  assert.deepEqual(map.getCell(terrain, 63, 64), grass);
  assert.equal(map.renameLayer(terrain, "Ground").change, null);
  assert.equal(map.reorderLayers([buildings, terrain]).change, null);
  map.addLayer({ id: layerId("extra"), name: "Ground" }, 1);
  assert.equal(map.layers[1].id, "extra"); // Duplicate names are not duplicate IDs.
  assert.equal(map.getCell(layerId("extra"), 63, 64), null);
  assert.throws(
    () => map.addLayer({ id: terrain, name: "Again" }),
    /Duplicate/,
  );
  assert.throws(
    () => map.reorderLayers([terrain, terrain, buildings]),
    /every layer/,
  );
  assert.throws(
    () => map.reorderLayers([terrain, buildings, layerId("missing")]),
    /Unknown/,
  );
  assert.throws(() => map.renameLayer(terrain, "  "), /blank/);
  assert.throws(
    () => map.addLayer({ id: layerId("bad-index"), name: "X" }, 1.1),
    RangeError,
  );
  assert.throws(() => new MapDocument({ layers: [] }), RangeError);
  assert.throws(
    () => new MapDocument({ layers: [before[0], before[0]] }),
    /Duplicate/,
  );
});

test("writes span positive/negative visual boundaries, storage partitions, and partial map edges", () => {
  const map = document();
  const addresses = [-128, -65, -64, -33, -32, -1, 0, 31, 32, 63, 64, 65, 6399];
  for (const x of addresses)
    for (const y of addresses) map.setCell(terrain, x, y, black);
  for (const x of addresses)
    for (const y of addresses)
      assert.deepEqual(map.getCell(terrain, x, y), black);
  map.writeBatch(
    [-65, -33, -1, 31, 63].map((x) => ({
      layerId: buildings,
      x,
      y: 63,
      length: 3,
      value: grass,
    })),
  );
  for (const x of [-65, -33, -1, 31, 63])
    for (let i = 0; i < 3; i++)
      assert.deepEqual(map.getCell(buildings, x + i, 63), grass);
  const partial = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 101, maxY: 130 },
  });
  partial.setCell(partial.layers[0].id, 100, 129, white);
  assert.deepEqual(
    [...partial.iterateCells()].map(({ x, y }) => [x, y]),
    [[100, 129]],
  );
});

test("invalid coordinates, layers, cells, and late batch failures leave content/version/allocation unchanged", () => {
  const map = document();
  map.setCell(terrain, 0, 0, black);
  const before = map.storageStats(),
    version = map.version;
  const valid: TileWrite = {
    layerId: terrain,
    x: 1,
    y: 1,
    length: 1,
    value: white,
  };
  for (const [x, y] of [
    [-129, 0],
    [6400, 0],
    [0, 6400],
    [0, -129],
    [0.1, 0],
    [NaN, 0],
    [0, Infinity],
    [Number.MAX_SAFE_INTEGER + 1, 0],
  ]) {
    assert.throws(() => map.getCell(terrain, x, y), RangeError);
    assert.throws(
      () => map.writeBatch([valid, { ...valid, x, y }]),
      RangeError,
    );
  }
  for (const bad of [
    { ...valid, length: 0 },
    { ...valid, length: -1 },
    { ...valid, length: 1.5 },
    { ...valid, length: Number.MAX_SAFE_INTEGER },
    { ...valid, x: 6399, length: 2 },
    { ...valid, layerId: layerId("missing") },
    { ...valid, value: { kind: "raw", rgba: "#bad" } },
    { ...valid, value: { kind: "registered", rgba: "#000000ff" } },
    { ...valid, value: undefined },
  ])
    assert.throws(() => map.writeBatch([valid, bad as TileWrite]));
  assert.throws(
    () =>
      map.writeBatch(
        (function* () {
          yield valid;
          throw new Error("input failed");
        })(),
      ),
    /input failed/,
  );
  assert.throws(
    () =>
      map.writeBatch(
        (function* () {
          yield valid;
          map.setCell(terrain, 9, 9, black);
        })(),
      ),
    /Reentrant/,
  );
  assert.equal(map.version, version);
  assert.deepEqual(map.storageStats(), before);
  assert.equal(map.getCell(terrain, 1, 1), null);
  assert.deepEqual(map.getCell(terrain, 0, 0), black);
});

test("batch notifications carry compact ordered inverse data across layers and partitions", () => {
  const map = document();
  const events: DocumentChange[] = [];
  const stop = map.subscribe((event) => {
    events.push(event);
    assert.deepEqual(map.getCell(buildings, 64, 64), white);
  });
  const result = map.writeBatch([
    { layerId: terrain, x: 30, y: 64, length: 40, value: black },
    { layerId: terrain, x: 31, y: 64, length: 34, value: grass },
    { layerId: buildings, x: 64, y: 64, length: 1, value: white },
  ]);
  assert.equal(result.observerErrors.length, 0);
  assert.equal(events.length, 1);
  const change = result.change;
  assert.equal(change?.kind, "tiles");
  if (change?.kind !== "tiles") throw new Error("Missing tile delta");
  assert.deepEqual(
    change.runs.map(({ before, after, length }) => ({ before, after, length })),
    [
      { before: null, after: black, length: 40 },
      { before: black, after: grass, length: 34 },
      { before: null, after: white, length: 1 },
    ],
  );
  assert.equal(map.setCell(terrain, 32, 64, grass).change, null);
  assert.equal(events.length, 1);
  stop();
  stop();
  map.writeBatch(
    [...change.runs].reverse().map((run) => ({ ...run, value: run.before })),
  );
  assert.equal(map.storageStats().occupiedCells, 0);
  assert.equal(map.storageStats().paletteEntries, 0);
  assert.equal(events.length, 1);
});

test("input and output snapshots cannot mutate the document; failing/reentrant observers are isolated", () => {
  const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const inputLayer = { id: terrain, name: "Terrain" };
  const map = new MapDocument({ bounds, layers: [inputLayer] });
  bounds.maxX = 1;
  inputLayer.name = "Wrong";
  const value = { kind: "raw" as const, rgba: "#AABBCCFF" };
  const seen: DocumentChange[] = [];
  map.subscribe(() => {
    throw new Error("broken observer");
  });
  map.subscribe(() => {
    map.setCell(terrain, 1, 1, white);
  });
  map.subscribe((event) => seen.push(event));
  const result = map.setCell(terrain, 99, 99, value);
  value.rgba = "#ffffffff";
  assert.equal(result.observerErrors.length, 2);
  assert.equal(seen.length, 1);
  assert.equal(map.getCell(terrain, 1, 1), null);
  assert.deepEqual(map.getCell(terrain, 99, 99), rawColor("#aabbccff"));
  assert.equal(map.layers[0].name, "Terrain");
  for (const object of [
    map.bounds,
    map.layers,
    map.layers[0],
    map.getCell(terrain, 99, 99),
    result,
    result.change,
  ])
    assert.ok(Object.isFrozen(object));
  if (result.change?.kind === "tiles") {
    assert.ok(Object.isFrozen(result.change.runs));
    assert.ok(Object.isFrozen(result.change.runs[0]));
    assert.ok(Object.isFrozen(result.change.runs[0].after));
  }
});

test("enumeration is layer/y/x deterministic, coalesces runs, clips windows, and detects mutation", () => {
  const writes: TileWrite[] = [
    { layerId: terrain, x: 30, y: 0, length: 40, value: black },
    { layerId: terrain, x: -33, y: -1, length: 3, value: grass },
    { layerId: terrain, x: 0, y: 1, length: 1, value: white },
    { layerId: buildings, x: 0, y: -2, length: 1, value: grass },
  ];
  const a = document(),
    b = document();
  a.writeBatch(writes);
  b.writeBatch([...writes].reverse());
  assert.deepEqual([...a.iterateRuns()], [...b.iterateRuns()]);
  assert.deepEqual(
    [...a.iterateRuns()].map(({ layerId, x, y, length }) => [
      layerId,
      x,
      y,
      length,
    ]),
    [
      [terrain, -33, -1, 3],
      [terrain, 30, 0, 40],
      [terrain, 0, 1, 1],
      [buildings, 0, -2, 1],
    ],
  );
  assert.deepEqual(
    [...a.iterateRuns(terrain, { minX: 31, minY: 0, maxX: 65, maxY: 1 })],
    [{ layerId: terrain, x: 31, y: 0, length: 34, value: black }],
  );
  assert.deepEqual(
    [...a.iterateCells(terrain, { minX: 0, minY: 0, maxX: 0, maxY: 0 })],
    [],
  );
  assert.throws(
    () => a.iterateRuns(terrain, { minX: -129, minY: 0, maxX: 0, maxY: 1 }),
    RangeError,
  );
  assert.throws(
    () => a.iterateRuns(terrain, { minX: 0.1, minY: 0, maxX: 1, maxY: 1 }),
    RangeError,
  );
  const pending = a.iterateRuns();
  a.renameLayer(terrain, "Changed");
  assert.throws(() => pending.next(), /changed during iteration/);
  const cells = a.iterateCells();
  cells.next();
  a.setCell(terrain, 30, 0, white);
  assert.throws(() => cells.next(), /changed during iteration/);
});

test("explicit bounds updates preserve world coordinates and reject data loss and overflow", () => {
  const map = new MapDocument();
  const id = map.layers[0].id;
  map.setCell(id, 63, 63, grass);
  const event = map.setBounds({
    minX: -64,
    minY: -64,
    maxX: 320,
    maxY: 320,
  }).change;
  assert.equal(event?.kind, "bounds");
  assert.deepEqual(map.getCell(id, 63, 63), grass);
  assert.equal(map.getCell(id, -64, -64), null);
  const previous = map.bounds;
  assert.throws(
    () => map.setBounds({ minX: 64, minY: 64, maxX: 320, maxY: 320 }),
    /discard/,
  );
  assert.equal(map.bounds, previous);
  assert.throws(
    () =>
      map.setBounds({
        minX: -Number.MAX_SAFE_INTEGER,
        minY: 0,
        maxX: 1,
        maxY: 2,
      }),
    RangeError,
  );
  map.setBounds({ minX: 0, minY: 0, maxX: 256, maxY: 256 });
  assert.equal(map.setBounds(map.bounds).change, null);
});

test("safe-integer extremes retain exact addresses at storage edges", () => {
  for (const minX of [
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER - 100,
  ]) {
    const map = new MapDocument({
      bounds: { minX, minY: minX, maxX: minX + 100, maxY: minX + 100 },
    });
    const id = map.layers[0].id;
    map.writeBatch([
      { layerId: id, x: minX, y: minX, length: 100, value: black },
    ]);
    assert.deepEqual(
      [...map.iterateRuns()],
      [{ layerId: id, x: minX, y: minX, length: 100, value: black }],
    );
    assert.deepEqual(map.getCell(id, minX + 99, minX), black);
    map.writeBatch([
      { layerId: id, x: minX, y: minX, length: 100, value: null },
    ]);
    assert.equal(map.storageStats().partitions, 0);
  }
});

test("partitions promote/demote and reclaim palette data through repeated repaint/erase cycles", () => {
  const map = document();
  for (let cycle = 0; cycle < 3; cycle++) {
    map.writeBatch(
      Array.from({ length: 32 }, (_, y) => ({
        layerId: terrain,
        x: 0,
        y,
        length: 32,
        value: black,
      })),
    );
    assert.equal(map.storageStats().layers[0].densePartitions, 1);
    assert.equal(map.storageStats().typedArrayBytes, 4096);
    for (let x = 0; x < 32; x++)
      map.setCell(
        terrain,
        x,
        0,
        rawColor(`#${(x + 1).toString(16).padStart(6, "0")}ff`),
      );
    assert.equal(map.storageStats().paletteEntries, 33);
    map.writeBatch(
      Array.from({ length: 30 }, (_, y) => ({
        layerId: terrain,
        x: 0,
        y,
        length: 32,
        value: null,
      })),
    );
    assert.equal(map.storageStats().layers[0].sparsePartitions, 1);
    assert.equal(map.storageStats().typedArrayBytes, 0);
    assert.equal(map.storageStats().paletteEntries, 1);
    map.writeBatch([
      { layerId: terrain, x: 0, y: 30, length: 32, value: null },
      { layerId: terrain, x: 0, y: 31, length: 32, value: null },
    ]);
    assert.equal(map.storageStats().paletteEntries, 0);
    assert.equal(map.storageStats().partitions, 0);
  }
});

test("seeded mixed batches agree with an independent per-cell oracle and inverse replay", () => {
  const map = document();
  const oracle = new Map<string, Cell>();
  const values = [null, black, white, grass];
  let seed = 123456;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let batch = 0; batch < 100; batch++) {
    const before = [...map.iterateCells()];
    const writes = Array.from({ length: 20 }, () => ({
      layerId: random() % 2 ? terrain : buildings,
      x: (random() % 160) - 80,
      y: (random() % 160) - 80,
      length: (random() % 40) + 1,
      value: values[random() % 4],
    }));
    const result = map.writeBatch(writes);
    for (const write of writes)
      for (let x = write.x; x < write.x + write.length; x++) {
        const key = `${write.layerId}/${x}/${write.y}`;
        if (write.value === null) oracle.delete(key);
        else oracle.set(key, write.value);
      }
    assert.deepEqual(
      new Map(
        [...map.iterateCells()].map((cell) => [
          `${cell.layerId}/${cell.x}/${cell.y}`,
          cell.value,
        ]),
      ),
      oracle,
    );
    if (result.change?.kind === "tiles") {
      map.writeBatch(
        [...result.change.runs]
          .reverse()
          .map((run) => ({ ...run, value: run.before })),
      );
      assert.deepEqual([...map.iterateCells()], before);
      map.writeBatch(writes);
    }
  }
});

test("identity namespaces and raw/reference types cannot be interchanged", () => {
  assert.equal(annotationId("house-1"), "house-1");
  assert.throws(() => registryId(""), TypeError);
  assert.throws(() => layerId("invalid name"), TypeError);
  assert.throws(() => rawColor("grass"), TypeError);
  assert.notDeepEqual(
    rawColor("#000000ff"),
    registeredColor(registryId("000000ff")),
  );
  // Compiled by both strict configurations; invalid interchange must stay rejected.
  const checkTypes = (
    layer: LayerId,
    registry: RegistryId,
    annotation: AnnotationId,
  ) => {
    // @ts-expect-error A layer identity is not a registry identity.
    registeredColor(layer);
    // @ts-expect-error An annotation identity is not a registry identity.
    registeredColor(annotation);
    // @ts-expect-error Registry identities cannot address layers.
    document().getCell(registry, 0, 0);
  };
  void checkTypes;
});
