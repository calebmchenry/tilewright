import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorSession } from "../../src/editor/session.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import {
  captureSelection,
  planSelectionMove,
} from "../../src/domain/selection.ts";
import { rasterizeChunk, visibleChunks } from "../../src/renderer/chunks.ts";
import { rawColor } from "../../src/domain/values.ts";
import {
  movementDocument,
  house,
  walls,
  furniture,
  terrain,
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
  s.selection.begin(1, point(67, 67));
  s.selection.commit(1, point(60, 60));
  s.selection.setIncluded(furniture, true);
  return s;
}
const content = (s: EditorSession) => ({
  runs: [...s.document.iterateRuns()],
  annotations: s.document.annotations,
  registry: s.document.registryEntries,
  layers: s.document.layers,
  bounds: s.document.bounds,
});
const persistent = (s: EditorSession) => ({
  ...content(s),
  version: s.document.version,
  history: s.history.state,
});

test("drag previews share a start snapshot, preserve grab offset, return to origin without edits, then release exactly once", () => {
  const s = setup(),
    before = persistent(s),
    original = content(s);
  s.selection.begin(3, point(62, 62));
  s.selection.sample(3, point(65, 62));
  const direct = s.selection.preview.getSnapshot();
  for (const [x, y] of [
    [63, 62],
    [62, 65],
    [59, 62],
    [65, 62],
  ])
    s.selection.sample(3, point(x, y));
  assert.deepEqual(s.selection.preview.getSnapshot(), direct);
  assert.deepEqual(persistent(s), before);
  s.selection.commit(3, point(62, 62));
  assert.deepEqual(persistent(s), before);
  s.selection.begin(4, point(62, 62));
  // Release-only endpoint must be sampled.
  assert.equal(s.selection.commit(4, point(65, 62)), true);
  assert.equal(s.selection.commit(4, point(65, 62)), false);
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, {
    ...house,
    minX: 63,
    maxX: 71,
  });
  assert.equal(s.history.state.undoSteps, 1);
  const after = content(s);
  s.perform("undo");
  assert.equal(s.selection.state.getSnapshot(), null);
  assert.deepEqual(content(s), original);
  s.perform("redo");
  assert.deepEqual(content(s), after);
  s.dispose();
});

test("all move context cancellations preserve original tiles and selection; inclusion, version, removal and disposal cannot commit stale work", () => {
  for (const cancel of [
    (s: EditorSession) => s.selection.escape(),
    (s: EditorSession) => s.selection.cancel(),
    (s: EditorSession) => s.selectLayer(terrain),
    (s: EditorSession) => s.viewport.set({ x: 1, y: 0, zoom: 1 }),
    (s: EditorSession) => s.setCanvasSize(999, 700),
    (s: EditorSession) => s.canvasState.set("loading"),
    (s: EditorSession) => s.perform("pan"),
  ]) {
    const s = setup(),
      before = persistent(s),
      selection = s.selection.state.getSnapshot();
    s.selection.begin(2, point(62, 62));
    s.selection.sample(2, point(65, 62));
    s.selection.cancel(99);
    assert.equal(s.selection.pointerId, 2);
    cancel(s);
    assert.equal(s.selection.preview.getSnapshot(), null);
    assert.equal(s.selection.commit(2, point(65, 62)), false);
    assert.deepEqual(persistent(s), before);
    assert.deepEqual(s.selection.state.getSnapshot(), selection);
    s.dispose();
  }
  for (const cause of [
    "version",
    "inclusion",
    "hidden",
    "removed",
    "undo",
    "dispose",
  ]) {
    const s = setup();
    s.selection.begin(2, point(62, 62));
    s.selection.sample(2, point(65, 62));
    if (cause === "version") s.renameLayer(walls, "Renamed");
    if (cause === "inclusion") s.selection.setIncluded(furniture, false);
    if (cause === "hidden") s.setLayerVisible(furniture, false);
    if (cause === "removed") s.removeLayer(furniture, true);
    if (cause === "undo") s.perform("undo");
    if (cause === "dispose") s.dispose();
    const after = persistent(s);
    assert.equal(s.selection.commit(2, point(65, 62)), false);
    assert.equal(s.selection.preview.getSnapshot(), null);
    assert.deepEqual(persistent(s), after);
    s.dispose();
  }
});

