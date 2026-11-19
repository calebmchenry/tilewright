import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureAgentExportSnapshot,
  encodeAgentExportSnapshot,
  type AgentExportSnapshot,
} from "../../src/domain/agent-export.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { MapDocument } from "../../src/domain/document.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import { OverviewCache, overviewRegions } from "../../src/renderer/overview.ts";
import {
  agentExampleDocument,
  exampleAgentMap,
} from "../fixtures/agent-export.ts";

const text = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const encoded = async (snapshot: AgentExportSnapshot) =>
  text(
    await encodeAgentExportSnapshot(snapshot, { yieldControl: async () => {} }),
  );

test("async export stays at one committed revision through recoloring, all metadata changes, edits and undo/redo", async () => {
  const history = new CommandHistory(agentExampleDocument());
  history.execute("Long description", [
    {
      kind: "annotation",
      id: annotationId("house"),
      value: {
        ...history.document.getAnnotation(annotationId("house"))!,
        description: "😀\n".repeat(100000),
      },
    },
  ]);
  history.markSaved(history.captureCheckpoint());
  history.markRecovery(history.captureCheckpoint());
  const snapshot = captureAgentExportSnapshot(history),
    expected = await encoded(snapshot);
  let yields = 0;
  const bytes = await encodeAgentExportSnapshot(snapshot, {
    yieldControl: async () => {
      if (++yields === 1) {
        const registry = new RegistryCommands(history);
        registry.commit(
          registry.prepare({
            kind: "edit",
            id: registryId("grass"),
            name: "Meadow",
            color: "#335c46",
          }),
        );
        history.execute("Concurrent map revision", [
          {
            kind: "bounds",
            bounds: { minX: -64, minY: -64, maxX: 6400, maxY: 6400 },
          },
          {
            kind: "rename-layer",
            id: layerId("terrain"),
            name: "Changed terrain",
          },
          { kind: "annotation", id: annotationId("house"), value: null },
          { kind: "registry", id: registryId("water"), value: null },
          {
            kind: "tiles",
            writes: [
              {
                layerId: layerId("terrain"),
                x: 4,
                y: 3,
                length: 1,
                value: rawColor("#abcdef80"),
              },
            ],
          },
          { kind: "remove-layer", id: layerId("buildings") },
          {
            kind: "add-layer",
            layer: { id: layerId("new"), name: "New layer" },
          },
          { kind: "reorder-layers", ids: [layerId("new"), layerId("terrain")] },
        ]);
      } else if (yields === 2) history.undo();
      else if (yields === 3) history.redo();
    },
  });
  assert.ok(yields > 3);
  assert.equal(text(bytes), expected);
  assert.equal(snapshot.checkpoint.revision, 1);
  assert.equal(history.state.revision, 3);
  assert.equal(history.state.savedRevision, 1);
  assert.equal(history.state.recoveryRevision, 1);
  assert.equal(history.state.dirty, true);
  assert.notEqual(await encoded(captureAgentExportSnapshot(history)), expected);
});

test("default encoding scheduler allows real timer edits without changing captured bytes or acknowledging saves", async () => {
  const history = new CommandHistory(agentExampleDocument());
  const snapshot = captureAgentExportSnapshot(history);
  let edited = false;
  const edit = new Promise<void>((resolve) =>
    setTimeout(() => {
      history.execute("Later revision", [
        { kind: "rename-layer", id: layerId("terrain"), name: "Later" },
      ]);
      edited = true;
      resolve();
    }, 0),
  );
  const bytes = await encodeAgentExportSnapshot(snapshot);
  assert.ok(edited);
  await edit;
  assert.deepEqual(JSON.parse(text(bytes)), exampleAgentMap);
  assert.equal(history.state.savedRevision, null);
  assert.equal(history.state.recoveryRevision, null);
});

