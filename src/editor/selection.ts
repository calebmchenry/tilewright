import { containsTile, type Bounds } from "../domain/coordinates.ts";
import {
  captureSelection,
  selectionFits,
  planSelectionMove,
  translatedSelection,
  type SelectionPayload,
} from "../domain/selection.ts";
import type { TileWrite } from "../domain/document.ts";
import type { LayerId } from "../domain/values.ts";
import { rectangleBetween } from "./measurement.ts";
import type { EditorSession } from "./session.ts";
import { Store } from "./store.ts";
import {
  canEditTiles,
  OVERVIEW_MESSAGE,
  screenToTile,
  type Point,
} from "./viewport.ts";

export interface SelectionRectangle {
  readonly bounds: Bounds;
  readonly layerIds: readonly LayerId[];
  readonly move?: {
    readonly dx: number;
    readonly dy: number;
    readonly writes: readonly TileWrite[];
    readonly reason: string | null;
  };
}

/** Selection creation and membership are view state, never document commands. */
export class SelectionController {
  readonly state = new Store<SelectionPayload | null>(null);
  readonly preview = new Store<SelectionRectangle | null>(null);
  #session: EditorSession;
  #current: {
    id: number;
    start: Point;
    layerIds: readonly LayerId[];
    source: SelectionPayload | null;
  } | null = null;
  #stops: (() => void)[];
  #closed = false;

  constructor(session: EditorSession) {
    this.#session = session;
    const cancel = () => this.cancel();
    this.#stops = [
      session.document.subscribe(() => {
        this.cancel();
        this.#refresh();
      }),
      session.hiddenLayers.subscribe(() => {
        this.cancel();
        this.#refresh();
      }),
      session.activeTool.subscribe(() => {
        this.cancel();
        if (
          !["select", "pan", "inspect", "eyedropper"].includes(
            session.activeTool.getSnapshot(),
          )
        )
          this.deselect();
      }),
      ...[
        session.activeLayer,
        session.viewport,
        session.canvasSize,
        session.canvasState,
      ].map((store) => store.subscribe(cancel)),
    ];
  }
  get pointerId(): number | null {
    return this.#current?.id ?? null;
  }
  #visible(ids: readonly LayerId[]): boolean {
    return ids.every(
      (id) =>
        this.#session.document.layers.some((layer) => layer.id === id) &&
        !this.#session.hiddenLayers.getSnapshot().includes(id),
    );
  }
  #refresh(): void {
    const current = this.state.getSnapshot();
    if (!current) return;
    const ids = current.layers.map((layer) => layer.layerId);
    if (
      !this.#visible(ids) ||
      !selectionFits(this.#session.document.bounds, current.bounds)
    ) {
      this.deselect();
      this.#session.report(
        "Selection cleared: an included layer is hidden or missing, or its rectangle no longer fits the map.",
      );
      return;
    }
    if (current.documentVersion !== this.#session.document.version)
      this.state.set(
        captureSelection(this.#session.document, current.bounds, ids),
      );
  }
  begin(id: number, point: Point): boolean {
    const session = this.#session;
    if (
      this.#closed ||
      this.#current ||
      session.activeTool.getSnapshot() !== "select"
    )
      return false;
    const start = session.editableTileAt(point);
    const selected = this.state.getSnapshot();
    const moving = !!(
      start &&
      selected &&
      containsTile(selected.bounds, start.x, start.y)
    );
    const reason = moving
      ? this.#moveReason()
      : session.action("select").reason;
    if (reason) {
      session.report(reason);
      return false;
    }
    if (!start) return false;
    try {
      const layerIds = Object.freeze(
        moving
          ? selected!.layers.map((layer) => layer.layerId)
          : [session.activeLayer.getSnapshot()],
      );
      this.#current = {
        id,
        start,
        layerIds,
        source: moving
          ? captureSelection(session.document, selected!.bounds, layerIds)
          : null,
      };
      return this.sample(id, point);
    } catch (error) {
      return this.#fail(error);
    }
  }
  sample(id: number, point: Point): boolean {
    const current = this.#current;
    if (!current || current.id !== id) return false;
    try {
      const end = screenToTile(
        point.x,
        point.y,
        this.#session.viewport.getSnapshot(),
      );
      if (![end.x, end.y].every(Number.isSafeInteger))
        throw new RangeError("Invalid selection coordinate.");
      const map = this.#session.document.bounds;
      if (current.source) {
        const dx = end.x - current.start.x,
          dy = end.y - current.start.y;
        const previous = this.preview.getSnapshot()?.move;
        if (previous?.dx === dx && previous.dy === dy) return true;
        const bounds = translatedSelection(current.source, dx, dy);
        const reason = selectionFits(map, bounds)
          ? null
          : "The entire selection must fit inside the map. Cancel and Grow Canvas to make more room.";
        const writes = reason
          ? Object.freeze([])
          : planSelectionMove(this.#session.document, current.source, dx, dy)
              .writes;
        this.preview.set(
          Object.freeze({
            bounds,
            layerIds: current.layerIds,
            move: Object.freeze({ dx, dy, writes, reason }),
          }),
        );
        return this.#current === current;
      }
      // Clamp only an already-started creation endpoint, before adding one.
      const bounds = rectangleBetween(current.start, {
        x: Math.max(map.minX, Math.min(map.maxX - 1, end.x)),
        y: Math.max(map.minY, Math.min(map.maxY - 1, end.y)),
      });
      this.preview.set(Object.freeze({ bounds, layerIds: current.layerIds }));
      return this.#current === current;
    } catch (error) {
      return this.#fail(error);
    }
  }
  commit(id: number, point: Point): boolean {
    if (!this.sample(id, point)) return false;
    try {
      const preview = this.preview.getSnapshot()!;
      if (preview.move) {
        const source = this.#current!.source!;
        return this.#apply(
          source,
          preview.move.dx,
          preview.move.dy,
          "Move selection",
        );
      }
      const payload = captureSelection(
        this.#session.document,
        preview.bounds,
        preview.layerIds,
      );
      this.#current = null;
      this.state.set(payload);
      this.preview.set(null);
      return true;
    } catch (error) {
      return this.#fail(error);
    }
  }
  #moveReason(): string | null {
    if (this.#closed || this.#session.canvasState.getSnapshot() !== "ready")
      return "Wait for the map canvas to be ready.";
    if (!canEditTiles(this.#session.viewport.getSnapshot()))
      return OVERVIEW_MESSAGE;
    const selected = this.state.getSnapshot();
    if (
      !selected ||
      !this.#visible(selected.layers.map((layer) => layer.layerId))
    )
      return "Select at least one visible layer to move tiles.";
    return null;
  }
  nudge(dx: number, dy: number): boolean {
    if (this.#current || this.#session.activeTool.getSnapshot() !== "select")
      return false;
    const reason = this.#moveReason();
    if (reason) {
      this.#session.report(reason);
      return false;
    }
    const selected = this.state.getSnapshot()!;
    try {
      return this.#apply(
        captureSelection(
          this.#session.document,
          selected.bounds,
          selected.layers.map((layer) => layer.layerId),
        ),
        dx,
        dy,
        "Nudge selection",
      );
    } catch (error) {
      return this.#fail(error);
    }
  }
  #apply(
    source: SelectionPayload,
    dx: number,
    dy: number,
    label: string,
  ): boolean {
    let result;
    let bounds: Bounds;
    try {
      const reason = this.#moveReason();
      if (reason) throw new Error(reason);
      const plan = planSelectionMove(this.#session.document, source, dx, dy);
      bounds = plan.bounds;
      // Detach before capture release and synchronous document notifications.
      this.cancel();
      result = this.#session.history.execute(label, [
        { kind: "tiles", writes: plan.writes },
      ]);
    } catch (error) {
      return this.#fail(error);
    }
    // Publication has succeeded. View failures must never report a retryable edit.
    try {
      this.state.set(
        captureSelection(
          this.#session.document,
          bounds,
          source.layers.map((layer) => layer.layerId),
        ),
      );
      if (result.observerErrors.length) throw result.observerErrors[0];
      this.#session.report(
        result.change ? label : "Selection positioned; no tile changes.",
      );
    } catch (error) {
      this.#session.reportError(
        error,
        `${label} committed, but a view could not update`,
      );
    }
    return true;
  }
  setIncluded(id: LayerId, included: boolean): boolean {
    if (this.#closed) return false;
    const current = this.state.getSnapshot();
    if (!current) return false;
    const ids = current.layers.map((layer) => layer.layerId);
    if (ids.includes(id) === included) return true;
    const next = included ? [...ids, id] : ids.filter((item) => item !== id);
    if (!next.length || !this.#visible(next)) {
      this.#session.report(
        "Keep at least one visible layer included; hidden or missing layers cannot be included.",
      );
      return false;
    }
    try {
      this.cancel();
      this.state.set(
        captureSelection(this.#session.document, current.bounds, next),
      );
      return true;
    } catch (error) {
      return this.#fail(error);
    }
  }
  cancel(id?: number): void {
    if (id !== undefined && this.#current?.id !== id) return;
    this.#current = null;
    this.preview.set(null);
  }
  escape(): void {
    if (this.#current) this.cancel();
    else this.deselect();
  }
  deselect(): void {
    this.cancel();
    this.state.set(null);
  }
  #fail(error: unknown): false {
    this.cancel();
    this.#session.reportError(error, "Selection canceled");
    return false;
  }
  dispose(): void {
    this.#closed = true;
    for (const stop of this.#stops) stop();
    this.#stops = [];
    this.deselect();
  }
}
