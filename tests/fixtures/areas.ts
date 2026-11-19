import {
  validateNamedArea,
  type AreaTier,
} from "../../src/domain/annotations.ts";
import type { DocumentCommand } from "../../src/domain/commands.ts";
import { MapDocument } from "../../src/domain/document.ts";
import { annotationId, layerId, rawColor } from "../../src/domain/values.ts";

export function areaDocument(): MapDocument {
  const document = new MapDocument({
    bounds: { minX: -64, minY: -64, maxX: 6400, maxY: 6400 },
    layers: [
      { id: layerId("terrain"), name: "Terrain" },
      { id: layerId("buildings"), name: "Buildings" },
    ],
  });
  const entries = [
    {
      id: "area-house",
      name: "Blacksmith's house",
      description: "Forge downstairs.\nHome upstairs.",
      tier: "detail",
      bounds: { minX: 60, minY: 60, maxX: 68, maxY: 68 },
    },
    {
      id: "area-village",
      name: "Willow Village",
      description: "",
      tier: "locality",
      bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
    },
    {
      id: "area-region",
      name: "Green Reach",
      description: "Settled valley and surrounding hills.",
      tier: "region",
      bounds: { minX: -64, minY: -64, maxX: 1024, maxY: 1024 },
    },
  ];
  document.applyCommands(
    entries.map(({ id, ...value }) => ({
      kind: "annotation",
      id: annotationId(id),
      value: validateNamedArea(
        { ...value, label: { placement: "center" } },
        document.bounds,
      ),
    })),
  );
  for (let y = 0; y < 128; y++)
    document.writeBatch([
      {
        layerId: layerId("terrain"),
        x: 0,
        y,
        length: 128,
        value: rawColor("#335c46ff"),
      },
    ]);
  for (let y = 60; y < 68; y++)
    document.writeBatch([
      {
        layerId: layerId("buildings"),
        x: 60,
        y,
        length: y === 60 ? 6 : 8,
        value: rawColor("#b18b4dff"),
      },
    ]);
  return document;
}

/** 99 populated villages, their 891 houses and 99 regions on either golden map. */
export function annotatePopulatedMap(document: MapDocument): void {
  const commands: DocumentCommand[] = [];
  const add = (
    id: string,
    tier: AreaTier,
    x: number,
    y: number,
    width: number,
  ) =>
    commands.push({
      kind: "annotation",
      id: annotationId(id),
      value: validateNamedArea(
        {
          name: `${tier} ${id.slice(5)}`,
          description: `Full description for ${id}.\nPreserve even when hidden.`,
          tier,
          bounds: { minX: x, minY: y, maxX: x + width, maxY: y + width },
          label: { placement: "center" },
        },
        document.bounds,
      ),
    });
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      if (x === 9 && y === 9) continue;
      const id = `${x}-${y}`,
        vx = x * 640 + 256,
        vy = y * 640 + 256;
      add(`area-region-${id}`, "region", x * 640, y * 640, 640);
      add(`area-village-${id}`, "locality", vx, vy, 128);
      for (const dy of [12, 60, 108])
        for (const dx of [12, 60, 108])
          add(`area-house-${id}-${dx}-${dy}`, "detail", vx + dx, vy + dy, 8);
    }
  document.applyCommands(commands);
}
