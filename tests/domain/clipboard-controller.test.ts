import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import { rawColor } from "../../src/domain/values.ts";
import {
  movementDocument,
  house,
  walls,
  furniture,
  terrain,
  stone,
} from "../fixtures/selection.ts";
const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
function setup() {
  const s = new EditorSession(movementDocument());
  s.canvasState.set("ready");
  s.selectLayer(walls);
  s.perform("select");
  s.history.markSaved(s.history.captureCheckpoint());
  s.history.markRecovery(s.history.captureCheckpoint());
  s.selection.begin(1, point(60, 60));
  s.selection.commit(1, point(67, 67));
  s.selection.setIncluded(furniture, true);
  return s;
}
const content = (s: EditorSession) => ({
  runs: [...s.document.iterateRuns()],
  bounds: s.document.bounds,
  layers: s.document.layers,
  registry: s.document.registryEntries,
  annotations: s.document.annotations,
});
const persistent = (s: EditorSession) => ({
  ...content(s),
  version: s.document.version,
  history: s.history.state,
});

test("copy and cut publication, immediate cut/cancel/invalid paste, exact Undo and clipboard independent of history", () => {
  const s = setup(),
    before = persistent(s),
    original = content(s);
  assert.equal(s.perform("copy"), true);
  const first = s.selection.clipboard.getSnapshot();
  assert.deepEqual(persistent(s), before);
  assert.equal(s.perform("cut"), true);
  const payload = s.selection.clipboard.getSnapshot();
  assert.notEqual(payload, first);
  assert.equal(s.document.getCell(walls, 60, 60), null);
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, house);
  assert.equal(s.selection.state.getSnapshot()!.layers[0].occupiedCount, 0);
  const cutContent = content(s),
    cut = persistent(s);
  s.pointer.set({ x: 130, y: 132 });
  s.perform("paste");
  assert.equal(s.selection.commitPaste(), false);
  assert.ok(s.selection.pasting);
  assert.deepEqual(persistent(s), cut);
  s.selection.escape();
  assert.deepEqual(persistent(s), cut);
  assert.ok(s.selection.state.getSnapshot());
  assert.equal(s.selection.clipboard.getSnapshot(), payload);
  s.perform("undo");
  assert.deepEqual(content(s), original);
  assert.equal(s.selection.state.getSnapshot(), null);
  assert.equal(s.selection.clipboard.getSnapshot(), payload);
  s.perform("redo");
  assert.deepEqual(content(s), cutContent);
  assert.equal(s.document.getCell(walls, 60, 60), null);
  s.dispose();
  assert.equal(s.selection.clipboard.getSnapshot(), null);
});

test("pointer, selection and original anchors, repeated/pending reset paste and Shift arrows do not accumulate background", () => {
  const s = setup();
  s.perform("copy");
  const clipboard = s.selection.clipboard.getSnapshot();
  s.pointer.set({ x: 70, y: 70 });
  s.perform("paste");
  assert.equal(s.selection.preview.getSnapshot()!.bounds.minX, 70);
  const before = persistent(s);
  assert.equal(s.perform("copy"), false);
  assert.equal(s.perform("cut"), false);
  s.routeKey({ key: "ArrowRight" }, "canvas");
  s.routeKey({ key: "ArrowDown", shiftKey: true }, "canvas");
  assert.deepEqual(s.selection.preview.getSnapshot()!.bounds, {
    minX: 71,
    minY: 80,
    maxX: 79,
    maxY: 88,
  });
  assert.deepEqual(persistent(s), before);
  s.perform("paste");
  assert.equal(s.selection.preview.getSnapshot()!.bounds.minX, 70);
  s.routeKey({ key: "Enter" }, "canvas");
  assert.equal(s.history.state.undoSteps, 1);
  const first = persistent(s);
  s.perform("paste");
  s.selection.commitPaste();
  assert.deepEqual(persistent(s), first);
  s.pointer.set(null);
  s.perform("paste");
  assert.equal(s.selection.preview.getSnapshot()!.bounds.minX, 70);
  s.selection.positionPaste({ x: 80, y: 80 });
  s.selection.commitPaste();
  assert.equal(s.history.state.undoSteps, 2);
  s.selection.deselect();
  s.pointer.set({ x: 999, y: 999 });
  s.perform("paste");
  assert.deepEqual(s.selection.preview.getSnapshot()!.bounds, house);
  s.selection.escape();
  assert.equal(s.selection.state.getSnapshot(), null);
  assert.equal(s.selection.clipboard.getSnapshot(), clipboard);
  s.dispose();
});

