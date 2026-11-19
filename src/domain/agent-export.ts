import { AreaValidationError, validateNamedArea } from "./annotations.ts";
import { validateCanvasBounds } from "./canvas.ts";
import type { CommandHistory, RevisionCheckpoint } from "./history.ts";
import { cellKey } from "./values.ts";
import type { AgentColor, AgentMapV1 } from "./agent-export-format.ts";

/** Independent agent-format capacities, not project limits or performance targets. */
export const AGENT_EXPORT_LIMITS = Object.freeze({
  maxBytes: 268_435_456,
  maxLayers: 1_024,
  maxRegistryEntries: 65_536,
  maxAreas: 65_536,
  maxColors: 1_000_000,
  maxRuns: 2_000_000,
  maxOccupiedCells: 100_000_000,
});
export type AgentExportLimits = {
  readonly [K in keyof typeof AGENT_EXPORT_LIMITS]: number;
};
export class AgentExportError extends Error {
  readonly category: "invalid-data" | "capacity" | "canceled";
  readonly path: string;
  constructor(
    category: AgentExportError["category"],
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "AgentExportError";
    this.category = category;
    this.path = path;
  }
}
export interface AgentExportSnapshot {
  /** Capture identity only; exporting must never acknowledge a save or recovery. */
  readonly checkpoint: RevisionCheckpoint;
  readonly documentVersion: number;
  readonly map: AgentMapV1;
}
export interface AgentExportCaptureOptions {
  /** A constrained destination may lower, but never raise, the policy ceilings. */
  readonly limits?: Partial<AgentExportLimits>;
}
export interface AgentExportEncodeOptions {
  /** Actual UTF-8 bytes encoded so far; total size is not known until encoding completes. */
  readonly onProgress?: (bytes: number) => void;
  readonly signal?: { readonly aborted: boolean };
  /** Host/test scheduling seam; defaults to yielding to a timer task. */
  readonly yieldControl?: () => Promise<void>;
}

// Only validated, immutable captures may reach the encoder.
const snapshots = new WeakMap<AgentExportSnapshot, AgentExportLimits>();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const colorKey = (color: AgentColor) =>
  color.kind === "raw" ? `raw:${color.rgba}` : `registered:${color.registryId}`;
function invalid(path: string, message: string): never {
  throw new AgentExportError("invalid-data", path, message);
}
function capacity(value: number, limit: number, path: string): void {
  if (!Number.isSafeInteger(value) || value > limit)
    throw new AgentExportError(
      "capacity",
      path,
      `Exceeds agent export capacity (${limit}).`,
    );
}
function exportLimits(overrides: Partial<AgentExportLimits> = {}) {
  const limits: { -readonly [K in keyof AgentExportLimits]: number } = {
    ...AGENT_EXPORT_LIMITS,
  };
  for (const key of Object.keys(overrides) as (keyof AgentExportLimits)[]) {
    const value = overrides[key];
    if (
      !Object.hasOwn(AGENT_EXPORT_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value! < 1 ||
      value! > AGENT_EXPORT_LIMITS[key]
    )
      throw new RangeError(
        `Agent export limit ${key} must be a positive integer no larger than the v1 ceiling.`,
      );
    limits[key] = value!;
  }
  return Object.freeze(limits);
}
function keys(value: unknown, expected: readonly string[], path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "Expected an object.");
  const actual = Object.keys(value);
  for (const key of actual)
    if (!expected.includes(key))
      invalid(`${path}.${key}`, "Unrepresentable v1 source property.");
  for (const key of expected)
    if (!actual.includes(key))
      invalid(`${path}.${key}`, "Required property is missing.");
}

/** Capture the whole committed map BEFORE awaiting or invoking a scheduler.
 * Model primitives enforce IDs, layer names, safe coordinates and run ordering.
 * Generic metadata needs feature validation here. No UI preferences, live iterators,
 * storage tokens, project objects or renderer data cross the snapshot boundary.
 */
