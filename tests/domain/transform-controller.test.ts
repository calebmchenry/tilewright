import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorSession } from "../../src/editor/session.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import { type SelectionTransform } from "../../src/domain/selection.ts";
import { rawColor } from "../../src/domain/values.ts";
import { rasterizeChunk, visibleChunks } from "../../src/renderer/chunks.ts";
import {
  movementDocument,
  walls,
  furniture,
  terrain,
} from "../fixtures/selection.ts";
const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
const rectangle = { minX: 60, minY: 60, maxX: 68, maxY: 66 };
function setup() {
  const s = new EditorSession(movementDocument());
  s.canvasState.set("ready");
  s.selectLayer(walls);
  s.perform("select");
  s.history.markSaved(s.history.captureCheckpoint());
  s.history.markRecovery(s.history.captureCheckpoint());
  s.selection.begin(1, point(60, 60));
  s.selection.commit(1, point(67, 65));
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

test("composed previews retain source, pinned layers and top-left, reverse to no-op with redo/checkpoints, or apply one reversible edit", () => {
  const s = setup();
  s.execute("temporary", [
    {
      kind: "tiles",
      writes: [
        { layerId: walls, x: 0, y: 0, length: 1, value: rawColor("#ffffffff") },
      ],
    },
  ]);
  s.history.undo();
  s.selectLayer(terrain);
  s.setLayerVisible(terrain, false);
  const before = persistent(s),
    original = content(s),
    selection = s.selection.state.getSnapshot();
  for (const op of [
    "rotate-clockwise",
    "rotate-counterclockwise",
    "flip-horizontal",
    "flip-vertical",
  ] as SelectionTransform[]) {
    for (let i = 0; i < (op.startsWith("rotate") ? 4 : 2); i++)
      assert.equal(s.perform(op), true);
    assert.deepEqual(s.selection.preview.getSnapshot()!.bounds, rectangle);
    assert.deepEqual(persistent(s), before);
    assert.equal(s.selection.commitPlacement(), true);
    assert.deepEqual(persistent(s), before);
  }
  assert.equal(s.perform("rotate-clockwise"), true);
  assert.deepEqual(s.selection.preview.getSnapshot()!.bounds, {
    minX: 60,
    minY: 60,
    maxX: 66,
    maxY: 68,
  });
  assert.equal(s.perform("copy"), false);
  assert.equal(s.perform("cut"), false);
  s.routeKey({ key: "ArrowRight" }, "canvas");
  s.routeKey({ key: "ArrowDown", shiftKey: true }, "canvas");
  for (const owner of ["text", "panel", "outside"] as const)
    assert.equal(s.routeKey({ key: "Enter" }, owner), false);
  for (const mod of [
    { isComposing: true },
    { metaKey: true },
    { ctrlKey: true },
    { altKey: true },
  ])
    assert.equal(s.routeKey({ key: "Enter", ...mod }, "canvas"), false);
  assert.deepEqual(persistent(s), before);
  assert.deepEqual(s.selection.state.getSnapshot(), selection);
  s.routeKey({ key: "Enter" }, "canvas");
  assert.equal(s.history.state.undoSteps, 1);
  assert.equal(s.history.state.undoLabel, "Transform selection");
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, {
    minX: 61,
    minY: 70,
    maxX: 67,
    maxY: 78,
  });
  assert.deepEqual(
    s.selection.state.getSnapshot()!.layers.map((l) => l.layerId),
    [walls, furniture],
  );
  const after = content(s);
  s.perform("undo");
  assert.deepEqual(content(s), original);
  s.perform("redo");
  assert.deepEqual(content(s), after);
  s.dispose();
});

test("live transforms and paste transforms cancel on every context or mutation, never commit stale data", () => {
  for (const paste of [false, true])
    for (const cause of [
      "escape",
      "cancel",
      "layer",
      "view",
      "size",
      "ready",
      "tool",
      "inclusion",
      "hidden",
      "removed",
      "version",
      "undo",
      "dispose",
    ]) {
      const s = setup();
      s.perform("copy");
      const clipboard = s.selection.clipboard.getSnapshot();
      if (paste) s.perform("paste");
      s.perform("rotate-clockwise");
      const before = persistent(s),
        selected = s.selection.state.getSnapshot();
      if (cause === "escape") s.selection.escape();
      if (cause === "cancel") s.selection.cancel();
      if (cause === "layer") s.selectLayer(terrain);
      if (cause === "view") s.viewport.set({ x: 1, y: 0, zoom: 1 });
      if (cause === "size") s.setCanvasSize(900, 700);
      if (cause === "ready") s.canvasState.set("loading");
      if (cause === "tool") s.perform("pan");
      if (cause === "inclusion") s.selection.setIncluded(furniture, false);
      if (cause === "hidden") s.setLayerVisible(furniture, false);
      if (cause === "removed") s.removeLayer(furniture, true);
      if (cause === "version") s.renameLayer(walls, "Renamed");
      if (cause === "undo") s.perform("undo");
      if (cause === "dispose") s.dispose();
      const after = persistent(s);
      assert.equal(s.selection.placing, false);
      assert.equal(s.selection.commitPlacement(), false);
      assert.deepEqual(persistent(s), after);
      if (!["removed", "version"].includes(cause))
        assert.deepEqual(persistent(s), before);
      if (
        ["escape", "cancel", "layer", "view", "size", "ready", "tool"].includes(
          cause,
        )
      )
        assert.equal(s.selection.state.getSnapshot(), selected);
      if (cause !== "dispose")
        assert.equal(s.selection.clipboard.getSnapshot(), clipboard);
      s.dispose();
    }
});

