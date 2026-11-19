import assert from "node:assert/strict";
import test from "node:test";
import {
  DocumentLifecycle,
  type DocumentAction,
} from "../../src/editor/document-lifecycle.ts";
import {
  ProjectFiles,
  type ProjectFileBridge,
} from "../../src/editor/project-files.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { exampleProject } from "../fixtures/project.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness() {
  const workspace = new EditorWorkspace();
  let closes = 0;
  const writes: Uint8Array[] = [],
    picks: boolean[] = [];
  const bridge: ProjectFileBridge = {
    available: true,
    async choose(save) {
      picks.push(save);
      return { token: "file", path: "/maps/地図.tilewright" };
    },
    async read() {
      return new TextEncoder().encode(JSON.stringify(exampleProject));
    },
    async write(_token, bytes) {
      writes.push(bytes);
      return null;
    },
  };
  const files = new ProjectFiles(workspace, bridge);
  const lifecycle = new DocumentLifecycle(files);
  const start = (action: DocumentAction) =>
    action === "new"
      ? lifecycle.newMap(101, 130)
      : action === "open"
        ? lifecycle.open()
        : lifecycle.close(async () => {
            closes++;
          });
  const dispose = () => {
    lifecycle.dispose();
    files.dispose();
    workspace.dispose();
  };
  return {
    workspace,
    files,
    lifecycle,
    bridge,
    picks,
    writes,
    start,
    dispose,
    closes: () => closes,
  };
}

for (const action of ["new", "open", "close"] as const) {
  for (const choice of [
    "save",
    "discard",
    "cancel",
    "failed-save",
    "canceled-save",
  ] as const) {
    test(`${action}: ${choice} preserves or replaces exactly the authorized document`, async () => {
      const h = harness();
      const before = h.workspace.state.getSnapshot();
      before.session.renameLayer(
        before.session.document.layers[0].id,
        "Keep my work",
      );
      const history = before.session.history.state;
      if (choice === "failed-save")
        h.bridge.write = async () => {
          throw new Error("Disk full");
        };
      if (choice === "canceled-save") h.bridge.choose = async () => null;
      const pending = h.start(action);
      assert.equal(h.lifecycle.state.getSnapshot().prompt, action);
      assert.equal(await h.start(action), false); // no duplicate prompt/transition
      h.lifecycle.choose(
        choice === "failed-save" || choice === "canceled-save"
          ? "save"
          : choice,
      );
      const success = choice === "save" || choice === "discard";
      assert.equal(await pending, success);
      const after = h.workspace.state.getSnapshot();
      assert.equal(h.closes(), action === "close" && success ? 1 : 0);
      if (!success) {
        assert.equal(after, before);
        assert.deepEqual(after.session.history.state, history);
        assert.equal(after.session.document.layers[0].name, "Keep my work");
      } else if (action !== "close") {
        assert.notEqual(after.session, before.session);
        assert.equal(after.generation, before.generation + 1);
        assert.equal(after.session.history.state.undoSteps, 0);
        assert.equal(after.session.history.state.dirty, action === "new");
        assert.equal(
          after.savedPath,
          action === "new" ? null : "/maps/地図.tilewright",
        );
        assert.throws(() => before.session.captureProjectSnapshot(), /closed/);
      }
      if (choice === "save") {
        assert.equal(h.writes.length, 1);
        assert.equal(
          JSON.parse(new TextDecoder().decode(h.writes[0])).document.layers[0]
            .name,
          "Keep my work",
        );
      } else assert.equal(h.writes.length, 0);
      h.dispose();
    });
  }

  test(`${action}: edits during the requested save stay dirty and prevent destruction`, async () => {
    const h = harness();
    const session = h.workspace.state.getSnapshot().session;
    session.renameLayer(session.document.layers[0].id, "Saved revision");
    const savedRevision = session.history.state.revision;
    const pause = deferred<string | null>(),
      started = deferred<void>();
    h.bridge.write = async (_token, bytes) => {
      h.writes.push(bytes);
      started.resolve();
      return pause.promise;
    };
    const pending = h.start(action);
    h.lifecycle.choose("save");
    await started.promise;
    session.renameLayer(session.document.layers[0].id, "Later edit");
    pause.resolve(null);
    assert.equal(await pending, false);
    assert.equal(h.workspace.state.getSnapshot().session, session);
    assert.equal(session.history.state.savedRevision, savedRevision);
    assert.equal(session.history.state.dirty, true);
    assert.match(h.lifecycle.state.getSnapshot().error, /still unsaved/);
    assert.equal(h.closes(), 0);
    session.history.undo();
    assert.equal(session.history.state.dirty, false);
    session.history.redo();
    assert.equal(session.history.state.dirty, true);
    h.dispose();
  });

  test(`${action}: decisions cannot discard edits or a replacement made behind the prompt`, async () => {
    for (const replace of [false, true]) {
      const h = harness();
      const pending = h.start(action);
      if (replace) h.workspace.createMap(1, 1);
      else {
        const s = h.workspace.state.getSnapshot().session;
        s.renameLayer(s.document.layers[0].id, "Concurrent edit");
      }
      const before = h.workspace.state.getSnapshot();
      h.lifecycle.choose("discard");
      assert.equal(await pending, false);
      assert.equal(h.workspace.state.getSnapshot(), before);
      assert.equal(h.closes(), 0);
      h.dispose();
    }
  });
}

