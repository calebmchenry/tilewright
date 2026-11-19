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
import {
  pencilCenters,
  pencilFootprint,
  pencilTool,
} from "../../src/editor/pencil.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";

const terrain = layerId("terrain"),
  buildings = layerId("buildings");
const paint = rawColor("#123456ff"),
  old = rawColor("#abcdefff");
const bounds = { minX: -65, minY: -65, maxX: 131, maxY: 133 };
const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
function setup(size = 1, registered = false) {
  const doc = new MapDocument({
    bounds,
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
  doc.applyCommands([
    {
      kind: "registry",
      id: registryId("grass"),
      value: { name: "Grass", rgba: "#123456ff" },
    },
  ]);
  doc.writeBatch(
    [terrain, buildings].flatMap((layerId) =>
      Array.from({ length: 8 }, (_, i) => ({
        layerId,
        x: 60,
        y: 60 + i,
        length: 8,
        value: old,
      })),
    ),
  );
  const s = new EditorSession(doc);
  s.canvasState.set("ready");
  s.selectLayer(buildings);
  if (registered) s.selectRegisteredColor(registryId("grass"));
  else s.setColor("#123456");
  s.drawing.register(
    "pencil",
    pencilTool(() => size),
  );
  s.perform("pencil");
  s.history.markSaved(s.history.captureCheckpoint());
  return s;
}

test("stationary square dabs use exact one/even/odd/max footprints and deduplicate release", () => {
  for (const size of [1, 2, 3, 4, 31, 32]) {
    const s = setup(size),
      before = [...s.document.iterateRuns()];
    s.drawing.begin(1, point(64, 64));
    s.drawing.sample(1, point(64, 64));
    const writes = s.drawing.preview.getSnapshot()!.writes;
    const start = 64 - Math.floor((size - 1) / 2);
    assert.equal(writes.length, size);
    assert.deepEqual(
      writes.map(({ x, y, length }) => ({ x, y, length })),
      Array.from({ length: size }, (_, i) => ({
        x: start,
        y: start + i,
        length: size,
      })),
    );
    assert.deepEqual([...s.document.iterateRuns()], before);
    assert.equal(s.history.state.dirty, false);
    s.drawing.commit(1, point(64, 64));
    assert.equal(s.history.state.undoSteps, 1);
    for (let y = start; y < start + size; y++)
      for (let x = start; x < start + size; x++)
        assert.deepEqual(s.document.getCell(buildings, x, y), paint);
    s.history.undo();
    assert.deepEqual([...s.document.iterateRuns()], before);
    s.dispose();
  }
});

test("fast horizontal/diagonal strokes cross storage and visual chunks, preserve layers and undo exactly", () => {
  for (const registered of [false, true])
    for (const diagonal of [false, true]) {
      const s = setup(3, registered),
        before = [...s.document.iterateRuns()];
      const base = [...s.document.iterateRuns(terrain)];
      let events = 0;
      s.document.subscribe(() => events++);
      s.drawing.begin(1, point(-64, diagonal ? -64 : 64));
      s.drawing.sample(1, point(129, diagonal ? 129 : 64));
      s.drawing.sample(1, point(60, diagonal ? 60 : 64)); // retrace overlap
      assert.equal(events, 0);
      const writes = s.drawing.preview.getSnapshot()!.writes;
      const cells = writes.flatMap((w) =>
        Array.from({ length: w.length }, (_, i) => `${w.x + i}/${w.y}`),
      );
      assert.equal(new Set(cells).size, cells.length);
      s.drawing.commit(1, point(129, diagonal ? 129 : 64));
      assert.equal(events, 1);
      assert.equal(s.history.state.undoSteps, 1);
      const value = registered ? registeredColor(registryId("grass")) : paint;
      for (let x = -64; x <= 129; x++)
        for (let dy = -1; dy <= 1; dy++)
          assert.deepEqual(
            s.document.getCell(buildings, x, (diagonal ? x : 64) + dy),
            value,
          );
      assert.deepEqual([...s.document.iterateRuns(terrain)], base);
      const after = [...s.document.iterateRuns()];
      s.history.undo();
      assert.deepEqual([...s.document.iterateRuns()], before);
      assert.equal(s.history.state.dirty, false);
      s.history.redo();
      assert.deepEqual([...s.document.iterateRuns()], after);
      s.dispose();
    }
});

test("integer interpolation is connected in every octant, includes endpoints and is reversal invariant", () => {
  for (const end of [
    { x: 70, y: 66 },
    { x: 66, y: 70 },
    { x: 54, y: 68 },
    { x: 68, y: 54 },
    { x: 54, y: 58 },
    { x: 58, y: 54 },
    { x: 60, y: 70 },
    { x: 70, y: 60 },
  ]) {
    const start = { x: 60, y: 60 };
    const cells = [...pencilCenters(start, end, 1, bounds)];
    assert.deepEqual(cells, [...pencilCenters(end, start, 1, bounds)]);
    assert.ok(cells.some((p) => p.x === start.x && p.y === start.y));
    assert.ok(cells.some((p) => p.x === end.x && p.y === end.y));
    assert.equal(
      cells.length,
      Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) + 1,
    );
    for (let i = 1; i < cells.length; i++) {
      assert.ok(Math.abs(cells[i].x - cells[i - 1].x) <= 1);
      assert.ok(Math.abs(cells[i].y - cells[i - 1].y) <= 1);
    }
  }
  assert.deepEqual(
    [...pencilCenters({ x: 0, y: 0 }, { x: 4, y: 2 }, 1, bounds)],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ],
  );
});

