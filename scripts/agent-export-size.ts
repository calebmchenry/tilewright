import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentColor,
  AgentMapV1,
  AgentRun,
} from "../src/domain/agent-export-format.ts";
import { inspectFixture } from "../tests/fixtures/inspect.ts";
import {
  FIXTURES,
  FIXTURE_BOUNDS,
  FIXTURE_LAYERS,
  FIXTURE_PALETTE,
  generateFixture,
  type FixtureRun,
} from "../tests/fixtures/maps.ts";

// Decision evidence only: no MapDocument, project codec, renderer or editor state.
// This script is not a production exporter or a general-purpose input validator.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
assert.ok(
  args.length === 0 || (args.length === 2 && args[0] === "--output"),
  "Usage: node scripts/agent-export-size.ts [--output path.json]",
);
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: AgentMapV1): string =>
  JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  ) + "\n";

const example: AgentMapV1 = JSON.parse(read("docs/examples/agent-map-v1.json"));
assert.deepEqual(Object.keys(example).sort(), [
  "areas",
  "bounds",
  "colors",
  "format",
  "layers",
  "version",
]);
assert.equal(example.format, "tilewright-agent-map");
assert.equal(example.version, 1);
assert.deepEqual(example.bounds, { minX: -1, minY: -1, maxX: 5, maxY: 4 });
assert.deepEqual(example.colors, [
  { kind: "raw", rgba: "#000000ff", meaning: null },
  { kind: "raw", rgba: "#629653ff", meaning: null },
  { kind: "raw", rgba: "#ffffff00", meaning: null },
  {
    kind: "registered",
    registryId: "grass",
    rgba: "#629653ff",
    meaning: "Grass",
  },
  {
    kind: "registered",
    registryId: "stone",
    rgba: "#8d939cff",
    meaning: "Stone wall",
  },
  {
    kind: "registered",
    registryId: "water",
    rgba: "#417aabff",
    meaning: "Water",
  },
]);
assert.deepEqual(
  example.layers.map(({ id, name }) => ({ id, name })),
  [
    { id: "terrain", name: "Terrain" },
    { id: "buildings", name: "Buildings" },
  ],
);
const actualCells = example.layers.map((layer) => {
  assert.deepEqual(Object.keys(layer).sort(), ["id", "name", "runs"]);
  const cells = new Map<string, number>();
  for (const [x, y, length, index] of layer.runs) {
    assert.ok(example.colors[index]);
    for (let offset = 0; offset < length; offset++) {
      const key = `${x + offset},${y}`;
      assert.ok(!cells.has(key), "No within-layer overlap");
      cells.set(key, index);
    }
  }
  return cells;
});
const terrain = new Map<string, number>([["-1,-1", 2]]);
for (let y = 0; y < 3; y++)
  for (let x = 0; x < 4; x++) terrain.set(`${x},${y}`, 3);
terrain.set("4,2", 1);
assert.deepEqual(actualCells, [
  terrain,
  new Map([
    ["1,0", 4],
    ["2,0", 4],
    ["1,1", 0],
    ["2,1", 4],
  ]),
]);
assert.deepEqual(
  example.areas.map(({ id, name, tier, bounds }) => ({
    id,
    name,
    tier,
    bounds,
  })),
  [
    {
      id: "house",
      name: "Blacksmith’s house",
      tier: "detail",
      bounds: { minX: 1, minY: 0, maxX: 3, maxY: 2 },
    },
    {
      id: "village",
      name: "Starting village",
      tier: "locality",
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 3 },
    },
  ],
);
for (const area of example.areas) {
  assert.deepEqual(Object.keys(area).sort(), [
    "bounds",
    "description",
    "id",
    "name",
    "tier",
  ]);
  assert.ok(area.description.length > 0);
}
assert.ok(example.areas[1].description.includes("\n"));
assert.deepEqual(JSON.parse(canonical(example)), example);

const colors: AgentColor[] = FIXTURE_PALETTE.map((paint): AgentColor =>
  paint.meaning === null
    ? { kind: "raw", rgba: paint.rgba, meaning: null }
    : {
        kind: "registered",
        registryId: paint.key,
        rgba: paint.rgba,
        meaning: paint.meaning,
      },
).sort((a, b) => {
  const key = (entry: AgentColor) =>
    entry.kind === "raw" ? `0${entry.rgba}` : `1${entry.registryId}`;
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
});
const paintIndices = colors.map((color) =>
  FIXTURE_PALETTE.findIndex(
    (paint) =>
      paint.rgba === color.rgba &&
      paint.meaning === color.meaning &&
      (color.kind === "raw" || paint.key === color.registryId),
  ),
);
assert.ok(paintIndices.every((index) => index >= 0));

