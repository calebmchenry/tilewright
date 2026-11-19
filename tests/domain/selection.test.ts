import assert from "node:assert/strict";
import { test } from "node:test";
import { captureSelection, selectionCell } from "../../src/domain/selection.ts";
import { layerId, rawColor, registeredColor } from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import {
  selectionDocument,
  house,
  terrain,
  walls,
  furniture,
  stone,
} from "../fixtures/selection.ts";

function setup() {
  const s = new EditorSession(selectionDocument());
  s.canvasState.set("ready");
  s.selectLayer(walls);
  s.perform("select");
  s.history.markSaved(s.history.captureCheckpoint());
  s.history.markRecovery(s.history.captureCheckpoint());
  return s;
}
const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
function select(s: EditorSession, x = 60, y = 60, endX = 67, endY = 67) {
  assert.equal(s.selection.begin(1, point(x, y)), true);
  assert.equal(s.selection.commit(1, point(endX, endY)), true);
  return s.selection.state.getSnapshot()!;
}
const documentState = (s: EditorSession) => ({
  runs: [...s.document.iterateRuns()],
  annotations: s.document.annotations,
  registry: s.document.registryEntries,
  layers: s.document.layers,
  bounds: s.document.bounds,
  version: s.document.version,
  history: s.history.state,
});

test("selection captures exact local multilayer payloads, covered cells, holes and alpha-zero paint, never annotations", () => {
  const doc = selectionDocument(),
    payload = captureSelection(doc, house, [walls, furniture]);
  assert.deepEqual(
    [payload.width, payload.height, payload.tileCount],
    [8, 8, 64],
  );
  assert.deepEqual(
    payload.layers.map((l) => [l.layerId, l.occupiedCount]),
    [
      [walls, 64],
      [furniture, 3],
    ],
  );
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      assert.deepEqual(
        selectionCell(payload, walls, x, y),
        registeredColor(stone),
      );
      assert.deepEqual(
        selectionCell(payload, furniture, x, y),
        doc.getCell(furniture, x + 60, y + 60),
      );
    }
  assert.equal(selectionCell(payload, furniture, 7, 7), null);
  assert.deepEqual(
    selectionCell(payload, furniture, 4, 1),
    rawColor("#00000000"),
  );
  assert.equal(JSON.stringify(payload).includes("Independent label"), false);
  assert.deepEqual(
    Object.keys(payload).sort(),
    [
      "bounds",
      "width",
      "height",
      "tileCount",
      "documentVersion",
      "layers",
    ].sort(),
  );
  assert.throws(() => selectionCell(payload, terrain, 0, 0));
  assert.throws(() => selectionCell(payload, walls, 8, 0));
  assert.throws(() => captureSelection(doc, house, []));
  assert.throws(() => captureSelection(doc, house, [walls, walls]));
  assert.throws(() => captureSelection(doc, house, [layerId("missing")]));
  assert.throws(() => captureSelection(doc, { ...house, maxX: 200 }, [walls]));
  assert.throws(() => captureSelection(doc, { ...house, maxX: 60 }, [walls]));
  assert.ok(Object.isFrozen(payload.layers[1].runs[0].value));
  assert.throws(() => (payload.layers[1].runs as unknown[]).push({}));
  doc.setCell(furniture, 60, 61, null);
  assert.deepEqual(
    selectionCell(payload, furniture, 0, 1),
    rawColor("#aabbccff"),
  );
});

test("all drag directions select precise 8x8 rectangles across chunks and signed/partial edges; starts outside do nothing", () => {
  const s = setup(),
    before = documentState(s);
  let events = 0;
  s.document.subscribe(() => events++);
  for (const [x, y] of [
    [60, 60],
    [-65, -65],
    [123, 125],
  ])
    for (const reverseX of [false, true])
      for (const reverseY of [false, true]) {
        s.selection.deselect();
        const payload = select(
          s,
          x + (reverseX ? 7 : 0),
          y + (reverseY ? 7 : 0),
          x + (reverseX ? 0 : 7),
          y + (reverseY ? 0 : 7),
        );
        assert.deepEqual(payload.bounds, {
          minX: x,
          minY: y,
          maxX: x + 8,
          maxY: y + 8,
        });
        assert.equal(payload.tileCount, 64);
        assert.deepEqual(
          payload.layers.map((l) => l.layerId),
          [walls],
        );
      }
  for (const [x, y] of [
    [-66, 0],
    [131, 0],
    [0, -66],
    [0, 133],
  ]) {
    const previous = s.selection.state.getSnapshot();
    assert.equal(s.selection.begin(1, point(x, y)), false);
    assert.equal(s.selection.state.getSnapshot(), previous);
  }
  s.selection.deselect();
  assert.deepEqual(select(s, 123, 125, 1e6, 1e6).bounds, {
    minX: 123,
    minY: 125,
    maxX: 131,
    maxY: 133,
  });
  s.selection.deselect();
  assert.deepEqual(select(s, -58, -58, -1e6, -1e6).bounds, {
    minX: -65,
    minY: -65,
    maxX: -57,
    maxY: -57,
  });
  assert.deepEqual(documentState(s), before);
  assert.equal(events, 0);
  s.dispose();
});

test("one-cell and empty selections remain valid and selection changes preserve redo, saved/recovery checkpoints and all content", () => {
  const s = setup();
  s.execute("Temporary", [
    {
      kind: "tiles",
      writes: [
        { layerId: walls, x: 2, y: 2, length: 1, value: rawColor("#ff0000ff") },
      ],
    },
  ]);
  s.perform("undo");
  const before = documentState(s);
  const one = select(s, 2, 2, 2, 2);
  assert.equal(one.tileCount, 1);
  assert.equal(one.layers[0].occupiedCount, 0);
  s.selection.setIncluded(furniture, true);
  s.selection.setIncluded(walls, false);
  assert.equal(s.selection.setIncluded(furniture, false), false);
  s.selection.escape();
  assert.equal(s.selection.state.getSnapshot(), null);
  select(s);
  assert.deepEqual(documentState(s), before);
  s.dispose();
});

