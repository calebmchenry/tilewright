import { AreaValidationError, validateNamedArea } from "./annotations.ts";
import { validateCanvasBounds } from "./canvas.ts";
import type { Bounds } from "./coordinates.ts";
import { MapDocument, type TileWrite } from "./document.ts";
import {
  ProjectDecodingError,
  projectLimits,
  type ProjectLimits,
  type ProjectPreferences,
  type ProjectV1,
} from "./project-format.ts";
import { parseProjectJson } from "./project-json.ts";
import {
  annotationId,
  cellKey,
  layerId,
  rawColor,
  registeredColor,
  registryId,
  type TileValue,
} from "./values.ts";

export interface ProjectDecodeOptions {
  readonly limits?: Partial<ProjectLimits>;
  readonly signal?: { readonly aborted: boolean };
  /** Defaults to a timer task. Exceptions reject without publishing a candidate. */
  readonly yieldControl?: () => Promise<void>;
}
export interface DecodedProject {
  readonly document: MapDocument;
  readonly preferences: ProjectPreferences;
}
function invalid(path: string, message: string): never {
  throw new ProjectDecodingError("invalid-data", path, message);
}
function capacity(count: number, limit: number, path: string): void {
  if (!Number.isSafeInteger(count) || count > limit)
    throw new ProjectDecodingError(
      "capacity",
      path,
      `Exceeds project capacity (${limit}).`,
    );
}
function object(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "Expected an object.");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record))
    if (!keys.includes(key)) invalid(`${path}.${key}`, "Unknown v1 property.");
  for (const key of keys)
    if (!Object.hasOwn(record, key))
      invalid(`${path}.${key}`, "Required property is missing.");
  return record;
}
function array(value: unknown, limit: number, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path, "Expected an array.");
  capacity(value.length, limit, path);
  return value;
}
function name(value: unknown, path: string): void {
  if (typeof value !== "string" || !value.trim())
    invalid(path, "Expected a nonblank name.");
}
function identity(value: unknown, seen: Set<string>, path: string): void {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
  )
    invalid(path, "Expected a valid 1–128 character identity.");
  if (seen.has(value)) invalid(path, "Duplicate identity.");
  seen.add(value);
}
function bounds(value: unknown, path: string): Bounds {
  const record = object(value, ["minX", "minY", "maxX", "maxY"], path);
  try {
    return validateCanvasBounds(record as unknown as Bounds);
  } catch (error) {
    return invalid(path, (error as Error).message);
  }
}

