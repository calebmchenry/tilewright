import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { containsTile } from "../../src/domain/coordinates.ts";
import {
  captureSelection,
  selectionCell,
  transformSelection,
  planSelectionTransform,
  type SelectionPayload,
  type SelectionTransform,
} from "../../src/domain/selection.ts";
import {
  captureClipboard,
  transformClipboard,
  planClipboardPaste,
  clipboardBounds,
} from "../../src/domain/clipboard.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  type Cell,
} from "../../src/domain/values.ts";
import {
  movementDocument,
  walls,
  furniture,
  stone,
} from "../fixtures/selection.ts";
const operations: SelectionTransform[] = [
  "rotate-clockwise",
  "rotate-counterclockwise",
  "flip-horizontal",
  "flip-vertical",
];
function local(p: SelectionPayload) {
  return p.layers.map((l) =>
    Array.from({ length: p.height }, (_, y) =>
      Array.from({ length: p.width }, (_, x) =>
        selectionCell(p, l.layerId, x, y),
      ),
    ),
  );
}
function cells(d: MapDocument) {
  return d.layers.map((l) =>
    Array.from({ length: d.bounds.maxY - d.bounds.minY }, (_, y) =>
      Array.from({ length: d.bounds.maxX - d.bounds.minX }, (_, x) =>
        d.getCell(l.id, x + d.bounds.minX, y + d.bounds.minY),
      ),
    ),
  );
}
// Independent dense matrix oracle: transpose/reverse rather than coordinate formulas.
function matrixTransform(matrix: Cell[][], op: SelectionTransform): Cell[][] {
  if (op === "flip-horizontal") return matrix.map((row) => [...row].reverse());
  if (op === "flip-vertical") return [...matrix].reverse();
  const transposed = matrix[0].map((_, x) => matrix.map((row) => row[x]));
  return op === "rotate-clockwise"
    ? transposed.map((row) => row.reverse())
    : transposed.reverse();
}
for (const [width, height] of [
  [3, 2],
  [1, 5],
  [5, 1],
  [1, 1],
  [4, 7],
])
  for (const op of operations)
    test(`${op}: exact sparse ${width}x${height} geometry, identity, overlap and inverse`, () => {
      const d = new MapDocument({
        bounds: { minX: -8, minY: -8, maxX: 12, maxY: 12 },
        layers: [walls, furniture, layerId("excluded")].map((id) => ({
          id,
          name: id,
        })),
      });
      d.applyCommands([
        {
          kind: "registry",
          id: stone,
          value: { name: "Stone", rgba: "#112233ff" },
        },
      ]);
      for (const { id } of d.layers)
        for (let y = -8; y < 12; y++)
          for (let x = -8; x < 12; x++)
            if ((x * 13 + y * 7 + (id === walls ? 0 : 1)) % 3 !== 0)
              d.setCell(
                id,
                x,
                y,
                (x + y) % 4 === 0
                  ? registeredColor(stone)
                  : rawColor(
                      `#${((x + 8) * 500 + (y + 8) * 17).toString(16).padStart(6, "0")}00`,
                    ),
              );
      const source = captureSelection(
        d,
        { minX: -2, minY: -1, maxX: -2 + width, maxY: -1 + height },
        [walls, furniture],
      );
      const before = cells(d),
        original = local(source),
        transformed = transformSelection(source, op);
      assert.deepEqual(
        local(transformed),
        original.map((m) => matrixTransform(m, op)),
      );
      assert.equal(transformed.width, op.startsWith("rotate") ? height : width);
      assert.equal(
        transformed.height,
        op.startsWith("rotate") ? width : height,
      );
      assert.deepEqual(local(source), original);
      let cycle = source;
      for (let i = 0; i < (op.startsWith("rotate") ? 4 : 2); i++)
        cycle = transformSelection(cycle, op);
      assert.deepEqual(local(cycle), original);
      assert.deepEqual(cycle.bounds, source.bounds);
      assert.deepEqual(
        local(
          transformSelection(
            transformSelection(source, "rotate-clockwise"),
            "rotate-counterclockwise",
          ),
        ),
        original,
      );
      assert.ok(Object.isFrozen(transformed.layers[0].runs));
      const bounds = clipboardBounds(transformed, -1, 0),
        expected = structuredClone(before),
        incoming = local(transformed);
      for (let l = 0; l < 2; l++)
        for (let y = -8; y < 12; y++)
          for (let x = -8; x < 12; x++) {
            if (containsTile(bounds, x, y))
              expected[l][y + 8][x + 8] =
                incoming[l][y - bounds.minY][x - bounds.minX] ??
                before[l][y + 8][x + 8];
            else if (containsTile(source.bounds, x, y))
              expected[l][y + 8][x + 8] = null;
          }
      const h = new CommandHistory(d, { initiallySaved: true });
      h.markRecovery(h.captureCheckpoint());
      const plan = planSelectionTransform(d, source, transformed, bounds);
      assert.deepEqual(cells(d), before);
      h.execute("Transform selection", [
        { kind: "tiles", writes: plan.writes },
      ]);
      assert.deepEqual(cells(d), expected);
      h.undo();
      assert.deepEqual(cells(d), before);
      assert.equal(h.state.dirty, false);
      h.redo();
      assert.deepEqual(cells(d), expected);
    });

