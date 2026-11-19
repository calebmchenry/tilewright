import {
  AnnotationCommands,
  AreaValidationError,
  namedArea,
  validateNamedArea,
  type AreaField,
} from "../domain/annotations.ts";
import type { Bounds } from "../domain/coordinates.ts";
import type { AnnotationId } from "../domain/values.ts";
import type { EditorSession } from "./session.ts";
import { Store } from "./store.ts";
import { rectangleBetween } from "./measurement.ts";
import { canEditTiles, screenToTile, type Point } from "./viewport.ts";

export interface AreaDraft {
  readonly id: AnnotationId | null;
  readonly name: string;
  readonly description: string;
  readonly tier: string;
  readonly bounds: Readonly<Record<keyof Bounds, string>>;
}
const fieldsFor = (bounds: Bounds) =>
  Object.freeze({
    minX: String(bounds.minX),
    minY: String(bounds.minY),
    maxX: String(bounds.maxX),
    maxY: String(bounds.maxY),
  });
export function draftBounds(draft: AreaDraft): Bounds {
  const number = (key: keyof Bounds) =>
    /^-?\d+$/.test(draft.bounds[key].trim()) ? Number(draft.bounds[key]) : NaN;
  return {
    minX: number("minX"),
    minY: number("minY"),
    maxX: number("maxX"),
    maxY: number("maxY"),
  };
}

