import { newMapBounds } from "../domain/canvas.ts";
import type { ProjectFiles } from "./project-files.ts";
import { Store } from "./store.ts";

export type DocumentAction = "new" | "open" | "close";
export type UnsavedChoice = "save" | "discard" | "cancel";
export interface LifecycleState {
  readonly busy: boolean;
  readonly action: DocumentAction | "save" | null;
  readonly prompt: DocumentAction | null;
  readonly error: string;
}

/** Single application entry point for file actions and destructive transitions. */
export class DocumentLifecycle {
  readonly files: ProjectFiles;
  readonly state = new Store<LifecycleState>({
    busy: false,
    action: null,
    prompt: null,
    error: "",
  });
  #closed = false;
  #busy = false;
  #answer: ((choice: UnsavedChoice) => void) | null = null;

  constructor(files: ProjectFiles) {
    this.files = files;
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

  async #run(action: DocumentAction | "save", task: () => Promise<boolean>) {
    // Never queue a destructive request against a document that may be replaced
    // by an earlier request. Native close remains prevented and can be retried.
    if (this.#closed || this.#busy || this.files.state.getSnapshot().busy)
      return false;
    this.#busy = true;
    const resume = this.files.recovery?.pause();
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
    const current = () =>
      !this.#closed &&
      this.files.workspace.state.getSnapshot().session === session;
    const permission = () => {
      const approvedVersion = session.document.version;
      const savedRevision = session.history.state.savedRevision;
      return () => {
        if (
          !current() ||
          session.document.version !== approvedVersion ||
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
    if (session.document.version !== version)
      throw new Error(
        "The map changed while deciding. Try the action again to review the latest changes.",
      );
    if (choice === "discard") return permission();
    if (!(await this.files.save()) || !current()) return null;
    if (session.history.state.dirty)
      throw new Error(
        "New edits were made while saving. They are still unsaved; try the action again to keep them.",
      );
    return permission();
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

  open(): Promise<boolean> {
    return this.#run("open", async () => {
      if (!this.files.available) return this.files.open();
      const proceed = await this.#protect("open");
      if (!proceed) return false;
      proceed();
      return this.files.open(proceed);
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
