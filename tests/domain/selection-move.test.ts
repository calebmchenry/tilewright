import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { containsTile, type Bounds } from "../../src/domain/coordinates.ts";
import {
  captureSelection,
  planSelectionMove,
} from "../../src/domain/selection.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  type Cell,
} from "../../src/domain/values.ts";
import {
  movementDocument,
  house,
  terrain,
  walls,
  furniture,
  stone,
} from "../fixtures/selection.ts";

function cells(doc: MapDocument) {
  return doc.layers.map(({ id }) => {
    const result: Cell[] = [];
    for (let y = doc.bounds.minY; y < doc.bounds.maxY; y++)
      for (let x = doc.bounds.minX; x < doc.bounds.maxX; x++)
        result.push(doc.getCell(id, x, y));
    return result;
  });
}
function oracle(
  doc: MapDocument,
  source: Bounds,
  ids: readonly string[],
  dx: number,
  dy: number,
) {
  const destination = {
    minX: source.minX + dx,
    maxX: source.maxX + dx,
    minY: source.minY + dy,
    maxY: source.maxY + dy,
  };
  return doc.layers.map(({ id }) => {
    const result: Cell[] = [];
    for (let y = doc.bounds.minY; y < doc.bounds.maxY; y++)
      for (let x = doc.bounds.minX; x < doc.bounds.maxX; x++) {
        let value = doc.getCell(id, x, y);
        if (ids.includes(id)) {
          if (containsTile(destination, x, y))
            value = doc.getCell(id, x - dx, y - dy) ?? value;
          else if (containsTile(source, x, y)) value = null;
        }
        result.push(value);
      }
    return result;
  });
}

for (const [dx, dy] of [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [8, 0],
  [-8, 0],
  [0, 8],
  [0, -8],
])
  test(`exact complete layered cell maps and inverses for move (${dx},${dy})`, () => {
    const a = layerId("a"),
      b = layerId("b"),
      excluded = layerId("excluded");
    const doc = new MapDocument({
      bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 },
      layers: [a, b, excluded].map((id) => ({ id, name: id })),
    });
    // Asymmetric holes, alpha-zero paint, occupied destinations and an excluded layer.
    for (const id of [a, b, excluded])
      for (let y = -12; y < 12; y++)
        for (let x = -12; x < 12; x++)
          if ((x * 7 + y * 13 + (id === a ? 0 : 1)) % 3 !== 0)
            doc.setCell(
              id,
              x,
              y,
              rawColor(
                x === 0 && y === 0
                  ? "#12345600"
                  : `#${((x + 12) * 801 + (y + 12) * 17).toString(16).padStart(6, "0")}ff`,
              ),
            );
    const bounds = { minX: -1, minY: -2, maxX: 3, maxY: 2 };
    const before = cells(doc),
      expected = oracle(doc, bounds, [a, b], dx, dy);
    const history = new CommandHistory(doc, { initiallySaved: true });
    const payload = captureSelection(doc, bounds, [a, b]);
    const plan = planSelectionMove(doc, payload, dx, dy);
    assert.deepEqual(cells(doc), before);
    assert.ok(Object.isFrozen(plan.writes));
    let events = 0;
    doc.subscribe(() => events++);
    history.execute("Move selection", [{ kind: "tiles", writes: plan.writes }]);
    assert.equal(events, 1);
    assert.equal(history.state.undoSteps, 1);
    assert.deepEqual(cells(doc), expected);
    history.undo();
    assert.deepEqual(cells(doc), before);
    assert.equal(history.state.dirty, false);
    history.redo();
    assert.deepEqual(cells(doc), expected);
  });

