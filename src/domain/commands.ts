import { assertBounds, type Bounds } from "./coordinates.ts";
import type {
  Layer,
  PrimitiveChange,
  TileDelta,
  TileWrite,
} from "./document.ts";
import {
  annotationId,
  copyCell,
  equalCells,
  layerId,
  registryId,
  type AnnotationId,
  type RegistryId,
} from "./values.ts";

/** Opaque persisted metadata seam. Registry/annotation feature tickets own schemas. */
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type DocumentCommand =
  | Readonly<{ kind: "tiles"; writes: readonly TileWrite[] }>
  | Readonly<{ kind: "add-layer"; layer: Layer; index?: number }>
  | Readonly<{ kind: "remove-layer"; id: Layer["id"] }>
  | Readonly<{ kind: "rename-layer"; id: Layer["id"]; name: string }>
  | Readonly<{ kind: "reorder-layers"; ids: readonly Layer["id"][] }>
  | Readonly<{ kind: "bounds"; bounds: Bounds }>
  | Readonly<{ kind: "registry"; id: RegistryId; value: JsonObject | null }>
  | Readonly<{
      kind: "annotation";
      id: AnnotationId;
      value: JsonObject | null;
    }>;

export function copyRecord(value: JsonObject | null): JsonObject | null {
  const active = new Set<object>();
  function copy(item: JsonValue): JsonValue {
    if (item === null || typeof item === "string" || typeof item === "boolean")
      return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || active.has(item))
      throw new TypeError("Metadata must be finite, acyclic JSON.");
    active.add(item);
    let result: JsonValue;
    if (Array.isArray(item)) result = Object.freeze(Array.from(item, copy));
    else {
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      )
        throw new TypeError("Metadata must use plain JSON objects.");
      result = Object.freeze(
        Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, copy((item as JsonObject)[key])]),
        ),
      );
    }
    active.delete(item);
    return result;
  }
  if (value !== null && (typeof value !== "object" || Array.isArray(value)))
    throw new TypeError("Record must be a JSON object or null.");
  return copy(value) as JsonObject | null;
}
export const equalRecords = (a: JsonObject | null, b: JsonObject | null) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Detach inputs when staged, before their producer can change them. */
export function copyCommand(command: DocumentCommand): DocumentCommand {
  switch (command.kind) {
    case "tiles":
      return Object.freeze({
        kind: command.kind,
        writes: Object.freeze(
          command.writes.map((write) =>
            Object.freeze({
              layerId: layerId(write.layerId),
              x: write.x,
              y: write.y,
              length: write.length,
              value: copyCell(write.value),
            }),
          ),
        ),
      });
    case "add-layer": {
      if (typeof command.layer.name !== "string" || !command.layer.name.trim())
        throw new TypeError("Layer name must not be blank.");
      return Object.freeze({
        kind: command.kind,
        layer: Object.freeze({
          id: layerId(command.layer.id),
          name: command.layer.name,
        }),
        index: command.index,
      });
    }
    case "remove-layer":
      return Object.freeze({ kind: command.kind, id: layerId(command.id) });
    case "rename-layer": {
      if (typeof command.name !== "string" || !command.name.trim())
        throw new TypeError("Layer name must not be blank.");
      return Object.freeze({
        kind: command.kind,
        id: layerId(command.id),
        name: command.name,
      });
    }
    case "reorder-layers":
      return Object.freeze({
        kind: command.kind,
        ids: Object.freeze(command.ids.map(layerId)),
      });
    case "bounds": {
      assertBounds(command.bounds);
      const { minX, minY, maxX, maxY } = command.bounds;
      return Object.freeze({
        kind: command.kind,
        bounds: Object.freeze({ minX, minY, maxX, maxY }),
      });
    }
    case "registry":
      return Object.freeze({
        kind: command.kind,
        id: registryId(command.id),
        value: copyRecord(command.value),
      });
    case "annotation":
      return Object.freeze({
        kind: command.kind,
        id: annotationId(command.id),
        value: copyRecord(command.value),
      });
    default:
      throw new TypeError("Unknown document command.");
  }
}

