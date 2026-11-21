import { CommandHistory } from "../domain/history.ts";
import {
  captureProjectSnapshot,
  encodeProjectSnapshot,
} from "../domain/project.ts";
import { decodeProject } from "../domain/project-decoding.ts";
import type { DocumentLifecycle } from "./document-lifecycle.ts";
import {
  projectHash,
  type RecoveryCapture,
  type SavedContext,
} from "./recovery.ts";
import { Store } from "./store.ts";

export interface RecoveryMetadata extends RecoveryCapture {
  readonly format: "tilewright-recovery";
  readonly version: 1;
  readonly sequence: number;
  readonly projectFormat: "tilewright-project";
  readonly projectVersion: 1;
  readonly byteLength: number;
  readonly sha256: string;
  readonly completedAt: number;
}
export interface RecoverySelection {
  readonly documentId: string;
  readonly sequence: number;
  readonly sha256: string;
}
export interface RecoveryGeneration {
  readonly sequence: number;
  readonly metadata: RecoveryMetadata | null;
  readonly error: string | null;
}
export interface RecoveryEntry {
  readonly documentId: string;
  readonly saved: SavedContext | null;
  readonly generations: readonly RecoveryGeneration[];
  readonly error: string | null;
  readonly discardable: boolean;
  readonly current: boolean;
}
export interface RecoveryReviewBridge {
  readonly available: boolean;
  readonly kind?: "browser";
  discover(): Promise<{
    entries: readonly RecoveryEntry[];
    warnings: readonly string[];
  }>;
  /** source=true requires a native SavedContext; a browser name grants no read. */
  read(selection: RecoverySelection, source?: boolean): Promise<Uint8Array>;
  claim(selection: RecoverySelection, writer: string): Promise<void>;
  release(documentId: string, writer: string): Promise<void>;
  discard(documentId: string): Promise<string | null>;
}
export interface RecoveredProject {
  readonly documentId: string;
  readonly writerId: string;
  readonly saved: SavedContext | null;
  readonly displayName: string;
  readonly capturedAt: number;
}
export type Relationship =
  "untitled" | "matches" | "unsaved" | "conflict" | "unknown";
