import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { layerId } from "../../src/domain/values.ts";
import {
  fixtureRunsFromDocument,
  loadFixtureDocument,
  MODEL_PALETTE,
} from "../fixtures/document.ts";
import { inspectFixture } from "../fixtures/inspect.ts";
import { FIXTURES } from "../fixtures/maps.ts";

const expected = JSON.parse(
  readFileSync(new URL("../fixtures/expected.json", import.meta.url), "utf8"),
);
for (const fixture of FIXTURES) {
  test(`${fixture.id}: full sparse document readback matches golden content, occupancy, and all layers`, () => {
    const map = loadFixtureDocument(fixture);
    assert.deepEqual(
      inspectFixture(fixture, fixtureRunsFromDocument(map)),
      expected[fixture.id],
    );
    const stats = map.storageStats();
    assert.equal(stats.occupiedCells, expected[fixture.id].occupiedLayerCells);
    assert.deepEqual(
      stats.layers.map((layer) => layer.occupiedCells),
      expected[fixture.id].occupiedByLayer,
    );
    assert.equal(stats.paletteEntries, 6);
    assert.ok(stats.partitions < (6400 / stats.partitionSize) ** 2 * 4);
    assert.deepEqual(
      map.getCell(layerId("terrain"), 318, 318),
      MODEL_PALETTE[0],
    );
    assert.deepEqual(
      map.getCell(layerId("furniture"), 318, 318),
      MODEL_PALETTE[4],
    );
    assert.equal(map.getCell(layerId("furniture"), 317, 318), null);
    assert.deepEqual(
      [
        ...map.iterateRuns(undefined, {
          minX: 5760,
          minY: 5760,
          maxX: 6400,
          maxY: 6400,
        }),
      ],
      [],
    );
  });
}
