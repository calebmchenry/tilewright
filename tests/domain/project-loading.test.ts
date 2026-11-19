import assert from "node:assert/strict";
import test from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { encodeProjectSnapshot } from "../../src/domain/project.ts";
import { ProjectDecodingError } from "../../src/domain/project-format.ts";
import { layerId } from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import {
  exampleProject,
  populatedProjectDocument,
} from "../fixtures/project.ts";
import { FIXTURES } from "../fixtures/maps.ts";

const fast = { yieldControl: async () => {} };
const input = new TextEncoder().encode(JSON.stringify(exampleProject));
const options = { ...fast, savedPath: "/maps/original.tilewright" };
const kind =
  (category: ProjectDecodingError["category"]) => (error: unknown) => {
    assert.ok(error instanceof ProjectDecodingError);
    assert.equal(error.category, category);
    return true;
  };

async function workingMap(dirty = true) {
  const workspace = new EditorWorkspace();
  await workspace.openProject(input, options);
  const session = workspace.state.getSnapshot().session;
  session.canvasState.set("ready");
  session.setLayerVisible(layerId("buildings"), true);
  if (dirty) session.renameLayer(layerId("notes"), "Unsaved name");
  session.renameLayer(layerId("notes"), "Redo name");
  session.history.undo();
  session.history.markRecovery(session.history.captureCheckpoint());
  session.perform("select");
  const point = (x: number, y: number) =>
    tileToScreen(x, y, session.viewport.getSnapshot());
  assert.equal(session.selection.begin(1, point(60, 60)), true);
  assert.equal(session.selection.commit(1, point(67, 67)), true);
  assert.equal(session.perform("copy"), true);
  session.areas.newArea();
  session.areas.update({ name: "Uncommitted area" });
  session.setColor("#123456");
  session.setPencilSize(4);
  session.focus.set("text");
  assert.equal(session.history.state.dirty, dirty);
  assert.equal(session.history.state.redoSteps, 1);
  return workspace;
}
function capture(workspace: EditorWorkspace) {
  const state = workspace.state.getSnapshot(),
    session = state.session;
  return {
    state,
    content: session.captureProjectSnapshot().project,
    history: session.history.state,
    selection: session.selection.state.getSnapshot(),
    clipboard: session.selection.clipboard.getSnapshot(),
    preview: session.selection.preview.getSnapshot(),
    draft: session.areas.draft.getSnapshot(),
    viewport: session.viewport.getSnapshot(),
    active: session.activeLayer.getSnapshot(),
    hidden: session.hiddenLayers.getSnapshot(),
    tool: session.activeTool.getSnapshot(),
    feedback: session.feedback.getSnapshot(),
  };
}
function unchanged(
  workspace: EditorWorkspace,
  before: ReturnType<typeof capture>,
) {
  const after = capture(workspace);
  assert.equal(after.state, before.state);
  assert.deepEqual(after.content, before.content);
  assert.deepEqual(after.history, before.history);
  for (const key of [
    "selection",
    "clipboard",
    "preview",
    "draft",
    "viewport",
    "active",
    "hidden",
    "tool",
    "feedback",
  ] as const)
    assert.equal(after[key], before[key]);
}

