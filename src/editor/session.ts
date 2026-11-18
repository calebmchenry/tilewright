import { MapDocument, type MutationResult } from "../domain/document.ts";
import { CommandHistory } from "../domain/history.ts";
import type { DocumentCommand } from "../domain/commands.ts";
import type { LayerId } from "../domain/values.ts";
import { Store } from "./store.ts";
import {
  assertBounds,
  containsTile,
  type Bounds,
} from "../domain/coordinates.ts";
import {
  canEditTiles,
  clampZoom,
  fitToMap,
  OVERVIEW_MESSAGE,
  panBy,
  screenToTile,
  viewCenter,
  zoomAt,
  type Point,
  type Viewport,
  type ViewSize,
} from "./viewport.ts";

export type FocusOwner = "canvas" | "panel" | "text" | "outside";
export type ActionId =
  | "undo"
  | "redo"
  | "save"
  | "inspect"
  | "pencil"
  | "eraser"
  | "fill"
  | "line"
  | "rectangle"
  | "select"
  | "pan"
  | "fit-map"
  | "eyedropper"
  | "add-layer"
  | "register-color"
  | "add-annotation";
export interface ActionState {
  readonly label: string;
  readonly reason: string | null;
}
export interface Feedback {
  readonly kind: "info" | "error";
  readonly message: string;
}
export interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}
const unavailable: Partial<Record<ActionId, ActionState>> = {
  save: { label: "Save", reason: "Local project saving is not available yet." },
  pencil: { label: "Pencil", reason: "Pencil drawing is not available yet." },
  eraser: { label: "Eraser", reason: "Erasing is not available yet." },
  fill: { label: "Fill", reason: "Flood fill is not available yet." },
  line: { label: "Line", reason: "Line drawing is not available yet." },
  rectangle: {
    label: "Rectangle",
    reason: "Rectangle drawing is not available yet.",
  },
  select: { label: "Select", reason: "Tile selections are not available yet." },
  eyedropper: {
    label: "Eyedropper",
    reason: "Color sampling is not available yet.",
  },
  "add-layer": {
    label: "Add layer",
    reason: "Creating layers is not available yet.",
  },
  "register-color": {
    label: "Register color",
    reason: "Named color editing is not available yet.",
  },
  "add-annotation": {
    label: "Add area",
    reason: "Named area editing is not available yet.",
  },
};

/** One session owns the model/controller; React sees small, stable snapshots only. */
export class EditorSession {
  readonly document: MapDocument;
  readonly history: CommandHistory;
  readonly layers;
  readonly bounds;
  readonly registry;
  readonly annotations;
  readonly historyState;
  readonly activeLayer;
  readonly hiddenLayers = new Store<readonly LayerId[]>(Object.freeze([]));
  readonly activeTool = new Store<"inspect" | "pan">("inspect");
  readonly canvasSize = new Store<ViewSize>(
    Object.freeze({ width: 1, height: 1 }),
  );
  readonly color = new Store("#91baa1");
  readonly viewport = new Store<Viewport>(
    Object.freeze({ x: 0, y: 0, zoom: 1 }),
  );
  readonly focus = new Store<FocusOwner>("outside");
  readonly pointer = new Store<Readonly<{ x: number; y: number }> | null>(null);
  // A display/measurement rectangle, not a tile payload or an editable selection.
  readonly rectangle = new Store<Bounds | null>(null);
  readonly feedback = new Store<Feedback>(
    Object.freeze({ kind: "info", message: "Ready to inspect your map." }),
  );
  readonly canvasState = new Store<"loading" | "ready" | "error">("loading");
  #dispose: () => void;
  #closed = false;

