import { MapDocument, type TileWrite } from "../../src/domain/document.ts";
import { layerId, rawColor } from "../../src/domain/values.ts";

/** Known 196×198 map with signed/partial edges and an 8×8 cross-chunk footprint. */
export function gridDocument() {
  const terrain = layerId("terrain"),
    buildings = layerId("buildings");
  const document = new MapDocument({
    bounds: { minX: -65, minY: -65, maxX: 131, maxY: 133 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
  const writes: TileWrite[] = [];
  for (let y = -65; y < 133; y++) {
    writes.push({
      layerId: terrain,
      x: -65,
      y,
      length: 196,
      value: rawColor("#335c46ff"),
    });
    writes.push({
      layerId: terrain,
      x: 20,
      y,
      length: 4,
      value: rawColor("#376b9aff"),
    });
  }
  for (let y = 60; y < 68; y++)
    writes.push({
      layerId: buildings,
      x: 60,
      y,
      length: 8,
      value: rawColor("#b18b4dff"),
    });
  for (let y = 124; y < 131; y++)
    writes.push({
      layerId: buildings,
      x: 124,
      y,
      length: 6,
      value: rawColor("#b18b4dff"),
    });
  document.writeBatch(writes);
  return document;
}
