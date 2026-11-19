import assert from "node:assert/strict";
import test from "node:test";
import {
  ProjectFiles,
  type ProjectFileBridge,
  type ProjectFileHandle,
} from "../../src/editor/project-files.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { exampleProject } from "../fixtures/project.ts";
import { layerId } from "../../src/domain/values.ts";

const bytes = new TextEncoder().encode(JSON.stringify(exampleProject));
const file = { token: "1", path: "/maps/café 地図.tilewright" };
const other = { token: "2", path: "/maps/Save As 地図.tilewright" };
function harness() {
  const workspace = new EditorWorkspace();
  const writes: { token: string; bytes: Uint8Array }[] = [];
  const picks: boolean[] = [];
  const bridge: ProjectFileBridge = {
    available: true,
    async choose(save) {
      picks.push(save);
      return file;
    },
    async read() {
      return bytes;
    },
    async write(token, data) {
      writes.push({ token, bytes: data.slice() });
      return null;
    },
  };
  const files = new ProjectFiles(workspace, bridge);
  const dispose = () => {
    files.dispose();
    workspace.dispose();
  };
  return { workspace, files, bridge, writes, picks, dispose };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function capture(workspace: EditorWorkspace) {
  const state = workspace.state.getSnapshot();
  return {
    state,
    history: state.session.history.state,
    project: state.session.captureProjectSnapshot().project,
  };
}
function unchanged(
  workspace: EditorWorkspace,
  before: ReturnType<typeof capture>,
) {
  const after = capture(workspace);
  assert.equal(after.state, before.state);
  assert.deepEqual(after.history, before.history);
  assert.deepEqual(after.project, before.project);
}

test("Open installs a complete file; Save always persists preferences and Save As switches only on successful write", async () => {
  const h = harness();
  assert.equal(await h.files.open(), true);
  const state = h.workspace.state.getSnapshot();
  assert.equal(state.savedPath, file.path);
  assert.deepEqual(
    state.session.captureProjectSnapshot().project,
    exampleProject,
  );
  assert.equal(state.session.history.state.dirty, false);
  state.session.setLayerVisible(layerId("buildings"), true);
  assert.equal(await h.files.save(), true);
  assert.deepEqual(h.picks, [false]);
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(h.writes[0].bytes)).editor
      .hiddenLayerIds,
    [],
  );
  state.session.renameLayer(layerId("notes"), "Changed");
  const pending = deferred<string | null>();
  const started = deferred<void>();
  h.bridge.choose = async () => other;
  h.bridge.write = async () => {
    started.resolve();
    return pending.promise;
  };
  const saving = h.files.save(true);
  await started.promise;
  assert.equal(h.workspace.state.getSnapshot().savedPath, file.path);
  assert.equal(state.session.history.state.dirty, true);
  pending.resolve(null);
  assert.equal(await saving, true);
  assert.equal(h.workspace.state.getSnapshot().savedPath, other.path);
  assert.equal(state.session.history.state.dirty, false);
  h.dispose();
});

test("canceled Open, initial Save and Save As preserve document, path, history, redo and dirty state", async () => {
  const h = harness();
  h.bridge.choose = async () => null;
  const blank = capture(h.workspace);
  assert.equal(await h.files.save(), false);
  unchanged(h.workspace, blank);
  assert.equal(h.writes.length, 0);
  h.bridge.choose = async () => file;
  await h.files.open();
  const s = h.workspace.state.getSnapshot().session;
  s.renameLayer(layerId("notes"), "Changed");
  s.renameLayer(layerId("notes"), "Redo");
  s.history.undo();
  s.history.markRecovery(s.history.captureCheckpoint());
  const before = capture(h.workspace);
  h.bridge.choose = async () => null;
  assert.equal(await h.files.open(), false);
  unchanged(h.workspace, before);
  assert.equal(await h.files.save(true), false);
  unchanged(h.workspace, before);
  assert.equal(h.writes.length, 0);
  h.dispose();
});

