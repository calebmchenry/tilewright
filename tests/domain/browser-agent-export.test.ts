import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentExports,
  agentExportDownloadName,
  type BrowserAgentExportBridge,
} from "../../src/editor/agent-export.ts";
import { encodeAgentExportSnapshot } from "../../src/domain/agent-export.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { ProjectFiles } from "../../src/editor/project-files.ts";
import { consumerGoldenSession } from "../fixtures/agent-consumer.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function harness(encode = encodeAgentExportSnapshot) {
  const session = consumerGoldenSession();
  const workspace = new EditorWorkspace(session);
  const files = new ProjectFiles(workspace, {
    kind: "browser",
    available: true,
    choose: async () => null,
    cancelPick() {},
    download() {},
  });
  const downloads: { name: string; bytes: Uint8Array }[] = [];
  const bridge: BrowserAgentExportBridge = {
    kind: "browser",
    available: true,
    download(name, bytes) {
      downloads.push({ name, bytes });
    },
  };
  const exports = new AgentExports(workspace, bridge, { encode });
  const state = () => ({
    workspace: workspace.state.getSnapshot(),
    history: session.history.state,
    project: session.captureProjectSnapshot().project,
    lastSave: files.lastSave.getSnapshot(),
    lastDownload: files.lastDownload.getSnapshot(),
    status: files.browserStatus.getSnapshot(),
    feedback: files.state.getSnapshot(),
  });
  const dispose = () => {
    exports.dispose();
    files.dispose();
    workspace.dispose();
  };
  return {
    session,
    workspace,
    files,
    bridge,
    exports,
    downloads,
    state,
    dispose,
  };
}

test("browser agent exports preserve project download/history/recovery evidence and every hidden layer/area", async () => {
  const h = harness();
  try {
    await h.files.save();
    const id = h.session.document.layers[0].id;
    h.session.renameLayer(id, "Committed but not downloaded");
    h.session.history.markRecovery(h.session.history.captureCheckpoint());
    const before = h.state();
    const expected = h.session.captureAgentExportSnapshot().map;
    h.session.viewport.set({ x: 9999, y: -9999, zoom: 0.001 });
    for (let i = 0; i < 3; i++) {
      assert.equal(await h.exports.export(), true);
      assert.equal(h.downloads[i].name, "Untitled.agent-map.json");
      assert.deepEqual(
        JSON.parse(new TextDecoder().decode(h.downloads[i].bytes)),
        expected,
      );
      assert.deepEqual(h.state(), before);
    }
    assert.match(h.exports.state.getSnapshot().message, /download requested/);
    assert.match(
      h.exports.state.getSnapshot().message,
      /saving to disk is not confirmed/,
    );
    assert.match(
      h.exports.state.getSnapshot().message,
      /cancel the download in your browser/,
    );
    // Undo/redo survives export and the original download still identifies revision 1.
    h.session.history.undo();
    assert.equal(
      h.files.browserStatus.getSnapshot().changesSinceDownload,
      false,
    );
    h.session.history.redo();
    assert.deepEqual(h.state(), before);
  } finally {
    h.dispose();
  }
});

test("browser export keeps the captured revision when edits arrive during encoding", async () => {
  const hold = deferred(),
    started = deferred();
  const h = harness(async (snapshot, options) => {
    started.resolve();
    await hold.promise;
    return encodeAgentExportSnapshot(snapshot, options);
  });
  try {
    const expected = h.session.captureAgentExportSnapshot().map;
    const work = h.exports.export();
    await started.promise;
    assert.equal(h.exports.state.getSnapshot().cancelable, true);
    assert.equal(await h.exports.export(), false);
    h.session.renameLayer(h.session.document.layers[0].id, "Later edit");
    const afterEdit = h.state();
    hold.resolve();
    assert.equal(await work, true);
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(h.downloads[0].bytes)),
      expected,
    );
    assert.deepEqual(h.state(), afterEdit);
  } finally {
    h.dispose();
  }
});

test("cancel, disposal and session replacement during encoding prevent any browser handoff", async () => {
  for (const action of ["cancel", "dispose", "replace"] as const) {
    const hold = deferred(),
      started = deferred();
    const h = harness(async (snapshot, options) => {
      started.resolve();
      await hold.promise;
      return encodeAgentExportSnapshot(snapshot, options);
    });
    try {
      const before = h.state();
      const work = h.exports.export();
      await started.promise;
      if (action === "replace") h.workspace.createMap(16, 16);
      else h.exports[action]();
      hold.resolve();
      assert.equal(await work, false);
      assert.deepEqual(h.downloads, []);
      assert.match(
        h.exports.state.getSnapshot().message,
        /No download was requested/,
      );
      assert.equal(h.exports.state.getSnapshot().error, false);
      if (action !== "replace") assert.deepEqual(h.state(), before);
    } finally {
      h.dispose();
    }
  }
});

test("cancellation at the last encoding progress callback prevents handoff; handoff itself is noncancelable", async () => {
  const h = harness();
  try {
    const stop = h.exports.state.subscribe(() => {
      if (/KiB encoded/.test(h.exports.state.getSnapshot().message))
        h.exports.cancel();
    });
    assert.equal(await h.exports.export(), false);
    assert.equal(h.downloads.length, 0);
    stop();
    const download = h.bridge.download;
    h.bridge.download = (...args) => {
      assert.equal(h.exports.state.getSnapshot().cancelable, false);
      h.exports.cancel();
      download(...args);
    };
    assert.equal(await h.exports.export(), true);
    assert.equal(h.downloads.length, 1);
    assert.match(h.exports.state.getSnapshot().message, /download requested/);
  } finally {
    h.dispose();
  }
});

test("encoding and observable download failures preserve evidence and allow retry", async () => {
  for (const phase of ["encode", "download"] as const) {
    let fail = true;
    const h = harness(async (snapshot, options) => {
      if (phase === "encode" && fail) throw new Error("Encoding failed");
      return encodeAgentExportSnapshot(snapshot, options);
    });
    try {
      await h.files.save();
      const before = h.state();
      const download = h.bridge.download;
      h.bridge.download = (...args) => {
        if (phase === "download" && fail)
          throw new Error("Browser blocked the download");
        download(...args);
      };
      assert.equal(await h.exports.export(), false);
      assert.equal(h.exports.state.getSnapshot().error, true);
      assert.match(h.exports.state.getSnapshot().message, /failed|blocked/);
      assert.deepEqual(h.downloads, []);
      assert.deepEqual(h.state(), before);
      fail = false;
      assert.equal(await h.exports.export(), true);
      assert.deepEqual(h.state(), before);
    } finally {
      h.dispose();
    }
  }
});

test("agent download names preserve Unicode, remove project extensions and sanitize unsafe filename characters", () => {
  for (const [input, expected] of [
    [null, "Untitled.agent-map.json"],
    ["café 地図.TILEWRIGHT", "café 地図.agent-map.json"],
    ["map.json", "map.agent-map.json"],
    ["../a:b?.tilewright", ".._a_b_.agent-map.json"],
    [".tilewright", "Untitled.agent-map.json"],
  ] as const)
    assert.equal(agentExportDownloadName(input), expected);
  assert.equal(
    Array.from(agentExportDownloadName("😀".repeat(200))).length,
    195,
  );
});