/** Read decoded wire data in fixture order, undoing only terrain's run coalescing. */
function* readFixtureRuns(map: AgentMapV1): Generator<FixtureRun> {
  assert.deepEqual(map.bounds, FIXTURE_BOUNDS);
  assert.deepEqual(map.colors, colors);
  assert.deepEqual(
    map.layers.map(({ id, name }) => ({ id, name })),
    FIXTURE_LAYERS.map((id) => ({ id, name: id })),
  );
  const indices = map.layers.map(() => 0);
  for (let y = 0; y < 6400; y++) {
    for (let layer = 0; layer < map.layers.length; layer++) {
      const runs = map.layers[layer].runs;
      while (runs[indices[layer]]?.[1] === y) {
        const [start, , length, colorIndex] = runs[indices[layer]++];
        const end = start + length;
        const paint = paintIndices[colorIndex];
        assert.notEqual(paint, undefined);
        for (let x = start; x < end;) {
          const length =
            layer === 0 ? Math.min(end - x, 64 - (x % 64)) : end - x;
          yield { layer, y, x, length, paint };
          x += length;
        }
      }
    }
  }
  map.layers.forEach((layer, i) => assert.equal(indices[i], layer.runs.length));
}

const golden = JSON.parse(read("tests/fixtures/expected.json"));
const measurements = FIXTURES.map((fixture) => {
  const layers = FIXTURE_LAYERS.map((id) => ({
    id,
    name: id,
    runs: [] as AgentRun[],
  }));
  for (const run of generateFixture(fixture)) {
    const runs = layers[run.layer].runs;
    const index = paintIndices.indexOf(run.paint);
    assert.ok(index >= 0);
    const previous = runs.at(-1);
    if (
      previous &&
      previous[1] === run.y &&
      previous[0] + previous[2] === run.x &&
      previous[3] === index
    ) {
      runs[runs.length - 1] = [
        previous[0],
        run.y,
        previous[2] + run.length,
        index,
      ];
    } else runs.push([run.x, run.y, run.length, index]);
  }
  const map: AgentMapV1 = {
    format: "tilewright-agent-map",
    version: 1,
    bounds: FIXTURE_BOUNDS,
    colors,
    layers,
    areas: [
      {
        id: "house",
        name: "Blacksmith’s house",
        description:
          "The central eight-by-eight house; terrain and furniture remain on separate layers.",
        tier: "detail",
        bounds: { minX: 316, minY: 316, maxX: 324, maxY: 324 },
      },
      {
        id: "village",
        name: "Starting village",
        description:
          "Nine houses and a tree canopy in the first village.\nAreas are independent of tiles.",
        tier: "locality",
        bounds: { minX: 256, minY: 256, maxX: 384, maxY: 384 },
      },
    ],
  };
  const encoded = canonical(map);
  const decoded: AgentMapV1 = JSON.parse(encoded);
  assert.deepEqual(decoded, map);
  const content = inspectFixture(fixture, readFixtureRuns(decoded));
  assert.deepEqual(content, golden[fixture.id]);
  const withoutAreas = canonical({ ...map, areas: [] });
  return {
    fixture: fixture.id,
    seed: fixture.seed,
    fixtureContentSha256: content.contentSha256,
    occupiedByLayer: content.occupiedByLayer,
    occupiedLayerCells: content.occupiedLayerCells,
    overlappingPositions: content.overlappingPositions,
    sourceRuns: content.runCount,
    exportRuns: layers.reduce((total, layer) => total + layer.runs.length, 0),
    colors: colors.length,
    addedAreas: map.areas.length,
    areaBytes: Buffer.byteLength(encoded) - Buffer.byteLength(withoutAreas),
    canonicalUtf8Bytes: Buffer.byteLength(encoded),
    canonicalSha256: hash(encoded),
    decodedContentMatchesGolden: true,
  };
});
const report = {
  schemaVersion: 1,
  scope:
    "TW-043 fixture-only schema size estimate; not production export, timing, peak memory or I/O evidence.",
  node: process.version,
  inputsSha256: Object.fromEntries(
    [
      "src/domain/agent-export-format.ts",
      "scripts/agent-export-size.ts",
      "docs/examples/agent-map-v1.json",
      "tests/fixtures/maps.ts",
      "tests/fixtures/inspect.ts",
      "tests/fixtures/expected.json",
    ].map((path) => [path, hash(read(path))]),
  ),
  example: {
    canonicalUtf8Bytes: Buffer.byteLength(canonical(example)),
    canonicalSha256: hash(canonical(example)),
    occupiedByLayer: actualCells.map((cells) => cells.size),
    interpretationVerified: true,
  },
  measurements,
};
const output = args.length
  ? resolve(args[1])
  : resolve(root, "artifacts/performance/agent-export-size.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log(`Wrote ${output}`);
