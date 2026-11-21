import type { RecoveredProject } from "./recovery-discovery.ts";
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
import { projectSource, type ProjectSource } from "./persistence.ts";

/** Application lifetime owner. Replacement always gets fresh history and view state. */
export class EditorWorkspace {
  readonly state: Store<
    Readonly<{
      session: EditorSession;
      generation: number;
      source: ProjectSource | null;
      /** Native-only compatibility projection; never populate from File.name. */
      savedPath: string | null;
      recovered: RecoveredProject | null;
    }>
  >;
  #closed = false;
  #loadRequest = 0;
  #publishing = false;

  constructor(session = new EditorSession()) {
    this.state = new Store(
      Object.freeze({
        session,
        generation: 0,
        source: null,
        savedPath: null,
        recovered: null,
      }),
    );
  }

  createMap(width: number, height: number): readonly unknown[] {
    return this.prepareMap(width, height).install();
  }

  /** Construct privately before a durable outgoing-recovery resolution. */
  prepareMap(width: number, height: number) {
    this.#assertAvailable();
    const bounds = newMapBounds(width, height);
    const previous = this.state.getSnapshot();
    const session = new EditorSession(new MapDocument({ bounds }));
    let installed = false;
    return {
      dispose: () => {
        if (!installed) session.dispose();
      },
      install: (): readonly unknown[] => {
        this.#assertAvailable();
        if (this.state.getSnapshot() !== previous)
          throw new Error("Workspace changed before New Map.");
        installed = true;
        const observerErrors: unknown[] = [];
        this.#loadRequest++;
        try {
          this.#publishing = true;
          this.state.set(
            Object.freeze({
              session,
              generation: previous.generation + 1,
              source: null,
              savedPath: null,
              recovered: null,
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
      },
    };
  }

  /** Shared validated load boundary for native files and browser imports.
   * Prepare everything privately; publish session + source together exactly once.
   * The caller owns unsaved-change confirmation before requesting replacement.
   */
  async openProject(
    bytes: Uint8Array,
    options: ProjectDecodeOptions & {
      readonly savedPath?: string | null;
      readonly source?: ProjectSource;
      readonly recovered?: RecoveredProject;
      readonly beforeInstall?: () => Promise<() => void>;
    } = {},
  ): Promise<
    Readonly<{ session: EditorSession; observerErrors: readonly unknown[] }>
  > {
    this.#assertAvailable();
    if (options.source && options.savedPath != null)
      throw new TypeError("Provide a project source or native path, not both.");
    const source = options.recovered
      ? null
      : options.source
        ? projectSource(options.source)
        : options.savedPath != null
          ? projectSource({ kind: "native-file", path: options.savedPath })
          : null;
    const savedPath = source?.kind === "native-file" ? source.path : null;
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
        // Imported browser names never imply a confirmed native save receipt.
        initiallySaved: !options.recovered && source?.kind !== "browser-file",
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
    let release: (() => void) | undefined;
    try {
      if (options.beforeInstall) release = await options.beforeInstall();
      if (this.#closed || options.signal?.aborted)
        throw new ProjectDecodingError(
          "canceled",
          "workspace",
          "Workspace closed before project installation.",
        );
    } catch (error) {
      this.#publishing = false;
      release?.();
      session.dispose();
      throw error;
    }
    try {
      this.state.set(
        Object.freeze({
          session,
          generation: previous.generation + 1,
          source,
          savedPath,
          recovered: options.recovered ?? null,
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
      release?.();
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
        this.state.set(
          Object.freeze({
            ...previous,
            source: projectSource({ kind: "native-file", path }),
            savedPath: path,
            recovered: null,
          }),
        );
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
