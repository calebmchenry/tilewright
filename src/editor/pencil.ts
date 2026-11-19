import type { Bounds } from "../domain/coordinates.ts";
import type { Cell } from "../domain/values.ts";
import type { DrawingContext, DrawingTool, PaintSpan } from "./drawing.ts";
import type { Point } from "./viewport.ts";

export const MIN_PENCIL_SIZE = 1;
export const MAX_PENCIL_SIZE = 32;

export function assertPencilSize(size: number): void {
  if (
    !Number.isInteger(size) ||
    size < MIN_PENCIL_SIZE ||
    size > MAX_PENCIL_SIZE
  )
    throw new RangeError(
      "Pencil size must be a whole number from 1 to 32 tiles.",
    );
}

/** Square stamp: even sizes have their extra row/column below/right of the pointer. */
export function* pencilFootprint(
  tile: Point,
  size: number,
  bounds: Bounds,
  value: Cell,
): Generator<PaintSpan> {
  assertPencilSize(size);
  const before = Math.floor((size - 1) / 2);
  const x = Math.max(bounds.minX, tile.x - before);
  const endX = Math.min(bounds.maxX, tile.x + size - before);
  const endY = Math.min(bounds.maxY, tile.y + size - before);
  if (x >= endX) return;
  for (let y = Math.max(bounds.minY, tile.y - before); y < endY; y++)
    yield { x, y, length: endX - x, value };
}

function floorDivide(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n < 0n && n % d !== 0n ? q - 1n : q;
}

/**
 * Nearest-cell, 8-connected integer line, including both endpoints. Canonical
 * major-axis ordering makes ties independent of drag direction. Restrict the
 * iteration to centers whose square could touch the map, without changing the
 * original line's phase. BigInt keeps long outside segments numerically exact.
 */
export function* pencilCenters(
  from: Point,
  to: Point,
  size: number,
  bounds: Bounds,
): Generator<Point> {
  assertPencilSize(size);
  if (![from.x, from.y, to.x, to.y].every(Number.isSafeInteger))
    throw new RangeError("Pencil coordinates must be safe integers.");
  const dx = BigInt(to.x) - BigInt(from.x);
  const dy = BigInt(to.y) - BigInt(from.y);
  const abs = (n: bigint) => (n < 0n ? -n : n);
  const horizontal = abs(dx) >= abs(dy);
  const major = (p: Point) => (horizontal ? p.x : p.y);
  const minor = (p: Point) => (horizontal ? p.y : p.x);
  const [start, end] = major(from) <= major(to) ? [from, to] : [to, from];
  const before = Math.floor((size - 1) / 2),
    after = size - before - 1;
  const first = Math.max(
    major(start),
    (horizontal ? bounds.minX : bounds.minY) - after,
  );
  const last = Math.min(
    major(end),
    (horizontal ? bounds.maxX : bounds.maxY) - 1 + before,
  );
  const distance = BigInt(major(end)) - BigInt(major(start));
  const delta = BigInt(minor(end)) - BigInt(minor(start));
  for (let axis = first; axis <= last; axis++) {
    const offset = BigInt(axis) - BigInt(major(start));
    const other = Number(
      BigInt(minor(start)) +
        (distance === 0n
          ? 0n
          : floorDivide(2n * delta * offset + distance, 2n * distance)),
    );
    if (
      other < (horizontal ? bounds.minY : bounds.minX) - after ||
      other > (horizontal ? bounds.maxY : bounds.maxX) - 1 + before
    )
      continue;
    yield horizontal ? { x: axis, y: other } : { x: other, y: axis };
  }
}

export function pencilTool(getSize: () => number): DrawingTool {
  return squareBrushTool(getSize, "Pencil", ({ paint }) => paint);
}

/** Erasure shares pencil geometry, but writes absence rather than a paint color. */
export function eraserTool(getSize: () => number): DrawingTool {
  return squareBrushTool(getSize, "Eraser", () => null);
}

function squareBrushTool(
  getSize: () => number,
  label: string,
  value: (context: DrawingContext) => Cell,
): DrawingTool {
  return {
    label,
    footprint: (context) =>
      pencilFootprint(context.start, getSize(), context.bounds, value(context)),
    create: (context) => {
      const { bounds } = context;
      const paint = value(context);
      const size = getSize();
      assertPencilSize(size);
      let sampled = false;
      return {
        sample: ({ previous, tile }) => {
          const repeated =
            sampled && tile.x === previous.x && tile.y === previous.y;
          sampled = true;
          return {
            mode: "append",
            spans: (function* () {
              if (repeated) return;
              for (const center of pencilCenters(previous, tile, size, bounds))
                yield* pencilFootprint(center, size, bounds, paint);
            })(),
          };
        },
      };
    },
  };
}
