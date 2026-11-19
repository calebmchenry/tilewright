import type { Bounds } from "../domain/coordinates.ts";
import type { TileWrite } from "../domain/document.ts";
import type { DocumentGesture } from "../domain/history.ts";
import {
  copyCell,
  equalCells,
  type Cell,
  type LayerId,
  type TileValue,
} from "../domain/values.ts";
import type { EditorSession } from "./session.ts";
import { Store } from "./store.ts";
import { canEditTiles, screenToTile, type Point } from "./viewport.ts";

export type DrawingToolId = "pencil" | "eraser" | "fill" | "line" | "rectangle";
export interface PaintSpan {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly value: Cell;
}
export interface DrawingContext {
  readonly start: Point;
  readonly bounds: Bounds;
  readonly layerId: LayerId;
  readonly paint: TileValue;
}
export interface DrawingSample {
  readonly start: Point;
  readonly previous: Point;
  readonly tile: Point;
}
export interface DrawingOperation {
  /** Append for strokes; replace for endpoint-based shapes. Always synchronous. */
  sample(input: DrawingSample): {
    mode: "append" | "replace";
    spans: Iterable<PaintSpan>;
  };
}
export interface DrawingTool {
  readonly label: string;
  /** Optional hover stamp. It is separate from the active gesture and its history. */
  footprint?(context: DrawingContext): Iterable<PaintSpan>;
  create(context: DrawingContext): DrawingOperation;
}
export interface DrawingPreview {
  readonly layerId: LayerId;
  readonly writes: readonly TileWrite[];
}

/** Sparse last-write-wins cells, clipped before allocation; no document mutations. */
export class SparsePaint {
  #cells = new Map<string, { x: number; y: number; value: Cell }>();
  update(spans: Iterable<PaintSpan>, bounds: Bounds, replace: boolean): void {
    // Fully validate/copy before changing even transient state.
    const clipped: PaintSpan[] = [];
    for (const span of spans) {
      if (
        ![span.x, span.y, span.length, span.x + span.length].every(
          Number.isSafeInteger,
        ) ||
        span.length < 1
      )
        throw new RangeError(
          "Drawing spans must use safe integer coordinates and positive lengths.",
        );
      const value = copyCell(span.value);
      const x = Math.max(bounds.minX, span.x);
      const end = Math.min(bounds.maxX, span.x + span.length);
      if (span.y >= bounds.minY && span.y < bounds.maxY && x < end)
        clipped.push({ x, y: span.y, length: end - x, value });
    }
    if (replace) this.#cells.clear();
    for (const span of clipped)
      for (let x = span.x; x < span.x + span.length; x++)
        this.#cells.set(`${x}/${span.y}`, { x, y: span.y, value: span.value });
  }
  writes(layerId: LayerId): readonly TileWrite[] {
    const writes: TileWrite[] = [];
    for (const cell of [...this.#cells.values()].sort(
      (a, b) => a.y - b.y || a.x - b.x,
    )) {
      const last = writes.at(-1);
      if (
        last &&
        last.y === cell.y &&
        last.x + last.length === cell.x &&
        equalCells(last.value, cell.value)
      )
        writes[writes.length - 1] = { ...last, length: last.length + 1 };
      else writes.push({ layerId, ...cell, length: 1 });
    }
    return Object.freeze(writes.map((write) => Object.freeze(write)));
  }
}

