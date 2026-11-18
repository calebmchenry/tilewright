import type { Bounds } from "../domain/coordinates.ts";
import type { MapDocument } from "../domain/document.ts";
import { cellKey, type LayerId, type RegistryId } from "../domain/values.ts";
import {
  CANVAS_INSET,
  TILE_PIXELS,
  type Viewport,
} from "../editor/viewport.ts";
import { resolveColor, type Rgba } from "./colors.ts";

// Render cache granularity, independent of the visual 64-tile lattice.
export const RENDER_CHUNK_SIZE = 32;
export const CHUNK_BYTES = RENDER_CHUNK_SIZE ** 2 * 4;
export interface VisibleChunk {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly bounds: Bounds;
}
export function intersects(a: Bounds, b: Bounds): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

/** Only viewport-intersecting chunk coordinates; no document content enumeration. */
export function visibleChunks(
  bounds: Bounds,
  view: Viewport,
  width: number,
  height: number,
  size = RENDER_CHUNK_SIZE,
): VisibleChunk[] {
  if (
    ![view.x, view.y, view.zoom, width, height].every(Number.isFinite) ||
    view.zoom <= 0
  )
    throw new RangeError("Viewport must be finite with positive zoom.");
  if (width <= 0 || height <= 0) return [];
  const scale = TILE_PIXELS * view.zoom;
  const minX = Math.max(bounds.minX, Math.floor(view.x - CANVAS_INSET / scale));
  const minY = Math.max(bounds.minY, Math.floor(view.y - CANVAS_INSET / scale));
  const maxX = Math.min(
    bounds.maxX,
    Math.ceil(view.x + (width - CANVAS_INSET) / scale),
  );
  const maxY = Math.min(
    bounds.maxY,
    Math.ceil(view.y + (height - CANVAS_INSET) / scale),
  );
  if (minX >= maxX || minY >= maxY) return [];
  const result: VisibleChunk[] = [];
  for (
    let cy = Math.floor(minY / size);
    cy <= Math.floor((maxY - 1) / size);
    cy++
  )
    for (
      let cx = Math.floor(minX / size);
      cx <= Math.floor((maxX - 1) / size);
      cx++
    ) {
      const x = cx * size,
        y = cy * size;
      result.push({
        key: `${cx},${cy}`,
        x,
        y,
        bounds: {
          minX: Math.max(bounds.minX, x),
          minY: Math.max(bounds.minY, y),
          maxX: x + Math.min(size, bounds.maxX - x),
          maxY: y + Math.min(size, bounds.maxY - y),
        },
      });
    }
  return result;
}

/** At most one chunk of premultiplied RGBA, including transparent empty cells. */
export function rasterizeChunk(
  document: MapDocument,
  layer: LayerId,
  chunk: VisibleChunk,
) {
  let pixels: Uint8Array | null = null;
  let cells = 0,
    runs = 0;
  const registryIds = new Set<RegistryId>();
  const colors = new Map<string, Rgba>();
  for (const run of document.iterateRuns(layer, chunk.bounds)) {
    pixels ??= new Uint8Array(CHUNK_BYTES);
    runs++;
    cells += run.length;
    if (run.value.kind === "registered") registryIds.add(run.value.registryId);
    const key = cellKey(run.value);
    let rgba = colors.get(key);
    if (!rgba) {
      rgba = resolveColor(document, run.value);
      colors.set(key, rgba);
    }
    const [r, g, b, a] = rgba;
    for (let x = run.x; x < run.x + run.length; x++) {
      const offset = ((run.y - chunk.y) * RENDER_CHUNK_SIZE + x - chunk.x) * 4;
      pixels[offset] = Math.round((r * a) / 255);
      pixels[offset + 1] = Math.round((g * a) / 255);
      pixels[offset + 2] = Math.round((b * a) / 255);
      pixels[offset + 3] = a;
    }
  }
  return { pixels, cells, runs, registryIds };
}
