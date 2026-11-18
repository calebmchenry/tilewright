import assert from "node:assert/strict";
import test from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import {
  CHUNK_BYTES,
  rasterizeChunk,
  visibleChunks,
} from "../../src/renderer/chunks.ts";
import { MISSING_COLOR, resolveColor } from "../../src/renderer/colors.ts";

const terrain = layerId("terrain"),
  upper = layerId("upper");
function fixture() {
  return new MapDocument({
    bounds: { minX: -65, minY: -1, maxX: 101, maxY: 70 },
    layers: [
      { id: terrain, name: "Terrain" },
      { id: upper, name: "Upper" },
    ],
  });
}
test("culling clips negative and partial boundary chunks and does not include touching-only chunks", () => {
  const map = fixture();
  const chunks = visibleChunks(map.bounds, { x: 32, y: 32, zoom: 1 }, 24, 24);
  assert.deepEqual(
    chunks.map(({ key }) => key),
    ["0,0"],
  );
  const edge = visibleChunks(map.bounds, { x: -65, y: -1, zoom: 1 }, 48, 48);
  assert.deepEqual(edge, [
    {
      key: "-3,-1",
      x: -96,
      y: -32,
      bounds: { minX: -65, minY: -1, maxX: -64, maxY: 0 },
    },
  ]);
  const partial = visibleChunks(map.bounds, { x: 100, y: 69, zoom: 1 }, 72, 72);
  assert.deepEqual(partial.at(-1)?.bounds, {
    minX: 96,
    minY: 64,
    maxX: 101,
    maxY: 70,
  });
  assert.equal(
    visibleChunks(map.bounds, { x: 1000, y: 1000, zoom: 1 }, 800, 600).length,
    0,
  );
  assert.throws(() =>
    visibleChunks(map.bounds, { x: 0, y: 0, zoom: 0 }, 800, 600),
  );
  const large = visibleChunks(
    { minX: 0, minY: 0, maxX: 6400, maxY: 6400 },
    { x: 320, y: 320, zoom: 1 },
    1200,
    800,
  );
  assert.equal(large.length, 9);
});
test("chunk pixels retain emptiness, black, alpha, registry associations and layer independence", () => {
  const map = fixture();
  const grass = registryId("grass");
  map.applyCommands([
    { kind: "registry", id: grass, value: { rgba: "#123456ff" } },
  ]);
  map.writeBatch([
    { layerId: terrain, x: 31, y: 0, length: 3, value: rawColor("#000000ff") },
    { layerId: upper, x: 32, y: 0, length: 1, value: registeredColor(grass) },
    { layerId: upper, x: 33, y: 0, length: 1, value: rawColor("#80402080") },
    { layerId: upper, x: 34, y: 0, length: 1, value: rawColor("#ffffffff") },
    { layerId: upper, x: 35, y: 0, length: 1, value: rawColor("#ffffff00") },
  ]);
  const region = visibleChunks(map.bounds, { x: 33, y: 1, zoom: 1 }, 24, 24)[0];
  const bottom = rasterizeChunk(map, terrain, region),
    top = rasterizeChunk(map, upper, region);
  assert.equal(top.pixels!.byteLength, CHUNK_BYTES);
  assert.deepEqual(
    [...bottom.pixels!.slice(0, 12)],
    [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0],
  );
  assert.deepEqual(
    [...top.pixels!.slice(0, 20)],
    [
      18, 52, 86, 255, 64, 32, 16, 128, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0,
      0,
    ],
  );
  assert.deepEqual([...top.registryIds], [grass]);
  assert.equal(top.cells, 4);
  assert.equal(
    rasterizeChunk(
      map,
      upper,
      visibleChunks(map.bounds, { x: 1, y: 1, zoom: 1 }, 24, 24)[0],
    ).pixels,
    null,
  );
  assert.deepEqual(
    resolveColor(map, registeredColor(registryId("missing"))),
    MISSING_COLOR,
  );
  map.applyCommands([
    { kind: "registry", id: grass, value: { rgba: "invalid" } },
  ]);
  assert.deepEqual(resolveColor(map, registeredColor(grass)), MISSING_COLOR);
});
