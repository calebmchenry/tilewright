import assert from "node:assert/strict";
import test from "node:test";
import {
  RecoveryCoordinator,
  projectHash,
  type RecoveryBridge,
  type RecoveryCapture,
  type RecoveryClock,
  type RecoveryControl,
  type RecoveryTicket,
} from "../../src/editor/recovery.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import {
  ProjectFiles,
  type ProjectFileBridge,
} from "../../src/editor/project-files.ts";
import { DocumentLifecycle } from "../../src/editor/document-lifecycle.ts";
import { encodeProjectSnapshot } from "../../src/domain/project.ts";
import { decodeProject } from "../../src/domain/project-decoding.ts";
import { exampleProject } from "../fixtures/project.ts";
import { layerId, rawColor } from "../../src/domain/values.ts";

const flush = async () => {
  for (let i = 0; i < 6; i++)
    await new Promise<void>((resolve) => setImmediate(resolve));
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
class Clock implements RecoveryClock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  utc = () => 1_800_000_000_000 + this.time;
  set(callback: () => void, delay: number) {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  }
  clear(timer: unknown) {
    this.timers.delete(timer as number);
  }
  async to(time: number) {
    for (;;) {
      const next = [...this.timers]
        .filter(([, t]) => t.at <= time)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
      await flush();
    }
    this.time = time;
    await flush();
  }
}
function harness() {
  const clock = new Clock(),
    workspace = new EditorWorkspace();
  const controls: RecoveryControl[] = [],
    captures: {
      capture: RecoveryCapture;
      bytes: Uint8Array;
      ticket: RecoveryTicket;
    }[] = [];
  const published: typeof captures = [];
  let pending: (typeof captures)[number] | null = null;
  const current = new Map<string, RecoveryControl>();
  const bridge: RecoveryBridge = {
    available: true,
    async initialize() {},
    async control(c) {
      controls.push(c);
      current.set(c.documentId, c);
      if (c.status !== "active") {
        for (let i = published.length - 1; i >= 0; i--)
          if (published[i].ticket.documentId === c.documentId)
            published.splice(i, 1);
      }
      return null;
    },
    async prepare(capture, bytes) {
      const ticket = {
        documentId: capture.documentId,
        writerId: capture.writerId,
        epoch: capture.epoch,
        sequence: captures.length + 1,
      };
      const record = { capture, bytes: bytes.slice(), ticket };
      captures.push(record);
      pending = record;
      return ticket;
    },
    async commit(ticket) {
      const state = current.get(ticket.documentId);
      assert.equal(state?.epoch, ticket.epoch);
      assert.equal(state?.status, "active");
      assert.equal(pending?.ticket, ticket);
      published.push(pending!);
      pending = null;
      return null;
    },
    async cancel(ticket) {
      if (pending?.ticket === ticket) pending = null;
    },
  };
  const recovery = new RecoveryCoordinator(workspace, bridge, {
    clock,
    encode: (snapshot, options) =>
      encodeProjectSnapshot(snapshot, {
        ...options,
        yieldControl: async () => {},
      }),
  });
  const disk = new Map<string, Uint8Array>();
  const original = new TextEncoder().encode(
    JSON.stringify(exampleProject, null, 2),
  );
  disk.set("/maps/source.tilewright", original);
  let destination = "/maps/source.tilewright";
  const fileBridge: ProjectFileBridge = {
    available: true,
    async choose() {
      return { token: destination, path: destination };
    },
    async read(token) {
      return disk.get(token)!.slice();
    },
    async write(token, bytes) {
      disk.set(token, bytes.slice());
      return null;
    },
  };
  const files = new ProjectFiles(workspace, fileBridge, recovery),
    lifecycle = new DocumentLifecycle(files);
  function edit(name = `Changed ${clock.time}`) {
    const s = workspace.state.getSnapshot().session;
    s.history.execute("Rename", [
      { kind: "rename-layer", id: s.document.layers[0].id, name },
    ]);
  }
  function dispose() {
    lifecycle.dispose();
    files.dispose();
    recovery.dispose();
    workspace.dispose();
  }
  return {
    clock,
    workspace,
    controls,
    captures,
    published,
    bridge,
    recovery,
    disk,
    original,
    fileBridge,
    files,
    lifecycle,
    edit,
    dispose,
    destination: (path: string) => {
      destination = path;
    },
  };
}

