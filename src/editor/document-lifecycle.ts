import {
  selectionFor,
  validateRecoveryBytes,
  type RecoveryMetadata,
  type RecoveryReviewBridge,
} from "./recovery-discovery.ts";
import type { SavedContext } from "./recovery.ts";
import { newMapBounds } from "../domain/canvas.ts";
import type { AgentExports } from "./agent-export.ts";
import type { BrowserProjectFile, ProjectFiles } from "./project-files.ts";
import { Store } from "./store.ts";

export type DocumentAction = "new" | "open" | "close" | "restore";
export type UnsavedChoice = "save" | "discard" | "cancel";
export interface LifecycleState {
  readonly busy: boolean;
  readonly action: DocumentAction | "save" | "export" | null;
  readonly prompt: DocumentAction | null;
  readonly error: string;
}

/** Single application entry point for file actions and destructive transitions. */
export class DocumentLifecycle {
  readonly files: ProjectFiles;
  readonly agentExport?: AgentExports;
  readonly state = new Store<LifecycleState>({
    busy: false,
    action: null,
    prompt: null,
    error: "",
  });
  #closed = false;
  #busy = false;
  #answer: ((choice: UnsavedChoice) => void) | null = null;

  constructor(files: ProjectFiles, agentExport?: AgentExports) {
    this.files = files;
    this.agentExport = agentExport;
  }

