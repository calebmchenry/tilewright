import { MapDocument, type MutationResult } from "../domain/document.ts";
import { CommandHistory } from "../domain/history.ts";
import type { DocumentCommand } from "../domain/commands.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  type LayerId,
  type RegistryId,
  type TileValue,
} from "../domain/values.ts";
import {
  normalizePaintColor,
  type ColorInput,
  type PaintColor,
} from "../domain/colors.ts";
import {
  RegistryCommands,
  registryEntry,
  type RegistryPlan,
} from "../domain/registry.ts";
import { grownMapBounds, type GrowthCounts } from "../domain/canvas.ts";
import { Store } from "./store.ts";
import { FillController } from "./fill.ts";
import { SelectionController } from "./selection.ts";
import { DrawingController, type DrawingToolId } from "./drawing.ts";
import { assertPencilSize, eraserTool, pencilTool } from "./pencil.ts";
import { lineTool, rectangleTool, type RectangleMode } from "./shapes.ts";
import { sampleVisibleCell } from "./sampling.ts";
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
  | "copy"
  | "cut"
  | "paste"
  | "pan"
  | "fit-map"
  | "eyedropper"
  | "add-layer"
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
  "add-annotation": {
    label: "Add area",
    reason: "Named area editing is not available yet.",
  },
};