test("injected read, write, rename and picker errors preserve active state and report errors; invalid decoding cannot install a path", async () => {
  for (const failure of ["read", "write", "rename", "picker", "decode"]) {
    const h = harness();
    await h.files.open();
    const s = h.workspace.state.getSnapshot().session;
    s.renameLayer(layerId("notes"), "Unsaved work");
    const before = capture(h.workspace);
    h.bridge.choose = async () => other;
    if (failure === "read")
      h.bridge.read = async () => {
        throw "Could not read: unavailable path. Reconnect the drive.";
      };
    if (failure === "decode")
      h.bridge.read = async () => new TextEncoder().encode("{broken");
    if (failure === "picker")
      h.bridge.choose = async () => {
        throw new Error("Permission denied. Choose another folder.");
      };
    if (failure === "write" || failure === "rename")
      h.bridge.write = async () => {
        throw new Error(`Could not ${failure}. Check folder permissions.`);
      };
    assert.equal(
      await (failure === "read" || failure === "decode"
        ? h.files.open()
        : h.files.save(true)),
      false,
    );
    unchanged(h.workspace, before);
    assert.equal(h.files.state.getSnapshot().error, true);
    assert.ok(h.files.state.getSnapshot().message.length > 10);
    h.dispose();
  }
});

test("save captures before a picker/write yield, serializes requests and marks only the captured revision", async () => {
  const h = harness();
  const s = h.workspace.state.getSnapshot().session;
  const snapshot = s.captureProjectSnapshot();
  const picked = deferred<ProjectFileHandle | null>();
  h.bridge.choose = async () => picked.promise;
  const saving = h.files.save();
  s.renameLayer(s.document.layers[0].id, "After capture");
  assert.equal(await h.files.save(), false);
  assert.equal(await h.files.open(), false);
  picked.resolve(file);
  assert.equal(await saving, true);
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(h.writes[0].bytes)),
    snapshot.project,
  );
  assert.equal(s.history.state.savedRevision, snapshot.checkpoint.revision);
  assert.equal(s.history.state.dirty, true);
  s.history.undo();
  assert.equal(s.history.state.dirty, false);
  h.dispose();
});

test("workspace changes while choosing or reading supersede Open without losing intervening edits", async () => {
  for (const phase of ["choose", "read"]) {
    const h = harness();
    const pause = deferred<void>();
    const started = deferred<void>();
    if (phase === "choose")
      h.bridge.choose = async () => {
        started.resolve();
        await pause.promise;
        return file;
      };
    else
      h.bridge.read = async () => {
        started.resolve();
        await pause.promise;
        return bytes;
      };
    const opening = h.files.open();
    await started.promise;
    const s = h.workspace.state.getSnapshot().session;
    s.renameLayer(s.document.layers[0].id, "Keep concurrent work");
    const before = capture(h.workspace);
    pause.resolve();
    assert.equal(await opening, false);
    unchanged(h.workspace, before);
    assert.match(h.files.state.getSnapshot().message, /workspace changed/);
    h.dispose();
  }
});

test("replacement during Save cannot acknowledge new history or associate the old file; new Save asks again", async () => {
  const h = harness();
  const started = deferred<void>();
  const pause = deferred<string | null>();
  h.bridge.write = async () => {
    started.resolve();
    return pause.promise;
  };
  const saving = h.files.save();
  await started.promise;
  h.workspace.createMap(101, 130);
  const before = capture(h.workspace);
  pause.resolve(null);
  assert.equal(await saving, true);
  unchanged(h.workspace, before);
  assert.match(h.files.state.getSnapshot().message, /earlier map/);
  assert.equal(await h.files.save(), true);
  assert.deepEqual(h.picks, [true, true]);
  h.dispose();
});

test("invalid capture and replaced/closed workspaces never write a candidate", async () => {
  const h = harness();
  const pending = deferred<ProjectFileHandle | null>();
  h.bridge.choose = async () => pending.promise;
  const saving = h.files.save();
  h.workspace.createMap(1, 1);
  pending.resolve(file);
  assert.equal(await saving, false);
  assert.equal(h.writes.length, 0);
  h.files.dispose();
  assert.equal(await h.files.save(), false);
  h.workspace.dispose();
});

test("post-commit observer and durability warnings stay successful with the correct saved checkpoint and path", async () => {
  const h = harness();
  h.bridge.write = async () =>
    "Directory durability could not be confirmed; retry Save.";
  h.workspace.state.subscribe(() => {
    throw new Error("failed interface");
  });
  h.files.state.subscribe(() => {
    throw new Error("failed feedback view");
  });
  assert.equal(await h.files.save(), true);
  assert.equal(h.workspace.state.getSnapshot().savedPath, file.path);
  assert.equal(
    h.workspace.state.getSnapshot().session.history.state.dirty,
    false,
  );
  assert.equal(h.files.state.getSnapshot().error, false);
  assert.match(h.files.state.getSnapshot().message, /durability/);
  assert.match(h.files.state.getSnapshot().message, /observers/);
  h.dispose();
});
