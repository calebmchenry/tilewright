import assert from "node:assert/strict";
import test from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import { CommandHistory } from "../../src/domain/history.ts";
import { RegistryCommands } from "../../src/domain/registry.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { canvasInvalidation } from "../../src/editor/invalidation.ts";
import { fitToMap } from "../../src/editor/viewport.ts";
import {
  OverviewCache,
  overviewRegions,
  rasterizeOverview,
  OVERVIEW_BYTES,
  OVERVIEW_ENTRIES,
  OVERVIEW_TTL,
  type OverviewEntry,
  type OverviewRegion,
} from "../../src/renderer/overview.ts";

const bottom = layerId("bottom"),
  top = layerId("top");
function map(width = 1024, height = 32) {
  return new MapDocument({
    bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
    layers: [
      { id: bottom, name: "Bottom" },
      { id: top, name: "Top" },
    ],
  });
}
function region(x = 0, step = 1, height = 32): OverviewRegion {
  return {
    key: `256:${step}:${x / 256},0`,
    x,
    y: 0,
    size: 256,
    step,
    pixels: 256 / step,
    bounds: { minX: x, minY: 0, maxX: x + 256, maxY: height },
  };
}
function finish(task: ReturnType<typeof rasterizeOverview>) {
  for (;;) {
    const result = task.next();
    if (result.done) return result.value;
  }
}
function harness(document: MapDocument) {
  let now = 0;
  let work: (() => void) | undefined, expiry: (() => void) | undefined;
  const published: { key: string; pixel: number[] }[] = [],
    released: string[] = [];
  const cache = new OverviewCache(document, {
    now: () => now,
    schedule: (callback) => {
      work = callback;
      return () => {
        work = undefined;
      };
    },
    expire: (callback) => {
      expiry = callback;
      return () => {
        expiry = undefined;
      };
    },
    publish: (entry: OverviewEntry) =>
      published.push({
        key: entry.region.key,
        pixel: [...(entry.pixels?.slice(0, 4) ?? [])],
      }),
    release: (entry) => released.push(entry.region.key),
    changed() {},
    error(error) {
      throw error;
    },
  });
  const one = () => {
    const next = work;
    work = undefined;
    next?.();
  };
  return {
    cache,
    published,
    released,
    one,
    flush() {
      let count = 0;
      while (work) {
        assert.ok(count++ < 1000);
        one();
      }
    },
    advance(ms: number) {
      now += ms;
      const next = expiry;
      expiry = undefined;
      next?.();
    },
    tickClock() {
      now++;
    },
  };
}

test("overview layout bounds region count and bytes at target and larger scales including DPR", () => {
  for (const dimension of [6400, 6_400_000])
    for (const density of [1, 2, 3]) {
      const bounds = {
        minX: -65,
        minY: -1,
        maxX: dimension - 65,
        maxY: dimension - 1,
      };
      const size = { width: 1024, height: 640 };
      const regions = overviewRegions(
        bounds,
        fitToMap(bounds, size),
        size.width,
        size.height,
        density,
      );
      assert.ok(regions.length <= 256);
      assert.ok(
        regions.reduce((n, r) => n + r.pixels ** 2 * 4, 0) <=
          OVERVIEW_BYTES / 2,
      );
      assert.equal(
        regions.reduce(
          (n, r) =>
            n +
            (r.bounds.maxX - r.bounds.minX) * (r.bounds.maxY - r.bounds.minY),
          0,
        ),
        dimension ** 2,
      );
      for (const r of regions) assert.ok(r.pixels <= 256);
    }
});

test("overview composites per cell before averaging and retains negative partial edges", () => {
  const document = map();
  document.writeBatch([
    { layerId: bottom, x: 0, y: 0, length: 2, value: rawColor("#ff0000ff") },
    { layerId: top, x: 0, y: 0, length: 1, value: rawColor("#0000ffff") },
    { layerId: top, x: 1, y: 0, length: 1, value: rawColor("#00ff0080") },
  ]);
  const exact = finish(rasterizeOverview(document, region(), []))!;
  assert.deepEqual([...exact.slice(0, 8)], [0, 0, 255, 255, 127, 128, 0, 255]);
  // Four cells: blue, green over red, and two transparent cells.
  assert.deepEqual(
    [...finish(rasterizeOverview(document, region(0, 2), []))!.slice(0, 4)],
    [32, 32, 64, 128],
  );
  assert.deepEqual(
    [...finish(rasterizeOverview(document, region(0, 2), [top]))!.slice(0, 4)],
    [128, 0, 0, 128],
  );
  const signed = new MapDocument({
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
  });
  signed.setCell(signed.layers[0].id, -1, -1, rawColor("#ffffffff"));
  const r = overviewRegions(
    signed.bounds,
    { x: -1, y: -1, zoom: 1 / 24 },
    48,
    48,
  )[0];
  const partial = finish(
    rasterizeOverview(signed, { ...r, step: 2, pixels: r.size / 2 }, []),
  )!;
  assert.deepEqual([...partial.slice(-4)], [255, 255, 255, 255]);
});

