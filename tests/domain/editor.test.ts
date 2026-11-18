import assert from "node:assert/strict";
import test from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { canvasInvalidation } from "../../src/editor/invalidation.ts";
import { screenToTile } from "../../src/editor/viewport.ts";
import { Store } from "../../src/editor/store.ts";
import { bindDocument } from "../../src/renderer/bindDocument.ts";

const base = layerId("base"),
  top = layerId("top");
function session() {
  return new EditorSession(
    new MapDocument({
      layers: [
        { id: base, name: "Terrain" },
        { id: top, name: "Buildings" },
      ],
    }),
  );
}
test("small edits publish history and exact canvas spans without changing React panel snapshots", () => {
  const editor = session();
  const stores = {
    layers: editor.layers,
    bounds: editor.bounds,
    registry: editor.registry,
    annotations: editor.annotations,
    activeLayer: editor.activeLayer,
    color: editor.color,
    viewport: editor.viewport,
    history: editor.historyState,
  };
  const counts: Record<string, number> = {};
  const disposers = Object.entries(stores).map(([key, store]) =>
    store.subscribe(() => {
      counts[key] = (counts[key] ?? 0) + 1;
    }),
  );
  const layers = editor.layers.getSnapshot();
  const changes: ReturnType<typeof canvasInvalidation>[] = [];
  editor.document.subscribe((change) =>
    changes.push(canvasInvalidation(change)),
  );
  assert.equal(
    editor.execute("Small edit", [
      {
        kind: "tiles",
        writes: [
          {
            layerId: top,
            x: 63,
            y: 64,
            length: 2,
            value: rawColor("#112233ff"),
          },
        ],
      },
    ]),
    true,
  );
  assert.deepEqual(counts, { history: 1 });
  assert.equal(editor.layers.getSnapshot(), layers);
  assert.deepEqual(changes[0], {
    regions: [{ layerId: top, minX: 63, minY: 64, maxX: 65, maxY: 65 }],
    composition: false,
    bounds: false,
    registryIds: [],
    annotationIds: [],
  });
  editor.perform("undo");
  editor.perform("redo");
  assert.deepEqual(changes[1], changes[0]);
  assert.deepEqual(changes[2], changes[0]);
  assert.deepEqual(counts, { history: 3 });
  for (const dispose of disposers) dispose();
  editor.dispose();
});

test("metadata updates target their panels and membership changes reconcile active layer", () => {
  const editor = session();
  editor.selectLayer(top);
  const kinds: string[] = [];
  editor.layers.subscribe(() => kinds.push("layers"));
  editor.registry.subscribe(() => kinds.push("registry"));
  editor.annotations.subscribe(() => kinds.push("annotations"));
  const changes: ReturnType<typeof canvasInvalidation>[] = [];
  editor.document.subscribe((change) =>
    changes.push(canvasInvalidation(change)),
  );
  editor.execute("Rename layer", [
    { kind: "rename-layer", id: top, name: "Structures" },
  ]);
  assert.deepEqual(kinds, ["layers"]);
  assert.equal(changes[0].composition, false);
  editor.execute("Metadata", [
    { kind: "registry", id: registryId("grass"), value: { name: "Grass" } },
    {
      kind: "annotation",
      id: annotationId("village"),
      value: { name: "Village" },
    },
  ]);
  assert.deepEqual(kinds, ["layers", "registry", "annotations"]);
  assert.deepEqual(changes[1].registryIds, ["grass"]);
  assert.deepEqual(changes[1].annotationIds, ["village"]);
  editor.execute("Remove layer", [{ kind: "remove-layer", id: top }]);
  assert.equal(editor.activeLayer.getSnapshot(), base);
  assert.equal(changes[2].composition, true);
  editor.perform("undo");
  assert.equal(editor.activeLayer.getSnapshot(), base);
  editor.dispose();
});

test("transient state never mutates the map or creates history", () => {
  const editor = session(),
    version = editor.document.version;
  editor.selectLayer(top);
  editor.setColor("#ABCDEF");
  editor.setZoom(2);
  editor.focus.set("text");
  editor.pointer.set({ x: 2, y: 3 });
  assert.equal(editor.color.getSnapshot(), "#abcdef");
  assert.equal(editor.document.version, version);
  assert.equal(editor.history.state.undoSteps, 0);
  assert.equal(editor.setColor("invalid"), false);
  assert.equal(editor.color.getSnapshot(), "#abcdef");
  editor.setZoom(NaN);
  assert.equal(editor.viewport.getSnapshot().zoom, 2);
  editor.dispose();
});

