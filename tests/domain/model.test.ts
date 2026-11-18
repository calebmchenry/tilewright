import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertBounds,
  containsTile,
  visualChunkAt,
} from "../../src/domain/coordinates.ts";

test("model coordinate smoke: fixed target-scale bounds, edges, and invalid addresses", () => {
  const bounds = Object.freeze({ minX: 0, minY: 0, maxX: 6400, maxY: 6400 });
  assertBounds(bounds);
  for (const [x, y] of [
    [0, 0],
    [63, 64],
    [6399, 6399],
  ]) {
    assert.equal(containsTile(bounds, x, y), true);
  }
  for (const [x, y] of [
    [-1, 0],
    [6400, 0],
    [0, 6400],
    [0.5, 1],
    [NaN, 0],
    [0, Infinity],
  ]) {
    assert.equal(containsTile(bounds, x, y), false);
  }
  assert.deepEqual(bounds, { minX: 0, minY: 0, maxX: 6400, maxY: 6400 });
});

test("model coordinate smoke: an 8 by 8 house straddles four visual chunks", () => {
  const counts = new Map<string, number>();
  for (let y = 60; y < 68; y++) {
    for (let x = 60; x < 68; x++) {
      const { chunkX, chunkY, localX, localY } = visualChunkAt(x, y);
      const key = `${chunkX},${chunkY}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      assert.equal(chunkX * 64 + localX, x);
      assert.equal(chunkY * 64 + localY, y);
    }
  }
  assert.deepEqual(
    [...counts],
    [
      ["0,0", 16],
      ["1,0", 16],
      ["0,1", 16],
      ["1,1", 16],
    ],
  );
});

test("model coordinate smoke: grown negative space keeps the origin and chunk lattice", () => {
  const bounds = { minX: -128, minY: -64, maxX: 256, maxY: 256 };
  assertBounds(bounds);
  assert.equal(containsTile(bounds, -65, -1), true);
  assert.deepEqual(visualChunkAt(-65, -1), {
    chunkX: -2,
    chunkY: -1,
    localX: 63,
    localY: 63,
  });
  assert.deepEqual(visualChunkAt(-64, -64), {
    chunkX: -1,
    chunkY: -1,
    localX: 0,
    localY: 0,
  });
  assert.throws(() => visualChunkAt(1.1, 0), RangeError);
  assert.throws(
    () => visualChunkAt(Number.MAX_SAFE_INTEGER + 1, 0),
    RangeError,
  );
});

test("model coordinate smoke: reject zero, reversed, fractional, and overflowing bounds", () => {
  for (const bounds of [
    { minX: 0, minY: 0, maxX: 0, maxY: 1 },
    { minX: 2, minY: 0, maxX: 1, maxY: 1 },
    { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    { minX: -Number.MAX_SAFE_INTEGER, minY: 0, maxX: 1, maxY: 1 },
  ])
    assert.throws(() => assertBounds(bounds), RangeError);
});