test("documented 3x2 example preserves holes in overlap and exactly restores overwritten destinations", () => {
  const d = new MapDocument({
    bounds: { minX: 10, minY: 20, maxX: 13, maxY: 23 },
    layers: [{ id: walls, name: "Walls" }],
  });
  const colors = [1, 2, 3, 4, 5, 6, 7].map((v) => rawColor(`#00000${v}ff`));
  for (const [x, y, i] of [
    [10, 20, 0],
    [12, 20, 1],
    [10, 21, 2],
    [11, 21, 3],
    [12, 21, 4],
    [10, 22, 5],
    [11, 22, 6],
  ])
    d.setCell(walls, x, y, colors[i]);
  const before = cells(d),
    p = captureSelection(d, { minX: 10, minY: 20, maxX: 13, maxY: 22 }, [
      walls,
    ]),
    t = transformSelection(p, "rotate-clockwise");
  assert.deepEqual(local(t)[0], [
    [colors[2], colors[0]],
    [colors[3], null],
    [colors[4], colors[1]],
  ]);
  const h = new CommandHistory(d);
  h.execute("Transform", [
    { kind: "tiles", writes: planSelectionTransform(d, p, t).writes },
  ]);
  assert.deepEqual(cells(d)[0], [
    [colors[2], colors[0], null],
    [colors[3], colors[3], null],
    [colors[4], colors[1], null],
  ]);
  h.undo();
  assert.deepEqual(cells(d), before);
});

test("bounds including all-hole extents, provenance, stale captures, capacity and no-op preserve persistent state", () => {
  const d = movementDocument(),
    p = captureSelection(d, { minX: 128, minY: 131, maxX: 131, maxY: 133 }, [
      walls,
      furniture,
    ]);
  const t = transformSelection(p, "rotate-clockwise");
  assert.throws(() => planSelectionTransform(d, p, t), /entire selection/);
  for (const [x, y] of [
    [-65, -65],
    [129, 130],
  ])
    assert.ok(planSelectionTransform(d, p, t, clipboardBounds(t, x, y)));
  for (const [x, y] of [
    [-66, 0],
    [130, 0],
    [0, -66],
    [0, 131],
    [Number.MAX_SAFE_INTEGER, 0],
    [0, Infinity],
    [0.5, 0],
  ])
    assert.throws(() =>
      planSelectionTransform(d, p, t, clipboardBounds(t, x, y)),
    );
  assert.throws(
    () => planSelectionTransform(movementDocument(), p, t),
    /another document/,
  );
  const source = captureSelection(
    d,
    { minX: 60, minY: 60, maxX: 68, maxY: 68 },
    [walls, furniture],
  );
  assert.throws(() => planSelectionTransform(d, source, t), /another document/);
  const h = new CommandHistory(d, {
    limits: { maxBytes: 1 },
    initiallySaved: true,
  });
  h.markRecovery(h.captureCheckpoint());
  const before = cells(d),
    state = h.state,
    version = d.version;
  let events = 0;
  d.subscribe(() => events++);
  assert.throws(
    () =>
      h.execute("Transform", [
        {
          kind: "tiles",
          writes: planSelectionTransform(
            d,
            source,
            transformSelection(source, "flip-horizontal"),
          ).writes,
        },
      ]),
    /history byte limit/,
  );
  let cycle = source;
  for (let i = 0; i < 4; i++)
    cycle = transformSelection(cycle, "rotate-clockwise");
  assert.equal(
    h.execute("identity", [
      {
        kind: "tiles",
        writes: planSelectionTransform(d, source, cycle).writes,
      },
    ]).change,
    null,
  );
  assert.deepEqual(cells(d), before);
  assert.deepEqual(h.state, state);
  assert.equal(d.version, version);
  assert.equal(events, 0);
  d.setCell(walls, 0, 0, rawColor("#ffffffff"));
  assert.throws(() => planSelectionTransform(d, source, cycle), /stale/);
});

test("transformed clipboard retains session provenance, no source clearing, metadata, and stored payload", () => {
  const d = movementDocument(),
    owner = {},
    p = captureClipboard(d, owner, { minX: 60, minY: 60, maxX: 68, maxY: 66 }, [
      walls,
      furniture,
    ]);
  const before = cells(d),
    original = local(p),
    metadata = [d.bounds, d.layers, d.registryEntries, d.annotations];
  const t = transformClipboard(p, "rotate-counterclockwise");
  assert.throws(() => planClipboardPaste(d, {}, t, 80, 80), /Cross-document/);
  const h = new CommandHistory(d);
  h.execute("Paste", [
    { kind: "tiles", writes: planClipboardPaste(d, owner, t, 80, 80).writes },
  ]);
  assert.deepEqual(
    local(captureSelection(d, p.bounds, [walls, furniture])),
    original,
  );
  assert.deepEqual(
    local(captureSelection(d, clipboardBounds(t, 80, 80), [walls, furniture])),
    local(t),
  );
  assert.deepEqual(local(p), original);
  assert.deepEqual(
    [d.bounds, d.layers, d.registryEntries, d.annotations],
    metadata,
  );
  h.undo();
  assert.deepEqual(cells(d), before);
});