/** Complete schema/reference/capacity pass before ANY tile storage is created. */
function* validate(
  value: unknown,
  limits: ProjectLimits,
): Generator<void, ProjectV1> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("project", "Expected an object.");
  const root = value as Record<string, unknown>;
  if (root.format !== "tilewright-project")
    invalid(
      "format",
      "Expected tilewright-project; exports are not editable projects.",
    );
  if (!Number.isSafeInteger(root.version) || (root.version as number) < 1)
    invalid("version", "Expected a positive integer schema version.");
  if (root.version !== 1)
    throw new ProjectDecodingError(
      "unsupported-version",
      "version",
      `Project version ${root.version} is unsupported; this reader supports version 1 only. No migration is available.`,
    );
  object(root, ["format", "version", "document", "editor"], "project");
  const doc = object(
    root.document,
    ["bounds", "palette", "layers", "registry", "annotations"],
    "document",
  );
  const map = bounds(doc.bounds, "document.bounds");
  const layers = array(doc.layers, limits.maxLayers, "document.layers");
  if (!layers.length)
    invalid("document.layers", "At least one layer is required.");
  const registry = array(
    doc.registry,
    limits.maxRegistryEntries,
    "document.registry",
  );
  const palette = array(
    doc.palette,
    limits.maxPaletteEntries,
    "document.palette",
  );
  const areas = array(
    doc.annotations,
    limits.maxAnnotations,
    "document.annotations",
  );
  const registryIds = new Set<string>(),
    registryColors = new Set<string>();
  for (let i = 0; i < registry.length; i++) {
    const path = `document.registry[${i}]`;
    const entry = object(registry[i], ["id", "name", "rgba"], path);
    identity(entry.id, registryIds, `${path}.id`);
    name(entry.name, `${path}.name`);
    if (typeof entry.rgba !== "string" || !/^#[0-9a-f]{6}ff$/.test(entry.rgba))
      invalid(`${path}.rgba`, "Expected a lowercase opaque RGBA color.");
    if (registryColors.has(entry.rgba))
      invalid(`${path}.rgba`, "Color has multiple registry owners.");
    registryColors.add(entry.rgba);
    if (i % 512 === 0) yield;
  }
  const paintKeys = new Set<string>();
  for (let i = 0; i < palette.length; i++) {
    const path = `document.palette[${i}]`;
    const paint = palette[i] as Record<string, unknown> | null;
    if (!paint || !["raw", "registered"].includes(paint.kind as string))
      invalid(
        `${path}.kind`,
        "Expected raw or registered paint; empty cells are omitted.",
      );
    object(
      paint,
      paint.kind === "raw" ? ["kind", "rgba"] : ["kind", "registryId"],
      path,
    );
    if (paint.kind === "raw") {
      if (typeof paint.rgba !== "string" || !/^#[0-9a-f]{8}$/.test(paint.rgba))
        invalid(`${path}.rgba`, "Expected lowercase #rrggbbaa paint.");
    } else if (!registryIds.has(paint.registryId as string))
      invalid(`${path}.registryId`, "Unknown registry identity.");
    const key = cellKey(paint as unknown as TileValue);
    if (paintKeys.has(key)) invalid(path, "Duplicate palette value.");
    paintKeys.add(key);
    if (i % 512 === 0) yield;
  }
  let totalRuns = 0,
    totalCells = 0;
  const usedPaints = new Set<number>(),
    layerIds = new Set<string>();
  for (let i = 0; i < layers.length; i++) {
    const path = `document.layers[${i}]`;
    const layer = object(layers[i], ["id", "name", "runs"], path);
    identity(layer.id, layerIds, `${path}.id`);
    name(layer.name, `${path}.name`);
    const runs = array(layer.runs, limits.maxRuns, `${path}.runs`);
    totalRuns += runs.length;
    capacity(totalRuns, limits.maxRuns, `${path}.runs`);
    let previousY = -Infinity,
      previousEnd = -Infinity;
    for (let r = 0; r < runs.length; r++) {
      const at = `${path}.runs[${r}]`,
        run = runs[r];
      if (
        !Array.isArray(run) ||
        run.length !== 4 ||
        !run.every(Number.isSafeInteger)
      )
        invalid(
          at,
          "Expected [x, y, length, paintIndex] with four safe integers.",
        );
      const [x, y, length, index] = run as number[];
      const end = x + length;
      if (
        length <= 0 ||
        !Number.isSafeInteger(end) ||
        x < map.minX ||
        end > map.maxX ||
        y < map.minY ||
        y >= map.maxY
      )
        invalid(
          at,
          "Run must have positive length and fit entirely inside map bounds with a safe endpoint.",
        );
      if (y < previousY || (y === previousY && x < previousEnd))
        invalid(at, "Runs must be sorted by y then x and must not overlap.");
      if (index < 0 || index >= palette.length)
        invalid(`${at}[3]`, "Unknown palette index.");
      previousY = y;
      previousEnd = end;
      totalCells += length;
      capacity(totalCells, limits.maxOccupiedCells, at);
      usedPaints.add(index);
      if (r % 512 === 0) yield;
    }
    yield;
  }
  if (usedPaints.size !== palette.length)
    invalid("document.palette", "Every palette entry must be used by a run.");
  const areaIds = new Set<string>();
  for (let i = 0; i < areas.length; i++) {
    const path = `document.annotations[${i}]`;
    const area = object(
      areas[i],
      ["id", "name", "description", "tier", "bounds", "label"],
      path,
    );
    identity(area.id, areaIds, `${path}.id`);
    bounds(area.bounds, `${path}.bounds`);
    object(area.label, ["placement"], `${path}.label`);
    if (typeof area.name === "string" && area.name !== area.name.trim())
      invalid(`${path}.name`, "Area names must already be trimmed.");
    try {
      validateNamedArea(area, map);
    } catch (error) {
      const field =
        error instanceof AreaValidationError
          ? Object.keys(error.fields)[0]
          : null;
      invalid(field ? `${path}.${field}` : path, (error as Error).message);
    }
    if (i % 512 === 0) yield;
  }
  const editor = object(
    root.editor,
    ["activeLayerId", "hiddenLayerIds"],
    "editor",
  );
  if (!layerIds.has(editor.activeLayerId as string))
    invalid("editor.activeLayerId", "Unknown layer identity.");
  const hidden = array(
    editor.hiddenLayerIds,
    limits.maxLayers,
    "editor.hiddenLayerIds",
  );
  const seen = new Set<string>();
  for (let i = 0; i < hidden.length; i++) {
    const id = hidden[i] as string;
    if (!layerIds.has(id) || seen.has(id))
      invalid(
        `editor.hiddenLayerIds[${i}]`,
        "Expected a unique existing layer.",
      );
    seen.add(id);
  }
  return value as ProjectV1;
}

/** Decode bytes into a detached complete document. No history, native I/O or
 * active workspace is touched; callers publish only after this resolves.
 */
export async function decodeProject(
  bytes: Uint8Array,
  options: ProjectDecodeOptions = {},
): Promise<DecodedProject> {
  const limits = projectLimits(options.limits);
  const checkCanceled = () => {
    if (options.signal?.aborted)
      throw new ProjectDecodingError(
        "canceled",
        "project",
        "Project load canceled.",
      );
  };
  const pause = async () => {
    checkCanceled();
    await (
      options.yieldControl ??
      (() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    )();
    checkCanceled();
  };
  async function consume<T>(steps: Generator<void, T>): Promise<T> {
    let step = steps.next();
    while (!step.done) {
      await pause();
      step = steps.next();
    }
    checkCanceled();
    return step.value;
  }
  checkCanceled();
  if (!(bytes instanceof Uint8Array))
    invalid("project.bytes", "Expected UTF-8 bytes.");
  capacity(bytes.byteLength, limits.maxBytes, "project.bytes");
  // Own the input before the first await, including when supplied as a Node Buffer.
  const source = new Uint8Array(bytes);
  await pause();
  if (source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf)
    throw new ProjectDecodingError(
      "parse",
      "project.bytes",
      "UTF-8 BOM is not supported.",
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  for (let offset = 0; offset < source.length; offset += 32_768) {
    try {
      chunks.push(
        decoder.decode(source.subarray(offset, offset + 32_768), {
          stream: true,
        }),
      );
    } catch {
      throw new ProjectDecodingError(
        "parse",
        "project.bytes",
        `Invalid UTF-8 near byte ${offset}.`,
      );
    }
    await pause();
  }
  try {
    chunks.push(decoder.decode());
  } catch {
    throw new ProjectDecodingError(
      "parse",
      "project.bytes",
      "Truncated UTF-8 sequence.",
    );
  }
  const project = await consume(
    validate(await consume(parseProjectJson(chunks.join(""))), limits),
  );
  await pause();
  // Bounded writes by both count AND occupied cells; declared dimensions never
  // allocate tile storage. Long valid spans are split only for ingestion.
  function* populate(): Generator<void, MapDocument> {
    let at = "document";
    try {
      const document = new MapDocument({
        bounds: project.document.bounds,
        layers: project.document.layers.map(({ id, name }) => ({
          id: layerId(id),
          name,
        })),
      });
      for (const [i, { id, ...value }] of project.document.registry.entries()) {
        at = `document.registry[${i}]`;
        document.applyCommands([
          { kind: "registry", id: registryId(id), value },
        ]);
        if (i % 256 === 0) yield;
      }
      for (const [
        i,
        { id, ...value },
      ] of project.document.annotations.entries()) {
        at = `document.annotations[${i}]`;
        document.applyCommands([
          { kind: "annotation", id: annotationId(id), value },
        ]);
        if (i % 256 === 0) yield;
      }
      const paints: TileValue[] = [];
      for (const paint of project.document.palette) {
        paints.push(
          paint.kind === "raw"
            ? rawColor(paint.rgba)
            : registeredColor(registryId(paint.registryId)),
        );
        if (paints.length % 512 === 0) yield;
      }
      let batch: TileWrite[] = [],
        cells = 0;
      for (const [i, layer] of project.document.layers.entries()) {
        const id = layerId(layer.id);
        for (const [r, [x, y, length, index]] of layer.runs.entries()) {
          at = `document.layers[${i}].runs[${r}]`;
          for (let offset = 0; offset < length;) {
            const size = Math.min(length - offset, 16_384 - cells);
            batch.push({
              layerId: id,
              x: x + offset,
              y,
              length: size,
              value: paints[index],
            });
            cells += size;
            offset += size;
            if (cells === 16_384 || batch.length === 256) {
              document.writeBatch(batch);
              batch = [];
              cells = 0;
              yield;
            }
          }
        }
      }
      document.writeBatch(batch);
      yield;
      return document;
    } catch (error) {
      throw new ProjectDecodingError(
        "construction",
        at,
        `Could not construct project: ${(error as Error).message}`,
      );
    }
  }
  const document = await consume(populate());
  return Object.freeze({
    document,
    preferences: Object.freeze({
      activeLayerId: project.editor.activeLayerId,
      hiddenLayerIds: Object.freeze([...project.editor.hiddenLayerIds]),
    }),
  });
}
