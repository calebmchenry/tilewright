import { containsTile } from "../domain/coordinates.ts";
import type { MapDocument } from "../domain/document.ts";
import type { LayerId, TileValue } from "../domain/values.ts";
import type { Point } from "./viewport.ts";

/** Pick stored identity from the topmost occupied visible layer, never RGB pixels. */
export function sampleVisibleCell(
  document: MapDocument,
  tile: Point,
  hidden: readonly LayerId[],
): Readonly<{ layerId: LayerId; value: TileValue }> | null {
  if (
    !Number.isSafeInteger(tile.x) ||
    !Number.isSafeInteger(tile.y) ||
    !containsTile(document.bounds, tile.x, tile.y)
  )
    return null;
  const layers = document.layers;
  for (let i = layers.length - 1; i >= 0; i--) {
    const { id } = layers[i];
    if (hidden.includes(id)) continue;
    const value = document.getCell(id, tile.x, tile.y);
    if (value !== null) return Object.freeze({ layerId: id, value });
  }
  return null;
}
