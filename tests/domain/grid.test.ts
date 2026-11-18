import { test } from "node:test";
import assert from "node:assert/strict";
import { gridLayout, gridScale } from "../../src/renderer/grid.ts";
import { fitToMap, worldToScreen } from "../../src/editor/viewport.ts";

test("grid bands track signed tile edges at fractional cameras, zooms and Retina densities", () => {
  const bounds = { minX: -65, minY: -65, maxX: 131, maxY: 133 };
  for (const density of [1, 1.5, 2, 3])
    for (const zoom of [1 / 3, 0.5, 1, 1.37, 8])
      for (const coordinate of [-64, -1, 0, 63, 64, 127, 128]) {
        const view = { x: coordinate - 2.123, y: coordinate - 2.123, zoom };
        const layout = gridLayout(
          bounds,
          view,
          { width: 800, height: 600 },
          density,
        );
        const edge = worldToScreen(coordinate, coordinate, view);
        const bands = coordinate % 64 === 0 ? layout.chunks : layout.tiles;
        const vertical = bands.find(
          (b) =>
            b.width <= 2 &&
            Math.abs(b.x + b.width / 2 - edge.x) <= 0.5 / density + 1e-9,
        );
        const horizontal = bands.find(
          (b) =>
            b.height <= 2 &&
            Math.abs(b.y + b.height / 2 - edge.y) <= 0.5 / density + 1e-9,
        );
        assert.ok(vertical, `x=${coordinate}, zoom=${zoom}, DPR=${density}`);
        assert.ok(horizontal);
        assert.ok(
          Math.abs(vertical.x * density - Math.round(vertical.x * density)) <
            1e-9,
        );
      }
});

test("partial map edges clip overlays, growth preserves the lattice, and distant lines stay bounded", () => {
  const bounds = { minX: -65, minY: -65, maxX: 131, maxY: 133 };
  const size = { width: 800, height: 600 };
  const view = fitToMap(bounds, size);
  const layout = gridLayout(bounds, view, size, 2);
  assert.equal(layout.tiles.length, 0);
  assert.equal(layout.edges.length, 4);
  const detail = { x: 60.125, y: 60.125, zoom: 1 };
  assert.deepEqual(
    gridLayout(bounds, detail, size, 2).chunks,
    gridLayout({ ...bounds, minX: -129, minY: -129 }, detail, size, 2).chunks,
  );
  const first = worldToScreen(-65, -65, view),
    last = worldToScreen(131, 133, view);
  for (const band of [...layout.chunks, ...layout.edges]) {
    assert.ok(band.x >= first.x && band.y >= first.y);
    assert.ok(band.x + band.width <= last.x + 1e-9);
    assert.ok(band.y + band.height <= last.y + 1e-9);
  }
  const large = { minX: 0, minY: 0, maxX: 6400, maxY: 6400 };
  const overview = gridLayout(large, fitToMap(large, size), size);
  assert.equal(overview.chunkStride, 8);
  assert.equal(overview.tiles.length, 0);
  assert.equal(overview.chunks.length, 24);
  const huge = { ...large, maxX: 6400000, maxY: 6400000 };
  assert.ok(gridLayout(huge, fitToMap(huge, size), size).chunks.length < 60);
  assert.equal(gridScale({ x: 0, y: 0, zoom: 0.25 }).tileAlpha, 0);
  assert.ok(gridScale({ x: 0, y: 0, zoom: 1 / 3 }).tileAlpha > 0);
  assert.equal(gridScale({ x: 0, y: 0, zoom: 0.5 }).tileAlpha, 0.22);
  assert.deepEqual(
    gridLayout(bounds, { x: 1000, y: 1000, zoom: 1 }, size).edges,
    [],
  );
});