test("invalid drag is visible but release rejects whole rectangle; empty moves reposition with no history and holes can be grabbed", () => {
  const s = setup(),
    before = persistent(s),
    selected = s.selection.state.getSnapshot();
  s.selection.begin(2, point(62, 62));
  s.selection.sample(2, point(126, 62));
  assert.equal(s.selection.preview.getSnapshot()!.bounds.maxX, 132);
  assert.match(
    s.selection.preview.getSnapshot()!.move!.reason!,
    /entire selection/,
  );
  assert.equal(s.selection.preview.getSnapshot()!.move!.writes.length, 0);
  assert.deepEqual(persistent(s), before);
  assert.equal(s.selection.commit(2, point(126, 62)), false);
  assert.deepEqual(persistent(s), before);
  assert.equal(s.selection.state.getSnapshot(), selected);
  s.selection.deselect();
  s.selection.begin(3, point(0, 0));
  s.selection.commit(3, point(7, 7));
  assert.equal(s.selection.begin(4, point(2, 2)), true);
  assert.equal(s.selection.commit(4, point(5, 2)), true);
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, {
    minX: 3,
    minY: 0,
    maxX: 11,
    maxY: 8,
  });
  assert.deepEqual(persistent(s), before);
  s.dispose();
});

test("arrows nudge fresh selections with separate undo entries, Shift ten, native modifiers/focus, pinned scope and overview gates", () => {
  const s = setup(),
    original = content(s),
    view = s.viewport.getSnapshot();
  s.selectLayer(terrain);
  s.setLayerVisible(terrain, false);
  for (let i = 0; i < 3; i++) {
    const selected = s.selection.state.getSnapshot()!;
    const plan = planSelectionMove(
      s.document,
      captureSelection(s.document, selected.bounds, [walls, furniture]),
      1,
      0,
    );
    assert.ok(plan.writes.length);
    assert.equal(s.routeKey({ key: "ArrowRight" }, "canvas"), true);
    assert.equal(s.history.state.undoSteps, i + 1);
  }
  assert.deepEqual(s.viewport.getSnapshot(), view);
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, {
    ...house,
    minX: 63,
    maxX: 71,
  });
  assert.deepEqual(
    s.selection.state.getSnapshot()!.layers.map((l) => l.layerId),
    [walls, furniture],
  );
  s.routeKey({ key: "ArrowDown", shiftKey: true }, "canvas");
  assert.equal(s.selection.state.getSnapshot()!.bounds.minY, 70);
  const before = persistent(s);
  for (const owner of ["text", "panel", "outside"] as const)
    assert.equal(s.routeKey({ key: "ArrowRight" }, owner), false);
  for (const input of [
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
    { isComposing: true },
  ])
    assert.equal(s.routeKey({ key: "ArrowRight", ...input }, "canvas"), false);
  s.viewport.set({ x: 0, y: 0, zoom: 0.1 });
  s.routeKey({ key: "ArrowRight" }, "canvas");
  assert.deepEqual(persistent(s), before);
  s.canvasState.set("loading");
  assert.equal(s.selection.nudge(1, 0), false);
  assert.deepEqual(persistent(s), before);
  for (let i = 0; i < 4; i++) s.perform("undo");
  assert.deepEqual(content(s), original);
  s.dispose();
});

test("a history observer failure reports committed movement without repeating or losing selection", () => {
  const s = setup();
  s.document.subscribe(() => {
    throw new Error("view failure");
  });
  assert.equal(s.selection.nudge(3, 0), true);
  assert.equal(s.history.state.undoSteps, 1);
  assert.match(s.feedback.getSnapshot().message, /committed, but a view/);
  assert.equal(s.selection.state.getSnapshot()!.bounds.minX, 63);
  s.dispose();
});

test("transient chunk pixels equal actual post-move rasterization on all layers, including alpha and cleared source", () => {
  const doc = movementDocument();
  doc.setCell(furniture, 63, 62, rawColor("#12345680"));
  const plan = planSelectionMove(
    doc,
    captureSelection(doc, house, [walls, furniture]),
    3,
    0,
  );
  const regions = visibleChunks(
    doc.bounds,
    { x: 55, y: 55, zoom: 1 },
    600,
    600,
  );
  const previews = doc.layers.flatMap(({ id }) =>
    regions.map((region) => ({
      id,
      region,
      raster: rasterizeChunk(doc, id, region, plan.writes),
    })),
  );
  doc.writeBatch(plan.writes);
  for (const { id, region, raster } of previews) {
    const actual = rasterizeChunk(doc, id, region);
    assert.deepEqual(raster.pixels, actual.pixels);
    assert.equal(raster.cells, actual.cells);
  }
});