/** Sweep run endpoints, using first-before / last-after without per-cell copies. */
export function compactTiles(
  deltas: readonly TileDelta[],
): readonly TileDelta[] {
  const rows = new Map<string, TileDelta[]>();
  for (const delta of deltas) {
    const key = `${delta.layerId}/${delta.y}`;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = []));
    row.push(delta);
  }
  const result: TileDelta[] = [];
  for (const row of rows.values()) {
    const events = row
      .flatMap((run, index) => [
        { x: run.x, index, start: true },
        { x: run.x + run.length, index, start: false },
      ])
      .sort((a, b) => a.x - b.x);
    const active = new Set<number>();
    // Lazy heaps of chronological indices keep overlapping strokes O(n log n).
    const min: number[] = [],
      max: number[] = [];
    const push = (heap: number[], value: number, sign: number) => {
      heap.push(value);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (sign * heap[p] <= sign * value) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = value;
    };
    const top = (heap: number[], sign: number) => {
      while (heap.length && !active.has(heap[0])) {
        const last = heap.pop()!;
        if (!heap.length) break;
        let i = 0;
        while (2 * i + 1 < heap.length) {
          let child = 2 * i + 1;
          if (
            child + 1 < heap.length &&
            sign * heap[child + 1] < sign * heap[child]
          )
            child++;
          if (sign * last <= sign * heap[child]) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      return heap[0];
    };
    for (let i = 0; i < events.length;) {
      const x = events[i].x;
      while (i < events.length && events[i].x === x) {
        const event = events[i++];
        if (event.start) {
          active.add(event.index);
          push(min, event.index, 1);
          push(max, event.index, -1);
        } else active.delete(event.index);
      }
      if (i === events.length || !active.size) continue;
      const before = row[top(min, 1)].before,
        after = row[top(max, -1)].after;
      if (equalCells(before, after)) continue;
      const length = events[i].x - x,
        last = result.at(-1),
        sample = row[0];
      if (
        last &&
        last.layerId === sample.layerId &&
        last.y === sample.y &&
        last.x + last.length === x &&
        equalCells(last.before, before) &&
        equalCells(last.after, after)
      )
        result[result.length - 1] = { ...last, length: last.length + length };
      else
        result.push({
          layerId: sample.layerId,
          y: sample.y,
          x,
          length,
          before,
          after,
        });
    }
  }
  return Object.freeze(result.map((run) => Object.freeze(run)));
}

/** Net metadata and net tile runs; internal temporary writes are not renderer work. */
export function compactChanges(
  changes: readonly PrimitiveChange[],
): readonly PrimitiveChange[] {
  const metadata = new Map<
    string,
    Exclude<PrimitiveChange, { kind: "tiles" }>
  >();
  const tiles: TileDelta[] = [];
  for (const change of changes) {
    if (change.kind === "tiles") {
      for (const run of change.runs) tiles.push(run);
      continue;
    }
    const key =
      change.kind === "registry" || change.kind === "annotation"
        ? `${change.kind}/${change.id}`
        : change.kind;
    const first = metadata.get(key);
    metadata.set(
      key,
      Object.freeze({
        ...change,
        before: first ? first.before : change.before,
      }) as Exclude<PrimitiveChange, { kind: "tiles" }>,
    );
  }
  const runs = compactTiles(tiles);
  const result: PrimitiveChange[] = runs.length
    ? [Object.freeze({ kind: "tiles", runs })]
    : [];
  for (const change of metadata.values()) {
    if (JSON.stringify(change.before) !== JSON.stringify(change.after))
      result.push(change);
  }
  return Object.freeze(result);
}

/** Canonical patch replay restores layers/cells and replaces bounds without loss. */
export function replayCommands(
  changes: readonly PrimitiveChange[],
  direction: "undo" | "redo",
): DocumentCommand[] {
  const target = direction === "undo" ? "before" : "after";
  const source = direction === "undo" ? "after" : "before";
  const commands: DocumentCommand[] = [];
  const bounds = changes.find((change) => change.kind === "bounds");
  const layers = changes.find((change) => change.kind === "layers");
  // Clear changing cells in the old bounds before replacing bounds. This avoids
  // constructing an overflowing union for distant but individually valid bounds.
  if (bounds?.kind === "bounds") {
    for (const change of changes)
      if (change.kind === "tiles") {
        const writes: TileWrite[] = [];
        for (const run of change.runs) {
          if (
            layers?.kind === "layers" &&
            !layers[source].some((layer) => layer.id === run.layerId)
          )
            continue;
          const region = bounds[source];
          const x = Math.max(run.x, region.minX),
            end = Math.min(run.x + run.length, region.maxX);
          if (run.y >= region.minY && run.y < region.maxY && end > x)
            writes.push({ ...run, x, length: end - x, value: null });
        }
        commands.push({ kind: "tiles", writes });
      }
    commands.push({ kind: "bounds", bounds: bounds[target] });
  }
  if (layers?.kind === "layers") {
    for (const layer of layers[target])
      if (!layers[source].some((item) => item.id === layer.id))
        commands.push({ kind: "add-layer", layer });
  }
  for (const change of changes) {
    if (change.kind === "tiles")
      commands.push({
        kind: "tiles",
        writes: change.runs.flatMap((run) => {
          if (
            layers?.kind === "layers" &&
            !layers[target].some((layer) => layer.id === run.layerId)
          )
            return [];
          if (bounds?.kind !== "bounds")
            return [{ ...run, value: run[target] }];
          const region = bounds[target],
            x = Math.max(run.x, region.minX),
            end = Math.min(run.x + run.length, region.maxX);
          return run.y >= region.minY && run.y < region.maxY && end > x
            ? [{ ...run, x, length: end - x, value: run[target] }]
            : [];
        }),
      });
    if (change.kind === "registry")
      commands.push({ kind: "registry", id: change.id, value: change[target] });
    if (change.kind === "annotation")
      commands.push({
        kind: "annotation",
        id: change.id,
        value: change[target],
      });
  }
  if (layers?.kind === "layers") {
    for (const layer of layers[source])
      if (!layers[target].some((item) => item.id === layer.id))
        commands.push({ kind: "remove-layer", id: layer.id });
    for (const layer of layers[target])
      commands.push({ kind: "rename-layer", id: layer.id, name: layer.name });
    commands.push({
      kind: "reorder-layers",
      ids: layers[target].map((layer) => layer.id),
    });
  }
  return commands;
}