test("edge stamps clip all sides, outside-only strokes and same-color repaint preserve history/redo", () => {
  const s = setup(4),
    before = [...s.document.iterateRuns()];
  for (const [x, y] of [
    [-65, -65],
    [130, -65],
    [-65, 132],
    [130, 132],
  ]) {
    s.drawing.begin(1, point(x, y));
    s.drawing.commit(1, point(x, y));
  }
  assert.deepEqual(s.document.bounds, bounds);
  assert.equal(s.drawing.preview.getSnapshot(), null);
  s.history.undo();
  const state = s.history.state,
    runs = [...s.document.iterateRuns()];
  for (const [x, y] of [
    [-100, 0],
    [200, 0],
    [0, -100],
    [0, 200],
    [-65, -65],
  ]) {
    s.drawing.begin(1, point(x, y));
    s.drawing.commit(1, point(x, y));
    assert.deepEqual(s.history.state, state);
    assert.deepEqual([...s.document.iterateRuns()], runs);
  }
  for (let i = 0; i < 3; i++) s.history.undo();
  assert.deepEqual([...s.document.iterateRuns()], before);
  const tiny = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
  assert.deepEqual(
    [...pencilFootprint({ x: 2, y: 2 }, 4, tiny, paint)],
    [{ x: 1, y: 1, length: 1, value: paint }],
  );
  // Huge outside endpoints must skip irrelevant space, retaining the line phase.
  const far = Number.MAX_SAFE_INTEGER - 100;
  assert.deepEqual(
    [...pencilCenters({ x: -far, y: -far }, { x: far, y: far }, 1, tiny)],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  );
  for (const size of [0, -1, 1.5, 33, NaN, Infinity])
    assert.throws(() => [
      ...pencilFootprint({ x: 0, y: 0 }, size, tiny, paint),
    ]);
  s.dispose();
});

test("shipping pencil size and hover are transient; changes cancel strokes and shortcuts respect text focus", () => {
  const s = new EditorSession();
  s.canvasState.set("ready");
  s.history.markSaved(s.history.captureCheckpoint());
  assert.equal(s.routeKey({ key: "b" }, "canvas"), true);
  assert.equal(s.activeTool.getSnapshot(), "pencil");
  const before = s.history.state;
  s.setPencilSize(4);
  s.drawing.hover(point(0, 0));
  assert.deepEqual(
    s.drawing.footprint
      .getSnapshot()!
      .writes.map(({ x, y, length }) => ({ x, y, length })),
    [0, 1, 2].map((y) => ({ x: 0, y, length: 3 })),
  );
  assert.deepEqual(s.history.state, before);
  assert.equal(s.document.storageStats().occupiedCells, 0);
  s.drawing.begin(1, point(2, 2));
  assert.equal(s.drawing.footprint.getSnapshot(), null);
  s.routeKey({ key: "]" }, "canvas");
  assert.equal(s.pencilSize.getSnapshot(), 5);
  assert.equal(s.drawing.pointerId, null);
  assert.equal(s.drawing.commit(1, point(8, 8)), false);
  assert.equal(s.drawing.preview.getSnapshot(), null);
  assert.deepEqual(s.history.state, before);
  for (const input of [{ key: "]" }, { key: "[" }, { key: "b" }]) {
    assert.equal(s.routeKey(input, "text"), false);
    assert.equal(s.routeKey({ ...input, isComposing: true }, "canvas"), false);
    assert.equal(s.routeKey({ ...input, metaKey: true }, "canvas"), false);
  }
  for (const size of [0, 33, 1.5, NaN]) {
    assert.equal(s.setPencilSize(size), false);
    assert.equal(s.pencilSize.getSnapshot(), 5);
  }
  s.setPencilSize(32);
  s.routeKey({ key: "]" }, "canvas");
  assert.equal(s.pencilSize.getSnapshot(), 32);
  s.setPencilSize(1);
  s.routeKey({ key: "[" }, "canvas");
  assert.equal(s.pencilSize.getSnapshot(), 1);
  for (const change of [
    () => s.perform("pan"),
    () => s.setLayerVisible(s.activeLayer.getSnapshot(), false),
    () => s.viewport.set({ x: 0, y: 0, zoom: 0.1 }),
    () => s.dispose(),
  ]) {
    s.perform("pencil");
    s.drawing.hover(point(0, 0));
    change();
    s.drawing.hover(point(0, 0));
    assert.equal(s.drawing.footprint.getSnapshot(), null);
  }
  assert.deepEqual(s.history.state, before);
});
