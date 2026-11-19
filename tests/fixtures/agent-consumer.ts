import { MapDocument } from "../../src/domain/document.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";

/** Authored independently of the checked-in export; exercises real recolor/hide actions. */
export function consumerGoldenSession(): EditorSession {
  const document = new MapDocument({
    bounds: { minX: -2, minY: -1, maxX: 6, maxY: 5 },
    layers: [
      { id: layerId("terrain"), name: "Terrain" },
      { id: layerId("walls"), name: "Walls" },
      { id: layerId("furniture"), name: "Furniture" },
      // Equal display names must not conflate distinct identities, even when empty.
      { id: layerId("empty"), name: "Furniture" },
    ],
  });
  const vocabulary = [
    ["grass", "Grass", "#629653ff"],
    ["stone", "Stone wall", "#8d939cff"],
    ["table", "Oak table", "#a7754cff"],
    ["water", "Water", "#417aabff"],
  ];
  document.applyCommands(
    vocabulary.map(([id, name, rgba]) => ({
      kind: "registry",
      id: registryId(id),
      value: { name, rgba },
    })),
  );
  const paint = (
    layer: string,
    x: number,
    y: number,
    length: number,
    id: string,
  ) =>
    document.writeBatch([
      {
        layerId: layerId(layer),
        x,
        y,
        length,
        value: registeredColor(registryId(id)),
      },
    ]);
  paint("terrain", -1, 0, 6, "grass");
  paint("terrain", -1, 1, 6, "grass");
  paint("terrain", 0, 2, 4, "grass");
  paint("walls", 0, 0, 3, "stone");
  paint("walls", 0, 1, 1, "stone");
  paint("furniture", 1, 0, 1, "table");
  paint("furniture", 1, 1, 1, "table");
  paint("furniture", 3, 2, 1, "grass");
  for (const [x, y, rgba] of [
    [-2, -1, "#ffffff00"],
    [4, 3, "#629653ff"],
    [5, 3, "#335c46ff"],
    [5, 4, "#000000ff"],
  ] as const)
    document.setCell(layerId("terrain"), x, y, rawColor(rgba));
  document.setCell(layerId("furniture"), 2, 1, rawColor("#000000ff"));
  for (const area of [
    {
      id: "house",
      name: "Blacksmith’s house",
      tier: "detail",
      description:
        "Oak worktables stand over grass and stone.\nKeep every underlying tile. 🔨",
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 2 },
    },
    {
      id: "village",
      name: "Starting village",
      tier: "locality",
      description:
        "The eastern green swatches are unlabeled, even when one matches Meadow.\nWater is an unused registered meaning.",
      bounds: { minX: -1, minY: 0, maxX: 6, maxY: 5 },
    },
    {
      id: "region",
      name: "Northern reach",
      tier: "region",
      description: "",
      bounds: { minX: -2, minY: -1, maxX: 6, maxY: 5 },
    },
  ]) {
    const { id, ...record } = area;
    document.applyCommands([
      {
        kind: "annotation",
        id: annotationId(id),
        value: { ...record, label: { placement: "center" } },
      },
    ]);
  }
  const session = new EditorSession(document);
  session.registryCommands.commit(
    session.registryCommands.prepare({
      kind: "edit",
      id: registryId("grass"),
      name: "Meadow",
      color: "#335c46",
    }),
  );
  session.setLayerVisible(layerId("walls"), false);
  session.setLayerVisible(layerId("furniture"), false);
  return session;
}
