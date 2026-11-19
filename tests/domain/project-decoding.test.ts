import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { decodeProject } from "../../src/domain/project-decoding.ts";
import { parseProjectJson } from "../../src/domain/project-json.ts";
import {
  captureProjectSnapshot,
  encodeProjectSnapshot,
} from "../../src/domain/project.ts";
import {
  ProjectDecodingError,
  type ProjectLimits,
} from "../../src/domain/project-format.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  exampleProject,
  exampleDocument,
  populatedProjectDocument,
} from "../fixtures/project.ts";
import { fixtureRunsFromDocument } from "../fixtures/document.ts";
import { FIXTURES } from "../fixtures/maps.ts";
import { inspectFixture } from "../fixtures/inspect.ts";

const fast = { yieldControl: async () => {} };
const bytes = (text: string) => new TextEncoder().encode(text);
const json = (value: unknown) => bytes(JSON.stringify(value));
const fixture = () => JSON.parse(JSON.stringify(exampleProject));
const snapshot = (document: MapDocument, preferences = exampleProject.editor) =>
  captureProjectSnapshot(new CommandHistory(document), preferences);
const errorAt =
  (category: ProjectDecodingError["category"], path?: string) =>
  (error: unknown) => {
    assert.ok(error instanceof ProjectDecodingError);
    assert.equal(error.category, category);
    if (path) assert.equal(error.path, path);
    assert.ok(error.message.length > error.path.length + 10);
    return true;
  };

test("reviewed pretty and canonical golden projects reconstruct every field, hole and identity", async () => {
  const expected = exampleDocument();
  const golden = readFileSync(
    new URL("../fixtures/project-v1.canonical.tilewright", import.meta.url),
  );
  for (const input of [
    golden,
    readFileSync(
      new URL("../../docs/examples/project-v1.tilewright", import.meta.url),
    ),
  ]) {
    const loaded = await decodeProject(input, fast);
    assert.deepEqual(
      snapshot(loaded.document, loaded.preferences).project,
      snapshot(expected).project,
    );
    assert.deepEqual(
      [...loaded.document.iterateRuns()],
      [...expected.iterateRuns()],
    );
    assert.deepEqual(loaded.document.registryEntries, expected.registryEntries);
    assert.deepEqual(loaded.document.annotations, expected.annotations);
    assert.deepEqual(loaded.preferences, exampleProject.editor);
    assert.equal(loaded.document.storageStats().occupiedCells, 16);
    assert.deepEqual(
      loaded.document.getCell(layerId("terrain"), 64, 64),
      rawColor("#00000000"),
    );
    assert.equal(loaded.document.getCell(layerId("buildings"), 62, 63), null);
    assert.deepEqual(
      loaded.document.getCell(layerId("terrain"), 63, 63),
      registeredColor(registryId("registry-grass")),
    );
    assert.deepEqual(
      await encodeProjectSnapshot(
        snapshot(loaded.document, loaded.preferences),
        fast,
      ),
      new Uint8Array(golden),
    );
  }
});

test("recolor across hidden underlying layers preserves IDs, unused entries and same-color raw paint after reopening", async () => {
  const document = exampleDocument();
  const grass = registryId("registry-grass");
  document.setCell(layerId("buildings"), 70, 70, registeredColor(grass));
  const history = new CommandHistory(document);
  const commands = new RegistryCommands(history);
  commands.commit(
    commands.prepare({
      kind: "edit",
      id: grass,
      name: "Grass renamed",
      color: "#335c46",
    }),
  );
  const before = captureProjectSnapshot(history, exampleProject.editor);
  const loaded = await decodeProject(
    await encodeProjectSnapshot(before, fast),
    fast,
  );
  assert.deepEqual(
    snapshot(loaded.document, loaded.preferences).project,
    before.project,
  );
  assert.deepEqual(
    loaded.document.getCell(layerId("terrain"), 62, 64),
    rawColor("#629653ff"),
  );
  assert.deepEqual(
    loaded.document.getCell(layerId("buildings"), 70, 70),
    registeredColor(grass),
  );
  const reopenedHistory = new CommandHistory(loaded.document);
  const reopenedCommands = new RegistryCommands(reopenedHistory);
  reopenedCommands.commit(
    reopenedCommands.prepare({
      kind: "edit",
      id: grass,
      name: "Grass again",
      color: "#113355",
    }),
  );
  assert.equal(loaded.document.getRegistryEntry(grass)?.rgba, "#113355ff");
  assert.deepEqual(
    loaded.document.getCell(layerId("terrain"), 63, 63),
    registeredColor(grass),
  );
});

