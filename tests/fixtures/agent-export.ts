import { readFileSync } from "node:fs";
import type { AgentMapV1 } from "../../src/domain/agent-export-format.ts";
import { MapDocument } from "../../src/domain/document.ts";
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

export const exampleAgentMap: AgentMapV1 = JSON.parse(
  readFileSync(
    new URL("../../docs/examples/agent-map-v1.json", import.meta.url),
    "utf8",
  ),
);

/** Test construction from the reviewed schema example, independent of any codec. */
export function agentExampleDocument(reverse = false): MapDocument {
  const source = exampleAgentMap;
  const document = new MapDocument({
    bounds: source.bounds,
    layers: source.layers.map(({ id, name }) => ({ id: layerId(id), name })),
  });
  const order = <T>(items: readonly T[]) =>
    reverse ? [...items].reverse() : items;
  document.applyCommands([
    ...order(source.colors).flatMap((color) =>
      color.kind === "raw"
        ? []
        : [
            {
              kind: "registry" as const,
              id: registryId(color.registryId),
              value: { name: color.meaning, rgba: color.rgba },
            },
          ],
    ),
    ...order(source.areas).map(({ id, ...area }) => ({
      kind: "annotation" as const,
      id: annotationId(id),
      value: {
        ...area,
        bounds: { ...area.bounds },
        label: { placement: "center" },
      },
    })),
  ]);
  for (const layer of order(source.layers))
    for (const [x, y, length, index] of order(layer.runs)) {
      const color = source.colors[index];
      const value =
        color.kind === "raw"
          ? rawColor(color.rgba)
          : registeredColor(registryId(color.registryId));
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

export function populatedAgentDocument(spec: FixtureSpec): MapDocument {
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

/** Read parsed export bytes back into the independent golden fixture oracle.
 * Checks resolved color AND meaning; no source document or production codec queries.
 */
export function* fixtureRunsFromAgentMap(
  map: AgentMapV1,
): Generator<FixtureRun> {
  const paints = map.colors.map((color) => {
    const paint = FIXTURE_PALETTE.findIndex(
      (item) =>
        color.rgba === item.rgba &&
        color.meaning === item.meaning &&
        (color.kind === "raw"
          ? item.meaning === null
          : color.registryId === item.key),
    );
    if (paint < 0) throw new Error("Unexpected exported color or meaning.");
    return paint;
  });
  const positions = map.layers.map(() => 0);
  while (true) {
    let layer = -1;
    for (let i = 0; i < positions.length; i++) {
      const candidate = map.layers[i].runs[positions[i]];
      if (
        candidate &&
        (layer < 0 ||
          candidate[1] < map.layers[layer].runs[positions[layer]][1])
      )
        layer = i;
    }
    if (layer < 0) return;
    const [x, y, length, index] = map.layers[layer].runs[positions[layer]++];
    if (paints[index] === undefined)
      throw new Error("Dangling exported color index.");
    // Restore the fixture recipe's terrain segmentation, without changing coverage.
    for (let start = x; start < x + length;) {
      const size =
        layer === 0
          ? Math.min(x + length - start, 64 - (start % 64))
          : x + length - start;
      yield { layer, x: start, y, length: size, paint: paints[index] };
      start += size;
    }
  }
}
