import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import type { DocumentCommand, JsonValue } from "../../src/domain/commands.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  captureProjectSnapshot,
  encodeProjectSnapshot,
  type ProjectSnapshot,
} from "../../src/domain/project.ts";
import {
  PROJECT_LIMITS,
  ProjectEncodingError,
  type ProjectLimits,
  type ProjectV1,
} from "../../src/domain/project-format.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";
import {
  exampleDocument,
  exampleProject,
  populatedProjectDocument,
  fixtureRunsFromProject,
} from "../fixtures/project.ts";
import { FIXTURES, FIXTURE_PALETTE } from "../fixtures/maps.ts";
import { inspectFixture } from "../fixtures/inspect.ts";

const text = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const fast = { yieldControl: async () => {} };
const prefs = exampleProject.editor;
const capture = (
  document = exampleDocument(),
  limits?: Partial<ProjectLimits>,
) => captureProjectSnapshot(new CommandHistory(document), prefs, { limits });
const encoded = async (snapshot: ProjectSnapshot) =>
  text(await encodeProjectSnapshot(snapshot, fast));

test("reviewed mixed golden bytes are canonical and independent of insertion/token/run history", async () => {
  const golden = readFileSync(
    new URL("../fixtures/project-v1.canonical.tilewright", import.meta.url),
    "utf8",
  );
  for (const reverse of [false, true]) {
    const document = exampleDocument(reverse);
    // Allocate, then release unused paint. It must never leak into the palette.
    document.setCell(layerId("notes"), 1, 1, rawColor("#12345678"));
    document.clearCell(layerId("notes"), 1, 1);
    const bytes = await encoded(capture(document));
    assert.equal(bytes, golden);
    assert.deepEqual(JSON.parse(bytes), exampleProject);
    assert.equal(bytes.endsWith("\n"), true);
    assert.equal(bytes.endsWith("\n\n"), false);
    assert.equal(bytes.charCodeAt(0), 123);
  }
});

test("an empty maximum-size map stays sparse; canonical integer spelling normalizes negative zero", async () => {
  const doc = new MapDocument({
    bounds: { minX: -0, minY: -0, maxX: 65536, maxY: 65536 },
  });
  const snapshot = captureProjectSnapshot(new CommandHistory(doc), {
    activeLayerId: "layer-1",
    hiddenLayerIds: [],
  });
  assert.equal(
    await encoded(snapshot),
    '{"document":{"annotations":[],"bounds":{"maxX":65536,"maxY":65536,"minX":0,"minY":0},"layers":[{"id":"layer-1","name":"Layer 1","runs":[]}],"palette":[],"registry":[]},"editor":{"activeLayerId":"layer-1","hiddenLayerIds":[]},"format":"tilewright-project","version":1}\n',
  );
  assert.equal(doc.storageStats().partitions, 0);
  assert.equal(doc.storageStats().typedArrayBytes, 0);
});

test("dense/sparse promotion history and undo branches do not change equivalent bytes", async () => {
  const make = (dense: boolean) => {
    const doc = new MapDocument();
    const id = doc.layers[0].id,
      paint = rawColor("#ABCDEF80");
    if (dense)
      doc.writeBatch(
        Array.from({ length: 8 }, (_, y) => ({
          layerId: id,
          x: 0,
          y,
          length: 32,
          value: paint,
        })),
      );
    doc.writeBatch(
      Array.from({ length: 8 }, (_, y) => ({
        layerId: id,
        x: 0,
        y,
        length: 12,
        value: paint,
      })),
    );
    if (dense)
      doc.writeBatch(
        Array.from({ length: 8 }, (_, y) => ({
          layerId: id,
          x: 12,
          y,
          length: 20,
          value: null,
        })),
      );
    const history = new CommandHistory(doc);
    history.execute("Temporary", [
      {
        kind: "tiles",
        writes: [{ layerId: id, x: 64, y: 64, length: 2, value: paint }],
      },
    ]);
    history.undo();
    return {
      doc,
      snapshot: captureProjectSnapshot(history, {
        activeLayerId: id,
        hiddenLayerIds: [id],
      }),
    };
  };
  const a = make(false),
    b = make(true);
  assert.notEqual(
    a.doc.storageStats().typedArrayBytes,
    b.doc.storageStats().typedArrayBytes,
  );
  assert.equal(await encoded(a.snapshot), await encoded(b.snapshot));
});

