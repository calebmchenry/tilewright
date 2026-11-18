import type { MapDocument } from "../domain/document.ts";
import type { TileValue } from "../domain/values.ts";

export type Rgba = readonly [number, number, number, number];
export const MISSING_COLOR: Rgba = Object.freeze([255, 0, 255, 255]);

/** Shared rendering lookup. Registry payloads use rgba; never detach the ID. */
export function resolveColor(document: MapDocument, value: TileValue): Rgba {
  const rgba =
    value.kind === "raw"
      ? value.rgba
      : document.getRegistryEntry(value.registryId)?.rgba;
  // Unresolved or malformed references remain conspicuous occupied cells.
  if (typeof rgba !== "string" || !/^#[0-9a-f]{8}$/i.test(rgba))
    return MISSING_COLOR;
  const channel = (i: number) => parseInt(rgba.slice(i, i + 2), 16);
  return [channel(1), channel(3), channel(5), channel(7)];
}
