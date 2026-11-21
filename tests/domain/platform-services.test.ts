import assert from "node:assert/strict";
import test from "node:test";
import { browserServices } from "../../src/platform/browser.ts";
import { createEditorApplication } from "../../src/platform/application.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { ProjectFiles } from "../../src/editor/project-files.ts";
import { projectDisplayName } from "../../src/editor/persistence.ts";
import { layerId } from "../../src/domain/values.ts";
import { exampleProject } from "../fixtures/project.ts";

const bytes = new TextEncoder().encode(JSON.stringify(exampleProject));

test("browser composition has no native bindings/recovery and unavailable actions preserve the workspace", async () => {
  let calls = 0;
  const unexpected = async (): Promise<never> => {
    calls++;
    throw new Error("Unavailable service called");
  };
  const app = createEditorApplication({
    ...browserServices,
    projectFiles: {
      available: false,
      choose: unexpected,
      read: unexpected,
      write: unexpected,
    },
  });
  try {
    const { lifecycle, workspace, actions } = app;
    assert.equal(app.platform.kind, "browser");
    assert.equal(app.platform.bindNative, undefined);
    assert.equal(lifecycle.files.recovery, undefined);
    assert.equal(app.recoveryBrowser, undefined);
    const state = workspace.state.getSnapshot();
    const history = state.session.history.state;
    for (const id of ["open", "save", "save-as", "export-agent"] as const)
      assert.equal(actions.state(id).enabled, false);
    assert.equal(await lifecycle.open(), false);
    assert.equal(await lifecycle.save(), false);
    assert.equal(await lifecycle.exportForAgent(), false);
    assert.equal(calls, 0);
    assert.equal(workspace.state.getSnapshot(), state);
    assert.deepEqual(state.session.history.state, history);
    assert.equal(lifecycle.files.lastSave.getSnapshot(), null);
    for (const choice of ["cancel", "save"] as const) {
      const pending = lifecycle.newMap(16, 16);
      assert.equal(lifecycle.state.getSnapshot().prompt, "new");
      lifecycle.choose(choice);
      assert.equal(await pending, false);
      assert.equal(workspace.state.getSnapshot(), state);
    }
    const pending = lifecycle.newMap(16, 16);
    lifecycle.choose("discard");
    assert.equal(await pending, true);
    assert.equal(workspace.state.getSnapshot().source, null);
    assert.equal(
      workspace.state.getSnapshot().session.document.bounds.maxX,
      16,
    );
  } finally {
    app.dispose();
  }
});

test("browser import names are detached display metadata, never native paths, saved receipts or recovery acknowledgements", async () => {
  const workspace = new EditorWorkspace();
  try {
    const source = {
      kind: "browser-file" as const,
      name: "café 地図.tilewright",
    };
    const opening = workspace.openProject(bytes, { source });
    source.name = "/maps/mutated.tilewright";
    await opening;
    const state = workspace.state.getSnapshot();
    assert.deepEqual(state.source, {
      kind: "browser-file",
      name: "café 地図.tilewright",
    });
    assert.equal(projectDisplayName(state.source), "café 地図.tilewright");
    assert.equal(state.savedPath, null);
    assert.equal(state.session.history.state.savedRevision, null);
    assert.equal(state.session.history.state.recoveryRevision, null);
    assert.equal(state.session.history.state.dirty, true);
    assert.deepEqual(
      state.session.captureProjectSnapshot().project,
      exampleProject,
    );
    const checkpoint = state.session.history.captureCheckpoint();
    state.session.history.markRecovery(checkpoint);
    assert.equal(state.session.history.state.dirty, true);
    assert.equal(state.session.history.state.savedRevision, null);
    await assert.rejects(
      workspace.openProject(bytes, {
        source: { kind: "browser-file", name: " " },
      }),
      /nonblank/,
    );
    await assert.rejects(
      workspace.openProject(bytes, {
        source: { kind: "browser-file", name: "map.tilewright" },
        savedPath: "/maps/project.tilewright",
      }),
      /not both/,
    );
    await assert.rejects(
      workspace.openProject(new TextEncoder().encode("broken"), {
        source: { kind: "browser-file", name: "bad.tilewright" },
      }),
    );
    assert.equal(workspace.state.getSnapshot(), state);
    workspace.createMap(32, 32);
    assert.equal(workspace.state.getSnapshot().source, null);
  } finally {
    workspace.dispose();
  }
});

test("native open/save retain opaque handle association and record only the written checkpoint", async () => {
  const workspace = new EditorWorkspace();
  let choices = 0;
  const files = new ProjectFiles(workspace, {
    available: true,
    async choose() {
      choices++;
      return { token: "native-grant", path: "/maps/native.tilewright" };
    },
    async read(token) {
      assert.equal(token, "native-grant");
      return bytes;
    },
    async write(token) {
      assert.equal(token, "native-grant");
      workspace.state
        .getSnapshot()
        .session.renameLayer(layerId("notes"), "Later edit");
      return "Directory sync warning";
    },
  });
  try {
    assert.equal(await files.open(), true);
    const state = workspace.state.getSnapshot();
    assert.deepEqual(state.source, {
      kind: "native-file",
      path: "/maps/native.tilewright",
    });
    assert.equal(state.session.history.state.dirty, false);
    assert.equal(files.lastSave.getSnapshot(), null); // A read is not a write receipt.
    assert.equal(await files.save(), true);
    const receipt = files.lastSave.getSnapshot()!;
    assert.equal(receipt.kind, "native-save");
    assert.equal(receipt.path, state.savedPath);
    assert.equal(receipt.session, state.session);
    assert.equal(receipt.checkpoint.revision, 0);
    assert.equal(choices, 1); // Save reuses the issued handle, not a display name.
    assert.equal(state.session.history.state.dirty, true);
    assert.match(files.state.getSnapshot().message, /Directory sync warning/);
  } finally {
    files.dispose();
    workspace.dispose();
  }
});
