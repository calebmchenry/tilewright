import { readFileSync } from "node:fs";
import { MapDocument } from "../../src/domain/document.ts";
import type { ProjectV1 } from "../../src/domain/project-format.ts";
import {
  annotationId,
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { loadFixtureDocument } from "./document.ts";
import { annotatePopulatedMap } from "./areas.ts";
import { FIXTURE_PALETTE, type FixtureRun, type FixtureSpec } from "./maps.ts";

export const exampleProject: ProjectV1 = JSON.parse(
  readFileSync(
    new URL("../../docs/examples/project-v1.tilewright", import.meta.url),
    "utf8",
  ),
);

/** Test construction from the reviewed fixture; deliberately NOT a project decoder. */
export function exampleDocument(reverse = false): MapDocument {
  const source = exampleProject.document;
  const document = new MapDocument({
    bounds: source.bounds,
    layers: source.layers.map(({ id, name }) => ({ id: layerId(id), name })),
  });
  const order = <T>(items: readonly T[]) =>
    reverse ? [...items].reverse() : items;
  document.applyCommands([
    ...order(source.registry).map(({ id, ...value }) => ({
      kind: "registry" as const,
      id: registryId(id),
      value,
    })),
    ...order(source.annotations).map(({ id, ...value }) => ({
      kind: "annotation" as const,
      id: annotationId(id),
      value,
    })),
  ]);
  for (const layer of order(source.layers))
    for (const [x, y, length, index] of order(layer.runs)) {
      const paint = source.palette[index];
      const value =
        paint.kind === "raw"
          ? rawColor(paint.rgba)
          : registeredColor(registryId(paint.registryId));
      // Different first-use token order and segmentation for equivalent content.
      if (reverse)
        for (let offset = length - 1; offset >= 0; offset--)
          document.setCell(layerId(layer.id), x + offset, y, value);
      else
        document.writeBatch([
          { layerId: layerId(layer.id), x, y, length, value },
        ]);
    }
  return document;
}

/** Add the feature records absent from the low-level storage-only fixture. */
export function populatedProjectDocument(spec: FixtureSpec): MapDocument {
  const document = loadFixtureDocument(spec);
  document.applyCommands(
    FIXTURE_PALETTE.flatMap((paint) =>
      paint.meaning === null
        ? []
        : [
            {
              kind: "registry" as const,
              id: registryId(paint.key),
              value: { name: paint.meaning, rgba: paint.rgba },
            },
          ],
    ),
  );
  annotatePopulatedMap(document);
  return document;
}

/** Independent wire readback into the existing golden oracle's row/layer lattice.
 * Reads every emitted run from parsed bytes, never the live model or its iterators.
 */
export function* fixtureRunsFromProject(
  project: ProjectV1,
): Generator<FixtureRun> {
  const positions = project.document.layers.map(() => 0);
  while (true) {
    let layer = -1;
    for (let i = 0; i < positions.length; i++) {
      const candidate = project.document.layers[i].runs[positions[i]];
      if (
        candidate &&
        (layer < 0 ||
          candidate[1] <
            project.document.layers[layer].runs[positions[layer]][1])
      )
        layer = i;
    }
    if (layer < 0) return;
    const [x, y, length, index] =
      project.document.layers[layer].runs[positions[layer]++];
    const value = project.document.palette[index];
    const paint = FIXTURE_PALETTE.findIndex((item) =>
      value.kind === "raw"
        ? item.meaning === null && item.rgba === value.rgba
        : item.meaning !== null && item.key === value.registryId,
    );
    if (paint < 0) throw new Error("Unexpected encoded paint.");
    for (let start = x; start < x + length;) {
      const size =
        layer === 0
          ? Math.min(x + length - start, 64 - (start % 64))
          : x + length - start;
      yield { layer, x: start, y, length: size, paint };
      start += size;
    }
  }
}
