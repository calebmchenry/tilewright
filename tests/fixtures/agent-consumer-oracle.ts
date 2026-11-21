import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { MapDocument } from "../../src/domain/document.ts";
import type { AgentColor } from "../../src/domain/agent-export-format.ts";
import type { NamedArea } from "../../src/domain/annotations.ts";
import type { TileValue } from "../../src/domain/values.ts";

export function sourceColor(
  document: MapDocument,
  paint: TileValue,
): AgentColor {
  if (paint.kind === "raw") return { ...paint, meaning: null };
  const record = document.getRegistryEntry(paint.registryId)!;
  assert.ok(typeof record.rgba === "string" && typeof record.name === "string");
  return { ...paint, rgba: record.rgba, meaning: record.name };
}

// Independent oracle reads the source model, never the captured map or exported runs.
export function sourceSummary(document: MapDocument) {
  const raw = new Set<string>();
  const layers = document.layers.map((layer, order) => {
    const hash = createHash("sha256");
    let runs = 0,
      occupiedCells = 0;
    for (const run of document.iterateRuns(layer.id)) {
      const color = sourceColor(document, run.value);
      if (run.value.kind === "raw") raw.add(run.value.rgba);
      const record = [
        run.x,
        run.y,
        run.length,
        color.kind,
        run.value.kind === "registered" ? run.value.registryId : null,
        color.rgba,
        color.meaning,
      ];
      // The reader documents ASCII JSON tuples + LF for its resolved-run digest.
      hash.update(
        JSON.stringify(record).replace(
          /[\u007f-\uffff]/g,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
        ) + "\n",
      );
      runs++;
      occupiedCells += run.length;
    }
    return {
      ...layer,
      order,
      runs,
      occupiedCells,
      resolvedRunsSha256: hash.digest("hex"),
    };
  });
  return {
    bounds: document.bounds,
    colors: [
      ...[...raw].sort().map((rgba) => ({ kind: "raw", rgba, meaning: null })),
      ...document.registryEntries.map(([id]) =>
        sourceColor(document, { kind: "registered", registryId: id }),
      ),
    ],
    layers,
    areas: document.annotations.map(([id, record]) => {
      const { label: _label, ...area } = record as NamedArea;
      return { id, ...area };
    }),
    occupiedLayerCells: layers.reduce(
      (sum, layer) => sum + layer.occupiedCells,
      0,
    ),
  };
}
