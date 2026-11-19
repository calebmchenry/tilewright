import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import type { EditorSession } from "../../src/editor/session.ts";
import type { PaintSpan } from "../../src/editor/drawing.ts";

export function drawingDocument() {
  const document = new MapDocument({
    bounds: { minX: -65, minY: -65, maxX: 131, maxY: 133 },
    layers: [
      { id: layerId("terrain"), name: "Terrain" },
      { id: layerId("buildings"), name: "Buildings" },
    ],
  });
  document.applyCommands([
    {
      kind: "registry",
      id: registryId("grass"),
      value: { name: "Grass", rgba: "#00ff00ff" },
    },
  ]);
  document.writeBatch([
    {
      layerId: layerId("terrain"),
      x: 60,
      y: 63,
      length: 12,
      value: rawColor("#335c46ff"),
    },
    {
      layerId: layerId("buildings"),
      x: 60,
      y: 63,
      length: 8,
      value: registeredColor(registryId("grass")),
    },
  ]);
  return document;
}

/** Test-only algorithms; shipped tool behavior/size controls belong to TW-019 onward. */
export function installDrawingTools(session: EditorSession) {
  for (const id of ["pencil", "rectangle", "eraser"] as const)
    session.drawing.register(id, {
      label:
        id === "pencil" ? "Pencil" : id === "eraser" ? "Eraser" : "Rectangle",
      create: ({ paint }) => ({
        sample: ({ start, previous, tile }) => {
          const from = id === "rectangle" ? start : previous;
          const spans: PaintSpan[] = [];
          for (
            let y = Math.min(from.y, tile.y);
            y <= Math.max(from.y, tile.y);
            y++
          )
            spans.push({
              x: Math.min(from.x, tile.x),
              y,
              length: Math.abs(from.x - tile.x) + 1,
              value: id === "eraser" ? null : paint,
            });
          return { mode: id === "rectangle" ? "replace" : "append", spans };
        },
      }),
    });
}
