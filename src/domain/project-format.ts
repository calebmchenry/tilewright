import type { NamedArea } from "./annotations.ts";
import type { Bounds } from "./coordinates.ts";
import type { TileValue } from "./values.ts";

/** Editable project wire types. Native paths, history and previews never belong here. */
export type ProjectRun = readonly [
  x: number,
  y: number,
  length: number,
  paintIndex: number,
];
export interface ProjectPreferences {
  readonly activeLayerId: string;
  readonly hiddenLayerIds: readonly string[];
}
export interface ProjectV1 {
  readonly format: "tilewright-project";
  readonly version: 1;
  readonly document: {
    readonly bounds: Bounds;
    readonly palette: readonly TileValue[];
    readonly layers: readonly {
      readonly id: string;
      readonly name: string;
      readonly runs: readonly ProjectRun[];
    }[];
    readonly registry: readonly {
      readonly id: string;
      readonly name: string;
      readonly rgba: string;
    }[];
    readonly annotations: readonly (NamedArea & { readonly id: string })[];
  };
  readonly editor: ProjectPreferences;
}

/** Shared writer/reader policy from docs/project-format.md; not a latency guarantee. */
export const PROJECT_LIMITS = Object.freeze({
  maxBytes: 268_435_456,
  maxLayers: 1_024,
  maxRegistryEntries: 65_536,
  maxAnnotations: 65_536,
  maxPaletteEntries: 1_000_000,
  maxRuns: 2_000_000,
  maxOccupiedCells: 100_000_000,
});
export const PROJECT_MAX_DEPTH = 8;
export type ProjectLimits = {
  readonly [K in keyof typeof PROJECT_LIMITS]: number;
};
export class ProjectEncodingError extends Error {
  readonly category: "invalid-data" | "capacity" | "canceled";
  readonly path: string;
  constructor(
    category: ProjectEncodingError["category"],
    path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "ProjectEncodingError";
    this.category = category;
    this.path = path;
  }
}

export function projectLimits(
  overrides: Partial<ProjectLimits> = {},
): ProjectLimits {
  const limits: { -readonly [K in keyof ProjectLimits]: number } = {
    ...PROJECT_LIMITS,
  };
  for (const key of Object.keys(overrides) as (keyof ProjectLimits)[]) {
    const value = overrides[key];
    if (
      !Object.hasOwn(PROJECT_LIMITS, key) ||
      !Number.isSafeInteger(value) ||
      value! < 1 ||
      value! > PROJECT_LIMITS[key]
    )
      throw new RangeError(
        `Project limit ${key} must be a positive integer no larger than the v1 ceiling.`,
      );
    limits[key] = value!;
  }
  return Object.freeze(limits);
}

export function checkProjectCapacity(
  value: number,
  limit: number,
  path: string,
): void {
  if (!Number.isSafeInteger(value) || value > limit)
    throw new ProjectEncodingError(
      "capacity",
      path,
      `Exceeds project capacity (${limit}).`,
    );
}
