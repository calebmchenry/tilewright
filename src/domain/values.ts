/** Stable, caller-supplied identities. Names and paint colors are not identities. */
declare const identity: unique symbol;
export type LayerId = string & { readonly [identity]: "layer" };
export type RegistryId = string & { readonly [identity]: "registry" };
export type AnnotationId = string & { readonly [identity]: "annotation" };

function checkedId(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
  ) {
    throw new TypeError(
      "Identities must be 1–128 ASCII letters, digits, dots, colons, underscores, or hyphens.",
    );
  }
  return value;
}

export const layerId = (value: string): LayerId => checkedId(value) as LayerId;
export const registryId = (value: string): RegistryId =>
  checkedId(value) as RegistryId;
export const annotationId = (value: string): AnnotationId =>
  checkedId(value) as AnnotationId;

export type TileValue =
  | Readonly<{ kind: "raw"; rgba: string }>
  | Readonly<{ kind: "registered"; registryId: RegistryId }>;
/** Empty is absence, never a color (even fully transparent raw paint is occupied). */
export type Cell = TileValue | null;

export function rawColor(rgba: string): TileValue {
  if (typeof rgba !== "string" || !/^#[0-9a-fA-F]{8}$/.test(rgba)) {
    throw new TypeError("Raw color must be #RRGGBBAA.");
  }
  return Object.freeze({ kind: "raw", rgba: rgba.toLowerCase() });
}

export function registeredColor(id: RegistryId): TileValue {
  return Object.freeze({ kind: "registered", registryId: registryId(id) });
}

/** Validate and detach caller-owned input; retained data is immutable. */
export function copyCell(cell: Cell): Cell {
  if (cell === null) return null;
  if (cell?.kind === "raw") return rawColor(cell.rgba);
  if (cell?.kind === "registered") return registeredColor(cell.registryId);
  throw new TypeError(
    "A cell must be null, raw paint, or a registered association.",
  );
}

export function equalCells(a: Cell, b: Cell): boolean {
  return a === b || (a !== null && b !== null && cellKey(a) === cellKey(b));
}

export function cellKey(value: TileValue): string {
  return value.kind === "raw"
    ? `raw:${value.rgba}`
    : `registered:${value.registryId}`;
}