test("cache refreshes offscreen edits, registry, order and visibility and expires unused entries", () => {
  const document = map();
  document.setCell(bottom, 0, 0, rawColor("#ff0000ff"));
  const h = harness(document);
  document.subscribe((change) =>
    h.cache.invalidate(canvasInvalidation(change)),
  );
  h.cache.sync([region()], []);
  h.flush();
  assert.deepEqual(h.published.at(-1)?.pixel, [255, 0, 0, 255]);
  h.cache.sync([region(256)], []);
  h.flush();
  document.setCell(bottom, 0, 0, registeredColor(registryId("grass")));
  document.applyCommands([
    { kind: "registry", id: registryId("grass"), value: { rgba: "#00ff00ff" } },
  ]);
  const before = h.published.length;
  h.flush();
  assert.equal(h.published.length, before + 1); // registry conservatively refreshes visible too
  h.cache.sync([region()], []);
  h.flush();
  assert.deepEqual(h.published.at(-1)?.pixel, [0, 255, 0, 255]);
  document.setCell(top, 0, 0, rawColor("#0000ffff"));
  h.flush();
  assert.deepEqual(h.published.at(-1)?.pixel, [0, 0, 255, 255]);
  document.reorderLayers([top, bottom]);
  h.flush();
  assert.deepEqual(h.published.at(-1)?.pixel, [0, 255, 0, 255]);
  h.cache.sync([region()], [bottom]);
  h.flush();
  assert.deepEqual(h.published.at(-1)?.pixel, [0, 0, 255, 255]);
  h.advance(OVERVIEW_TTL + 1);
  assert.equal(h.cache.snapshot().entries, 1);
  assert.ok(h.released.includes(region(256).key));
  h.cache.destroy();
  assert.equal(h.cache.snapshot().bytes, 0);
  assert.equal(h.cache.snapshot().scheduled, false);
});

test("partial work cannot publish across edits, document replacement, or disposal", () => {
  const document = map(256, 256);
  document.setCell(bottom, 0, 0, rawColor("#ff0000ff"));
  const h = harness(document);
  // Make each next() consume a full scheduling budget through the model query seam.
  const iterate = document.iterateRuns.bind(document);
  document.iterateRuns = (id, bounds) => {
    for (let i = 0; i < 5; i++) h.tickClock();
    return iterate(id, bounds);
  };
  h.cache.sync([region(0, 1, 256)], []);
  h.one();
  assert.equal(h.published.length, 0);
  document.setCell(bottom, 0, 0, rawColor("#00ff00ff"));
  // Version guard works even before an invalidation is forwarded.
  h.flush();
  assert.deepEqual(
    h.published.map((p) => p.pixel),
    [[0, 255, 0, 255]],
  );
  assert.equal(h.cache.snapshot().discarded, 1);
  h.cache.sync([region(0, 2, 256)], []);
  h.one();
  h.cache.destroy();
  h.flush();
  const other = harness(map());
  other.cache.sync([region()], []);
  other.flush();
  assert.deepEqual(other.published[0].pixel, []);
  assert.equal(h.published.length, 1);
});

test("R20: recolor invalidates retained resolutions and cancels mixed-color work through undo/redo", () => {
  const document = map(1024, 256);
  const history = new CommandHistory(document);
  const commands = new RegistryCommands(history);
  const plan = commands.prepare({
    kind: "add",
    name: "Grass",
    color: "#335c46",
    adopt: false,
  });
  commands.commit(plan);
  history.execute("Grass on both layers", [
    {
      kind: "tiles",
      writes: [bottom, top].flatMap((layerId) =>
        [0, 256].flatMap((x) =>
          Array.from({ length: 256 }, (_, y) => ({
            layerId,
            x,
            y,
            length: 256,
            value: registeredColor(plan.id),
          })),
        ),
      ),
    },
  ]);
  const h = harness(document);
  document.subscribe((change) =>
    h.cache.invalidate(canvasInvalidation(change)),
  );
  const regions = [region(0, 1, 256), region(256, 1, 256), region(0, 2, 256)];
  for (const r of regions) {
    h.cache.sync([r], [top]);
    h.flush();
  }
  h.cache.sync([], [top]); // Detail view retains old overview entries.
  const builds = h.cache.snapshot().builds;
  commands.commit(
    commands.prepare({
      kind: "edit",
      id: plan.id,
      name: "Grass",
      color: "#557755",
    }),
  );
  h.flush();
  assert.equal(h.cache.snapshot().builds, builds); // No offscreen rebuild.
  assert.ok([...h.cache.entries].every((entry) => entry.dirty));
  for (const r of regions) {
    h.cache.sync([r], [top]);
    h.flush();
    assert.deepEqual(h.published.at(-1)?.pixel, [85, 119, 85, 255]);
  }
  h.cache.sync([regions[0]], []); // Reveal previously hidden layer.
  h.flush();
  assert.deepEqual(h.published.at(-1)?.pixel, [85, 119, 85, 255]);
  // Force a yield after every block, then change the entry between slices.
  const iterate = document.iterateRuns.bind(document);
  document.iterateRuns = (id, bounds) => {
    for (let i = 0; i < 6; i++) h.tickClock();
    return iterate(id, bounds);
  };
  history.undo();
  const published = h.published.length;
  h.one();
  assert.equal(h.published.length, published);
  history.redo();
  h.flush();
  assert.equal(h.published.length, published + 1);
  assert.ok(h.cache.snapshot().discarded > 0);
  const pixels = [...h.cache.entries].find(
    (entry) => entry.region.key === regions[0].key,
  )!.pixels!;
  for (let offset = 0; offset < pixels.length; offset += 4)
    assert.deepEqual(
      [...pixels.subarray(offset, offset + 4)],
      [85, 119, 85, 255],
    );
  history.undo();
  for (const r of regions) {
    h.cache.sync([r], []);
    h.flush();
    assert.deepEqual(h.published.at(-1)?.pixel, [51, 92, 70, 255]);
  }
  history.redo();
  for (const r of regions) {
    h.cache.sync([r], []);
    h.flush();
    assert.deepEqual(h.published.at(-1)?.pixel, [85, 119, 85, 255]);
  }
  h.cache.destroy();
});

