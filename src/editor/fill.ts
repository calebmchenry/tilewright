import { prepareFloodFill } from "../domain/fill.ts";
import type { EditorSession } from "./session.ts";
import { Store } from "./store.ts";
import type { Point } from "./viewport.ts";

/** Single-click async operation, independent of drag previews and navigation. */
export class FillController {
  readonly progress = new Store<Readonly<{ cells: number }> | null>(null);
  #session: EditorSession;
  #job: { aborted: boolean; committing: boolean } | null = null;
  #closed = false;
  #stops: (() => void)[];

  constructor(session: EditorSession) {
    this.#session = session;
    const cancel = () => this.cancel();
    this.#stops = [
      session.document.subscribe(cancel),
      ...[
        session.activeLayer,
        session.hiddenLayers,
        session.activeTool,
        session.color,
        session.selectedRegistryId,
        session.canvasState,
      ].map((store) => store.subscribe(cancel)),
    ];
  }

  async start(point: Point): Promise<boolean> {
    const s = this.#session;
    if (this.#closed || this.#job || s.activeTool.getSnapshot() !== "fill")
      return false;
    const reason = s.action("fill").reason;
    if (reason) {
      s.report(reason);
      return false;
    }
    const seed = s.editableTileAt(point);
    if (!seed) {
      s.report("Choose a tile inside the map to fill.");
      return false;
    }
    const layer = s.activeLayer.getSnapshot(),
      paint = s.currentPaint();
    const job = { aborted: false, committing: false };
    this.#job = job;
    try {
      this.progress.set(Object.freeze({ cells: 0 }));
      const plan = await prepareFloodFill(s.document, layer, seed, paint, {
        signal: job,
        onProgress: (cells) => {
          if (this.#job === job) this.progress.set(Object.freeze({ cells }));
        },
      });
      if (job.aborted || this.#closed || this.#job !== job) return false;
      job.committing = true;
      const result = s.history.executePrepared("Fill", plan);
      if (result.observerErrors.length)
        s.reportError(
          result.observerErrors[0],
          "Fill committed, but a view could not update",
        );
      else
        s.report(
          result.change
            ? `Filled ${plan.changedCells.toLocaleString()} tiles.`
            : "No changes.",
        );
      return true;
    } catch (error) {
      if (!job.aborted && !this.#closed) s.reportError(error, "Fill failed");
      return false;
    } finally {
      if (this.#job === job) {
        this.#job = null;
        this.progress.set(null);
      }
    }
  }
  cancel(): void {
    if (!this.#job || this.#job.committing) return;
    this.#job.aborted = true;
    this.#job = null;
    this.progress.set(null);
    if (!this.#closed) this.#session.report("Fill canceled. No tiles changed.");
  }
  dispose(): void {
    this.#closed = true;
    this.cancel();
    for (const stop of this.#stops) stop();
    this.#stops = [];
  }
}