test("empty untitled captures at 2s, idle/no-op/preferences do not repeat; recovery never cleans or adds undo", async () => {
  const h = harness(),
    s = h.workspace.state.getSnapshot().session;
  const before = s.history.state;
  await h.clock.to(1999);
  assert.equal(h.captures.length, 0);
  await h.clock.to(2000);
  assert.equal(h.published.length, 1);
  assert.deepEqual(s.history.state, { ...before, recoveryRevision: 0 });
  const metadata = h.captures[0].capture;
  assert.equal(metadata.saved, null);
  assert.equal(metadata.displayName, "Untitled");
  assert.equal(metadata.historyRevision, 0);
  const decoded = await decodeProject(h.captures[0].bytes, {
    yieldControl: async () => {},
  });
  assert.deepEqual(decoded.document.bounds, s.document.bounds);
  s.setLayerVisible(s.document.layers[0].id, false);
  h.edit(s.document.layers[0].name);
  await h.clock.to(60000);
  assert.equal(h.captures.length, 1);
  h.dispose();
  assert.equal(h.clock.timers.size, 0);
});

test("trailing debounce, minimum spacing, and continuous 10s maximum use monotonic time", async () => {
  const h = harness();
  await h.clock.to(1500);
  h.edit();
  await h.clock.to(3499);
  assert.equal(h.captures.length, 0);
  await h.clock.to(3500);
  assert.equal(h.captures.length, 1);
  await h.clock.to(3600);
  h.edit();
  await h.clock.to(8499);
  assert.equal(h.captures.length, 1);
  await h.clock.to(8500);
  assert.equal(h.captures.length, 2);
  for (let t = 9000; t <= 18000; t += 1000) {
    await h.clock.to(t);
    h.edit();
  }
  await h.clock.to(18999);
  assert.equal(h.captures.length, 2);
  await h.clock.to(19000);
  assert.equal(h.captures.length, 3);
  assert.equal(
    h.captures[2].capture.historyRevision,
    h.workspace.state.getSnapshot().session.history.state.revision,
  );
  h.dispose();
});

test("one coherent detached job coalesces edits and undo without numeric revision ordering", async () => {
  const h = harness(),
    gate = deferred<RecoveryTicket>();
  const prepare = h.bridge.prepare;
  h.bridge.prepare = async (capture, bytes) => {
    const t = await prepare(capture, bytes);
    await gate.promise;
    return t;
  };
  h.edit("First");
  await h.clock.to(2000);
  h.edit("Second");
  h.edit("Third");
  const s = h.workspace.state.getSnapshot().session;
  s.history.undo();
  await h.clock.to(15000);
  assert.equal(h.captures.length, 1);
  assert.equal(
    JSON.parse(new TextDecoder().decode(h.captures[0].bytes)).document.layers[0]
      .name,
    "First",
  );
  gate.resolve(h.captures[0].ticket);
  await flush();
  await h.clock.to(15000);
  assert.equal(h.captures.length, 2);
  assert.equal(
    JSON.parse(new TextDecoder().decode(h.captures[1].bytes)).document.layers[0]
      .name,
    "Second",
  );
  assert.equal(s.history.state.recoveryRevision, 2);
  assert.equal(s.history.state.undoSteps, 2);
  assert.equal(s.history.state.redoSteps, 1);
  h.dispose();
});

