import { encodeAgentExportSnapshot } from "../domain/agent-export.ts";
import { projectDisplayName, type NativeFileHandle } from "./persistence.ts";
import { projectDownloadName } from "./project-files.ts";
import { Store } from "./store.ts";
import type { EditorWorkspace } from "./workspace.ts";

export interface AgentExportBridge {
  readonly kind?: "native";
  readonly available: boolean;
  choose(
    protectedPath: string | null,
    suggestedName: string,
  ): Promise<NativeFileHandle | null>;
  prepare(token: string, bytes: Uint8Array): Promise<void>;
  commit(token: string): Promise<string | null>;
  cancel(token: string): Promise<void>;
}
/** A download request is not a native file grant or a durable-save receipt. */
export interface BrowserAgentExportBridge {
  readonly kind: "browser";
  readonly available: boolean;
  /** Synchronous handoff; the browser owns completion/cancellation afterward. */
  download(filename: string, bytes: Uint8Array): void;
}
export type AgentExportTransport = AgentExportBridge | BrowserAgentExportBridge;

export function agentExportDownloadName(name: string | null): string {
  return projectDownloadName(name).replace(/\.tilewright$/, ".agent-map.json");
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
  readonly bridge: AgentExportTransport;
  #encode: typeof encodeAgentExportSnapshot;
  #busy = false;
  #closed = false;
  #canceled = false;
  constructor(
    workspace: EditorWorkspace,
    bridge: AgentExportTransport,
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
        "Export for Agent is not available on this platform.",
        false,
        false,
        true,
      );
      return false;
    }
    this.#busy = true;
    this.#canceled = false;
    const bridge = this.bridge;
    const browser = bridge.kind === "browser";
    let file: NativeFileHandle | null = null;
    let committed = false;
    let result = false;
    let message = browser
      ? "Export canceled. No download was requested."
      : "Export canceled. No output file was changed.";
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
      const displayName =
        projectDisplayName(before.source) ??
        before.recovered?.displayName ??
        "Untitled";
      if (bridge.kind !== "browser") {
        this.#publish("Choose an agent map JSON destination…", true);
        file = await bridge.choose(
          before.savedPath,
          `${displayName.replace(/\.tilewright$/i, "")}.agent-map.json`,
        );
        if (!file) return false;
        // Native code additionally checks canonical paths and filesystem identity.
        if (file.path === before.savedPath || !/\.json$/i.test(file.path))
          throw new Error(
            "Choose a separate .json file; the active project cannot be replaced by an export.",
          );
      }
      check();
      const cancelHint = browser ? " Cancel before download starts." : "";
      this.#publish(`Encoding the whole map…${cancelHint}`, true, true);
      const bytes = await this.#encode(snapshot, {
        signal,
        onProgress: (bytes) => {
          if (!signal.aborted)
            this.#publish(
              `Encoding the whole map… ${Math.ceil(bytes / 1024).toLocaleString()} KiB encoded.${cancelHint}`,
              true,
              true,
            );
        },
      });
      check();
      if (bridge.kind === "browser") {
        const filename = agentExportDownloadName(displayName);
        this.#publish(
          "Starting agent map download… Manage or cancel it in your browser after handoff.",
          true,
        );
        check();
        bridge.download(filename, bytes);
        committed = true;
        result = true;
        message = `Agent map download requested: ${filename}. Check your browser downloads; saving to disk is not confirmed. Manage or cancel the download in your browser.`;
        return result;
      }
      if (!file) throw new Error("No agent export destination selected.");
      this.#publish(
        `Writing ${Math.ceil(bytes.byteLength / 1024).toLocaleString()} KiB to a temporary file…`,
        true,
        true,
      );
      await bridge.prepare(file.token, bytes);
      check();
      // Cancellation closes before the atomic commit is requested; never claim a
      // canceled export after a complete file has already replaced the destination.
      this.#publish("Finishing export…", true);
      const warning = await bridge.commit(file.token);
      committed = true;
      result = true;
      message = `Exported the whole map to ${file.path}.${warning ? ` ${warning}` : ""}`;
    } catch (error) {
      if (!signal.aborted) {
        failed = true;
        message = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (file && !committed && bridge.kind !== "browser") {
        try {
          await bridge.cancel(file.token);
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
