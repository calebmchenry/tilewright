import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registryId,
  annotationId,
  registeredColor,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { SparsePaint, type DrawingTool } from "../../src/editor/drawing.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import { canvasInvalidation } from "../../src/editor/invalidation.ts";

const ground = layerId("ground"),
  target = layerId("target");
const paint = rawColor("#123456ff"),
  old = rawColor("#abcdefFF");
// A test-only endpoint span exercises append/replace without implementing TW-019.
const tool = (replace = false): DrawingTool => ({
  label: "Test stroke",
  create: ({ paint }) => ({
    sample: ({ start, previous, tile }) => ({
      mode: replace ? "replace" : "append",
      spans: [
        {
          x: Math.min((replace ? start : previous).x, tile.x),
          y: tile.y,
          length: Math.abs((replace ? start : previous).x - tile.x) + 1,
          value: paint,
        },
      ],
    }),
  }),
});
function setup(replace = false) {
  const document = new MapDocument({
    bounds: { minX: -65, minY: -2, maxX: 131, maxY: 4 },
    layers: [
      { id: ground, name: "Ground" },
      { id: target, name: "Target" },
    ],
  });
  document.writeBatch(
    [ground, target].map((layerId) => ({
      layerId,
      x: 60,
      y: 1,
      length: 8,
      value: old,
    })),
  );
  const session = new EditorSession(document);
  session.canvasState.set("ready");
  session.selectLayer(target);
  session.setColor("#123456");
  session.drawing.register("pencil", tool(replace));
  session.perform("pencil");
  session.history.markSaved(session.history.captureCheckpoint());
  session.history.markRecovery(session.history.captureCheckpoint());
  return session;
}
const point = (x: number, y = 1) => tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
const state = (s: EditorSession) => ({
  runs: [...s.document.iterateRuns()],
  bounds: s.document.bounds,
  version: s.document.version,
  history: s.history.state,
  storage: s.document.storageStats(),
});

test("preview is isolated; rapid cross-chunk samples commit one compact command and exact undo", () => {
  const s = setup(),
    before = state(s),
    events: ReturnType<typeof canvasInvalidation>[] = [];
  s.document.subscribe((change) => events.push(canvasInvalidation(change)));
  assert.equal(s.drawing.begin(7, point(60)), true);
  assert.equal(s.drawing.sample(8, point(99)), false);
  s.drawing.sample(7, point(68));
  s.drawing.sample(7, point(61));
  assert.deepEqual(state(s), before);
  assert.equal(events.length, 0);
  assert.deepEqual(s.drawing.preview.getSnapshot()?.writes, [
    { layerId: target, x: 60, y: 1, length: 9, value: paint },
  ]);
  assert.equal(s.drawing.commit(7, point(70)), true);
  assert.equal(s.history.state.undoSteps, 1);
  assert.equal(s.drawing.preview.getSnapshot(), null);
  assert.deepEqual(events, [
    {
      regions: [
        { layerId: target, minX: 60, minY: 1, maxX: 68, maxY: 2 },
        { layerId: target, minX: 68, minY: 1, maxX: 71, maxY: 2 },
      ],
      composition: false,
      bounds: false,
      registryIds: [],
      annotationIds: [],
    },
  ]);
  assert.deepEqual(s.document.getCell(ground, 64, 1), old);
  const after = [...s.document.iterateRuns()];
  s.history.undo();
  assert.deepEqual([...s.document.iterateRuns()], before.runs);
  assert.equal(s.history.state.dirty, false);
  s.history.redo();
  assert.deepEqual([...s.document.iterateRuns()], after);
  s.dispose();
});

test("clipping, negative/partial bounds, outside-only and zero-length no-op gestures preserve checkpoints and redo", () => {
  const s = setup();
  s.drawing.begin(1, point(-70));
  s.drawing.commit(1, point(-60));
  assert.deepEqual(s.document.getCell(target, -65, 1), paint);
  assert.deepEqual(s.document.getCell(target, -60, 1), paint);
  assert.equal(s.document.getCell(target, -59, 1), null);
  s.history.markSaved(s.history.captureCheckpoint());
  const saved = state(s);
  s.drawing.begin(1, point(-65));
  s.drawing.commit(1, point(-65));
  assert.deepEqual(state(s), saved);
  s.drawing.begin(1, point(129));
  s.drawing.commit(1, point(140));
  assert.deepEqual(s.document.getCell(target, 130, 1), paint);
  assert.equal(s.document.bounds.maxX, 131);
  s.history.undo();
  const undone = state(s);
  for (const [x, y] of [
    [-80, 1],
    [140, 1],
    [10, -3],
    [10, 4],
  ]) {
    s.drawing.begin(1, point(x, y));
    s.drawing.commit(1, point(x, y));
    assert.deepEqual(state(s), undone);
  }
  s.drawing.begin(1, point(20));
  s.drawing.cancel();
  assert.deepEqual(state(s), undone);
  s.dispose();
});