test("saved edits recover full data with original bytes unchanged and exact byte/canonical hashes", async () => {
  const h = harness();
  assert.equal(await h.files.open(), true);
  const s = h.workspace.state.getSnapshot().session;
  s.history.execute("Paint hidden layer", [
    {
      kind: "tiles",
      writes: [
        {
          layerId: layerId("notes"),
          x: 2,
          y: 2,
          length: 1,
          value: rawColor("#123456ff"),
        },
      ],
    },
  ]);
  h.edit("Unsaved rename");
  await h.clock.to(2000);
  assert.equal(h.published.length, 1);
  const record = h.published[0];
  assert.equal(record.capture.historyRevision, 2);
  assert.equal(record.capture.savedRevision, 0);
  assert.equal(record.capture.saved?.byteHash, await projectHash(h.original));
  assert.notEqual(
    record.capture.saved?.byteHash,
    record.capture.saved?.canonicalHash,
  );
  assert.deepEqual(h.disk.get("/maps/source.tilewright"), h.original);
  const decoded = await decodeProject(record.bytes, {
    yieldControl: async () => {},
  });
  assert.equal(decoded.document.layers[0].name, "Unsaved rename");
  assert.deepEqual(
    decoded.document.getCell(layerId("notes"), 2, 2),
    rawColor("#123456ff"),
  );
  assert.deepEqual(decoded.document.annotations, s.document.annotations);
  assert.deepEqual(
    decoded.document.registryEntries,
    s.document.registryEntries,
  );
  assert.equal(s.history.state.dirty, true);
  assert.equal(s.history.state.undoSteps, 2);
  h.dispose();
});

test("save during prepare fences late publication; edits during write remain dirty and Save As retains identity", async () => {
  const h = harness();
  await h.clock.to(2000);
  const id = h.captures[0].ticket.documentId;
  h.edit("Captured before save");
  const prepared = deferred<void>(),
    release = deferred<void>(),
    prepare = h.bridge.prepare;
  h.bridge.prepare = async (capture, bytes) => {
    const t = await prepare(capture, bytes);
    prepared.resolve();
    await release.promise;
    return t;
  };
  await h.clock.to(7000);
  await prepared.promise;
  const wrote = deferred<void>(),
    saveRelease = deferred<void>(),
    write = h.fileBridge.write;
  h.fileBridge.write = async (token, bytes) => {
    wrote.resolve();
    await saveRelease.promise;
    return write(token, bytes);
  };
  h.destination("/maps/saved-as.tilewright");
  const saving = h.lifecycle.save(true);
  await wrote.promise;
  h.edit("Edit during save");
  release.resolve();
  saveRelease.resolve();
  assert.equal(await saving, true);
  assert.equal(h.published.length, 1); // completed older checkpoint is retained
  assert.equal(
    h.workspace.state.getSnapshot().session.history.state.dirty,
    true,
  );
  h.bridge.prepare = prepare;
  await h.clock.to(12000);
  assert.equal(h.published.at(-1)!.capture.documentId, id);
  assert.equal(
    h.published.at(-1)!.capture.saved?.path,
    "/maps/saved-as.tilewright",
  );
  assert.equal(
    JSON.parse(
      new TextDecoder().decode(h.disk.get("/maps/saved-as.tilewright")!),
    ).document.layers[0].name,
    "Captured before save",
  );
  assert.deepEqual(h.disk.get("/maps/source.tilewright"), h.original);
  h.dispose();
});

test("a pending recovery response cannot supersede Open or acknowledge its new controller", async () => {
  const h = harness(),
    release = deferred<void>(),
    commit = h.bridge.commit;
  h.bridge.commit = async (ticket) => {
    const warning = await commit(ticket);
    await release.promise;
    return warning;
  };
  await h.clock.to(2000);
  const old = h.workspace.state.getSnapshot().session;
  const opening = h.lifecycle.open();
  h.lifecycle.choose("discard");
  await flush();
  release.resolve();
  assert.equal(await opening, true);
  const s = h.workspace.state.getSnapshot().session;
  assert.notEqual(s, old);
  assert.equal(s.history.state.recoveryRevision, null);
  assert.equal(s.history.state.dirty, false);
  assert.equal(old.history.state.recoveryRevision, null);
  assert.equal(h.published.length, 0);
  h.dispose();
});