test("LRU byte and entry caps bound retained cache across unbounded panning", () => {
  const document = map(256 * 520, 1);
  document.writeBatch(
    Array.from({ length: 520 }, (_, i) => ({
      layerId: bottom,
      x: i * 256,
      y: 0,
      length: 1,
      value: rawColor("#ffffffff"),
    })),
  );
  const h = harness(document);
  for (let i = 0; i < 520; i++) {
    h.cache.sync([region(i * 256, 1, 1)], []);
    h.flush();
    assert.ok(h.cache.snapshot().bytes <= OVERVIEW_BYTES);
    assert.ok(h.cache.snapshot().entries <= OVERVIEW_ENTRIES);
  }
  assert.ok(h.cache.snapshot().evictions > 0);
  assert.equal(h.cache.snapshot().pending, 0);
  h.cache.destroy();
  assert.equal(h.cache.snapshot().entries, 0);
});

test("span rasterization matches a per-cell oracle across clipped bins and alpha overlaps", () => {
  const bounds = { minX: 3, minY: 5, maxX: 251, maxY: 29 };
  const document = new MapDocument({
    bounds,
    layers: [
      { id: bottom, name: "Bottom" },
      { id: top, name: "Top" },
    ],
  });
  const palette = [
    "#123456ff",
    "#ff000000",
    "#00ffff80",
    "#01020301",
    "#000000ff",
  ];
  for (const [li, id] of [bottom, top].entries())
    for (let y = bounds.minY; y < bounds.maxY; y++)
      for (let x = bounds.minX; x < bounds.maxX;) {
        const length = Math.min(
          1 + ((x * 13 + y * 7 + li * 3) % 37),
          bounds.maxX - x,
        );
        if ((x + y + li) % 3)
          document.writeBatch([
            {
              layerId: id,
              x,
              y,
              length,
              value: rawColor(palette[(x + y + li) % palette.length]),
            },
          ]);
        x += length;
      }
  for (const step of [1, 2, 4, 8, 16]) {
    const r = { ...region(0, step), bounds };
    const actual = finish(rasterizeOverview(document, r, []))!;
    const sums = new Float64Array(actual.length),
      counts = new Uint32Array(actual.length / 4);
    for (let y = bounds.minY; y < bounds.maxY; y++)
      for (let x = bounds.minX; x < bounds.maxX; x++) {
        const pixel = [0, 0, 0, 0];
        for (const id of [bottom, top]) {
          const cell = document.getCell(id, x, y);
          if (!cell || cell.kind !== "raw") continue;
          const color = [1, 3, 5, 7].map((i) =>
            parseInt(cell.rgba.slice(i, i + 2), 16),
          );
          const alpha = color[3] / 255;
          for (let c = 0; c < 4; c++)
            pixel[c] = Math.round(
              (c === 3 ? color[c] : Math.round(color[c] * alpha)) +
                pixel[c] * (1 - alpha),
            );
        }
        const bin = Math.floor(y / step) * r.pixels + Math.floor(x / step);
        counts[bin]++;
        for (let c = 0; c < 4; c++) sums[bin * 4 + c] += pixel[c];
      }
    const oracle = Uint8Array.from(sums, (sum, i) =>
      counts[Math.floor(i / 4)]
        ? Math.round(sum / counts[Math.floor(i / 4)])
        : 0,
    );
    assert.deepEqual(actual, oracle, `step ${step}`);
  }
});
