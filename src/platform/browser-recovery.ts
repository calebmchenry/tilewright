import { decodeProject } from "../domain/project-decoding.ts";
import { PROJECT_LIMITS } from "../domain/project-format.ts";
import {
  projectHash,
  type RecoveryBridge,
  type RecoveryCapture,
  type RecoveryControl,
  type RecoveryTicket,
} from "../editor/recovery.ts";
import {
  validateRecoveryBytes,
  type RecoveryEntry,
  type RecoveryMetadata,
  type RecoveryReviewBridge,
  type RecoverySelection,
} from "../editor/recovery-discovery.ts";

export const BROWSER_RECOVERY_DATABASE = "tilewright-recovery";
// v1 has the same records; v2 adds a lineage index for complete selected cleanup.
export const BROWSER_RECOVERY_VERSION = 2;
const MAX_LINEAGES = 10;
const MAX_BYTES = 1024 ** 3;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
const message = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError")
      return "Browser storage is full. Download your project, then discard unneeded recovery or free site storage.";
    if (error.name === "SecurityError")
      return "Browser storage is unavailable. Allow site storage or use a supported browser; editing and project downloads remain available.";
    if (error.name === "VersionError")
      return "Unsupported recovery database version. Reload the latest app; existing recovery was left untouched.";
  }
  return error instanceof Error ? error.message : String(error);
};
interface RecordState {
  format: "tilewright-browser-recovery";
  version: 1;
  documentId: string;
  writerId: string;
  epoch: number;
  nextSequence: number;
  generations: RecoveryMetadata[];
}
interface Payload {
  documentId: string;
  sequence: number;
  bytes: Uint8Array;
}
function captureValid(c: RecoveryCapture) {
  if (
    !uuid.test(c.documentId) ||
    !uuid.test(c.writerId) ||
    ![c.epoch, c.capturedAt, c.historyRevision, c.documentVersion].every(
      integer,
    ) ||
    c.savedRevision !== null ||
    c.saved !== null ||
    c.dirty !== true ||
    typeof c.displayName !== "string" ||
    c.displayName.length > 4096
  )
    throw new Error("Invalid recovery capture metadata.");
}
function metadataValid(m: RecoveryMetadata, id: string) {
  captureValid(m);
  const keys =
    "format version documentId writerId epoch capturedAt historyRevision documentVersion savedRevision dirty displayName saved sequence projectFormat projectVersion byteLength sha256 completedAt".split(
      " ",
    );
  if (
    Object.keys(m).length !== keys.length ||
    keys.some((key) => !(key in m)) ||
    m.format !== "tilewright-recovery" ||
    m.version !== 1 ||
    m.documentId !== id ||
    m.projectFormat !== "tilewright-project" ||
    m.projectVersion !== 1 ||
    !integer(m.sequence) ||
    m.sequence < 1 ||
    !integer(m.completedAt) ||
    !integer(m.byteLength) ||
    m.byteLength < 1 ||
    m.byteLength > PROJECT_LIMITS.maxBytes ||
    typeof m.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(m.sha256)
  )
    throw new Error("Invalid or unsupported recovery metadata.");
}
function recordValid(value: RecordState, id = value?.documentId): RecordState {
  if (
    !value ||
    value.format !== "tilewright-browser-recovery" ||
    value.version !== 1 ||
    !uuid.test(id) ||
    value.documentId !== id ||
    !uuid.test(value.writerId) ||
    !integer(value.epoch) ||
    !integer(value.nextSequence) ||
    value.nextSequence < 1 ||
    !Array.isArray(value.generations) ||
    value.generations.length > 2 ||
    Object.keys(value).length !== 7
  )
    throw new Error(
      "Invalid or unsupported recovery lineage. Review or discard this entry.",
    );
  return value;
}