test("transformed paste leaves clipboard untouched, resets geometry on repeat, and never clears source", () => {
  const s = setup();
  s.perform("copy");
  const clipboard = s.selection.clipboard.getSnapshot(),
    original = content(s);
  s.pointer.set({ x: 80, y: 80 });
  s.perform("paste");
  s.perform("rotate-clockwise");
  s.perform("flip-horizontal");
  assert.deepEqual(s.selection.preview.getSnapshot()!.bounds, {
    minX: 80,
    minY: 80,
    maxX: 86,
    maxY: 88,
  });
  assert.equal(s.selection.pasting, true);
  assert.equal(s.selection.clipboard.getSnapshot(), clipboard);
  assert.equal(s.selection.commitPaste(), true);
  assert.equal(s.history.state.undoLabel, "Paste");
  for (const layer of clipboard!.layers)
    for (const run of layer.runs)
      for (let x = run.x; x < run.x + run.length; x++)
        assert.deepEqual(
          s.document.getCell(layer.layerId, 60 + x, 60 + run.y),
          run.value,
        );
  s.perform("paste");
  assert.deepEqual(s.selection.preview.getSnapshot()!.bounds, {
    minX: 80,
    minY: 80,
    maxX: 88,
    maxY: 86,
  });
  s.perform("flip-vertical");
  s.selection.escape();
  s.perform("undo");
  assert.deepEqual(content(s), original);
  s.dispose();
});

test("out-of-bounds live transform stays adjustable, empty extents checked, and history rejection retains candidate", () => {
  const s = setup();
  s.selection.deselect();
  s.selection.begin(1, point(128, 131));
  s.selection.commit(1, point(130, 132));
  const before = persistent(s),
    selected = s.selection.state.getSnapshot();
  s.perform("rotate-clockwise");
  assert.match(
    s.selection.preview.getSnapshot()!.transform!.reason!,
    /entire selection/,
  );
  assert.equal(s.selection.preview.getSnapshot()!.transform!.writes.length, 0);
  assert.equal(s.selection.commitPlacement(), false);
  assert.deepEqual(persistent(s), before);
  assert.equal(s.selection.state.getSnapshot(), selected);
  s.routeKey({ key: "ArrowUp" }, "canvas");
  assert.equal(s.selection.preview.getSnapshot()!.transform!.reason, null);
  assert.equal(s.selection.commitPlacement(), true);
  assert.deepEqual(persistent(s), before);
  s.dispose();
  const capacity = setup();
  capacity.history.execute = () => {
    throw new Error("Transaction exceeds history byte limit");
  };
  const prior = persistent(capacity);
  capacity.perform("flip-horizontal");
  assert.equal(capacity.selection.commitPlacement(), false);
  assert.equal(capacity.selection.placing, true);
  assert.match(capacity.feedback.getSnapshot().message, /history byte limit/);
  assert.deepEqual(persistent(capacity), prior);
  capacity.selection.escape();
  assert.deepEqual(persistent(capacity), prior);
  capacity.dispose();
});

test("each transform preview raster equals the actual layered result; observer failures remain committed", () => {
  for (const op of [
    "rotate-clockwise",
    "rotate-counterclockwise",
    "flip-horizontal",
    "flip-vertical",
  ] as SelectionTransform[]) {
    const s = setup();
    s.perform(op);
    s.selection.nudge(1, 1);
    const writes = s.selection.preview.getSnapshot()!.transform!.writes;
    const regions = visibleChunks(
      s.document.bounds,
      { x: 55, y: 55, zoom: 1 },
      600,
      600,
    );
    const rasters = s.document.layers.flatMap(({ id }) =>
      regions.map((region) => ({
        id,
        region,
        raster: rasterizeChunk(s.document, id, region, writes),
      })),
    );
    s.document.subscribe(() => {
      throw new Error("view failure");
    });
    assert.equal(s.selection.commitPlacement(), true);
    assert.equal(s.selection.commitPlacement(), false);
    assert.match(s.feedback.getSnapshot().message, /committed, but a view/);
    for (const { id, region, raster } of rasters) {
      const actual = rasterizeChunk(s.document, id, region);
      assert.deepEqual(raster.pixels, actual.pixels);
      assert.equal(raster.cells, actual.cells);
      assert.deepEqual(raster.registryIds, actual.registryIds);
    }
    assert.equal(s.history.state.undoSteps, 1);
    s.dispose();
  }
});
