import {
  compactChanges,
  copyCommand,
  copyRecord,
  equalRecords,
  type DocumentCommand,
  type JsonObject,
} from "./commands.ts";
import { assertBounds, containsTile, type Bounds } from "./coordinates.ts";
import { DEFAULT_MAP_SIZE } from "./canvas.ts";
import {
  STORAGE_PARTITION_SIZE as SIZE,
  TilePalette,
  TilePartition,
} from "./storage.ts";
import {
  copyCell,
  equalCells,
  layerId,
  type Cell,
  type LayerId,
  type RegistryId,
  type AnnotationId,
} from "./values.ts";

export interface Layer {
  readonly id: LayerId;
  readonly name: string;
}
/** A horizontal span; single-cell writes use length 1. Overlaps apply in input order. */
export interface TileWrite {
  readonly layerId: LayerId;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly value: Cell;
}
export interface TileDelta extends Omit<TileWrite, "value"> {
  readonly before: Cell;
  readonly after: Cell;
}
export interface OccupiedRun extends TileWrite {
  readonly value: NonNullable<Cell>;
}
type PendingDelta = Omit<TileDelta, "length"> & { length: number };
type PendingRun = Omit<OccupiedRun, "length"> & { length: number };
export type PrimitiveChange = Readonly<
  | { kind: "tiles"; runs: readonly TileDelta[] }
  | { kind: "layers"; before: readonly Layer[]; after: readonly Layer[] }
  | { kind: "bounds"; before: Bounds; after: Bounds }
  | {
      kind: "registry";
      id: RegistryId;
      before: JsonObject | null;
      after: JsonObject | null;
    }
  | {
      kind: "annotation";
      id: AnnotationId;
      before: JsonObject | null;
      after: JsonObject | null;
    }
>;
export type DocumentChange = Readonly<
  { version: number } & (
    | PrimitiveChange
    | { kind: "transaction"; changes: readonly PrimitiveChange[] }
  )
>;
/** Observer failures never turn an already committed edit into an apparent failure. */
export interface MutationResult {
  readonly change: DocumentChange | null;
  readonly observerErrors: readonly unknown[];
}
const NO_CHANGE: MutationResult = Object.freeze({
  change: null,
  observerErrors: Object.freeze([]),
});
/** Opaque, single-use staged edit owned by its source document. */
export interface PreparedTiles {
  readonly changedCells: number;
}
export interface TilePreparationOptions {
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (changedCells: number) => void;
  /** Scheduling seam for deterministic tests; production yields to a timer task. */
  readonly yieldControl?: () => Promise<void>;
}

type LayerStorage = {
  metadata: Layer;
  partitions: Map<string, TilePartition>;
  occupiedCells: number;
};

function checkedLayer(layer: Layer): Layer {
  const id = layerId(layer.id);
  if (typeof layer.name !== "string" || !layer.name.trim())
    throw new TypeError("Layer name must not be blank.");
  return Object.freeze({ id, name: layer.name });
}
function checkedBounds(bounds: Bounds): Bounds {
  assertBounds(bounds);
  return Object.freeze({
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  });
}
function encloses(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}
const partitionKey = (x: number, y: number) => `${x},${y}`;

/** Authoritative document, independent of UI, GPU, native I/O, and command history. */
export class MapDocument {
  #bounds: Bounds;
  #layers = new Map<LayerId, LayerStorage>();
  #order: readonly Layer[];
  #palette = new TilePalette();
  #version = 0;
  #busy = false;
  #journal: PrimitiveChange[] | null = null;
  #registry = new Map<RegistryId, JsonObject>();
  #annotations = new Map<AnnotationId, JsonObject>();
  #listeners = new Set<(change: DocumentChange) => void>();
  #copyOnWrite = false;
  #ownedPartitions = new WeakSet<TilePartition>();
  #prepared = new WeakMap<
    PreparedTiles,
    { fork: MapDocument; version: number; changes: readonly PrimitiveChange[] }
  >();