test("ASCII identity order, all hidden preferences, duplicate names, exact Unicode and description escapes", async () => {
  const doc = new MapDocument({
    layers: ["z", "A", "a"].map((id) => ({
      id: layerId(id),
      name: " same name \n",
    })),
  });
  const description =
    "x".repeat(8191) +
    "😀" +
    '\\"\b\f\n\r\t\u0000\u2028\u2029' +
    "e\u0301é\ud800\udc00\ud800end  " +
    "\n".repeat(40000);
  doc.applyCommands(
    ["z", "a", "A"].flatMap((id, i): DocumentCommand[] => [
      {
        kind: "registry" as const,
        id: registryId(id),
        value: { name: " same registry ", rgba: `#00000${i}ff` },
      },
      {
        kind: "annotation" as const,
        id: annotationId(id),
        value: {
          name: "Same area",
          description,
          tier: "detail",
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          label: { placement: "center" },
        },
      },
    ]),
  );
  const snapshot = captureProjectSnapshot(new CommandHistory(doc), {
    activeLayerId: "z",
    hiddenLayerIds: ["z", "a", "A"],
  });
  const output = await encoded(snapshot);
  const parsed: ProjectV1 = JSON.parse(output);
  assert.deepEqual(
    parsed.document.layers.map((l) => l.id),
    ["z", "A", "a"],
  );
  assert.deepEqual(
    parsed.document.registry.map((r) => r.id),
    ["A", "a", "z"],
  );
  assert.deepEqual(
    parsed.document.annotations.map((a) => a.id),
    ["A", "a", "z"],
  );
  assert.deepEqual(parsed.editor.hiddenLayerIds, ["A", "a", "z"]);
  assert.equal(parsed.document.annotations[0].description, description);
  assert.ok(output.includes(`"description":${JSON.stringify(description)}`));
  assert.equal(parsed.document.layers[0].name, " same name \n");
});

test("safe-integer world extremes keep exact coordinates and ordinary integer spelling", async () => {
  for (const min of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 64]) {
    const doc = new MapDocument({
      bounds: { minX: min, minY: min, maxX: min + 64, maxY: min + 64 },
    });
    const id = doc.layers[0].id;
    doc.writeBatch([
      {
        layerId: id,
        x: min,
        y: min + 63,
        length: 64,
        value: rawColor("#00000000"),
      },
    ]);
    const parsed: ProjectV1 = JSON.parse(
      await encoded(
        captureProjectSnapshot(new CommandHistory(doc), {
          activeLayerId: id,
          hiddenLayerIds: [],
        }),
      ),
    );
    assert.deepEqual(parsed.document.bounds, doc.bounds);
    assert.deepEqual(parsed.document.layers[0].runs, [[min, min + 63, 64, 0]]);
  }
});

test("edits, recolor, metadata, layer removal, undo/redo and preferences during async encoding stay in the next save", async () => {
  const session = new EditorSession(exampleDocument());
  session.selectLayer(layerId("buildings"));
  session.setLayerVisible(layerId("buildings"), false);
  // Force several encoding tasks, including a Unicode string spanning chunks.
  session.history.execute("Long description", [
    {
      kind: "annotation",
      id: annotationId("area-house"),
      value: {
        ...session.document.getAnnotation(annotationId("area-house"))!,
        description: "😀\n".repeat(50000),
      },
    },
  ]);
  const snapshot = session.captureProjectSnapshot();
  const expected = await encoded(snapshot);
  let yields = 0;
  const pending = encodeProjectSnapshot(snapshot, {
    yieldControl: async () => {
      yields++;
      if (yields === 1) {
        const registry = new RegistryCommands(session.history);
        registry.commit(
          registry.prepare({
            kind: "edit",
            id: registryId("registry-grass"),
            name: "Recolored",
            color: "#335c46",
          }),
        );
        session.history.execute("Concurrent revision", [
          {
            kind: "bounds",
            bounds: { minX: -128, minY: -128, maxX: 6400, maxY: 6400 },
          },
          { kind: "annotation", id: annotationId("area-house"), value: null },
          {
            kind: "tiles",
            writes: [
              {
                layerId: layerId("terrain"),
                x: 62,
                y: 63,
                length: 4,
                value: rawColor("#ffffffff"),
              },
            ],
          },
          { kind: "remove-layer", id: layerId("buildings") },
          { kind: "rename-layer", id: layerId("terrain"), name: "New terrain" },
        ]);
      } else if (yields === 2) session.history.undo();
      else if (yields === 3) {
        session.history.redo();
        session.setLayerVisible(layerId("terrain"), false);
      }
    },
  });
  assert.equal(text(await pending), expected);
  assert.ok(yields > 3);
  assert.equal(session.history.state.savedRevision, null);
  session.history.markSaved(snapshot.checkpoint);
  assert.equal(session.history.state.dirty, true);
  const current = session.captureProjectSnapshot();
  assert.notEqual(await encoded(current), expected);
  assert.deepEqual(current.project.editor, {
    activeLayerId: "notes",
    hiddenLayerIds: ["terrain"],
  });
  session.dispose();
});