test("viewport, active/hidden layers, selections, clipboard, previews, drafts and filename never limit export", async () => {
  const session = new EditorSession(agentExampleDocument());
  const workspace = new EditorWorkspace(session);
  session.canvasState.set("ready");
  const initial = await encoded(session.captureAgentExportSnapshot());
  assert.equal(workspace.state.getSnapshot().savedPath, null);
  assert.equal(session.history.state.dirty, true);
  session.perform("pencil");
  const point = (x: number, y: number) =>
    tileToScreen(x, y, session.viewport.getSnapshot());
  session.drawing.begin(1, point(4, 3));
  const drawingPreview = session.drawing.preview.getSnapshot();
  assert.ok(drawingPreview);
  assert.equal(await encoded(session.captureAgentExportSnapshot()), initial);
  assert.equal(session.drawing.preview.getSnapshot(), drawingPreview);
  session.drawing.cancel();
  session.perform("select");
  session.selection.begin(2, point(0, 0));
  session.selection.commit(2, point(1, 1));
  session.perform("copy");
  assert.ok(session.selection.clipboard.getSnapshot());
  for (const preview of ["move", "transform", "paste"]) {
    if (preview === "move") {
      session.selection.begin(3, point(0, 0));
      session.selection.sample(3, point(1, 0));
    } else if (preview === "transform") session.perform("rotate-clockwise");
    else {
      session.pointer.set({ x: 2, y: 2 });
      session.perform("paste");
    }
    const overlay = session.selection.preview.getSnapshot();
    assert.ok(overlay, preview);
    assert.equal(await encoded(session.captureAgentExportSnapshot()), initial);
    assert.equal(session.selection.preview.getSnapshot(), overlay);
    session.selection.cancel();
  }
  session.areas.select(annotationId("house"));
  session.areas.update({
    name: "Unapplied draft",
    description: "Do not export",
  });
  const draft = session.areas.draft.getSnapshot();
  for (const zoom of [1, 0.1, 0.001]) {
    session.viewport.set({ x: 9999, y: -9999, zoom });
    for (const active of session.document.layers) {
      session.selectLayer(active.id);
      for (const hidden of [
        [],
        [layerId("buildings")],
        session.document.layers.map((layer) => layer.id),
      ]) {
        for (const layer of session.document.layers)
          session.setLayerVisible(layer.id, !hidden.includes(layer.id));
        assert.equal(
          await encoded(session.captureAgentExportSnapshot()),
          initial,
        );
      }
    }
  }
  assert.equal(session.areas.draft.getSnapshot(), draft);
  assert.equal(session.history.state.revision, 0);
  assert.equal(workspace.state.getSnapshot().savedPath, null);
  workspace.acknowledgeProjectSave(
    session,
    "/maps/meaning.tilewright",
    session.history.captureCheckpoint(),
  );
  session.history.markRecovery(session.history.captureCheckpoint());
  session.renameLayer(layerId("terrain"), "Temporary");
  session.history.undo();
  const before = session.history.state,
    workspaceBefore = workspace.state.getSnapshot();
  assert.equal(before.redoSteps, 1);
  assert.equal(before.dirty, false);
  assert.equal(await encoded(session.captureAgentExportSnapshot()), initial);
  assert.deepEqual(session.history.state, before);
  assert.equal(workspace.state.getSnapshot(), workspaceBefore);
  workspace.dispose();
  assert.throws(() => session.captureAgentExportSnapshot(), /closed/);
});

test("empty, pending, warm, stale and destroyed overview caches cannot affect semantic bytes", async () => {
  const session = new EditorSession(agentExampleDocument());
  const expected = await encoded(session.captureAgentExportSnapshot());
  const jobs = new Set<() => void>();
  const cache = new OverviewCache(session.document, {
    now: () => 0,
    schedule: (work) => {
      jobs.add(work);
      return () => {
        jobs.delete(work);
      };
    },
    expire: () => () => {},
    publish: () => {},
    release: () => {},
    changed: () => {},
    error: (error) => {
      throw error;
    },
  });
  const regions = overviewRegions(
    session.document.bounds,
    { x: 0, y: 0, zoom: 0.01 },
    100,
    100,
  );
  assert.equal(await encoded(session.captureAgentExportSnapshot()), expected);
  cache.sync(regions, []);
  assert.ok(jobs.size);
  assert.equal(await encoded(session.captureAgentExportSnapshot()), expected);
  while (jobs.size) {
    const work = jobs.values().next().value!;
    jobs.delete(work);
    work();
  }
  const entries = [...cache.entries];
  assert.ok(entries.some((entry) => entry.ready && entry.pixels));
  for (const entry of entries) entry.pixels?.fill(0);
  assert.equal(await encoded(session.captureAgentExportSnapshot()), expected);
  cache.sync(
    regions,
    session.document.layers.map((layer) => layer.id),
  );
  assert.ok([...cache.entries].some((entry) => entry.dirty));
  assert.equal(await encoded(session.captureAgentExportSnapshot()), expected);
  cache.destroy();
  assert.equal(await encoded(session.captureAgentExportSnapshot()), expected);
  session.dispose();
});

test("capture rejects unpublished transactions, observer reentrancy and out-of-history edits", () => {
  const document = new MapDocument(),
    history = new CommandHistory(document);
  const capture = () => captureAgentExportSnapshot(history);
  const command = {
    kind: "tiles" as const,
    writes: [
      {
        layerId: document.layers[0].id,
        x: 0,
        y: 0,
        length: 1,
        value: rawColor("#000000ff"),
      },
    ],
  };
  assert.throws(
    () =>
      document.applyCommands([command], () => {
        assert.throws(capture, /busy/);
        throw new Error("Rollback");
      }),
    /Rollback/,
  );
  assert.equal(capture().checkpoint.revision, 0);
  const unsubscribe = document.subscribe(() => assert.throws(capture, /busy/));
  assert.deepEqual(history.execute("Commit", [command]).observerErrors, []);
  unsubscribe();
  document.setCell(document.layers[0].id, 1, 0, rawColor("#ffffffff"));
  assert.throws(capture, /outside command history/);
});
