import assert from "node:assert/strict";
import { MapDocument, type TileWrite } from "../../src/domain/document.ts";
import {
  cellKey,
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import {
  FIXTURE_BOUNDS,
  FIXTURE_LAYERS,
  FIXTURE_PALETTE,
  generateFixture,
  type FixtureRun,
  type FixtureSpec,
} from "./maps.ts";

export const MODEL_LAYERS = FIXTURE_LAYERS.map((id) => ({
  id: layerId(id),
  name: id,
}));
export const MODEL_PALETTE = FIXTURE_PALETTE.map((paint) =>
  paint.meaning === null
    ? rawColor(paint.rgba)
    : registeredColor(registryId(paint.key)),
);
export const IMPORT_BATCH_RUNS = 512;

/** Test adapter only: real storage, validated writes, bounded temporary change data. */
export function loadFixtureDocument(spec?: FixtureSpec): MapDocument {
  const document = new MapDocument({
    bounds: FIXTURE_BOUNDS,
    layers: MODEL_LAYERS,
  });
  if (!spec) return document;
  let batch: TileWrite[] = [];
  for (const run of generateFixture(spec)) {
    batch.push({
      layerId: MODEL_LAYERS[run.layer].id,
      x: run.x,
      y: run.y,
      length: run.length,
      value: MODEL_PALETTE[run.paint],
    });
    if (batch.length === IMPORT_BATCH_RUNS) {
      document.writeBatch(batch);
      batch = [];
    }
  }
  document.writeBatch(batch);
  return document;
}

/** Read actual storage, restore fixture interchange order, and split at its run lattice. */
export function* fixtureRunsFromDocument(
  document: MapDocument,
): Generator<FixtureRun> {
  assert.deepEqual(document.bounds, FIXTURE_BOUNDS);
  assert.deepEqual(document.layers, MODEL_LAYERS);
  const palette = new Map(
    MODEL_PALETTE.map((value, index) => [cellKey(value), index]),
  );
  const iterators = MODEL_LAYERS.map(({ id }) => document.iterateRuns(id));
  const next = iterators.map((iterator) => iterator.next());
  while (true) {
    let layer = -1;
    for (let i = 0; i < next.length; i++) {
      if (
        !next[i].done &&
        (layer < 0 || next[i].value!.y < next[layer].value!.y)
      )
        layer = i;
    }
    if (layer < 0) return;
    const run = next[layer].value!;
    const paint = palette.get(cellKey(run.value));
    assert.notEqual(
      paint,
      undefined,
      "Model contains an unexpected paint value",
    );
    const end = run.x + run.length;
    for (let x = run.x; x < end;) {
      // Only terrain uses 64-column recipe runs; buildings/canopy cross that grid.
      const length = layer === 0 ? Math.min(end - x, 64 - (x % 64)) : end - x;
      yield { layer, x, y: run.y, length, paint: paint! };
      x += length;
    }
    next[layer] = iterators[layer].next();
  }
}
