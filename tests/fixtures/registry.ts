import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registryId,
} from "../../src/domain/values.ts";

export const terrain = layerId("terrain"),
  buildings = layerId("buildings");
export const mountain = registryId("mountain"),
  wall = registryId("stone-wall");
/** TW-015's eight-cell walkthrough, creating both meanings via feature commands. */
export function registryDocument() {
  const document = new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
  document.writeBatch(
    [
      { layerId: terrain, x: 0, color: "#335c46ff" },
      { layerId: terrain, x: 1, color: "#335d46ff" },
      { layerId: terrain, x: 63, color: "#808080ff" },
      { layerId: terrain, x: 64, color: "#818181ff" },
      { layerId: buildings, x: 0, color: "#818181ff" },
      { layerId: buildings, x: 63, color: "#808080ff" },
      { layerId: buildings, x: 64, color: "#335c46ff" },
      { layerId: buildings, x: 65, color: "#557755ff" },
    ].map(({ layerId, x, color }) => ({
      layerId,
      x,
      y: 0,
      length: 1,
      value: rawColor(color),
    })),
  );
  const ids = [mountain, wall];
  const commands = new RegistryCommands(new CommandHistory(document), () =>
    ids.shift()!,
  );
  for (const [name, color] of [
    ["Mountain", "#808080"],
    ["Stone wall", "#818181"],
  ])
    commands.commit(
      commands.prepare({ kind: "add", name, color, adopt: true }),
    );
  document.applyCommands([
    {
      kind: "annotation",
      id: annotationId("village"),
      value: { name: "Village", x: 0, y: 0 },
    },
  ]);
  return document;
}
