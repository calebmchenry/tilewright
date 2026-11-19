import type { JsonObject } from "./commands.ts";
import { assertBounds, type Bounds } from "./coordinates.ts";
import type { MapDocument } from "./document.ts";
import type { CommandHistory } from "./history.ts";
import { annotationId, type AnnotationId } from "./values.ts";

export const areaTiers = ["detail", "locality", "region"] as const;
export type AreaTier = (typeof areaTiers)[number];
export interface NamedArea extends JsonObject {
  readonly name: string;
  readonly description: string;
  readonly tier: AreaTier;
  readonly bounds: Bounds & JsonObject;
  readonly label: Readonly<{ placement: "center" }>;
}
export type AreaField = "name" | "description" | "tier" | "bounds" | "label";
export class AreaValidationError extends Error {
  readonly fields: Readonly<Partial<Record<AreaField, string>>>;
  constructor(fields: Partial<Record<AreaField, string>>) {
    super(Object.values(fields).join(" "));
    this.fields = Object.freeze({ ...fields });
  }
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Validate the complete feature record before any command reaches the document. */
export function validateNamedArea(value: unknown, map: Bounds): NamedArea {
  const record = object(value);
  const fields: Partial<Record<AreaField, string>> = {};
  if (
    typeof record.name !== "string" ||
    !record.name.trim() ||
    /[\r\n\u2028\u2029]/u.test(record.name)
  )
    fields.name = "Enter a nonblank, single-line area name.";
  if (typeof record.description !== "string")
    fields.description =
      "Description must be text; an empty description is allowed.";
  if (!areaTiers.includes(record.tier as AreaTier))
    fields.tier = "Choose Detail, Locality or Region.";
  const bounds = object(record.bounds);
  const rectangle = {
    minX: bounds.minX as number,
    minY: bounds.minY as number,
    maxX: bounds.maxX as number,
    maxY: bounds.maxY as number,
  };
  try {
    assertBounds(rectangle);
    if (
      rectangle.minX < map.minX ||
      rectangle.minY < map.minY ||
      rectangle.maxX > map.maxX ||
      rectangle.maxY > map.maxY
    )
      throw new Error();
  } catch {
    fields.bounds =
      "Bounds must form a nonempty rectangle inside the map, with safe whole-number endpoints and dimensions. Maximums are exclusive.";
  }
  const label = object(record.label);
  if (label.placement !== "center" || Object.keys(label).length !== 1)
    fields.label = "Label placement must be center.";
  if (Object.keys(fields).length) throw new AreaValidationError(fields);
  return Object.freeze({
    name: (record.name as string).trim(),
    description: record.description as string,
    tier: record.tier as AreaTier,
    bounds: Object.freeze(rectangle),
    label: Object.freeze({ placement: "center" }),
  });
}

export function namedArea(document: MapDocument, id: AnnotationId): NamedArea {
  const record = document.getAnnotation(annotationId(id));
  if (!record) throw new RangeError("This area is no longer available.");
  return validateNamedArea(record, document.bounds);
}

export type AreaRequest =
  | { readonly kind: "create"; readonly value: unknown }
  | {
      readonly kind: "edit";
      readonly id: AnnotationId;
      readonly value: unknown;
    }
  | { readonly kind: "remove"; readonly id: AnnotationId };

/** Explicit annotation-only edits; generic JSON metadata stays an independent seam. */
export class AnnotationCommands {
  readonly history: CommandHistory;
  #newId: () => AnnotationId;
  constructor(
    history: CommandHistory,
    newId = () => annotationId(`area-${crypto.randomUUID()}`),
  ) {
    this.history = history;
    this.#newId = newId;
  }
  execute(request: AreaRequest) {
    const document = this.history.document;
    if (!["create", "edit", "remove"].includes(request.kind))
      throw new TypeError("Unknown area operation.");
    const value =
      request.kind === "remove"
        ? null
        : validateNamedArea(request.value, document.bounds);
    const id = annotationId(
      request.kind === "create" ? this.#newId() : request.id,
    );
    if (request.kind === "create") {
      if (document.getAnnotation(id))
        throw new Error("Duplicate area identity. No changes were made.");
    } else namedArea(document, id);
    const label =
      request.kind === "create"
        ? "Create area"
        : request.kind === "edit"
          ? "Edit area"
          : "Delete area";
    return {
      id,
      result: this.history.execute(label, [{ kind: "annotation", id, value }]),
    };
  }
}
