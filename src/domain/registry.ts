import {
  normalizePaintColor,
  type ColorInput,
  type PaintColor,
} from "./colors.ts";
import {
  copyCommand,
  type DocumentCommand,
  type JsonObject,
} from "./commands.ts";
import type { MapDocument, TileWrite } from "./document.ts";
import type { CommandHistory } from "./history.ts";
import {
  rawColor,
  registeredColor,
  registryId,
  type RegistryId,
} from "./values.ts";

export interface RegistryEntry extends JsonObject {
  readonly name: string;
  readonly rgba: PaintColor;
}
export type RegistryRequest =
  | Readonly<{ kind: "add"; name: string; color: ColorInput; adopt: boolean }>
  | Readonly<{ kind: "edit"; id: RegistryId; name: string; color: ColorInput }>
  | Readonly<{ kind: "adopt" | "remove"; id: RegistryId }>;
export interface RegistryPlan {
  readonly kind: RegistryRequest["kind"];
  readonly id: RegistryId;
  readonly entry: RegistryEntry;
  readonly version: number;
  readonly cellCount: number;
  readonly layerCount: number;
}

/** Legacy metadata remains untouched; authoring rejects malformed targets. */
export function registryEntry(
  document: MapDocument,
  id: RegistryId,
): RegistryEntry {
  registryId(id);
  const record = document.getRegistryEntry(id);
  if (!record)
    throw new RangeError(`Named color is no longer available: ${id}`);
  const color =
    typeof record.rgba === "string" ? normalizePaintColor(record.rgba) : null;
  if (
    typeof record.name !== "string" ||
    !record.name.trim() ||
    typeof record.rgba !== "string" ||
    !color ||
    record.rgba.toLowerCase() !== color
  )
    throw new TypeError(`Invalid named color record: ${id}`);
  return Object.freeze({ ...record, name: record.name, rgba: color });
}

export class RegistryCollisionError extends Error {
  readonly owners: readonly (readonly [RegistryId, RegistryEntry])[];
  constructor(owners: readonly (readonly [RegistryId, RegistryEntry])[]) {
    super(
      `Color already belongs to ${owners.map(([, entry]) => `“${entry.name}”`).join(", ")}. Choose the existing entry or a different color.`,
    );
    this.owners = Object.freeze(owners);
  }
}

function ownersOf(document: MapDocument, color: PaintColor) {
  return document.registryEntries.flatMap(([id, record]) =>
    typeof record.rgba === "string" &&
    normalizePaintColor(record.rgba) === color
      ? [Object.freeze([id, registryEntry(document, id)] as const)]
      : [],
  );
}

/** Feature policy around the generic metadata seam. Plans are immutable, private
 * command batches bound to one controller/version; dropping/canceling is inert. */
export class RegistryCommands {
  readonly history: CommandHistory;
  #newId: () => RegistryId;
  #plans = new WeakMap<RegistryPlan, readonly DocumentCommand[]>();

  constructor(
    history: CommandHistory,
    newId = () => registryId(`registry-${crypto.randomUUID()}`),
  ) {
    this.history = history;
    this.#newId = newId;
  }

  prepare(
    request: RegistryRequest,
    expectedVersion = this.history.document.version,
    signal?: { readonly aborted: boolean },
  ): RegistryPlan {
    const document = this.history.document;
    if (document.version !== expectedVersion)
      throw new Error(
        "The map changed. Refresh the preview and review the counts before continuing.",
      );
    const checkCanceled = () => {
      if (signal?.aborted) throw new Error("Registry planning canceled.");
    };
    checkCanceled();
    let id: RegistryId;
    let entry: RegistryEntry;
    if (request.kind === "add" || request.kind === "edit") {
      if (typeof request.name !== "string" || !request.name.trim())
        throw new TypeError("Enter a name for this color.");
      const rgba = normalizePaintColor(request.color);
      if (!rgba)
        throw new TypeError(
          "Enter a valid fully opaque hex color or RGB whole numbers from 0 to 255.",
        );
      const previous =
        request.kind === "edit" ? registryEntry(document, request.id) : null;
      if (previous && ownersOf(document, previous.rgba).length !== 1)
        throw new Error(
          "Ambiguous existing color ownership. No changes were made.",
        );
      const owners = ownersOf(document, rgba).filter(
        ([owner]) => request.kind !== "edit" || owner !== request.id,
      );
      if (owners.length) throw new RegistryCollisionError(owners);
      id = request.kind === "edit" ? request.id : registryId(this.#newId());
      if (request.kind === "add" && document.getRegistryEntry(id))
        throw new Error("Duplicate registry identity. No changes were made.");
      entry = Object.freeze({ ...previous, name: request.name.trim(), rgba });
    } else if (request.kind === "adopt" || request.kind === "remove") {
      id = request.id;
      entry = registryEntry(document, id);
      if (ownersOf(document, entry.rgba).length !== 1)
        throw new Error(
          "Ambiguous existing color ownership. No changes were made.",
        );
    } else throw new TypeError("Unknown registry operation.");

    const writes: TileWrite[] = [];
    const layers = new Set<string>();
    let cellCount = 0;
    // Count raw matches even when add's adoption checkbox is off. Scan occupied
    // spans only, including hidden/covered layers, never the canvas rectangle.
    if (request.kind !== "edit") {
      for (const run of document.iterateRuns()) {
        checkCanceled();
        const matches =
          request.kind === "remove"
            ? run.value.kind === "registered" && run.value.registryId === id
            : run.value.kind === "raw" && run.value.rgba === entry.rgba;
        if (!matches) continue;
        cellCount += run.length;
        layers.add(run.layerId);
        if (request.kind !== "add" || request.adopt)
          writes.push({
            ...run,
            value:
              request.kind === "remove"
                ? rawColor(entry.rgba)
                : registeredColor(id),
          });
      }
    }
    const commands: DocumentCommand[] = [];
    if (
      request.kind === "add" ||
      (request.kind === "edit" &&
        (registryEntry(document, id).name !== entry.name ||
          registryEntry(document, id).rgba !== entry.rgba))
    )
      commands.push({ kind: "registry", id, value: entry });
    if (writes.length) commands.push({ kind: "tiles", writes });
    if (request.kind === "remove")
      commands.push({ kind: "registry", id, value: null });
    checkCanceled();
    const plan = Object.freeze({
      kind: request.kind,
      id,
      entry,
      version: document.version,
      cellCount,
      layerCount: layers.size,
    });
    this.#plans.set(plan, Object.freeze(commands.map(copyCommand)));
    return plan;
  }

  cancel(plan: RegistryPlan): void {
    this.#plans.delete(plan);
  }

  commit(plan: RegistryPlan) {
    const commands = this.#plans.get(plan);
    if (!commands)
      throw new Error(
        "Registry preview is canceled, already submitted, or belongs to another session.",
      );
    this.#plans.delete(plan);
    if (plan.version !== this.history.document.version)
      throw new Error(
        "The map changed. Refresh the preview and review the counts before continuing.",
      );
    const labels = {
      add: "Register color",
      edit: "Edit named color",
      adopt: "Adopt matching raw tiles",
      remove: "Remove named color",
    };
    return this.history.execute(labels[plan.kind], commands);
  }
}
