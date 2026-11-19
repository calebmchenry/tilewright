import assert from "node:assert/strict";
import test from "node:test";
import {
  RecoveryBrowser,
  recoveryAge,
  type RecoveryEntry,
  type RecoveryMetadata,
  type RecoveryReviewBridge,
} from "../../src/editor/recovery-discovery.ts";
import {
  RecoveryCoordinator,
  projectHash,
  type RecoveryBridge,
  type RecoveryControl,
} from "../../src/editor/recovery.ts";
import { EditorWorkspace } from "../../src/editor/workspace.ts";
import {
  ProjectFiles,
  type ProjectFileBridge,
} from "../../src/editor/project-files.ts";
import { DocumentLifecycle } from "../../src/editor/document-lifecycle.ts";
import { encodeProjectSnapshot } from "../../src/domain/project.ts";
import { exampleProject } from "../fixtures/project.ts";
import { layerId, rawColor } from "../../src/domain/values.ts";
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setTimeout(r, 0));
};
async function harness() {
  const workspace = new EditorWorkspace();
  const captures: { documentId: string; bytes: Uint8Array }[] = [];
  const controls: RecoveryControl[] = [];
  let timer: (() => void) | undefined;
  let controlError = "",
    claimError = "";
  const writer: RecoveryBridge = {
    available: true,
    async initialize() {},
    async control(c) {
      if (controlError) throw new Error(controlError);
      controls.push(c);
      return null;
    },
    async prepare(c, data) {
      captures.push({ documentId: c.documentId, bytes: data });
      return { ...c, sequence: 1 };
    },
    async commit() {
      return null;
    },
    async cancel() {},
  };
  const recovery = new RecoveryCoordinator(workspace, writer, {
    clock: {
      now: () => 0,
      utc: () => Date.now(),
      set: (callback) => {
        timer = callback;
        return callback;
      },
      clear: () => {
        timer = undefined;
      },
    },
  });
  const entries: RecoveryEntry[] = [],
    payloads = new Map<string, Uint8Array>(),
    originals = new Map<string, Uint8Array>();
  const claimed: string[] = [],
    released: string[] = [],
    discarded: string[] = [];
  const bridge: RecoveryReviewBridge = {
    available: true,
    async discover() {
      return { entries: structuredClone(entries), warnings: [] };
    },
    async read(selection, source) {
      if (source) {
        const entry = entries.find(
          (e) => e.documentId === selection.documentId,
        )!;
        const data = originals.get(entry.saved!.path);
        if (!data) throw new Error("Original file is missing");
        return data.slice();
      }
      return payloads
        .get(`${selection.documentId}/${selection.sequence}`)!
        .slice();
    },
    async claim(selection) {
      if (claimError) throw new Error(claimError);
      claimed.push(selection.documentId);
    },
    async release(id) {
      released.push(id);
    },
    async discard(id) {
      discarded.push(id);
      entries.splice(
        entries.findIndex((e) => e.documentId === id),
        1,
      );
      return null;
    },
  };
  const picks: (string | undefined)[] = [];
  const writes: Uint8Array[] = [];
  let cancelSave = false;
  const fileBridge: ProjectFileBridge = {
    available: true,
    async choose(_save, current, suggested) {
      assert.equal(current, undefined);
      picks.push(suggested);
      return cancelSave
        ? null
        : { token: "new-file", path: "/maps/Recovered.tilewright" };
    },
    async read() {
      throw new Error("not used");
    },
    async write(_token, data) {
      writes.push(data.slice());
      return null;
    },
  };
  const files = new ProjectFiles(workspace, fileBridge, recovery),
    lifecycle = new DocumentLifecycle(files),
    browser = new RecoveryBrowser(lifecycle, bridge);
  async function add(
    source: string | null = null,
    project: unknown = exampleProject,
  ) {
    const payload = bytes(project),
      sha256 = await projectHash(payload);
    const baseline = bytes({
      ...exampleProject,
      document: {
        ...exampleProject.document,
        layers: exampleProject.document.layers.map((l) => ({
          ...l,
          name: l.name + " saved",
        })),
      },
    });
    const saved = source
      ? {
          path: source,
          savedAt: Date.now() - 10000,
          byteHash: await projectHash(baseline),
          canonicalHash: await canonical(baseline),
        }
      : null;
    if (source) originals.set(source, baseline);
    const metadata: RecoveryMetadata = {
      format: "tilewright-recovery",
      version: 1,
      documentId: crypto.randomUUID(),
      writerId: crypto.randomUUID(),
      epoch: 20,
      sequence: 8,
      capturedAt: Date.now() - 5000,
      completedAt: Date.now() - 4000,
      historyRevision: 2,
      documentVersion: 16,
      savedRevision: 9,
      dirty: true,
      displayName: source?.split("/").at(-1) ?? "Untitled",
      saved,
      projectFormat: "tilewright-project",
      projectVersion: 1,
      byteLength: payload.length,
      sha256,
    };
    const entry: RecoveryEntry = {
      documentId: metadata.documentId,
      saved,
      error: null,
      discardable: true,
      current: false,
      generations: [{ sequence: 8, metadata, error: null }],
    };
    entries.push(entry);
    payloads.set(`${metadata.documentId}/8`, payload);
    return { metadata, entry, payload };
  }
  return {
    workspace,
    recovery,
    controls,
    captures,
    entries,
    payloads,
    originals,
    claimed,
    released,
    discarded,
    bridge,
    files,
    lifecycle,
    browser,
    picks,
    writes,
    add,
    setControlError: (s: string) => {
      controlError = s;
    },
    setClaimError: (s: string) => {
      claimError = s;
    },
    cancelSave: () => {
      cancelSave = true;
    },
    capture: async () => {
      timer?.();
      await flush();
    },
    dispose: () => {
      browser.dispose();
      lifecycle.dispose();
      files.dispose();
      recovery.dispose();
      workspace.dispose();
    },
  };
}
async function canonical(data: Uint8Array) {
  const workspace = new EditorWorkspace();
  await workspace.openProject(data, { yieldControl: async () => {} });
  const encoded = await encodeProjectSnapshot(
    workspace.state.getSnapshot().session.captureProjectSnapshot(),
    { yieldControl: async () => {} },
  );
  workspace.dispose();
  return projectHash(encoded);
}
async function chooseDiscard(
  h: Awaited<ReturnType<typeof harness>>,
  operation: Promise<boolean>,
) {
  while (
    !h.lifecycle.state.getSnapshot().prompt &&
    h.lifecycle.state.getSnapshot().busy
  )
    await flush();
  if (h.lifecycle.state.getSnapshot().prompt) h.lifecycle.choose("discard");
  return operation;
}

