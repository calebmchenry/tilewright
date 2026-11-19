import { encodeProjectSnapshot } from "../domain/project.ts";
import type { EditorSession, KeyInput } from "./session.ts";
import { Store } from "./store.ts";
import type { EditorWorkspace } from "./workspace.ts";

export interface ProjectFileHandle {
  readonly token: string;
  readonly path: string;
}
/** Native code alone issues handles from the file picker. No arbitrary path I/O. */
export interface ProjectFileBridge {
  readonly available: boolean;
  choose(save: boolean, current?: string): Promise<ProjectFileHandle | null>;
  read(token: string): Promise<Uint8Array>;
  write(token: string, bytes: Uint8Array): Promise<string | null>;
}
export interface ProjectFileState {
  readonly busy: boolean;
  readonly error: boolean;
  readonly message: string;
}

export class ProjectFiles {
  readonly state = new Store<ProjectFileState>({
    busy: false,
    error: false,
    message: "",
  });
  readonly workspace: EditorWorkspace;
  readonly bridge: ProjectFileBridge;
  #closed = false;
  #busy = false;
  #association: { session: EditorSession; file: ProjectFileHandle } | null =
    null;

  constructor(workspace: EditorWorkspace, bridge: ProjectFileBridge) {
    this.workspace = workspace;
    this.bridge = bridge;
  }
  get available() {
    return this.bridge.available && !this.#closed;
  }
  dispose() {
    this.#closed = true;
  }
  #publish(state: ProjectFileState) {
    // A failing view subscriber cannot turn a completed disk write into failure.
    try {
      this.state.set(Object.freeze(state));
    } catch {
      /* store already published */
    }
  }
  async #run(action: () => Promise<string | null>): Promise<boolean> {
    if (this.#busy || this.#closed) return false;
    if (!this.available) {
      this.#publish({
        busy: false,
        error: true,
        message:
          "Local project files are available in the Tilewright desktop app.",
      });
      return false;
    }
    const before = this.state.getSnapshot();
    this.#busy = true;
    this.#publish({
      busy: true,
      error: false,
      message: "Working with project file…",
    });
    try {
      const message = await action();
      this.#publish(
        message === null
          ? { ...before, busy: false }
          : { busy: false, error: false, message },
      );
      return message !== null;
    } catch (error) {
      this.#publish({
        busy: false,
        error: true,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.#busy = false;
    }
  }
  /** Caller confirms discarding unsaved work before invoking Open. */
  open(): Promise<boolean> {
    return this.#run(async () => {
      const before = this.workspace.state.getSnapshot();
      const session = before.session;
      const version = session.document.version;
      const active = session.activeLayer.getSnapshot();
      const hidden = session.hiddenLayers.getSnapshot();
      const history = session.history.state;
      const check = () => {
        if (
          this.#closed ||
          this.workspace.state.getSnapshot() !== before ||
          session.document.version !== version ||
          session.activeLayer.getSnapshot() !== active ||
          session.hiddenLayers.getSnapshot() !== hidden ||
          session.history.state.savedRevision !== history.savedRevision ||
          session.history.state.recoveryRevision !== history.recoveryRevision
        )
          throw new Error(
            "The workspace changed while opening. Open the project again to replace the current map.",
          );
      };
      const file = await this.bridge.choose(false);
      if (!file) return null;
      check();
      const bytes = await this.bridge.read(file.token);
      check();
      const owner = this;
      const result = await this.workspace.openProject(bytes, {
        savedPath: file.path,
        signal: {
          get aborted() {
            return owner.#closed;
          },
        },
      });
      this.#association = { session: result.session, file };
      return `Opened ${file.path}.${result.observerErrors.length ? " Some interface observers failed; reopen the app if the view is stale." : ""}`;
    });
  }
  save(as = false): Promise<boolean> {
    return this.#run(async () => {
      const before = this.workspace.state.getSnapshot();
      const session = before.session;
      // Capture before the first await, even the native picker. Edits made during
      // the dialog or write are a later revision and remain unsaved.
      const snapshot = session.captureProjectSnapshot();
      const existing =
        this.#association?.session === session &&
        this.#association.file.path === before.savedPath
          ? this.#association.file
          : null;
      const file =
        !as && existing
          ? existing
          : await this.bridge.choose(true, existing?.token);
      if (!file) return null;
      const owner = this;
      const signal = {
        get aborted() {
          return (
            owner.#closed ||
            owner.workspace.state.getSnapshot().session !== session
          );
        },
      };
      if (signal.aborted)
        throw new Error("The workspace changed. Save the current map again.");
      const bytes = await encodeProjectSnapshot(snapshot, { signal });
      const warning = await this.bridge.write(file.token, bytes);
      if (
        this.#closed ||
        this.workspace.state.getSnapshot().session !== session
      )
        return `Saved the earlier map to ${file.path}. The current map was not marked saved.${warning ? ` ${warning}` : ""}`;
      const errors = this.workspace.acknowledgeProjectSave(
        session,
        file.path,
        snapshot.checkpoint,
      );
      this.#association = { session, file };
      return `Saved ${file.path}.${warning ? ` ${warning}` : ""}${errors.length ? " Some interface observers failed; the file was saved." : ""}`;
    });
  }
  routeKey(input: KeyInput, open: () => void): boolean {
    if (
      input.defaultPrevented ||
      input.isComposing ||
      input.altKey ||
      !(input.metaKey || input.ctrlKey)
    )
      return false;
    const key = input.key.toLowerCase();
    if (key === "s") {
      void this.save(!!input.shiftKey);
      return true;
    }
    if (key === "o" && !input.shiftKey) {
      if (!this.#busy) open();
      return true;
    }
    return false;
  }
}
