import type { Bounds } from "../domain/coordinates.ts";
import type { DocumentChange } from "../domain/document.ts";
import type { AnnotationId, LayerId, RegistryId } from "../domain/values.ts";

export interface CanvasInvalidation {
  readonly regions: readonly (Bounds & { readonly layerId: LayerId })[];
  readonly composition: boolean;
  readonly bounds: boolean;
  readonly registryIds: readonly RegistryId[];
  readonly annotationIds: readonly AnnotationId[];
}

/** Preserve exact world spans; never turn a tile edit into a document revision prop. */
export function canvasInvalidation(change: DocumentChange): CanvasInvalidation {
  const regions: (Bounds & { layerId: LayerId })[] = [];
  const registryIds = new Set<RegistryId>();
  const annotationIds = new Set<AnnotationId>();
  let composition = false,
    bounds = false;
  for (const part of change.kind === "transaction"
    ? change.changes
    : [change]) {
    switch (part.kind) {
      case "tiles":
        for (const run of part.runs)
          regions.push(
            Object.freeze({
              layerId: run.layerId,
              minX: run.x,
              minY: run.y,
              maxX: run.x + run.length,
              maxY: run.y + 1,
            }),
          );
        break;
      case "layers":
        // Names are panel data; only membership/order alters composition.
        composition ||=
          part.before.length !== part.after.length ||
          part.before.some((layer, i) => layer.id !== part.after[i]?.id);
        break;
      case "bounds":
        bounds = true;
        break;
      case "registry":
        // Names are metadata UI only; retain all registry events in document history.
        if (!part.before || !part.after || part.before.rgba !== part.after.rgba)
          registryIds.add(part.id);
        break;
      case "annotation":
        annotationIds.add(part.id);
        break;
    }
  }
  return Object.freeze({
    regions: Object.freeze(regions),
    composition,
    bounds,
    registryIds: Object.freeze([...registryIds]),
    annotationIds: Object.freeze([...annotationIds]),
  });
}

export function hasInvalidation(value: CanvasInvalidation): boolean {
  return !!(
    value.regions.length ||
    value.composition ||
    value.bounds ||
    value.registryIds.length ||
    value.annotationIds.length
  );
}