test("replace previews remove old candidates and support erasure with last-write-wins sparse runs", () => {
  const s = setup(true);
  s.drawing.begin(1, point(60));
  s.drawing.sample(1, point(70));
  s.drawing.commit(1, point(62));
  assert.deepEqual(s.document.getCell(target, 63, 1), old);
  const sparse = new SparsePaint();
  sparse.update(
    [
      { x: 60, y: 1, length: 8, value: paint },
      { x: 62, y: 1, length: 3, value: null },
    ],
    s.document.bounds,
    false,
  );
  assert.deepEqual(
    sparse.writes(target).map(({ x, length, value }) => ({ x, length, value })),
    [
      { x: 60, length: 2, value: paint },
      { x: 62, length: 3, value: null },
      { x: 65, length: 3, value: paint },
    ],
  );
  const before = sparse.writes(target);
  assert.throws(() =>
    sparse.update(
      [
        { x: 0, y: 0, length: 2, value: paint },
        { x: 1.5, y: 0, length: 1, value: null },
      ],
      s.document.bounds,
      true,
    ),
  );
  assert.deepEqual(sparse.writes(target), before);
  s.dispose();
});

test("context changes cancel, hidden/overview/unready/closed sessions cannot begin, errors do not commit", () => {
  for (const change of [
    (s: EditorSession) => s.selectLayer(ground),
    (s: EditorSession) => s.setLayerVisible(target, false),
    (s: EditorSession) => s.viewport.set({ x: 1, y: 0, zoom: 1 }),
    (s: EditorSession) => s.setCanvasSize(400, 300),
    (s: EditorSession) => s.setColor("#ffffff"),
    (s: EditorSession) => s.perform("inspect"),
    (s: EditorSession) => s.canvasState.set("error"),
    (s: EditorSession) => s.dispose(),
  ]) {
    const s = setup(),
      before = state(s);
    s.drawing.begin(1, point(60));
    change(s);
    assert.equal(s.drawing.pointerId, null);
    assert.equal(s.drawing.commit(1, point(70)), false);
    assert.equal(s.drawing.preview.getSnapshot(), null);
    assert.deepEqual(state(s), before);
    s.dispose();
  }
  const s = setup();
  s.setLayerVisible(target, false);
  assert.equal(s.drawing.begin(1, point(1)), false);
  s.setLayerVisible(target, true);
  s.viewport.set({ x: 0, y: 0, zoom: 0.1 });
  assert.equal(s.drawing.begin(1, point(1)), false);
  s.viewport.set({ x: 0, y: 0, zoom: 1 });
  s.drawing.begin(1, point(60));
  s.renameLayer(target, "Other");
  assert.equal(s.drawing.commit(1, point(70)), false);
  assert.equal(s.history.state.undoSteps, 1);
  s.history.undo();
  const before = state(s);
  s.drawing.register("pencil", {
    label: "Bad tool",
    create: () => ({
      sample: () => {
        throw new Error("Bad sample");
      },
    }),
  });
  assert.equal(s.drawing.begin(1, point(60)), false);
  assert.deepEqual(state(s), before);
  assert.match(s.feedback.getSnapshot().message, /Bad sample/);
  s.dispose();
});

test("registered paint stays linked, four-chunk footprints preserve every underlying cell and metadata", () => {
  const document = new MapDocument({
    layers: [
      { id: ground, name: "Ground" },
      { id: target, name: "Target" },
    ],
  });
  const id = registryId("grass");
  document.applyCommands([
    { kind: "registry", id, value: { name: "Grass", rgba: "#123456ff" } },
    {
      kind: "annotation",
      id: annotationId("house"),
      value: {
        name: "House",
        bounds: { minX: 60, minY: 60, maxX: 68, maxY: 68 },
      },
    },
  ]);
  document.writeBatch(
    Array.from({ length: 8 }, (_, i) => ({
      layerId: ground,
      x: 60,
      y: 60 + i,
      length: 8,
      value: old,
    })),
  );
  const s = new EditorSession(document);
  s.canvasState.set("ready");
  s.selectLayer(target);
  s.selectRegisteredColor(id);
  s.drawing.register("rectangle", {
    label: "Rectangle",
    create: ({ paint }) => ({
      sample: ({ start, tile }) => ({
        mode: "replace",
        spans: Array.from(
          { length: Math.abs(start.y - tile.y) + 1 },
          (_, i) => ({
            x: Math.min(start.x, tile.x),
            y: Math.min(start.y, tile.y) + i,
            length: Math.abs(start.x - tile.x) + 1,
            value: paint,
          }),
        ),
      }),
    }),
  });
  s.perform("rectangle");
  s.history.markSaved(s.history.captureCheckpoint());
  const before = state(s),
    entries = document.registryEntries,
    annotations = document.annotations;
  s.drawing.begin(1, point(67, 67));
  s.drawing.commit(1, point(60, 60));
  assert.equal(s.history.state.undoSteps, 1);
  assert.deepEqual(
    [...document.iterateRuns(target)].map(({ value }) => value),
    Array(8).fill(registeredColor(id)),
  );
  assert.equal(document.storageStats().occupiedCells, 128);
  assert.deepEqual(document.registryEntries, entries);
  assert.deepEqual(document.annotations, annotations);
  s.history.undo();
  assert.deepEqual([...document.iterateRuns()], before.runs);
  assert.equal(s.history.state.dirty, false);
  s.history.redo();
  s.drawing.register("eraser", {
    label: "Erase",
    create: () => ({
      sample: ({ tile }) => ({
        mode: "append",
        spans: [{ ...tile, length: 1, value: null }],
      }),
    }),
  });
  s.perform("eraser");
  s.drawing.begin(2, point(64, 64));
  s.drawing.commit(2, point(64, 64));
  assert.equal(document.getCell(target, 64, 64), null);
  assert.deepEqual(document.getCell(ground, 64, 64), old);
  s.history.undo();
  assert.deepEqual(document.getCell(target, 64, 64), registeredColor(id));
  s.dispose();
});
