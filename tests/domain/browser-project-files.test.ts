import assert from "node:assert/strict";
import test from "node:test";
import {
  ProjectFiles,
  projectDownloadName,
  type BrowserProjectFileBridge,
} from "../../src/editor/project-files.ts";
import { DocumentLifecycle } from "../../src/editor/document-lifecycle.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import { encodeProjectSnapshot } from "../../src/domain/project.ts";
import { PROJECT_LIMITS } from "../../src/domain/project-format.ts";
import { exampleProject } from "../fixtures/project.ts";

const file = () =>
  new File([JSON.stringify(exampleProject)], "café 地図.tilewright");
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function harness(encode?: typeof encodeProjectSnapshot) {
  const workspace = new EditorWorkspace();
  const downloads: { filename: string; bytes: Uint8Array }[] = [];
  const bridge: BrowserProjectFileBridge = {
    kind: "browser",
    available: true,
    async choose() {
      return [file()];
    },
    cancelPick() {},
    download(filename, bytes) {
      downloads.push({ filename, bytes });
    },
  };
  const files = new ProjectFiles(workspace, bridge, undefined, { encode });
  const lifecycle = new DocumentLifecycle(files);
  return {
    workspace,
    files,
    lifecycle,
    bridge,
    downloads,
    dispose() {
      lifecycle.dispose();
      files.dispose();
      workspace.dispose();
    },
  };
}
async function accept(
  h: ReturnType<typeof harness>,
  choice: "discard" | "save" | "cancel" = "discard",
) {
  // Picker promises settle before the shared unsaved-work prompt.
  await Promise.resolve();
  assert.equal(h.lifecycle.state.getSnapshot().prompt, "open");
  h.lifecycle.choose(choice);
}

test("picker and drop share full-content validation; browser names never authorize native writes", async () => {
  const h = harness();
  try {
    for (const dropped of [undefined, [file()], [file()]]) {
      const opening = h.lifecycle.open(dropped);
      await accept(h);
      assert.equal(await opening, true);
      const state = h.workspace.state.getSnapshot();
      assert.deepEqual(
        state.session.captureProjectSnapshot().project,
        exampleProject,
      );
      assert.deepEqual(state.source, {
        kind: "browser-file",
        name: file().name,
      });
      assert.equal(state.savedPath, null);
      assert.equal(await h.lifecycle.save(), true);
      assert.deepEqual(
        JSON.parse(new TextDecoder().decode(h.downloads.at(-1)!.bytes)),
        exampleProject,
      );
      assert.equal(h.downloads.at(-1)!.filename, file().name);
      assert.equal(h.files.lastSave.getSnapshot(), null);
      assert.equal(
        h.files.lastDownload.getSnapshot()?.kind,
        "browser-download-request",
      );
      assert.equal(state.session.history.state.savedRevision, null);
      assert.equal(state.session.history.state.recoveryRevision, null);
      assert.equal(state.session.history.state.dirty, true);
    }
    assert.deepEqual(h.downloads[0].bytes, h.downloads[1].bytes);
  } finally {
    h.dispose();
  }
});

test("canceled picker/prompt, invalid count/size, malformed and unsupported files preserve the entire current project", async () => {
  const h = harness();
  try {
    const before = h.workspace.state.getSnapshot();
    const s = before.session;
    s.renameLayer(s.document.layers[0].id, "Keep my work");
    const snapshot = s.captureProjectSnapshot();
    const history = s.history.state;
    h.bridge.choose = async () => null;
    assert.equal(await h.lifecycle.open(), false);
    for (const files of [
      [],
      [file(), file()],
      [new File([], "empty.tilewright")],
      [
        {
          name: "huge.tilewright",
          size: PROJECT_LIMITS.maxBytes + 1,
          async arrayBuffer() {
            throw new Error("must not read");
          },
        },
      ],
    ]) {
      assert.equal(await h.lifecycle.open(files), false);
      assert.ok(h.lifecycle.state.getSnapshot().error);
    }
    for (const contents of [
      "{broken",
      JSON.stringify({ ...exampleProject, version: 99 }),
      JSON.stringify({ ...exampleProject, format: "agent-export" }),
    ]) {
      const opening = h.lifecycle.open([
        new File([contents], "bad.tilewright"),
      ]);
      await accept(h);
      assert.equal(await opening, false);
      assert.ok(h.files.state.getSnapshot().error);
    }
    const opening = h.lifecycle.open([file()]);
    await accept(h, "cancel");
    assert.equal(await opening, false);
    assert.equal(h.workspace.state.getSnapshot(), before);
    assert.deepEqual(s.captureProjectSnapshot().project, snapshot.project);
    assert.deepEqual(s.history.state, history);
  } finally {
    h.dispose();
  }
});

