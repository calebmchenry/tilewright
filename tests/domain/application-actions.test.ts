import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationActions } from "../../src/editor/application-actions.ts";
import { DocumentLifecycle } from "../../src/editor/document-lifecycle.ts";
import {
  ProjectFiles,
  type ProjectFileBridge,
} from "../../src/editor/project-files.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";

function harness() {
  const workspace = new EditorWorkspace();
  const picks: boolean[] = [],
    writes: Uint8Array[] = [];
  const bridge: ProjectFileBridge = {
    available: true,
    async choose(save) {
      picks.push(save);
      return { token: "file", path: "/map.tilewright" };
    },
    async read() {
      return writes.at(-1)!;
    },
    async write(_token, bytes) {
      writes.push(bytes);
      return null;
    },
  };
  const files = new ProjectFiles(workspace, bridge);
  const lifecycle = new DocumentLifecycle(files);
  const actions = new ApplicationActions(lifecycle);
  const dispose = () => {
    actions.dispose();
    lifecycle.dispose();
    files.dispose();
    workspace.dispose();
  };
  return {
    workspace,
    files,
    lifecycle,
    actions,
    bridge,
    picks,
    writes,
    dispose,
  };
}
async function idle(h: ReturnType<typeof harness>) {
  while (h.lifecycle.state.getSnapshot().busy)
    await new Promise((resolve) => setTimeout(resolve, 1));
}

test("menu and shortcut saves share the operation gate, first destination and saved revision", async () => {
  const h = harness();
  try {
    let release!: () => void;
    h.bridge.write = async (_token, bytes) => {
      h.writes.push(bytes);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return null;
    };
    assert.equal(h.actions.routeKey({ key: "s", metaKey: true }), true);
    assert.equal(h.actions.perform("save"), false);
    assert.equal(h.actions.state("save-as").enabled, false);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    h.actions.routeKey({ key: "s", metaKey: true });
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.picks, [true]);
    release();
    await idle(h);
    assert.equal(
      h.workspace.state.getSnapshot().session.history.state.dirty,
      false,
    );
    h.bridge.write = async (_token, bytes) => {
      h.writes.push(bytes);
      return null;
    };
    h.workspace.state.getSnapshot().session.addLayer();
    h.actions.perform("save");
    await idle(h);
    assert.equal(h.writes.length, 2);
    assert.deepEqual(h.picks, [true]);
    h.actions.routeKey({ key: "s", metaKey: true, shiftKey: true });
    await idle(h);
    assert.deepEqual(h.picks, [true, true]);
  } finally {
    h.dispose();
  }
});

test("menu state follows history and replacement, text/IME and modals never edit the map", async () => {
  const h = harness();
  try {
    const old = h.workspace.state.getSnapshot().session;
    old.addLayer();
    h.actions.setContext({ owner: "canvas", modal: false });
    assert.match(h.actions.state("undo").label, /Undo Add layer/);
    assert.equal(h.actions.perform("undo"), true);
    assert.equal(old.document.layers.length, 1);
    h.actions.routeKey({ key: "z", metaKey: true, shiftKey: true });
    assert.equal(old.document.layers.length, 2);
    for (const input of [
      { key: "z", metaKey: true, isComposing: true },
      { key: "z", metaKey: true, altKey: true },
      { key: "z", metaKey: true, defaultPrevented: true },
    ])
      assert.equal(h.actions.routeKey(input), false);
    h.actions.setContext({ owner: "text", modal: false });
    assert.equal(h.actions.state("undo").label, "Undo");
    for (const id of ["undo", "redo", "cut", "copy", "paste"] as const)
      assert.equal(h.actions.perform(id), false);
    for (const key of ["z", "x", "c", "v", "ArrowRight"])
      assert.equal(h.actions.routeKey({ key, metaKey: true }), false);
    h.actions.setContext({ owner: "panel", modal: true });
    for (const item of h.actions.menu.getSnapshot())
      assert.equal(item.enabled, false);
    assert.equal(h.actions.routeKey({ key: "z", metaKey: true }), true);
    assert.equal(old.document.layers.length, 2);
    h.actions.setContext({ owner: "canvas", modal: false });
    h.actions.perform("new");
    assert.equal(h.actions.newDialog.getSnapshot(), true);
    assert.equal(h.actions.perform("new"), false);
    h.actions.createMap(64, 64);
    h.lifecycle.choose("discard");
    await idle(h);
    assert.notEqual(h.workspace.state.getSnapshot().session, old);
    assert.equal(h.actions.state("undo").enabled, false);
    assert.equal(h.actions.state("paste").enabled, false);
    h.workspace.state.getSnapshot().session.addLayer();
    h.actions.perform("undo");
    assert.equal(
      h.workspace.state.getSnapshot().session.document.layers.length,
      1,
    );
  } finally {
    h.dispose();
  }
  assert.equal(h.actions.perform("new"), false);
});

test("canceled and failed menu saves preserve dirty state and allow retry through shortcuts", async () => {
  const h = harness();
  try {
    h.bridge.choose = async () => null;
    h.actions.perform("save");
    await idle(h);
    assert.equal(h.workspace.state.getSnapshot().savedPath, null);
    assert.equal(
      h.workspace.state.getSnapshot().session.history.state.dirty,
      true,
    );
    h.bridge.choose = async () => {
      throw new Error("Picker failed");
    };
    h.actions.routeKey({ key: "s", metaKey: true });
    await idle(h);
    assert.match(h.files.state.getSnapshot().message, /Picker failed/);
    assert.equal(
      h.workspace.state.getSnapshot().session.history.state.dirty,
      true,
    );
    assert.equal(h.actions.state("save").enabled, true);
  } finally {
    h.dispose();
  }
});

test("file shortcuts report unavailable native I/O while buttons stay disabled, without bypassing modals", async () => {
  const h = harness();
  try {
    Object.assign(h.bridge, { available: false });
    h.actions.setContext({ owner: "canvas", modal: false });
    assert.equal(h.actions.state("save").enabled, false);
    h.actions.routeKey({ key: "s", metaKey: true });
    await idle(h);
    assert.match(h.files.state.getSnapshot().message, /Tilewright desktop app/);
    assert.equal(h.writes.length, 0);
    h.actions.setContext({ owner: "text", modal: true });
    const state = h.files.state.getSnapshot();
    h.actions.routeKey({ key: "o", metaKey: true });
    assert.equal(h.files.state.getSnapshot(), state);
  } finally {
    h.dispose();
  }
});
