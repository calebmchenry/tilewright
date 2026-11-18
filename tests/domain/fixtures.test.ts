import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FIXTURES,
  FIXTURE_LAYERS,
  FIXTURE_PALETTE,
  generateFixture,
  visitFixtureCells,
  type FixtureRun,
} from "../fixtures/maps.ts";
import { inspectFixture } from "../fixtures/inspect.ts";
import { visualChunkAt } from "../../src/domain/coordinates.ts";

const expected = JSON.parse(
  readFileSync(new URL("../fixtures/expected.json", import.meta.url), "utf8"),
);

for (const fixture of FIXTURES) {
  test(`${fixture.id}: two complete generations match reviewed content and actual occupancy`, () => {
    const first = inspectFixture(fixture);
    assert.deepEqual(first, inspectFixture(fixture));
    assert.deepEqual(first, expected[fixture.id]);
    assert.equal(
      first.positionsByDepth.reduce((sum, count) => sum + count, 0),
      6400 * 6400,
    );
    assert.equal(
      first.positionsByDepth.reduce(
        (sum, count, depth) => sum + count * depth,
        0,
      ),
      first.occupiedLayerCells,
    );
    assert.ok(first.emptyPositions > 640 * 640);
    assert.ok(first.positionsByDepth[4] > 0);
    const coverage = first.uniqueOccupiedPositions / (6400 * 6400);
    assert.ok(
      fixture.id === "frontier-v1"
        ? coverage > 0.1 && coverage < 0.25
        : coverage > 0.5 && coverage < 0.7,
    );
  });

  test(`${fixture.id}: small layered model input preserves underlying terrain, black paint, holes, and chunk crossings`, () => {
    // A small independent cell oracle, NOT the future application document.
    const layers = new Map(
      FIXTURE_LAYERS.map((layer) => [layer, new Map<string, number>()]),
    );
    visitFixtureCells(
      fixture,
      (layer, x, y, paint) => {
        const cells = layers.get(layer as (typeof FIXTURE_LAYERS)[number])!;
        assert.equal(cells.has(`${x},${y}`), false);
        cells.set(`${x},${y}`, paint);
      },
      { minX: 310, minY: 310, maxX: 330, maxY: 330 },
    );
    assert.deepEqual(
      [...layers.values()].map((cells) => cells.size),
      [400, 64, 4, 144],
    );
    assert.deepEqual(
      [...layers.values()].map((cells) => cells.has("318,318")),
      [true, true, true, true],
    );
    assert.equal(
      FIXTURE_PALETTE[layers.get("furniture")!.get("318,318")!].rgba,
      "#000000ff",
    );
    assert.equal(layers.get("furniture")!.get("317,318"), undefined);
    assert.equal(layers.get("terrain")!.get("317,318"), 0);
    const chunks = new Set(
      [...layers.get("buildings")!.keys()].map((key) => {
        const [x, y] = key.split(",").map(Number);
        const { chunkX, chunkY } = visualChunkAt(x, y);
        return `${chunkX},${chunkY}`;
      }),
    );
    assert.deepEqual([...chunks], ["4,4", "5,4", "4,5", "5,5"]);
    layers.get("furniture")!.delete("318,318");
    assert.equal(layers.get("terrain")!.has("318,318"), true);
    assert.equal(layers.get("buildings")!.has("318,318"), true);
    let emptyCount = 0;
    visitFixtureCells(fixture, () => emptyCount++, {
      minX: 5760,
      minY: 5760,
      maxX: 6400,
      maxY: 6400,
    });
    assert.equal(emptyCount, 0);
  });
}

test("fixture inspector rejects duplicates, out-of-order rows, invalid paints, and out-of-bounds runs", () => {
  const first: FixtureRun = { layer: 0, y: 1, x: 0, length: 8, paint: 0 };
  for (const bad of [
    first,
    { ...first, y: 0 },
    { ...first, layer: 4 },
    { ...first, paint: 99 },
    { ...first, x: 6399, length: 2 },
    { ...first, length: 0 },
    { ...first, x: 8.5 },
  ])
    assert.throws(
      () => inspectFixture(FIXTURES[0], [first, bad]),
      /fixture run/,
    );
});

test("fixture digest covers paint, not just occupancy; seed changes content", () => {
  const first = { layer: 0, y: 0, x: 0, length: 8, paint: 0 };
  const a = inspectFixture(FIXTURES[0], [first]);
  const b = inspectFixture(FIXTURES[0], [{ ...first, paint: 1 }]);
  assert.equal(a.occupiedLayerCells, b.occupiedLayerCells);
  assert.notEqual(a.contentSha256, b.contentSha256);
  const rows = (seed: number) => {
    const result: FixtureRun[] = [];
    for (const run of generateFixture({ ...FIXTURES[0], seed })) {
      if (run.y > 0) break;
      result.push(run);
    }
    return result;
  };
  assert.notDeepEqual(rows(1), rows(2));
  assert.throws(
    () => generateFixture({ ...FIXTURES[0], seed: -1 }).next(),
    RangeError,
  );
});
