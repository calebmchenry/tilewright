import { assertBounds, type Bounds } from "../domain/coordinates.ts";
import type { Point } from "./viewport.ts";

/** Both pointed-at tiles are included, independent of drag direction or chunks. */
export function rectangleBetween(start: Point, end: Point): Bounds {
  const bounds = Object.freeze({
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x) + 1,
    maxY: Math.max(start.y, end.y) + 1,
  });
  assertBounds(bounds);
  return bounds;
}
