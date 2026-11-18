import {
  createRenderer,
  type CanvasRenderer,
} from "../src/renderer/createRenderer";
import { bindDocument } from "../src/renderer/bindDocument";
import { EditorSession } from "../src/editor/session";
import { MapDocument, type TileWrite } from "../src/domain/document";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../src/domain/values";
import { CANVAS_INSET, TILE_PIXELS } from "../src/editor/viewport";
import { populatedDocument } from "./fixtures/populated";
import { gridDocument } from "./fixtures/grid";

const host = document.getElementById("tiles")!;
let renderer: CanvasRenderer;
let session: EditorSession;
let stop: (() => void)[] = [];
let lastDisposed: ReturnType<CanvasRenderer["snapshot"]> | undefined;
let queries: { layer: string | undefined; bounds: unknown }[] = [];
function small() {
  const document = new MapDocument({
    bounds: { minX: -65, minY: -65, maxX: 101, maxY: 70 },
    layers: [
      { id: layerId("terrain"), name: "Terrain" },
      { id: layerId("upper"), name: "Upper" },
    ],
  });
  document.applyCommands([
    { kind: "registry", id: registryId("grass"), value: { rgba: "#00ff00ff" } },
  ]);
  const writes: TileWrite[] = [];
  for (let y = 0; y < 5; y++)
    writes.push({
      layerId: layerId("terrain"),
      x: 0,
      y,
      length: 8,
      value: rawColor("#ff0000ff"),
    });
  for (const [x, value] of [
    [0, rawColor("#0000ffff")],
    [2, rawColor("#000000ff")],
    [3, registeredColor(registryId("grass"))],
    [4, rawColor("#0000ff80")],
    [5, rawColor("#ffffffff")],
    [6, rawColor("#00ff0000")],
    [7, registeredColor(registryId("missing"))],
  ] as const)
    writes.push({ layerId: layerId("upper"), x, y: 0, length: 1, value });
  for (const [x, y] of [
    [31, 31],
    [32, 31],
    [63, 63],
    [64, 63],
    [63, 64],
    [64, 64],
    [-65, -65],
    [-64, -64],
    [-1, -1],
    [100, 69],
  ])
    writes.push({
      layerId: layerId("terrain"),
      x,
      y,
      length: 1,
      value: rawColor("#ffffffff"),
    });
  document.writeBatch(writes);
  return document;
}

function dispose() {
  for (const unsubscribe of stop) unsubscribe();
  stop = [];
  renderer?.destroy();
  lastDisposed = renderer?.snapshot();
  session?.dispose();
}
async function load(
  kind: "small" | "empty" | "frontier" | "heartland" | "grid" = "small",
) {
  dispose();
  queries = [];
  const document =
    kind === "grid"
      ? gridDocument()
      : kind === "small"
        ? small()
        : kind === "empty"
          ? new MapDocument()
          : populatedDocument(kind === "frontier" ? 0 : 1);
  // Record bounded queries, not pixels or model objects. Clear between measurements.
  const original = document.iterateRuns.bind(document);
  document.iterateRuns = (id, bounds) => {
    queries.push({ layer: id, bounds });
    return original(id, bounds);
  };
  session = new EditorSession(document);
  renderer = await createRenderer(host, session);
  stop = [
    bindDocument(session, (change) => renderer.invalidate(change)),
    session.viewport.subscribe(() => renderer.resize()),
    session.hiddenLayers.subscribe(() => renderer.resize()),
    session.rectangle.subscribe(() => renderer.resize()),
  ];
  renderer.resize();
  return renderer.snapshot();
}
const probe = {
  load,
  dispose,
  get session() {
    return session;
  },
  stats: () => renderer.snapshot(),
  disposed: () => lastDisposed,
  queries: () => queries,
  resetQueries: () => {
    queries = [];
  },
  view(x: number, y: number, zoom = 1) {
    session.viewport.set({ x, y, zoom });
  },
  resize(width: number, height: number) {
    host.style.width = `${width}px`;
    host.style.height = `${height}px`;
    renderer.resize();
  },
  edit(layer: string, x: number, y: number, rgba: string | null, length = 1) {
    session.execute("Test edit", [
      {
        kind: "tiles",
        writes: [
          {
            layerId: layerId(layer),
            x,
            y,
            length,
            value: rgba === null ? null : rawColor(rgba),
          },
        ],
      },
    ]);
  },
  registry(id: string, rgba: string | null) {
    session.execute("Test registry", [
      {
        kind: "registry",
        id: registryId(id),
        value: rgba === null ? null : { rgba },
      },
    ]);
  },
  reference(layer: string, x: number, y: number, id: string) {
    session.execute("Test reference", [
      {
        kind: "tiles",
        writes: [
          {
            layerId: layerId(layer),
            x,
            y,
            length: 1,
            value: registeredColor(registryId(id)),
          },
        ],
      },
    ]);
  },
  remove(id: string) {
    session.execute("Test removal", [
      { kind: "remove-layer", id: layerId(id) },
    ]);
  },
  grow() {
    session.execute("Test growth", [
      {
        kind: "bounds",
        bounds: { ...session.document.bounds, maxX: 165, maxY: 134 },
      },
    ]);
  },
  reorder(ids: string[]) {
    session.execute("Test order", [
      { kind: "reorder-layers", ids: ids.map(layerId) },
    ]);
  },
  hide(id: string, hidden: boolean) {
    session.setLayerVisible(layerId(id), !hidden);
  },
  sampleScreen(points: [number, number][]) {
    renderer.resize();
    const canvas = host.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2")!;
    return points.map(([x, y]) => {
      const pixel = new Uint8Array(4);
      gl.readPixels(
        Math.floor(x * devicePixelRatio),
        canvas.height - 1 - Math.floor(y * devicePixelRatio),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return [...pixel];
    });
  },
  sample(points: [number, number][]) {
    renderer.resize();
    const canvas = host.querySelector("canvas")!;
    const gl = canvas.getContext("webgl2")!;
    const view = session.viewport.getSnapshot(),
      scale = TILE_PIXELS * view.zoom;
    return points.map(([x, y]) => {
      const sx = Math.floor(
        (CANVAS_INSET + (x + 0.5 - view.x) * scale) * window.devicePixelRatio,
      );
      const sy = Math.floor(
        (CANVAS_INSET + (y + 0.5 - view.y) * scale) * window.devicePixelRatio,
      );
      if (sx < 0 || sy < 0 || sx >= canvas.width || sy >= canvas.height)
        throw new Error("Sample outside viewport");
      const pixel = new Uint8Array(4);
      gl.readPixels(
        sx,
        canvas.height - 1 - sy,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return [...pixel];
    });
  },
};
export type TileProbe = typeof probe;
Object.assign(window, { tileProbe: probe });
void load().then(() => {
  document.body.dataset.ready = "true";
});
