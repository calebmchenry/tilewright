import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import type { DocumentCommand, JsonValue } from "../../src/domain/commands.ts";
import type { AgentMapV1 } from "../../src/domain/agent-export-format.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import {
  AGENT_EXPORT_LIMITS,
  AgentExportError,
  captureAgentExportSnapshot,
  encodeAgentExportSnapshot,
  type AgentExportLimits,
  type AgentExportSnapshot,
} from "../../src/domain/agent-export.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import {
  agentExampleDocument,
  exampleAgentMap,
  populatedAgentDocument,
  fixtureRunsFromAgentMap,
} from "../fixtures/agent-export.ts";
import { FIXTURES, FIXTURE_PALETTE } from "../fixtures/maps.ts";
import { inspectFixture } from "../fixtures/inspect.ts";

const text = (bytes: Uint8Array) =>
  new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const fast = { yieldControl: async () => {} };
const capture = (
  document = agentExampleDocument(),
  limits?: Partial<AgentExportLimits>,
) => captureAgentExportSnapshot(new CommandHistory(document), { limits });
const encoded = async (snapshot: AgentExportSnapshot) =>
  text(await encodeAgentExportSnapshot(snapshot, fast));
// Independent full-object oracle for canonical key order and string escaping.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, canonical(child)]),
    );
  return value;
}

test("agent export matches the reviewed golden example and canonical hash across insertion/token histories", async () => {
  for (const reverse of [false, true]) {
    const document = agentExampleDocument(reverse);
    document.setCell(layerId("buildings"), 4, 3, rawColor("#abcdef80"));
    document.clearCell(layerId("buildings"), 4, 3);
    const history = new CommandHistory(document),
      before = history.state;
    const snapshot = captureAgentExportSnapshot(history);
    const bytes = await encodeAgentExportSnapshot(snapshot, fast);
    assert.deepEqual(JSON.parse(text(bytes)), exampleAgentMap);
    assert.equal(bytes.length, 1133);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      "587bcfbd3100fe9d437cb430750d9f1a7a0db1e8ff4a4e9be7b6379393ba5380",
    );
    const frozen = (value: unknown): void => {
      if (value && typeof value === "object") {
        assert.ok(Object.isFrozen(value));
        for (const child of Object.values(value)) frozen(child);
      }
    };
    frozen(snapshot);
    assert.deepEqual(history.state, before);
  }
});

test("recolor resolves the current name and RGBA without changing any layer associations or matching raw paint", async () => {
  const history = new CommandHistory(agentExampleDocument());
  const registry = new RegistryCommands(history);
  const before = captureAgentExportSnapshot(history);
  registry.commit(
    registry.prepare({
      kind: "edit",
      id: registryId("grass"),
      name: "Meadow",
      color: "#335c46",
    }),
  );
  const after: AgentMapV1 = JSON.parse(
    await encoded(captureAgentExportSnapshot(history)),
  );
  assert.deepEqual(after, {
    ...exampleAgentMap,
    colors: exampleAgentMap.colors.map((color) =>
      color.kind === "registered" && color.registryId === "grass"
        ? { ...color, rgba: "#335c46ff", meaning: "Meadow" }
        : color,
    ),
  });
  assert.deepEqual(JSON.parse(await encoded(before)), exampleAgentMap);
  history.undo();
  assert.equal(
    await encoded(captureAgentExportSnapshot(history)),
    await encoded(before),
  );
  history.redo();
  assert.deepEqual(
    JSON.parse(await encoded(captureAgentExportSnapshot(history))),
    after,
  );
});

test("empty maximum-size maps keep dimensions, empty named layers, unused meanings and all area tiers", async () => {
  const doc = new MapDocument({
    bounds: { minX: -0, minY: -0, maxX: 65536, maxY: 65536 },
    layers: ["z", "A", "a"].map((id) => ({
      id: layerId(id),
      name: " same layer \n",
    })),
  });
  doc.applyCommands(
    ["z", "a", "A"].flatMap((id, i): DocumentCommand[] => [
      {
        kind: "registry",
        id: registryId(id),
        value: { name: " same meaning ", rgba: `#00000${i}ff` },
      },
      {
        kind: "annotation",
        id: annotationId(id),
        value: {
          name: "Same area",
          description: "",
          tier: ["region", "locality", "detail"][i],
          bounds: { minX: 65535, minY: 65535, maxX: 65536, maxY: 65536 },
          label: { placement: "center" },
        },
      },
    ]),
  );
  const output = await encoded(capture(doc));
  const parsed: AgentMapV1 = JSON.parse(output);
  assert.deepEqual(parsed.bounds, {
    minX: 0,
    minY: 0,
    maxX: 65536,
    maxY: 65536,
  });
  assert.deepEqual(
    parsed.layers,
    doc.layers.map((layer) => ({ ...layer, runs: [] })),
  );
  assert.deepEqual(
    parsed.colors.map(
      (color) => color.kind === "registered" && color.registryId,
    ),
    ["A", "a", "z"],
  );
  assert.deepEqual(
    parsed.areas,
    doc.annotations.map(([id, { label: _label, ...area }]) => ({
      id,
      ...area,
    })),
  );
  assert.deepEqual(
    parsed.areas.map((area) => area.tier),
    ["detail", "locality", "region"],
  );
  assert.equal(output, JSON.stringify(canonical(parsed)) + "\n");
  assert.equal(doc.storageStats().partitions, 0);
  assert.equal(doc.storageStats().typedArrayBytes, 0);
});

