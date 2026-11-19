import { assertBounds, containsTile, type Bounds } from "./coordinates.ts";
import type { MapDocument, TileWrite } from "./document.ts";
import {
  equalCells,
  type Cell,
  type LayerId,
  type TileValue,
} from "./values.ts";

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
const roots = new WeakMap<SelectionPayload, SelectionPayload>();

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
  roots.set(payload, payload);
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
  return planSelectionTransform(
    document,
    payload,
    payload,
    translatedSelection(payload, dx, dy),
  );
}

export const selectionTransforms = {
  "rotate-clockwise": "Rotate clockwise",
  "rotate-counterclockwise": "Rotate counterclockwise",
  "flip-horizontal": "Flip horizontal",
  "flip-vertical": "Flip vertical",
} as const;
export type SelectionTransform = keyof typeof selectionTransforms;

/** Pure local geometry; all layers retain the full shared extent and values. */
export function transformSelection(
  payload: SelectionPayload,
  operation: SelectionTransform,
): SelectionPayload {
  const document = sources.get(payload),
    root = roots.get(payload);
  if (!document || !root) throw new Error("Unknown selection snapshot.");
  if (!Object.hasOwn(selectionTransforms, operation))
    throw new RangeError("Unknown selection transform.");
  const rotate = operation.startsWith("rotate");
  const width = rotate ? payload.height : payload.width;
  const height = rotate ? payload.width : payload.height;
  const bounds = {
    ...payload.bounds,
    maxX: payload.bounds.minX + width,
    maxY: payload.bounds.minY + height,
  };
  assertBounds(bounds);
  const layers = payload.layers.map((layer) => {
    const runs: SelectionRun[] = [];
    for (const run of layer.runs) {
      if (!rotate) {
        runs.push({
          ...run,
          x:
            operation === "flip-horizontal"
              ? width - run.x - run.length
              : run.x,
          y: operation === "flip-vertical" ? height - 1 - run.y : run.y,
        });
      } else {
        for (let u = run.x; u < run.x + run.length; u++)
          runs.push({
            x:
              operation === "rotate-clockwise"
                ? payload.height - 1 - run.y
                : run.y,
            y: operation === "rotate-clockwise" ? u : payload.width - 1 - u,
            length: 1,
            value: run.value,
          });
      }
    }
    runs.sort((a, b) => a.y - b.y || a.x - b.x);
    const merged: SelectionRun[] = [];
    for (const run of runs) {
      const last = merged.at(-1);
      if (
        last &&
        last.y === run.y &&
        last.x + last.length === run.x &&
        equalCells(last.value, run.value)
      )
        merged[merged.length - 1] = {
          ...last,
          length: last.length + run.length,
        };
      else merged.push(run);
    }
    return Object.freeze({
      ...layer,
      runs: Object.freeze(merged.map((run) => Object.freeze(run))),
    });
  });
  const result = Object.freeze({
    ...payload,
    bounds: Object.freeze(bounds),
    width,
    height,
    layers: Object.freeze(layers),
  });
  sources.set(result, document);
  roots.set(result, root);
  return result;
}

/** Snapshot-bound move/transform: clear S outside D; holes in D preserve B. */
export function planSelectionTransform(
  document: MapDocument,
  source: SelectionPayload,
  transformed: SelectionPayload,
  bounds: Bounds = transformed.bounds,
): SelectionMove {
  if (
    sources.get(source) !== document ||
    sources.get(transformed) !== document ||
    roots.get(source) !== roots.get(transformed) ||
    source.documentVersion !== document.version ||
    transformed.documentVersion !== document.version
  )
    throw new Error(
      "Selection snapshot is stale or belongs to another document.",
    );
  assertBounds(bounds);
  if (
    bounds.maxX - bounds.minX !== transformed.width ||
    bounds.maxY - bounds.minY !== transformed.height
  )
    throw new RangeError("Destination must match the transformed dimensions.");
  if (!selectionFits(document.bounds, bounds))
    throw new RangeError(
      "The entire selection must fit inside the map. Reposition it or cancel and Grow Canvas.",
    );
  const writes: TileWrite[] = [];
  for (const layer of source.layers) {
    for (const run of layer.runs) {
      const x = source.bounds.minX + run.x,
        y = source.bounds.minY + run.y,
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
  }
  // Identity moves retain their previous empty-plan fast path.
  if (
    source === transformed &&
    bounds.minX === source.bounds.minX &&
    bounds.minY === source.bounds.minY
  )
    return Object.freeze({
      bounds: Object.freeze({ ...bounds }),
      writes: Object.freeze([]),
    });
  for (const layer of transformed.layers)
    for (const run of layer.runs)
      writes.push({
        layerId: layer.layerId,
        x: bounds.minX + run.x,
        y: bounds.minY + run.y,
        length: run.length,
        value: run.value,
      });
  return Object.freeze({
    bounds: Object.freeze({ ...bounds }),
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
