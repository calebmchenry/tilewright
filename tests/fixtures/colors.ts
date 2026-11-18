import { MapDocument, type TileWrite } from "../../src/domain/document.ts";
import { layerId, rawColor } from "../../src/domain/values.ts";

/** Adjacent one-channel-step grays and ordinary black/white/background paint. */
export const COLOR_SWATCHES = [
  "#000000ff",
  "#ffffffff",
  "#1d2732ff",
  "#808080ff",
  "#818181ff",
  "#d67436ff",
  "#38a2adff",
] as const;
export function colorsDocument() {
  const terrain = layerId("terrain"),
    upper = layerId("upper");
  const document = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 96, maxY: 32 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: upper, name: "Raw colors" },
    ],
  });
  const writes: TileWrite[] = [];
  for (let y = 0; y < 32; y++)
    writes.push({
      layerId: terrain,
      x: 0,
      y,
      length: 96,
      value: rawColor("#335c46ff"),
    });
  for (const [index, color] of COLOR_SWATCHES.entries())
    for (let y = 8; y < 16; y++)
      writes.push({
        layerId: upper,
        x: 8 + index * 10,
        y,
        length: 8,
        value: rawColor(color),
      });
  document.writeBatch(writes);
  return document;
}