test("unregistered-only and fully empty maps need no invented meaning or sentinel color", async () => {
  const doc = new MapDocument();
  assert.deepEqual(JSON.parse(await encoded(capture(doc))).colors, []);
  doc.setCell(doc.layers[0].id, 255, 255, rawColor("#00000000"));
  const parsed: AgentMapV1 = JSON.parse(await encoded(capture(doc)));
  assert.deepEqual(parsed.colors, [
    { kind: "raw", rgba: "#00000000", meaning: null },
  ]);
  assert.deepEqual(parsed.layers[0].runs, [[255, 255, 1, 0]]);
});

test("runs coalesce across negative/positive partition and chunk boundaries but never across gaps or rows", async () => {
  const make = (dense: boolean) => {
    const doc = new MapDocument({
      bounds: { minX: -128, minY: -128, maxX: 128, maxY: 128 },
    });
    const layer = doc.layers[0].id,
      value = rawColor("#ABCDEF80");
    if (dense)
      doc.writeBatch(
        Array.from({ length: 8 }, (_, y) => ({
          layerId: layer,
          x: -128,
          y,
          length: 256,
          value,
        })),
      );
    for (const y of [0, 1])
      for (let x = 65; x >= -65; x--) doc.setCell(layer, x, y, value);
    if (dense) {
      doc.writeBatch(
        Array.from({ length: 8 }, (_, y) => ({
          layerId: layer,
          x: -128,
          y,
          length: 256,
          value: null,
        })),
      );
      doc.writeBatch(
        [0, 1].map((y) => ({ layerId: layer, x: -65, y, length: 131, value })),
      );
    }
    doc.clearCell(layer, -1, 0);
    doc.setCell(layer, 127, 127, rawColor("#ffffffff"));
    const history = new CommandHistory(doc);
    history.execute("Temporary", [
      {
        kind: "tiles",
        writes: [{ layerId: layer, x: 100, y: 100, length: 1, value }],
      },
    ]);
    history.undo();
    return captureAgentExportSnapshot(history);
  };
  const a = make(false),
    b = make(true);
  assert.equal(await encoded(a), await encoded(b));
  assert.deepEqual(a.map.layers[0].runs, [
    [-65, 0, 64, 0],
    [0, 0, 66, 0],
    [-65, 1, 131, 0],
    [127, 127, 1, 1],
  ]);
});

test("safe-integer extremes keep exact addresses and integer spelling", async () => {
  for (const min of [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 64]) {
    const doc = new MapDocument({
      bounds: { minX: min, minY: min, maxX: min + 64, maxY: min + 64 },
    });
    doc.writeBatch([
      {
        layerId: doc.layers[0].id,
        x: min,
        y: min + 63,
        length: 64,
        value: rawColor("#ffffff00"),
      },
    ]);
    const parsed: AgentMapV1 = JSON.parse(await encoded(capture(doc)));
    assert.deepEqual(parsed.bounds, doc.bounds);
    assert.deepEqual(parsed.layers[0].runs, [[min, min + 63, 64, 0]]);
  }
});

test("long Unicode, escapes, unpaired surrogates and descriptions retain exact ECMAScript JSON spelling", async () => {
  const doc = agentExampleDocument();
  const description =
    "x".repeat(8191) +
    "😀" +
    '\\"\b\f\n\r\t\u0000\u2028\u2029' +
    "e\u0301é\ud800\udc00\ud800end  " +
    "\n".repeat(40000);
  doc.applyCommands([
    {
      kind: "annotation",
      id: annotationId("house"),
      value: { ...doc.getAnnotation(annotationId("house"))!, description },
    },
  ]);
  const snapshot = capture(doc),
    output = await encoded(snapshot);
  assert.equal(output, JSON.stringify(canonical(snapshot.map)) + "\n");
  assert.equal(JSON.parse(output).areas[0].description, description);
});