test("undo to saved resolves old data; redo reactivates a new epoch and history revisions may decrease", async () => {
  const h = harness();
  await h.files.open();
  h.edit("One");
  await h.clock.to(2000);
  const first = h.captures[0].capture,
    s = h.workspace.state.getSnapshot().session;
  s.history.undo();
  await flush();
  assert.equal(h.published.length, 0);
  assert.equal(s.history.state.dirty, false);
  s.history.redo();
  await h.clock.to(7000);
  assert.equal(h.published.length, 1);
  assert.equal(h.captures[1].capture.documentId, first.documentId);
  assert.ok(h.captures[1].capture.epoch > first.epoch);
  assert.equal(await h.files.save(), true);
  assert.equal(h.published.length, 0);
  s.history.undo();
  await h.clock.to(12000);
  assert.equal(h.captures.at(-1)!.capture.historyRevision, 0);
  assert.equal(h.captures.at(-1)!.capture.savedRevision, 1);
  h.dispose();
});

test("failed/canceled Open and canceled Save As keep completed recovery and resume dirty work", async () => {
  const h = harness();
  await h.clock.to(2000);
  const old = h.workspace.state.getSnapshot().session;
  h.fileBridge.read = async () => new TextEncoder().encode("bad json");
  const opening = h.lifecycle.open();
  h.lifecycle.choose("discard");
  assert.equal(await opening, false);
  assert.equal(h.workspace.state.getSnapshot().session, old);
  assert.equal(h.published.length, 1);
  h.fileBridge.choose = async () => null;
  const cancel = h.lifecycle.open();
  h.lifecycle.choose("discard");
  assert.equal(await cancel, false);
  assert.equal(await h.lifecycle.save(true), false);
  assert.equal(h.published.length, 1);
  h.edit();
  await h.clock.to(7000);
  assert.equal(h.published.length, 2);
  h.dispose();
});

test("failed marker blocks New/Open/close with old session intact; retry discards only after validation", async () => {
  for (const action of ["new", "open", "close"] as const) {
    const h = harness();
    await h.clock.to(2000);
    const before = h.workspace.state.getSnapshot(),
      control = h.bridge.control;
    h.bridge.control = async (c) => {
      if (c.status === "discarded") throw new Error("marker disk failure");
      return control(c);
    };
    let closed = false;
    const run = () =>
      action === "new"
        ? h.lifecycle.newMap(64, 64)
        : action === "open"
          ? h.lifecycle.open()
          : h.lifecycle.close(async () => {
              closed = true;
            });
    const pending = run();
    h.lifecycle.choose("discard");
    assert.equal(await pending, false);
    assert.equal(closed, false);
    assert.equal(h.workspace.state.getSnapshot(), before);
    assert.equal(h.published.length, 1);
    h.edit("Gate released");
    h.bridge.control = control;
    const retry = run();
    h.lifecycle.choose("discard");
    assert.equal(await retry, true);
    assert.equal(h.published.length, 0);
    h.dispose();
  }
});

test("final marker gates committed edits and failed native close reactivates recovery", async () => {
  const h = harness();
  await h.clock.to(2000);
  const control = h.bridge.control,
    reached = deferred<void>(),
    release = deferred<void>();
  h.bridge.control = async (c) => {
    if (c.status === "discarded") {
      reached.resolve();
      await release.promise;
    }
    return control(c);
  };
  const closing = h.lifecycle.close(async () => {
    throw new Error("native close failed");
  });
  h.lifecycle.choose("discard");
  await reached.promise;
  assert.throws(() => h.edit("Must not commit"), /Finishing document action/);
  release.resolve();
  assert.equal(await closing, false);
  h.edit("After failed close");
  await h.clock.to(7000);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].capture.historyRevision, 1);
  h.dispose();
});

