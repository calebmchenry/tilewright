import { assertBounds, type Bounds } from "./coordinates.ts";
import type { MapDocument, TileWrite } from "./document.ts";
import { registryEntry } from "./registry.ts";
import {
  captureSelection,
  transformSelection,
  type SelectionTransform,
  selectionFits,
  type SelectionPayload,
} from "./selection.ts";
import type { LayerId } from "./values.ts";

/** Provenance is deliberately nonserializable and narrower than document identity. */
const owners = new WeakMap<
  SelectionPayload,
  { document: MapDocument; session: object }
>();

export function captureClipboard(
  document: MapDocument,
  session: object,
  bounds: Bounds,
  layerIds: readonly LayerId[],
): SelectionPayload {
  const payload = captureSelection(document, bounds, layerIds);
  owners.set(payload, { document, session });
  return payload;
}

/** Old tile versions are allowed; original layer and named-color identities are not optional. */
export function validateClipboard(
  document: MapDocument,
  session: object,
  payload: SelectionPayload,
  hidden: readonly LayerId[] = [],
): void {
  const owner = owners.get(payload);
  if (owner?.document !== document || owner.session !== session)
    throw new Error(
      "Cross-document paste is not supported. Copy tiles in this document session.",
    );
  const checked = new Set<string>();
  for (const layer of payload.layers) {
    if (!document.layers.some(({ id }) => id === layer.layerId))
      throw new Error(
        `Copied layer ${layer.layerId} is missing. Undo its removal or copy another selection.`,
      );
    if (hidden.includes(layer.layerId))
      throw new Error(
        `Copied layer ${layer.layerId} is hidden. Show it before pasting.`,
      );
    for (const { value } of layer.runs) {
      if (value.kind !== "registered" || checked.has(value.registryId))
        continue;
      let entry;
      try {
        entry = registryEntry(document, value.registryId);
      } catch (error) {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}. Undo its removal or repair this original named color before pasting.`,
        );
      }
      if (
        document.registryEntries.some(
          ([id, record]) =>
            id !== value.registryId &&
            typeof record.rgba === "string" &&
            record.rgba.toLowerCase() === entry.rgba,
        )
      )
        throw new Error(
          `Named color ${value.registryId} has ambiguous ownership. Restore its unique color before pasting.`,
        );
      checked.add(value.registryId);
    }
  }
}

export function clipboardBounds(
  payload: SelectionPayload,
  x: number,
  y: number,
): Bounds {
  const bounds = {
    minX: x,
    minY: y,
    maxX: x + payload.width,
    maxY: y + payload.height,
  };
  assertBounds(bounds);
  return Object.freeze(bounds);
}

/** Sparse holes never generate writes. Every layer uses the shared top-left anchor. */
export function planClipboardPaste(
  document: MapDocument,
  session: object,
  payload: SelectionPayload,
  x: number,
  y: number,
  hidden: readonly LayerId[] = [],
): { readonly bounds: Bounds; readonly writes: readonly TileWrite[] } {
  validateClipboard(document, session, payload, hidden);
  const bounds = clipboardBounds(payload, x, y);
  if (!selectionFits(document.bounds, bounds))
    throw new RangeError(
      "The entire pasted rectangle must fit inside the map. Reposition it or cancel and Grow Canvas.",
    );
  const writes = payload.layers.flatMap((layer) =>
    layer.runs.map((run) =>
      Object.freeze({
        layerId: layer.layerId,
        x: x + run.x,
        y: y + run.y,
        length: run.length,
        value: run.value,
      }),
    ),
  );
  return Object.freeze({ bounds, writes: Object.freeze(writes) });
}

export function planClipboardCut(
  document: MapDocument,
  session: object,
  payload: SelectionPayload,
  hidden: readonly LayerId[] = [],
): readonly TileWrite[] {
  validateClipboard(document, session, payload, hidden);
  if (
    payload.documentVersion !== document.version ||
    !selectionFits(document.bounds, payload.bounds)
  )
    throw new Error(
      "Selection changed before Cut. Copy or cut the selection again.",
    );
  return Object.freeze(
    payload.layers.flatMap((layer) =>
      layer.runs.map((run) =>
        Object.freeze({
          layerId: layer.layerId,
          x: payload.bounds.minX + run.x,
          y: payload.bounds.minY + run.y,
          length: run.length,
          value: null,
        }),
      ),
    ),
  );
}

/** Derive a preview without changing the stored clipboard or widening provenance. */
export function transformClipboard(
  payload: SelectionPayload,
  operation: SelectionTransform,
): SelectionPayload {
  const owner = owners.get(payload);
  if (!owner) throw new Error("Unknown clipboard snapshot.");
  const result = transformSelection(payload, operation);
  owners.set(result, owner);
  return result;
}