test("failed and canceled loads preserve content, history/redo/checkpoints, path, dirty state and transient work", async (t) => {
  for (const dirty of [false, true]) {
    const workspace = await workingMap(dirty);
    const before = capture(workspace);
    let notifications = 0;
    workspace.state.subscribe(() => notifications++);
    const corrupt = [
      new Uint8Array([0xff]),
      input.subarray(0, input.length - 2),
      new TextEncoder().encode(
        JSON.stringify({ ...exampleProject, version: 99 }),
      ),
      new TextEncoder().encode(
        JSON.stringify({
          ...exampleProject,
          editor: { activeLayerId: "missing", hiddenLayerIds: [] },
        }),
      ),
    ];
    for (const data of corrupt) {
      await assert.rejects(
        workspace.openProject(data, {
          ...options,
          savedPath: "/maps/bad.tilewright",
        }),
        ProjectDecodingError,
      );
      unchanged(workspace, before);
    }
    await assert.rejects(
      workspace.openProject(input, {
        ...options,
        limits: { maxOccupiedCells: 1 },
      }),
      kind("capacity"),
    );
    unchanged(workspace, before);
    await assert.rejects(
      workspace.openProject(input, { ...options, signal: { aborted: true } }),
      kind("canceled"),
    );
    unchanged(workspace, before);
    const signal = { aborted: false };
    await assert.rejects(
      workspace.openProject(input, {
        ...options,
        signal,
        yieldControl: async () => {
          signal.aborted = true;
        },
      }),
      kind("canceled"),
    );
    unchanged(workspace, before);
    await assert.rejects(
      workspace.openProject(input, {
        ...options,
        yieldControl: async () => {
          throw new Error("scheduler failed");
        },
      }),
      /scheduler failed/,
    );
    unchanged(workspace, before);
    const mock = t.mock.method(MapDocument.prototype, "writeBatch", () => {
      throw new Error("construction failed");
    });
    await assert.rejects(
      workspace.openProject(input, options),
      kind("construction"),
    );
    mock.mock.restore();
    unchanged(workspace, before);
    // Failure after decoding, while preparing subscriptions for the fresh session.
    const subscribe = MapDocument.prototype.subscribe;
    const sessionFailure = t.mock.method(
      MapDocument.prototype,
      "subscribe",
      function (
        this: MapDocument,
        listener: Parameters<MapDocument["subscribe"]>[0],
      ) {
        if (this !== before.state.session.document)
          throw new Error("session construction failed");
        return subscribe.call(this, listener);
      },
    );
    await assert.rejects(
      workspace.openProject(input, options),
      kind("construction"),
    );
    sessionFailure.mock.restore();
    unchanged(workspace, before);
    assert.equal(notifications, 0);
    before.state.session.history.redo();
    assert.equal(before.state.session.document.layers[2].name, "Redo name");
    before.state.session.history.undo();
    assert.equal(workspace.state.getSnapshot(), before.state);
    assert.deepEqual(before.state.session.history.state, before.history);
    assert.deepEqual(
      before.state.session.captureProjectSnapshot().project,
      before.content,
    );
    workspace.dispose();
  }
});

test("successful load publishes one complete saved session/path, preserves hidden active layer and clears transient state", async () => {
  const workspace = await workingMap();
  const old = workspace.state.getSnapshot();
  const observations: ReturnType<EditorWorkspace["state"]["getSnapshot"]>[] =
    [];
  workspace.state.subscribe(() => {
    const state = workspace.state.getSnapshot();
    observations.push(state);
    assert.deepEqual(
      state.session.captureProjectSnapshot().project,
      exampleProject,
    );
    assert.equal(state.session.history.state.dirty, false);
    assert.equal(state.savedPath, "/maps/reopened.tilewright");
  });
  const result = await workspace.openProject(input, {
    ...options,
    savedPath: "/maps/reopened.tilewright",
  });
  assert.deepEqual(result.observerErrors, []);
  assert.equal(observations.length, 1);
  const state = workspace.state.getSnapshot(),
    session = state.session;
  assert.equal(result.session, session);
  assert.equal(state.generation, old.generation + 1);
  assert.notEqual(session.document, old.session.document);
  assert.throws(() => old.session.captureProjectSnapshot(), /closed/);
  assert.equal(session.activeLayer.getSnapshot(), "buildings");
  assert.deepEqual(session.hiddenLayers.getSnapshot(), ["buildings"]);
  assert.deepEqual(session.history.state, {
    revision: 0,
    savedRevision: 0,
    recoveryRevision: null,
    dirty: false,
    undoSteps: 0,
    redoSteps: 0,
    retainedBytes: 0,
    undoLabel: null,
    redoLabel: null,
  });
  assert.equal(session.selection.state.getSnapshot(), null);
  assert.equal(session.selection.clipboard.getSnapshot(), null);
  assert.equal(session.selection.preview.getSnapshot(), null);
  assert.equal(session.areas.draft.getSnapshot(), null);
  assert.equal(session.activeTool.getSnapshot(), "inspect");
  assert.equal(session.color.getSnapshot(), "#91baa1ff");
  assert.equal(session.pencilSize.getSnapshot(), 1);
  assert.equal(session.focus.getSnapshot(), "outside");
  session.setCanvasSize(1024, 640);
  assert.ok(session.viewport.getSnapshot().zoom < 1);
  const fitted = session.viewport.getSnapshot();
  session.setCanvasSize(800, 600);
  assert.equal(session.viewport.getSnapshot(), fitted);
  session.renameLayer(layerId("notes"), "Continue editing");
  assert.equal(session.history.state.dirty, true);
  session.history.undo();
  assert.equal(session.history.state.dirty, false);
  workspace.dispose();
});

