import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";

/** Uniform regions make exact WebGL comparisons independent of the downsampler. */
export function overviewDocument() {
  const terrain = layerId("terrain"),
    upper = layerId("upper");
  const document = new MapDocument({
    bounds: { minX: -65, minY: -33, maxX: 1101, maxY: 541 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: upper, name: "Upper" },
    ],
  });
  document.applyCommands([
    { kind: "registry", id: registryId("grass"), value: { rgba: "#00ff00ff" } },
  ]);
  document.writeBatch([
    ...Array.from({ length: 574 }, (_, i) => ({
      layerId: terrain,
      x: -65,
      y: i - 33,
      length: 1166,
      value: rawColor("#ff0000ff"),
    })),
    ...Array.from({ length: 24 }, (_, i) => ({
      layerId: upper,
      x: 248,
      y: 20 + i,
      length: 24,
      value: rawColor("#0000ff80"),
    })),
    ...Array.from({ length: 24 }, (_, i) => ({
      layerId: upper,
      x: 800,
      y: 100 + i,
      length: 24,
      value: registeredColor(registryId("grass")),
    })),
  ]);
  return document;
}