  constructor(document = new MapDocument()) {
    this.document = document;
    this.history = new CommandHistory(document);
    this.layers = new Store(document.layers);
    this.bounds = new Store(document.bounds);
    this.registry = new Store(document.registryEntries);
    this.annotations = new Store(document.annotations);
    this.historyState = new Store(this.history.state);
    this.activeLayer = new Store(document.layers[0].id);
    const unsubscribeDocument = document.subscribe((change) => {
      const kinds = new Set(
        (change.kind === "transaction" ? change.changes : [change]).map(
          (part) => part.kind,
        ),
      );
      const updates: (() => void)[] = [];
      if (kinds.has("layers"))
        updates.push(() => {
          if (
            !document.layers.some(
              (layer) => layer.id === this.activeLayer.getSnapshot(),
            )
          )
            this.activeLayer.set(document.layers.at(-1)!.id);
          const hidden = this.hiddenLayers.getSnapshot();
          const retained = hidden.filter((id) =>
            document.layers.some((layer) => layer.id === id),
          );
          if (retained.length !== hidden.length)
            this.hiddenLayers.set(Object.freeze(retained));
          this.layers.set(document.layers);
        });
      if (kinds.has("bounds"))
        updates.push(() => {
          this.bounds.set(document.bounds);
          const rectangle = this.rectangle.getSnapshot();
          if (rectangle && !this.#containsRectangle(rectangle))
            this.rectangle.set(null);
        });
      if (kinds.has("registry"))
        updates.push(() => this.registry.set(document.registryEntries));
      if (kinds.has("annotation"))
        updates.push(() => this.annotations.set(document.annotations));
      const errors: unknown[] = [];
      for (const update of updates)
        try {
          update();
        } catch (error) {
          errors.push(error);
        }
      if (errors.length)
        throw new AggregateError(errors, "Model summary update failed.");
    });
    const unsubscribeHistory = this.history.subscribe((state) =>
      this.historyState.set(state),
    );
    this.#dispose = () => {
      unsubscribeDocument();
      unsubscribeHistory();
    };
  }
  dispose(): void {
    this.#closed = true;
    this.#dispose();
  }
  /** Visibility is a transient view preference until layer persistence is defined. */
  setLayerVisible(id: LayerId, visible: boolean): void {
    if (this.#closed) throw new Error("Editor session is closed.");
    if (!this.document.layers.some((layer) => layer.id === id))
      throw new RangeError(`Unknown layer: ${id}`);
    const hidden = this.hiddenLayers.getSnapshot();
    if (hidden.includes(id) === !visible) return;
    this.hiddenLayers.set(
      Object.freeze(
        visible ? hidden.filter((item) => item !== id) : [...hidden, id],
      ),
    );
  }
  report(message: string, kind: Feedback["kind"] = "info"): void {
    this.feedback.set(Object.freeze({ kind, message }));
  }
  reportError(error: unknown, context = "Action failed"): void {
    this.report(
      `${context}: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
  }
  action(id: ActionId): ActionState {
    if (
      [
        "pencil",
        "eraser",
        "fill",
        "line",
        "rectangle",
        "select",
        "eyedropper",
      ].includes(id) &&
      !canEditTiles(this.viewport.getSnapshot())
    )
      return { label: unavailable[id]!.label, reason: OVERVIEW_MESSAGE };
    const disabled = unavailable[id];
    if (disabled) return disabled;
    if (id === "inspect" || id === "pan" || id === "fit-map")
      return {
        label: id === "inspect" ? "Inspect" : id === "pan" ? "Pan" : "Fit map",
        reason:
          this.canvasState.getSnapshot() === "ready"
            ? null
            : "Wait for the map canvas to be ready.",
      };
    const state = this.historyState.getSnapshot();
    return id === "undo"
      ? {
          label: state.undoLabel ? `Undo ${state.undoLabel}` : "Undo",
          reason: state.undoSteps ? null : "There are no map edits to undo.",
        }
      : {
          label: state.redoLabel ? `Redo ${state.redoLabel}` : "Redo",
          reason: state.redoSteps ? null : "There are no map edits to redo.",
        };
  }
  perform(id: ActionId): boolean {
    const state = this.action(id);
    if (state.reason) {
      this.report(state.reason);
      return false;
    }
    if (id === "inspect" || id === "pan") {
      this.activeTool.set(id);
      this.report(
        id === "pan"
          ? "Pan tool active. Drag the map to move the view."
          : "Inspect tool active. Move over the canvas to read tile coordinates.",
      );
      return true;
    }
    if (id === "fit-map") {
      this.fitMap();
      return true;
    }
    return this.#run(state.label, () =>
      id === "undo" ? this.history.undo() : this.history.redo(),
    );
  }
  execute(label: string, commands: Iterable<DocumentCommand>): boolean {
    return this.#run(label, () => this.history.execute(label, commands));
  }
  #run(label: string, run: () => MutationResult): boolean {
    try {
      if (this.#closed) throw new Error("This editor session is closed.");
      const result = run();
      if (result.observerErrors.length) {
        this.reportError(
          result.observerErrors[0],
          `${label} committed, but a view could not update`,
        );
      } else this.report(result.change ? label : "No changes.");
      return true;
    } catch (error) {
      this.reportError(error, label);
      return false;
    }
  }
  selectLayer(id: LayerId): void {
    if (!this.document.layers.some((layer) => layer.id === id)) {
      this.report("That layer is no longer available.", "error");
      return;
    }
    this.activeLayer.set(id);
  }
  setColor(color: string): boolean {
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      this.report("Enter a color as #RRGGBB, for example #91BAA1.", "error");
      return false;
    }
    this.color.set(color.toLowerCase());
    this.report(`Current color: ${color.toUpperCase()}`);
    return true;
  }
  setCanvasSize(width: number, height: number): void {
    const previous = this.canvasSize.getSnapshot();
    if (
      width > 0 &&
      height > 0 &&
      (width !== previous.width || height !== previous.height)
    )
      this.canvasSize.set(Object.freeze({ width, height }));
  }
  #containsRectangle(bounds: Bounds): boolean {
    return (
      containsTile(this.document.bounds, bounds.minX, bounds.minY) &&
      containsTile(this.document.bounds, bounds.maxX - 1, bounds.maxY - 1)
    );
  }
  /** Shared readout seam for Inspect and future rectangle/selection tools. */
  setRectangle(bounds: Bounds | null): void {
    if (this.#closed) return;
    if (bounds) {
      assertBounds(bounds);
      if (!this.#containsRectangle(bounds))
        throw new RangeError("Rectangle must be inside the map.");
    }
    const previous = this.rectangle.getSnapshot();
    if (
      previous === bounds ||
      (previous &&
        bounds &&
        previous.minX === bounds.minX &&
        previous.minY === bounds.minY &&
        previous.maxX === bounds.maxX &&
        previous.maxY === bounds.maxY)
    )
      return;
    this.rectangle.set(bounds ? Object.freeze({ ...bounds }) : null);
  }
  #setView(view: Viewport): void {
    if (this.#closed) return;
    const previous = this.viewport.getSnapshot();
    if (
      view.x === previous.x &&
      view.y === previous.y &&
      view.zoom === previous.zoom
    )
      return;
    this.pointer.set(null);
    this.viewport.set(view);
  }
  setZoom(
    zoom: number,
    anchor = viewCenter(this.canvasSize.getSnapshot()),
    from = this.viewport.getSnapshot(),
  ): void {
    try {
      this.#setView(
        zoomAt(
          from,
          clampZoom(zoom, this.document.bounds, this.canvasSize.getSnapshot()),
          anchor,
        ),
      );
    } catch (error) {
      this.reportError(error, "Cannot zoom");
    }
  }
  pan(dx: number, dy: number): void {
    this.#setView(
      panBy(
        this.viewport.getSnapshot(),
        dx,
        dy,
        this.document.bounds,
        this.canvasSize.getSnapshot(),
      ),
    );
  }
  fitMap(): void {
    this.#setView(
      fitToMap(this.document.bounds, this.canvasSize.getSnapshot()),
    );
    this.report("Map fitted to the canvas. Zoom in for tile detail.");
  }
  /** Shared tool gate: never clamp an outside pointer onto an editable edge. */
  editableTileAt(point: Point): Point | null {
    if (
      this.#closed ||
      this.canvasState.getSnapshot() !== "ready" ||
      !canEditTiles(this.viewport.getSnapshot())
    )
      return null;
    const tile = screenToTile(point.x, point.y, this.viewport.getSnapshot());
    return containsTile(this.document.bounds, tile.x, tile.y) ? tile : null;
  }
  /** All shortcut sources share enablement/errors; text controls keep native editing. */
  routeKey(input: KeyInput, owner: FocusOwner): boolean {
    this.focus.set(owner);
    if (
      owner === "text" ||
      owner === "outside" ||
      input.isComposing ||
      input.defaultPrevented ||
      input.altKey
    )
      return false;
    const key = input.key.toLowerCase();
    if ((input.metaKey || input.ctrlKey) && ["z", "s"].includes(key)) {
      this.perform(key === "s" ? "save" : input.shiftKey ? "redo" : "undo");
      return true;
    }
    if (
      owner === "canvas" &&
      !input.metaKey &&
      !input.ctrlKey &&
      this.canvasState.getSnapshot() === "ready"
    ) {
      if (key === "i" || key === "h")
        this.perform(key === "i" ? "inspect" : "pan");
      else if (key === "f") this.perform("fit-map");
      else if (key === "0") this.setZoom(1);
      else if (["+", "=", "-", "_"].includes(key))
        this.setZoom(
          this.viewport.getSnapshot().zoom *
            (["-", "_"].includes(key) ? 1 / 1.25 : 1.25),
        );
      else if (
        ["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key)
      ) {
        const step = input.shiftKey ? 256 : 64;
        this.pan(
          key === "arrowleft" ? step : key === "arrowright" ? -step : 0,
          key === "arrowup" ? step : key === "arrowdown" ? -step : 0,
        );
      } else return false;
      return true;
    }
    return false;
  }
}