test("valid noncanonical ordering, split spans, whitespace, text and identity namespaces round trip", async () => {
  const project = fixture();
  project.document.registry.reverse();
  project.document.annotations.reverse();
  project.document.palette.reverse();
  for (const layer of project.document.layers)
    for (const run of layer.runs) run[3] = 4 - run[3];
  project.document.layers[0].runs.splice(1, 1, [62, 63, 2, 1], [64, 63, 2, 1]);
  project.document.layers[2].id = "registry-grass"; // legal across namespaces
  project.document.layers[2].name = "  Terrain  ";
  project.document.registry[0].name = "  Grass  ";
  project.document.annotations[0].description =
    ' \" \\ \b \f \n \r \t <script> 😀 é \ud800 \udfff ' + "🌳".repeat(20_000);
  project.editor.hiddenLayerIds = ["registry-grass", "terrain", "buildings"];
  const loaded = await decodeProject(
    bytes("\r\n\t " + JSON.stringify(project) + " \n"),
    fast,
  );
  assert.equal(
    loaded.document.annotations.find(
      ([id]) => id === project.document.annotations[0].id,
    )![1].description,
    project.document.annotations[0].description,
  );
  assert.equal(loaded.document.layers[2].name, "  Terrain  ");
  assert.deepEqual(loaded.preferences, project.editor);
  const canonical = await encodeProjectSnapshot(
    snapshot(loaded.document, loaded.preferences),
    fast,
  );
  const again = await decodeProject(canonical, fast);
  assert.deepEqual(
    snapshot(again.document, again.preferences).project,
    snapshot(loaded.document, loaded.preferences).project,
  );
});