test("intervening edits, undo, preferences, checkpoint acknowledgement, New Map and closure supersede pending loads", async () => {
  const actions: ((workspace: EditorWorkspace) => void)[] = [
    (w) => {
      w.state
        .getSnapshot()
        .session.renameLayer(layerId("notes"), "Concurrent edit");
    },
    (w) => {
      const s = w.state.getSnapshot().session;
      s.history.redo();
      s.history.undo();
    },
    (w) => {
      w.state.getSnapshot().session.selectLayer(layerId("notes"));
    },
    (w) => {
      w.state.getSnapshot().session.setLayerVisible(layerId("terrain"), false);
    },
    (w) => {
      const s = w.state.getSnapshot().session;
      s.history.markSaved(s.history.captureCheckpoint());
    },
    (w) => w.createMap(101, 130),
  ];
  for (const action of actions) {
    const workspace = await workingMap();
    let changed: ReturnType<typeof capture> | undefined;
    await assert.rejects(
      workspace.openProject(input, {
        ...options,
        yieldControl: async () => {
          if (!changed) {
            action(workspace);
            changed = capture(workspace);
          }
        },
      }),
      kind("superseded"),
    );
    unchanged(workspace, changed!);
    workspace.dispose();
  }
  const workspace = await workingMap();
  await assert.rejects(
    workspace.openProject(input, {
      ...options,
      yieldControl: async () => workspace.dispose(),
    }),
    kind("superseded"),
  );
  await assert.rejects(workspace.openProject(input, options), /closed/);
});

test("latest overlapping request wins and old candidates cannot overwrite it", async () => {
  const workspace = await workingMap();
  let release!: () => void;
  let started!: () => void;
  const atPause = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = workspace.openProject(input, {
    ...options,
    savedPath: "/maps/first.tilewright",
    yieldControl: async () => {
      started();
      await blocked;
    },
  });
  const rejected = assert.rejects(first, kind("superseded"));
  await atPause;
  await workspace.openProject(input, {
    ...options,
    savedPath: "/maps/second.tilewright",
  });
  const after = capture(workspace);
  release();
  await rejected;
  unchanged(workspace, after);
  assert.equal(after.state.savedPath, "/maps/second.tilewright");
  workspace.createMap(1, 1);
  assert.equal(workspace.state.getSnapshot().savedPath, null);
  assert.equal(workspace.state.getSnapshot().session.history.state.dirty, true);
  workspace.dispose();
});

test("observer failures after publication are reported as successful installation, without reentrant replacement", async () => {
  const workspace = await workingMap();
  const old = workspace.state.getSnapshot().session;
  let delivered = false;
  workspace.state.subscribe(() => {
    throw new Error("view failed");
  });
  workspace.state.subscribe(() => {
    workspace.createMap(1, 1);
  });
  workspace.state.subscribe(() => {
    delivered = true;
  });
  const result = await workspace.openProject(input, options);
  assert.equal(result.observerErrors.length, 2);
  assert.equal(delivered, true);
  assert.equal(workspace.state.getSnapshot().session, result.session);
  assert.equal(result.session.document.storageStats().occupiedCells, 16);
  assert.throws(() => old.captureProjectSnapshot(), /closed/);
  workspace.dispose();
});

test("default scheduling allows cancellation from a real timer without changing the workspace", async () => {
  const workspace = await workingMap();
  const before = capture(workspace),
    controller = new AbortController();
  const pending = workspace.openProject(input, {
    savedPath: "/maps/canceled.tilewright",
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 0);
  await assert.rejects(pending, kind("canceled"));
  unchanged(workspace, before);
  workspace.dispose();
});

test("a complete representative document opens in the workspace with exact model equality", async (t) => {
  const source = new EditorSession(populatedProjectDocument(FIXTURES[0]));
  source.selectLayer(layerId("buildings"));
  source.setLayerVisible(layerId("terrain"), false);
  source.setLayerVisible(layerId("buildings"), false);
  const snapshot = source.captureProjectSnapshot();
  const data = await encodeProjectSnapshot(snapshot, fast);
  const workspace = new EditorWorkspace();
  const start = performance.now();
  const result = await workspace.openProject(data, {
    ...options,
    savedPath: "/maps/frontier.tilewright",
  });
  assert.deepEqual(
    result.session.captureProjectSnapshot().project,
    snapshot.project,
  );
  assert.equal(result.session.document.storageStats().occupiedCells, 6620700);
  assert.equal(result.session.history.state.dirty, false);
  assert.equal(result.session.history.state.retainedBytes, 0);
  t.diagnostic(
    `Full frontier workspace open: ${(performance.now() - start).toFixed(3)} ms, ${data.length} bytes; model equality includes all layers/registry/1,089 areas/preferences.`,
  );
  workspace.dispose();
  source.dispose();
});
