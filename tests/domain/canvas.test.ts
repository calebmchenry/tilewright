import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasInteger,
  GROWTH_EDGES,
  grownMapBounds,
  MAX_MAP_SIZE,
  newMapBounds,
} from "../../src/domain/canvas.ts";
import { MapDocument } from "../../src/domain/document.ts";
import {
  annotationId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { gridDocument } from "../fixtures/grid.ts";
import { canvasInvalidation } from "../../src/editor/invalidation.ts";
import { panBy, tileToScreen, zoomLimits } from "../../src/editor/viewport.ts";

const zero = { left: 0, right: 0, top: 0, bottom: 0 };

test("new maps accept small, partial, target and maximum sizes without tile allocation", () => {
  for (const [width, height] of [
    [1, 1],
    [101, 130],
    [256, 256],
    [6400, 6400],
    [MAX_MAP_SIZE, MAX_MAP_SIZE],
  ]) {
    const workspace = new EditorWorkspace();
    workspace.createMap(width, height);
    const session = workspace.state.getSnapshot().session;
    assert.deepEqual(session.document.bounds, {
      minX: 0,
      minY: 0,
      maxX: width,
      maxY: height,
    });
    assert.equal(session.document.layers.length, 1);
    assert.equal(session.document.layers[0].name, "Layer 1");
    assert.equal(session.document.storageStats().partitions, 0);
    assert.equal(session.document.storageStats().typedArrayBytes, 0);
    assert.equal(session.history.state.undoSteps, 0);
    assert.equal(session.history.state.dirty, true);
    workspace.dispose();
  }
});

test("invalid creation preserves the current document; valid replacement closes old history", () => {
  const workspace = new EditorWorkspace(new EditorSession(gridDocument()));
  const before = workspace.state.getSnapshot();
  const runs = [...before.session.document.iterateRuns()];
  for (const invalid of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    65537,
    Number.MAX_SAFE_INTEGER,
    1e30,
  ]) {
    assert.throws(() => workspace.createMap(invalid, 256), RangeError);
    assert.throws(() => workspace.createMap(256, invalid), RangeError);
    assert.equal(workspace.state.getSnapshot(), before);
  }
  for (const invalid of [
    "",
    " ",
    "1.5",
    "-1",
    "1e3",
    "Infinity",
    "9007199254740993",
  ]) {
    assert.throws(() => canvasInteger(invalid, "Width", 1), RangeError);
  }
  assert.equal(canvasInteger(" 101 ", "Width", 1), 101);
  assert.deepEqual([...before.session.document.iterateRuns()], runs);
  workspace.createMap(101, 130);
  assert.equal(before.session.growCanvas({ ...zero, left: 1 }), false);
  assert.equal(workspace.state.getSnapshot().generation, 1);
  workspace.dispose();
  assert.throws(() => workspace.createMap(1, 1), /closed/);
});

test("every growth edge and combined growth preserve all populated layers, identities, annotations and camera", () => {
  for (const counts of [
    ...GROWTH_EDGES.map((edge) => ({ ...zero, [edge]: 1 })),
    { left: 2, right: 3, top: 1, bottom: 4 },
  ]) {
    const document = gridDocument();
    const id = registryId("grass");
    document.applyCommands([
      { kind: "registry", id, value: { name: "Grass", rgba: "#335c46ff" } },
      {
        kind: "annotation",
        id: annotationId("house"),
        value: {
          name: "House",
          bounds: { minX: 60, minY: 60, maxX: 68, maxY: 68 },
          anchor: { x: 64, y: 64 },
        },
      },
      {
        kind: "tiles",
        writes: document.layers.map((layer) => ({
          layerId: layer.id,
          x: 63,
          y: 63,
          length: 1,
          value: registeredColor(id),
        })),
      },
    ]);
    const session = new EditorSession(document);
    session.viewport.set({ x: 55.125, y: 55.125, zoom: 1 });
    const before = {
      bounds: document.bounds,
      layers: document.layers,
      runs: [...document.iterateRuns()],
      registry: document.registryEntries,
      annotations: document.annotations,
      stats: document.storageStats(),
      view: session.viewport.getSnapshot(),
    };
    const changes: ReturnType<typeof canvasInvalidation>[] = [];
    document.subscribe((change) => changes.push(canvasInvalidation(change)));
    assert.equal(session.growCanvas(counts), true);
    const expected = {
      minX: -65 - counts.left * 64,
      maxX: 131 + counts.right * 64,
      minY: -65 - counts.top * 64,
      maxY: 133 + counts.bottom * 64,
    };
    assert.deepEqual(document.bounds, expected);
    assert.equal(session.bounds.getSnapshot(), document.bounds);
    for (const layer of document.layers) {
      if (counts.left)
        assert.equal(document.getCell(layer.id, expected.minX, 0), null);
      if (counts.right)
        assert.equal(document.getCell(layer.id, expected.maxX - 1, 0), null);
      if (counts.top)
        assert.equal(document.getCell(layer.id, 0, expected.minY), null);
      if (counts.bottom)
        assert.equal(document.getCell(layer.id, 0, expected.maxY - 1), null);
    }
    assert.equal(session.history.state.undoSteps, 1);
    assert.equal(session.perform("undo"), true);
    assert.deepEqual(document.bounds, before.bounds);
    assert.equal(session.perform("redo"), true);
    assert.deepEqual(document.bounds, expected);
    assert.equal(document.layers, before.layers);
    assert.deepEqual([...document.iterateRuns()], before.runs);
    assert.deepEqual(document.registryEntries, before.registry);
    assert.deepEqual(document.annotations, before.annotations);
    assert.deepEqual(document.storageStats(), before.stats);
    assert.equal(session.viewport.getSnapshot(), before.view);
    assert.equal(changes.length, 3);
    for (const change of changes) {
      assert.equal(change.bounds, true);
      assert.deepEqual(change.regions, []);
    }
    session.dispose();
  }
});

