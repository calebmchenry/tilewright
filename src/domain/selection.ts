import { assertBounds, containsTile, type Bounds } from "./coordinates.ts";
import type { MapDocument } from "./document.ts";
import type { Cell, LayerId, TileValue } from "./values.ts";

export interface SelectionRun {
  /** Local offsets from the shared rectangle origin, never per-layer cropping. */
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly value: TileValue;
}
export interface SelectionLayer {
  readonly layerId: LayerId;
  readonly occupiedCount: number;
  readonly runs: readonly SelectionRun[];
}
export interface SelectionPayload {
  readonly bounds: Bounds;
  readonly width: number;
  readonly height: number;
  readonly tileCount: number;
  readonly documentVersion: number;
  readonly layers: readonly SelectionLayer[];
}

export function selectionFits(map: Bounds, rectangle: Bounds): boolean {
  return (
    containsTile(map, rectangle.minX, rectangle.minY) &&
    containsTile(map, rectangle.maxX - 1, rectangle.maxY - 1)
  );
}

/** Detached, immutable tile-only snapshot. The full extent encodes all holes. */
export function captureSelection(
  document: MapDocument,
  bounds: Bounds,
  layerIds: readonly LayerId[],
): SelectionPayload {
  assertBounds(bounds);
  const width = bounds.maxX - bounds.minX,
    height = bounds.maxY - bounds.minY;
  if (
    !selectionFits(document.bounds, bounds) ||
    !Number.isSafeInteger(width * height)
  )
    throw new RangeError(
      "Selection must fit the map with an exact tile count.",
    );
  if (!layerIds.length || new Set(layerIds).size !== layerIds.length)
    throw new RangeError("Choose at least one distinct selection layer.");
  const layers = layerIds.map((layerId) => {
    let occupiedCount = 0;
    const runs = [...document.iterateRuns(layerId, bounds)].map((run) => {
      occupiedCount += run.length;
      return Object.freeze({
        x: run.x - bounds.minX,
        y: run.y - bounds.minY,
        length: run.length,
        value: run.value,
      });
    });
    return Object.freeze({ layerId, occupiedCount, runs: Object.freeze(runs) });
  });
  return Object.freeze({
    bounds: Object.freeze({ ...bounds }),
    width,
    height,
    tileCount: width * height,
    documentVersion: document.version,
    layers: Object.freeze(layers),
  });
}

/** Inside holes read as null; an outside address or excluded layer is an error. */
export function selectionCell(
  payload: SelectionPayload,
  layerId: LayerId,
  x: number,
  y: number,
): Cell {
  if (
    !containsTile(
      { minX: 0, minY: 0, maxX: payload.width, maxY: payload.height },
      x,
      y,
    )
  )
    throw new RangeError("Cell must be inside the selection's local bounds.");
  const layer = payload.layers.find((item) => item.layerId === layerId);
  if (!layer) throw new RangeError("Layer is not included in this selection.");
  return (
    layer.runs.find(
      (run) => run.y === y && x >= run.x && x < run.x + run.length,
    )?.value ?? null
  );
}