test("discovery validates full models, isolates bad snapshots, compares content and preserves every entry", async () => {
  const h = await harness();
  try {
    const a = await h.add("/maps/same.tilewright"),
      b = await h.add("/maps/same.tilewright"),
      missing = await h.add("/maps/missing.tilewright"),
      untitled = await h.add();
    const bad = await h.add(null, {
      ...exampleProject,
      editor: { activeLayerId: "missing", hiddenLayerIds: [] },
    });
    h.originals.delete("/maps/missing.tilewright");
    await h.browser.refresh(true);
    const state = h.browser.state.getSnapshot();
    assert.equal(state.open, true);
    assert.equal(state.entries.length, 5);
    const find = (id: string) =>
      state.entries.find((e) => e.documentId === id)!.generations[0];
    assert.equal(find(a.metadata.documentId).relationship, "unsaved");
    assert.equal(find(b.metadata.documentId).relationship, "unsaved");
    assert.match(find(missing.metadata.documentId).context, /missing/);
    assert.equal(find(untitled.metadata.documentId).relationship, "untitled");
    assert.match(find(bad.metadata.documentId).error!, /activeLayerId/);
    assert.equal(h.claimed.length + h.discarded.length + h.controls.length, 0);
    h.browser.dismiss();
    assert.equal(h.entries.length, 5);
    await h.browser.review();
    assert.equal(h.browser.state.getSnapshot().open, true);
    // Full content equality precedes baseline equality, including pretty JSON.
    h.originals.set(
      "/maps/same.tilewright",
      new TextEncoder().encode(JSON.stringify(exampleProject, null, 2)),
    );
    await h.browser.refresh();
    assert.equal(
      h.browser.state
        .getSnapshot()
        .entries.find((e) => e.documentId === a.metadata.documentId)!
        .generations[0].relationship,
      "matches",
    );
    h.originals.set(
      "/maps/same.tilewright",
      bytes({
        ...exampleProject,
        document: {
          ...exampleProject.document,
          layers: exampleProject.document.layers.map((l) => ({
            ...l,
            name: l.name + " external",
          })),
        },
      }),
    );
    await h.browser.refresh();
    assert.equal(
      h.browser.state
        .getSnapshot()
        .entries.find((e) => e.documentId === a.metadata.documentId)!
        .generations[0].relationship,
      "conflict",
    );
  } finally {
    h.dispose();
  }
});

