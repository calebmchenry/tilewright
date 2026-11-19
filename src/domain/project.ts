import { validateNamedArea, AreaValidationError } from "./annotations.ts";
import { validateCanvasBounds } from "./canvas.ts";
import type { CommandHistory, RevisionCheckpoint } from "./history.ts";
import { cellKey, type TileValue } from "./values.ts";
import {
  checkProjectCapacity,
  projectLimits,
  ProjectEncodingError,
  type ProjectLimits,
  type ProjectPreferences,
  type ProjectRun,
  type ProjectV1,
} from "./project-format.ts";

export interface ProjectSnapshot {
  readonly checkpoint: RevisionCheckpoint;
  readonly documentVersion: number;
  readonly project: ProjectV1;
}
export interface ProjectCaptureOptions {
  /** Callers may impose stricter capacities, never raise the format policy ceilings. */
  readonly limits?: Partial<ProjectLimits>;
}
// Only fully validated, immutable snapshots produced here may reach the writer.
const snapshots = new WeakMap<ProjectSnapshot, ProjectLimits>();
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function invalid(path: string, message: string): never {
  throw new ProjectEncodingError("invalid-data", path, message);
}
function keys(value: unknown, expected: readonly string[], path: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "Expected an object.");
  const actual = Object.keys(value);
  for (const key of actual)
    if (!expected.includes(key))
      invalid(`${path}.${key}`, "Unrepresentable v1 property.");
  for (const key of expected)
    if (!actual.includes(key))
      invalid(`${path}.${key}`, "Required property is missing.");
}

/** Detach one committed revision BEFORE any await or user scheduling callback.
 * Map metadata/paint values are already deeply immutable. Run arrays and preference
 * arrays are copied; no live iterator, storage token or controller is retained.
 */