test("I/O retry backs off 5/15/30/60 seconds, capacity waits for Retry, and previous checkpoint survives", async () => {
  const h = harness();
  await h.clock.to(2000);
  h.edit();
  let attempts = 0;
  const prepare = h.bridge.prepare;
  h.bridge.prepare = async () => {
    attempts++;
    throw new Error("disk failure");
  };
  await h.clock.to(7000);
  assert.equal(attempts, 1);
  for (const [time, count] of [
    [11999, 1],
    [12000, 2],
    [26999, 2],
    [27000, 3],
    [57000, 4],
    [117000, 5],
  ]) {
    await h.clock.to(time);
    assert.equal(attempts, count);
  }
  assert.equal(h.published.length, 1);
  assert.equal(
    h.workspace.state.getSnapshot().session.history.state.recoveryRevision,
    0,
  );
  h.bridge.prepare = async () => {
    attempts++;
    throw new Error("Recovery storage is full");
  };
  h.recovery.retry();
  await h.clock.to(122000);
  const stopped = attempts;
  await h.clock.to(300000);
  assert.equal(attempts, stopped);
  h.bridge.prepare = prepare;
  h.recovery.retry();
  await h.clock.to(300000);
  assert.equal(h.published.length, 2);
  assert.equal(h.recovery.state.getSnapshot().error, "");
  h.dispose();
});

test("successful save with failed bookkeeping remains successful, and close retries resolution", async () => {
  const h = harness();
  await h.clock.to(2000);
  h.edit("Saved data");
  const control = h.bridge.control;
  h.bridge.control = async (c) => {
    if (c.status === "resolved") throw new Error("state write failed");
    return control(c);
  };
  assert.equal(await h.lifecycle.save(), true);
  assert.equal(
    h.workspace.state.getSnapshot().session.history.state.dirty,
    false,
  );
  assert.match(h.recovery.state.getSnapshot().error, /state write failed/);
  assert.equal(h.published.length, 1);
  let closed = false;
  assert.equal(
    await h.lifecycle.close(async () => {
      closed = true;
    }),
    false,
  );
  assert.equal(closed, false);
  h.bridge.control = control;
  assert.equal(
    await h.lifecycle.close(async () => {
      closed = true;
    }),
    true,
  );
  assert.equal(closed, true);
  h.dispose();
});

test("unavailable second instance can still save and close; disposed jobs never acknowledge", async () => {
  const h = harness();
  h.bridge.initialize = async () => {
    throw new Error("another Tilewright instance owns the recovery store");
  };
  await h.clock.to(2000);
  assert.match(h.recovery.state.getSnapshot().error, /another Tilewright/);
  assert.equal(await h.lifecycle.save(), true);
  assert.equal(await h.lifecycle.close(async () => {}), true);
  h.dispose();
  const other = harness(),
    gate = deferred<void>(),
    prepare = other.bridge.prepare;
  other.bridge.prepare = async (capture, bytes) => {
    const t = await prepare(capture, bytes);
    await gate.promise;
    return t;
  };
  await other.clock.to(2000);
  const session = other.workspace.state.getSnapshot().session;
  other.dispose();
  gate.resolve();
  await flush();
  assert.equal(other.published.length, 0);
  assert.equal(session.history.state.recoveryRevision, null);
  assert.equal(other.clock.timers.size, 0);
});

test("workspace disposal while the final Open marker is pending cannot install the candidate", async () => {
  const h = harness();
  await h.clock.to(2000);
  const before = h.workspace.state.getSnapshot(),
    control = h.bridge.control;
  const reached = deferred<void>(),
    release = deferred<void>();
  h.bridge.control = async (c) => {
    if (c.status === "discarded") {
      reached.resolve();
      await release.promise;
    }
    return control(c);
  };
  const opening = h.lifecycle.open();
  h.lifecycle.choose("discard");
  await reached.promise;
  h.dispose();
  release.resolve();
  assert.equal(await opening, false);
  assert.equal(h.workspace.state.getSnapshot(), before);
});
