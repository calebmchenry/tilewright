import { assertBounds, type Bounds } from "../../src/domain/coordinates.ts";

// Test interchange only, not the editable-project or agent-export schema.
export const FIXTURE_VERSION = 1;
export const FIXTURE_BOUNDS: Bounds = Object.freeze({
  minX: 0,
  minY: 0,
  maxX: 6400,
  maxY: 6400,
});
export const FIXTURE_LAYERS = [
  "terrain",
  "buildings",
  "furniture",
  "canopy",
] as const;
export const FIXTURE_PALETTE = [
  { key: "grass", rgba: "#629653ff", meaning: "Grass" },
  { key: "water", rgba: "#417aabff", meaning: "Water" },
  { key: "stone", rgba: "#8d939cff", meaning: "Stone building" },
  { key: "wood", rgba: "#a7754cff", meaning: "Wood building" },
  { key: "ink", rgba: "#000000ff", meaning: null },
  { key: "leaves", rgba: "#285c39ff", meaning: "Tree canopy" },
] as const;

export interface FixtureSpec {
  readonly id: string;
  readonly seed: number;
  readonly terrainPercent: number;
}

export const FIXTURES: readonly FixtureSpec[] = [
  { id: "frontier-v1", seed: 0x1a2b3c4d, terrainPercent: 18 },
  { id: "heartland-v1", seed: 0x5e6f7081, terrainPercent: 82 },
];

export interface FixtureRun {
  readonly layer: number;
  readonly y: number;
  readonly x: number;
  readonly length: number;
  readonly paint: number;
}

// Fixed uint32 arithmetic, independent of clocks, platform RNG, and iteration order.
function noise(seed: number, x: number, y: number): number {
  let value =
    (seed ^ Math.imul(x + 1, 0x9e3779b1) ^ Math.imul(y + 1, 0x85ebca6b)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * Streaming row runs in y/layer/x order; never allocate the full tile matrix.
 * Every run is occupied, including black. Omitted cells are empty.
 * Consumers may expand runs into their own model via visitFixtureCells.
 */
export function* generateFixture(spec: FixtureSpec): Generator<FixtureRun> {
  if (
    !Number.isInteger(spec.seed) ||
    spec.seed < 0 ||
    spec.seed > 0xffffffff ||
    !Number.isInteger(spec.terrainPercent) ||
    spec.terrainPercent < 0 ||
    spec.terrainPercent > 100
  ) {
    throw new RangeError(
      "Fixture seed must be uint32 and terrainPercent an integer from 0 to 100.",
    );
  }
  for (let y = 0; y < 6400; y++) {
    const chunkY = Math.floor(y / 64);
    const villageY = (y % 640) - 256;
    for (let chunkX = 0; chunkX < 100; chunkX++) {
      const x = chunkX * 64;
      // A guaranteed empty 640 by 640 region in BOTH fixtures.
      if (x >= 5760 && y >= 5760) continue;
      const village =
        chunkX % 10 >= 4 && chunkX % 10 <= 5 && villageY >= 0 && villageY < 128;
      const value = noise(spec.seed, chunkX, chunkY);
      if (village || (value % 100 < spec.terrainPercent && y % 16 !== 15)) {
        yield {
          layer: 0,
          y,
          x,
          length: village ? 64 : 32 + ((value >>> 8) % 33),
          paint: village || value % 7 ? 0 : 1,
        };
      }
    }
    if (villageY < 0 || villageY >= 128) continue;
    for (let layer = 1; layer < FIXTURE_LAYERS.length; layer++) {
      for (let villageX = 0; villageX < 10; villageX++) {
        if (villageX === 9 && y >= 5760) continue;
        const baseX = villageX * 640 + 256;
        if (layer === 3) {
          if (villageY >= 58 && villageY < 70) {
            yield { layer, y, x: baseX + 58, length: 12, paint: 5 };
          }
          continue;
        }
        // Nine houses per village; the central house crosses four visual chunks.
        for (const offsetY of [12, 60, 108]) {
          const inset = layer === 2 ? 2 : 0;
          const length = layer === 2 ? 2 : 8;
          if (
            villageY < offsetY + inset ||
            villageY >= offsetY + inset + length
          )
            continue;
          for (const offsetX of [12, 60, 108]) {
            yield {
              layer,
              y,
              x: baseX + offsetX + inset,
              length,
              paint:
                layer === 2
                  ? 4
                  : 2 + (noise(spec.seed, villageX, Math.floor(y / 640)) % 2),
            };
          }
        }
      }
    }
  }
}

/** Expand only a requested window for smoke tests, or all bounds for model imports. */
export function visitFixtureCells(
  spec: FixtureSpec,
  visit: (layer: string, x: number, y: number, paint: number) => void,
  window: Bounds = FIXTURE_BOUNDS,
): void {
  assertBounds(window);
  for (const run of generateFixture(spec)) {
    if (run.y < window.minY) continue;
    if (run.y >= window.maxY) break;
    const end = Math.min(run.x + run.length, window.maxX);
    for (let x = Math.max(run.x, window.minX); x < end; x++) {
      visit(FIXTURE_LAYERS[run.layer], x, run.y, run.paint);
    }
  }
}