test("intent house: exact three-tile move, overwritten walls, retained furniture hole, terrain and annotation metadata", () => {
  const doc = movementDocument(),
    before = cells(doc),
    metadata = [doc.bounds, doc.layers, doc.registryEntries, doc.annotations];
  const expected = oracle(doc, house, [walls, furniture], 3, 0);
  const history = new CommandHistory(doc);
  const plan = planSelectionMove(
    doc,
    captureSelection(doc, house, [walls, furniture]),
    3,
    0,
  );
  history.execute("Move selection", [{ kind: "tiles", writes: plan.writes }]);
  assert.deepEqual(cells(doc), expected);
  assert.deepEqual(doc.getCell(walls, 70, 67), registeredColor(stone));
  assert.equal(doc.getCell(walls, 60, 60), null);
  assert.deepEqual(doc.getCell(furniture, 64, 61), rawColor("#ddeeffff"));
  assert.deepEqual(doc.getCell(furniture, 67, 61), rawColor("#00000000"));
  assert.deepEqual(doc.getCell(furniture, 70, 66), rawColor("#ff0000ff"));
  assert.deepEqual(
    [doc.bounds, doc.layers, doc.registryEntries, doc.annotations],
    metadata,
  );
  assert.equal(doc.getCell(terrain, 60, 60)?.kind, "raw");
  history.undo();
  assert.deepEqual(cells(doc), before);
  history.redo();
  assert.deepEqual(cells(doc), expected);
});

test("snapshot identity/version, boundaries in every direction, safe arithmetic and capacity reject atomically", () => {
  const doc = movementDocument(),
    history = new CommandHistory(doc, {
      limits: { maxBytes: 1 },
      initiallySaved: true,
    });
  history.markRecovery(history.captureCheckpoint());
  const before = cells(doc),
    state = history.state,
    version = doc.version;
  const payload = captureSelection(doc, house, [walls, furniture]);
  assert.throws(
    () => planSelectionMove(movementDocument(), payload, 1, 0),
    /another document/,
  );
  for (const [dx, dy] of [
    [-126, 0],
    [64, 0],
    [0, -126],
    [0, 66],
    [-126, -126],
    [64, 66],
    [Number.MAX_SAFE_INTEGER, 0],
    [0, Infinity],
    [0.5, 0],
  ])
    assert.throws(() => planSelectionMove(doc, payload, dx, dy));
  // Touch every signed/partial boundary exactly, including a corner.
  for (const [dx, dy] of [
    [-125, 0],
    [63, 0],
    [0, -125],
    [0, 65],
    [-125, -125],
    [63, 65],
  ])
    assert.ok(planSelectionMove(doc, payload, dx, dy));
  let events = 0;
  doc.subscribe(() => events++);
  assert.throws(
    () =>
      history.execute("Move selection", [
        { kind: "tiles", writes: planSelectionMove(doc, payload, 3, 0).writes },
      ]),
    /history byte limit/,
  );
  assert.deepEqual(cells(doc), before);
  assert.deepEqual(history.state, state);
  assert.equal(doc.version, version);
  assert.equal(events, 0);
  doc.setCell(furniture, 10, 10, rawColor("#ffffffff"));
  assert.throws(() => planSelectionMove(doc, payload, 1, 0), /stale/);
});

test("zero-offset and all-hole plans preserve complete state, redo and checkpoints", () => {
  const doc = movementDocument(),
    history = new CommandHistory(doc, { initiallySaved: true });
  history.execute("temporary", [
    {
      kind: "tiles",
      writes: [
        {
          layerId: walls,
          x: 10,
          y: 10,
          length: 1,
          value: rawColor("#ffffffff"),
        },
      ],
    },
  ]);
  history.undo();
  history.markRecovery(history.captureCheckpoint());
  const before = cells(doc),
    state = history.state,
    version = doc.version;
  for (const [bounds, dx, dy] of [
    [house, 0, 0],
    [{ minX: 0, minY: 0, maxX: 8, maxY: 8 }, 3, 0],
  ] as const) {
    const plan = planSelectionMove(
      doc,
      captureSelection(doc, bounds, [walls, furniture]),
      dx,
      dy,
    );
    assert.equal(plan.writes.length, 0);
    assert.equal(
      history.execute("Move selection", [
        { kind: "tiles", writes: plan.writes },
      ]).change,
      null,
    );
  }
  assert.deepEqual(cells(doc), before);
  assert.deepEqual(history.state, state);
  assert.equal(doc.version, version);
});
