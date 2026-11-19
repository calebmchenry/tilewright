import { assertBounds, containsTile, type Bounds } from "./coordinates.ts";
import type { MapDocument, TileWrite } from "./document.ts";
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

// Bind snapshots to their originating document without retaining that document
// in serialized payloads or exposing annotation/session data to consumers.
const sources = new WeakMap<SelectionPayload, MapDocument>();

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
  const payload = Object.freeze({
    bounds: Object.freeze({ ...bounds }),
    width,
    height,
    tileCount: width * height,
    documentVersion: document.version,
    layers: Object.freeze(layers),
  });
  sources.set(payload, document);
  return payload;
}

export interface SelectionMove {
  readonly bounds: Bounds;
  readonly writes: readonly TileWrite[];
}

/** Reject unsafe translation before comparing against the fixed map boundary. */
export function translatedSelection(
  payload: SelectionPayload,
  dx: number,
  dy: number,
): Bounds {
  if (![dx, dy].every(Number.isSafeInteger))
    throw new RangeError("Move by whole, safe integer tiles.");
  const bounds = {
    minX: payload.bounds.minX + dx,
    minY: payload.bounds.minY + dy,
    maxX: payload.bounds.maxX + dx,
    maxY: payload.bounds.maxY + dy,
  };
  assertBounds(bounds);
  return Object.freeze(bounds);
}

/** Pure plan: clear S outside D, then write occupied snapshot cells into D.
 * Destination holes preserve B, including within S intersection D. */
export function planSelectionMove(
  document: MapDocument,
  payload: SelectionPayload,
  dx: number,
  dy: number,
): SelectionMove {
  if (
    sources.get(payload) !== document ||
    payload.documentVersion !== document.version
  )
    throw new Error(
      "Selection snapshot is stale or belongs to another document.",
    );
  const bounds = translatedSelection(payload, dx, dy);
  if (!selectionFits(document.bounds, bounds))
    throw new RangeError(
      "The entire selection must fit inside the map. Cancel and Grow Canvas to make more room.",
    );
  const writes: TileWrite[] = [];
  if (dx !== 0 || dy !== 0)
    for (const layer of payload.layers) {
      for (const run of layer.runs) {
        const x = payload.bounds.minX + run.x,
          y = payload.bounds.minY + run.y,
          end = x + run.length;
        const clear = (left: number, right: number) => {
          if (right > left)
            writes.push({
              layerId: layer.layerId,
              x: left,
              y,
              length: right - left,
              value: null,
            });
        };
        if (y < bounds.minY || y >= bounds.maxY) clear(x, end);
        else {
          clear(x, Math.min(end, bounds.minX));
          clear(Math.max(x, bounds.maxX), end);
        }
      }
      for (const run of layer.runs)
        writes.push({
          layerId: layer.layerId,
          x: bounds.minX + run.x,
          y: bounds.minY + run.y,
          length: run.length,
          value: run.value,
        });
    }
  return Object.freeze({
    bounds,
    writes: Object.freeze(writes.map((write) => Object.freeze(write))),
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