test("default scheduler allows a real timer edit; successful encoding never marks a save", async () => {
  const history = new CommandHistory(exampleDocument());
  const snapshot = captureProjectSnapshot(history, prefs);
  let edited = false;
  const edit = new Promise<void>((resolve) =>
    setTimeout(() => {
      history.execute("While encoding", [
        { kind: "rename-layer", id: layerId("notes"), name: "Later" },
      ]);
      edited = true;
      resolve();
    }, 0),
  );
  const bytes = await encodeProjectSnapshot(snapshot);
  assert.ok(edited);
  await edit;
  assert.deepEqual(JSON.parse(text(bytes)), exampleProject);
  assert.equal(history.state.savedRevision, null);
  assert.equal(history.state.recoveryRevision, null);
});

test("selection, move/transform/paste previews, clipboard and other UI state never enter bytes or get committed", async () => {
  const session = new EditorSession(exampleDocument());
  session.canvasState.set("ready");
  session.selectLayer(layerId("buildings"));
  session.perform("select");
  const point = (x: number, y: number) =>
    tileToScreen(x, y, session.viewport.getSnapshot());
  const initial = await encoded(session.captureProjectSnapshot());
  session.selection.begin(1, point(60, 60));
  session.selection.commit(1, point(67, 67));
  session.perform("copy");
  assert.ok(session.selection.clipboard.getSnapshot());
  for (const preview of ["move", "transform", "paste"]) {
    if (preview === "move") {
      session.selection.begin(2, point(62, 62));
      session.selection.sample(2, point(65, 62));
    } else if (preview === "transform") session.perform("rotate-clockwise");
    else {
      session.pointer.set({ x: 80, y: 80 });
      session.perform("paste");
    }
    const overlay = session.selection.preview.getSnapshot();
    assert.ok(overlay);
    assert.equal(await encoded(session.captureProjectSnapshot()), initial);
    assert.equal(session.selection.preview.getSnapshot(), overlay);
    session.selection.cancel();
  }
  session.setColor("#112233");
  session.setPencilSize(8);
  session.setZoom(0.1);
  session.focus.set("text");
  assert.equal(await encoded(session.captureProjectSnapshot()), initial);
  assert.equal(session.history.state.revision, 0);
  session.dispose();
});

test("clean content still captures preference-only changes without discarding redo", async () => {
  const session = new EditorSession(exampleDocument());
  session.history.markSaved(session.history.captureCheckpoint());
  session.renameLayer(layerId("notes"), "Temporary");
  session.history.undo();
  const before = session.history.state;
  const first = session.captureProjectSnapshot();
  session.selectLayer(layerId("buildings"));
  session.setLayerVisible(layerId("buildings"), false);
  const second = session.captureProjectSnapshot();
  assert.deepEqual(session.history.state, before);
  assert.equal(before.dirty, false);
  assert.equal(before.redoSteps, 1);
  assert.deepEqual(first.project.document, second.project.document);
  assert.notEqual(await encoded(first), await encoded(second));
  session.dispose();
});

test("canceled or failed encoding returns no file and preserves history/checkpoints", async () => {
  const history = new CommandHistory(exampleDocument());
  const snapshot = captureProjectSnapshot(history, prefs),
    before = history.state;
  await assert.rejects(
    encodeProjectSnapshot(snapshot, { signal: { aborted: true } }),
    { category: "canceled" },
  );
  const signal = { aborted: false };
  await assert.rejects(
    encodeProjectSnapshot(snapshot, {
      signal,
      yieldControl: async () => {
        signal.aborted = true;
      },
    }),
    { category: "canceled" },
  );
  await assert.rejects(
    encodeProjectSnapshot(snapshot, {
      yieldControl: async () => {
        throw new Error("Scheduling failed");
      },
    }),
    /Scheduling failed/,
  );
  await assert.rejects(
    encodeProjectSnapshot({ ...snapshot }),
    /captured project snapshot/,
  );
  assert.deepEqual(history.state, before);
  assert.deepEqual(JSON.parse(await encoded(snapshot)), exampleProject);
  history.execute("Large text", [
    {
      kind: "annotation",
      id: annotationId("area-house"),
      value: {
        ...history.document.getAnnotation(annotationId("area-house"))!,
        description: "\n".repeat(100000),
      },
    },
  ]);
  const large = captureProjectSnapshot(history, prefs),
    later = history.state;
  let yields = 0;
  const lateSignal = { aborted: false };
  await assert.rejects(
    encodeProjectSnapshot(large, {
      signal: lateSignal,
      yieldControl: async () => {
        if (++yields === 3) lateSignal.aborted = true;
      },
    }),
    { category: "canceled" },
  );
  assert.equal(yields, 3);
  assert.deepEqual(history.state, later);
});

