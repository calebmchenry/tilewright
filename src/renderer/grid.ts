import { VISUAL_CHUNK_SIZE, type Bounds } from "../domain/coordinates.ts";
import {
  screenToWorld,
  worldToScreen,
  TILE_PIXELS,
  type Viewport,
  type ViewSize,
} from "../editor/viewport.ts";

export interface GridBand {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** CSS-pixel thresholds, independent of screen density and storage partitions. */
export function gridScale(view: Viewport) {
  const tilePixels = TILE_PIXELS * view.zoom;
  return {
    tileAlpha: Math.max(0, Math.min(0.22, ((tilePixels - 6) / 6) * 0.22)),
    // At most one major line per 24px. Always retain the world-zero lattice.
    chunkStride:
      2 **
      Math.max(0, Math.ceil(Math.log2(24 / (tilePixels * VISUAL_CHUNK_SIZE)))),
  };
}

/** Only visible line bands; never visits map content or allocates per map cell. */
export function gridLayout(
  bounds: Bounds,
  view: Viewport,
  size: ViewSize,
  density = 1,
) {
  const scale = gridScale(view);
  const tiles: GridBand[] = [],
    chunks: GridBand[] = [],
    edges: GridBand[] = [];
  const first = worldToScreen(bounds.minX, bounds.minY, view);
  const last = worldToScreen(bounds.maxX, bounds.maxY, view);
  const clip = {
    minX: Math.max(0, first.x),
    minY: Math.max(0, first.y),
    maxX: Math.min(size.width, last.x),
    maxY: Math.min(size.height, last.y),
  };
  const band = (
    vertical: boolean,
    position: number,
    width: number,
    target: GridBand[],
  ) => {
    const pixels = Math.max(1, Math.round(width * density));
    const start = Math.round(position * density - pixels / 2) / density;
    const end = start + pixels / density;
    const x = vertical ? Math.max(clip.minX, start) : clip.minX;
    const y = vertical ? clip.minY : Math.max(clip.minY, start);
    const right = vertical ? Math.min(clip.maxX, end) : clip.maxX;
    const bottom = vertical ? clip.maxY : Math.min(clip.maxY, end);
    if (right > x && bottom > y)
      target.push({ x, y, width: right - x, height: bottom - y });
  };
  if (clip.maxX <= clip.minX || clip.maxY <= clip.minY)
    return { ...scale, tiles, chunks, edges };
  const near = screenToWorld(0, 0, view),
    far = screenToWorld(size.width, size.height, view);
  for (const vertical of [true, false]) {
    const min = vertical ? bounds.minX : bounds.minY;
    const max = vertical ? bounds.maxX : bounds.maxY;
    const low = Math.max(min, vertical ? near.x : near.y);
    const high = Math.min(max, vertical ? far.x : far.y);
    const position = (coordinate: number) => {
      const point = worldToScreen(
        vertical ? coordinate : 0,
        vertical ? 0 : coordinate,
        view,
      );
      return vertical ? point.x : point.y;
    };
    const lines = (
      step: number,
      target: GridBand[],
      width: number,
      skipChunks: boolean,
    ) => {
      let coordinate = Math.ceil(low / step) * step;
      while (coordinate <= high) {
        if (
          coordinate > min &&
          coordinate < max &&
          (!skipChunks || coordinate % VISUAL_CHUNK_SIZE !== 0)
        )
          band(vertical, position(coordinate), width, target);
        const next = coordinate + step;
        if (next <= coordinate) break; // Safe termination even at floating-point limits.
        coordinate = next;
      }
    };
    if (scale.tileAlpha > 0) lines(1, tiles, 1, true);
    lines(VISUAL_CHUNK_SIZE * scale.chunkStride, chunks, 2, false);
    band(vertical, position(min), 2, edges);
    band(vertical, position(max), 2, edges);
  }
  return { ...scale, tiles, chunks, edges };
}