test("stale matching work stays reviewable without an urgent startup dialog; older and future ages are explicit", async () => {
  const h = await harness();
  try {
    const a = await h.add("/maps/matching.tilewright");
    h.originals.set(a.entry.saved!.path, a.payload);
    await h.browser.refresh(true);
    assert.equal(h.browser.state.getSnapshot().open, false);
    assert.equal(h.browser.state.getSnapshot().entries.length, 1);
    assert.match(recoveryAge(1, 2, 31 * 86400000), /Older recovery/);
    assert.match(recoveryAge(101, 102, 100), /unknown/);
    assert.match(recoveryAge(50, 40, 100), /unknown/);
    await h.browser.discard(h.browser.state.getSnapshot().entries[0]);
    assert.deepEqual(h.discarded, [a.metadata.documentId]);
    assert.deepEqual(h.originals.get(a.entry.saved!.path), a.payload);
  } finally {
    h.dispose();
  }
});

test("restore preserves exact captured model/preferences, resets session, resumes lineage and saves only through a new picker", async () => {
  const h = await harness();
  try {
    const a = await h.add("/maps/café 地図.tilewright"),
      other = await h.add();
    const sourceBefore = h.originals.get(a.entry.saved!.path)!.slice();
    await h.capture();
    const old = h.workspace.state.getSnapshot().session;
    old.setColor("#ff0000");
    old.setPencilSize(9);
    const operation = h.lifecycle.restore(a.metadata, a.entry.saved, h.bridge);
    assert.equal(await chooseDiscard(h, operation), true);
    const state = h.workspace.state.getSnapshot(),
      session = state.session;
    assert.notEqual(session, old);
    assert.equal(state.savedPath, null);
    assert.equal(session.history.state.dirty, true);
    assert.equal(session.history.state.savedRevision, null);
    assert.equal(session.history.state.revision, 0);
    assert.equal(session.history.state.undoLabel, null);
    assert.equal(session.history.state.redoLabel, null);
    assert.equal(session.activeTool.getSnapshot(), "inspect");
    assert.equal(session.pencilSize.getSnapshot(), 1);
    assert.equal(h.recovery.documentId, a.metadata.documentId);
    assert.equal(
      await canonical(a.payload),
      await projectHash(
        await encodeProjectSnapshot(session.captureProjectSnapshot()),
      ),
    );
    assert.deepEqual(h.originals.get(a.entry.saved!.path), sourceBefore);
    assert.ok(h.payloads.has(`${a.metadata.documentId}/8`));
    await h.capture();
    assert.equal(h.captures.at(-1)!.documentId, a.metadata.documentId);
    assert.equal(h.controls.at(-1)!.saved?.path, a.entry.saved!.path);
    assert.notEqual(h.controls.at(-1)!.writerId, a.metadata.writerId);
    await h.browser.refresh();
    const active = h.browser.state
      .getSnapshot()
      .entries.find((e) => e.documentId === a.metadata.documentId)!;
    await h.browser.discard(active);
    assert.equal(await h.browser.restore(active, active.generations[0]), false);
    assert.deepEqual(h.discarded, []);
    assert.equal(h.entries.length, 2);
    assert.equal(await h.lifecycle.save(), true);
    assert.deepEqual(h.picks, ["café 地図 (Recovered).tilewright"]);
    assert.equal(session.history.state.dirty, false);
    assert.equal(
      h.workspace.state.getSnapshot().savedPath,
      "/maps/Recovered.tilewright",
    );
    assert.equal(await canonical(h.writes[0]), await canonical(a.payload));
    assert.deepEqual(h.originals.get(a.entry.saved!.path), sourceBefore);
    assert.ok(h.entries.includes(other.entry));
  } finally {
    h.dispose();
  }
});

test("cancel, changed/corrupt payload, failed claim and failed outgoing marker retain live work and checkpoint", async () => {
  const h = await harness();
  try {
    const a = await h.add();
    await h.capture();
    const before = h.workspace.state.getSnapshot();
    let operation = h.lifecycle.restore(a.metadata, null, h.bridge);
    await flush();
    h.lifecycle.choose("cancel");
    assert.equal(await operation, false);
    assert.equal(h.workspace.state.getSnapshot(), before);
    h.setClaimError("claim disk failure");
    assert.equal(
      await chooseDiscard(h, h.lifecycle.restore(a.metadata, null, h.bridge)),
      false,
    );
    assert.equal(h.workspace.state.getSnapshot(), before);
    h.setClaimError("");
    h.setControlError("marker disk failure");
    assert.equal(
      await chooseDiscard(h, h.lifecycle.restore(a.metadata, null, h.bridge)),
      false,
    );
    assert.equal(h.workspace.state.getSnapshot(), before);
    assert.deepEqual(h.released, [a.metadata.documentId]);
    assert.ok(h.payloads.has(`${a.metadata.documentId}/8`));
    h.setControlError("");
    h.payloads.set(`${a.metadata.documentId}/8`, bytes({ bad: true }));
    operation = h.lifecycle.restore(a.metadata, null, h.bridge);
    assert.equal(await operation, false);
    assert.match(h.lifecycle.state.getSnapshot().error, /checksum/);
    assert.equal(h.workspace.state.getSnapshot(), before);
  } finally {
    h.dispose();
  }
});

