import {
  copyCommand,
  replayCommands,
  type DocumentCommand,
} from "./commands.ts";
import {
  MapDocument,
  type MutationResult,
  type PrimitiveChange,
  type PreparedTiles,
  type DocumentChange,
} from "./document.ts";

export interface HistoryLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
}
export const DEFAULT_HISTORY_LIMITS: HistoryLimits = Object.freeze({
  maxEntries: 100,
  maxBytes: 64 * 1024 * 1024,
});
interface Entry {
  readonly label: string;
  readonly before: number;
  readonly after: number;
  readonly changes: readonly PrimitiveChange[];
  readonly bytes: number;
}
/** An opaque per-controller token; capture before encoding and acknowledge on I/O success. */
export interface RevisionCheckpoint {
  readonly revision: number;
}
export interface HistoryState {
  readonly revision: number;
  readonly savedRevision: number | null;
  readonly recoveryRevision: number | null;
  readonly dirty: boolean;
  readonly undoSteps: number;
  readonly redoSteps: number;
  readonly retainedBytes: number;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
}

export class CommandHistory {
  readonly document: MapDocument;
  readonly limits: HistoryLimits;
  #entries: Entry[] = [];
  #cursor = 0;
  #revision = 0;
  #nextRevision = 1;
  #saved: number | null;
  #recovery: number | null = null;
  #expectedVersion: number;
  #busy = false;
  #tokens = new WeakSet<RevisionCheckpoint>();
  #listeners = new Set<(state: HistoryState) => void>();