export function captureProjectSnapshot(
  history: CommandHistory,
  preferences: ProjectPreferences,
  options: ProjectCaptureOptions = {},
): ProjectSnapshot {
  const document = history.document;
  document.assertCommittedRead();
  const checkpoint = history.captureCheckpoint();
  const documentVersion = document.version;
  const limits = projectLimits(options.limits);
  const bounds = document.bounds;
  try {
    validateCanvasBounds(bounds);
  } catch (error) {
    invalid("document.bounds", (error as Error).message);
  }
  const sourceLayers = document.layers;
  checkProjectCapacity(
    sourceLayers.length,
    limits.maxLayers,
    "document.layers",
  );
  const layerIds = new Set<string>(sourceLayers.map((layer) => layer.id));
  const activeLayerId = preferences.activeLayerId;
  if (!layerIds.has(activeLayerId))
    invalid("editor.activeLayerId", "Unknown layer.");
  const hiddenLayerIds = [...preferences.hiddenLayerIds];
  const hidden = new Set<string>();
  for (const [index, id] of hiddenLayerIds.entries()) {
    if (!layerIds.has(id) || hidden.has(id))
      invalid(
        `editor.hiddenLayerIds[${index}]`,
        "Expected a unique existing layer.",
      );
    hidden.add(id);
  }
  hiddenLayerIds.sort(compare);

  const sourceRegistry = document.registryEntries;
  checkProjectCapacity(
    sourceRegistry.length,
    limits.maxRegistryEntries,
    "document.registry",
  );
  const registryIds = new Set<string>(),
    registryColors = new Set<string>();
  const registry = sourceRegistry.map(([id, record], index) => {
    const path = `document.registry[${index}]`;
    keys(record, ["name", "rgba"], path);
    if (typeof record.name !== "string" || !record.name.trim())
      invalid(`${path}.name`, "Expected a nonblank name.");
    if (
      typeof record.rgba !== "string" ||
      !/^#[0-9a-f]{6}ff$/.test(record.rgba)
    )
      invalid(`${path}.rgba`, "Expected a lowercase opaque RGBA color.");
    if (registryColors.has(record.rgba))
      invalid(`${path}.rgba`, "Color has multiple registry owners.");
    registryIds.add(id);
    registryColors.add(record.rgba);
    return Object.freeze({ id, name: record.name, rgba: record.rgba });
  });
  const sourceAreas = document.annotations;
  checkProjectCapacity(
    sourceAreas.length,
    limits.maxAnnotations,
    "document.annotations",
  );
  const annotations = sourceAreas.map(([id, record], index) => {
    const path = `document.annotations[${index}]`;
    keys(record, ["name", "description", "tier", "bounds", "label"], path);
    keys(record.bounds, ["minX", "minY", "maxX", "maxY"], `${path}.bounds`);
    keys(record.label, ["placement"], `${path}.label`);
    if (typeof record.name === "string" && record.name !== record.name.trim())
      invalid(`${path}.name`, "Area names must already be trimmed.");
    try {
      return Object.freeze({ id, ...validateNamedArea(record, bounds) });
    } catch (error) {
      const field =
        error instanceof AreaValidationError
          ? Object.keys(error.fields)[0]
          : null;
      invalid(field ? `${path}.${field}` : path, (error as Error).message);
    }
  });

  const paints: TileValue[] = [];
  const indices = new Map<string, number>();
  let runCount = 0,
    occupiedCells = 0;
  const layers = sourceLayers.map((layer, layerIndex) => {
    const runs: [number, number, number, number][] = [];
    for (const run of document.iterateRuns(layer.id)) {
      const path = `document.layers[${layerIndex}].runs[${runs.length}]`;
      checkProjectCapacity(++runCount, limits.maxRuns, path);
      occupiedCells += run.length;
      checkProjectCapacity(occupiedCells, limits.maxOccupiedCells, path);
      const value = run.value,
        key = cellKey(value);
      let index = indices.get(key);
      if (index === undefined) {
        if (value.kind === "registered" && !registryIds.has(value.registryId))
          invalid(
            `${path}[3]`,
            `Unresolved registry identity: ${value.registryId}.`,
          );
        checkProjectCapacity(
          paints.length + 1,
          limits.maxPaletteEntries,
          "document.palette",
        );
        index = paints.length;
        indices.set(key, index);
        paints.push(value);
      }
      runs.push([run.x, run.y, run.length, index]);
    }
    return { id: layer.id, name: layer.name, runs };
  });
  const palette = [...paints].sort((a, b) => compare(cellKey(a), cellKey(b)));
  const canonicalIndices = new Map(
    palette.map((value, index) => [cellKey(value), index]),
  );
  const remap = paints.map((value) => canonicalIndices.get(cellKey(value))!);
  const frozenLayers = layers.map((layer) => {
    const runs: readonly ProjectRun[] = Object.freeze(
      layer.runs.map((run) => {
        run[3] = remap[run[3]];
        return Object.freeze(run);
      }),
    );
    return Object.freeze({ id: layer.id, name: layer.name, runs });
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
  const project: ProjectV1 = Object.freeze({
    format: "tilewright-project",
    version: 1,
    document: Object.freeze({
      bounds,
      palette: Object.freeze(palette),
      layers: Object.freeze(frozenLayers),
      registry: Object.freeze(registry),
      annotations: Object.freeze(annotations),
    }),
    editor: Object.freeze({
      activeLayerId,
      hiddenLayerIds: Object.freeze(hiddenLayerIds),
    }),
  });
  const snapshot = Object.freeze({ checkpoint, documentVersion, project });
  snapshots.set(snapshot, limits);
  return snapshot;
}

export interface ProjectEncodeOptions {
  readonly signal?: { readonly aborted: boolean };
  /** Test/host scheduling seam; the default yields to a timer task. */
  readonly yieldControl?: () => Promise<void>;
}

/** ECMAScript escaping, bounded even for a large description. Keep surrogate pairs
 * together so slicing produces exactly the same bytes as JSON.stringify(text).
 */
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

/** Only visits our validated wire shape (maximum container depth 6). */
function* canonicalTokens(value: unknown): Generator<string> {
  if (typeof value === "string") yield* stringTokens(value);
  else if (typeof value === "number") yield JSON.stringify(value);
  else if (Array.isArray(value)) {
    // Every numeric array is a four-number run, so serialize it in one small step.
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

/** Canonical UTF-8 bytes, no BOM, one trailing LF. Never reads the live document,
 * performs I/O, or acknowledges a saved/recovery checkpoint. The caller keeps
 * snapshot.checkpoint and acknowledges it only after the corresponding write.
 */
export async function encodeProjectSnapshot(
  snapshot: ProjectSnapshot,
  options: ProjectEncodeOptions = {},
): Promise<Uint8Array> {
  const limits = snapshots.get(snapshot);
  if (!limits) throw new TypeError("Expected a captured project snapshot.");
  const checkCanceled = () => {
    if (options.signal?.aborted)
      throw new ProjectEncodingError(
        "canceled",
        "project",
        "Encoding canceled.",
      );
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
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let total = 0,
    pending = "";
  const flush = () => {
    const bytes = encoder.encode(pending);
    total += bytes.length;
    checkProjectCapacity(total, limits.maxBytes, "project.bytes");
    chunks.push(bytes);
    pending = "";
  };
  for (const token of canonicalTokens(snapshot.project)) {
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