test("shared action routing preserves native text editing, IME, and disabled reasons", () => {
  const editor = session();
  assert.match(editor.action("undo").reason!, /no map edits/);
  editor.execute("Rename layer", [
    { kind: "rename-layer", id: base, name: "Land" },
  ]);
  for (const owner of ["text", "outside"] as const)
    assert.equal(editor.routeKey({ key: "z", metaKey: true }, owner), false);
  assert.equal(
    editor.routeKey({ key: "z", metaKey: true, isComposing: true }, "canvas"),
    false,
  );
  assert.equal(
    editor.routeKey(
      { key: "z", metaKey: true, defaultPrevented: true },
      "canvas",
    ),
    false,
  );
  assert.equal(editor.document.layers[0].name, "Land");
  assert.equal(editor.routeKey({ key: "z", metaKey: true }, "canvas"), true);
  assert.equal(editor.document.layers[0].name, "Terrain");
  assert.equal(
    editor.routeKey({ key: "Z", ctrlKey: true, shiftKey: true }, "panel"),
    true,
  );
  assert.equal(editor.document.layers[0].name, "Land");
  editor.routeKey({ key: "s", metaKey: true }, "canvas");
  assert.match(
    editor.feedback.getSnapshot().message,
    /saving is not available/,
  );
  assert.equal(editor.history.state.savedRevision, null);
  editor.dispose();
});

test("failed commands and committed observer failures share explicit feedback", () => {
  const editor = session();
  assert.equal(
    editor.execute("Rename layer", [
      { kind: "rename-layer", id: base, name: " " },
    ]),
    false,
  );
  assert.equal(editor.history.state.undoSteps, 0);
  assert.equal(editor.feedback.getSnapshot().kind, "error");
  const unsubscribe = editor.layers.subscribe(() => {
    throw new Error("broken panel");
  });
  assert.equal(
    editor.execute("Rename layer", [
      { kind: "rename-layer", id: base, name: "Land" },
    ]),
    true,
  );
  assert.equal(editor.history.state.undoSteps, 1);
  assert.match(
    editor.feedback.getSnapshot().message,
    /committed, but a view could not update/,
  );
  unsubscribe();
  editor.dispose();
  editor.dispose();
  assert.equal(editor.execute("Closed", []), false);
});

test("stable store snapshots, unsubscription, and observer isolation", () => {
  const store = new Store(0);
  let calls = 0;
  const unsubscribe = store.subscribe(() => {
    calls++;
  });
  store.set(0);
  assert.equal(calls, 0);
  store.set(1);
  assert.equal(calls, 1);
  unsubscribe();
  unsubscribe();
  store.set(2);
  assert.equal(calls, 1);
  store.subscribe(() => {
    throw new Error("broken");
  });
  store.subscribe(() => {
    calls++;
  });
  assert.throws(() => store.set(3), /subscriber failed/);
  assert.equal(calls, 2);
  assert.equal(store.getSnapshot(), 3);
});

test("CSS coordinate conversion is independent of backing resolution and viewport size", () => {
  for (const _dpr of [1, 2, 3]) {
    assert.deepEqual(
      screenToTile(24 + 63 * 24 + 12, 24 + 64 * 24 + 12, {
        x: 0,
        y: 0,
        zoom: 1,
      }),
      { x: 63, y: 64 },
    );
    assert.deepEqual(
      screenToTile(24 + 63 * 48 + 24, 24 + 64 * 48 + 24, {
        x: 0,
        y: 0,
        zoom: 2,
      }),
      { x: 63, y: 64 },
    );
  }
  assert.deepEqual(screenToTile(23, 23, { x: 0, y: 0, zoom: 1 }), {
    x: -1,
    y: -1,
  });
});

test("renderer bridge and session subscriptions detach when their owners close", () => {
  const editor = session();
  let calls = 0;
  const stop = bindDocument(editor, () => {
    calls++;
  });
  editor.execute("Rename", [{ kind: "rename-layer", id: base, name: "Land" }]);
  assert.equal(calls, 0); // A name change has no canvas regions.
  editor.execute("Grow", [
    { kind: "bounds", bounds: { minX: 0, minY: 0, maxX: 320, maxY: 256 } },
  ]);
  assert.equal(calls, 1);
  const history = editor.historyState.getSnapshot();
  stop();
  stop();
  editor.dispose();
  editor.history.undo();
  assert.equal(calls, 1);
  assert.equal(editor.historyState.getSnapshot(), history);
});

test("layer visibility stays transient, rejects unknown IDs and drops removed identities", () => {
  const document = new MapDocument({
    layers: [
      { id: layerId("base"), name: "Base" },
      { id: layerId("top"), name: "Top" },
    ],
  });
  const session = new EditorSession(document);
  const initialVersion = document.version;
  session.setLayerVisible(layerId("top"), false);
  const snapshot = session.hiddenLayers.getSnapshot();
  session.setLayerVisible(layerId("top"), false);
  assert.equal(session.hiddenLayers.getSnapshot(), snapshot);
  assert.equal(document.version, initialVersion);
  assert.equal(session.history.state.undoSteps, 0);
  assert.throws(() => session.setLayerVisible(layerId("unknown"), true));
  session.execute("Remove", [{ kind: "remove-layer", id: layerId("top") }]);
  assert.deepEqual(session.hiddenLayers.getSnapshot(), []);
  session.dispose();
  assert.throws(() => session.setLayerVisible(layerId("base"), false));
});