test("source validation rejects invalid metadata and dangling registry references, including unused entries", () => {
  const mutations: [string, (doc: MapDocument) => void][] = [
    [
      "bounds",
      (doc) => doc.setBounds({ minX: -1, minY: -1, maxX: 65536, maxY: 4 }),
    ],
    [
      "layers[0].runs[1][3]",
      (doc) =>
        doc.applyCommands([
          { kind: "registry", id: registryId("grass"), value: null },
        ]),
    ],
  ];
  for (const [field, value] of Object.entries<JsonValue>({
    name: " ",
    rgba: "#62965380",
    extra: true,
  }))
    mutations.push([
      `registry[2].${field}`,
      (doc) =>
        doc.applyCommands([
          {
            kind: "registry",
            id: registryId("water"),
            value: {
              ...doc.getRegistryEntry(registryId("water"))!,
              [field]: value,
            },
          },
        ]),
    ]);
  mutations.push([
    "registry[2].rgba",
    (doc) =>
      doc.applyCommands([
        {
          kind: "registry",
          id: registryId("water"),
          value: { name: "Duplicate", rgba: "#629653ff" },
        },
      ]),
  ]);
  mutations.push([
    "registry[2].name",
    (doc) =>
      doc.applyCommands([
        {
          kind: "registry",
          id: registryId("water"),
          value: { rgba: "#417aabff" },
        },
      ]),
  ]);
  for (const [field, value] of Object.entries<JsonValue>({
    name: " House ",
    description: null,
    tier: "other",
    bounds: { minX: -2, minY: 0, maxX: 1, maxY: 1 },
    label: { placement: "corner" },
    extra: 1,
  }))
    mutations.push([
      `areas[0].${field}`,
      (doc) =>
        doc.applyCommands([
          {
            kind: "annotation",
            id: annotationId("house"),
            value: {
              ...doc.getAnnotation(annotationId("house"))!,
              [field]: value,
            },
          },
        ]),
    ]);
  for (const [field, value, path] of [
    [
      "bounds",
      { ...exampleAgentMap.areas[0].bounds, extra: true },
      "bounds.extra",
    ],
    ["bounds", null, "bounds"],
    ["label", {}, "label.placement"],
    ["label", { placement: "center", extra: true }, "label.extra"],
    ["name", "House\nAnnex", "name"],
  ] as const)
    mutations.push([
      `areas[0].${path}`,
      (doc) =>
        doc.applyCommands([
          {
            kind: "annotation",
            id: annotationId("house"),
            value: {
              ...doc.getAnnotation(annotationId("house"))!,
              [field]: value,
            },
          },
        ]),
    ]);
  for (const [path, mutate] of mutations) {
    const doc = agentExampleDocument();
    mutate(doc);
    const history = new CommandHistory(doc),
      before = history.state;
    const content = {
      version: doc.version,
      registry: doc.registryEntries,
      areas: doc.annotations,
      runs: [...doc.iterateRuns()],
    };
    assert.throws(() => captureAgentExportSnapshot(history), {
      name: "AgentExportError",
      category: "invalid-data",
      path,
    });
    assert.deepEqual(history.state, before);
    assert.deepEqual(
      {
        version: doc.version,
        registry: doc.registryEntries,
        areas: doc.annotations,
        runs: [...doc.iterateRuns()],
      },
      content,
    );
  }
  const doc = new MapDocument();
  doc.setCell(
    doc.layers[0].id,
    255,
    255,
    registeredColor(registryId("missing")),
  );
  assert.throws(() => capture(doc), {
    category: "invalid-data",
    path: "layers[0].runs[0][3]",
  });
});

test("every capacity counts complete content, with exact UTF-8 bytes including escaped text and trailing LF", async () => {
  const exact = {
    maxLayers: 2,
    maxRegistryEntries: 3,
    maxAreas: 2,
    maxColors: 6,
    maxRuns: 8,
    maxOccupiedCells: 18,
  };
  assert.deepEqual(capture(agentExampleDocument(), exact).map, exampleAgentMap);
  for (const key of Object.keys(exact) as (keyof typeof exact)[])
    assert.throws(
      () => capture(agentExampleDocument(), { [key]: exact[key] - 1 }),
      (error: unknown) =>
        error instanceof AgentExportError && error.category === "capacity",
    );
  // Unused registry colors count even with no occupied cells.
  const empty = new MapDocument();
  empty.applyCommands(
    ["a", "b"].map((id, i) => ({
      kind: "registry",
      id: registryId(id),
      value: { name: id, rgba: `#00000${i}ff` },
    })),
  );
  assert.throws(() => capture(empty, { maxColors: 1 }), {
    category: "capacity",
    path: "colors",
  });
  for (const value of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    AGENT_EXPORT_LIMITS.maxBytes + 1,
  ])
    assert.throws(
      () => capture(agentExampleDocument(), { maxBytes: value }),
      /Agent export limit/,
    );
  assert.throws(
    () =>
      capture(agentExampleDocument(), {
        unknown: 1,
      } as Partial<AgentExportLimits>),
    /Agent export limit/,
  );
  const full = await encodeAgentExportSnapshot(capture(), fast);
  assert.deepEqual(
    await encodeAgentExportSnapshot(
      capture(agentExampleDocument(), { maxBytes: full.length }),
      fast,
    ),
    full,
  );
  await assert.rejects(
    encodeAgentExportSnapshot(
      capture(agentExampleDocument(), { maxBytes: full.length - 1 }),
      fast,
    ),
    { category: "capacity", path: "export.bytes" },
  );
  assert.ok(full.length > text(full).length);
});