export function captureAgentExportSnapshot(
  history: CommandHistory,
  options: AgentExportCaptureOptions = {},
): AgentExportSnapshot {
  const document = history.document;
  document.assertCommittedRead();
  const checkpoint = history.captureCheckpoint();
  const documentVersion = document.version;
  const limits = exportLimits(options.limits);
  const bounds = document.bounds;
  try {
    validateCanvasBounds(bounds);
  } catch (error) {
    invalid("bounds", (error as Error).message);
  }
  const sourceLayers = document.layers;
  capacity(sourceLayers.length, limits.maxLayers, "layers");
  const registry = document.registryEntries;
  capacity(registry.length, limits.maxRegistryEntries, "registry");
  capacity(registry.length, limits.maxColors, "colors");
  const owners = new Set<string>();
  const colors: AgentColor[] = registry.map(([id, record], index) => {
    const path = `registry[${index}]`;
    keys(record, ["name", "rgba"], path);
    if (typeof record.name !== "string" || !record.name.trim())
      invalid(`${path}.name`, "Expected a nonblank meaning.");
    if (
      typeof record.rgba !== "string" ||
      !/^#[0-9a-f]{6}ff$/.test(record.rgba)
    )
      invalid(`${path}.rgba`, "Expected a lowercase opaque RGBA color.");
    if (owners.has(record.rgba))
      invalid(`${path}.rgba`, "Color has multiple registry owners.");
    owners.add(record.rgba);
    return Object.freeze({
      kind: "registered",
      registryId: id,
      rgba: record.rgba,
      meaning: record.name,
    });
  });
  const sourceAreas = document.annotations;
  capacity(sourceAreas.length, limits.maxAreas, "areas");
  const areas = sourceAreas.map(([id, record], index) => {
    const path = `areas[${index}]`;
    keys(record, ["name", "description", "tier", "bounds", "label"], path);
    keys(record.bounds, ["minX", "minY", "maxX", "maxY"], `${path}.bounds`);
    keys(record.label, ["placement"], `${path}.label`);
    if (typeof record.name === "string" && record.name !== record.name.trim())
      invalid(`${path}.name`, "Area names must already be trimmed.");
    try {
      const {
        name,
        description,
        tier,
        bounds: areaBounds,
      } = validateNamedArea(record, bounds);
      return Object.freeze({ id, name, description, tier, bounds: areaBounds });
    } catch (error) {
      const field =
        error instanceof AreaValidationError
          ? Object.keys(error.fields)[0]
          : null;
      invalid(field ? `${path}.${field}` : path, (error as Error).message);
    }
  });

  const indices = new Map(
    colors.map((color, index) => [colorKey(color), index]),
  );
  let runCount = 0,
    occupiedCells = 0;
  const layers = sourceLayers.map((layer, layerIndex) => {
    const runs: [number, number, number, number][] = [];
    // No window or visibility filter: includes empty layers and all hidden/covered cells.
    for (const run of document.iterateRuns(layer.id)) {
      const path = `layers[${layerIndex}].runs[${runs.length}]`;
      capacity(++runCount, limits.maxRuns, path);
      occupiedCells += run.length;
      capacity(occupiedCells, limits.maxOccupiedCells, path);
      const value = run.value,
        key = cellKey(value);
      let index = indices.get(key);
      if (index === undefined) {
        if (value.kind === "registered")
          invalid(
            `${path}[3]`,
            `Unresolved registry identity: ${value.registryId}.`,
          );
        capacity(colors.length + 1, limits.maxColors, "colors");
        index = colors.length;
        indices.set(key, index);
        colors.push(
          Object.freeze({ kind: "raw", rgba: value.rgba, meaning: null }),
        );
      }
      runs.push([run.x, run.y, run.length, index]);
    }
    return { id: layer.id, name: layer.name, runs };
  });
  const sortedColors = [...colors].sort((a, b) =>
    compare(colorKey(a), colorKey(b)),
  );
  const canonicalIndices = new Map(
    sortedColors.map((color, index) => [colorKey(color), index]),
  );
  const remap = colors.map((color) => canonicalIndices.get(colorKey(color))!);
  const frozenLayers = layers.map((layer) => {
    for (const run of layer.runs) {
      run[3] = remap[run[3]];
      Object.freeze(run);
    }
    return Object.freeze({ ...layer, runs: Object.freeze(layer.runs) });
  });
  document.assertCommittedRead();
  if (
    document.version !== documentVersion ||
    history.state.revision !== checkpoint.revision
  )
    invalid(
      "snapshot",
      "Document changed during capture; retry the whole snapshot.",
    );
  const map: AgentMapV1 = Object.freeze({
    format: "tilewright-agent-map",
    version: 1,
    bounds,
    colors: Object.freeze(sortedColors),
    layers: Object.freeze(frozenLayers),
    areas: Object.freeze(areas),
  });
  const snapshot = Object.freeze({ checkpoint, documentVersion, map });
  snapshots.set(snapshot, limits);
  return snapshot;
}