/** One session owns the model/controller; React sees small, stable snapshots only. */
export class EditorSession {
  readonly document: MapDocument;
  readonly history: CommandHistory;
  readonly registryCommands: RegistryCommands;
  readonly drawing: DrawingController;
  readonly fill: FillController;
  readonly selection: SelectionController;
  readonly layers;
  readonly bounds;
  readonly registry;
  readonly annotations;
  readonly historyState;
  readonly activeLayer;
  readonly hiddenLayers = new Store<readonly LayerId[]>(Object.freeze([]));
  readonly activeTool = new Store<
    "inspect" | "pan" | "eyedropper" | "select" | DrawingToolId
  >("inspect");
  readonly canvasSize = new Store<ViewSize>(
    Object.freeze({ width: 1, height: 1 }),
  );
  readonly color = new Store(normalizePaintColor("#91baa1")!);
  readonly selectedRegistryId = new Store<RegistryId | null>(null);
  /** Shared square-brush size for Pencil and Eraser; kept outside document history. */
  readonly pencilSize = new Store(1);
  readonly rectangleMode = new Store<RectangleMode>("filled");
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
    this.registryCommands = new RegistryCommands(this.history);
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
        updates.push(
          () => this.registry.set(document.registryEntries),
          () => {
            const id = this.selectedRegistryId.getSnapshot();
            if (!id) return;
            if (!document.getRegistryEntry(id))
              this.selectedRegistryId.set(null);
            else this.color.set(registryEntry(document, id).rgba);
          },
        );
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
    this.fill = new FillController(this);
    this.selection = new SelectionController(this);
    this.drawing = new DrawingController(this);
    this.drawing.register(
      "pencil",
      pencilTool(() => this.pencilSize.getSnapshot()),
    );
    this.drawing.register(
      "eraser",
      eraserTool(() => this.pencilSize.getSnapshot()),
    );
    this.drawing.register("line", lineTool);
    this.drawing.register(
      "rectangle",
      rectangleTool(() => this.rectangleMode.getSnapshot()),
    );
  }
  dispose(): void {
    this.#closed = true;
    this.fill.dispose();
    this.selection.dispose();
    this.drawing.dispose();
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
    if (id === "copy" || id === "cut" || id === "paste")
      return {
        label: id === "copy" ? "Copy" : id === "cut" ? "Cut" : "Paste",
        reason: this.selection.clipboardReason(id),
      };
    if (id === "add-layer") return { label: "Add layer", reason: null };
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
    if (id === "select")
      return {
        label: "Select",
        reason:
          this.canvasState.getSnapshot() !== "ready"
            ? "Wait for the map canvas to be ready."
            : this.editableLayerIds().length
              ? null
              : "Show the active layer to create a selection.",
      };
    if (id === "fill")
      return {
        label: "Fill",
        reason:
          this.canvasState.getSnapshot() !== "ready"
            ? "Wait for the map canvas to be ready."
            : !this.editableLayerIds().length
              ? "Show the active layer to fill it."
              : this.fill.progress.getSnapshot()
                ? "A fill is running. Cancel it before starting another."
                : null,
      };
    const drawingTool = this.drawing.tool(id);
    if (drawingTool)
      return {
        label: drawingTool.label,
        reason:
          this.canvasState.getSnapshot() !== "ready"
            ? "Wait for the map canvas to be ready."
            : this.editableLayerIds().length
              ? null
              : "Show the active layer to draw on it.",
      };
    if (
      id === "inspect" ||
      id === "pan" ||
      id === "fit-map" ||
      id === "eyedropper"
    )
      return {
        label:
          id === "inspect"
            ? "Inspect"
            : id === "pan"
              ? "Pan"
              : id === "eyedropper"
                ? "Eyedropper"
                : "Fit map",
        reason:
          this.canvasState.getSnapshot() === "ready"
            ? null
            : "Wait for the map canvas to be ready.",
      };
    const disabled = unavailable[id];
    if (disabled) return disabled;
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
    if (id === "undo" || id === "redo") this.selection.deselect();
    const state = this.action(id);
    if (state.reason) {
      this.report(state.reason);
      return false;
    }
    if (id === "add-layer") return this.addLayer();
    if (id === "copy" || id === "cut") return this.selection.copy(id === "cut");
    if (id === "paste") return this.selection.startPaste();
    if (id === "select") {
      this.activeTool.set(id);
      this.report(
        "Select active. Drag a rectangle, then drag inside to move. Arrows nudge one tile; Shift nudges ten. Escape cancels or deselects.",
      );
      return true;
    }
    if (id === "fill") {
      this.activeTool.set(id);
      this.report(
        "Fill active. Click a region on the active layer; Escape cancels a running fill.",
      );
      return true;
    }
    if (id === "eyedropper") {
      this.activeTool.set(id);
      this.report(
        "Eyedropper active. Click to sample the topmost visible tile; empty cells keep the current paint.",
      );
      return true;
    }
    if (this.drawing.tool(id)) {
      this.activeTool.set(id as DrawingToolId);
      this.report(
        `${state.label} tool active. Drag to preview; release to apply; Escape cancels.`,
      );
      return true;
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
  /** New identities never depend on names/order or reuse an abandoned redo ID. */
  addLayer(): boolean {
    return this.#run("Add layer", () => {
      const layers = this.document.layers;
      let number = 1;
      while (layers.some((layer) => layer.name === `Layer ${number}`)) number++;
      const id = layerId(`layer-${crypto.randomUUID()}`);
      const result = this.history.execute("Add layer", [
        {
          kind: "add-layer",
          layer: { id, name: `Layer ${number}` },
          index:
            layers.findIndex(
              (layer) => layer.id === this.activeLayer.getSnapshot(),
            ) + 1,
        },
      ]);
      try {
        this.activeLayer.set(id);
      } catch (error) {
        return { ...result, observerErrors: [...result.observerErrors, error] };
      }
      return result;
    });
  }
  renameLayer(id: LayerId, name: string): boolean {
    return this.execute("Rename layer", [
      { kind: "rename-layer", id, name: name.trim() },
    ]);
  }
  moveLayer(id: LayerId, direction: "up" | "down"): boolean {
    return this.#run("Reorder layers", () => {
      const ids = this.document.layers.map((layer) => layer.id);
      const from = ids.indexOf(id);
      if (from < 0) throw new RangeError(`Unknown layer: ${id}`);
      const to = from + (direction === "up" ? 1 : -1);
      if (to >= 0 && to < ids.length)
        [ids[from], ids[to]] = [ids[to], ids[from]];
      return this.history.execute("Reorder layers", [
        { kind: "reorder-layers", ids },
      ]);
    });
  }
  layerHasContent(id: LayerId): boolean {
    // Only inspect the first occupied run, never materialize all layer content.
    return !this.document.iterateRuns(id).next().done;
  }
  removeLayer(id: LayerId, confirmedPopulated = false): boolean {
    return this.#run("Remove layer", () => {
      if (this.document.layers.length === 1)
        throw new RangeError("Keep at least one layer in the map.");
      if (this.layerHasContent(id) && !confirmedPopulated)
        throw new Error(
          "This layer contains tiles. Confirm removal first; Undo can restore it.",
        );
      return this.history.execute("Remove layer", [
        { kind: "remove-layer", id },
      ]);
    });
  }
  /** Drawing/selection tools target visible chosen IDs; Inspect is layer-independent. */
  editableLayerIds(
    ids: readonly LayerId[] = [this.activeLayer.getSnapshot()],
  ): readonly LayerId[] {
    if (this.#closed) return Object.freeze([]);
    const hidden = this.hiddenLayers.getSnapshot();
    return Object.freeze(
      [...new Set(ids)].filter(
        (id) =>
          this.document.layers.some((layer) => layer.id === id) &&
          !hidden.includes(id),
      ),
    );
  }
  growCanvas(counts: GrowthCounts): boolean {
    return this.#run("Grow canvas", () =>
      this.history.execute("Grow canvas", [
        {
          kind: "bounds",
          bounds: grownMapBounds(this.document.bounds, counts),
        },
      ]),
    );
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
  setColor(input: ColorInput): boolean {
    if (this.#closed) return false;
    const color = normalizePaintColor(input);
    if (!color) {
      this.report(
        "Enter #RGB or #RRGGBB, or RGB whole numbers from 0 to 255. Colors must be fully opaque.",
        "error",
      );
      return false;
    }
    this.#selectPaint(null, color);
    this.report(`Current color: ${color.slice(0, 7).toUpperCase()}`);
    return true;
  }
  setPencilSize(size: number): boolean {
    if (this.#closed) return false;
    try {
      assertPencilSize(size);
      this.pencilSize.set(size);
      return true;
    } catch (error) {
      this.reportError(error, "Pencil size");
      return false;
    }
  }
  setRectangleMode(mode: RectangleMode): boolean {
    if (this.#closed) return false;
    if (mode !== "filled" && mode !== "outline") {
      this.report("Choose a filled or outlined rectangle.", "error");
      return false;
    }
    this.rectangleMode.set(mode);
    return true;
  }
  #selectPaint(id: RegistryId | null, color: PaintColor): void {
    const errors: unknown[] = [];
    for (const update of [
      () => this.selectedRegistryId.set(id),
      () => this.color.set(color),
    ])
      try {
        update();
      } catch (error) {
        errors.push(error);
      }
    if (errors.length)
      throw new AggregateError(errors, "Paint selection view failed.");
  }
  selectRegisteredColor(id: RegistryId): boolean {
    if (this.#closed) return false;
    try {
      const entry = registryEntry(this.document, id);
      this.#selectPaint(id, entry.rgba);
      this.report(`Current named color: ${entry.name}`);
      return true;
    } catch (error) {
      this.reportError(error, "Select named color");
      return false;
    }
  }
  commitRegistry(plan: RegistryPlan): boolean {
    return this.#run("Named color", () => {
      const result = this.registryCommands.commit(plan);
      if (plan.kind === "add" && result.change) {
        try {
          this.#selectPaint(plan.id, plan.entry.rgba);
        } catch (error) {
          return {
            ...result,
            observerErrors: [...result.observerErrors, error],
          };
        }
      }
      return result;
    });
  }
  /** Tools consume identity directly. Equal RGB never implicitly registers paint. */
  currentPaint(): TileValue {
    const id = this.selectedRegistryId.getSnapshot();
    return id ? registeredColor(id) : rawColor(this.color.getSnapshot());
  }
  /** Sampling changes only paint selection, including when the active layer is hidden. */
  sampleColorAt(point: Point): boolean {
    if (this.#closed) return false;
    const reason = this.action("eyedropper").reason;
    if (reason) {
      this.report(reason);
      return false;
    }
    const tile = this.editableTileAt(point);
    const sample =
      tile &&
      sampleVisibleCell(this.document, tile, this.hiddenLayers.getSnapshot());
    if (!sample) {
      this.report("No visible tile to sample. Current paint unchanged.");
      return false;
    }
    // The authoring palette is opaque. Legacy alpha values must never be flattened.
    return sample.value.kind === "registered"
      ? this.selectRegisteredColor(sample.value.registryId)
      : this.setColor(sample.value.rgba);
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
    if (
      owner === "canvas" &&
      (input.metaKey || input.ctrlKey) &&
      !input.shiftKey &&
      ["c", "x", "v"].includes(key)
    ) {
      this.perform(key === "c" ? "copy" : key === "x" ? "cut" : "paste");
      return true;
    }
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
      if (this.selection.pasting && key === "enter") {
        this.selection.commitPaste();
        return true;
      }
      const toolKeys: Readonly<Record<string, ActionId>> = {
        i: "inspect",
        h: "pan",
        b: "pencil",
        e: "eraser",
        d: "eyedropper",
        l: "line",
        r: "rectangle",
        g: "fill",
        v: "select",
      };
      if (toolKeys[key]) this.perform(toolKeys[key]);
      else if (
        (key === "[" || key === "]") &&
        ["pencil", "eraser"].includes(this.activeTool.getSnapshot())
      )
        this.setPencilSize(
          Math.max(
            1,
            Math.min(
              32,
              this.pencilSize.getSnapshot() + (key === "]" ? 1 : -1),
            ),
          ),
        );
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
        if (
          this.activeTool.getSnapshot() === "select" &&
          (this.selection.state.getSnapshot() || this.selection.pasting)
        ) {
          const step = input.shiftKey ? 10 : 1;
          this.selection.nudge(
            key === "arrowleft" ? -step : key === "arrowright" ? step : 0,
            key === "arrowup" ? -step : key === "arrowdown" ? step : 0,
          );
          return true;
        }
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
