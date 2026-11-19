import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { captureProjectSnapshot } from "../../src/domain/project.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import { exampleDocument, exampleProject } from "../fixtures/project.ts";

test("snapshot accounts for every field of the mixed golden example and is deeply immutable", () => {
  const history = new CommandHistory(exampleDocument());
  const before = history.state;
  const snapshot = captureProjectSnapshot(history, exampleProject.editor);
  assert.deepEqual(snapshot.project, exampleProject);
  assert.deepEqual(history.state, before);
  const frozen = (value: unknown): void => {
    if (value && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      for (const child of Object.values(value)) frozen(child);
    }
  };
  frozen(snapshot);
});

test("snapshot detaches all document categories, preferences and checkpoint from later edits", () => {
  const history = new CommandHistory(exampleDocument());
  const hidden = ["buildings"];
  const prefs = { activeLayerId: "buildings", hiddenLayerIds: hidden };
  const snapshot = captureProjectSnapshot(history, prefs);
  hidden.push("terrain");
  prefs.activeLayerId = "terrain";
  history.execute("Later revision", [
    {
      kind: "bounds",
      bounds: { minX: -128, minY: -128, maxX: 6400, maxY: 6400 },
    },
    { kind: "rename-layer", id: layerId("terrain"), name: "New name" },
    {
      kind: "registry",
      id: registryId("registry-grass"),
      value: { name: "New grass", rgba: "#123456ff" },
    },
    { kind: "annotation", id: annotationId("area-house"), value: null },
    {
      kind: "tiles",
      writes: [
        { layerId: layerId("terrain"), x: -1, y: -1, length: 1, value: null },
      ],
    },
    { kind: "remove-layer", id: layerId("buildings") },
    { kind: "reorder-layers", ids: [layerId("notes"), layerId("terrain")] },
  ]);
  assert.deepEqual(snapshot.project, exampleProject);
  history.markSaved(snapshot.checkpoint);
  assert.equal(history.state.dirty, true);
  assert.equal(history.state.savedRevision, 0);
  history.undo();
  assert.equal(history.state.dirty, false);
  assert.deepEqual(
    captureProjectSnapshot(history, exampleProject.editor).project,
    snapshot.project,
  );
});

test("session capture leaves drawing previews and unapplied area drafts outside the project", () => {
  const session = new EditorSession(exampleDocument());
  session.canvasState.set("ready");
  session.selectLayer(layerId("buildings"));
  session.perform("pencil");
  const point = tileToScreen(70, 70, session.viewport.getSnapshot());
  session.drawing.begin(1, point);
  assert.ok(session.drawing.preview.getSnapshot());
  const before = session.captureProjectSnapshot();
  assert.deepEqual(before.project.document, exampleProject.document);
  assert.ok(session.drawing.preview.getSnapshot());
  session.drawing.cancel();
  session.areas.select(annotationId("area-house"));
  session.areas.update({ name: "Unapplied draft", description: "Not saved" });
  session.rectangle.set({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
  session.viewport.set({ x: 20, y: 40, zoom: 0.2 });
  session.setLayerVisible(layerId("buildings"), false);
  session.setLayerVisible(layerId("notes"), false);
  session.setLayerVisible(layerId("terrain"), false);
  const snapshot = session.captureProjectSnapshot();
  assert.deepEqual(snapshot.project.document, exampleProject.document);
  assert.deepEqual(snapshot.project.editor, {
    activeLayerId: "buildings",
    hiddenLayerIds: ["buildings", "notes", "terrain"],
  });
  assert.equal(session.areas.draft.getSnapshot()!.name, "Unapplied draft");
  assert.equal(session.history.state.revision, before.checkpoint.revision);
  session.dispose();
  assert.throws(() => session.captureProjectSnapshot(), /closed/);
});

test("capture rejects reentrant transactions and edits that bypass history", () => {
  const document = new MapDocument(),
    history = new CommandHistory(document);
  const preferences = {
    activeLayerId: document.layers[0].id,
    hiddenLayerIds: [],
  };
  const capture = () => captureProjectSnapshot(history, preferences);
  const command = {
    kind: "tiles" as const,
    writes: [
      {
        layerId: document.layers[0].id,
        x: 0,
        y: 0,
        length: 1,
        value: rawColor("#000000ff"),
      },
    ],
  };
  assert.throws(
    () =>
      document.applyCommands([command], () => {
        assert.throws(capture, /busy/);
        throw new Error("Rollback");
      }),
    /Rollback/,
  );
  assert.equal(capture().checkpoint.revision, 0);
  const unsubscribe = document.subscribe(() => assert.throws(capture, /busy/));
  history.execute("Commit", [command]);
  unsubscribe();
  document.setCell(document.layers[0].id, 1, 0, rawColor("#ffffffff"));
  assert.throws(capture, /outside command history/);
});