const invalidCases: [
  string,
  (p: ReturnType<typeof fixture>) => void,
  string,
][] = [
  ["wrong format", (p) => (p.format = "tilewright-export"), "format"],
  ["zero version", (p) => (p.version = 0), "version"],
  ["negative version", (p) => (p.version = -1), "version"],
  ["string version", (p) => (p.version = "1"), "version"],
  ["null document", (p) => (p.document = null), "document"],
  ["empty layers", (p) => (p.document.layers = []), "document.layers"],
  ["non-array layers", (p) => (p.document.layers = {}), "document.layers"],
  ["null layer", (p) => (p.document.layers[0] = null), "document.layers[0]"],
  [
    "duplicate layer",
    (p) => (p.document.layers[1].id = "terrain"),
    "document.layers[1].id",
  ],
  [
    "invalid ID",
    (p) => (p.document.layers[0].id = "-bad"),
    "document.layers[0].id",
  ],
  [
    "long ID",
    (p) => (p.document.layers[0].id = "a".repeat(129)),
    "document.layers[0].id",
  ],
  [
    "blank layer name",
    (p) => (p.document.layers[0].name = " \n"),
    "document.layers[0].name",
  ],
  ["zero bounds", (p) => (p.document.bounds.maxX = -64), "document.bounds"],
  [
    "inverted bounds",
    (p) => (p.document.bounds.minY = 8000),
    "document.bounds",
  ],
  ["too wide", (p) => (p.document.bounds.maxX = 65537), "document.bounds"],
  [
    "unsafe dimensions",
    (p) => {
      p.document.bounds.minX = -9007199254740991;
      p.document.bounds.maxX = 9007199254740991;
    },
    "document.bounds",
  ],
  [
    "string coordinate",
    (p) => (p.document.bounds.minX = "-64"),
    "document.bounds",
  ],
  [
    "empty paint",
    (p) => (p.document.palette[0] = null),
    "document.palette[0].kind",
  ],
  [
    "unknown paint",
    (p) => (p.document.palette[0].kind = "empty"),
    "document.palette[0].kind",
  ],
  [
    "uppercase paint",
    (p) => (p.document.palette[0].rgba = "#AABBCC00"),
    "document.palette[0].rgba",
  ],
  [
    "short paint",
    (p) => (p.document.palette[0].rgba = "#000"),
    "document.palette[0].rgba",
  ],
  [
    "duplicate paint",
    (p) => p.document.palette.push(p.document.palette[0]),
    "document.palette[5]",
  ],
  [
    "unused paint",
    (p) => p.document.palette.push({ kind: "raw", rgba: "#12345678" }),
    "document.palette",
  ],
  [
    "dangling registry",
    (p) => (p.document.palette[3].registryId = "missing"),
    "document.palette[3].registryId",
  ],
  [
    "case-sensitive registry",
    (p) => (p.document.palette[3].registryId = "Registry-grass"),
    "document.palette[3].registryId",
  ],
  [
    "duplicate registry ID",
    (p) => (p.document.registry[1].id = "registry-grass"),
    "document.registry[1].id",
  ],
  [
    "registry color collision",
    (p) => (p.document.registry[1].rgba = p.document.registry[0].rgba),
    "document.registry[1].rgba",
  ],
  [
    "transparent registry",
    (p) => (p.document.registry[0].rgba = "#62965300"),
    "document.registry[0].rgba",
  ],
  [
    "registry name type",
    (p) => (p.document.registry[0].name = 1),
    "document.registry[0].name",
  ],
  [
    "non-array runs",
    (p) => (p.document.layers[0].runs = {}),
    "document.layers[0].runs",
  ],
  [
    "short tuple",
    (p) => p.document.layers[0].runs[0].pop(),
    "document.layers[0].runs[0]",
  ],
  [
    "long tuple",
    (p) => p.document.layers[0].runs[0].push(0),
    "document.layers[0].runs[0]",
  ],
  [
    "tuple scalar",
    (p) => (p.document.layers[0].runs[0] = 4),
    "document.layers[0].runs[0]",
  ],
  [
    "boolean tuple",
    (p) => (p.document.layers[0].runs[0][0] = false),
    "document.layers[0].runs[0]",
  ],
  [
    "zero length",
    (p) => (p.document.layers[0].runs[0][2] = 0),
    "document.layers[0].runs[0]",
  ],
  [
    "negative length",
    (p) => (p.document.layers[0].runs[0][2] = -1),
    "document.layers[0].runs[0]",
  ],
  [
    "huge span",
    (p) => (p.document.layers[0].runs[0][2] = 1000000000),
    "document.layers[0].runs[0]",
  ],
  [
    "unsafe span sum",
    (p) => (p.document.layers[0].runs[0] = [9007199254740990, 0, 4, 0]),
    "document.layers[0].runs[0]",
  ],
  [
    "outside left",
    (p) => (p.document.layers[0].runs[0][0] = -65),
    "document.layers[0].runs[0]",
  ],
  [
    "outside bottom",
    (p) => (p.document.layers[0].runs[0][1] = 6336),
    "document.layers[0].runs[0]",
  ],
  [
    "cross right edge",
    (p) => (p.document.layers[0].runs[4][2] = 2),
    "document.layers[0].runs[4]",
  ],
  [
    "overlapping span",
    (p) => p.document.layers[0].runs.splice(1, 0, [-1, -1, 1, 3]),
    "document.layers[0].runs[1]",
  ],
  [
    "unsorted y",
    (p) => p.document.layers[0].runs.reverse(),
    "document.layers[0].runs[1]",
  ],
  [
    "unsorted x",
    (p) => p.document.layers[0].runs.splice(1, 0, [-5, -1, 1, 3]),
    "document.layers[0].runs[1]",
  ],
  [
    "negative palette index",
    (p) => (p.document.layers[0].runs[0][3] = -1),
    "document.layers[0].runs[0][3]",
  ],
  [
    "missing palette index",
    (p) => (p.document.layers[0].runs[0][3] = 5),
    "document.layers[0].runs[0][3]",
  ],
  [
    "duplicate area",
    (p) => (p.document.annotations[1].id = p.document.annotations[0].id),
    "document.annotations[1].id",
  ],
  [
    "blank area",
    (p) => (p.document.annotations[0].name = ""),
    "document.annotations[0].name",
  ],
  [
    "untrimmed area",
    (p) => (p.document.annotations[0].name += " "),
    "document.annotations[0].name",
  ],
  [
    "multiline area",
    (p) => (p.document.annotations[0].name += "\u2028x"),
    "document.annotations[0].name",
  ],
  [
    "invalid description",
    (p) => (p.document.annotations[0].description = []),
    "document.annotations[0].description",
  ],
  [
    "invalid tier",
    (p) => (p.document.annotations[0].tier = "custom"),
    "document.annotations[0].tier",
  ],
  [
    "outside area",
    (p) => (p.document.annotations[0].bounds.minX = -65),
    "document.annotations[0].bounds",
  ],
  [
    "invalid placement",
    (p) => (p.document.annotations[0].label.placement = "corner"),
    "document.annotations[0].label",
  ],
  [
    "unknown active layer",
    (p) => (p.editor.activeLayerId = "missing"),
    "editor.activeLayerId",
  ],
  [
    "unknown hidden layer",
    (p) => p.editor.hiddenLayerIds.push("missing"),
    "editor.hiddenLayerIds[1]",
  ],
  [
    "duplicate hidden layer",
    (p) => p.editor.hiddenLayerIds.push("buildings"),
    "editor.hiddenLayerIds[1]",
  ],
  [
    "non-array hidden layers",
    (p) => (p.editor.hiddenLayerIds = null),
    "editor.hiddenLayerIds",
  ],
];
for (const [label, mutate, path] of invalidCases)
  test(`invalid schema: ${label}`, async (t) => {
    t.mock.method(MapDocument.prototype, "writeBatch", () => {
      assert.fail("Invalid schema reached storage");
    });
    const project = fixture();
    mutate(project);
    await assert.rejects(
      decodeProject(json(project), fast),
      errorAt("invalid-data", path),
    );
  });

