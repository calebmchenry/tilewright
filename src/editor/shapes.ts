import type { Bounds } from "../domain/coordinates.ts";
import type { TileValue } from "../domain/values.ts";
import type { DrawingTool, PaintSpan } from "./drawing.ts";
import { pencilCenters } from "./pencil.ts";
import type { Point } from "./viewport.ts";

export type RectangleMode = "filled" | "outline";

/** Same exact, reversal-invariant 8-connected rasterization as a size-one pencil. */
export function* lineSpans(
  from: Point,
  to: Point,
  bounds: Bounds,
  value: TileValue,
): Generator<PaintSpan> {
  for (const { x, y } of pencilCenters(from, to, 1, bounds))
    yield { x, y, length: 1, value };
}

/** Inclusive endpoints; clip the original perimeter, never outline the intersection. */
export function* rectangleSpans(
  from: Point,
  to: Point,
  bounds: Bounds,
  value: TileValue,
  mode: RectangleMode,
): Generator<PaintSpan> {
  if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger))
    throw new RangeError("Rectangle coordinates must be safe integers.");
  if (mode !== "filled" && mode !== "outline")
    throw new RangeError("Choose a filled or outlined rectangle.");
  const left = Math.min(from.x, to.x),
    right = Math.max(from.x, to.x);
  const top = Math.min(from.y, to.y),
    bottom = Math.max(from.y, to.y);
  // Intersect inclusive endpoints before adding one, including at safe-integer limits.
  const x = Math.max(left, bounds.minX);
  const lastX = Math.min(right, bounds.maxX - 1);
  const lastY = Math.min(bottom, bounds.maxY - 1);
  if (x > lastX) return;
  for (let y = Math.max(top, bounds.minY); y <= lastY; y++) {
    if (mode === "filled" || y === top || y === bottom)
      yield { x, y, length: lastX - x + 1, value };
    else {
      if (left >= bounds.minX && left < bounds.maxX)
        yield { x: left, y, length: 1, value };
      if (right !== left && right >= bounds.minX && right < bounds.maxX)
        yield { x: right, y, length: 1, value };
    }
  }
}

export const lineTool: DrawingTool = {
  label: "Line",
  create: ({ start, bounds, paint }) => ({
    sample: ({ tile }) => ({
      mode: "replace",
      spans: lineSpans(start, tile, bounds, paint),
    }),
  }),
};

export function rectangleTool(getMode: () => RectangleMode): DrawingTool {
  return {
    label: "Rectangle",
    create: ({ start, bounds, paint }) => {
      const mode = getMode();
      return {
        sample: ({ tile }) => ({
          mode: "replace",
          spans: rectangleSpans(start, tile, bounds, paint, mode),
        }),
      };
    },
  };
}
