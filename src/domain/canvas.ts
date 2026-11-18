import { assertBounds, VISUAL_CHUNK_SIZE, type Bounds } from "./coordinates.ts";

export const DEFAULT_MAP_SIZE = 256;
// Authoring guardrail, not a dense allocation or a performance guarantee.
export const MAX_MAP_SIZE = 65_536;
export const GROWTH_EDGES = ["left", "right", "top", "bottom"] as const;
export type GrowthEdge = (typeof GROWTH_EDGES)[number];
export type GrowthCounts = Readonly<Record<GrowthEdge, number>>;

export function validateCanvasBounds(bounds: Bounds): Bounds {
  assertBounds(bounds);
  if (
    bounds.maxX - bounds.minX > MAX_MAP_SIZE ||
    bounds.maxY - bounds.minY > MAX_MAP_SIZE
  )
    throw new RangeError(
      "Map width and height must each be at most 65,536 tiles (1,024 chunks).",
    );
  return Object.freeze({ ...bounds });
}

export function newMapBounds(width: number, height: number): Bounds {
  if (
    ![width, height].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    throw new RangeError(
      "Width and height must be positive whole numbers of tiles.",
    );
  return validateCanvasBounds({ minX: 0, minY: 0, maxX: width, maxY: height });
}

/** Parse decimal form input without rounding fractions, exponents or unsafe integers. */
export function canvasInteger(
  text: string,
  label: string,
  minimum: number,
): number {
  if (!/^\d+$/.test(text.trim()))
    throw new RangeError(`${label} must be a whole number.`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new RangeError(
      `${label} must be a safe whole number of at least ${minimum}.`,
    );
  return value;
}

/** Expand in world space; zero on all edges is a history-preserving no-op. */
export function grownMapBounds(bounds: Bounds, counts: GrowthCounts): Bounds {
  assertBounds(bounds);
  for (const edge of GROWTH_EDGES) {
    const count = counts[edge];
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      !Number.isSafeInteger(count * VISUAL_CHUNK_SIZE)
    )
      throw new RangeError(
        `${edge} growth must be a nonnegative safe whole number of 64-tile increments.`,
      );
  }
  return validateCanvasBounds({
    minX: bounds.minX - VISUAL_CHUNK_SIZE * counts.left,
    maxX: bounds.maxX + VISUAL_CHUNK_SIZE * counts.right,
    minY: bounds.minY - VISUAL_CHUNK_SIZE * counts.top,
    maxY: bounds.maxY + VISUAL_CHUNK_SIZE * counts.bottom,
  });
}