test("cancellation, scheduler failure and forged snapshots yield no output or history/checkpoint changes", async () => {
  const doc = agentExampleDocument();
  doc.applyCommands([
    {
      kind: "annotation",
      id: annotationId("house"),
      value: {
        ...doc.getAnnotation(annotationId("house"))!,
        description: "😀\n".repeat(200000),
      },
    },
  ]);
  const history = new CommandHistory(doc),
    snapshot = captureAgentExportSnapshot(history),
    before = history.state;
  await assert.rejects(
    encodeAgentExportSnapshot(snapshot, { signal: { aborted: true } }),
    { category: "canceled" },
  );
  for (const cancelAt of [1, 3]) {
    let yields = 0;
    const signal = { aborted: false };
    await assert.rejects(
      encodeAgentExportSnapshot(snapshot, {
        signal,
        yieldControl: async () => {
          if (++yields === cancelAt) signal.aborted = true;
        },
      }),
      { category: "canceled" },
    );
    assert.equal(yields, cancelAt);
  }
  await assert.rejects(
    encodeAgentExportSnapshot(snapshot, {
      yieldControl: async () => {
        throw new Error("Scheduler failed");
      },
    }),
    /Scheduler failed/,
  );
  await assert.rejects(
    encodeAgentExportSnapshot({ ...snapshot }),
    /captured agent export snapshot/,
  );
  await assert.rejects(
    encodeAgentExportSnapshot({ map: exampleAgentMap } as AgentExportSnapshot),
    /captured agent export snapshot/,
  );
  assert.deepEqual(history.state, before);
  assert.equal(
    await encoded(snapshot),
    JSON.stringify(canonical(snapshot.map)) + "\n",
  );
});

for (const fixture of FIXTURES)
  test(`${fixture.id}: full model export reproduces the independent golden content hash, all meanings and 1,089 areas`, async (t) => {
    const doc = populatedAgentDocument(fixture),
      history = new CommandHistory(doc),
      before = history.state;
    const started = performance.now(),
      snapshot = captureAgentExportSnapshot(history),
      captured = performance.now();
    const bytes = await encodeAgentExportSnapshot(snapshot),
      finished = performance.now();
    const parsed: AgentMapV1 = JSON.parse(text(bytes));
    const expected = JSON.parse(
      readFileSync(
        new URL("../fixtures/expected.json", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      inspectFixture(fixture, fixtureRunsFromAgentMap(parsed)),
      expected[fixture.id],
    );
    assert.deepEqual(parsed.bounds, doc.bounds);
    assert.deepEqual(
      parsed.layers.map(({ id, name }) => ({ id, name })),
      doc.layers,
    );
    assert.deepEqual(parsed.colors, [
      { kind: "raw", rgba: FIXTURE_PALETTE[4].rgba, meaning: null },
      ...doc.registryEntries.map(([id, record]) => ({
        kind: "registered",
        registryId: id,
        rgba: record.rgba,
        meaning: record.name,
      })),
    ]);
    assert.deepEqual(
      parsed.areas,
      doc.annotations.map(([id, { label: _label, ...area }]) => ({
        id,
        ...area,
      })),
    );
    assert.equal(parsed.areas.length, 1089);
    assert.deepEqual(Object.keys(parsed), [
      "areas",
      "bounds",
      "colors",
      "format",
      "layers",
      "version",
    ]);
    assert.equal(parsed.format, "tilewright-agent-map");
    assert.equal(parsed.version, 1);
    assert.deepEqual(history.state, before);
    t.diagnostic(
      JSON.stringify({
        fixture: fixture.id,
        bytes: bytes.length,
        captureMs: captured - started,
        encodeMs: finished - captured,
        canonicalRuns: parsed.layers.reduce(
          (n, layer) => n + layer.runs.length,
          0,
        ),
        occupiedLayerCells: expected[fixture.id].occupiedLayerCells,
        contentSha256: expected[fixture.id].contentSha256,
        note: "Single Node sample; no native I/O, peak memory or performance gate.",
      }),
    );
  });