/** Annotation drafts never enter tile payloads or document history. */
export class AnnotationController {
  readonly selected = new Store<AnnotationId | null>(null);
  readonly draft = new Store<AreaDraft | null>(null);
  readonly errors = new Store<
    Readonly<Partial<Record<AreaField | "form", string>>>
  >({});
  readonly drawingBounds = new Store(false);
  readonly preview = new Store<Bounds | null>(null);
  #session: EditorSession;
  #commands: AnnotationCommands;
  #current: { id: number; start: Point } | null = null;
  #stops: (() => void)[];
  #committing = false;
  #closed = false;
  constructor(session: EditorSession) {
    this.#session = session;
    this.#commands = new AnnotationCommands(session.history);
    this.#stops = [
      session.activeTool.subscribe(() => this.cancelDraft()),
      session.document.subscribe(() => {
        if (!this.#committing) this.cancelDraft();
        const id = this.selected.getSnapshot();
        if (id && !session.document.getAnnotation(id)) this.selected.set(null);
      }),
      ...[session.viewport, session.canvasSize, session.canvasState].map(
        (store) => store.subscribe(() => this.cancelGesture()),
      ),
    ];
  }
  get pointerId() {
    return this.#current?.id ?? null;
  }
  newArea(): boolean {
    if (this.#closed) return false;
    this.#activate();
    this.selected.set(null);
    const { minX, minY } = this.#session.document.bounds;
    this.draft.set(
      Object.freeze({
        id: null,
        name: "",
        description: "",
        tier: "detail",
        bounds: fieldsFor({ minX, minY, maxX: minX + 1, maxY: minY + 1 }),
      }),
    );
    return true;
  }
  select(id: AnnotationId): boolean {
    if (this.#closed) return false;
    try {
      const area = namedArea(this.#session.document, id);
      this.#activate();
      this.selected.set(id);
      this.draft.set(
        Object.freeze({
          id,
          name: area.name,
          description: area.description,
          tier: area.tier,
          bounds: fieldsFor(area.bounds),
        }),
      );
      return true;
    } catch (error) {
      this.#error(error);
      return false;
    }
  }
  #activate(): void {
    this.cancelDraft();
    this.#session.drawing.cancel();
    this.#session.fill.cancel();
    this.#session.selection.cancel();
    this.#session.activeTool.set("area");
  }
  update(
    fields: Partial<
      Pick<AreaDraft, "name" | "description" | "tier" | "bounds">
    >,
  ): void {
    const draft = this.draft.getSnapshot();
    if (!draft || this.#closed) return;
    this.cancelGesture();
    this.draft.set(
      Object.freeze({
        ...draft,
        ...fields,
        bounds: Object.freeze({ ...(fields.bounds ?? draft.bounds) }),
      }),
    );
    if (Object.keys(this.errors.getSnapshot()).length) this.errors.set({});
  }
  apply(): boolean {
    const draft = this.draft.getSnapshot();
    if (!draft || this.#closed) return false;
    this.cancelGesture();
    let committed;
    try {
      this.#committing = true;
      const value = {
        name: draft.name,
        description: draft.description,
        tier: draft.tier,
        bounds: draftBounds(draft),
        label: { placement: "center" },
      };
      committed = this.#commands.execute(
        draft.id
          ? { kind: "edit", id: draft.id, value }
          : { kind: "create", value },
      );
    } catch (error) {
      this.#error(error);
      return false;
    } finally {
      this.#committing = false;
    }
    this.selected.set(committed.id);
    this.cancelDraft();
    if (committed.result.observerErrors.length)
      this.#session.reportError(
        committed.result.observerErrors[0],
        "Area committed, but a view could not update",
      );
    else
      this.#session.report(
        committed.result.change ? "Area applied." : "No changes.",
      );
    return true;
  }
  remove(): boolean {
    const id = this.selected.getSnapshot();
    if (!id || this.#closed) return false;
    let committed;
    try {
      this.#committing = true;
      committed = this.#commands.execute({ kind: "remove", id });
    } catch (error) {
      this.#error(error);
      return false;
    } finally {
      this.#committing = false;
    }
    this.cancelDraft();
    this.selected.set(null);
    if (committed.result.observerErrors.length)
      this.#session.reportError(
        committed.result.observerErrors[0],
        "Area deleted, but a view could not update",
      );
    else this.#session.report("Area deleted. Undo restores it.");
    return true;
  }
  #error(error: unknown): void {
    this.errors.set(
      error instanceof AreaValidationError
        ? error.fields
        : { form: error instanceof Error ? error.message : String(error) },
    );
    this.#session.reportError(error, "Named area");
  }
  focusReason(): string | null {
    if (this.#closed || this.#session.canvasState.getSnapshot() !== "ready")
      return "Wait for the map canvas to be ready.";
    if (!this.selected.getSnapshot()) return "Select an area to focus.";
    return this.overlayBounds(false)
      ? null
      : "Enter valid bounds to focus the area.";
  }
  focus(): boolean {
    const reason = this.focusReason();
    if (reason) {
      this.#session.report(reason);
      return false;
    }
    try {
      // Revalidate identity so a stale action cannot reveal a removed record.
      namedArea(this.#session.document, this.selected.getSnapshot()!);
      this.cancelGesture();
      this.drawingBounds.set(false);
      this.#session.revealBounds(this.overlayBounds()!);
      this.#session.report("Area focused. Bounds and tiles are unchanged.");
      return true;
    } catch (error) {
      this.#error(error);
      return false;
    }
  }
  drawReason(): string | null {
    if (this.#closed || this.#session.canvasState.getSnapshot() !== "ready")
      return "Wait for the map canvas to be ready.";
    if (!canEditTiles(this.#session.viewport.getSnapshot()))
      return "Zoom in to draw area bounds (8 px per tile minimum). Numeric bounds remain available.";
    return this.draft.getSnapshot()
      ? null
      : "Choose New area or select an area to edit its bounds.";
  }
  draw(): boolean {
    const reason = this.drawReason();
    if (reason) {
      this.#session.report(reason);
      return false;
    }
    this.cancelGesture();
    this.#session.selection.cancel();
    this.drawingBounds.set(true);
    this.#session.report(
      "Drag area bounds on the map, then Apply the area. Both endpoint tiles count.",
    );
    return true;
  }
  begin(id: number, point: Point): boolean {
    if (
      this.#current ||
      !this.drawingBounds.getSnapshot() ||
      this.drawReason() ||
      this.#session.activeTool.getSnapshot() !== "area"
    )
      return false;
    const start = this.#session.editableTileAt(point);
    if (!start) return false;
    this.#current = { id, start };
    this.preview.set(rectangleBetween(start, start));
    return true;
  }
  sample(id: number, point: Point): void {
    const current = this.#current;
    if (!current || current.id !== id) return;
    const tile = screenToTile(
      point.x,
      point.y,
      this.#session.viewport.getSnapshot(),
    );
    if (![tile.x, tile.y].every(Number.isSafeInteger)) {
      this.cancelGesture();
      return;
    }
    const b = this.#session.document.bounds;
    this.preview.set(
      rectangleBetween(current.start, {
        x: Math.max(b.minX, Math.min(b.maxX - 1, tile.x)),
        y: Math.max(b.minY, Math.min(b.maxY - 1, tile.y)),
      }),
    );
  }
  commit(id: number, point: Point): boolean {
    if (this.#current?.id !== id) return false;
    this.sample(id, point);
    const bounds = this.preview.getSnapshot();
    if (!bounds) return false;
    this.update({ bounds: fieldsFor(bounds) });
    this.drawingBounds.set(false);
    return true;
  }
  cancelGesture(id?: number): void {
    if (id !== undefined && this.#current?.id !== id) return;
    this.#current = null;
    this.preview.set(null);
  }
  cancelDraft(): void {
    this.cancelGesture();
    this.drawingBounds.set(false);
    this.draft.set(null);
    if (Object.keys(this.errors.getSnapshot()).length) this.errors.set({});
  }
  deselect(): void {
    this.cancelDraft();
    this.selected.set(null);
  }
  /** Invalid draft geometry has no overlay; never fall back to misleading old bounds. */
  overlayBounds(includePreview = true): Bounds | null {
    const preview = includePreview ? this.preview.getSnapshot() : null;
    if (preview) return preview;
    const draft = this.draft.getSnapshot();
    try {
      if (draft)
        return validateNamedArea(
          {
            name: "Preview",
            description: "",
            tier: "detail",
            bounds: draftBounds(draft),
            label: { placement: "center" },
          },
          this.#session.document.bounds,
        ).bounds;
      const id = this.selected.getSnapshot();
      return id ? namedArea(this.#session.document, id).bounds : null;
    } catch {
      return null;
    }
  }
  dispose(): void {
    this.#closed = true;
    for (const stop of this.#stops) stop();
    this.deselect();
  }

  /** The label shares the outline's draft/gesture geometry, without saving it. */
  overlayArea() {
    const bounds = this.overlayBounds();
    if (!bounds) return null;
    const draft = this.draft.getSnapshot();
    const id = this.selected.getSnapshot();
    try {
      const area = draft
        ? validateNamedArea(
            { ...draft, bounds, label: { placement: "center" } },
            this.#session.document.bounds,
          )
        : id
          ? namedArea(this.#session.document, id)
          : null;
      return area
        ? {
            id: draft?.id ?? id ?? "",
            name: area.name,
            tier: area.tier,
            bounds,
          }
        : null;
    } catch {
      return null;
    }
  }
}