  #publish(state: LifecycleState) {
    try {
      this.state.set(Object.freeze(state));
    } catch {
      /* already published */
    }
  }

  choose(choice: UnsavedChoice): void {
    const answer = this.#answer;
    this.#answer = null;
    this.#publish({ ...this.state.getSnapshot(), prompt: null });
    answer?.(choice);
  }

  dispose(): void {
    this.#closed = true;
    this.choose("cancel");
  }

  async #run(
    action: DocumentAction | "save" | "export",
    task: () => Promise<boolean>,
  ) {
    // Never queue a destructive request against a document that may be replaced
    // by an earlier request. Native close remains prevented and can be retried.
    if (
      this.#closed ||
      this.#busy ||
      this.files.state.getSnapshot().busy ||
      this.agentExport?.state.getSnapshot().busy
    )
      return false;
    this.#busy = true;
    const resume =
      action === "export" ? undefined : this.files.recovery?.pause();
    this.#publish({ busy: true, action, prompt: null, error: "" });
    let error = "";
    try {
      return await task();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      return false;
    } finally {
      this.#busy = false;
      this.#publish({ busy: false, action: null, prompt: null, error });
      resume?.();
    }
  }

  async #protect(action: DocumentAction): Promise<(() => void) | null> {
    const before = this.files.workspace.state.getSnapshot();
    const session = before.session;
    const version = session.document.version;
    const active = session.activeLayer.getSnapshot();
    const hidden = session.hiddenLayers.getSnapshot();
    const current = () =>
      !this.#closed &&
      this.files.workspace.state.getSnapshot().session === session;
    const permission = () => {
      const approvedVersion = session.document.version;
      const savedRevision = session.history.state.savedRevision;
      const approvedActive = session.activeLayer.getSnapshot();
      const approvedHidden = session.hiddenLayers.getSnapshot();
      return () => {
        if (
          !current() ||
          session.document.version !== approvedVersion ||
          session.activeLayer.getSnapshot() !== approvedActive ||
          session.hiddenLayers.getSnapshot() !== approvedHidden ||
          session.history.state.savedRevision !== savedRevision
        )
          throw new Error(
            "The map changed before the action completed. Try again to review the latest changes.",
          );
      };
    };
    if (!session.history.state.dirty) return permission();
    const choice = await new Promise<UnsavedChoice>((resolve) => {
      this.#answer = resolve;
      this.#publish({ busy: true, action, prompt: action, error: "" });
    });
    if (choice === "cancel" || !current()) return null;
    if (
      session.document.version !== version ||
      session.activeLayer.getSnapshot() !== active ||
      session.hiddenLayers.getSnapshot() !== hidden
    )
      throw new Error(
        "The map changed while deciding. Try the action again to review the latest changes.",
      );
    if (choice === "discard") return permission();
    if (!(await this.files.save()) || !current()) return null;
    // A download is only a request. Never treat it as saved or as permission
    // to discard, even if no edits arrived while encoding.
    if (this.files.browser) return null;
    if (session.history.state.dirty)
      throw new Error(
        "New edits were made while saving. They are still unsaved; try the action again to keep them.",
      );
    return permission();
  }

  exportForAgent(): Promise<boolean> {
    return this.#run(
      "export",
      () => this.agentExport?.export() ?? Promise.resolve(false),
    );
  }

  save(as = false): Promise<boolean> {
    return this.#run("save", () => this.files.save(as));
  }

  newMap(width: number, height: number): Promise<boolean> {
    return this.#run("new", async () => {
      newMapBounds(width, height); // Reject invalid dimensions before any save.
      const proceed = await this.#protect("new");
      if (!proceed) return false;
      proceed();
      const prepared = this.files.workspace.prepareMap(width, height);
      const session = this.files.workspace.state.getSnapshot().session;
      const release = session.document.holdEdits();
      try {
        await this.files.recovery?.resolve(session.history.state.dirty);
        prepared.install();
        return true;
      } finally {
        release();
        prepared.dispose();
      }
    });
  }

  open(dropped?: readonly BrowserProjectFile[]): Promise<boolean> {
    return this.#run("open", async () => {
      const bridge = this.files.bridge;
      if (bridge.kind === "browser") {
        const check = this.files.guardOpen();
        // The picker launches before the first await, on the original user
        // gesture. Selecting a file does not authorize replacing this document.
        const selected = dropped ?? (await bridge.choose());
        if (!selected) return false;
        check();
        const file = this.files.browserFile(selected);
        const proceed = await this.#protect("open");
        if (!proceed) return false;
        return this.files.importBrowserFile(file, () => {
          check();
          proceed();
        });
      }
      if (!this.files.available) return this.files.open();
      const proceed = await this.#protect("open");
      if (!proceed) return false;
      proceed();
      return this.files.open(proceed);
    });
  }

  restore(
    metadata: RecoveryMetadata,
    saved: SavedContext | null,
    bridge: RecoveryReviewBridge,
  ): Promise<boolean> {
    return this.#run("restore", async () => {
      const selection = selectionFor(metadata);
      const bytes = await bridge.read(selection);
      await validateRecoveryBytes(bytes, metadata);
      const proceed = await this.#protect("restore");
      if (!proceed) return false;
      proceed();
      const recovered = {
        documentId: metadata.documentId,
        writerId: globalThis.crypto.randomUUID(),
        saved,
        displayName: metadata.displayName,
        capturedAt: metadata.capturedAt,
      };
      const owner = this;
      let claimed = false;
      try {
        await this.files.workspace.openProject(bytes, {
          recovered,
          signal: {
            get aborted() {
              return owner.#closed;
            },
          },
          beforeInstall: async () => {
            proceed();
            const session = this.files.workspace.state.getSnapshot().session;
            const release = session.document.holdEdits();
            try {
              await bridge.claim(selection, recovered.writerId);
              claimed = true;
              await this.files.recovery?.resolve(session.history.state.dirty);
              return release;
            } catch (error) {
              release();
              throw error;
            }
          },
        });
        return true;
      } catch (error) {
        if (claimed)
          await bridge.release(recovered.documentId, recovered.writerId);
        throw error;
      }
    });
  }

  close(finish: () => Promise<void>): Promise<boolean> {
    return this.#run("close", async () => {
      const proceed = await this.#protect("close");
      if (!proceed) return false;
      proceed();
      const session = this.files.workspace.state.getSnapshot().session;
      const release = session.document.holdEdits();
      try {
        await this.files.recovery?.resolve(session.history.state.dirty);
        await finish();
        this.#closed = true;
        return true;
      } finally {
        release();
      }
    });
  }
}