test("every required field and every closed object shape rejects missing or extra data", async () => {
  const paths = [
    [],
    ["document"],
    ["document", "bounds"],
    ["document", "layers", 0],
    ["document", "palette", 0],
    ["document", "palette", 3],
    ["document", "registry", 0],
    ["document", "annotations", 0],
    ["document", "annotations", 0, "bounds"],
    ["document", "annotations", 0, "label"],
    ["editor"],
  ];
  for (const path of paths) {
    const locate = (root: ReturnType<typeof fixture>) =>
      path.reduce((v, key) => v[key], root);
    const fields = Object.keys(locate(fixture()));
    for (const field of fields) {
      const project = fixture();
      delete locate(project)[field];
      await assert.rejects(
        decodeProject(json(project), fast),
        errorAt("invalid-data"),
      );
    }
    const project = fixture();
    locate(project).unknown = "must not be lost";
    await assert.rejects(
      decodeProject(json(project), fast),
      errorAt("invalid-data"),
    );
  }
});

test("unsupported versions report the supported range without inventing migrations", async () => {
  for (const version of [2, 42, Number.MAX_SAFE_INTEGER]) {
    const project = fixture();
    project.version = version;
    await assert.rejects(
      decodeProject(json(project), fast),
      errorAt("unsupported-version", "version"),
    );
  }
  await assert.rejects(
    decodeProject(
      json({ format: "tilewright-project", version: 2, future: {} }),
      fast,
    ),
    errorAt("unsupported-version", "version"),
  );
});

