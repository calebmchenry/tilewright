import { createHash } from "node:crypto";
import { assertBounds, containsTile } from "../../src/domain/coordinates.ts";
import {
  FIXTURE_BOUNDS,
  FIXTURE_LAYERS,
  FIXTURE_PALETTE,
  FIXTURE_VERSION,
  generateFixture,
  type FixtureRun,
  type FixtureSpec,
} from "./maps.ts";

/** Counts actual emitted cells, validates runs, and hashes all content/metadata. */
export function inspectFixture(
  spec: FixtureSpec,
  runs: Iterable<FixtureRun> = generateFixture(spec),
) {
  assertBounds(FIXTURE_BOUNDS);
  const metadata = {
    version: FIXTURE_VERSION,
    id: spec.id,
    seed: spec.seed,
    terrainPercent: spec.terrainPercent,
    bounds: FIXTURE_BOUNDS,
    layers: FIXTURE_LAYERS,
    palette: FIXTURE_PALETTE,
  };
  const hash = createHash("sha256").update(JSON.stringify(metadata) + "\n");
  const record = Buffer.alloc(20);
  const row = new Uint8Array(6400);
  const occupiedByLayer = FIXTURE_LAYERS.map(() => 0);
  const positionsByDepth = Array<number>(5).fill(0);
  let currentY = -1;
  let previousLayer = -1;
  let previousEnd = 0;
  let runCount = 0;
  const finishRow = () => {
    if (currentY < 0) return;
    for (const depth of row) positionsByDepth[depth]++;
  };
  for (const run of runs) {
    const { layer, y, x, length, paint } = run;
    if (
      ![layer, y, x, length, paint].every(Number.isSafeInteger) ||
      layer < 0 ||
      layer >= FIXTURE_LAYERS.length ||
      length <= 0 ||
      paint < 0 ||
      paint >= FIXTURE_PALETTE.length ||
      !containsTile(FIXTURE_BOUNDS, x, y) ||
      !containsTile(FIXTURE_BOUNDS, x + length - 1, y) ||
      y < currentY ||
      (y === currentY &&
        (layer < previousLayer || (layer === previousLayer && x < previousEnd)))
    ) {
      throw new Error(
        `Invalid, overlapping, or unordered fixture run: ${JSON.stringify(run)}`,
      );
    }
    if (y !== currentY) {
      finishRow();
      positionsByDepth[0] += (y - currentY - 1) * 6400;
      row.fill(0);
      currentY = y;
    }
    previousLayer = layer;
    previousEnd = x + length;
    occupiedByLayer[layer] += length;
    runCount++;
    for (let cellX = x; cellX < x + length; cellX++) row[cellX]++;
    [layer, y, x, length, paint].forEach((value, index) =>
      record.writeUInt32LE(value, index * 4),
    );
    hash.update(record);
  }
  finishRow();
  positionsByDepth[0] += (6399 - currentY) * 6400;
  const occupiedLayerCells = occupiedByLayer.reduce(
    (sum, count) => sum + count,
    0,
  );
  const uniqueOccupiedPositions = positionsByDepth
    .slice(1)
    .reduce((sum, count) => sum + count, 0);
  return {
    ...metadata,
    runCount,
    occupiedByLayer,
    occupiedLayerCells,
    uniqueOccupiedPositions,
    emptyPositions: positionsByDepth[0],
    overlappingPositions: positionsByDepth
      .slice(2)
      .reduce((sum, count) => sum + count, 0),
    positionsByDepth,
    contentSha256: hash.digest("hex"),
  };
}
