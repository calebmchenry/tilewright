import type { RevisionCheckpoint } from "../domain/history.ts";

/** A label is not an I/O grant. Only native picker tokens authorize native I/O. */
export type ProjectSource =
  | Readonly<{ kind: "native-file"; path: string }>
  | Readonly<{ kind: "browser-file"; name: string }>;

export interface NativeFileHandle {
  readonly token: string;
  readonly path: string;
}

export function projectDisplayName(
  source: ProjectSource | null,
): string | null {
  return source?.kind === "browser-file"
    ? source.name
    : (source?.path.split("/").pop() ?? null);
}

/** Validate/copy before any asynchronous load so caller mutation cannot rename it. */
export function projectSource(source: ProjectSource): ProjectSource {
  const value = source.kind === "native-file" ? source.path : source.name;
  if (
    !["native-file", "browser-file"].includes(source.kind) ||
    typeof value !== "string" ||
    !value.trim()
  )
    throw new TypeError(
      "Project source must have a nonblank path or filename.",
    );
  return Object.freeze(
    source.kind === "native-file"
      ? { kind: "native-file", path: value }
      : { kind: "browser-file", name: value },
  );
}

/** Session-local evidence, never serialized into the shared project payload. */
export type PersistenceCheckpoint =
  | Readonly<{
      kind: "native-save";
      path: string;
      checkpoint: RevisionCheckpoint;
      at: number;
    }>
  | Readonly<{
      // Browser handoff only: no disk receipt, overwrite grant or discard approval.
      kind: "browser-download-request";
      filename: string;
      checkpoint: RevisionCheckpoint;
      at: number;
    }>
  | Readonly<{
      kind: "local-recovery";
      checkpoint: RevisionCheckpoint;
      at: number;
    }>;
export type NativeSaveCheckpoint = Extract<
  PersistenceCheckpoint,
  { kind: "native-save" }
>;