  constructor(
    document: MapDocument,
    options: { limits?: Partial<HistoryLimits>; initiallySaved?: boolean } = {},
  ) {
    this.document = document;
    this.#expectedVersion = document.version;
    this.#saved = options.initiallySaved ? 0 : null;
    this.limits = Object.freeze({
      ...DEFAULT_HISTORY_LIMITS,
      ...options.limits,
    });
    for (const value of Object.values(this.limits))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new RangeError("History limits must be positive safe integers.");
  }
  get state(): HistoryState {
    this.#checkVersion();
    return Object.freeze({
      revision: this.#revision,
      savedRevision: this.#saved,
      recoveryRevision: this.#recovery,
      dirty: this.#revision !== this.#saved,
      undoSteps: this.#cursor,
      redoSteps: this.#entries.length - this.#cursor,
      retainedBytes: this.#entries.reduce((n, entry) => n + entry.bytes, 0),
      undoLabel: this.#entries[this.#cursor - 1]?.label ?? null,
      redoLabel: this.#entries[this.#cursor]?.label ?? null,
    });
  }
  subscribe(listener: (state: HistoryState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  beginGesture(label: string): DocumentGesture {
    this.#checkIdle();
    return new DocumentGesture(this, label, this.#revision);
  }
  execute(label: string, commands: Iterable<DocumentCommand>): MutationResult {
    if (typeof label !== "string" || !label.trim())
      throw new TypeError("Command label must not be blank.");
    return this.#run(() =>
      this.document.applyCommands(commands, (change) => {
        this.#record(label, change);
      }),
    );
  }
  executePrepared(label: string, plan: PreparedTiles): MutationResult {
    if (typeof label !== "string" || !label.trim())
      throw new TypeError("Command label must not be blank.");
    return this.#run(() =>
      this.document.applyPreparedTiles(plan, (change) =>
        this.#record(label, change),
      ),
    );
  }
  #record(label: string, change: DocumentChange): void {
    if (change.kind !== "transaction")
      throw new Error("Expected a transaction.");
    // Accounting includes UTF-16 serialized payload plus conservative object/run
    // overhead. It is a deterministic budget, not a JavaScript heap measurement.
    const bytes =
      256 +
      2 * (JSON.stringify(change.changes).length + label.length) +
      change.changes.reduce(
        (n, part) => n + (part.kind === "tiles" ? 128 * part.runs.length : 128),
        0,
      );
    if (bytes > this.limits.maxBytes)
      throw new RangeError(
        "Transaction exceeds history byte limit; split the operation or raise the limit.",
      );
    const entry: Entry = Object.freeze({
      label,
      before: this.#revision,
      after: this.#nextRevision++,
      changes: change.changes,
      bytes,
    });
    this.#entries.splice(this.#cursor);
    this.#entries.push(entry);
    let retained = this.#entries.reduce((n, item) => n + item.bytes, 0);
    while (
      this.#entries.length > this.limits.maxEntries ||
      retained > this.limits.maxBytes
    )
      retained -= this.#entries.shift()!.bytes;
    this.#cursor = this.#entries.length;
    this.#revision = entry.after;
    this.#expectedVersion = change.version;
  }
  undo(): MutationResult {
    return this.#travel("undo");
  }
  redo(): MutationResult {
    return this.#travel("redo");
  }
  #travel(direction: "undo" | "redo"): MutationResult {
    return this.#run(() => {
      const entry =
        this.#entries[direction === "undo" ? this.#cursor - 1 : this.#cursor];
      if (!entry)
        return Object.freeze({
          change: null,
          observerErrors: Object.freeze([]),
        });
      return this.document.applyCommands(
        replayCommands(entry.changes, direction),
        (change) => {
          this.#cursor += direction === "undo" ? -1 : 1;
          this.#revision = direction === "undo" ? entry.before : entry.after;
          this.#expectedVersion = change.version;
        },
      );
    });
  }
  captureCheckpoint(): RevisionCheckpoint {
    this.#checkIdle();
    const token = Object.freeze({ revision: this.#revision });
    this.#tokens.add(token);
    return token;
  }
  markSaved(checkpoint: RevisionCheckpoint): readonly unknown[] {
    return this.#checkpoint(checkpoint, "saved");
  }
  markRecovery(checkpoint: RevisionCheckpoint): readonly unknown[] {
    return this.#checkpoint(checkpoint, "recovery");
  }
  #checkpoint(
    checkpoint: RevisionCheckpoint,
    kind: "saved" | "recovery",
  ): readonly unknown[] {
    this.#checkIdle();
    if (!this.#tokens.has(checkpoint))
      throw new TypeError(
        "Checkpoint belongs to another document or is forged.",
      );
    this.#busy = true;
    try {
      if (kind === "saved") this.#saved = checkpoint.revision;
      else this.#recovery = checkpoint.revision;
      return this.#notify();
    } finally {
      this.#busy = false;
    }
  }
  #run(action: () => MutationResult): MutationResult {
    this.#checkIdle();
    this.#busy = true;
    try {
      const result = action();
      if (!result.change) return result;
      return Object.freeze({
        change: result.change,
        observerErrors: Object.freeze([
          ...result.observerErrors,
          ...this.#notify(),
        ]),
      });
    } finally {
      this.#busy = false;
    }
  }
  #notify(): readonly unknown[] {
    const state = this.state,
      errors: unknown[] = [];
    for (const listener of [...this.#listeners])
      try {
        listener(state);
      } catch (error) {
        errors.push(error);
      }
    return Object.freeze(errors);
  }
  #checkVersion(): void {
    if (this.document.version !== this.#expectedVersion)
      throw new Error(
        "Document changed outside command history. Create a new history after loading.",
      );
  }
  #checkIdle(): void {
    if (this.#busy)
      throw new Error("Reentrant history mutation is not allowed.");
    this.#checkVersion();
  }
}

/** Stage a gesture over many input events; previews belong to the tool/renderer. */
export class DocumentGesture {
  #history: CommandHistory;
  #label: string;
  #base: number;
  #commands: DocumentCommand[] | null = [];
  constructor(history: CommandHistory, label: string, revision: number) {
    if (typeof label !== "string" || !label.trim())
      throw new TypeError("Command label must not be blank.");
    this.#history = history;
    this.#label = label;
    this.#base = revision;
  }
  append(command: DocumentCommand): this {
    if (!this.#commands) throw new Error("Gesture is closed.");
    this.#commands.push(copyCommand(command));
    return this;
  }
  cancel(): void {
    this.#commands = null;
  }
  commit(): MutationResult {
    const commands = this.#commands;
    if (!commands) throw new Error("Gesture is closed.");
    this.#commands = null;
    if (this.#history.state.revision !== this.#base)
      throw new Error("Gesture is stale after another edit or undo.");
    return this.#history.execute(this.#label, commands);
  }
}