test("lexical corruption rejects duplicate decoded keys, rounded numbers, truncation and trailing data", async () => {
  const good = JSON.stringify(exampleProject);
  const malformed = [
    "",
    " ",
    "{",
    good.slice(0, -1),
    good.slice(0, good.indexOf("Forge") + 4),
    good + "{}",
    good + "garbage",
    good.replace('"version":1', '"version":1,"version":1'),
    good.replace('"version":1', '"version":1,"vers\\u0069on":1'),
    good.replace(
      '"placement":"center"',
      '"placement":"center","placement":"center"',
    ),
    good.replace('"minX":-64', '"minX":-64,"minX":-64'),
    good.replace('"format"', "format"),
    good.replace('"version":1', '"version":1,'),
    good.replace("Forge", "Forge\n"),
    good.replace("Forge", "\\q"),
    good.replace("Forge", "\\uZZZZ"),
  ];
  for (const number of [
    "1.0",
    "1e0",
    "1E+0",
    "1.00000000000000000001",
    "9007199254740993",
    "-9007199254740992",
    "01",
    "-",
    "+1",
    "NaN",
    "Infinity",
  ])
    malformed.push(good.replace('"version":1', `"version":${number}`));
  for (const input of malformed)
    await assert.rejects(decodeProject(bytes(input), fast), errorAt("parse"));
  for (const input of ["null", "[]", "true", '"project"', "1"])
    await assert.rejects(
      decodeProject(bytes(input), fast),
      errorAt("invalid-data"),
    );
  for (const input of [
    new Uint8Array([0xff]),
    new Uint8Array([0xc0, 0xaf]),
    new Uint8Array([0xe2, 0x82]),
    new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(good)]),
  ])
    await assert.rejects(
      decodeProject(input, fast),
      errorAt("parse", "project.bytes"),
    );
  await assert.rejects(
    decodeProject(bytes('{"__proto__":{"polluted":true}}'), fast),
    errorAt("invalid-data"),
  );
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("JSON parser depth ceiling is inclusive and cancellation checkpoints cover long tokens and whitespace", () => {
  const parse = (text: string) => {
    const steps = parseProjectJson(text);
    let step = steps.next(),
      yields = 0;
    while (!step.done) {
      yields++;
      step = steps.next();
    }
    return { value: step.value, yields };
  };
  assert.deepEqual(parse("[".repeat(8) + "0" + "]".repeat(8)).value, [
    [[[[[[[0]]]]]]],
  ]);
  assert.throws(
    () => parse("[".repeat(9) + "0" + "]".repeat(9)),
    errorAt("capacity"),
  );
  for (const input of [
    " ".repeat(100000) + "0",
    JSON.stringify("a".repeat(100000)),
    JSON.stringify(Array.from({ length: 25000 }, () => [])),
  ])
    assert.ok(parse(input).yields >= 1);
});

test("all resource ceilings are inclusive, aggregated across hidden layers and checked before population", async (t) => {
  const input = json(exampleProject);
  const exact: ProjectLimits = {
    maxBytes: input.length,
    maxLayers: 3,
    maxRegistryEntries: 3,
    maxAnnotations: 3,
    maxPaletteEntries: 5,
    maxRuns: 9,
    maxOccupiedCells: 16,
  };
  assert.equal(
    (
      await decodeProject(input, { ...fast, limits: exact })
    ).document.storageStats().occupiedCells,
    16,
  );
  t.mock.method(MapDocument.prototype, "writeBatch", () => {
    assert.fail("Over-capacity input reached storage");
  });
  for (const key of Object.keys(exact) as (keyof ProjectLimits)[]) {
    await assert.rejects(
      decodeProject(input, { ...fast, limits: { [key]: exact[key] - 1 } }),
      errorAt("capacity"),
    );
  }
  const project = fixture();
  project.document.bounds = { minX: 0, minY: 0, maxX: 65536, maxY: 65536 };
  project.document.palette = [{ kind: "raw", rgba: "#000000ff" }];
  project.document.annotations = [];
  project.document.layers = [
    {
      id: "big",
      name: "Big",
      runs: Array.from({ length: 1526 }, (_, y) => [0, y, 65536, 0]),
    },
  ];
  project.editor = { activeLayerId: "big", hiddenLayerIds: ["big"] };
  await assert.rejects(decodeProject(json(project), fast), errorAt("capacity"));
});

