import { MapDocument } from "../../src/domain/document.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";

export const terrain = layerId("terrain"),
  walls = layerId("walls"),
  furniture = layerId("furniture");
export const stone = registryId("stone");
export const house = { minX: 60, minY: 60, maxX: 68, maxY: 68 };

/** Signed partial map edges, covered walls, sparse furniture and enclosed labels. */
export function selectionDocument() {
  const document = new MapDocument({
    bounds: { minX: -65, minY: -65, maxX: 131, maxY: 133 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: walls, name: "Walls" },
      { id: furniture, name: "Furniture" },
    ],
  });
  document.applyCommands([
    {
      kind: "registry",
      id: stone,
      value: { name: "Stone", rgba: "#b18b4dff" },
    },
    {
      kind: "annotation",
      id: annotationId("house"),
      value: {
        name: "House",
        description: "Independent label",
        bounds: house,
        anchor: { x: 64, y: 64 },
        tier: "detail",
      },
    },
  ]);
  document.writeBatch([
    ...Array.from({ length: 198 }, (_, i) => ({
      layerId: terrain,
      x: -65,
      y: -65 + i,
      length: 196,
      value: rawColor("#335c46ff"),
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      layerId: walls,
      x: 60,
      y: 60 + i,
      length: 8,
      value: registeredColor(stone),
    })),
    {
      layerId: furniture,
      x: 60,
      y: 61,
      length: 2,
      value: rawColor("#aabbccff"),
    },
    {
      layerId: furniture,
      x: 64,
      y: 61,
      length: 1,
      value: rawColor("#00000000"),
    },
    {
      layerId: furniture,
      x: 70,
      y: 66,
      length: 1,
      value: rawColor("#ff0000ff"),
    },
  ]);
  return document;
}

/** The movement contract's house, with distinct C/D and 24 overwritten wall cells. */
export function movementDocument() {
  const document = selectionDocument();
  document.writeBatch([
    ...Array.from({ length: 8 }, (_, i) => ({
      layerId: walls,
      x: 68,
      y: 60 + i,
      length: 3,
      value: rawColor("#556677ff"),
    })),
    {
      layerId: furniture,
      x: 61,
      y: 61,
      length: 1,
      value: rawColor("#ddeeffff"),
    },
  ]);
  return document;
}