test("failed cut preserves previous clipboard and failed paste retains candidate; committed observer failures publish clipboard", () => {
  const s = setup();
  s.perform("copy");
  const clipboard = s.selection.clipboard.getSnapshot(),
    before = persistent(s);
  const execute = s.history.execute.bind(s.history);
  s.history.execute = () => {
    throw new Error("Transaction exceeds history byte limit");
  };
  assert.equal(s.perform("cut"), false);
  assert.equal(s.selection.clipboard.getSnapshot(), clipboard);
  assert.deepEqual(persistent(s), before);
  s.pointer.set({ x: 80, y: 80 });
  s.perform("paste");
  const preview = s.selection.preview.getSnapshot();
  assert.equal(s.selection.commitPaste(), false);
  assert.equal(s.selection.preview.getSnapshot(), preview);
  assert.deepEqual(persistent(s), before);
  s.history.execute = execute;
  s.selection.cancel();
  s.document.subscribe(() => {
    throw new Error("view failed");
  });
  assert.equal(s.perform("cut"), true);
  assert.notEqual(s.selection.clipboard.getSnapshot(), clipboard);
  assert.match(s.feedback.getSnapshot().message, /completed, but a view/);
  assert.equal(s.history.state.undoSteps, 1);
  s.perform("paste");
  assert.equal(s.selection.commitPaste(), true);
  assert.match(s.feedback.getSnapshot().message, /committed, but a view/);
  assert.equal(s.history.state.undoSteps, 2);
  s.dispose();
});

test("paste context/version/visibility changes cancel, all layers validate and original IDs restore through Undo", () => {
  for (const change of [
    (s: EditorSession) => s.selectLayer(terrain),
    (s: EditorSession) => s.setCanvasSize(900, 600),
    (s: EditorSession) => s.pan(24, 0),
    (s: EditorSession) => s.canvasState.set("loading"),
    (s: EditorSession) => s.perform("pan"),
    (s: EditorSession) => s.selection.setIncluded(furniture, false),
    (s: EditorSession) => s.renameLayer(walls, "Renamed"),
    (s: EditorSession) => s.perform("undo"),
  ]) {
    const s = setup();
    s.perform("copy");
    const payload = s.selection.clipboard.getSnapshot();
    s.perform("paste");
    change(s);
    assert.equal(s.selection.pasting, false);
    const after = persistent(s);
    assert.equal(s.selection.commitPaste(), false);
    assert.deepEqual(persistent(s), after);
    assert.equal(s.selection.clipboard.getSnapshot(), payload);
    s.dispose();
  }
  const s = setup();
  s.perform("copy");
  s.selectLayer(terrain);
  s.renameLayer(walls, "Other");
  s.moveLayer(walls, "up");
  s.setLayerVisible(terrain, false);
  s.pointer.set({ x: 80, y: 80 });
  assert.equal(s.perform("paste"), true);
  s.selection.commitPaste();
  assert.deepEqual(
    s.selection.state.getSnapshot()!.layers.map((l) => l.layerId),
    [walls, furniture],
  );
  s.setLayerVisible(furniture, false);
  assert.equal(s.perform("paste"), false);
  assert.match(s.action("paste").reason!, /hidden/);
  s.setLayerVisible(furniture, true);
  s.removeLayer(furniture, true);
  assert.equal(s.perform("paste"), false);
  s.perform("undo");
  assert.equal(s.perform("paste"), true);
  s.selection.cancel();
  s.commitRegistry(s.registryCommands.prepare({ kind: "remove", id: stone }));
  assert.equal(s.perform("paste"), false);
  s.perform("undo");
  assert.equal(s.perform("paste"), true);
  s.selection.cancel();
  s.dispose();
});

test("empty cut/paste preserves redo/checkpoints; shortcuts ignore text/panel/IME/modifiers; sessions reject foreign clipboard", () => {
  const s = setup();
  s.perform("copy");
  const payload = s.selection.clipboard.getSnapshot();
  for (const owner of ["text", "panel", "outside"] as const)
    for (const key of ["c", "x", "v"])
      assert.equal(s.routeKey({ key, metaKey: true }, owner), false);
  for (const extra of [
    { isComposing: true },
    { altKey: true },
    { defaultPrevented: true },
    { shiftKey: true },
  ])
    assert.equal(
      s.routeKey({ key: "v", metaKey: true, ...extra }, "canvas"),
      false,
    );
  s.execute("Seed redo", [
    {
      kind: "tiles",
      writes: [
        { layerId: walls, x: 0, y: 0, length: 1, value: rawColor("#ffffffff") },
      ],
    },
  ]);
  s.perform("undo");
  s.selection.begin(2, point(0, 0));
  s.selection.commit(2, point(7, 7));
  const before = persistent(s);
  s.perform("cut");
  s.pointer.set({ x: 80, y: 80 });
  s.perform("paste");
  s.selection.commitPaste();
  assert.deepEqual(persistent(s), before);
  const other = new EditorSession(s.document);
  other.canvasState.set("ready");
  other.selection.clipboard.set(payload);
  assert.equal(other.perform("paste"), false);
  assert.match(other.action("paste").reason!, /Cross-document/);
  other.dispose();
  const workspace = new EditorWorkspace(s);
  workspace.createMap(128, 128);
  assert.equal(s.selection.clipboard.getSnapshot(), null);
  assert.equal(
    workspace.state.getSnapshot().session.selection.clipboard.getSnapshot(),
    null,
  );
  workspace.dispose();
});
