import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureClipboard,
  planClipboardCut,
  planClipboardPaste,
  validateClipboard,
} from "../../src/domain/clipboard.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { layerId, rawColor, registeredColor } from "../../src/domain/values.ts";
import {
  movementDocument,
  house,
  walls,
  furniture,
  terrain,
  stone,
} from "../fixtures/selection.ts";

const content = (doc: ReturnType<typeof movementDocument>) => ({
  cells: [...doc.iterateCells()],
  bounds: doc.bounds,
  layers: doc.layers,
  registry: doc.registryEntries,
  annotations: doc.annotations,
});

test("clipboard copy is immutable and tile-only; layered paste follows an independent cell oracle and exact undo/redo", () => {
  const doc = movementDocument(),
    owner = {};
  doc.setCell(furniture, 62, 62, rawColor("#b18b4dff"));
  // History starts after fixture setup.
  const history = new CommandHistory(doc, { initiallySaved: true });
  history.markRecovery(history.captureCheckpoint());
  const before = content(doc),
    state = history.state,
    version = doc.version;
  const payload = captureClipboard(doc, owner, house, [walls, furniture]);
  assert.ok(Object.isFrozen(payload.layers[0].runs));
  assert.equal("annotations" in payload, false);
  assert.deepEqual(content(doc), before);
  assert.deepEqual(history.state, state);
  assert.equal(doc.version, version);
  for (const [x, y] of [
    [63, 60],
    [80, 80],
    [-65, -65],
  ]) {
    const plan = planClipboardPaste(doc, owner, payload, x, y);
    const expected = new Map(
      before.cells.map((c) => [`${c.layerId}:${c.x}:${c.y}`, c.value]),
    );
    for (const cell of before.cells) {
      if (
        [walls, furniture].includes(cell.layerId) &&
        cell.x >= 60 &&
        cell.x < 68 &&
        cell.y >= 60 &&
        cell.y < 68
      )
        expected.set(
          `${cell.layerId}:${x + cell.x - 60}:${y + cell.y - 60}`,
          cell.value,
        );
    }
    history.execute("Paste", [{ kind: "tiles", writes: plan.writes }]);
    assert.deepEqual(
      new Map(
        [...doc.iterateCells()].map((c) => [
          `${c.layerId}:${c.x}:${c.y}`,
          c.value,
        ]),
      ),
      expected,
    );
    assert.deepEqual(doc.annotations, before.annotations);
    assert.equal(history.state.undoSteps, 1);
    const after = content(doc);
    history.undo();
    assert.deepEqual(content(doc), before);
    history.redo();
    assert.deepEqual(content(doc), after);
    history.undo();
  }
  // Snapshot stays frozen after source edit; registered IDs remain identities.
  history.execute("Erase source", [
    {
      kind: "tiles",
      writes: [{ layerId: walls, x: 60, y: 60, length: 8, value: null }],
    },
  ]);
  const paste = planClipboardPaste(doc, owner, payload, 80, 80);
  history.execute("Paste", [{ kind: "tiles", writes: paste.writes }]);
  assert.deepEqual(doc.getCell(walls, 80, 80), registeredColor(stone));
  history.execute("Recolor", [
    {
      kind: "registry",
      id: stone,
      value: { name: "Stone", rgba: "#112233ff" },
    },
  ]);
  assert.deepEqual(doc.getCell(walls, 60, 61), doc.getCell(walls, 80, 81));
  assert.deepEqual(doc.getCell(furniture, 82, 82), rawColor("#b18b4dff"));
  assert.deepEqual(doc.getCell(furniture, 84, 81), rawColor("#00000000"));
  assert.equal(
    planClipboardPaste(doc, owner, payload, 90, 90).writes[0].value!.kind,
    "registered",
  );
});