test("writer refuses unrepresentable metadata and unresolved references without dropping content", () => {
  const errors: [string, (doc: MapDocument) => void][] = [
    [
      "document.bounds",
      (doc) => doc.setBounds({ minX: -64, minY: -64, maxX: 65536, maxY: 6336 }),
    ],
    [
      "document.registry[0].extra",
      (doc) =>
        doc.applyCommands([
          {
            kind: "registry",
            id: registryId("registry-grass"),
            value: { name: "Grass", rgba: "#629653ff", extra: "keep me" },
          },
        ]),
    ],
    [
      "document.registry[0].rgba",
      (doc) =>
        doc.applyCommands([
          {
            kind: "registry",
            id: registryId("registry-grass"),
            value: { name: "Grass", rgba: "#62965380" },
          },
        ]),
    ],
    [
      "document.registry[0].name",
      (doc) =>
        doc.applyCommands([
          {
            kind: "registry",
            id: registryId("registry-grass"),
            value: { name: "  ", rgba: "#629653ff" },
          },
        ]),
    ],
    [
      "document.registry[1].rgba",
      (doc) =>
        doc.applyCommands([
          {
            kind: "registry",
            id: registryId("registry-stone"),
            value: { name: "Duplicate", rgba: "#629653ff" },
          },
        ]),
    ],
    [
      "document.layers[0].runs[0][3]",
      (doc) =>
        doc.applyCommands([
          { kind: "registry", id: registryId("registry-grass"), value: null },
        ]),
    ],
  ];
  for (const [path, change] of errors) {
    const doc = exampleDocument();
    change(doc);
    const state = {
      version: doc.version,
      registry: doc.registryEntries,
      areas: doc.annotations,
      runs: [...doc.iterateRuns()],
    };
    assert.throws(() => capture(doc), {
      name: "ProjectEncodingError",
      category: "invalid-data",
      path,
    });
    assert.deepEqual(
      {
        version: doc.version,
        registry: doc.registryEntries,
        areas: doc.annotations,
        runs: [...doc.iterateRuns()],
      },
      state,
    );
  }
  for (const [field, value] of Object.entries<JsonValue>({
    name: " House ",
    description: null,
    tier: "other",
    bounds: { minX: -65, minY: 0, maxX: 1, maxY: 1 },
    label: { placement: "corner" },
    extra: 1,
  })) {
    const doc = exampleDocument(),
      id = annotationId("area-house");
    doc.applyCommands([
      {
        kind: "annotation",
        id,
        value: { ...doc.getAnnotation(id)!, [field]: value },
      },
    ]);
    assert.throws(() => capture(doc), {
      category: "invalid-data",
      path: `document.annotations[0].${field}`,
    });
  }
  for (const [field, value, path] of [
    [
      "bounds",
      { ...exampleProject.document.annotations[0].bounds, extra: true },
      "bounds.extra",
    ],
    ["label", { placement: "center", anchor: [1, 2] }, "label.anchor"],
    ["bounds", null, "bounds"],
    ["label", {}, "label.placement"],
  ] as const) {
    const doc = exampleDocument(),
      id = annotationId("area-house");
    doc.applyCommands([
      {
        kind: "annotation",
        id,
        value: { ...doc.getAnnotation(id)!, [field]: value },
      },
    ]);
    assert.throws(() => capture(doc), {
      category: "invalid-data",
      path: `document.annotations[0].${path}`,
    });
  }
  for (const [preferences, path] of [
    [{ activeLayerId: "missing", hiddenLayerIds: [] }, "editor.activeLayerId"],
    [
      { activeLayerId: "terrain", hiddenLayerIds: ["missing"] },
      "editor.hiddenLayerIds[0]",
    ],
    [
      { activeLayerId: "terrain", hiddenLayerIds: ["notes", "notes"] },
      "editor.hiddenLayerIds[1]",
    ],
  ] as const)
    assert.throws(
      () =>
        captureProjectSnapshot(
          new CommandHistory(exampleDocument()),
          preferences,
        ),
      { category: "invalid-data", path },
    );
});