test("Open is superseded by edits/preferences/checkpoints during chooser, approval or File read", async () => {
  for (const phase of ["choose", "approval", "read"] as const) {
    for (const mutation of [
      "edit",
      "preference",
      "checkpoint",
      "replacement",
    ] as const) {
      const h = harness();
      try {
        const pause = deferred<void>(),
          started = deferred<void>();
        const candidate = file();
        if (phase === "choose")
          h.bridge.choose = async () => {
            started.resolve();
            await pause.promise;
            return [candidate];
          };
        if (phase === "read") {
          const read = candidate.arrayBuffer.bind(candidate);
          candidate.arrayBuffer = async () => {
            started.resolve();
            await pause.promise;
            return read();
          };
          h.bridge.choose = async () => [candidate];
        }
        const opening = h.lifecycle.open();
        if (phase === "read") await accept(h);
        if (phase !== "approval") await started.promise;
        else await Promise.resolve();
        const session = h.workspace.state.getSnapshot().session;
        if (mutation === "edit")
          session.renameLayer(session.document.layers[0].id, "Later work");
        else if (mutation === "preference")
          session.setLayerVisible(session.document.layers[0].id, false);
        else if (mutation === "checkpoint")
          session.history.markRecovery(session.history.captureCheckpoint());
        else h.workspace.createMap(8, 8);
        const before = h.workspace.state.getSnapshot();
        const expected = before.session.captureProjectSnapshot().project;
        if (phase === "approval") h.lifecycle.choose("discard");
        pause.resolve();
        assert.equal(await opening, false, `${phase}/${mutation}`);
        assert.equal(h.workspace.state.getSnapshot(), before);
        assert.deepEqual(
          before.session.captureProjectSnapshot().project,
          expected,
        );
      } finally {
        h.dispose();
      }
    }
  }
});

test("download from replacement prompt stays on current map and later edits survive encoding", async () => {
  const pause = deferred<void>(),
    started = deferred<void>();
  const h = harness(async (snapshot, options) => {
    started.resolve();
    await pause.promise;
    return encodeProjectSnapshot(snapshot, options);
  });
  try {
    const before = h.workspace.state.getSnapshot();
    const snapshot = before.session.captureProjectSnapshot();
    const opening = h.lifecycle.open([file()]);
    await accept(h, "save");
    await started.promise;
    before.session.renameLayer(
      before.session.document.layers[0].id,
      "Later edit",
    );
    assert.equal(await h.lifecycle.open([file()]), false);
    assert.equal(await h.lifecycle.save(), false);
    pause.resolve();
    assert.equal(await opening, false);
    assert.equal(h.workspace.state.getSnapshot(), before);
    assert.deepEqual(
      JSON.parse(new TextDecoder().decode(h.downloads[0].bytes)),
      snapshot.project,
    );
    assert.equal(
      h.files.lastDownload.getSnapshot()?.checkpoint.revision,
      snapshot.checkpoint.revision,
    );
    assert.equal(before.session.document.layers[0].name, "Later edit");
    assert.equal(before.session.history.state.savedRevision, null);
    assert.equal(before.session.history.state.dirty, true);
    const retry = h.lifecycle.open([file()]);
    await accept(h);
    assert.equal(await retry, true);
    assert.equal(h.files.lastDownload.getSnapshot(), null);
  } finally {
    h.dispose();
  }
});

test("encode/transport failure and replaced/disposed sessions cannot produce misleading checkpoints", async () => {
  for (const failure of ["encode", "download", "replace", "dispose"] as const) {
    const h = harness(async (snapshot, options) => {
      if (failure === "encode") throw new Error("Encoding failed");
      if (failure === "replace") h.workspace.createMap(3, 3);
      if (failure === "dispose") h.files.dispose();
      return encodeProjectSnapshot(snapshot, options);
    });
    try {
      if (failure === "download")
        h.bridge.download = () => {
          throw new Error("Download blocked");
        };
      assert.equal(await h.lifecycle.save(), false);
      assert.equal(h.downloads.length, 0);
      assert.equal(h.files.lastDownload.getSnapshot(), null);
      assert.equal(h.files.lastSave.getSnapshot(), null);
      assert.equal(
        h.workspace.state.getSnapshot().session.history.state.dirty,
        true,
      );
    } finally {
      h.dispose();
    }
  }
});

test("download filenames are editable, bounded, and preserve Unicode", () => {
  assert.equal(projectDownloadName(null), "Untitled.tilewright");
  assert.equal(
    projectDownloadName("café 地図.TILEWRIGHT"),
    "café 地図.tilewright",
  );
  assert.equal(projectDownloadName("map.json"), "map.tilewright");
  assert.equal(projectDownloadName(".tilewright"), "Untitled.tilewright");
  assert.equal(
    projectDownloadName("/evil\\name:?.json"),
    "_evil_name__.tilewright",
  );
});
