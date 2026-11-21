import { encodeProjectSnapshot } from "../domain/project.ts";
import {
  PROJECT_LIMITS,
  type ProjectPreferences,
} from "../domain/project-format.ts";
import type { EditorSession } from "./session.ts";
import type { RecoveryCoordinator } from "./recovery.ts";
import { Store } from "./store.ts";
import type { EditorWorkspace } from "./workspace.ts";
import {
  projectDisplayName,
  type NativeFileHandle,
  type NativeSaveCheckpoint,
  type PersistenceCheckpoint,
} from "./persistence.ts";

/** Native picker grant, not a browser File or display filename. */
export type ProjectFileHandle = NativeFileHandle;
/** Native code alone issues handles from the file picker. No arbitrary path I/O. */
export interface ProjectFileBridge {
  readonly kind?: "native";
  readonly available: boolean;
  choose(
    save: boolean,
    current?: string,
    suggestedName?: string,
  ): Promise<ProjectFileHandle | null>;
  read(token: string): Promise<Uint8Array>;
  write(token: string, bytes: Uint8Array): Promise<string | null>;
}
/** Structural File contract keeps DOM dependencies out of the shared controller. */
export interface BrowserProjectFile {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface BrowserProjectFileBridge {
  readonly kind: "browser";
  readonly available: boolean;
  /** Must launch synchronously on invocation, before any await. */
  choose(): Promise<readonly BrowserProjectFile[] | null>;
  cancelPick(): void;
  download(filename: string, bytes: Uint8Array): void;
}
export type ProjectFileTransport = ProjectFileBridge | BrowserProjectFileBridge;

export function projectDownloadName(name: string | null): string {
  const stem = (name ?? "Untitled")
    .replace(/\.(tilewright|json)$/i, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  return `${Array.from(stem).slice(0, 180).join("") || "Untitled"}.tilewright`;
}
export interface ProjectFileState {
  readonly busy: boolean;
  readonly error: boolean;
  readonly message: string;
}

export interface BrowserProjectStatus {
  /** null until a project snapshot has actually been handed to the browser. */
  readonly changesSinceDownload: boolean | null;
  /** A requested download is not evidence that this work exists on disk. */
  readonly workAtRisk: boolean;
}

export class ProjectFiles {
  readonly lastDownload = new Store<
    | (Extract<PersistenceCheckpoint, { kind: "browser-download-request" }> & {
        readonly session: EditorSession;
        readonly preferences: ProjectPreferences;
      })
    | null
  >(null);
  readonly browserStatus = new Store<BrowserProjectStatus>({
    changesSinceDownload: null,
    workAtRisk: true,
  });
  readonly lastSave = new Store<
    (NativeSaveCheckpoint & { readonly session: EditorSession }) | null
  >(null);
  readonly state = new Store<ProjectFileState>({
    busy: false,
    error: false,
    message: "",
  });
  readonly workspace: EditorWorkspace;
  readonly bridge: ProjectFileTransport;
  readonly recovery?: RecoveryCoordinator;
  #closed = false;
  #encode: typeof encodeProjectSnapshot;
  #busy = false;
  #unsubscribe: () => void;
  #sessionSubscriptions: (() => void)[] = [];
  #statusSession: EditorSession | null = null;
  #association: { session: EditorSession; file: ProjectFileHandle } | null =
    null;

  constructor(
    workspace: EditorWorkspace,
    bridge: ProjectFileTransport,
    recovery?: RecoveryCoordinator,
    options: { encode?: typeof encodeProjectSnapshot } = {},
  ) {
    this.workspace = workspace;
    this.recovery = recovery;
    this.bridge = bridge;
    this.#encode = options.encode ?? encodeProjectSnapshot;
    this.#unsubscribe = workspace.state.subscribe(() => {
      if (
        this.lastDownload.getSnapshot()?.session !==
        workspace.state.getSnapshot().session
      )
        this.lastDownload.set(null);
      if (
        this.lastSave.getSnapshot()?.session !==
        workspace.state.getSnapshot().session
      )
        this.lastSave.set(null);
      if (this.#association?.session !== workspace.state.getSnapshot().session)
        this.#association = null;
      this.#bindBrowserStatus();
    });
    this.#bindBrowserStatus();
  }
  #bindBrowserStatus() {
    if (!this.browser) return;
    const { session, source } = this.workspace.state.getSnapshot();
    if (session === this.#statusSession) return;
    this.#sessionSubscriptions.forEach((stop) => stop());
    this.#statusSession = session;
    // Import is a known local source copy, not a native saved checkpoint. Keep
    // only revision/preferences here, never another copy of the full map.
    const importedRevision =
      source?.kind === "browser-file" ? session.history.state.revision : null;
    const importedPreferences: ProjectPreferences = {
      activeLayerId: session.activeLayer.getSnapshot(),
      hiddenLayerIds: [...session.hiddenLayers.getSnapshot()],
    };
    const matches = (
      revision: number | null,
      preferences: ProjectPreferences,
    ) =>
      session.historyState.getSnapshot().revision === revision &&
      session.activeLayer.getSnapshot() === preferences.activeLayerId &&
      session.hiddenLayers.getSnapshot().length ===
        preferences.hiddenLayerIds.length &&
      session.hiddenLayers
        .getSnapshot()
        .every((id) => preferences.hiddenLayerIds.includes(id));
    const refresh = () => {
      const download = this.lastDownload.getSnapshot();
      const next: BrowserProjectStatus = {
        changesSinceDownload:
          download?.session === session
            ? !matches(download.checkpoint.revision, download.preferences)
            : null,
        workAtRisk: !matches(importedRevision, importedPreferences),
      };
      const previous = this.browserStatus.getSnapshot();
      if (
        next.changesSinceDownload !== previous.changesSinceDownload ||
        next.workAtRisk !== previous.workAtRisk
      )
        this.browserStatus.set(Object.freeze(next));
    };
    this.#sessionSubscriptions = [
      session.historyState,
      session.activeLayer,
      session.hiddenLayers,
      this.lastDownload,
    ].map((store) => store.subscribe(refresh));
    refresh();
  }
  get available() {
    return this.bridge.available && !this.#closed;
  }
  get browser() {
    return this.bridge.kind === "browser";
  }
  dispose() {
    this.#closed = true;
    if (this.bridge.kind === "browser") this.bridge.cancelPick();
    this.#association = null;
    this.#unsubscribe();
    this.#sessionSubscriptions.forEach((stop) => stop());
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
    const resume = this.recovery?.pause();
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
      resume?.();
    }
  }
  /** Covers picker/read time; EditorWorkspace repeats these guards during decode. */
  guardOpen(): () => void {
    const before = this.workspace.state.getSnapshot();
    const session = before.session;
    const version = session.document.version;
    const active = session.activeLayer.getSnapshot();
    const hidden = session.hiddenLayers.getSnapshot();
    const history = session.history.state;
    return () => {
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
  }
  /** Picker and drop converge here, before unsaved-work approval or reading. */
  browserFile(files: readonly BrowserProjectFile[]): BrowserProjectFile {
    if (files.length !== 1)
      throw new Error(
        "Open one .tilewright project at a time. Folders and multiple files are not supported.",
      );
    const file = files[0];
    if (!file.name.trim() || !Number.isSafeInteger(file.size) || file.size < 1)
      throw new Error(
        "Choose a nonempty .tilewright project file. Folders and empty files are not supported.",
      );
    if (file.size > PROJECT_LIMITS.maxBytes)
      throw new Error("Project files must be no larger than 256 MiB.");
    return file;
  }
  importBrowserFile(
    file: BrowserProjectFile,
    checkTransition: () => void,
  ): Promise<boolean> {
    return this.#run(async () => {
      if (!this.browser) throw new Error("Browser import is unavailable.");
      this.browserFile([file]);
      checkTransition();
      const name = file.name;
      const bytes = new Uint8Array(await file.arrayBuffer());
      checkTransition();
      const owner = this;
      const result = await this.workspace.openProject(bytes, {
        source: { kind: "browser-file", name },
        beforeInstall: this.recovery
          ? async () => {
              checkTransition();
              const session = this.workspace.state.getSnapshot().session;
              const release = session.document.holdEdits();
              try {
                await this.recovery!.resolve(session.history.state.dirty);
                return release;
              } catch (error) {
                release();
                throw error;
              }
            }
          : undefined,
        signal: {
          get aborted() {
            return owner.#closed;
          },
        },
      });
      return `Opened ${name}.${result.observerErrors.length ? " Some interface observers failed; reload the project if the view is stale." : ""}`;
    });
  }
  /** Caller confirms discarding unsaved work before invoking native Open. */
  open(checkTransition: () => void = () => {}): Promise<boolean> {
    return this.#run(async () => {
      const bridge = this.bridge;
      if (bridge.kind === "browser")
        throw new Error("Use the guarded browser Open action.");
      const session = this.workspace.state.getSnapshot().session;
      const check = this.guardOpen();
      const file = await bridge.choose(false);
      if (!file) return null;
      check();
      const bytes = await bridge.read(file.token);
      check();
      checkTransition();
      const owner = this;
      const result = await this.workspace.openProject(bytes, {
        source: { kind: "native-file", path: file.path },
        beforeInstall: this.recovery
          ? async () => {
              checkTransition();
              const release = session.document.holdEdits();
              try {
                await this.recovery!.resolve(session.history.state.dirty);
                return release;
              } catch (error) {
                release();
                throw error;
              }
            }
          : undefined,
        signal: {
          get aborted() {
            return owner.#closed;
          },
        },
      });
      this.#association = { session: result.session, file };
      if (this.recovery)
        await this.recovery.saved(
          result.session,
          file.path,
          bytes,
          result.session.captureProjectSnapshot(),
          true,
        );
      return `Opened ${file.path}.${result.observerErrors.length ? " Some interface observers failed; reopen the app if the view is stale." : ""}`;
    });
  }
  save(as = false): Promise<boolean> {
    if (this.browser) return this.download();
    return this.#run(async () => {
      const bridge = this.bridge;
      if (bridge.kind === "browser") return null;
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
          : await bridge.choose(
              true,
              existing?.token,
              before.recovered
                ? `${before.recovered.displayName.replace(/\.tilewright$/i, "")} (Recovered).tilewright`
                : undefined,
            );
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
      const bytes = await this.#encode(snapshot, { signal });
      const warning = await bridge.write(file.token, bytes);
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
      try {
        this.lastSave.set({
          kind: "native-save",
          session,
          path: file.path,
          checkpoint: snapshot.checkpoint,
          at: Date.now(),
        });
      } catch {
        /* A view observer cannot invalidate the completed save. */
      }
      await this.recovery?.saved(session, file.path, bytes, snapshot);
      return `Saved ${file.path}.${warning ? ` ${warning}` : ""}${errors.length ? " Some interface observers failed; the file was saved." : ""}`;
    });
  }
  download(): Promise<boolean> {
    return this.#run(async () => {
      const bridge = this.bridge;
      if (bridge.kind !== "browser")
        throw new Error("Browser download is unavailable.");
      const before = this.workspace.state.getSnapshot();
      const session = before.session;
      const snapshot = session.captureProjectSnapshot();
      const filename = projectDownloadName(projectDisplayName(before.source));
      const owner = this;
      const signal = {
        get aborted() {
          return (
            owner.#closed ||
            owner.workspace.state.getSnapshot().session !== session
          );
        },
      };
      const bytes = await this.#encode(snapshot, { signal });
      if (signal.aborted)
        throw new Error(
          "The workspace changed. Download the current map again.",
        );
      bridge.download(filename, bytes);
      try {
        this.lastDownload.set({
          kind: "browser-download-request",
          filename,
          checkpoint: snapshot.checkpoint,
          preferences: snapshot.project.editor,
          session,
          at: Date.now(),
        });
      } catch {
        /* An observer cannot undo a browser handoff. */
      }
      return `Download requested: ${filename}. Check your browser downloads; saving to disk is not confirmed. The current map stays open.`;
    });
  }
}