test("restore decision cannot overwrite edits; canceled first save leaves dirty untitled restored work", async () => {
  const h = await harness();
  try {
    const a = await h.add();
    const operation = h.lifecycle.restore(a.metadata, null, h.bridge);
    await flush();
    h.workspace.state.getSnapshot().session.execute("new edit", [
      {
        kind: "tiles",
        writes: [
          {
            layerId: layerId("layer-1"),
            x: 1,
            y: 1,
            length: 1,
            value: rawColor("#ff0000ff"),
          },
        ],
      },
    ]);
    h.lifecycle.choose("discard");
    assert.equal(await operation, false);
    assert.match(
      h.lifecycle.state.getSnapshot().error,
      /changed while deciding/,
    );
    assert.equal(
      await chooseDiscard(h, h.lifecycle.restore(a.metadata, null, h.bridge)),
      true,
    );
    h.cancelSave();
    assert.equal(await h.lifecycle.save(), false);
    assert.equal(
      h.workspace.state.getSnapshot().session.history.state.dirty,
      true,
    );
    assert.equal(h.workspace.state.getSnapshot().savedPath, null);
    assert.ok(h.payloads.has(`${a.metadata.documentId}/8`));
    assert.equal(h.writes.length, 0);
  } finally {
    h.dispose();
  }
});

test("same-lineage semantic corruption exposes the valid fallback; formatting-only source changes retain baseline meaning", async () => {
  const h = await harness();
  try {
    const a = await h.add("/maps/source.tilewright");
    const invalid = bytes({
      ...exampleProject,
      document: { ...exampleProject.document, registry: [] },
    });
    const newest = {
      ...a.metadata,
      sequence: 9,
      byteLength: invalid.length,
      sha256: await projectHash(invalid),
    };
    h.payloads.set(`${a.metadata.documentId}/9`, invalid);
    h.entries[0] = {
      ...a.entry,
      generations: [
        { sequence: 9, metadata: newest, error: null },
        ...a.entry.generations,
      ],
    };
    const baseline = JSON.parse(
      new TextDecoder().decode(h.originals.get(a.entry.saved!.path)!),
    );
    h.originals.set(
      a.entry.saved!.path,
      new TextEncoder().encode(JSON.stringify(baseline, null, 2)),
    );
    await h.browser.refresh(true);
    const reviewed = h.browser.state.getSnapshot().entries[0];
    assert.ok(reviewed.generations[0].error);
    assert.equal(reviewed.generations[1].error, null);
    assert.equal(reviewed.generations[1].relationship, "unsaved");
    assert.match(reviewed.generations[1].context, /formatting changed/);
    assert.equal(
      await chooseDiscard(
        h,
        h.browser.restore(reviewed, reviewed.generations[1]),
      ),
      true,
    );
    assert.equal(
      await projectHash(
        await encodeProjectSnapshot(
          h.workspace.state.getSnapshot().session.captureProjectSnapshot(),
        ),
      ),
      await canonical(a.payload),
    );
  } finally {
    h.dispose();
  }
});

test("a later Save As receipt never makes an earlier capture claim to be newer unsaved work", async () => {
  const h = await harness();
  try {
    const a = await h.add("/maps/old.tilewright");
    const latest = {
      ...a.entry.saved!,
      path: "/maps/new.tilewright",
      savedAt: Date.now() - 1000,
    };
    h.originals.set(latest.path, h.originals.get(a.entry.saved!.path)!);
    h.entries[0] = { ...a.entry, saved: latest };
    await h.browser.refresh();
    const row = h.browser.state.getSnapshot().entries[0];
    assert.equal(row.generations[0].relationship, "unknown");
    assert.match(row.generations[0].context, /saved context changed/);
    assert.equal(row.saved!.path, latest.path);
    assert.equal(row.generations[0].metadata!.saved!.path, a.entry.saved!.path);
    assert.equal(row.generations[0].error, null);
  } finally {
    h.dispose();
  }
});
