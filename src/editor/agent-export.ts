import { encodeAgentExportSnapshot } from "../domain/agent-export.ts";
import type { ProjectFileHandle } from "./project-files.ts";
import { Store } from "./store.ts";
import type { EditorWorkspace } from "./workspace.ts";

export interface AgentExportBridge {
  readonly available: boolean;
  choose(
    protectedPath: string | null,
    suggestedName: string,
  ): Promise<ProjectFileHandle | null>;
  prepare(token: string, bytes: Uint8Array): Promise<void>;
  commit(token: string): Promise<string | null>;
  cancel(token: string): Promise<void>;
}
export interface AgentExportState {
  readonly busy: boolean;
  readonly cancelable: boolean;
  readonly error: boolean;
  readonly message: string;
}
/** Export owns no save/recovery checkpoint or project-file association. */
export class AgentExports {
  readonly state = new Store<AgentExportState>({
    busy: false,
    cancelable: false,
    error: false,
    message: "",
  });
  readonly workspace: EditorWorkspace;
  readonly bridge: AgentExportBridge;
  #encode: typeof encodeAgentExportSnapshot;
  #busy = false;
  #closed = false;
  #canceled = false;
  constructor(
    workspace: EditorWorkspace,
    bridge: AgentExportBridge,
    options: { encode?: typeof encodeAgentExportSnapshot } = {},
  ) {
    this.workspace = workspace;
    this.bridge = bridge;
    this.#encode = options.encode ?? encodeAgentExportSnapshot;
  }
  get available() {
    return this.bridge.available && !this.#closed;
  }
  #publish(message: string, busy: boolean, cancelable = false, error = false) {
    try {
      this.state.set(Object.freeze({ message, busy, cancelable, error }));
    } catch {
      /* A broken view must not turn a committed export into a failure. */
    }
  }
  cancel() {
    if (!this.state.getSnapshot().cancelable) return;
    this.#canceled = true;
    this.#publish(
      "Canceling export… Waiting for pending work to finish safely.",
      true,
    );
  }
  dispose() {
    this.#closed = true;
    this.cancel();
  }
  async export(): Promise<boolean> {
    if (this.#closed || this.#busy) return false;
    if (!this.available) {
      this.#publish(
        "Export for Agent requires the Tilewright desktop app.",
        false,
        false,
        true,
      );
      return false;
    }
    this.#busy = true;
    this.#canceled = false;
    let file: ProjectFileHandle | null = null;
    let committed = false;
    let result = false;
    let message = "Export canceled. No output file was changed.";
    let failed = false;
    const before = this.workspace.state.getSnapshot();
    const owner = this;
    const signal = {
      get aborted() {
        return (
          owner.#canceled ||
          owner.#closed ||
          owner.workspace.state.getSnapshot().session !== before.session
        );
      },
    };
    const check = () => {
      if (signal.aborted) throw new Error("Export canceled");
    };
    this.#publish("Capturing the whole map…", true, true);
    try {
      // Capture once, before the picker/async work, including unsaved committed edits.
      const snapshot = before.session.captureAgentExportSnapshot();
      const name = (
        before.savedPath?.split("/").pop() ??
        before.recovered?.displayName ??
        "Untitled"
      ).replace(/\.tilewright$/i, "");
      this.#publish("Choose an agent map JSON destination…", true);
      file = await this.bridge.choose(
        before.savedPath,
        `${name}.agent-map.json`,
      );
      if (!file) return false;
      check();
      // Native code additionally checks canonical paths and filesystem identity.
      if (file.path === before.savedPath || !/\.json$/i.test(file.path))
        throw new Error(
          "Choose a separate .json file; the active project cannot be replaced by an export.",
        );
      this.#publish("Encoding the whole map…", true, true);
      const bytes = await this.#encode(snapshot, {
        signal,
        onProgress: (bytes) => {
          if (!signal.aborted)
            this.#publish(
              `Encoding the whole map… ${Math.ceil(bytes / 1024).toLocaleString()} KiB encoded.`,
              true,
              true,
            );
        },
      });
      check();
      this.#publish(
        `Writing ${Math.ceil(bytes.byteLength / 1024).toLocaleString()} KiB to a temporary file…`,
        true,
        true,
      );
      await this.bridge.prepare(file.token, bytes);
      check();
      // Cancellation closes before the atomic commit is requested; never claim a
      // canceled export after a complete file has already replaced the destination.
      this.#publish("Finishing export…", true);
      const warning = await this.bridge.commit(file.token);
      committed = true;
      result = true;
      message = `Exported the whole map to ${file.path}.${warning ? ` ${warning}` : ""}`;
    } catch (error) {
      if (!signal.aborted) {
        failed = true;
        message = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (file && !committed) {
        try {
          await this.bridge.cancel(file.token);
        } catch (error) {
          failed = true;
          message += ` Temporary export cleanup failed: ${String(error)}. The temporary file is not a completed export.`;
        }
      }
      this.#busy = false;
      this.#publish(message, false, false, failed);
    }
    return result;
  }
}
