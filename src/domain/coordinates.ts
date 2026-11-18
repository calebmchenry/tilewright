/** World-space, half-open tile bounds. No UI, renderer, or storage dependency. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const VISUAL_CHUNK_SIZE = 64;

export function assertBounds(bounds: Bounds): void {
  const { minX, minY, maxX, maxY } = bounds;
  if (
    ![minX, minY, maxX, maxY, maxX - minX, maxY - minY].every(
      Number.isSafeInteger,
    ) ||
    maxX <= minX ||
    maxY <= minY
  ) {
    throw new RangeError(
      "Map bounds must have positive, safe integer dimensions.",
    );
  }
}

/** Invalid/noninteger tile addresses are never inside a map. */
export function containsTile(bounds: Bounds, x: number, y: number): boolean {
  return (
    Number.isSafeInteger(x) &&
    Number.isSafeInteger(y) &&
    x >= bounds.minX &&
    x < bounds.maxX &&
    y >= bounds.minY &&
    y < bounds.maxY
  );
}

/** Visual chunks only; this does not choose the document's storage layout. */
export function visualChunkAt(x: number, y: number) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new RangeError("Tile addresses must be safe integers.");
  }
  const chunkX = Math.floor(x / VISUAL_CHUNK_SIZE);
  const chunkY = Math.floor(y / VISUAL_CHUNK_SIZE);
  return {
    chunkX,
    chunkY,
    localX: x - chunkX * VISUAL_CHUNK_SIZE,
    localY: y - chunkY * VISUAL_CHUNK_SIZE,
  };
}