/** Bounded escaping with exactly JSON.stringify's treatment of surrogate pairs. */
function* stringTokens(value: string): Generator<string> {
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 8192, value.length);
    const last = value.charCodeAt(end - 1),
      next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
      end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}
/** Closed, validated agent shape only; never serializes a project or editor object. */
function* canonicalTokens(value: unknown): Generator<string> {
  if (typeof value === "string") yield* stringTokens(value);
  else if (value === null || typeof value === "number")
    yield JSON.stringify(value);
  else if (Array.isArray(value)) {
    // Numeric arrays are bounded four-number runs.
    if (typeof value[0] === "number") {
      yield JSON.stringify(value);
      return;
    }
    yield "[";
    for (let index = 0; index < value.length; index++) {
      if (index) yield ",";
      yield* canonicalTokens(value[index]);
    }
    yield "]";
  } else {
    const record = value as Record<string, unknown>;
    yield "{";
    let first = true;
    for (const key of Object.keys(record).sort(compare)) {
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key) + ":";
      yield* canonicalTokens(record[key]);
    }
    yield "}";
  }
}

/** Canonical UTF-8 plus LF. Reads only the detached capture; no I/O or save effects.
 * Failure/cancellation returns no partial bytes. Native publication is a caller concern.
 */
export async function encodeAgentExportSnapshot(
  snapshot: AgentExportSnapshot,
  options: AgentExportEncodeOptions = {},
): Promise<Uint8Array> {
  const limits = snapshots.get(snapshot);
  if (!limits)
    throw new TypeError("Expected a captured agent export snapshot.");
  const checkCanceled = () => {
    if (options.signal?.aborted)
      throw new AgentExportError("canceled", "export", "Encoding canceled.");
  };
  const yieldControl =
    options.yieldControl ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const pause = async () => {
    checkCanceled();
    await yieldControl();
    checkCanceled();
  };
  await pause();
  const encoder = new TextEncoder(),
    chunks: Uint8Array[] = [];
  let total = 0,
    pending = "";
  const flush = () => {
    const bytes = encoder.encode(pending);
    total += bytes.length;
    capacity(total, limits.maxBytes, "export.bytes");
    chunks.push(bytes);
    pending = "";
    options.onProgress?.(total);
  };
  for (const token of canonicalTokens(snapshot.map)) {
    pending += token;
    if (pending.length >= 32_768) {
      flush();
      await pause();
    }
  }
  pending += "\n";
  flush();
  checkCanceled();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    bytes.set(chunks[index], offset);
    offset += chunks[index].length;
    if ((index + 1) % 16 === 0) await pause();
  }
  checkCanceled();
  return bytes;
}
