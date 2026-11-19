import assert from "node:assert/strict";
import test from "node:test";
import {
  fitLabelText,
  labelCandidates,
  placeLabels,
  visibleLabelTier,
  type LabelArea,
} from "../../src/renderer/areaLabels.ts";
import { fitToMap, type Viewport } from "../../src/editor/viewport.ts";

const size = { width: 960, height: 640 };
const view = (pixels: number, cx = 64, cy = 64): Viewport => ({
  zoom: pixels / 24,
  x: cx - (size.width / 2 - 24) / pixels,
  y: cy - (size.height / 2 - 24) / pixels,
});
const house: LabelArea = {
  id: "area-house",
  name: "Blacksmith's house",
  tier: "detail",
  bounds: { minX: 60, minY: 60, maxX: 68, maxY: 68 },
};
const village: LabelArea = {
  id: "area-village",
  name: "Willow Village",
  tier: "locality",
  bounds: { minX: 0, minY: 0, maxX: 128, maxY: 128 },
};
const region: LabelArea = {
  id: "area-region",
  name: "Green Reach",
  tier: "region",
  bounds: { minX: -64, minY: -64, maxX: 1024, maxY: 1024 },
};
const areas = [house, village, region];
const measure = (text: string) =>
  [...new Intl.Segmenter().segment(text)].length * 7;

test("documented tiers switch at exact CSS thresholds in both directions, independently of overview", () => {
  const values = [
    24, 12, 8.000001, 8, 7.999999, 3, 2, 1.000001, 1, 0.999999, 0.24,
  ];
  for (const p of [...values, ...[...values].reverse()]) {
    const tier = p >= 8 ? "detail" : p >= 1 ? "locality" : "region";
    const camera = view(p, p < 1 ? 480 : 64, p < 1 ? 480 : 64);
    assert.equal(visibleLabelTier(camera), tier);
    assert.deepEqual(
      labelCandidates(areas, camera, size).map((a) => a.tier),
      [tier],
    );
  }
  const fitted = fitToMap(
    { minX: -64, minY: -64, maxX: 6400, maxY: 6400 },
    size,
  );
  assert.deepEqual(
    labelCandidates(areas, fitted, size).map((a) => a.id),
    [region.id],
  );
  assert.deepEqual(labelCandidates([house], view(0.24), size), []);
});

test("selected area is the only tier exception, draft substitutes and invalid draft suppresses old label", () => {
  const camera = view(0.24, 480, 480);
  assert.deepEqual(
    labelCandidates(areas, camera, size, { id: house.id, area: house }).map(
      (a) => [a.id, a.selected],
    ),
    [
      [house.id, true],
      [region.id, false],
    ],
  );
  const draft = {
    ...house,
    name: "Draft",
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  };
  const candidates = labelCandidates(areas, view(24), size, {
    id: house.id,
    area: draft,
  });
  assert.equal(
    candidates.some((a) => a.id === house.id),
    false,
  ); // moved offscreen
  assert.deepEqual(
    labelCandidates(areas, view(24), size, { id: house.id, area: null }),
    [],
  );
});

test("cull outside rectangles and outside anchors, retain true half-tile center and never mutate bounds", () => {
  const camera = { x: 1, y: 1, zoom: 1 };
  const single = { ...house, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 } };
  const initial = JSON.stringify(single);
  assert.deepEqual(labelCandidates([single], camera, size)[0].anchor, {
    x: 12,
    y: 12,
  });
  assert.deepEqual(
    labelCandidates([single], { ...camera, x: 1.500001 }, size),
    [],
  );
  const straddling = {
    ...house,
    bounds: { minX: -100, minY: 0, maxX: 2, maxY: 2 },
  };
  assert.deepEqual(labelCandidates([straddling], camera, size), []);
  assert.equal(JSON.stringify(single), initial);
});

test("placement clamps to four-pixel inset, ellipsizes by grapheme, omits tiny hosts", () => {
  const name = "👩🏽‍🔧e\u0301".repeat(50);
  const fitted = fitLabelText(name, "detail", size, measure)!;
  assert.equal(fitted.text, "👩🏽‍🔧e\u0301".repeat(15) + "👩🏽‍🔧…");
  assert.equal(fitted.width, 236);
  const tiny = { width: 28, height: 33 };
  assert.equal(fitLabelText(name, "detail", tiny, measure)?.text, "…");
  assert.equal(
    fitLabelText(name, "detail", { width: 26, height: 640 }, measure),
    null,
  );
  assert.equal(
    fitLabelText(name, "region", { width: 960, height: 36 }, measure),
    null,
  );
  for (const [anchor, expected] of [
    [
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ],
    [
      { x: 957, y: 637 },
      { x: 776, y: 611 },
    ],
  ] as const) {
    const placed = placeLabels(
      [{ ...house, anchor, selected: false }],
      size,
      () => ({ text: house.name, width: 180, height: 25 }),
    )[0];
    assert.deepEqual({ x: placed.x, y: placed.y }, expected);
  }
});

test("ASCII IDs and selected priority resolve collisions; exactly four-pixel gaps are allowed", () => {
  const overlap = { ...house, id: "area-house-b", name: "Storehouse" };
  const text = () => ({ text: "Box", width: 100, height: 25 });
  assert.deepEqual(
    placeLabels(
      labelCandidates([overlap, house], view(24), size),
      size,
      text,
    ).map((a) => a.id),
    [house.id],
  );
  assert.deepEqual(
    placeLabels(
      labelCandidates([house, overlap], view(24), size, {
        id: overlap.id,
        area: overlap,
      }),
      size,
      text,
    ).map((a) => a.id),
    [overlap.id],
  );
  for (const gap of [3.999, 4]) {
    const candidates = [
      { ...house, selected: false, anchor: { x: 200, y: 200 } },
      { ...overlap, selected: false, anchor: { x: 300 + gap, y: 200 } },
    ];
    assert.equal(placeLabels(candidates, size, text).length, gap === 4 ? 2 : 1);
  }
});
