import assert from "node:assert/strict";
import test from "node:test";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { MapDocument } from "../../src/domain/document.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import { areaOutline } from "../../src/renderer/areaOutline.ts";
import { rawColor } from "../../src/domain/values.ts";

const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
function setup() {
  const s = new EditorSession(
    new MapDocument({ bounds: { minX: -64, minY: -64, maxX: 128, maxY: 128 } }),
  );
  s.canvasState.set("ready");
  s.history.markSaved(s.history.captureCheckpoint());
  return s;
}
const persistent = (s: EditorSession) => ({
  annotations: s.document.annotations,
  runs: [...s.document.iterateRuns()],
  history: s.history.state,
  version: s.document.version,
});
function create(s: EditorSession) {
  s.areas.newArea();
  s.areas.update({
    name: "House",
    description: "Home\nForge",
    bounds: { minX: "60", minY: "60", maxX: "68", maxY: "68" },
  });
  assert.ok(s.areas.apply());
  return s.areas.selected.getSnapshot()!;
}

test("numeric authoring works in overview/hidden layers; invalid drafts and cancel are inert; Apply is one step", () => {
  const s = setup(),
    a = s.areas;
  s.viewport.set({ x: 0, y: 0, zoom: 0.01 });
  s.setLayerVisible(s.document.layers[0].id, false);
  const before = persistent(s);
  a.newArea();
  a.update({
    name: "",
    tier: "invalid",
    bounds: { minX: "", minY: "0", maxX: "3.5", maxY: "5" },
  });
  assert.equal(a.apply(), false);
  assert.deepEqual(Object.keys(a.errors.getSnapshot()).sort(), [
    "bounds",
    "name",
    "tier",
  ]);
  assert.equal(a.overlayBounds(), null);
  assert.deepEqual(persistent(s), before);
  assert.match(a.drawReason()!, /Zoom in/);
  a.cancelDraft();
  assert.deepEqual(persistent(s), before);
  const id = create(s),
    saved = persistent(s);
  assert.equal(saved.history.undoSteps, 1);
  assert.ok(saved.history.dirty);
  a.select(id);
  assert.deepEqual(persistent(s), saved);
  a.update({ name: "Unsaved" });
  assert.equal(s.routeKey({ key: "z", metaKey: true }, "text"), false);
  assert.equal(
    s.routeKey({ key: "Escape", isComposing: true }, "canvas"),
    false,
  );
  assert.equal(a.draft.getSnapshot()!.name, "Unsaved");
  a.cancelDraft();
  assert.deepEqual(persistent(s), saved);
  a.select(id);
  assert.ok(a.apply());
  assert.deepEqual(persistent(s), saved);
  a.select(id);
  a.update({
    description: "",
    tier: "region",
    bounds: { minX: "-64", minY: "-64", maxX: "-63", maxY: "-63" },
  });
  assert.ok(a.apply());
  assert.equal(s.history.state.undoSteps, 2);
  s.perform("undo");
  assert.deepEqual(s.document.annotations, saved.annotations);
  s.perform("undo");
  assert.equal(a.selected.getSnapshot(), null);
  assert.equal(s.history.state.dirty, false);
  s.perform("redo");
  assert.deepEqual(s.document.annotations, saved.annotations);
  a.select(id);
  a.remove();
  assert.equal(a.draft.getSnapshot(), null);
  assert.equal(a.selected.getSnapshot(), null);
  s.perform("undo");
  assert.deepEqual(s.document.annotations, saved.annotations);
  s.dispose();
});

test("explicit reverse cross-chunk draw, release endpoint, outside clipping, one-cell and canceled gestures remain drafts", () => {
  const s = setup(),
    a = s.areas,
    before = persistent(s);
  a.newArea();
  a.update({ name: "House" });
  a.draw();
  assert.equal(a.begin(1, point(-65, 0)), false);
  assert.ok(a.begin(1, point(67, 67)));
  a.sample(2, point(0, 0));
  a.cancelGesture(2);
  assert.equal(a.pointerId, 1);
  assert.ok(a.commit(1, point(60, 60)));
  assert.equal(a.commit(1, point(0, 0)), false);
  assert.deepEqual(a.overlayBounds(), {
    minX: 60,
    minY: 60,
    maxX: 68,
    maxY: 68,
  });
  assert.deepEqual(persistent(s), before);
  const draft = a.draft.getSnapshot();
  a.draw();
  a.begin(3, point(60, 60));
  a.sample(3, point(80, 80));
  a.cancelGesture();
  assert.deepEqual(a.draft.getSnapshot(), draft);
  a.begin(4, point(127, 127));
  a.commit(4, point(200, 200));
  assert.deepEqual(a.overlayBounds(), {
    minX: 127,
    minY: 127,
    maxX: 128,
    maxY: 128,
  });
  a.draw();
  a.begin(5, point(-1, -1));
  a.commit(5, point(-200, -200));
  assert.deepEqual(a.overlayBounds(), {
    minX: -64,
    minY: -64,
    maxX: 0,
    maxY: 0,
  });
  assert.deepEqual(persistent(s), before);
  assert.ok(a.apply());
  assert.equal(s.history.state.undoSteps, 1);
  s.dispose();
});

