import {
  encodeProjectSnapshot,
  type ProjectSnapshot,
} from "../domain/project.ts";
import type { EditorSession } from "./session.ts";
import { Store } from "./store.ts";
import type { EditorWorkspace } from "./workspace.ts";

export interface SavedContext {
  readonly path: string;
  readonly savedAt: number;
  readonly byteHash: string;
  readonly canonicalHash: string;
}
export interface RecoveryControl {
  readonly documentId: string;
  readonly writerId: string;
  readonly epoch: number;
  readonly status: "active" | "resolved" | "discarded";
  readonly saved: SavedContext | null;
}
export interface RecoveryCapture extends Omit<RecoveryControl, "status"> {
  readonly capturedAt: number;
  readonly historyRevision: number;
  readonly documentVersion: number;
  readonly savedRevision: number | null;
  readonly dirty: boolean;
  readonly displayName: string;
}
export interface RecoveryTicket {
  readonly documentId: string;
  readonly writerId: string;
  readonly epoch: number;
  readonly sequence: number;
}
export interface RecoveryBridge {
  readonly available: boolean;
  initialize(): Promise<void>;
  control(control: RecoveryControl): Promise<string | null>;
  prepare(capture: RecoveryCapture, bytes: Uint8Array): Promise<RecoveryTicket>;
  commit(ticket: RecoveryTicket): Promise<string | null>;
  cancel(ticket: RecoveryTicket): Promise<void>;
}
export interface RecoveryClock {
  now(): number;
  utc(): number;
  set(callback: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}
const clock: RecoveryClock = {
  now: () => performance.now(),
  utc: () => Date.now(),
  set: (callback, delay) => setTimeout(callback, delay),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
interface Lineage {
  session: EditorSession;
  documentId: string;
  writerId: string;
  epoch: number;
  saved: SavedContext | null;
  touched: boolean;
  revision: number;
  dirty: boolean;
  checkpoint: number | null;
  first: number | null;
  last: number;
  lastStart: number | null;
  lastCapture: number | null;
}
export interface RecoveryState {
  readonly pending: boolean;
  readonly lastCapture: number | null;
  readonly error: string;
  readonly warning: string;
}
export async function projectHash(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** One detached job, one coalesced request, and a serialized native publication lane. */
export class RecoveryCoordinator {
  readonly state = new Store<RecoveryState>({
    pending: false,
    lastCapture: null,
    error: "",
    warning: "",
  });
  readonly workspace: EditorWorkspace;
  readonly bridge: RecoveryBridge;
  #clock: RecoveryClock;
  #encode: typeof encodeProjectSnapshot;
  #lineage!: Lineage;
  #unsubscribe: () => void;
  #history = () => {};
  #closed = false;
  #paused = 0;
  #timer: unknown = null;
  #running = false;
  #lane: Promise<unknown> = Promise.resolve();
  #initialized = false;
  #retryAt = 0;
  #failures = 0;
  #blocked = false;

  constructor(
    workspace: EditorWorkspace,
    bridge: RecoveryBridge,
    options: {
      clock?: RecoveryClock;
      encode?: typeof encodeProjectSnapshot;
    } = {},
  ) {
    this.workspace = workspace;
    this.bridge = bridge;
    this.#clock = options.clock ?? clock;
    this.#encode = options.encode ?? encodeProjectSnapshot;
    this.#bind();
    this.#unsubscribe = workspace.state.subscribe(() => {
      if (workspace.state.getSnapshot().session !== this.#lineage.session)
        this.#bind();
    });
  }
  #bind() {
    this.#history();
    if (this.#lineage) this.#lineage.epoch++;
    const session = this.workspace.state.getSnapshot().session;
    const state = session.history.state;
    const now = this.#clock.now();
    this.#lineage = {
      session,
      documentId: globalThis.crypto.randomUUID(),
      writerId: globalThis.crypto.randomUUID(),
      epoch: 0,
      saved: null,
      touched: false,
      revision: state.revision,
      dirty: state.dirty,
      checkpoint: null,
      first: state.dirty ? now : null,
      last: now,
      lastStart: null,
      lastCapture: null,
    };
    this.#failures = 0;
    this.#retryAt = 0;
    this.#blocked = false;
    this.#history = session.history.subscribe(() => this.#changed());
    this.#publish("", "");
    this.#arm();
  }
  #publish(
    error = this.state.getSnapshot().error,
    warning = this.state.getSnapshot().warning,
  ) {
    try {
      this.state.set(
        Object.freeze({
          pending: this.#lineage.first !== null || this.#running,
          lastCapture: this.#lineage.lastCapture,
          error,
          warning,
        }),
      );
    } catch {
      /* already published */
    }
  }
  #enqueue<T>(action: () => Promise<T>): Promise<T> {
    const task = this.#lane.then(action);
    this.#lane = task.catch(() => {});
    return task;
  }
  async #initialize() {
    if (!this.#initialized) {
      await this.bridge.initialize();
      this.#initialized = true;
    }
  }
  #control(
    lineage: Lineage,
    status: RecoveryControl["status"],
  ): Promise<string | null> {
    const input: RecoveryControl = {
      documentId: lineage.documentId,
      writerId: lineage.writerId,
      epoch: lineage.epoch,
      status,
      saved: lineage.saved,
    };
    return this.#enqueue(async () => {
      await this.#initialize();
      lineage.touched = true; // even an ambiguous state-file sync failure needs resolution
      return this.bridge.control(input);
    });
  }
  #changed() {
    const l = this.#lineage,
      state = l.session.history.state;
    const changed = l.revision !== state.revision || l.dirty !== state.dirty;
    if (!changed) return; // acknowledgements and no-ops do not debounce
    l.revision = state.revision;
    l.dirty = state.dirty;
    if (this.#blocked) this.#retryAt = 0;
    this.#blocked = false;
    if (!state.dirty) {
      l.epoch++;
      l.first = null;
      l.checkpoint = null;
      if (l.touched && !this.#paused) {
        // History is still notifying: enqueue the lock/marker after that commit.
        const epoch = l.epoch;
        void this.#enqueue(async () => {
          if (
            this.#closed ||
            l !== this.#lineage ||
            epoch !== l.epoch ||
            l.dirty
          )
            return;
          const release = l.session.document.holdEdits();
          try {
            const warning = await this.bridge.control({
              documentId: l.documentId,
              writerId: l.writerId,
              epoch,
              status: "resolved",
              saved: l.saved,
            });
            l.lastCapture = null;
            this.#publish("", warning ?? "");
          } finally {
            release();
          }
        }).catch((error: unknown) => {
          if (l === this.#lineage) this.#failure(error);
        });
      }
    } else {
      if (l.first === null) l.first = this.#clock.now();
      l.last = this.#clock.now();
    }
    this.#publish();
    this.#arm();
  }
  #arm() {
    if (this.#timer !== null) this.#clock.clear(this.#timer);
    this.#timer = null;
    const l = this.#lineage;
    if (
      this.#closed ||
      !this.bridge.available ||
      this.#paused ||
      this.#running ||
      this.#blocked
    )
      return;
    if (l.first === null && !this.state.getSnapshot().error) return;
    const due =
      l.first === null
        ? this.#retryAt
        : Math.max(
            l.lastStart === null ? 0 : l.lastStart + 5000,
            Math.min(l.last + 2000, l.first + 10000),
            this.#retryAt,
          );
    this.#timer = this.#clock.set(
      () => {
        this.#timer = null;
        void this.#run();
      },
      Math.max(0, due - this.#clock.now()),
    );
  }
  #failure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    this.#blocked =
      /storage is full|unsupported|invalid recovery|exceeds|capacity/i.test(
        message,
      );
    this.#retryAt =
      this.#clock.now() +
      [5000, 15000, 30000, 60000][Math.min(this.#failures++, 3)];
    this.#publish(`Recovery unavailable: ${message}`);
    this.#arm();
  }
  async #run() {
    if (this.#closed || this.#paused || this.#running) return;
    const l = this.#lineage;
    this.#running = true;
    const epoch = ++l.epoch;
    const valid = () =>
      !this.#closed &&
      !this.#paused &&
      l === this.#lineage &&
      l.epoch === epoch;
    let ticket: RecoveryTicket | null = null;
    let first = l.first;
    try {
      if (!l.dirty) {
        if (l.touched) await this.#control(l, "resolved");
        l.lastCapture = null;
        this.#publish("", "");
        return;
      }
      l.lastStart = this.#clock.now();
      const snapshot = l.session.captureProjectSnapshot();
      const capturedAt = this.#clock.utc();
      const capture: RecoveryCapture = {
        documentId: l.documentId,
        writerId: l.writerId,
        epoch,
        capturedAt,
        historyRevision: snapshot.checkpoint.revision,
        documentVersion: snapshot.documentVersion,
        savedRevision: l.session.history.state.savedRevision,
        dirty: true,
        displayName:
          this.workspace.state.getSnapshot().savedPath?.split("/").at(-1) ??
          "Untitled",
        saved: l.saved,
      };
      l.first = null; // later edits now have their own first/last pending times
      this.#publish();
      const bytes = await this.#encode(snapshot, {
        signal: {
          get aborted() {
            return !valid();
          },
        },
      });
      if (!valid()) return;
      await this.#control(l, "active");
      if (!valid()) return;
      ticket = await this.#enqueue(() => this.bridge.prepare(capture, bytes));
      if (!valid()) return;
      const warning = await this.#enqueue(() =>
        valid()
          ? this.bridge.commit(ticket!)
          : Promise.reject(new Error("Recovery canceled")),
      );
      ticket = null;
      if (!valid()) return;
      l.checkpoint = snapshot.checkpoint.revision;
      l.lastCapture = capturedAt;
      l.session.history.markRecovery(snapshot.checkpoint);
      if (l.revision === l.checkpoint) l.first = null;
      first = null;
      this.#failures = 0;
      this.#retryAt = 0;
      this.#blocked = false;
      this.#publish("", warning ?? "");
    } catch (error) {
      if (valid()) this.#failure(error);
    } finally {
      if (ticket) {
        try {
          await this.#enqueue(() => this.bridge.cancel(ticket!));
        } catch (error) {
          if (valid()) this.#failure(error);
        }
      }
      if (
        l === this.#lineage &&
        l.dirty &&
        l.checkpoint !== l.revision &&
        l.first === null
      )
        l.first = first ?? this.#clock.now();
      this.#running = false;
      this.#publish();
      this.#arm();
    }
  }
  /** Synchronously invalidate acknowledgements before any file picker/await. */
  pause(): () => void {
    this.#paused++;
    const l = this.#lineage;
    l.epoch++;
    if (l.touched)
      void this.#control(l, l.dirty ? "active" : "resolved").catch(
        (error: unknown) => {
          if (l === this.#lineage) this.#failure(error);
        },
      );
    this.#arm();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#paused--;
      if (l === this.#lineage && l.dirty && l.first === null)
        l.first = this.#clock.now();
      this.#publish();
      this.#arm();
    };
  }
  /** Successful explicit bytes remain successful even if this receipt fails. */
  async saved(
    session: EditorSession,
    path: string,
    bytes: Uint8Array,
    snapshot: ProjectSnapshot,
    opened = false,
  ): Promise<void> {
    const l = this.#lineage;
    if (session !== l.session) return;
    try {
      const byteHash = await projectHash(bytes);
      const canonicalHash = opened
        ? await projectHash(await this.#encode(snapshot))
        : byteHash;
      if (l !== this.#lineage || this.#closed) return;
      l.saved = { path, savedAt: this.#clock.utc(), byteHash, canonicalHash };
      l.epoch++;
      if (l.touched) {
        // The choice and marker run under one short edit gate, after hashing.
        const release = session.document.holdEdits();
        try {
          const warning = await this.#control(
            l,
            l.dirty ? "active" : "resolved",
          );
          if (!l.dirty) {
            l.checkpoint = null;
            l.lastCapture = null;
          }
          this.#publish("", warning ?? "");
        } finally {
          release();
        }
      }
    } catch (error) {
      this.#failure(error);
    }
  }
  /** Called only after candidate validation and the final version check, under an edit gate. */
  async resolve(discard: boolean): Promise<void> {
    const l = this.#lineage;
    l.epoch++;
    // Await any earlier registration/fence before checking ownership.
    await this.#lane;
    if (!l.touched) return;
    try {
      const warning = await this.#control(
        l,
        discard ? "discarded" : "resolved",
      );
      l.checkpoint = null;
      l.first = null;
      l.lastCapture = null;
      this.#publish("", warning ?? "");
    } catch (error) {
      this.#failure(error);
      throw new Error(
        `${this.state.getSnapshot().error}. Retry the document action or cancel.`,
      );
    }
  }
  retry(): void {
    this.#blocked = false;
    this.#retryAt = 0;
    this.#failures = 0;
    this.#arm();
  }
  dispose(): void {
    this.#closed = true;
    this.#lineage.epoch++;
    this.#history();
    this.#unsubscribe();
    if (this.#timer !== null) this.#clock.clear(this.#timer);
  }
}