test("first save picks a path, ordinary saves reuse it, undo/redo reflects the saved checkpoint, New releases the association", async () => {
  const h = harness();
  const s = h.workspace.state.getSnapshot().session;
  s.renameLayer(s.document.layers[0].id, "Saved");
  assert.equal(await h.lifecycle.save(), true);
  s.renameLayer(s.document.layers[0].id, "Unsaved");
  s.history.undo();
  assert.equal(s.history.state.dirty, false);
  s.history.redo();
  assert.equal(s.history.state.dirty, true);
  await h.lifecycle.save();
  assert.deepEqual(h.picks, [true]);
  assert.equal(await h.lifecycle.newMap(32, 64), true); // clean, no prompt
  await h.lifecycle.save();
  assert.deepEqual(h.picks, [true, true]);
  h.dispose();
});

test("Open cancel/read/decode failures retain the current session even after saving or discarding", async () => {
  for (const choice of ["save", "discard"] as const)
    for (const fail of ["cancel", "read", "decode"]) {
      const h = harness();
      const session = h.workspace.state.getSnapshot().session;
      const choose = h.bridge.choose;
      h.bridge.choose = async (save) =>
        !save && fail === "cancel" ? null : choose(save);
      h.bridge.read = async () => {
        if (fail === "read") throw new Error("Unavailable path");
        return new TextEncoder().encode("{bad");
      };
      const pending = h.lifecycle.open();
      h.lifecycle.choose(choice);
      assert.equal(await pending, false);
      assert.equal(h.workspace.state.getSnapshot().session, session);
      assert.equal(session.history.state.dirty, choice !== "save");
      h.dispose();
    }
});

test("busy saves block replacement/close, disposal cancels prompts, and native close failures retain the document", async () => {
  const h = harness();
  const pause = deferred<string | null>(),
    started = deferred<void>();
  h.bridge.write = async () => {
    started.resolve();
    return pause.promise;
  };
  const saving = h.lifecycle.save();
  await started.promise;
  for (const action of ["new", "open", "close"] as const)
    assert.equal(await h.start(action), false);
  pause.resolve(null);
  assert.equal(await saving, true);
  assert.equal(
    await h.lifecycle.close(async () => {
      throw new Error("Native close failed");
    }),
    false,
  );
  assert.match(h.lifecycle.state.getSnapshot().error, /Native close failed/);
  assert.equal(await h.lifecycle.newMap(1, 1), true);
  const pending = h.lifecycle.open();
  h.lifecycle.dispose();
  assert.equal(await pending, false);
  h.dispose();
});

test("clean transitions recheck the document after the asynchronous guard boundary", async () => {
  const h = harness();
  await h.lifecycle.save();
  const pending = h.lifecycle.newMap(1, 1);
  const session = h.workspace.state.getSnapshot().session;
  session.renameLayer(session.document.layers[0].id, "New work");
  assert.equal(await pending, false);
  assert.equal(h.workspace.state.getSnapshot().session, session);
  h.dispose();
});
