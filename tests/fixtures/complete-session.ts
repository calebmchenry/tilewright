import { AnnotationCommands } from "../../src/domain/annotations.ts";
import { newMapBounds } from "../../src/domain/canvas.ts";
import { MapDocument } from "../../src/domain/document.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import { annotationId, layerId, registryId } from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";

export const terrain = layerId("terrain"),
  walls = layerId("walls"),
  furniture = layerId("furniture");
export const grass = registryId("grass"),
  stone = registryId("stone");
export const oldGrass = "#335c46ff",
  newGrass = "#557755ff";
export const house = { minX: 60, minY: 60, maxX: 68, maxY: 68 };

/** Every persistent field, including hidden/offscreen content. Revision counters
 * and transient camera/tool/selection state intentionally are not document data. */
export function documentState(s: EditorSession) {
  const d = s.document;
  return {
    bounds: d.bounds,
    layers: d.layers,
    registry: d.registryEntries,
    annotations: d.annotations,
    runs: [...d.iterateRuns()],
  };
}
export const point = (s: EditorSession, x: number, y: number) =>
  tileToScreen(x, y, s.viewport.getSnapshot());

export function draw(
  s: EditorSession,
  tool: "pencil" | "eraser" | "line" | "rectangle",
  x: number,
  y: number,
  endX = x,
  endY = y,
) {
  if (
    !s.perform(tool) ||
    !s.drawing.begin(1, point(s, x, y)) ||
    !s.drawing.commit(1, point(s, endX, endY))
  )
    throw new Error(`Failed ${tool}: ${s.feedback.getSnapshot().message}`);
}

/** Repeatable authoring session, built through the same controllers as the UI.
 * Starts empty; no prepainted house or direct storage writes hide drawing bugs. */
export async function createDrawingSession() {
  const s = new EditorSession(
    new MapDocument({
      bounds: newMapBounds(128, 128),
      layers: [
        { id: terrain, name: "Terrain" },
        { id: walls, name: "Walls" },
        { id: furniture, name: "Furniture" },
      ],
    }),
  );
  s.canvasState.set("ready");
  s.history.markSaved(s.history.captureCheckpoint());
  s.history.markRecovery(s.history.captureCheckpoint());
  const states = [documentState(s)];
  const stop = s.document.subscribe(() => states.push(documentState(s)));
  const registry = new RegistryCommands(s.history, () => grass);
  registry.commit(
    registry.prepare({
      kind: "add",
      name: "Grass",
      color: oldGrass,
      adopt: false,
    }),
  );
  const masonry = new RegistryCommands(s.history, () => stone);
  masonry.commit(
    masonry.prepare({
      kind: "add",
      name: "Stone wall",
      color: "#b18b4d",
      adopt: false,
    }),
  );
  s.selectRegisteredColor(grass);
  draw(s, "rectangle", 48, 48, 95, 95);
  s.setColor(oldGrass); // Same appearance, deliberately distinct raw identity.
  draw(s, "rectangle", 48, 48, 55, 55);
  s.selectLayer(walls);
  s.selectRegisteredColor(stone);
  s.setRectangleMode("outline");
  draw(s, "rectangle", 60, 60, 67, 67);
  s.setColor("#d2b48c");
  s.perform("fill");
  await s.fill.start(point(s, 61, 61));
  s.setPencilSize(1);
  draw(s, "eraser", 63, 67); // Door, which must leave destination content alone.
  s.setColor("#556677");
  s.setRectangleMode("filled");
  draw(s, "rectangle", 68, 60, 70, 67); // Overwritten destination.
  s.setColor("#aa5533");
  draw(s, "line", 60, 60, 64, 60); // Asymmetry makes transforms observable.
  s.selectLayer(furniture);
  s.setColor("#aabbcc");
  s.setPencilSize(2);
  draw(s, "pencil", 61, 61);
  s.setPencilSize(1);
  s.setColor("#ff4400");
  draw(s, "pencil", 65, 63);
  s.setColor("#664422");
  draw(s, "pencil", 68, 63); // Overwritten furniture on a three-tile move.
  s.selectRegisteredColor(grass);
  draw(s, "rectangle", 80, 48, 87, 55);
  s.growCanvas({ left: 1, top: 1, right: 98, bottom: 98 });
  s.selectLayer(terrain);
  draw(s, "rectangle", 6016, 6016, 6079, 6079);
  s.selectLayer(furniture);
  draw(s, "rectangle", 6032, 6032, 6047, 6047);
  // Growth must make negative coordinates editable without moving prior content.
  s.selectLayer(terrain);
  draw(s, "pencil", -1, -1);
  for (const [id, name, tier, bounds, description] of [
    [
      "house",
      "Blacksmith's house",
      "detail",
      house,
      "Forge downstairs.\nHome upstairs — 家.",
    ],
    [
      "storehouse",
      "Storehouse",
      "detail",
      { minX: 80, minY: 60, maxX: 88, maxY: 68 },
      "Grain and tools",
    ],
    [
      "village",
      "Willow Village",
      "locality",
      { minX: 32, minY: 32, maxX: 128, maxY: 128 },
      "Two houses beside the meadow",
    ],
    [
      "region",
      "Green Reach",
      "region",
      { minX: 0, minY: 0, maxX: 6400, maxY: 6400 },
      "Grassland with a distant meadow",
    ],
  ] as const) {
    new AnnotationCommands(s.history, () => annotationId(id)).execute({
      kind: "create",
      value: {
        name,
        description,
        tier,
        bounds,
        label: { placement: "center" },
      },
    });
  }
  s.setLayerVisible(furniture, false);
  s.selectLayer(walls);
  s.viewport.set({ x: 52, y: 52, zoom: 1 });
  stop();
  return { session: s, states };
}