  constructor(options: { bounds?: Bounds; layers?: readonly Layer[] } = {}) {
    this.#bounds = checkedBounds(
      options.bounds ?? {
        minX: 0,
        minY: 0,
        maxX: DEFAULT_MAP_SIZE,
        maxY: DEFAULT_MAP_SIZE,
      },
    );
    const layers = options.layers ?? [
      { id: layerId("layer-1"), name: "Layer 1" },
    ];
    if (layers.length === 0)
      throw new RangeError("A document needs at least one layer.");
    this.#order = Object.freeze(layers.map(checkedLayer));
    for (const metadata of this.#order) {
      if (this.#layers.has(metadata.id))
        throw new RangeError("Duplicate layer identity.");
      this.#layers.set(metadata.id, {
        metadata,
        partitions: new Map(),
        occupiedCells: 0,
      });
    }
  }

  get bounds(): Bounds {
    return this.#bounds;
  }
  /** Bottom to top; order never changes cell ownership. */
  get layers(): readonly Layer[] {
    return this.#order;
  }
  /** Monotonic mutation counter, not an undo revision or saved-state marker. */
  get version(): number {
    return this.#version;
  }

  subscribe(listener: (change: DocumentChange) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  getRegistryEntry(id: RegistryId): JsonObject | null {
    return this.#registry.get(id) ?? null;
  }
  getAnnotation(id: AnnotationId): JsonObject | null {
    return this.#annotations.get(id) ?? null;
  }
  get registryEntries(): readonly (readonly [RegistryId, JsonObject])[] {
    return Object.freeze(
      [...this.#registry]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map((entry) => Object.freeze(entry)),
    );
  }
  get annotations(): readonly (readonly [AnnotationId, JsonObject])[] {
    return Object.freeze(
      [...this.#annotations]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map((entry) => Object.freeze(entry)),
    );
  }

  /** Synchronous atomic commit. Input producers run before any writes, under the lock.
   * The controller's accept hook may reject a patch (e.g. history capacity) before
   * observers see it; it must not mutate the document or perform asynchronous work.
   */
  applyCommands(
    commands: Iterable<DocumentCommand>,
    accept?: (change: DocumentChange) => void,
  ): MutationResult {
    if (this.#busy || this.#journal)
      throw new Error("Reentrant document mutation is not allowed.");
    const prepared = this.#mutate(() => Array.from(commands, copyCommand));
    const version = this.#version;
    const journal: PrimitiveChange[] = [];
    this.#journal = journal;
    try {
      for (const command of prepared) this.#execute(command);
      const changes = compactChanges(journal);
      this.#version = version;
      if (!changes.length) return NO_CHANGE;
      const change: DocumentChange = Object.freeze({
        kind: "transaction",
        version: version + 1,
        changes,
      });
      this.#mutate(() => accept?.(change));
      this.#journal = null;
      this.#version++;
      return this.#mutate(() => this.#publish(change));
    } catch (error) {
      // Reverse chronological primitives: removed layers are recreated before
      // their cleared cells; growth is reverted only after edits in new space.
      for (let i = journal.length - 1; i >= 0; i--) this.#restore(journal[i]);
      this.#version = version;
      throw error;
    } finally {
      this.#journal = null;
    }
  }

  /** Prepare bounded batches on a private copy-on-write fork. No live writes/events.
   * Null input items are scheduling checkpoints for producers doing read-only work.
   * Concurrent edits invalidate this work; callers never publish a mixed revision.
   */
  async prepareTiles(
    writes: Iterable<TileWrite | null>,
    options: TilePreparationOptions = {},
  ): Promise<PreparedTiles> {
    const version = this.#version;
    const check = () => {
      if (options.signal?.aborted)
        throw new Error("Tile preparation canceled.");
      this.#unchanged(version);
      if (this.#busy || this.#journal) throw new Error("Document is busy.");
    };
    check();
    const fork = new MapDocument({ bounds: this.#bounds, layers: this.#order });
    fork.#palette = this.#palette.clone();
    for (const [id, layer] of this.#layers)
      fork.#layers.set(id, { ...layer, partitions: new Map(layer.partitions) });
    fork.#copyOnWrite = true;
    const deltas: PendingDelta[] = [];
    let changedCells = 0,
      sliceStart = performance.now();
    const pause = async () => {
      options.onProgress?.(changedCells);
      await (options.yieldControl?.() ??
        new Promise<void>((resolve) => setTimeout(resolve, 0)));
      check();
      sliceStart = performance.now();
    };
    await pause();
    for (const input of writes) {
      check();
      if (input) {
        fork.#layer(input.layerId);
        fork.#address(input.x, input.y);
        if (
          !Number.isSafeInteger(input.length) ||
          input.length < 1 ||
          !Number.isSafeInteger(input.x + input.length)
        )
          throw new RangeError("Invalid prepared write length.");
        fork.#address(input.x + input.length - 1, input.y);
        const value = copyCell(input.value);
        for (let x = input.x; x < input.x + input.length;) {
          const length = Math.min(1024, input.x + input.length - x);
          fork.#write(
            { layerId: input.layerId, x, y: input.y, length, value },
            deltas,
          );
          // This is processed coverage, finalized below to exact net changed cells.
          changedCells += length;
          x += length;
          if (performance.now() - sliceStart >= 8) await pause();
        }
      }
      if (performance.now() - sliceStart >= 8) await pause();
    }
    const changes = compactChanges([{ kind: "tiles", runs: deltas }]);
    changedCells = changes.reduce(
      (n, part) =>
        n +
        (part.kind === "tiles"
          ? part.runs.reduce((m, run) => m + run.length, 0)
          : 0),
      0,
    );
    await pause();
    const plan = Object.freeze({ changedCells });
    this.#prepared.set(plan, { fork, version, changes });
    return plan;
  }

  /** Constant-size root publication after history accepts the immutable patch. */
  applyPreparedTiles(
    plan: PreparedTiles,
    accept?: (change: DocumentChange) => void,
  ): MutationResult {
    return this.#mutate(() => {
      const pending = this.#prepared.get(plan);
      this.#prepared.delete(plan);
      if (!pending)
        throw new Error("Unknown or already consumed prepared edit.");
      this.#unchanged(pending.version);
      if (this.#journal) throw new Error("Document is busy.");
      if (!pending.changes.length) return NO_CHANGE;
      const change: DocumentChange = Object.freeze({
        kind: "transaction",
        version: this.#version + 1,
        changes: pending.changes,
      });
      accept?.(change);
      this.#layers = pending.fork.#layers;
      this.#palette = pending.fork.#palette;
      this.#version++;
      return this.#publish(change);
    });
  }

  #execute(command: DocumentCommand): void {
    switch (command.kind) {
      case "tiles":
        this.writeBatch(command.writes);
        break;
      case "add-layer":
        this.addLayer(command.layer, command.index);
        break;
      case "remove-layer":
        this.#removeLayer(command.id);
        break;
      case "rename-layer":
        this.renameLayer(command.id, command.name);
        break;
      case "reorder-layers":
        this.reorderLayers(command.ids);
        break;
      case "bounds":
        this.setBounds(command.bounds);
        break;
      case "registry":
      case "annotation":
        this.#setRecord(command);
        break;
    }
  }
  #setRecord(
    command: Extract<DocumentCommand, { kind: "registry" | "annotation" }>,
  ): MutationResult {
    return this.#mutate(() => {
      const records: Map<string, JsonObject> =
        command.kind === "registry" ? this.#registry : this.#annotations;
      const before = records.get(command.id) ?? null,
        after = copyRecord(command.value);
      if (equalRecords(before, after)) return NO_CHANGE;
      if (after === null) records.delete(command.id);
      else records.set(command.id, after);
      return this.#publish({
        kind: command.kind,
        id: command.id,
        version: ++this.#version,
        before,
        after,
      } as DocumentChange);
    });
  }
  #removeLayer(id: LayerId): void {
    this.#layer(id);
    if (this.#order.length === 1)
      throw new RangeError("A document needs at least one layer.");
    // Only this layer's occupied runs are journaled, never unrelated content.
    this.writeBatch(
      [...this.iterateRuns(id)].map((run) => ({ ...run, value: null })),
    );
    this.#mutate(() => {
      const before = this.#order;
      this.#layers.delete(id);
      this.#order = Object.freeze(before.filter((layer) => layer.id !== id));
      return this.#publish({
        kind: "layers",
        version: ++this.#version,
        before,
        after: this.#order,
      });
    });
  }
  #restore(change: PrimitiveChange): void {
    switch (change.kind) {
      case "tiles":
        for (let i = change.runs.length - 1; i >= 0; i--)
          this.#write({ ...change.runs[i], value: change.runs[i].before }, []);
        break;
      case "bounds":
        this.#bounds = change.before;
        break;
      case "layers": {
        const ids = new Set(change.before.map((layer) => layer.id));
        for (const id of this.#layers.keys())
          if (!ids.has(id)) this.#layers.delete(id);
        for (const metadata of change.before) {
          const layer = this.#layers.get(metadata.id);
          if (layer) layer.metadata = metadata;
          else
            this.#layers.set(metadata.id, {
              metadata,
              partitions: new Map(),
              occupiedCells: 0,
            });
        }
        this.#order = change.before;
        break;
      }
      case "registry":
      case "annotation": {
        const records: Map<string, JsonObject> =
          change.kind === "registry" ? this.#registry : this.#annotations;
        if (change.before === null) records.delete(change.id);
        else records.set(change.id, change.before);
      }
    }
  }

  getCell(id: LayerId, x: number, y: number): Cell {
    const layer = this.#layer(id);
    this.#address(x, y);
    const cx = Math.floor(x / SIZE),
      cy = Math.floor(y / SIZE);
    const partition = layer.partitions.get(partitionKey(cx, cy));
    return this.#palette.value(
      partition?.get((y - cy * SIZE) * SIZE + (x - cx * SIZE)) ?? 0,
    );
  }

  setCell(id: LayerId, x: number, y: number, value: Cell): MutationResult {
    return this.writeBatch([{ layerId: id, x, y, length: 1, value }]);
  }
  clearCell(id: LayerId, x: number, y: number): MutationResult {
    return this.setCell(id, x, y, null);
  }

  /** Validate/copy the entire finite input before changing anything; one notification. */
  writeBatch(writes: Iterable<TileWrite>): MutationResult {
    return this.#mutate(() => {
      const prepared: TileWrite[] = [];
      for (const write of writes) {
        this.#layer(write.layerId);
        this.#address(write.x, write.y);
        if (
          !Number.isSafeInteger(write.length) ||
          write.length <= 0 ||
          !Number.isSafeInteger(write.x + write.length)
        ) {
          throw new RangeError(
            "Write length and exclusive end must be positive-length safe integers.",
          );
        }
        this.#address(write.x + write.length - 1, write.y);
        prepared.push({
          layerId: write.layerId,
          x: write.x,
          y: write.y,
          length: write.length,
          value: copyCell(write.value),
        });
      }
      const deltas: PendingDelta[] = [];
      for (const write of prepared) this.#write(write, deltas);
      if (!deltas.length) return NO_CHANGE;
      return this.#publish({
        kind: "tiles",
        version: ++this.#version,
        runs: Object.freeze(deltas.map((delta) => Object.freeze(delta))),
      });
    });
  }

  addLayer(layer: Layer, index = this.#order.length): MutationResult {
    return this.#mutate(() => {
      const metadata = checkedLayer(layer);
      if (this.#layers.has(metadata.id))
        throw new RangeError("Duplicate layer identity.");
      if (!Number.isInteger(index) || index < 0 || index > this.#order.length)
        throw new RangeError("Invalid layer index.");
      const before = this.#order;
      const order = [...before];
      order.splice(index, 0, metadata);
      this.#order = Object.freeze(order);
      this.#layers.set(metadata.id, {
        metadata,
        partitions: new Map(),
        occupiedCells: 0,
      });
      return this.#publish({
        kind: "layers",
        version: ++this.#version,
        before,
        after: this.#order,
      });
    });
  }

  renameLayer(id: LayerId, name: string): MutationResult {
    return this.#mutate(() => {
      const layer = this.#layer(id);
      const metadata = checkedLayer({ id, name });
      if (name === layer.metadata.name) return NO_CHANGE;
      const before = this.#order;
      layer.metadata = metadata;
      this.#order = Object.freeze(
        before.map((item) => (item.id === id ? metadata : item)),
      );
      return this.#publish({
        kind: "layers",
        version: ++this.#version,
        before,
        after: this.#order,
      });
    });
  }

  reorderLayers(ids: readonly LayerId[]): MutationResult {
    return this.#mutate(() => {
      if (ids.length !== this.#order.length || new Set(ids).size !== ids.length)
        throw new RangeError("Order must include every layer exactly once.");
      const order = ids.map((id) => this.#layer(id).metadata);
      if (order.every((item, i) => item.id === this.#order[i].id))
        return NO_CHANGE;
      const before = this.#order;
      this.#order = Object.freeze(order);
      return this.#publish({
        kind: "layers",
        version: ++this.#version,
        before,
        after: this.#order,
      });
    });
  }

  /** Low-level bounds replacement for future grow/undo commands; never discards tiles. */
  setBounds(bounds: Bounds): MutationResult {
    return this.#mutate(() => {
      const after = checkedBounds(bounds),
        before = this.#bounds;
      if (encloses(before, after) && encloses(after, before)) return NO_CHANGE;
      if (!encloses(after, before)) {
        for (const run of this.iterateRuns()) {
          if (
            !containsTile(after, run.x, run.y) ||
            !containsTile(after, run.x + run.length - 1, run.y)
          ) {
            throw new RangeError("Bounds cannot discard occupied cells.");
          }
        }
      }
      this.#bounds = after;
      return this.#publish({
        kind: "bounds",
        version: ++this.#version,
        before,
        after,
      });
    });
  }

  /** Occupied horizontal runs, ordered by layer, world y, world x; clipped to window. */
  iterateRuns(
    id?: LayerId,
    window: Bounds = this.#bounds,
  ): Generator<OccupiedRun> {
    const layers = id === undefined ? this.#order : [this.#layer(id).metadata];
    const region = this.#queryBounds(window);
    return this.#runs(layers, region, this.#version);
  }

  iterateCells(id?: LayerId, window: Bounds = this.#bounds) {
    const runs = this.iterateRuns(id, window);
    const version = this.#version;
    const document = this;
    return (function* () {
      for (const run of runs) {
        for (let x = run.x; x < run.x + run.length; x++) {
          document.#unchanged(version);
          yield Object.freeze({
            layerId: run.layerId,
            x,
            y: run.y,
            value: run.value,
          });
        }
      }
      document.#unchanged(version);
    })();
  }

  /** Exact allocation counters, not JS object/Map overhead or process memory estimates. */
  storageStats() {
    const layers = this.#order.map(({ id }) => {
      const layer = this.#layer(id);
      let densePartitions = 0,
        typedArrayBytes = 0;
      for (const partition of layer.partitions.values()) {
        densePartitions += Number(partition.dense);
        typedArrayBytes += partition.bufferBytes;
      }
      return Object.freeze({
        layerId: id,
        occupiedCells: layer.occupiedCells,
        partitions: layer.partitions.size,
        densePartitions,
        sparsePartitions: layer.partitions.size - densePartitions,
        typedArrayBytes,
      });
    });
    return Object.freeze({
      partitionSize: SIZE,
      paletteEntries: this.#palette.size,
      occupiedCells: layers.reduce((n, item) => n + item.occupiedCells, 0),
      partitions: layers.reduce((n, item) => n + item.partitions, 0),
      typedArrayBytes: layers.reduce((n, item) => n + item.typedArrayBytes, 0),
      layers: Object.freeze(layers),
    });
  }

  #layer(id: LayerId): LayerStorage {
    const layer = this.#layers.get(id);
    if (!layer) throw new RangeError(`Unknown layer: ${id}`);
    return layer;
  }
  #address(x: number, y: number): void {
    if (!containsTile(this.#bounds, x, y))
      throw new RangeError(
        "Tile address must be a safe integer inside document bounds.",
      );
  }
  #queryBounds(bounds: Bounds): Bounds {
    const { minX, minY, maxX, maxY } = bounds;
    if (
      ![minX, minY, maxX, maxY, maxX - minX, maxY - minY].every(
        Number.isSafeInteger,
      ) ||
      maxX < minX ||
      maxY < minY ||
      !encloses(this.#bounds, bounds)
    ) {
      throw new RangeError(
        "Query bounds must be an integer rectangle inside the document.",
      );
    }
    return Object.freeze({ minX, minY, maxX, maxY });
  }
  #mutate<T>(action: () => T): T {
    if (this.#busy)
      throw new Error("Reentrant document mutation is not allowed.");
    this.#busy = true;
    try {
      return action();
    } finally {
      this.#busy = false;
    }
  }
  #publish(change: DocumentChange): MutationResult {
    Object.freeze(change);
    if (this.#journal) {
      if (change.kind === "transaction") throw new Error("Nested transaction.");
      const { version: _version, ...primitive } = change;
      this.#journal.push(Object.freeze(primitive));
      return NO_CHANGE;
    }
    const observerErrors: unknown[] = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener(change);
      } catch (error) {
        observerErrors.push(error);
      }
    }
    return Object.freeze({
      change,
      observerErrors: Object.freeze(observerErrors),
    });
  }
  #unchanged(version: number): void {
    if (version !== this.#version)
      throw new Error("Document changed during iteration.");
  }

  #write(write: TileWrite, deltas: PendingDelta[]): void {
    const layer = this.#layer(write.layerId);
    // Pin the destination token for this run so clears/replacements cannot recycle it.
    const token = this.#palette.retain(write.value);
    const after = this.#palette.value(token);
    const cy = Math.floor(write.y / SIZE);
    const localY = write.y - cy * SIZE;
    const end = write.x + write.length;
    for (let x = write.x; x < end;) {
      const cx = Math.floor(x / SIZE);
      const key = partitionKey(cx, cy);
      let partition = layer.partitions.get(key);
      const count = Math.min(end - x, SIZE - (x - cx * SIZE));
      if (!partition && token === 0) {
        x += count;
        continue;
      }
      if (!partition) {
        partition = new TilePartition(cx, cy);
        layer.partitions.set(key, partition);
      }
      if (this.#copyOnWrite && !this.#ownedPartitions.has(partition)) {
        partition = partition.clone();
        layer.partitions.set(key, partition);
        this.#ownedPartitions.add(partition);
      }
      for (let i = 0; i < count; i++, x++) {
        const index = localY * SIZE + (x - cx * SIZE);
        const previous = partition.get(index);
        if (previous === token) continue;
        const before = this.#palette.value(previous);
        const last = deltas.at(-1);
        if (
          last &&
          last.layerId === write.layerId &&
          last.y === write.y &&
          last.x + last.length === x &&
          equalCells(last.before, before) &&
          equalCells(last.after, after)
        ) {
          last.length++;
        } else
          deltas.push({
            layerId: write.layerId,
            x,
            y: write.y,
            length: 1,
            before,
            after,
          });
        partition.set(index, token);
        layer.occupiedCells += Number(token !== 0) - Number(previous !== 0);
        this.#palette.retainToken(token);
        this.#palette.release(previous);
      }
      if (partition.size === 0) layer.partitions.delete(key);
    }
    this.#palette.release(token);
  }

  *#runs(
    layers: readonly Layer[],
    window: Bounds,
    version: number,
  ): Generator<OccupiedRun> {
    this.#unchanged(version);
    if (window.minX === window.maxX || window.minY === window.maxY) return;
    const minCX = Math.floor(window.minX / SIZE),
      maxCX = Math.floor((window.maxX - 1) / SIZE);
    const minCY = Math.floor(window.minY / SIZE),
      maxCY = Math.floor((window.maxY - 1) / SIZE);
    for (const layer of layers) {
      const index = this.#layer(layer.id).partitions;
      const candidates: TilePartition[] = [];
      // A detail viewport must not scan the full-map partition index. Probe the
      // smaller of the query lattice and occupied index; full exports stay sparse.
      const slots = (maxCX - minCX + 1) * (maxCY - minCY + 1);
      if (slots <= index.size) {
        for (let cy = minCY; cy <= maxCY; cy++)
          for (let cx = minCX; cx <= maxCX; cx++) {
            const part = index.get(partitionKey(cx, cy));
            if (part) candidates.push(part);
          }
      } else {
        for (const part of index.values())
          if (
            part.x >= minCX &&
            part.x <= maxCX &&
            part.y >= minCY &&
            part.y <= maxCY
          )
            candidates.push(part);
      }
      const partitions = candidates.sort((a, b) => a.y - b.y || a.x - b.x);
      for (let first = 0; first < partitions.length;) {
        let last = first + 1;
        const cy = partitions[first].y;
        while (last < partitions.length && partitions[last].y === cy) last++;
        const originY = cy * SIZE;
        // Use local offsets so chunk endpoints near MAX_SAFE_INTEGER never overflow.
        const minY = Math.max(0, window.minY - originY),
          maxY = Math.min(SIZE, window.maxY - originY);
        for (let localY = minY; localY < maxY; localY++) {
          let pending: PendingRun | undefined;
          let pendingToken = 0;
          for (let p = first; p < last; p++) {
            const part = partitions[p],
              originX = part.x * SIZE;
            const minX = Math.max(0, window.minX - originX),
              maxX = Math.min(SIZE, window.maxX - originX);
            for (const { offset, length, token } of part.runs(
              localY * SIZE + minX,
              localY * SIZE + maxX,
            )) {
              const x = originX + (offset - localY * SIZE),
                y = originY + localY;
              if (
                pending &&
                pending.x + pending.length === x &&
                pendingToken === token
              ) {
                pending.length += length;
              } else {
                if (pending) {
                  yield Object.freeze(pending);
                  this.#unchanged(version);
                }
                // Interned tokens are unique for equal paint while live. Resolve
                // paint once per run, rather than once per occupied tile.
                pendingToken = token;
                pending = {
                  layerId: layer.id,
                  x,
                  y,
                  length,
                  value: this.#palette.value(token)!,
                };
              }
            }
          }
          if (pending) {
            yield Object.freeze(pending);
            this.#unchanged(version);
          }
        }
        first = last;
      }
    }
    this.#unchanged(version);
  }
}
