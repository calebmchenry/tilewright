import { containsTile, type Bounds } from "../domain/coordinates.ts";
import {
  captureSelection,
  selectionFits,
  type SelectionPayload,
} from "../domain/selection.ts";
import type { LayerId } from "../domain/values.ts";
import { rectangleBetween } from "./measurement.ts";
import type { EditorSession } from "./session.ts";
import { Store } from "./store.ts";
import { screenToTile, type Point } from "./viewport.ts";

export interface SelectionRectangle {
  readonly bounds: Bounds;
  readonly layerIds: readonly LayerId[];
}

/** Selection creation and membership are view state, never document commands. */
export class SelectionController {
  readonly state = new Store<SelectionPayload | null>(null);
  readonly preview = new Store<SelectionRectangle | null>(null);
  #session: EditorSession;
  #current: { id: number; start: Point; layerId: LayerId } | null = null;
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
    const reason = session.action("select").reason;
    if (reason) {
      session.report(reason);
      return false;
    }
    const start = session.editableTileAt(point);
    if (!start) return false;
    const current = this.state.getSnapshot();
    if (current && containsTile(current.bounds, start.x, start.y)) {
      session.report(
        "Deselect to start a new rectangle here. Selection movement is not available yet.",
      );
      return false;
    }
    this.#current = { id, start, layerId: session.activeLayer.getSnapshot() };
    return this.sample(id, point);
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
      // Clamp only an already-started creation endpoint, before adding one.
      const bounds = rectangleBetween(current.start, {
        x: Math.max(map.minX, Math.min(map.maxX - 1, end.x)),
        y: Math.max(map.minY, Math.min(map.maxY - 1, end.y)),
      });
      this.preview.set(
        Object.freeze({ bounds, layerIds: Object.freeze([current.layerId]) }),
      );
      return this.#current === current;
    } catch (error) {
      return this.#fail(error);
    }
  }
  commit(id: number, point: Point): boolean {
    if (!this.sample(id, point)) return false;
    try {
      const preview = this.preview.getSnapshot()!;
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