test("empty maximum dimensions allocate no partitions; exact integer extremes and -0 are supported", async () => {
  for (const minX of [-9007199254740991, -0, 9007199254740990]) {
    const project = fixture();
    project.document.bounds = {
      minX,
      minY: minX,
      maxX: minX + 1,
      maxY: minX + 1,
    };
    project.document.annotations = [];
    project.document.palette = [{ kind: "raw", rgba: "#11223300" }];
    project.document.layers = [
      { id: "edge", name: "Edge", runs: [[minX, minX, 1, 0]] },
    ];
    project.editor = { activeLayerId: "edge", hiddenLayerIds: [] };
    const loaded = await decodeProject(
      bytes(JSON.stringify(project).replace('"minX":0', '"minX":-0')),
      fast,
    );
    assert.deepEqual(
      loaded.document.getCell(layerId("edge"), minX, minX),
      rawColor("#11223300"),
    );
  }
  const doc = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 65536, maxY: 65536 },
  });
  const preferences = { activeLayerId: "layer-1", hiddenLayerIds: ["layer-1"] };
  const loaded = await decodeProject(
    await encodeProjectSnapshot(snapshot(doc, preferences), fast),
    fast,
  );
  assert.equal(loaded.document.storageStats().partitions, 0);
  assert.equal(loaded.document.storageStats().typedArrayBytes, 0);
});

test("input ownership, cancellation during parsing/population, construction and scheduler failures are safe", async (t) => {
  const input = json(exampleProject);
  const pending = decodeProject(input, fast);
  input.fill(0);
  assert.equal((await pending).document.storageStats().occupiedCells, 16);
  const project = fixture();
  project.document.annotations[0].description = "x".repeat(150000);
  for (const stop of [1, 4, 9]) {
    const signal = { aborted: false };
    let calls = 0;
    await assert.rejects(
      decodeProject(json(project), {
        signal,
        yieldControl: async () => {
          if (++calls === stop) signal.aborted = true;
        },
      }),
      errorAt("canceled"),
    );
    assert.equal(calls, stop);
  }
  await assert.rejects(
    decodeProject(json(project), { signal: { aborted: true } }),
    errorAt("canceled"),
  );
  const signal = { aborted: false };
  const original = MapDocument.prototype.writeBatch;
  const mock = t.mock.method(
    MapDocument.prototype,
    "writeBatch",
    function (
      this: MapDocument,
      writes: Parameters<MapDocument["writeBatch"]>[0],
    ) {
      const result = original.call(this, writes);
      signal.aborted = true;
      return result;
    },
  );
  await assert.rejects(
    decodeProject(json(exampleProject), { ...fast, signal }),
    errorAt("canceled"),
  );
  mock.mock.restore();
  t.mock.method(MapDocument.prototype, "writeBatch", () => {
    throw new Error("injected storage failure");
  });
  await assert.rejects(
    decodeProject(json(exampleProject), fast),
    errorAt("construction"),
  );
  await assert.rejects(
    decodeProject(json(exampleProject), {
      yieldControl: async () => {
        throw new Error("scheduler failure");
      },
    }),
    /scheduler failure/,
  );
});

for (const spec of FIXTURES)
  test(`full representative decode and independent model equality: ${spec.id}`, async (t) => {
    const document = populatedProjectDocument(spec);
    const preferences = {
      activeLayerId: "buildings",
      hiddenLayerIds: ["terrain", "buildings"],
    };
    const before = snapshot(document, preferences);
    const input = await encodeProjectSnapshot(before, fast);
    const start = performance.now();
    const loaded = await decodeProject(input, fast);
    const elapsed = performance.now() - start;
    assert.deepEqual(
      snapshot(loaded.document, loaded.preferences).project,
      before.project,
    );
    assert.deepEqual(
      inspectFixture(spec, fixtureRunsFromDocument(loaded.document)),
      inspectFixture(spec, fixtureRunsFromDocument(document)),
    );
    assert.deepEqual(loaded.document.layers, document.layers);
    assert.deepEqual(loaded.document.registryEntries, document.registryEntries);
    assert.deepEqual(loaded.document.annotations, document.annotations);
    assert.equal(
      loaded.document.storageStats().occupiedCells,
      document.storageStats().occupiedCells,
    );
    t.diagnostic(
      `${spec.id}: ${input.length} bytes, ${loaded.document.storageStats().occupiedCells} occupied cells, decode ${elapsed.toFixed(3)} ms (Node, no native I/O or presentation claim).`,
    );
  });
