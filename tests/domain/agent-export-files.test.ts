import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentExports,
  type AgentExportBridge,
} from "../../src/editor/agent-export.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { encodeAgentExportSnapshot } from "../../src/domain/agent-export.ts";
import {
  agentExampleDocument,
  populatedAgentDocument,
} from "../fixtures/agent-export.ts";
import { FIXTURES } from "../fixtures/maps.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function harness(encode = encodeAgentExportSnapshot) {
  const session = new EditorSession(agentExampleDocument());
  const workspace = new EditorWorkspace(session);
  workspace.acknowledgeProjectSave(
    session,
    "/maps/original.tilewright",
    session.history.captureCheckpoint(),
  );
  session.renameLayer(session.document.layers[0].id, "Unsaved terrain");
  session.history.markRecovery(session.history.captureCheckpoint());
  const original = new Uint8Array([1, 2, 3]);
  const disk = new Map<string, Uint8Array>([
    ["/maps/original.tilewright", original],
  ]);
  let pending: Uint8Array | null = null;
  const calls: string[] = [];
  const bridge: AgentExportBridge = {
    available: true,
    async choose(protectedPath, suggestedName) {
      calls.push("choose");
      assert.equal(protectedPath, "/maps/original.tilewright");
      assert.equal(suggestedName, "original.agent-map.json");
      return { token: "agent-1", path: "/maps/output.agent-map.json" };
    },
    async prepare(_token, bytes) {
      calls.push("prepare");
      pending = bytes.slice();
    },
    async commit() {
      calls.push("commit");
      assert.ok(pending);
      disk.set("/maps/output.agent-map.json", pending);
      pending = null;
      return null;
    },
    async cancel() {
      calls.push("cancel");
      pending = null;
    },
  };
  const exports = new AgentExports(workspace, bridge, { encode });
  const before = {
    workspace: workspace.state.getSnapshot(),
    history: session.history.state,
    project: session.captureProjectSnapshot().project,
  };
  const unchanged = () => {
    assert.equal(workspace.state.getSnapshot(), before.workspace);
    assert.deepEqual(session.history.state, before.history);
    assert.deepEqual(session.captureProjectSnapshot().project, before.project);
    assert.equal(disk.get("/maps/original.tilewright"), original);
  };
  const dispose = () => {
    exports.dispose();
    workspace.dispose();
  };
  return {
    session,
    workspace,
    exports,
    bridge,
    disk,
    calls,
    unchanged,
    dispose,
    pending: () => pending,
  };
}
test("unsaved committed whole map exports without changing path, save/recovery checkpoints, history or original bytes", async () => {
  const h = harness();
  const expected = h.session.captureAgentExportSnapshot().map;
  h.disk.set("/maps/output.agent-map.json", new Uint8Array([9]));
  assert.equal(await h.exports.export(), true);
  assert.deepEqual(
    JSON.parse(
      new TextDecoder().decode(h.disk.get("/maps/output.agent-map.json")),
    ),
    expected,
  );
  assert.deepEqual(h.calls, ["choose", "prepare", "commit"]);
  h.unchanged();
  assert.match(
    h.exports.state.getSnapshot().message,
    /^Exported the whole map/,
  );
  h.dispose();
});
test("picker cancel, encoder/prepare/commit failures and active path rejection preserve all state", async () => {
  for (const phase of ["picker", "encode", "prepare", "commit", "protected"]) {
    const h = harness(
      phase === "encode"
        ? async () => {
            throw new Error("Encoding failed");
          }
        : undefined,
    );
    const previous = new Uint8Array([9]);
    h.disk.set("/maps/output.agent-map.json", previous);
    if (phase === "picker") h.bridge.choose = async () => null;
    if (phase === "protected")
      h.bridge.choose = async () => ({
        token: "bad",
        path: "/maps/original.tilewright",
      });
    if (phase === "prepare" || phase === "commit")
      h.bridge[phase] = async () => {
        throw new Error("Permission denied. Choose another folder.");
      };
    assert.equal(await h.exports.export(), false);
    h.unchanged();
    assert.equal(h.disk.get("/maps/output.agent-map.json"), previous);
    assert.equal(h.pending(), null);
    assert.equal(h.exports.state.getSnapshot().error, phase !== "picker");
    if (phase === "picker")
      assert.match(h.exports.state.getSnapshot().message, /canceled/);
    h.dispose();
  }
});
test("cancellation during encoding or native preparation waits for cleanup and never publishes", async () => {
  for (const phase of ["encoding", "writing"]) {
    const hold = deferred<void>(),
      started = deferred<void>();
    const h = harness(
      phase === "encoding"
        ? async (snapshot, options) => {
            started.resolve();
            await hold.promise;
            return encodeAgentExportSnapshot(snapshot, options);
          }
        : undefined,
    );
    if (phase === "writing") {
      const prepare = h.bridge.prepare;
      h.bridge.prepare = async (...args) => {
        await prepare(...args);
        started.resolve();
        await hold.promise;
      };
    }
    const work = h.exports.export();
    await started.promise;
    assert.equal(await h.exports.export(), false);
    h.exports.cancel();
    assert.equal(h.exports.state.getSnapshot().busy, true);
    hold.resolve();
    assert.equal(await work, false);
    assert.equal(h.pending(), null);
    assert.ok(!h.calls.includes("commit"));
    assert.match(h.exports.state.getSnapshot().message, /canceled/);
    assert.equal(h.disk.has("/maps/output.agent-map.json"), false);
    h.unchanged();
    h.dispose();
  }
});
test("edits after capture are excluded and no export acknowledges later history", async () => {
  const h = harness();
  const expected = h.session.captureAgentExportSnapshot().map;
  const choose = h.bridge.choose;
  h.bridge.choose = async (...args) => {
    h.session.renameLayer(h.session.document.layers[0].id, "Later edit");
    return choose(...args);
  };
  assert.equal(await h.exports.export(), true);
  assert.deepEqual(
    JSON.parse(
      new TextDecoder().decode(h.disk.get("/maps/output.agent-map.json")),
    ),
    expected,
  );
  assert.equal(h.session.history.state.dirty, true);
  assert.equal(h.session.history.state.savedRevision, 0);
  assert.equal(h.session.history.state.recoveryRevision, 1);
  h.dispose();
});
test("replacement/disposal before publication cancels; commit is noncancelable and warnings still report success", async () => {
  for (const action of ["replace", "dispose", "commit"]) {
    const h = harness();
    if (action === "commit") {
      const commit = h.bridge.commit;
      h.bridge.commit = async (...args) => {
        assert.equal(h.exports.state.getSnapshot().cancelable, false);
        h.exports.cancel();
        await commit(...args);
        return "Directory durability could not be confirmed.";
      };
    } else {
      const prepare = h.bridge.prepare;
      h.bridge.prepare = async (...args) => {
        await prepare(...args);
        if (action === "replace") h.workspace.createMap(64, 64);
        else h.exports.dispose();
      };
    }
    assert.equal(await h.exports.export(), action === "commit");
    assert.equal(
      h.disk.has("/maps/output.agent-map.json"),
      action === "commit",
    );
    assert.equal(h.pending(), null);
    if (action === "commit") {
      h.unchanged();
      assert.match(h.exports.state.getSnapshot().message, /durability/);
    }
    h.dispose();
  }
});
test("target-scale export reports increasing byte progress and permits real timer cancellation", async () => {
  const session = new EditorSession(populatedAgentDocument(FIXTURES[1]));
  const workspace = new EditorWorkspace(session);
  let prepared = false,
    canceled = false,
    timerRan = false;
  const bridge: AgentExportBridge = {
    available: true,
    async choose() {
      return { token: "agent-1", path: "/map.json" };
    },
    async prepare() {
      prepared = true;
    },
    async commit() {
      throw new Error("Cancellation must prevent publication");
    },
    async cancel() {
      canceled = true;
    },
  };
  const progress: number[] = [];
  const exports = new AgentExports(workspace, bridge, {
    encode: (snapshot, options) =>
      encodeAgentExportSnapshot(snapshot, {
        ...options,
        onProgress(bytes) {
          progress.push(bytes);
          options?.onProgress?.(bytes);
          if (progress.length === 2)
            setTimeout(() => {
              timerRan = true;
              exports.cancel();
            }, 0);
        },
      }),
  });
  assert.equal(await exports.export(), false);
  assert.ok(timerRan && canceled && !prepared);
  assert.ok(progress.length >= 2 && progress[1] > progress[0]);
  assert.equal(session.history.state.savedRevision, null);
  exports.dispose();
  workspace.dispose();
});