test("membership is explicit, pinned by identity, refreshes content and invalidates all layers together", () => {
  const s = setup();
  select(s);
  s.selection.setIncluded(furniture, true);
  s.selectLayer(terrain);
  const ids = () =>
    s.selection.state.getSnapshot()?.layers.map((l) => l.layerId);
  assert.deepEqual(ids(), [walls, furniture]);
  s.renameLayer(walls, "Renamed walls");
  s.moveLayer(walls, "up");
  s.addLayer();
  assert.deepEqual(ids(), [walls, furniture]);
  s.execute("Edit selected tile", [
    {
      kind: "tiles",
      writes: [
        {
          layerId: furniture,
          x: 60,
          y: 60,
          length: 1,
          value: rawColor("#ffffffff"),
        },
      ],
    },
  ]);
  assert.equal(s.selection.state.getSnapshot()!.layers[1].occupiedCount, 4);
  s.setLayerVisible(terrain, false);
  assert.deepEqual(ids(), [walls, furniture]);
  assert.equal(s.selection.setIncluded(terrain, true), false);
  assert.equal(s.selection.setIncluded(layerId("missing"), true), false);
  s.setLayerVisible(furniture, false);
  assert.equal(s.selection.state.getSnapshot(), null);
  assert.match(s.feedback.getSnapshot().message, /Selection cleared/);
  s.setLayerVisible(furniture, true);
  assert.equal(s.selection.state.getSnapshot(), null);
  s.selectLayer(walls);
  select(s);
  s.removeLayer(walls, true);
  assert.equal(s.selection.state.getSnapshot(), null);
  s.perform("undo");
  assert.equal(s.selection.state.getSnapshot(), null);
  s.dispose();
});

test("canceled replacement restores previous geometry/scope; pending creation cancels on context changes", () => {
  for (const change of [
    (s: EditorSession) => s.selection.cancel(),
    (s: EditorSession) => s.selection.escape(),
    (s: EditorSession) => s.selectLayer(terrain),
    (s: EditorSession) => s.viewport.set({ x: 1, y: 0, zoom: 1 }),
    (s: EditorSession) => s.setCanvasSize(900, 600),
    (s: EditorSession) => s.canvasState.set("loading"),
    (s: EditorSession) => s.perform("pan"),
    (s: EditorSession) => s.perform("inspect"),
    (s: EditorSession) => s.perform("eyedropper"),
  ]) {
    const s = setup(),
      original = select(s),
      before = documentState(s);
    s.selection.begin(7, point(0, 0));
    s.selection.sample(7, point(8, 8));
    s.selection.cancel(8);
    assert.equal(s.selection.pointerId, 7);
    change(s);
    assert.equal(s.selection.preview.getSnapshot(), null);
    assert.equal(s.selection.pointerId, null);
    assert.equal(s.selection.commit(7, point(8, 8)), false);
    assert.deepEqual(s.selection.state.getSnapshot(), original);
    assert.deepEqual(documentState(s), before);
    s.dispose();
  }
  const s = setup();
  select(s);
  s.selection.begin(7, point(0, 0));
  s.selection.setIncluded(furniture, true);
  assert.equal(s.selection.pointerId, null);
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, house);
  s.selection.begin(7, point(0, 0));
  s.renameLayer(walls, "Changed during drag");
  assert.equal(s.selection.pointerId, null);
  s.dispose();
});

test("painting clears selection; gates/shortcuts and workspace disposal respect selection lifetime", () => {
  for (const tool of [
    "pencil",
    "eraser",
    "line",
    "rectangle",
    "fill",
  ] as const) {
    const s = setup();
    select(s);
    s.perform(tool);
    assert.equal(s.selection.state.getSnapshot(), null);
    s.dispose();
  }
  const s = setup();
  for (const owner of ["text", "panel", "outside"] as const)
    assert.equal(s.routeKey({ key: "v" }, owner), false);
  for (const input of [
    { key: "v", isComposing: true },
    { key: "v", metaKey: true },
    { key: "v", altKey: true },
  ])
    assert.equal(s.routeKey(input, "canvas"), false);
  assert.equal(s.routeKey({ key: "v" }, "canvas"), true);
  for (const gate of ["hidden", "overview", "loading"]) {
    if (gate === "hidden") s.setLayerVisible(walls, false);
    if (gate === "overview") s.viewport.set({ x: 0, y: 0, zoom: 0.1 });
    if (gate === "loading") s.canvasState.set("loading");
    assert.ok(s.action("select").reason);
    assert.equal(s.selection.begin(1, point(0, 0)), false);
    s.setLayerVisible(walls, true);
    s.viewport.set({ x: 0, y: 0, zoom: 1 });
    s.canvasState.set("ready");
  }
  select(s);
  assert.equal(s.selection.begin(1, point(62, 62)), true);
  assert.deepEqual(s.selection.state.getSnapshot()!.bounds, house);
  const workspace = new EditorWorkspace(s);
  workspace.createMap(128, 128);
  assert.equal(s.selection.state.getSnapshot(), null);
  assert.equal(s.selection.begin(1, point(0, 0)), false);
  assert.equal(
    workspace.state.getSnapshot().session.selection.state.getSnapshot(),
    null,
  );
  workspace.dispose();
});
