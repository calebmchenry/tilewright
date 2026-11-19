import { MapDocument, type TileWrite } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  annotationId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { buildings, mountain, terrain, wall } from "./registry.ts";

export const grass = registryId("grass");
export const OLD_GRASS = "#335c46ff",
  NEW_GRASS = "#557755ff";
export const RECOLOR_ORIGINS = [0, 1024, 6272] as const;
/** Three identical swatch groups across a target-size canvas. In each group:
 * x=8: covered Grass; 24: upper Grass; 40: raw old; 56: raw new;
 * 72: Mountain; 88: Stone wall; 104: exposed Grass. All are 8x8 at y=8.
 * Small enough for complete content assertions; full populated maps are separate.
 */
export function recolorDocument() {
  const document = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 6400, maxY: 6400 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
  const ids = [grass, mountain, wall];
  const commands = new RegistryCommands(new CommandHistory(document), () =>
    ids.shift()!,
  );
  for (const [name, color] of [
    ["Grass", OLD_GRASS],
    ["Mountain", "#808080"],
    ["Stone wall", "#818181"],
  ])
    commands.commit(
      commands.prepare({ kind: "add", name, color, adopt: false }),
    );
  const writes: TileWrite[] = [];
  for (const origin of RECOLOR_ORIGINS) {
    const swatches = [
      [terrain, 8, registeredColor(grass)],
      [buildings, 8, registeredColor(wall)],
      [terrain, 24, registeredColor(mountain)],
      [buildings, 24, registeredColor(grass)],
      [terrain, 40, rawColor(OLD_GRASS)],
      [terrain, 56, rawColor(NEW_GRASS)],
      [terrain, 72, registeredColor(mountain)],
      [terrain, 88, registeredColor(wall)],
      [terrain, 104, registeredColor(grass)],
    ] as const;
    for (const [layerId, x, value] of swatches)
      for (let y = 8; y < 16; y++)
        writes.push({ layerId, x: origin + x, y, length: 8, value });
  }
  document.writeBatch(writes);
  document.applyCommands([
    {
      kind: "annotation",
      id: annotationId("village"),
      value: { name: "Village", x: 8, y: 8 },
    },
  ]);
  return document;
}
