import { MapDocument, type TileWrite } from "../../src/domain/document";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values";
import {
  FIXTURES,
  FIXTURE_BOUNDS,
  FIXTURE_LAYERS,
  FIXTURE_PALETTE,
  generateFixture,
} from "./maps";

/** Browser fixture adapter: complete populated storage, never shipped in the app. */
export function populatedDocument(index: number) {
  const document = new MapDocument({
    bounds: FIXTURE_BOUNDS,
    layers: FIXTURE_LAYERS.map((id) => ({ id: layerId(id), name: id })),
  });
  const paints = FIXTURE_PALETTE.map((paint) =>
    paint.meaning === null
      ? rawColor(paint.rgba)
      : registeredColor(registryId(paint.key)),
  );
  document.applyCommands(
    FIXTURE_PALETTE.filter((paint) => paint.meaning !== null).map((paint) => ({
      kind: "registry" as const,
      id: registryId(paint.key),
      value: { rgba: paint.rgba, name: paint.meaning },
    })),
  );
  let writes: TileWrite[] = [];
  for (const run of generateFixture(FIXTURES[index])) {
    writes.push({
      layerId: layerId(FIXTURE_LAYERS[run.layer]),
      x: run.x,
      y: run.y,
      length: run.length,
      value: paints[run.paint],
    });
    if (writes.length === 512) {
      document.writeBatch(writes);
      writes = [];
    }
  }
  document.writeBatch(writes);
  return document;
}
