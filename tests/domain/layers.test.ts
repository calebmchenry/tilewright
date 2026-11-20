import assert from "node:assert/strict";
import test from "node:test";
import { EditorSession } from "../../src/editor/session.ts";
import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { bindDocument } from "../../src/renderer/bindDocument.ts";
import type { CanvasInvalidation } from "../../src/editor/invalidation.ts";
import { gridDocument } from "../fixtures/grid.ts";

const terrain = layerId("terrain"),
  buildings = layerId("buildings");
function populated() {
  const document = gridDocument();
  document.applyCommands([
    {
      kind: "registry",
      id: registryId("wall"),
      value: { name: "Wall", rgba: "#b18b4dff" },
    },
    {
      kind: "tiles",
      writes: [
        {
          layerId: buildings,
          x: 63,
          y: 63,
          length: 2,
          value: registeredColor(registryId("wall")),
        },
      ],
    },
  ]);
  return new EditorSession(document);
}
const snapshot = (editor: EditorSession) => ({
  layers: editor.document.layers,
  runs: [...editor.document.iterateRuns()],
  registry: editor.document.registryEntries,
});

test("default/last-layer policy, creation above active, identity stability and branch safety", () => {
  assert.throws(() => new MapDocument({ layers: [] }), /at least one layer/);
  const editor = new EditorSession();
  const initial = editor.activeLayer.getSnapshot();
  assert.equal(editor.removeLayer(initial, true), false);
  assert.match(editor.feedback.getSnapshot().message, /at least one/);
  assert.equal(editor.history.state.undoSteps, 0);
  assert.equal(editor.perform("add-layer"), true);
  const added = editor.activeLayer.getSnapshot();
  assert.notEqual(added, initial);
  assert.deepEqual(
    editor.document.layers.map((layer) => layer.name),
    ["Layer 1", "Layer 2"],
  );
  editor.selectLayer(initial);
  editor.addLayer();
  const middle = editor.activeLayer.getSnapshot();
  assert.deepEqual(
    editor.document.layers.map((layer) => layer.id),
    [initial, middle, added],
  );
  editor.perform("undo");
  assert.equal(editor.activeLayer.getSnapshot(), added);
  editor.perform("redo");
  assert.deepEqual(
    editor.document.layers.map((layer) => layer.id),
    [initial, middle, added],
  );
  assert.equal(editor.activeLayer.getSnapshot(), added); // History does not steal valid focus.
  editor.perform("undo");
  editor.addLayer();
  assert.notEqual(editor.activeLayer.getSnapshot(), middle);
  assert.equal(editor.history.state.redoSteps, 0);
  assert.equal(editor.document.storageStats().occupiedCells, 0);
  editor.dispose();
  assert.equal(editor.addLayer(), false);
});

test("populated lifecycle preserves every run, registry association, order and independent edits through undo/redo", () => {
  const editor = populated();
  const original = snapshot(editor);
  const terrainRuns = [...editor.document.iterateRuns(terrain)];
  editor.selectLayer(buildings);
  const changes: CanvasInvalidation[] = [];
  const stop = bindDocument(editor, (change) => changes.push(change));
  editor.renameLayer(buildings, "  Structures  ");
  assert.equal(changes.length, 0);
  assert.equal(editor.document.layers[1].name, "Structures");
  editor.moveLayer(buildings, "down");
  assert.equal(editor.activeLayer.getSnapshot(), buildings);
  assert.deepEqual(
    editor.document.layers.map((layer) => layer.id),
    [buildings, terrain],
  );
  assert.equal(changes.at(-1)?.composition, true);
  assert.deepEqual(
    [...editor.document.iterateRuns(buildings)],
    original.runs.filter((run) => run.layerId === buildings),
  );
  assert.deepEqual(editor.document.registryEntries, original.registry);
  // The active layer is the edit target, independently of what is drawn on top.
  editor.execute("Edit active", [
    {
      kind: "tiles",
      writes: [
        {
          layerId: editor.editableLayerIds()[0],
          x: 63,
          y: 63,
          length: 1,
          value: rawColor("#123456ff"),
        },
      ],
    },
  ]);
  assert.deepEqual([...editor.document.iterateRuns(terrain)], terrainRuns);
  const beforeRemoval = snapshot(editor);
  assert.equal(editor.removeLayer(buildings), false);
  assert.deepEqual(snapshot(editor), beforeRemoval);
  assert.match(editor.feedback.getSnapshot().message, /Confirm removal/);
  assert.equal(editor.removeLayer(buildings, true), true);
  assert.equal(editor.activeLayer.getSnapshot(), terrain);
  assert.deepEqual([...editor.document.iterateRuns(terrain)], terrainRuns);
  assert.equal(changes.at(-1)?.composition, true);
  assert.ok(
    changes.at(-1)?.regions.some((region) => region.layerId === buildings),
  );
  editor.perform("undo");
  assert.deepEqual(snapshot(editor), beforeRemoval);
  assert.equal(editor.activeLayer.getSnapshot(), terrain);
  editor.perform("redo");
  assert.deepEqual(
    editor.document.layers.map((layer) => layer.id),
    [terrain],
  );
  editor.perform("undo");
  editor.perform("undo"); // Active-layer edit.
  editor.perform("undo"); // Reorder.
  editor.perform("undo"); // Rename.
  assert.deepEqual(snapshot(editor), original);
  for (let i = 0; i < 4; i++) editor.perform("redo");
  assert.deepEqual(
    editor.document.layers.map((layer) => layer.id),
    [terrain],
  );
  assert.deepEqual([...editor.document.iterateRuns(terrain)], terrainRuns);
  stop();
  editor.dispose();
});