test("tool/area switching, undo, stale document, size/camera/readiness and replacement cancel draft or gesture safely", () => {
  for (const cancel of [
    (s: EditorSession) => s.setCanvasSize(900, 700),
    (s: EditorSession) => s.viewport.set({ x: 1, y: 0, zoom: 1 }),
    (s: EditorSession) => s.canvasState.set("loading"),
  ]) {
    const s = setup(),
      a = s.areas;
    a.newArea();
    a.draw();
    const draft = a.draft.getSnapshot(),
      before = persistent(s);
    a.begin(1, point(2, 2));
    a.sample(1, point(8, 8));
    cancel(s);
    assert.equal(a.pointerId, null);
    assert.equal(a.commit(1, point(9, 9)), false);
    assert.deepEqual(a.draft.getSnapshot(), draft);
    assert.deepEqual(persistent(s), before);
    s.dispose();
  }
  for (const cancel of [
    (s: EditorSession) => s.perform("pencil"),
    (s: EditorSession) => s.perform("undo"),
    (s: EditorSession) => s.routeKey({ key: "Escape" }, "panel"),
    (s: EditorSession) =>
      s.execute("Paint", [
        {
          kind: "tiles",
          writes: [
            {
              layerId: s.document.layers[0].id,
              x: 0,
              y: 0,
              length: 1,
              value: rawColor("#ff0000ff"),
            },
          ],
        },
      ]),
  ]) {
    const s = setup();
    create(s);
    s.areas.newArea();
    s.areas.draw();
    s.areas.begin(1, point(1, 1));
    cancel(s);
    assert.equal(s.areas.draft.getSnapshot(), null);
    assert.equal(s.areas.commit(1, point(8, 8)), false);
    s.dispose();
  }
  const s = setup(),
    first = create(s),
    second = create(s);
  s.areas.select(first);
  s.areas.update({ name: "Discard me" });
  s.areas.select(second);
  assert.equal(s.areas.draft.getSnapshot()!.name, "House");
  const before = persistent(s),
    w = new EditorWorkspace(s);
  w.createMap(256, 256);
  assert.equal(s.areas.draft.getSnapshot(), null);
  assert.equal(s.areas.newArea(), false);
  assert.equal(s.areas.apply(), false);
  assert.deepEqual(persistent(s), before);
  assert.equal(
    w.state.getSnapshot().session.areas.selected.getSnapshot(),
    null,
  );
  w.dispose();
});

test("annotation mode cancels tile previews while retaining idle tile rectangles and leaves tile caches independent", () => {
  const s = setup();
  s.perform("select");
  s.selection.begin(1, point(2, 2));
  s.selection.commit(1, point(5, 5));
  const selection = s.selection.state.getSnapshot();
  s.selection.begin(2, point(3, 3));
  s.selection.sample(2, point(6, 3));
  assert.ok(s.selection.preview.getSnapshot());
  s.areas.newArea();
  assert.equal(s.selection.preview.getSnapshot(), null);
  assert.equal(s.selection.state.getSnapshot(), selection);
  assert.equal(s.document.annotations.length, 0);
  let updates = 0;
  s.areas.draft.subscribe(() => updates++);
  s.areas.errors.subscribe(() => updates++);
  s.areas.cancelDraft();
  updates = 0;
  s.execute("Paint", [
    {
      kind: "tiles",
      writes: [
        {
          layerId: s.document.layers[0].id,
          x: 0,
          y: 0,
          length: 1,
          value: rawColor("#ff0000ff"),
        },
      ],
    },
  ]);
  assert.equal(updates, 0);
  s.dispose();
});

test("outline clips real edges without an invented viewport rectangle, and keeps CSS corner marks", () => {
  const view = { x: 0, y: 0, zoom: 1 },
    size = { width: 100, height: 100 };
  assert.deepEqual(
    areaOutline({ minX: -100, minY: -100, maxX: 100, maxY: 100 }, view, size),
    [],
  );
  const lines = areaOutline(
    { minX: -1, minY: 1, maxX: 8, maxY: 2 },
    view,
    size,
  );
  assert.ok(lines.length);
  assert.ok(lines.some((l) => l.x1 === 0 && l.x2 === 100 && l.y1 === 48));
  for (const l of lines) {
    assert.ok(l.x1 >= 0 && l.x2 <= 100 && l.y1 >= 0 && l.y2 <= 100);
    assert.ok(l.x1 === l.x2 || l.y1 === l.y2);
  }
  assert.ok(lines.some((l) => l.corner));
});