test("file actions share export gate while recovery scheduling remains independent", async () => {
  const { ProjectFiles } = await import("../../src/editor/project-files.ts");
  const { DocumentLifecycle } =
    await import("../../src/editor/document-lifecycle.ts");
  const { ApplicationActions } =
    await import("../../src/editor/application-actions.ts");
  const h = harness(),
    hold = deferred<void>(),
    started = deferred<void>();
  const files = new ProjectFiles(h.workspace, {
    available: true,
    async choose() {
      throw new Error("Export must gate project file actions");
    },
    async read() {
      throw new Error("Unexpected project read");
    },
    async write() {
      throw new Error("Unexpected project write");
    },
  });
  const lifecycle = new DocumentLifecycle(files, h.exports);
  const actions = new ApplicationActions(lifecycle);
  const prepare = h.bridge.prepare;
  h.bridge.prepare = async (...args) => {
    await prepare(...args);
    started.resolve();
    await hold.promise;
  };
  assert.ok(actions.routeKey({ key: "e", shiftKey: true, metaKey: true }));
  await started.promise;
  for (const id of [
    "save",
    "save-as",
    "open",
    "new",
    "export-agent",
  ] as const) {
    assert.equal(actions.state(id).enabled, false);
    assert.equal(actions.perform(id), false);
  }
  assert.equal(
    await lifecycle.close(async () => {
      throw new Error("Must not close during export");
    }),
    false,
  );
  assert.equal(await lifecycle.newMap(64, 64), false);
  h.exports.cancel();
  hold.resolve();
  while (lifecycle.state.getSnapshot().busy)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(actions.state("export-agent").enabled, true);
  h.unchanged();
  actions.dispose();
  lifecycle.dispose();
  files.dispose();
  h.dispose();
});