test("visibility and selection are transient, hidden editing targets are excluded, restored layers are shown", () => {
  const editor = populated();
  const original = snapshot(editor);
  const version = editor.document.version;
  editor.selectLayer(buildings);
  editor.setLayerVisible(buildings, false);
  assert.deepEqual(editor.editableLayerIds(), []);
  assert.deepEqual(
    editor.editableLayerIds([buildings, terrain, terrain, layerId("missing")]),
    [terrain],
  );
  editor.setLayerVisible(terrain, false);
  assert.deepEqual(editor.editableLayerIds([terrain, buildings]), []);
  assert.equal(editor.activeLayer.getSnapshot(), buildings);
  assert.deepEqual(snapshot(editor), original);
  assert.equal(editor.document.version, version);
  assert.equal(editor.history.state.undoSteps, 0);
  editor.removeLayer(buildings, true);
  assert.equal(editor.activeLayer.getSnapshot(), terrain); // Valid even if all remaining layers hidden.
  assert.deepEqual(editor.hiddenLayers.getSnapshot(), [terrain]);
  editor.perform("undo");
  assert.deepEqual(snapshot(editor), original);
  assert.deepEqual(editor.hiddenLayers.getSnapshot(), [terrain]);
  assert.deepEqual(editor.editableLayerIds([buildings, terrain]), [buildings]);
  editor.dispose();
  assert.deepEqual(editor.editableLayerIds([buildings]), []);
});

test("edge/no-op reorders, invalid names and stale IDs preserve content and redo", () => {
  const editor = populated();
  const original = snapshot(editor);
  editor.renameLayer(buildings, "Structures");
  editor.perform("undo");
  const history = editor.history.state;
  editor.moveLayer(terrain, "down");
  editor.moveLayer(buildings, "up");
  editor.renameLayer(buildings, " Buildings ");
  assert.equal(editor.renameLayer(buildings, "  "), false);
  assert.equal(editor.moveLayer(layerId("missing"), "up"), false);
  assert.equal(editor.removeLayer(layerId("missing")), false);
  editor.selectLayer(layerId("missing"));
  assert.equal(editor.activeLayer.getSnapshot(), terrain);
  assert.deepEqual(snapshot(editor), original);
  assert.deepEqual(editor.history.state, history);
  editor.dispose();
});

test("empty and non-active removal remain undoable without switching a valid target", () => {
  const editor = populated();
  editor.addLayer();
  const empty = editor.activeLayer.getSnapshot();
  assert.equal(editor.layerHasContent(empty), false);
  editor.selectLayer(buildings);
  assert.equal(editor.removeLayer(empty), true);
  assert.equal(editor.activeLayer.getSnapshot(), buildings);
  editor.perform("undo");
  assert.ok(editor.document.layers.some((layer) => layer.id === empty));
  assert.equal(editor.activeLayer.getSnapshot(), buildings);
  editor.dispose();
});

test("direct reordering moves across the stack in one undo step and rejects invalid positions atomically", () => {
  const editor = populated();
  editor.addLayer();
  editor.addLayer();
  editor.selectLayer(terrain);
  const before = snapshot(editor);
  const history = editor.history.state;
  assert.equal(editor.moveLayerTo(buildings, 0), true);
  assert.equal(editor.document.layers[0].id, buildings);
  assert.equal(editor.activeLayer.getSnapshot(), terrain);
  assert.equal(editor.history.state.undoSteps, history.undoSteps + 1);
  assert.deepEqual(
    [...editor.document.iterateRuns(buildings)],
    before.runs.filter((run) => run.layerId === buildings),
  );
  editor.perform("undo");
  assert.deepEqual(snapshot(editor), before);
  const undone = editor.history.state;
  for (const index of [-1, 4, 1.5, NaN])
    assert.equal(editor.moveLayerTo(buildings, index), false);
  assert.equal(editor.moveLayerTo(layerId("missing"), 0), false);
  assert.equal(
    editor.moveLayerTo(
      buildings,
      before.layers.findIndex((layer) => layer.id === buildings),
    ),
    true,
  );
  assert.deepEqual(editor.history.state, undone);
  editor.perform("redo");
  assert.equal(editor.document.layers[0].id, buildings);
  assert.deepEqual(editor.document.registryEntries, before.registry);
  editor.dispose();
});