test("cut clears only included occupied cells immediately, empty cut/paste and identical paste preserve history/checkpoints", () => {
  const doc = movementDocument(),
    owner = {},
    h = new CommandHistory(doc, { initiallySaved: true });
  h.markRecovery(h.captureCheckpoint());
  const payload = captureClipboard(doc, owner, house, [walls, furniture]),
    before = content(doc);
  const terrainBefore = [...doc.iterateRuns(terrain)];
  h.execute("Cut", [
    { kind: "tiles", writes: planClipboardCut(doc, owner, payload) },
  ]);
  assert.equal([...doc.iterateRuns(walls, house)].length, 0);
  assert.equal([...doc.iterateRuns(furniture, house)].length, 0);
  assert.deepEqual([...doc.iterateRuns(terrain)], terrainBefore);
  assert.deepEqual(doc.annotations, before.annotations);
  assert.equal(h.state.undoSteps, 1);
  assert.throws(() => planClipboardCut(doc, owner, payload), /changed/);
  assert.throws(
    () => planClipboardPaste(doc, owner, payload, 130, 132),
    /entire/,
  );
  assert.equal(doc.getCell(walls, 60, 60), null);
  h.undo();
  assert.deepEqual(content(doc), before);
  const state = h.state,
    version = doc.version;
  h.execute("Paste", [
    {
      kind: "tiles",
      writes: planClipboardPaste(doc, owner, payload, 60, 60).writes,
    },
  ]);
  const empty = captureClipboard(
    doc,
    owner,
    { minX: 0, minY: 0, maxX: 8, maxY: 8 },
    [walls, furniture],
  );
  h.execute("Cut", [
    { kind: "tiles", writes: planClipboardCut(doc, owner, empty) },
  ]);
  h.execute("Paste", [
    {
      kind: "tiles",
      writes: planClipboardPaste(doc, owner, empty, 70, 60).writes,
    },
  ]);
  assert.deepEqual(h.state, state);
  assert.equal(doc.version, version);
  assert.deepEqual(content(doc), before);
});

test("whole-rectangle bounds include holes, signed edges and safe arithmetic; capacity rejection is atomic", () => {
  const doc = movementDocument(),
    owner = {},
    h = new CommandHistory(doc, { limits: { maxEntries: 10, maxBytes: 1 } });
  const payload = captureClipboard(doc, owner, house, [walls, furniture]);
  const before = content(doc),
    state = h.state,
    version = doc.version;
  for (const [x, y] of [
    [-66, 0],
    [0, -66],
    [124, 0],
    [0, 126],
    [-66, -66],
    [124, 126],
    [Number.MAX_SAFE_INTEGER, 0],
    [0.5, 0],
  ])
    assert.throws(() => planClipboardPaste(doc, owner, payload, x, y));
  for (const [x, y] of [
    [-65, -65],
    [123, 125],
  ])
    assert.ok(planClipboardPaste(doc, owner, payload, x, y));
  for (const writes of [
    planClipboardCut(doc, owner, payload),
    planClipboardPaste(doc, owner, payload, 80, 80).writes,
  ])
    assert.throws(() => h.execute("Edit", [{ kind: "tiles", writes }]));
  assert.deepEqual(content(doc), before);
  assert.deepEqual(h.state, state);
  assert.equal(doc.version, version);
  const empty = captureClipboard(
    doc,
    owner,
    { minX: 0, minY: 0, maxX: 8, maxY: 8 },
    [walls],
  );
  assert.throws(() => planClipboardPaste(doc, owner, empty, 124, 0), /entire/);
});

test("layer IDs, hidden/removed empty layers, registry deletion/malformation and cross-session provenance reject without remapping", () => {
  const doc = movementDocument(),
    owner = {},
    h = new CommandHistory(doc);
  const payload = captureClipboard(doc, owner, house, [walls, furniture]);
  h.execute("Layer metadata", [
    { kind: "rename-layer", id: walls, name: "Furniture" },
    { kind: "reorder-layers", ids: [furniture, terrain, walls] },
  ]);
  assert.deepEqual(
    [
      ...new Set(
        planClipboardPaste(doc, owner, payload, 0, 0).writes.map(
          (w) => w.layerId,
        ),
      ),
    ],
    [walls, furniture],
  );
  assert.throws(
    () => validateClipboard(doc, owner, payload, [furniture]),
    /hidden/,
  );
  h.execute("Remove layer", [{ kind: "remove-layer", id: furniture }]);
  assert.throws(() => validateClipboard(doc, owner, payload), /missing/);
  h.execute("Replacement name", [
    {
      kind: "add-layer",
      layer: { id: layerId("replacement"), name: "Furniture" },
    },
  ]);
  assert.throws(() => validateClipboard(doc, owner, payload), /missing/);
  h.undo();
  h.undo();
  validateClipboard(doc, owner, payload);
  for (const value of [null, { name: "Broken", rgba: "invalid" }]) {
    h.execute("Change registry", [{ kind: "registry", id: stone, value }]);
    assert.throws(() => validateClipboard(doc, owner, payload), /color/);
    h.undo();
    validateClipboard(doc, owner, payload);
  }
  assert.throws(() => validateClipboard(doc, {}, payload), /Cross-document/);
  assert.throws(
    () => validateClipboard(movementDocument(), owner, payload),
    /Cross-document/,
  );
  const empty = captureClipboard(
    doc,
    owner,
    { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    [furniture],
  );
  assert.throws(
    () => validateClipboard(doc, owner, empty, [furniture]),
    /hidden/,
  );
  h.execute("Remove", [{ kind: "remove-layer", id: furniture }]);
  assert.throws(() => validateClipboard(doc, owner, empty), /missing/);
});