test("all writer capacities reject whole snapshots; UTF-8 byte ceiling includes escaping and trailing LF", async () => {
  const exact = {
    maxLayers: 3,
    maxRegistryEntries: 3,
    maxAnnotations: 3,
    maxPaletteEntries: 5,
    maxRuns: 9,
    maxOccupiedCells: 16,
  };
  assert.deepEqual(capture(exampleDocument(), exact).project, exampleProject);
  for (const key of Object.keys(exact) as (keyof typeof exact)[]) {
    assert.throws(
      () => capture(exampleDocument(), { [key]: exact[key] - 1 }),
      (error: unknown) =>
        error instanceof ProjectEncodingError && error.category === "capacity",
    );
  }
  for (const value of [0, -1, 1.5, Infinity, PROJECT_LIMITS.maxBytes + 1])
    assert.throws(
      () => capture(exampleDocument(), { maxBytes: value }),
      /Project limit/,
    );
  const doc = exampleDocument();
  const full = await encodeProjectSnapshot(capture(doc), fast);
  assert.deepEqual(
    await encodeProjectSnapshot(capture(doc, { maxBytes: full.length }), fast),
    full,
  );
  await assert.rejects(
    encodeProjectSnapshot(capture(doc, { maxBytes: full.length - 1 }), fast),
    { category: "capacity", path: "project.bytes" },
  );
  assert.ok(
    full.length > text(full).length,
    "Limit counts UTF-8, not UTF-16 characters",
  );
});

for (const fixture of FIXTURES)
  test(`${fixture.id}: encoded whole map matches independent golden hash and all schema fields`, async (t) => {
    const doc = populatedProjectDocument(fixture);
    const history = new CommandHistory(doc);
    const started = performance.now();
    const snapshot = captureProjectSnapshot(history, {
      activeLayerId: "furniture",
      hiddenLayerIds: ["canopy", "buildings"],
    });
    const captured = performance.now();
    const bytes = await encodeProjectSnapshot(snapshot);
    const finished = performance.now();
    const parsed: ProjectV1 = JSON.parse(text(bytes));
    const expected = JSON.parse(
      readFileSync(
        new URL("../fixtures/expected.json", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      inspectFixture(fixture, fixtureRunsFromProject(parsed)),
      expected[fixture.id],
    );
    assert.equal(parsed.format, "tilewright-project");
    assert.equal(parsed.version, 1);
    assert.deepEqual(parsed.document.bounds, doc.bounds);
    assert.deepEqual(
      parsed.document.layers.map(({ id, name }) => ({ id, name })),
      doc.layers,
    );
    assert.deepEqual(
      parsed.document.registry,
      doc.registryEntries.map(([id, record]) => ({ id, ...record })),
    );
    assert.deepEqual(
      parsed.document.annotations,
      doc.annotations.map(([id, record]) => ({ id, ...record })),
    );
    assert.equal(parsed.document.annotations.length, 1089);
    assert.deepEqual(parsed.document.palette, [
      rawColor(FIXTURE_PALETTE[4].rgba),
      ...["grass", "leaves", "stone", "water", "wood"].map((id) =>
        registeredColor(registryId(id)),
      ),
    ]);
    assert.deepEqual(parsed.editor, {
      activeLayerId: "furniture",
      hiddenLayerIds: ["buildings", "canopy"],
    });
    assert.deepEqual(Object.keys(parsed).sort(), [
      "document",
      "editor",
      "format",
      "version",
    ]);
    assert.deepEqual(Object.keys(parsed.document).sort(), [
      "annotations",
      "bounds",
      "layers",
      "palette",
      "registry",
    ]);
    assert.equal(history.state.savedRevision, null);
    t.diagnostic(
      JSON.stringify({
        fixture: fixture.id,
        bytes: bytes.length,
        captureMs: captured - started,
        encodeMs: finished - captured,
        canonicalRuns: parsed.document.layers.reduce(
          (sum, layer) => sum + layer.runs.length,
          0,
        ),
        note: "Single Node test sample, includes concurrent test load; no native I/O or performance gate.",
      }),
    );
  });
