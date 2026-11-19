import { newMapBounds } from "../domain/canvas.ts";
import { MapDocument } from "../domain/document.ts";
import {
  decodeProject,
  type ProjectDecodeOptions,
} from "../domain/project-decoding.ts";
import { ProjectDecodingError } from "../domain/project-format.ts";
import type { RevisionCheckpoint } from "../domain/history.ts";
import { layerId } from "../domain/values.ts";
import { EditorSession } from "./session.ts";
import { Store } from "./store.ts";

/** Application lifetime owner. Replacement always gets fresh history and view state. */
export class EditorWorkspace {
  readonly state: Store<
    Readonly<{
      session: EditorSession;
      generation: number;
      savedPath: string | null;
    }>
  >;
  #closed = false;
  #loadRequest = 0;
  #publishing = false;

  constructor(session = new EditorSession()) {
    this.state = new Store(
      Object.freeze({ session, generation: 0, savedPath: null }),
    );
  }

  createMap(width: number, height: number): readonly unknown[] {
    this.#assertAvailable();
    const bounds = newMapBounds(width, height);
    const previous = this.state.getSnapshot();
    const session = new EditorSession(new MapDocument({ bounds }));
    const observerErrors: unknown[] = [];
    this.#loadRequest++;
    try {
      this.#publishing = true;
      this.state.set(
        Object.freeze({
          session,
          generation: previous.generation + 1,
          savedPath: null,
        }),
      );
    } catch (error) {
      observerErrors.push(error);
    } finally {
      try {
        previous.session.dispose();
      } catch (error) {
        observerErrors.push(error);
      } finally {
        this.#publishing = false;
      }
    }
    return Object.freeze(observerErrors);
  }

  /** Explicit-project load boundary for a future native read/Open coordinator.
   * Prepare everything privately; publish session + path together exactly once.
   * The caller owns unsaved-change confirmation before requesting replacement.
   */
  async openProject(
    bytes: Uint8Array,
    options: ProjectDecodeOptions & { readonly savedPath?: string | null } = {},
  ): Promise<
    Readonly<{ session: EditorSession; observerErrors: readonly unknown[] }>
  > {
    this.#assertAvailable();
    const savedPath = options.savedPath ?? null;
    if (
      savedPath !== null &&
      (typeof savedPath !== "string" || !savedPath.trim())
    )
      throw new TypeError("Project path must be nonblank text or null.");
    const request = ++this.#loadRequest;
    const previous = this.state.getSnapshot();
    const current = previous.session;
    current.document.assertCommittedRead();
    const version = current.document.version;
    const history = current.history.state;
    const active = current.activeLayer.getSnapshot();
    const hidden = current.hiddenLayers.getSnapshot();
    const checkCurrent = () => {
      if (options.signal?.aborted)
        throw new ProjectDecodingError(
          "canceled",
          "project",
          "Project load canceled.",
        );
      if (
        this.#closed ||
        request !== this.#loadRequest ||
        this.state.getSnapshot() !== previous ||
        current.document.version !== version ||
        current.activeLayer.getSnapshot() !== active ||
        current.hiddenLayers.getSnapshot() !== hidden ||
        current.history.state.savedRevision !== history.savedRevision ||
        current.history.state.recoveryRevision !== history.recoveryRevision
      )
        throw new ProjectDecodingError(
          "superseded",
          "workspace",
          "The workspace changed while loading. Open the project again to replace the current map.",
        );
    };
    const decoded = await decodeProject(bytes, {
      ...options,
      yieldControl: async () => {
        checkCurrent();
        await (options.yieldControl?.() ??
          new Promise<void>((resolve) => setTimeout(resolve, 0)));
        checkCurrent();
      },
    });
    checkCurrent();
    let session: EditorSession | undefined;
    try {
      session = new EditorSession(decoded.document, {
        initiallySaved: true,
        fitOnFirstSize: true,
      });
      session.activeLayer.set(layerId(decoded.preferences.activeLayerId));
      session.hiddenLayers.set(
        Object.freeze(decoded.preferences.hiddenLayerIds.map(layerId)),
      );
      checkCurrent();
    } catch (error) {
      session?.dispose();
      if (error instanceof ProjectDecodingError) throw error;
      throw new ProjectDecodingError(
        "construction",
        "workspace.session",
        `Could not prepare editor session: ${(error as Error).message}`,
      );
    }
    const observerErrors: unknown[] = [];
    // Store.set publishes before notifying. Observer/cleanup errors cannot turn
    // an already successful installation into an apparent failed load/retry.
    this.#publishing = true;
    try {
      this.state.set(
        Object.freeze({
          session,
          generation: previous.generation + 1,
          savedPath,
        }),
      );
    } catch (error) {
      observerErrors.push(
        ...(error instanceof AggregateError ? error.errors : [error]),
      );
    } finally {
      try {
        current.dispose();
      } catch (error) {
        observerErrors.push(error);
      }
      this.#publishing = false;
    }
    return Object.freeze({
      session,
      observerErrors: Object.freeze(observerErrors),
    });
  }

  /** Disk acknowledgement belongs only to the session whose bytes were written. */
  acknowledgeProjectSave(
    session: EditorSession,
    path: string,
    checkpoint: RevisionCheckpoint,
  ): readonly unknown[] {
    this.#assertAvailable();
    const previous = this.state.getSnapshot();
    if (previous.session !== session)
      throw new Error("The saved session is no longer active.");
    if (!path.trim()) throw new Error("The saved path is missing.");
    const errors: unknown[] = [];
    this.#publishing = true;
    try {
      errors.push(...session.history.markSaved(checkpoint));
      try {
        this.state.set(Object.freeze({ ...previous, savedPath: path }));
      } catch (error) {
        errors.push(error);
      }
    } finally {
      this.#publishing = false;
    }
    return Object.freeze(errors);
  }

  #assertAvailable(): void {
    if (this.#closed) throw new Error("This workspace is closed.");
    if (this.#publishing)
      throw new Error("Workspace replacement is already being published.");
  }

  dispose(): void {
    this.#closed = true;
    this.state.getSnapshot().session.dispose();
  }
}
