import assert from "node:assert/strict";
import test from "node:test";
import { EditorSession } from "../../src/editor/session.ts";
import { areaDocument } from "../fixtures/areas.ts";
import { annotationId } from "../../src/domain/values.ts";
import {
  focusOnBounds,
  screenToWorld,
  tileToScreen,
  worldToScreen,
} from "../../src/editor/viewport.ts";

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≈ ${expected}`);
const persistent = (s: EditorSession) => ({
  bounds: s.document.bounds,
  annotations: s.document.annotations,
  runs: [...s.document.iterateRuns()],
  history: s.history.state,
  version: s.document.version,
});

test("area focus centers signed, distant, edge and whole-map bounds, fits both axes and caps small features", () => {
  for (const size of [
    { width: 960, height: 640 },
    { width: 200, height: 900 },
    { width: 32, height: 24 },
    { width: 1, height: 1 },
  ])
    for (const bounds of [
      { minX: -64, minY: -64, maxX: -63, maxY: -63 },
      { minX: 6392, minY: 6392, maxX: 6400, maxY: 6400 },
      { minX: 6000, minY: 6000, maxX: 6200, maxY: 6010 },
      { minX: 0, minY: -64, maxX: 1, maxY: 6400 },
      { minX: -64, minY: -64, maxX: 6400, maxY: 6400 },
    ]) {
      const view = focusOnBounds(bounds, size);
      assert.ok(view.zoom > 0 && view.zoom <= 1);
      const center = screenToWorld(size.width / 2, size.height / 2, view);
      near(center.x, bounds.minX + (bounds.maxX - bounds.minX) / 2);
      near(center.y, bounds.minY + (bounds.maxY - bounds.minY) / 2);
      const min = worldToScreen(bounds.minX, bounds.minY, view);
      const max = worldToScreen(bounds.maxX, bounds.maxY, view);
      assert.ok(min.x >= -1e-8 && min.y >= -1e-8);
      assert.ok(max.x <= size.width + 1e-8 && max.y <= size.height + 1e-8);
      if (bounds.minX === 6392 && size.width === 960)
        assert.equal(view.zoom, 1);
    }
});

test("select and focus preserve all data, saved/recovery state and idle tile selection, including drafts", () => {
  const s = new EditorSession(areaDocument());
  s.canvasState.set("ready");
  s.setCanvasSize(960, 640);
  s.history.markSaved(s.history.captureCheckpoint());
  s.history.markRecovery(s.history.captureCheckpoint());
  s.perform("select");
  const view = s.viewport.getSnapshot();
  s.selection.begin(1, tileToScreen(60, 60, view));
  s.selection.commit(1, tileToScreen(67, 67, view));
  const selection = s.selection.state.getSnapshot();
  assert.ok(selection);
  const before = persistent(s);
  let changes = 0;
  s.document.subscribe(() => changes++);
  for (const id of ["area-region", "area-house", "area-village"]) {
    assert.ok(s.areas.select(annotationId(id)));
    const draft = s.areas.draft.getSnapshot();
    s.pointer.set({ x: 1, y: 1 });
    assert.ok(s.areas.focus());
    assert.equal(s.pointer.getSnapshot(), null);
    assert.equal(s.areas.draft.getSnapshot(), draft);
    assert.equal(s.selection.state.getSnapshot(), selection);
    assert.deepEqual(persistent(s), before);
  }
  s.areas.update({
    name: "Unapplied village",
    bounds: { minX: "6000", minY: "6000", maxX: "6012", maxY: "6008" },
  });
  s.setZoom(1);
  s.areas.draw();
  s.areas.begin(2, tileToScreen(60, 60, s.viewport.getSnapshot()));
  assert.equal(s.areas.pointerId, 2);
  const draft = s.areas.draft.getSnapshot();
  assert.ok(s.areas.focus());
  assert.equal(s.areas.pointerId, null);
  assert.equal(s.areas.drawingBounds.getSnapshot(), false);
  assert.equal(s.areas.draft.getSnapshot(), draft);
  const center = screenToWorld(480, 320, s.viewport.getSnapshot());
  near(center.x, 6006);
  near(center.y, 6004);
  assert.equal(s.areas.commit(2, { x: 10, y: 10 }), false);
  assert.deepEqual(persistent(s), before);
  assert.equal(changes, 0);
  s.dispose();
});

test("focus rejects invalid geometry, unavailable canvas, removed IDs and disposed sessions without a view or data change", () => {
  const s = new EditorSession(areaDocument());
  s.setCanvasSize(960, 640);
  const id = annotationId("area-house");
  s.areas.select(id);
  const view = s.viewport.getSnapshot();
  const before = persistent(s);
  assert.equal(s.areas.focus(), false);
  s.canvasState.set("ready");
  s.areas.update({ bounds: { minX: "0", minY: "0", maxX: "0", maxY: "1" } });
  assert.match(s.areas.focusReason()!, /valid bounds/);
  assert.equal(s.areas.focus(), false);
  assert.deepEqual(persistent(s), before);
  assert.equal(s.viewport.getSnapshot(), view);
  s.areas.cancelDraft();
  s.areas.remove();
  assert.equal(s.areas.selected.getSnapshot(), null);
  assert.equal(s.areas.focus(), false);
  assert.equal(s.areas.select(id), false);
  s.perform("undo");
  assert.equal(s.areas.selected.getSnapshot(), null);
  assert.ok(s.areas.select(id));
  assert.ok(s.areas.focus());
  s.dispose();
  assert.equal(s.areas.focus(), false);
});