/** Tool-independent gesture lifetime. DOM routing and Pixi only consume this seam. */
export class DrawingController {
  readonly preview = new Store<DrawingPreview | null>(null);
  readonly footprint = new Store<DrawingPreview | null>(null);
  #hoverTile: Point | null = null;
  #session: EditorSession;
  #tools = new Map<DrawingToolId, DrawingTool>();
  #current: {
    id: number;
    context: DrawingContext;
    previous: Point;
    operation: DrawingOperation;
    paint: SparsePaint;
    history: DocumentGesture;
    label: string;
  } | null = null;
  #stops: (() => void)[];
  #closed = false;

  constructor(session: EditorSession) {
    this.#session = session;
    const cancel = () => this.cancel();
    this.#stops = [
      session.document.subscribe(cancel),
      ...[
        session.activeTool,
        session.activeLayer,
        session.hiddenLayers,
        session.viewport,
        session.canvasSize,
        session.canvasState,
        session.color,
        session.selectedRegistryId,
        session.pencilSize,
        session.rectangleMode,
      ].map((store) => store.subscribe(cancel)),
    ];
  }
  /** Install feature-owned algorithms before rendering the tool controls. */
  register(id: DrawingToolId, tool: DrawingTool): void {
    if (this.#closed) throw new Error("Drawing controller is closed.");
    if (!tool.label.trim())
      throw new TypeError("A drawing tool needs a label.");
    this.cancel();
    this.#tools.set(id, tool);
  }
  tool(id: string): DrawingTool | undefined {
    return this.#tools.get(id as DrawingToolId);
  }
  get pointerId(): number | null {
    return this.#current?.id ?? null;
  }

  hover(point: Point | null): void {
    const session = this.#session;
    const tool = this.tool(session.activeTool.getSnapshot());
    if (
      !point ||
      this.#closed ||
      this.#current ||
      !tool?.footprint ||
      session.canvasState.getSnapshot() !== "ready" ||
      !canEditTiles(session.viewport.getSnapshot()) ||
      !session.editableLayerIds().length
    ) {
      this.#hoverTile = null;
      this.footprint.set(null);
      return;
    }
    try {
      const tile = this.#tile(point);
      if (tile.x === this.#hoverTile?.x && tile.y === this.#hoverTile?.y)
        return;
      const context = Object.freeze({
        start: tile,
        bounds: session.document.bounds,
        layerId: session.activeLayer.getSnapshot(),
        paint: session.currentPaint(),
      });
      const paint = new SparsePaint();
      paint.update(tool.footprint(context), context.bounds, false);
      this.#hoverTile = tile;
      this.footprint.set(
        Object.freeze({
          layerId: context.layerId,
          writes: paint.writes(context.layerId),
        }),
      );
    } catch (error) {
      this.#fail(error);
    }
  }

  begin(id: number, point: Point): boolean {
    const session = this.#session;
    const tool = this.tool(session.activeTool.getSnapshot());
    if (
      this.#closed ||
      this.#current ||
      !tool ||
      session.canvasState.getSnapshot() !== "ready" ||
      !canEditTiles(session.viewport.getSnapshot()) ||
      !session.editableLayerIds().length
    )
      return false;
    try {
      this.hover(null);
      const start = this.#tile(point);
      const context = Object.freeze({
        start,
        bounds: session.document.bounds,
        layerId: session.activeLayer.getSnapshot(),
        paint: session.currentPaint(),
      });
      const operation = tool.create(context);
      this.#current = {
        id,
        context,
        previous: start,
        operation,
        paint: new SparsePaint(),
        history: session.history.beginGesture(tool.label),
        label: tool.label,
      };
      return this.sample(id, point);
    } catch (error) {
      return this.#fail(error);
    }
  }
  #tile(point: Point): Point {
    const tile = screenToTile(
      point.x,
      point.y,
      this.#session.viewport.getSnapshot(),
    );
    if (![tile.x, tile.y].every(Number.isSafeInteger))
      throw new RangeError("Invalid drawing coordinate.");
    return Object.freeze(tile);
  }
  sample(id: number, point: Point): boolean {
    const current = this.#current;
    if (!current || current.id !== id) return false;
    try {
      const tile = this.#tile(point);
      const result = current.operation.sample(
        Object.freeze({
          start: current.context.start,
          previous: current.previous,
          tile,
        }),
      );
      if (result.mode !== "append" && result.mode !== "replace")
        throw new TypeError("Invalid preview update mode.");
      current.paint.update(
        result.spans,
        current.context.bounds,
        result.mode === "replace",
      );
      current.previous = tile;
      this.preview.set(
        Object.freeze({
          layerId: current.context.layerId,
          writes: current.paint.writes(current.context.layerId),
        }),
      );
      return this.#current === current;
    } catch (error) {
      return this.#fail(error);
    }
  }
  commit(id: number, point: Point): boolean {
    if (!this.sample(id, point)) return false;
    const current = this.#current!;
    // Detach first: commit notifications and capture release must not cancel it.
    this.#current = null;
    try {
      this.preview.set(null);
      const writes = current.paint.writes(current.context.layerId);
      current.history.append({ kind: "tiles", writes });
      const result = current.history.commit();
      if (result.observerErrors.length)
        this.#session.reportError(
          result.observerErrors[0],
          `${current.label} committed, but a view could not update`,
        );
      else this.#session.report(result.change ? current.label : "No changes.");
      return true;
    } catch (error) {
      current.history.cancel();
      return this.#fail(error);
    }
  }
  cancel(id?: number): void {
    const current = this.#current;
    if (id !== undefined && current?.id !== id) return;
    this.#current = null;
    current?.history.cancel();
    this.preview.set(null);
    this.hover(null);
  }
  #fail(error: unknown): false {
    this.cancel();
    this.#session.reportError(error, "Drawing canceled");
    return false;
  }
  dispose(): void {
    this.#closed = true;
    for (const stop of this.#stops) stop();
    this.#stops = [];
    this.cancel();
    this.#tools.clear();
  }
}