test("growth and subsequent boundary edits undo/redo chronologically; outside writes cannot grow", () => {
  const session = new EditorSession(
    new MapDocument({ bounds: newMapBounds(101, 130) }),
  );
  session.canvasState.set("ready");
  const layerId = session.document.layers[0].id;
  const paint = (x: number, y: number) =>
    session.execute("Paint", [
      {
        kind: "tiles",
        writes: [{ layerId, x, y, length: 1, value: rawColor("#ff0000ff") }],
      },
    ]);
  assert.equal(paint(100, 129), true);
  for (const [x, y] of [
    [-1, 0],
    [0, -1],
    [101, 0],
    [0, 130],
  ]) {
    const history = session.history.state;
    assert.equal(paint(x, y), false);
    assert.equal(
      session.editableTileAt(
        tileToScreen(x, y, session.viewport.getSnapshot()),
      ),
      null,
    );
    assert.deepEqual(session.history.state, history);
    assert.deepEqual(session.document.bounds, newMapBounds(101, 130));
  }
  assert.equal(
    session.growCanvas({ left: 1, right: 1, top: 1, bottom: 1 }),
    true,
  );
  assert.deepEqual(session.document.bounds, {
    minX: -64,
    minY: -64,
    maxX: 165,
    maxY: 194,
  });
  assert.equal(paint(-64, -64), true);
  assert.equal(session.perform("undo"), true);
  assert.equal(session.document.getCell(layerId, -64, -64), null);
  assert.equal(session.perform("undo"), true);
  assert.deepEqual(session.document.bounds, newMapBounds(101, 130));
  assert.equal(session.document.getCell(layerId, 100, 129)?.kind, "raw");
  assert.equal(session.perform("redo"), true);
  assert.equal(session.perform("redo"), true);
  assert.deepEqual(
    session.document.getCell(layerId, -64, -64),
    rawColor("#ff0000ff"),
  );
});

test("invalid, overflowing and all-zero growth preserve state and redo; camera limits use new bounds", () => {
  const session = new EditorSession();
  session.growCanvas({ ...zero, right: 1 });
  session.perform("undo");
  const before = session.history.state;
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 1024])
    assert.equal(session.growCanvas({ ...zero, right: value }), false);
  assert.equal(session.growCanvas(zero), true);
  assert.deepEqual(session.history.state, before);
  assert.throws(
    () =>
      grownMapBounds(
        {
          minX: Number.MAX_SAFE_INTEGER - 1,
          minY: 0,
          maxX: Number.MAX_SAFE_INTEGER,
          maxY: 1,
        },
        { ...zero, right: 1 },
      ),
    RangeError,
  );
  session.perform("redo");
  session.setCanvasSize(800, 600);
  const original = session.document.bounds;
  assert.equal(session.growCanvas({ ...zero, right: 990, bottom: 990 }), true);
  const bounds = session.document.bounds;
  const size = session.canvasSize.getSnapshot();
  assert.ok(zoomLimits(bounds, size).min < zoomLimits(original, size).min);
  session.pan(-1e6, -1e6);
  assert.deepEqual(
    session.viewport.getSnapshot(),
    panBy({ x: 0, y: 0, zoom: 1 }, -1e6, -1e6, bounds, size),
  );
});