/** Origin-local, transactional storage. Web Locks protect live tabs, without clock leases. */
export class BrowserRecovery implements RecoveryBridge, RecoveryReviewBridge {
  readonly available = true; // Failures remain visible through the shared feedback/retry UI.
  readonly kind = "browser";
  #db: IDBDatabase | null = null;
  #opening: Promise<IDBDatabase> | null = null;
  #blockedOpen: Error | null = null;
  #closed = false;
  #transactions = new Set<IDBTransaction>();
  #owners = new Map<string, { writer: string; release: () => void }>();
  #controls = new Map<string, RecoveryControl>();
  #pending: {
    ticket: RecoveryTicket;
    metadata: RecoveryMetadata;
    bytes: Uint8Array;
    keep: RecoveryMetadata | undefined;
  } | null = null;

  async initialize() {
    await this.#database();
  }
  async #database(): Promise<IDBDatabase> {
    if (this.#closed) throw new Error("Recovery session ended.");
    if (!globalThis.indexedDB || !globalThis.navigator?.locks)
      throw new Error(
        "Local browser storage or Web Locks is unavailable. Use project downloads; recovery requires a supported secure browser origin.",
      );
    if (this.#blockedOpen) throw this.#blockedOpen;
    if (this.#db) return this.#db;
    if (this.#opening) return this.#opening;
    this.#opening = new Promise<IDBDatabase>((resolve, reject) => {
      let ended = false;
      const fail = (error: unknown) => {
        ended = true;
        reject(new Error(message(error)));
      };
      const request = indexedDB.open(
        BROWSER_RECOVERY_DATABASE,
        BROWSER_RECOVERY_VERSION,
      );
      request.onblocked = () => {
        this.#blockedOpen = new Error(
          "Recovery database upgrade blocked. Close other Tilewright tabs, then Retry recovery. Editing and downloads remain available.",
        );
        fail(this.#blockedOpen);
      };
      request.onerror = () => {
        this.#blockedOpen = null;
        fail(request.error);
      };
      request.onupgradeneeded = (event) => {
        if (ended || this.#closed) {
          request.transaction!.abort();
          return;
        }
        const db = request.result;
        if (event.oldVersion === 0) {
          db.createObjectStore("lineages", { keyPath: "documentId" });
          db.createObjectStore("payloads", {
            keyPath: ["documentId", "sequence"],
          });
        }
        const payloads = request.transaction!.objectStore("payloads");
        if (!payloads.indexNames.contains("documentId"))
          payloads.createIndex("documentId", "documentId");
      };
      request.onsuccess = () => {
        this.#blockedOpen = null;
        const db = request.result;
        if (ended || this.#closed) {
          db.close();
          fail(new Error("Recovery session ended. Retry recovery."));
          return;
        }
        db.onversionchange = () => {
          db.close();
          if (this.#db === db) this.#db = null;
        };
        db.onclose = () => {
          if (this.#db === db) this.#db = null;
        };
        this.#db = db;
        resolve(db);
      };
    });
    try {
      return await this.#opening;
    } catch (error) {
      throw new Error(message(error));
    } finally {
      this.#opening = null;
    }
  }
  async #transaction<T>(
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction, result: (value: T) => void) => void,
  ): Promise<T> {
    const db = await this.#database();
    if (this.#closed) throw new Error("Recovery session ended.");
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let failure: unknown;
      const tx = db.transaction(["lineages", "payloads"], mode, {
        durability: "strict",
      });
      this.#transactions.add(tx);
      tx.oncomplete = () => {
        this.#transactions.delete(tx);
        resolve(value);
      };
      tx.onabort = () => {
        this.#transactions.delete(tx);
        reject(
          new Error(
            message(
              failure ??
                transactionErrors.get(tx) ??
                tx.error ??
                new Error(
                  "Recovery transaction interrupted. Retry recovery; the previous checkpoint was retained.",
                ),
            ),
          ),
        );
      };
      // Queue requests synchronously here or in IDB events; never await inside a transaction.
      const guard = (action: () => void) => {
        try {
          action();
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      guard(() =>
        run(tx, (next) => {
          value = next;
        }),
      );
    });
  }
  async #get(id: string): Promise<RecordState | undefined> {
    return this.#transaction("readonly", (tx, done) => {
      const request = tx.objectStore("lineages").get(id);
      request.onsuccess = () => done(request.result as RecordState | undefined);
    });
  }
  async #lock(id: string, writer: string) {
    if (this.#owners.has(id)) {
      if (this.#owners.get(id)!.writer !== writer)
        throw new Error("Recovery writer changed. Review recovery again.");
      return;
    }
    await this.#database();
    await new Promise<void>((resolve, reject) => {
      void navigator.locks
        .request(
          `tilewright-recovery:${id}`,
          { ifAvailable: true },
          async (lock) => {
            if (!lock) {
              reject(
                new Error(
                  "This recovery is active in another tab. Close that tab before restoring or discarding it.",
                ),
              );
              return;
            }
            if (this.#closed) {
              reject(new Error("Recovery session ended."));
              return;
            }
            await new Promise<void>((release) => {
              this.#owners.set(id, { writer, release });
              resolve();
            });
          },
        )
        .catch(reject);
    });
  }
  #unlock(id: string) {
    this.#owners.get(id)?.release();
    this.#owners.delete(id);
  }
  #assertOwner(id: string, writer: string) {
    if (this.#closed || this.#owners.get(id)?.writer !== writer)
      throw new Error("Recovery writer is no longer active.");
  }
  async control(control: RecoveryControl): Promise<null> {
    if (
      !uuid.test(control.documentId) ||
      !uuid.test(control.writerId) ||
      !integer(control.epoch) ||
      control.saved !== null
    )
      throw new Error("Invalid recovery control.");
    const previous = this.#controls.get(control.documentId);
    if (
      previous &&
      (previous.writerId !== control.writerId || previous.epoch > control.epoch)
    )
      throw new Error("Stale recovery control.");
    this.#controls.set(control.documentId, control); // fence pending work before awaiting I/O
    await this.#lock(control.documentId, control.writerId);
    const current = await this.#get(control.documentId);
    if (current && recordValid(current).writerId !== control.writerId)
      throw new Error(
        "Recovery belongs to another writer; review it before restoring.",
      );
    if (control.status !== "active")
      await this.#remove(control.documentId, control.writerId);
    return null;
  }
  async prepare(
    capture: RecoveryCapture,
    bytes: Uint8Array,
  ): Promise<RecoveryTicket> {
    captureValid(capture);
    this.#assertCapture(capture);
    if (this.#pending)
      throw new Error("A recovery checkpoint is already pending.");
    if (bytes.byteLength > PROJECT_LIMITS.maxBytes)
      throw new Error("Recovery exceeds project capacity.");
    // Validate before publication, including the entire shared project schema.
    const copy = bytes.slice();
    await decodeProject(copy);
    const sha256 = await projectHash(copy);
    const current = await this.#get(capture.documentId);
    let keep: RecoveryMetadata | undefined;
    if (current) {
      recordValid(current);
      if (
        current.generations.some(
          (m) => !integer(m?.sequence) || m.sequence >= current.nextSequence,
        )
      )
        throw new Error(
          "Invalid recovery sequence counter. Review or discard this entry.",
        );
      for (const candidate of current.generations) {
        try {
          await decodeProject(
            await this.read({
              documentId: capture.documentId,
              sequence: candidate.sequence,
              sha256: candidate.sha256,
            }),
          );
          keep = candidate;
          break;
        } catch {
          /* Prefer the previous valid generation over a corrupt newest one. */
        }
      }
      keep ??= current.generations[0];
    }
    const sequence = current?.nextSequence ?? 1;
    const metadata: RecoveryMetadata = {
      ...capture,
      format: "tilewright-recovery",
      version: 1,
      sequence,
      projectFormat: "tilewright-project",
      projectVersion: 1,
      byteLength: copy.byteLength,
      sha256,
      completedAt: Date.now(),
    };
    metadataValid(metadata, capture.documentId);
    this.#assertCapture(capture);
    const ticket = {
      documentId: capture.documentId,
      writerId: capture.writerId,
      epoch: capture.epoch,
      sequence,
    };
    this.#pending = { ticket, metadata, bytes: copy, keep };
    return ticket;
  }
  #assertCapture(
    capture: Pick<RecoveryCapture, "documentId" | "writerId" | "epoch">,
  ) {
    this.#assertOwner(capture.documentId, capture.writerId);
    const control = this.#controls.get(capture.documentId);
    if (
      !control ||
      control.status !== "active" ||
      control.epoch !== capture.epoch ||
      control.writerId !== capture.writerId
    )
      throw new Error("Stale recovery checkpoint canceled.");
  }
  async commit(ticket: RecoveryTicket): Promise<null> {
    const pending = this.#pending;
    if (!pending || JSON.stringify(pending.ticket) !== JSON.stringify(ticket))
      throw new Error("Unknown recovery checkpoint.");
    this.#assertCapture(ticket);
    await this.#transaction<void>("readwrite", (tx, done) => {
      const lineages = tx.objectStore("lineages"),
        payloads = tx.objectStore("payloads");
      const request = lineages.getAll();
      request.onsuccess = () => {
        try {
          this.#assertCapture(ticket);
          const all = (request.result as RecordState[]).map((v) =>
            recordValid(v),
          );
          const old = all.find((v) => v.documentId === ticket.documentId);
          if (
            old &&
            (old.writerId !== ticket.writerId ||
              old.nextSequence !== ticket.sequence)
          )
            throw new Error("Stale recovery publication.");
          if (!old && all.length >= MAX_LINEAGES)
            throw new Error(
              "Recovery capacity reached (10 maps). Download your project and discard unneeded recovery.",
            );
          const generations = [
            pending.metadata,
            ...(pending.keep ? [pending.keep] : []),
          ];
          const next: RecordState = {
            format: "tilewright-browser-recovery",
            version: 1,
            documentId: ticket.documentId,
            writerId: ticket.writerId,
            epoch: ticket.epoch,
            nextSequence: ticket.sequence + 1,
            generations,
          };
          recordValid(next); // Reject exhausted/corrupt sequence counters before publication.
          const records = [
            ...all.filter((v) => v.documentId !== ticket.documentId),
            next,
          ];
          const total = records.reduce(
            (sum, v) =>
              sum +
              new TextEncoder().encode(JSON.stringify(v)).byteLength +
              v.generations.reduce((s, m) => {
                metadataValid(m, v.documentId);
                return s + m.byteLength;
              }, 0),
            65536,
          );
          if (total > MAX_BYTES)
            throw new Error(
              "Recovery storage capacity reached (1 GiB). Download your project and discard unneeded recovery.",
            );
          for (const generation of old?.generations ?? [])
            if (generation.sequence !== pending.keep?.sequence)
              payloads.delete([ticket.documentId, generation.sequence]);
          payloads.put({
            documentId: ticket.documentId,
            sequence: ticket.sequence,
            bytes: pending.bytes,
          } satisfies Payload);
          lineages.put(next);
          done();
        } catch (error) {
          // Keep the actual capacity/validation reason instead of a generic abort.
          abortTransaction(tx, error);
        }
      };
    });
    if (this.#pending === pending) this.#pending = null;
    return null;
  }
  async cancel(ticket: RecoveryTicket) {
    if (this.#pending?.ticket === ticket) this.#pending = null;
  }
  async discover() {
    const records = await this.#transaction<RecordState[]>(
      "readonly",
      (tx, done) => {
        const r = tx.objectStore("lineages").getAll();
        r.onsuccess = () => done(r.result as RecordState[]);
      },
    );
    const entries: RecoveryEntry[] = [];
    const warnings: string[] = [];
    for (const raw of records) {
      const id = raw.documentId;
      if (typeof id !== "string" || !uuid.test(id)) {
        warnings.push("An unrecognized recovery identity was left untouched.");
        continue;
      }
      let current = this.#owners.has(id);
      if (!current)
        await navigator.locks.request(
          `tilewright-recovery:${id}`,
          { ifAvailable: true },
          (lock) => {
            current = !lock;
          },
        );
      try {
        const record = recordValid(raw);
        entries.push({
          documentId: id,
          saved: null,
          current,
          discardable: !current,
          error: null,
          generations: record.generations.map((metadata) => {
            try {
              metadataValid(metadata, id);
              return { sequence: metadata.sequence, metadata, error: null };
            } catch (error) {
              return {
                sequence: metadata?.sequence ?? 0,
                metadata: null,
                error: message(error),
              };
            }
          }),
        });
      } catch (error) {
        entries.push({
          documentId: id,
          saved: null,
          current,
          discardable: !current && raw.version === 1,
          error: message(error),
          generations: [],
        });
      }
    }
    return { entries, warnings };
  }
  async read(
    selection: RecoverySelection,
    source = false,
  ): Promise<Uint8Array> {
    if (source)
      throw new Error(
        "Browser recovery has no access to downloaded or imported source files.",
      );
    const { metadata, payload } = await this.#transaction<{
      metadata: RecoveryMetadata;
      payload: Payload;
    }>("readonly", (tx, done) => {
      const state = tx.objectStore("lineages").get(selection.documentId);
      state.onsuccess = () => {
        const generations = (state.result as RecordState | undefined)
          ?.generations;
        const metadata = Array.isArray(generations)
          ? generations.find((m) => m?.sequence === selection.sequence)
          : undefined;
        const data = tx
          .objectStore("payloads")
          .get([selection.documentId, selection.sequence]);
        data.onsuccess = () =>
          done({ metadata: metadata!, payload: data.result as Payload });
      };
    });
    if (!metadata || !payload || !(payload.bytes instanceof Uint8Array))
      throw new Error("Recovery checkpoint is missing. Review recovery again.");
    metadataValid(metadata, selection.documentId);
    if (
      metadata.sha256 !== selection.sha256 ||
      payload.documentId !== selection.documentId ||
      payload.sequence !== selection.sequence
    )
      throw new Error("Recovery checkpoint changed. Review recovery again.");
    await validateRecoveryBytes(payload.bytes, metadata);
    return payload.bytes;
  }
  async claim(selection: RecoverySelection, writer: string) {
    if (!uuid.test(writer)) throw new Error("Invalid recovery writer.");
    await this.#lock(selection.documentId, writer);
    try {
      await decodeProject(await this.read(selection));
      await this.#transaction<void>("readwrite", (tx, done) => {
        const store = tx.objectStore("lineages"),
          request = store.get(selection.documentId);
        request.onsuccess = () => {
          try {
            this.#assertOwner(selection.documentId, writer);
            const record = recordValid(
              request.result as RecordState,
              selection.documentId,
            );
            store.put({ ...record, writerId: writer, epoch: 0 });
            done();
          } catch (error) {
            abortTransaction(tx, error);
          }
        };
      });
    } catch (error) {
      this.#unlock(selection.documentId);
      throw error;
    }
  }
  async release(documentId: string, writer: string) {
    if (this.#owners.get(documentId)?.writer !== writer) return;
    this.#controls.delete(documentId);
    if (this.#pending?.ticket.documentId === documentId) this.#pending = null;
    this.#unlock(documentId);
  }
  async #remove(id: string, writer: string) {
    await this.#transaction<void>("readwrite", (tx, done) => {
      this.#assertOwner(id, writer);
      tx.objectStore("lineages").delete(id);
      const request = tx
        .objectStore("payloads")
        .index("documentId")
        .openKeyCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          tx.objectStore("payloads").delete(cursor.primaryKey);
          cursor.continue();
        } else done();
      };
    });
  }
  async discard(id: string): Promise<null> {
    if (!uuid.test(id)) throw new Error("Invalid recovery identity.");
    if (this.#owners.has(id))
      throw new Error("This recovery is currently open.");
    const writer = crypto.randomUUID();
    await this.#lock(id, writer);
    try {
      const record = await this.#get(id);
      if (record && record.version !== 1)
        throw new Error("Unsupported recovery version; left untouched.");
      await this.#remove(id, writer);
      return null;
    } finally {
      this.#unlock(id);
    }
  }
  dispose() {
    this.#closed = true;
    for (const tx of this.#transactions)
      abortTransaction(tx, new Error("Recovery session ended."));
    this.#pending = null;
    this.#controls.clear();
    for (const id of this.#owners.keys()) this.#unlock(id);
    this.#db?.close();
    this.#db = null;
  }
}
const transactionErrors = new WeakMap<IDBTransaction, unknown>();

function abortTransaction(tx: IDBTransaction, error: unknown) {
  transactionErrors.set(tx, error);
  try {
    tx.abort();
  } catch {
    /* Already aborted by storage/fault injection. */
  }
}