export interface ReviewedGeneration extends RecoveryGeneration {
  readonly relationship: Relationship;
  readonly context: string;
}
export interface ReviewedEntry extends RecoveryEntry {
  readonly generations: readonly ReviewedGeneration[];
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export const selectionFor = (
  metadata: RecoveryMetadata,
): RecoverySelection => ({
  documentId: metadata.documentId,
  sequence: metadata.sequence,
  sha256: metadata.sha256,
});
export async function validateRecoveryBytes(
  bytes: Uint8Array,
  metadata: RecoveryMetadata,
): Promise<void> {
  if (
    bytes.byteLength !== metadata.byteLength ||
    (await projectHash(bytes)) !== metadata.sha256
  )
    throw new Error(
      "Recovery payload length or checksum does not match. Review recovery again.",
    );
}
async function canonicalHash(bytes: Uint8Array): Promise<string> {
  const decoded = await decodeProject(bytes);
  return projectHash(
    await encodeProjectSnapshot(
      captureProjectSnapshot(
        new CommandHistory(decoded.document),
        decoded.preferences,
      ),
    ),
  );
}
export function recoveryAge(
  capturedAt: number,
  completedAt: number,
  now = Date.now(),
): string {
  if (capturedAt > now || completedAt < capturedAt || completedAt > now)
    return "Capture age unknown — clock changed";
  return now - capturedAt > 30 * 86400000
    ? "Older recovery — review before restoring"
    : "Captured checkpoint";
}
/** A bounded, sequential scan. Only summaries survive; decoded maps are not cached. */
export class RecoveryBrowser {
  readonly state = new Store<
    Readonly<{
      open: boolean;
      busy: boolean;
      entries: readonly ReviewedEntry[];
      warnings: readonly string[];
      error: string;
    }>
  >({ open: false, busy: false, entries: [], warnings: [], error: "" });
  readonly lifecycle: DocumentLifecycle;
  readonly bridge: RecoveryReviewBridge;
  #closed = false;
  constructor(lifecycle: DocumentLifecycle, bridge: RecoveryReviewBridge) {
    this.lifecycle = lifecycle;
    this.bridge = bridge;
  }
  #publish(patch: Partial<ReturnType<typeof this.state.getSnapshot>>) {
    if (this.#closed) return;
    try {
      this.state.set(Object.freeze({ ...this.state.getSnapshot(), ...patch }));
    } catch {
      /* published */
    }
  }
  get currentDocumentId() {
    return this.lifecycle.files.recovery?.documentId;
  }
  dismiss() {
    this.#publish({ open: false });
  }
  async review() {
    this.#publish({ open: true });
    await this.refresh();
  }
  async refresh(startup = false) {
    if (!this.bridge.available || this.#closed || this.state.getSnapshot().busy)
      return;
    this.#publish({ busy: true, error: "" });
    const resume = this.lifecycle.files.recovery?.pause();
    const before = this.lifecycle.files.workspace.state.getSnapshot();
    try {
      const discovered = await this.bridge.discover();
      const entries: ReviewedEntry[] = [];
      for (const entry of discovered.entries) {
        const generations: ReviewedGeneration[] = [];
        // Inspect each referenced source only once per lineage. It is advisory.
        let source: { byte: string; canonical: string } | undefined;
        let sourceError = "";
        for (const generation of entry.generations) {
          if (this.#closed) return;
          const meta = generation.metadata;
          let error = generation.error ?? entry.error;
          let relationship: Relationship = "unknown",
            context = "Recovery unavailable";
          if (meta && !error) {
            try {
              const bytes = await this.bridge.read(selectionFor(meta));
              await validateRecoveryBytes(bytes, meta);
              const recoveryCanonical = await canonicalHash(bytes); // full decode before offering Restore
              if (!entry.saved) {
                relationship = meta.saved ? "unknown" : "untitled";
                context =
                  this.bridge.kind === "browser"
                    ? "Local browser checkpoint — downloaded files are separate"
                    : meta.saved
                      ? "Saved file unavailable / relationship unknown: save receipt missing"
                      : "Untitled unsaved work";
              } else {
                if (!source && !sourceError) {
                  try {
                    const original = await this.bridge.read(
                      selectionFor(meta),
                      true,
                    );
                    source = {
                      byte: await projectHash(original),
                      canonical: await canonicalHash(original),
                    };
                  } catch (cause) {
                    sourceError = message(cause);
                  }
                }
                if (!source)
                  context = `Saved file unavailable / relationship unknown: ${sourceError}`;
                else if (source.canonical === recoveryCanonical) {
                  relationship = "matches";
                  context = "Already matches saved file";
                } else if (
                  recoveryAge(meta.capturedAt, meta.completedAt).includes(
                    "unknown",
                  ) ||
                  entry.saved.savedAt > Date.now()
                ) {
                  context =
                    "Saved file unavailable / relationship unknown: clock changed";
                } else if (
                  !meta.saved ||
                  meta.saved.path !== entry.saved.path ||
                  meta.saved.savedAt !== entry.saved.savedAt ||
                  meta.saved.canonicalHash !== entry.saved.canonicalHash ||
                  meta.saved.byteHash !== entry.saved.byteHash
                ) {
                  context =
                    "Saved file unavailable / relationship unknown: saved context changed after this capture; review both destinations";
                } else if (
                  source.byte === entry.saved.byteHash ||
                  source.canonical === entry.saved.canonicalHash
                ) {
                  relationship = "unsaved";
                  context = "Unsaved changes since last known save";
                  if (source.byte !== entry.saved.byteHash)
                    context += " (saved-file formatting changed)";
                } else {
                  relationship = "conflict";
                  context = "Saved file changed — recovery may conflict";
                }
              }
            } catch (cause) {
              error = message(cause);
            }
          }
          generations.push({ ...generation, error, relationship, context });
        }
        entries.push({ ...entry, generations });
      }
      entries.sort(
        (a, b) =>
          (b.generations.find((g) => g.metadata)?.metadata?.capturedAt ?? 0) -
            (a.generations.find((g) => g.metadata)?.metadata?.capturedAt ??
              0) || a.documentId.localeCompare(b.documentId),
      );
      const urgent = entries.some(
        (entry) =>
          !entry.current &&
          entry.documentId !== this.currentDocumentId &&
          (!entry.generations.length ||
            entry.generations[0].error ||
            entry.generations[0].relationship !== "matches"),
      );
      this.#publish({
        entries,
        warnings: discovered.warnings,
        ...(startup &&
        urgent &&
        before === this.lifecycle.files.workspace.state.getSnapshot() &&
        !this.lifecycle.state.getSnapshot().busy
          ? { open: true }
          : {}),
      });
    } catch (error) {
      this.#publish({ error: `Recovery unavailable: ${message(error)}` });
    } finally {
      this.#publish({ busy: false });
      resume?.();
    }
  }
  async restore(
    entry: ReviewedEntry,
    generation: ReviewedGeneration,
  ): Promise<boolean> {
    if (
      this.#closed ||
      this.state.getSnapshot().busy ||
      entry.current ||
      entry.documentId === this.currentDocumentId ||
      !generation.metadata ||
      generation.error
    )
      return false;
    this.#publish({ busy: true, error: "" });
    const restored = await this.lifecycle.restore(
      generation.metadata,
      entry.saved,
      this.bridge,
    );
    this.#publish({
      busy: false,
      ...(restored
        ? { open: false }
        : { error: this.lifecycle.state.getSnapshot().error }),
    });
    if (restored) await this.refresh();
    return restored;
  }
  /** Called only by the named, selected-lineage confirmation. */
  async discard(entry: ReviewedEntry) {
    if (
      this.#closed ||
      this.state.getSnapshot().busy ||
      entry.current ||
      entry.documentId === this.currentDocumentId ||
      !entry.discardable
    )
      return;
    this.#publish({ busy: true, error: "" });
    try {
      const warning = await this.bridge.discard(entry.documentId);
      this.#publish({
        warnings: warning ? [warning] : [],
        entries: this.state
          .getSnapshot()
          .entries.filter((e) => e.documentId !== entry.documentId),
      });
      this.lifecycle.files.recovery?.retry();
    } catch (error) {
      this.#publish({ error: message(error) });
    } finally {
      this.#publish({ busy: false });
    }
  }
  dispose() {
    this.#closed = true;
  }
}
