import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  captureAgentExportSnapshot,
  encodeAgentExportSnapshot,
} from "../../src/domain/agent-export.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { MapDocument } from "../../src/domain/document.ts";
import type { AgentColor } from "../../src/domain/agent-export-format.ts";
import type { NamedArea } from "../../src/domain/annotations.ts";
import { layerId, rawColor, type TileValue } from "../../src/domain/values.ts";
import { consumerGoldenSession } from "../fixtures/agent-consumer.ts";
import { populatedAgentDocument } from "../fixtures/agent-export.ts";
import { FIXTURES } from "../fixtures/maps.ts";

const consumer = fileURLToPath(
  new URL("../../scripts/consume-agent-map.py", import.meta.url),
);
const example = readFileSync(
  new URL("../../docs/examples/agent-map-v1.json", import.meta.url),
);

function consume(bytes: Uint8Array | string, ...args: string[]) {
  return spawnSync("python3", ["-I", consumer, "-", ...args], {
    input: bytes,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

function output(bytes: Uint8Array | string, ...args: string[]) {
  const result = consume(bytes, ...args);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function sourceColor(document: MapDocument, paint: TileValue): AgentColor {
  if (paint.kind === "raw") return { ...paint, meaning: null };
  const record = document.getRegistryEntry(paint.registryId)!;
  assert.ok(typeof record.rgba === "string" && typeof record.name === "string");
  return { ...paint, rgba: record.rgba, meaning: record.name };
}

// Independent oracle reads the source model, never the captured map or exported runs.
function sourceSummary(document: MapDocument) {
  const raw = new Set<string>();
  const layers = document.layers.map((layer, order) => {
    const hash = createHash("sha256");
    let runs = 0,
      occupiedCells = 0;
    for (const run of document.iterateRuns(layer.id)) {
      const color = sourceColor(document, run.value);
      if (run.value.kind === "raw") raw.add(run.value.rgba);
      const record = [
        run.x,
        run.y,
        run.length,
        color.kind,
        run.value.kind === "registered" ? run.value.registryId : null,
        color.rgba,
        color.meaning,
      ];
      // The reader documents ASCII JSON tuples + LF for its resolved-run digest.
      hash.update(
        JSON.stringify(record).replace(
          /[\u007f-\uffff]/g,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
        ) + "\n",
      );
      runs++;
      occupiedCells += run.length;
    }
    return {
      ...layer,
      order,
      runs,
      occupiedCells,
      resolvedRunsSha256: hash.digest("hex"),
    };
  });
  return {
    bounds: document.bounds,
    colors: [
      ...[...raw].sort().map((rgba) => ({ kind: "raw", rgba, meaning: null })),
      ...document.registryEntries.map(([id]) =>
        sourceColor(document, { kind: "registered", registryId: id }),
      ),
    ],
    layers,
    areas: document.annotations.map(([id, record]) => {
      const { label: _label, ...area } = record as NamedArea;
      return { id, ...area };
    }),
    occupiedLayerCells: layers.reduce(
      (sum, layer) => sum + layer.occupiedCells,
      0,
    ),
  };
}

test("golden actual export reconstructs every source cell, hidden layer, recolored meaning and area independently", async (t) => {
  const session = consumerGoldenSession();
  try {
    const document = session.document;
    assert.deepEqual(session.hiddenLayers.getSnapshot(), [
      layerId("walls"),
      layerId("furniture"),
    ]);
    const bytes = await encodeAgentExportSnapshot(
      session.captureAgentExportSnapshot(),
    );
    assert.equal(bytes.length, 1520);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      "95ad511e2a18b0c467fbe50f4541eb95d686f394b26533b1f76a28edf5e49d7b",
    );
    const checkedIn = readFileSync(
      new URL("../../docs/examples/agent-consumer-v1.json", import.meta.url),
    );
    assert.deepEqual(
      JSON.parse(checkedIn.toString("utf8")),
      JSON.parse(Buffer.from(bytes).toString("utf8")),
    );
    const expected = [];
    for (const cell of document.iterateCells())
      expected.push({
        layerId: cell.layerId,
        layerOrder: document.layers.findIndex(
          (layer) => layer.id === cell.layerId,
        ),
        x: cell.x,
        y: cell.y,
        color: sourceColor(document, cell.value),
      });
    const decoded = consume(bytes, "--cells");
    assert.equal(decoded.status, 0, decoded.stderr);
    const cells = decoded.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(cells, expected);
    assert.equal(cells.length, 28);
    const report = output(bytes);
    assert.deepEqual(report, sourceSummary(document));
    assert.equal(report.layers[3].occupiedCells, 0);
    const point = output(bytes, "--at", "1", "0").at;
    assert.deepEqual(
      point.layers.map(
        (layer: { color: { meaning: string } | null }) =>
          layer.color?.meaning ?? null,
      ),
      ["Meadow", "Stone wall", "Oak table", null],
    );
    assert.deepEqual(point.areas, ["house", "region", "village"]);
    assert.deepEqual(output(bytes, "--at", "5", "3").at.layers[0].color, {
      kind: "raw",
      rgba: "#335c46ff",
      meaning: null,
    });
    assert.deepEqual(output(bytes, "--at", "4", "3").at.layers[0].color, {
      kind: "raw",
      rgba: "#629653ff",
      meaning: null,
    });
    assert.deepEqual(output(bytes, "--at", "-2", "-1").at.layers[0].color, {
      kind: "raw",
      rgba: "#ffffff00",
      meaning: null,
    });
    assert.deepEqual(output(bytes, "--at", "5", "4").at.layers[0].color, {
      kind: "raw",
      rgba: "#000000ff",
      meaning: null,
    });
    assert.ok(
      report.colors.some(
        (color) => "registryId" in color && color.registryId === "water",
      ),
    );
    assert.equal(
      cells.some(
        (cell) =>
          cell.color.kind === "registered" && cell.color.registryId === "water",
      ),
      false,
    );
    assert.equal(
      report.areas[0].description,
      "Oak worktables stand over grass and stone.\nKeep every underlying tile. 🔨",
    );
    assert.equal(report.areas[1].description, "");
    // Visibility cannot affect the bytes, including two hidden populated layers.
    for (const layer of document.layers)
      session.setLayerVisible(layer.id, true);
    assert.deepEqual(
      await encodeAgentExportSnapshot(session.captureAgentExportSnapshot()),
      bytes,
    );
    t.diagnostic(
      JSON.stringify({
        bytes: bytes.length,
        cells: cells.length,
        runs: report.layers.reduce(
          (sum: number, layer: { runs: number }) => sum + layer.runs,
          0,
        ),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  } finally {
    session.dispose();
  }
});

for (const fixture of FIXTURES)
  test(`${fixture.id}: independent sparse consumer matches every actual source run and all areas`, async (t) => {
    const document = populatedAgentDocument(fixture);
    const expected = sourceSummary(document);
    const bytes = await encodeAgentExportSnapshot(
      captureAgentExportSnapshot(new CommandHistory(document)),
    );
    const report = output(bytes);
    assert.deepEqual(report, expected);
    const golden = JSON.parse(
      readFileSync(
        new URL("../fixtures/expected.json", import.meta.url),
        "utf8",
      ),
    )[fixture.id];
    assert.equal(report.occupiedLayerCells, golden.occupiedLayerCells);
    assert.deepEqual(
      report.layers.map(
        (layer: { occupiedCells: number }) => layer.occupiedCells,
      ),
      golden.occupiedByLayer,
    );
    assert.equal(report.areas.length, 1089);
    const runs = report.layers.reduce(
      (sum: number, layer: { runs: number }) => sum + layer.runs,
      0,
    );
    assert.equal(runs, fixture.id === "frontier-v1" ? 123870 : 470490);
    assert.equal(
      bytes.length,
      fixture.id === "frontier-v1" ? 2306718 : 8080454,
    );
    // Sparse summaries do not depend on the 163,840,000 possible layer addresses.
    assert.ok(runs < report.occupiedLayerCells / 50);
    t.diagnostic(
      JSON.stringify({
        fixture: fixture.id,
        bytes: bytes.length,
        runs,
        occupiedLayerCells: report.occupiedLayerCells,
        areas: report.areas.length,
        layers: report.layers,
      }),
    );
  });

test("consumer accepts noncanonical array/key order and adjacent split runs without changing cells", () => {
  const value = JSON.parse(example.toString("utf8"));
  value.colors.reverse();
  value.areas.reverse();
  for (const layer of value.layers)
    for (const run of layer.runs) run[3] = value.colors.length - 1 - run[3];
  const run = value.layers[0].runs[1];
  value.layers[0].runs.splice(
    1,
    1,
    [run[0], run[1], 1, run[3]],
    [run[0] + 1, run[1], run[2] - 1, run[3]],
  );
  const reordered = Object.fromEntries(Object.entries(value).reverse());
  const actual = consume(JSON.stringify(reordered), "--cells");
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.stdout, consume(example, "--cells").stdout);
});

test("maximum-size sparse and empty maps, safe coordinate extremes and exact Unicode text decode", async () => {
  for (const min of [
    Number.MIN_SAFE_INTEGER,
    -0,
    Number.MAX_SAFE_INTEGER - 65536,
  ]) {
    const document = new MapDocument({
      bounds: { minX: min, minY: min, maxX: min + 65536, maxY: min + 65536 },
    });
    if (min !== 0)
      document.setCell(
        document.layers[0].id,
        min + 65535,
        min,
        rawColor("#00000000"),
      );
    const bytes = await encodeAgentExportSnapshot(
      captureAgentExportSnapshot(new CommandHistory(document)),
    );
    assert.ok(bytes.length < 400);
    const report = output(bytes);
    // JSON canonicalizes negative zero; the reader must not invent a different origin.
    assert.deepEqual(
      report,
      JSON.parse(JSON.stringify(sourceSummary(document))),
    );
  }
  const value = JSON.parse(example.toString("utf8"));
  value.areas[0].description = "\u007f😀 e\u0301é\ud800\r\n  \u2028\u2029";
  value.layers[0].name = " same layer \n";
  value.colors[3].meaning = " duplicate name ";
  value.colors[4].meaning = " duplicate name ";
  const report = output(JSON.stringify(value));
  assert.equal(report.areas[0].description, value.areas[0].description);
  assert.equal(report.layers[0].name, value.layers[0].name);
  assert.deepEqual(report.colors, value.colors);
});

test("standalone consumer validates the published example and resolves every layer at a coordinate", () => {
  const report = output(example, "--at", "1", "0");
  assert.equal(report.occupiedLayerCells, 18);
  assert.deepEqual(
    report.layers.map(
      (layer: { id: string; order: number; occupiedCells: number }) => [
        layer.id,
        layer.order,
        layer.occupiedCells,
      ],
    ),
    [
      ["terrain", 0, 14],
      ["buildings", 1, 4],
    ],
  );
  assert.deepEqual(
    report.at.layers.map(
      (layer: { color: { meaning: string } }) => layer.color.meaning,
    ),
    ["Grass", "Stone wall"],
  );
  assert.deepEqual(report.at.areas, ["house", "village"]);
  const result = consume(example, "--cells");
  assert.equal(result.status, 0, result.stderr);
  const cells = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(cells.length, 18);
  assert.deepEqual(cells[0], {
    layerId: "terrain",
    layerOrder: 0,
    x: -1,
    y: -1,
    color: { kind: "raw", rgba: "#ffffff00", meaning: null },
  });
  assert.equal(
    output(example, "--at", "4", "3").at.layers.every(
      (layer: { color: unknown }) => layer.color === null,
    ),
    true,
  );
  assert.equal(consume(example, "--at", "5", "3").status, 1);
});

test("consumer runs from a copied script and export in an isolated directory with no repository or packages", () => {
  const directory = mkdtempSync(join(tmpdir(), "tilewright-consumer-"));
  try {
    copyFileSync(consumer, join(directory, "reader.py"));
    writeFileSync(join(directory, "example.json"), example);
    const result = spawnSync("python3", ["-I", "reader.py", "example.json"], {
      cwd: directory,
      encoding: "utf8",
      timeout: 60000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).occupiedLayerCells, 18);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("consumer rejects duplicate keys, imprecise numeric tokens, wrong versions and invalid UTF-8 before output", () => {
  const text = example.toString("utf8");
  for (const bad of [
    text.replace('"version": 1', '"version": 1, "version": 1'),
    text.replace('"version": 1', '"version": 2'),
    text.replace('"version": 1', '"version": true'),
    text.replace('"version": 1', '"version": 1.0'),
    text.replace('"version": 1', '"version": 1e0'),
    text.replace('"version": 1', '"version": 9007199254740993'),
    text.replace('"version": 1', '"version": NaN'),
    text.replace('"version": 1', '"version": Infinity'),
    text.replace('"version": 1', '"version": -9007199254740992'),
    text.replace(
      '"version": 1',
      '"version": 99999999999999999999999999999999999999999999',
    ),
    text.replace('"minX": -1', '"minX": -1, "min\\u0058": -1'),
    text.replace('"minX": -1', '"minX": -1e0'),
    text + "{}",
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), example]),
    Buffer.from([0xff]),
    text.slice(0, -5),
  ]) {
    const result = consume(bad, "--cells");
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid agent map:/);
    assert.equal(result.stdout, "");
  }
});

// Deliberately untyped parsed JSON allows wrong types/missing fields at every boundary.
const schemaCases: [string, (value: any) => void, string][] = [
  [
    "project envelope",
    (v) => {
      v.format = "tilewright-project";
    },
    "format",
  ],
  [
    "unknown root property",
    (v) => {
      v.editor = {};
    },
    "$",
  ],
  [
    "missing collection",
    (v) => {
      delete v.areas;
    },
    "$",
  ],
  [
    "unknown bounds property",
    (v) => {
      v.bounds.width = 6;
    },
    "bounds",
  ],
  [
    "missing bound",
    (v) => {
      delete v.bounds.minX;
    },
    "bounds",
  ],
  [
    "wrong bounds type",
    (v) => {
      v.bounds = [];
    },
    "bounds",
  ],
  [
    "boolean coordinate",
    (v) => {
      v.bounds.minX = false;
    },
    "bounds.minX",
  ],
  [
    "empty bounds",
    (v) => {
      v.bounds.maxX = v.bounds.minX;
    },
    "bounds",
  ],
  [
    "oversized bounds",
    (v) => {
      v.bounds.maxY = 65536;
    },
    "bounds",
  ],
  [
    "unsafe dimension arithmetic",
    (v) => {
      v.bounds.minX = Number.MIN_SAFE_INTEGER;
      v.bounds.maxX = Number.MAX_SAFE_INTEGER;
    },
    "bounds",
  ],
  [
    "wrong colors type",
    (v) => {
      v.colors = {};
    },
    "colors",
  ],
  [
    "null color",
    (v) => {
      v.colors[0] = null;
    },
    "colors[0]",
  ],
  [
    "unknown color kind",
    (v) => {
      v.colors[0].kind = "empty";
    },
    "colors[0]",
  ],
  [
    "missing raw meaning",
    (v) => {
      delete v.colors[0].meaning;
    },
    "colors[0]",
  ],
  [
    "invented raw meaning",
    (v) => {
      v.colors[0].meaning = "Black";
    },
    "colors[0]",
  ],
  [
    "raw registry identity",
    (v) => {
      v.colors[0].registryId = "ink";
    },
    "colors[0]",
  ],
  [
    "uppercase RGBA",
    (v) => {
      v.colors[0].rgba = "#ABCDEFff";
    },
    "colors[0]",
  ],
  [
    "RGB without alpha",
    (v) => {
      v.colors[0].rgba = "#000000";
    },
    "colors[0]",
  ],
  [
    "wrong RGBA type",
    (v) => {
      v.colors[0].rgba = 0;
    },
    "colors[0]",
  ],
  [
    "duplicate raw RGBA",
    (v) => {
      v.colors.push({ ...v.colors[0] });
    },
    "colors[6]",
  ],
  [
    "unused raw RGBA",
    (v) => {
      v.colors.push({ kind: "raw", rgba: "#abcdef80", meaning: null });
    },
    "colors[6]",
  ],
  [
    "blank registry meaning",
    (v) => {
      v.colors[3].meaning = "\ufeff ";
    },
    "colors[3].meaning",
  ],
  [
    "null registry meaning",
    (v) => {
      v.colors[3].meaning = null;
    },
    "colors[3].meaning",
  ],
  [
    "invalid registry ID",
    (v) => {
      v.colors[3].registryId = " bad";
    },
    "colors[3].registryId",
  ],
  [
    "duplicate registry ID",
    (v) => {
      v.colors[4].registryId = v.colors[3].registryId;
    },
    "colors[4].registryId",
  ],
  [
    "duplicate registry RGBA",
    (v) => {
      v.colors[4].rgba = v.colors[3].rgba;
    },
    "colors[4]",
  ],
  [
    "nonopaque registry RGBA",
    (v) => {
      v.colors[3].rgba = "#62965380";
    },
    "colors[3]",
  ],
  [
    "wrong layers type",
    (v) => {
      v.layers = null;
    },
    "layers",
  ],
  [
    "no layers",
    (v) => {
      v.layers = [];
    },
    "layers",
  ],
  [
    "layer capacity",
    (v) => {
      v.layers = Array(1025).fill(v.layers[0]);
    },
    "layers",
  ],
  [
    "unknown layer property",
    (v) => {
      v.layers[0].visible = false;
    },
    "layers[0]",
  ],
  [
    "duplicate layer ID",
    (v) => {
      v.layers[1].id = v.layers[0].id;
    },
    "layers[1].id",
  ],
  [
    "oversized ID",
    (v) => {
      v.layers[0].id = "a".repeat(129);
    },
    "layers[0].id",
  ],
  [
    "blank layer name",
    (v) => {
      v.layers[0].name = "\n\t";
    },
    "layers[0].name",
  ],
  [
    "wrong runs type",
    (v) => {
      v.layers[0].runs = {};
    },
    "layers[0].runs",
  ],
  [
    "missing run component",
    (v) => {
      v.layers[0].runs[0].pop();
    },
    "layers[0].runs[0]",
  ],
  [
    "extra run component",
    (v) => {
      v.layers[0].runs[0].push(0);
    },
    "layers[0].runs[0]",
  ],
  [
    "null run",
    (v) => {
      v.layers[0].runs[0] = null;
    },
    "layers[0].runs[0]",
  ],
  [
    "fractional length",
    (v) => {
      v.layers[0].runs[0][2] = 1.5;
    },
    "$",
  ],
  [
    "boolean length",
    (v) => {
      v.layers[0].runs[0][2] = true;
    },
    "layers[0].runs[0]",
  ],
  [
    "zero length",
    (v) => {
      v.layers[0].runs[0][2] = 0;
    },
    "layers[0].runs[0]",
  ],
  [
    "negative length",
    (v) => {
      v.layers[0].runs[0][2] = -1;
    },
    "layers[0].runs[0]",
  ],
  [
    "missing color index",
    (v) => {
      v.layers[0].runs[0][3] = 6;
    },
    "layers[0].runs[0]",
  ],
  [
    "negative color index",
    (v) => {
      v.layers[0].runs[0][3] = -1;
    },
    "layers[0].runs[0]",
  ],
  [
    "run before min x",
    (v) => {
      v.layers[0].runs[0][0] = -2;
    },
    "layers[0].runs[0]",
  ],
  [
    "run at max y",
    (v) => {
      v.layers[0].runs[0][1] = 4;
    },
    "layers[0].runs[0]",
  ],
  [
    "run wraps row",
    (v) => {
      v.layers[0].runs[0][2] = 7;
    },
    "layers[0].runs[0]",
  ],
  [
    "unsafe run end",
    (v) => {
      v.layers[0].runs[0] = [Number.MAX_SAFE_INTEGER, 0, 1, 0];
    },
    "layers[0].runs[0]",
  ],
  [
    "unordered rows",
    (v) => {
      v.layers[0].runs.reverse();
    },
    "layers[0].runs",
  ],
  [
    "unordered columns",
    (v) => {
      v.layers[1].runs[2][0] = 0;
    },
    "layers[1].runs[2]",
  ],
  [
    "overlapping runs",
    (v) => {
      v.layers[1].runs[2][0] = 1;
    },
    "layers[1].runs[2]",
  ],
  [
    "wrong areas type",
    (v) => {
      v.areas = {};
    },
    "areas",
  ],
  [
    "missing area description",
    (v) => {
      delete v.areas[0].description;
    },
    "areas[0]",
  ],
  [
    "wrong description type",
    (v) => {
      v.areas[0].description = null;
    },
    "areas[0].description",
  ],
  [
    "unknown area property",
    (v) => {
      v.areas[0].layerId = "terrain";
    },
    "areas[0]",
  ],
  [
    "duplicate area ID",
    (v) => {
      v.areas[1].id = v.areas[0].id;
    },
    "areas[1].id",
  ],
  [
    "blank area name",
    (v) => {
      v.areas[0].name = "";
    },
    "areas[0].name",
  ],
  [
    "untrimmed area name",
    (v) => {
      v.areas[0].name = " House ";
    },
    "areas[0]",
  ],
  [
    "multiline area name",
    (v) => {
      v.areas[0].name = "House\u2028annex";
    },
    "areas[0]",
  ],
  [
    "unknown area tier",
    (v) => {
      v.areas[0].tier = "global";
    },
    "areas[0]",
  ],
  [
    "area outside map",
    (v) => {
      v.areas[0].bounds.maxX = 6;
    },
    "areas[0].bounds",
  ],
  [
    "empty area",
    (v) => {
      v.areas[0].bounds.maxY = 0;
    },
    "areas[0].bounds",
  ],
  [
    "occupied capacity",
    (v) => {
      v.bounds = { minX: 0, minY: 0, maxX: 65536, maxY: 65536 };
      v.colors = [{ kind: "raw", rgba: "#000000ff", meaning: null }];
      v.layers = [
        {
          id: "terrain",
          name: "Terrain",
          runs: Array.from({ length: 1526 }, (_, y) => [0, y, 65536, 0]),
        },
      ];
      v.areas = [];
    },
    "layers[0]",
  ],
];

for (const [name, change, path] of schemaCases)
  test(`consumer rejects ${name} without partial reconstruction`, () => {
    const value = JSON.parse(example.toString("utf8"));
    change(value);
    const result = consume(JSON.stringify(value), "--cells");
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Invalid agent map:/);
    assert.ok(result.stderr.includes(path), result.stderr);
    assert.equal(result.stdout, "");
  });
