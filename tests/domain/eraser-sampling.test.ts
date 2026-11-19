import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { sampleVisibleCell } from "../../src/editor/sampling.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";

const terrain = layerId("terrain"),
  buildings = layerId("buildings"),
  grass = registryId("grass");
const green = rawColor("#335c46ff"),
  ref = registeredColor(grass);
const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
function setup() {
  const doc = new MapDocument({
    bounds: { minX: -65, minY: -65, maxX: 131, maxY: 133 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
  doc.applyCommands([
    {
      kind: "registry",
      id: grass,
      value: { name: "Grass", rgba: "#335c46ff" },
    },
  ]);
  doc.writeBatch([
    ...[-65, -64, -1, 0, 31, 32, 63, 64, 65, 130, 132].flatMap((y) => [
      { layerId: terrain, x: -65, y, length: 196, value: green },
      { layerId: buildings, x: -65, y, length: 98, value: ref },
      {
        layerId: buildings,
        x: 33,
        y,
        length: 98,
        value: rawColor("#1d2732ff"),
      },
    ]),
  ]);
  const s = new EditorSession(doc);
  s.canvasState.set("ready");
  s.selectLayer(buildings);
  const checkpoint = s.history.captureCheckpoint();
  s.history.markSaved(checkpoint);
  s.history.markRecovery(checkpoint);
  return s;
}
function snapshot(s: EditorSession) {
  return {
    runs: [...s.document.iterateRuns()],
    bounds: s.document.bounds,
    layers: s.document.layers,
    registry: s.document.registryEntries,
    history: s.history.state,
    version: s.document.version,
  };
}

test("shipping eraser clears mixed content across signed storage/chunk boundaries in one undo step", () => {
  for (const diagonal of [false, true]) {
    const s = setup();
    s.perform("eraser");
    s.setPencilSize(3);
    const before = snapshot(s),
      lower = [...s.document.iterateRuns(terrain)];
    let events = 0;
    s.document.subscribe(() => events++);
    assert.ok(s.drawing.begin(1, point(-65, diagonal ? -65 : 64)));
    s.drawing.sample(1, point(130, diagonal ? 132 : 64));
    s.drawing.sample(1, point(63, 64));
    const writes = s.drawing.preview.getSnapshot()!.writes;
    assert.ok(writes.every((w) => w.value === null));
    assert.deepEqual(snapshot(s), before);
    assert.equal(events, 0);
    s.drawing.commit(1, point(130, diagonal ? 132 : 64));
    assert.equal(events, 1);
    assert.equal(s.history.state.undoSteps, 1);
    assert.equal(s.history.state.undoLabel, "Eraser");
    for (const write of writes)
      for (let x = write.x; x < write.x + write.length; x++)
        assert.equal(s.document.getCell(buildings, x, write.y), null);
    if (!diagonal)
      for (let x = -65; x < 131; x++)
        assert.deepEqual(sampleVisibleCell(s.document, { x, y: 64 }, []), {
          layerId: terrain,
          value: green,
        });
    assert.deepEqual([...s.document.iterateRuns(terrain)], lower);
    assert.deepEqual(s.document.bounds, before.bounds);
    const after = [...s.document.iterateRuns()];
    s.history.undo();
    assert.deepEqual([...s.document.iterateRuns()], before.runs);
    assert.equal(s.history.state.dirty, false);
    s.history.redo();
    assert.deepEqual([...s.document.iterateRuns()], after);
    assert.equal(events, 3);
    s.dispose();
  }
});

test("eraser even footprint, partial corners, empty/outside no-ops and cancellation preserve content and redo", () => {
  const s = setup();
  s.perform("eraser");
  s.setPencilSize(2);
  s.drawing.hover(point(63, 63));
  assert.deepEqual(
    s.drawing.footprint
      .getSnapshot()!
      .writes.map(({ x, y, length, value }) => ({ x, y, length, value })),
    [63, 64].map((y) => ({ x: 63, y, length: 2, value: null })),
  );
  for (const [x, y] of [
    [-65, -65],
    [130, -65],
    [-65, 132],
    [130, 132],
  ]) {
    const before = snapshot(s);
    s.drawing.begin(1, point(x, y));
    s.drawing.commit(1, point(x, y));
    assert.equal(s.document.getCell(buildings, x, y), null);
    assert.deepEqual(s.document.bounds, before.bounds);
    s.history.undo();
    assert.deepEqual([...s.document.iterateRuns()], before.runs);
  }
  const before = snapshot(s);
  for (const [x, y] of [
    [40, 40],
    [-100, 0],
    [200, 200],
  ]) {
    s.drawing.begin(1, point(x, y));
    s.drawing.commit(1, point(x, y));
    assert.deepEqual(snapshot(s), before);
  }
  s.drawing.begin(1, point(63, 63));
  s.setPencilSize(4);
  assert.equal(s.drawing.pointerId, null);
  assert.deepEqual(snapshot(s), before);
  s.drawing.begin(1, point(63, 63));
  s.setLayerVisible(buildings, false);
  assert.equal(s.drawing.pointerId, null);
  assert.equal(s.drawing.begin(1, point(63, 63)), false);
  assert.deepEqual(snapshot(s), before);
  s.dispose();
});

test("sampling preserves registry identity, raw matching bytes and later paint/recolor behavior", () => {
  const s = setup();
  let events = 0;
  s.document.subscribe(() => events++);
  const before = snapshot(s);
  assert.ok(s.sampleColorAt(point(31, 63)));
  assert.deepEqual(s.currentPaint(), ref);
  assert.deepEqual(snapshot(s), before);
  assert.equal(events, 0);
  s.perform("pencil");
  s.drawing.begin(1, point(40, 40));
  s.drawing.commit(1, point(40, 40));
  assert.deepEqual(s.document.getCell(buildings, 40, 40), ref);
  // Raw Grass-colored terrain under an empty upper cell stays raw, not adopted.
  s.setLayerVisible(buildings, false);
  const painted = snapshot(s);
  assert.ok(s.sampleColorAt(point(31, 63)));
  assert.deepEqual(s.currentPaint(), green);
  assert.deepEqual(snapshot(s), painted);
  s.setLayerVisible(buildings, true);
  s.drawing.begin(1, point(41, 40));
  s.drawing.commit(1, point(41, 40));
  assert.deepEqual(s.document.getCell(buildings, 41, 40), green);
  assert.ok(
    s.commitRegistry(
      s.registryCommands.prepare({
        kind: "edit",
        id: grass,
        name: "Grass",
        color: "#778899",
      }),
    ),
  );
  assert.deepEqual(s.document.getCell(buildings, 40, 40), ref);
  assert.deepEqual(s.document.getCell(buildings, 41, 40), green);
  assert.deepEqual(s.currentPaint(), green);
  assert.ok(s.sampleColorAt(point(40, 40)));
  assert.deepEqual(s.currentPaint(), ref);
  assert.equal(s.color.getSnapshot(), "#778899ff");
  s.history.undo();
  assert.equal(s.color.getSnapshot(), "#335c46ff");
  s.history.redo();
  assert.equal(s.color.getSnapshot(), "#778899ff");
  s.dispose();
});

test("visible sampling follows stack and visibility, ignores active target, and leaves empty/outside/overview inert", () => {
  const s = setup();
  s.selectLayer(terrain);
  const before = snapshot(s);
  assert.ok(s.sampleColorAt(point(31, 63)));
  assert.deepEqual(s.currentPaint(), ref); // top, even though Terrain is active
  s.setLayerVisible(buildings, false);
  assert.ok(s.sampleColorAt(point(31, 63)));
  assert.deepEqual(s.currentPaint(), green);
  s.selectLayer(buildings); // hidden active layer may still sample visible terrain
  assert.equal(s.action("eyedropper").reason, null);
  assert.ok(s.sampleColorAt(point(31, 63)));
  s.setLayerVisible(terrain, false);
  assert.equal(s.sampleColorAt(point(31, 63)), false);
  s.setLayerVisible(buildings, true);
  assert.ok(s.sampleColorAt(point(64, 64))); // background-colored raw is occupied
  assert.deepEqual(s.currentPaint(), rawColor("#1d2732ff"));
  for (const [x, y] of [
    [40, 40],
    [-66, 63],
    [131, 63],
    [63, 133],
  ])
    assert.equal(s.sampleColorAt(point(x, y)), false);
  s.viewport.set({ x: 0, y: 0, zoom: 0.1 });
  assert.equal(s.sampleColorAt(point(31, 63)), false);
  s.viewport.set({ x: 0, y: 0, zoom: 1 });
  s.canvasState.set("loading");
  assert.equal(s.sampleColorAt(point(31, 63)), false);
  assert.deepEqual(s.currentPaint(), rawColor("#1d2732ff"));
  assert.deepEqual(snapshot(s), before);
  s.canvasState.set("ready");
  s.setLayerVisible(terrain, true);
  s.moveLayer(terrain, "up");
  s.history.undo(); // sampling must preserve a real redo branch too
  const undone = snapshot(s);
  s.sampleColorAt(point(31, 63));
  assert.deepEqual(snapshot(s), undone);
  s.history.redo();
  s.sampleColorAt(point(31, 63));
  assert.deepEqual(s.currentPaint(), green);
  s.dispose();
  assert.equal(s.sampleColorAt(point(31, 63)), false);
});

test("legacy nonopaque or unresolved cells are not flattened or replaced by an underlying sample", () => {
  const s = setup();
  for (const value of [
    rawColor("#12345680"),
    rawColor("#12345600"),
    registeredColor(registryId("missing")),
  ]) {
    s.execute("Legacy content", [
      {
        kind: "tiles",
        writes: [{ layerId: buildings, x: 64, y: 64, length: 1, value }],
      },
    ]);
    const before = snapshot(s),
      paint = s.currentPaint();
    assert.equal(s.sampleColorAt(point(64, 64)), false);
    assert.equal(s.feedback.getSnapshot().kind, "error");
    assert.deepEqual(s.currentPaint(), paint);
    assert.deepEqual(snapshot(s), before);
  }
  s.dispose();
});
