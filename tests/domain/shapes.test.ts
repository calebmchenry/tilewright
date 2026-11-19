import assert from "node:assert/strict";
import { test } from "node:test";
import { MapDocument } from "../../src/domain/document.ts";
import {
  layerId,
  rawColor,
  registeredColor,
  registryId,
} from "../../src/domain/values.ts";
import { EditorSession } from "../../src/editor/session.ts";
import type { PaintSpan } from "../../src/editor/drawing.ts";
import {
  lineSpans,
  lineTool,
  rectangleSpans,
  rectangleTool,
} from "../../src/editor/shapes.ts";
import { tileToScreen } from "../../src/editor/viewport.ts";

const terrain = layerId("terrain"),
  buildings = layerId("buildings"),
  grass = registryId("grass");
const paint = rawColor("#123456ff"),
  old = rawColor("#abcdefff");
const bounds = { minX: -65, minY: -65, maxX: 131, maxY: 133 };
const point = (x: number, y: number) =>
  tileToScreen(x, y, { x: 0, y: 0, zoom: 1 });
const cells = (spans: Iterable<PaintSpan>) =>
  [...spans]
    .flatMap((w) =>
      Array.from({ length: w.length }, (_, i) => `${w.x + i}/${w.y}`),
    )
    .sort();
const inside = (key: string, b = bounds) => {
  const [x, y] = key.split("/").map(Number);
  return x >= b.minX && x < b.maxX && y >= b.minY && y < b.maxY;
};

test("lines have exact inclusive horizontal, vertical, diagonal, tie and point coverage in both directions", () => {
  const cases = [
    { end: [4, 0], expected: ["0/0", "1/0", "2/0", "3/0", "4/0"] },
    { end: [0, 4], expected: ["0/0", "0/1", "0/2", "0/3", "0/4"] },
    { end: [4, 4], expected: ["0/0", "1/1", "2/2", "3/3", "4/4"] },
    { end: [4, 2], expected: ["0/0", "1/1", "2/1", "3/2", "4/2"] },
    { end: [-4, 2], expected: ["0/0", "-1/1", "-2/1", "-3/2", "-4/2"] },
    { end: [0, 0], expected: ["0/0"] },
  ];
  for (const {
    end: [x, y],
    expected,
  } of cases) {
    assert.deepEqual(
      cells(lineSpans({ x: 0, y: 0 }, { x, y }, bounds, paint)),
      expected.sort(),
    );
    assert.deepEqual(
      cells(lineSpans({ x, y }, { x: 0, y: 0 }, bounds, paint)),
      expected.sort(),
    );
  }
  for (let x = -8; x <= 8; x++)
    for (let y = -8; y <= 8; y++) {
      const from = { x: 0, y: 0 },
        to = { x, y };
      const spans = [...lineSpans(from, to, bounds, paint)];
      assert.equal(spans.length, Math.max(Math.abs(x), Math.abs(y)) + 1);
      assert.deepEqual(cells(spans), cells(lineSpans(to, from, bounds, paint)));
      assert.ok(cells(spans).includes("0/0"));
      assert.ok(cells(spans).includes(`${x}/${y}`));
      for (let i = 1; i < spans.length; i++) {
        assert.equal(
          Math.max(
            Math.abs(spans[i].x - spans[i - 1].x),
            Math.abs(spans[i].y - spans[i - 1].y),
          ),
          1,
        );
      }
    }
});

test("rectangles match an independent cell predicate for all drag directions, thin dimensions and an 8 by 8 house", () => {
  for (const mode of ["filled", "outline"] as const)
    for (const width of [1, 2, 8])
      for (const height of [1, 2, 8])
        for (const dx of [-1, 1])
          for (const dy of [-1, 1]) {
            const from = { x: 64, y: 64 },
              to = { x: 64 + dx * (width - 1), y: 64 + dy * (height - 1) };
            const expected: string[] = [];
            for (let y = 55; y <= 72; y++)
              for (let x = 55; x <= 72; x++) {
                if (
                  x < Math.min(from.x, to.x) ||
                  x > Math.max(from.x, to.x) ||
                  y < Math.min(from.y, to.y) ||
                  y > Math.max(from.y, to.y)
                )
                  continue;
                if (
                  mode === "filled" ||
                  x === from.x ||
                  x === to.x ||
                  y === from.y ||
                  y === to.y
                )
                  expected.push(`${x}/${y}`);
              }
            const actual = cells(rectangleSpans(from, to, bounds, paint, mode));
            assert.deepEqual(actual, expected.sort());
            assert.equal(new Set(actual).size, actual.length);
            assert.deepEqual(
              actual,
              cells(rectangleSpans(to, from, bounds, paint, mode)),
            );
            if (width === 8 && height === 8)
              assert.equal(actual.length, mode === "filled" ? 64 : 28);
          }
});

test("clipping preserves original line phase and rectangle edges, including huge outside endpoints", () => {
  const small = { minX: -2, minY: -1, maxX: 3, maxY: 4 };
  for (let x = -8; x <= 8; x++)
    for (let y = -8; y <= 8; y++) {
      const from = { x: -6, y: 5 },
        to = { x, y };
      const algorithms = [
        (b: typeof bounds) => lineSpans(from, to, b, paint),
        ...(["filled", "outline"] as const).map(
          (mode) => (b: typeof bounds) =>
            rectangleSpans(from, to, b, paint, mode),
        ),
      ];
      for (const raster of algorithms)
        assert.deepEqual(
          cells(raster(small)),
          cells(raster(bounds)).filter((key) => inside(key, small)),
        );
    }
  const far = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(
    cells(lineSpans({ x: -far, y: -far }, { x: far, y: far }, small, paint)),
    ["-1/-1", "0/0", "1/1", "2/2"],
  );
  assert.deepEqual(
    cells(
      rectangleSpans(
        { x: -far, y: -far },
        { x: far, y: far },
        small,
        paint,
        "outline",
      ),
    ),
    [],
  );
  assert.equal(
    cells(
      rectangleSpans(
        { x: -far, y: -far },
        { x: far, y: far },
        small,
        paint,
        "filled",
      ),
    ).length,
    25,
  );
  for (const mode of ["filled", "outline"] as const) {
    assert.deepEqual(
      cells(
        rectangleSpans({ x: far, y: 0 }, { x: far, y: 1 }, small, paint, mode),
      ),
      [],
    );
    assert.throws(() => [
      ...rectangleSpans({ x: NaN, y: 0 }, { x: 1, y: 1 }, small, paint, mode),
    ]);
  }
});

function setup() {
  const doc = new MapDocument({
    bounds,
    layers: [
      { id: terrain, name: "Terrain" },
      { id: buildings, name: "Buildings" },
    ],
  });
  doc.applyCommands([
    {
      kind: "registry",
      id: grass,
      value: { name: "Grass", rgba: "#123456ff" },
    },
  ]);
  doc.writeBatch(
    [terrain, buildings].flatMap((layerId) =>
      Array.from({ length: 8 }, (_, i) => ({
        layerId,
        x: 60,
        y: 60 + i,
        length: 8,
        value: i % 2 ? old : registeredColor(grass),
      })),
    ),
  );
  const s = new EditorSession(doc);
  s.canvasState.set("ready");
  s.selectLayer(buildings);
  s.setColor("#123456ff");
  s.history.markSaved(s.history.captureCheckpoint());
  s.history.markRecovery(s.history.captureCheckpoint());
  return s;
}

test("shape previews replace intermediate endpoints; each raw/registered shape commits atomically with exact undo/redo across signed chunks", () => {
  for (const kind of ["line", "filled", "outline"] as const)
    for (const registered of [false, true]) {
      const s = setup(),
        before = [...s.document.iterateRuns()],
        lower = [...s.document.iterateRuns(terrain)];
      if (registered) s.selectRegisteredColor(grass);
      s.setPencilSize(32);
      const id = kind === "line" ? "line" : "rectangle";
      s.drawing.register(
        id,
        kind === "line" ? lineTool : rectangleTool(() => kind),
      );
      s.perform(id);
      let events = 0;
      s.document.subscribe(() => events++);
      const history = s.history.state,
        version = s.document.version;
      s.drawing.begin(1, point(-70, -70));
      s.drawing.sample(1, point(100, 120));
      s.drawing.sample(1, point(67, 67));
      const preview = s.drawing.preview.getSnapshot()!.writes;
      const expected =
        kind === "line"
          ? lineSpans({ x: -70, y: -70 }, { x: 67, y: 67 }, bounds, paint)
          : rectangleSpans(
              { x: -70, y: -70 },
              { x: 67, y: 67 },
              bounds,
              paint,
              kind,
            );
      assert.deepEqual(cells(preview), cells(expected));
      assert.deepEqual([...s.document.iterateRuns()], before);
      assert.deepEqual(s.history.state, history);
      assert.equal(s.document.version, version);
      assert.equal(events, 0);
      assert.equal(s.drawing.commit(1, point(67, 67)), true);
      assert.equal(events, 1);
      assert.equal(s.history.state.undoSteps, 1);
      const expectedValue = registered ? registeredColor(grass) : paint;
      const footprint = new Set(cells(preview));
      const oldCells = new Map(
        before
          .filter((w) => w.layerId === buildings)
          .flatMap((w) =>
            Array.from(
              { length: w.length },
              (_, i) => [`${w.x + i}/${w.y}`, w.value] as const,
            ),
          ),
      );
      for (let y = bounds.minY; y < bounds.maxY; y++)
        for (let x = bounds.minX; x < bounds.maxX; x++)
          assert.deepEqual(
            s.document.getCell(buildings, x, y),
            footprint.has(`${x}/${y}`)
              ? expectedValue
              : (oldCells.get(`${x}/${y}`) ?? null),
          );
      assert.deepEqual([...s.document.iterateRuns(terrain)], lower);
      assert.deepEqual(s.document.bounds, bounds);
      const after = [...s.document.iterateRuns()];
      s.history.undo();
      assert.deepEqual([...s.document.iterateRuns()], before);
      assert.equal(s.history.state.dirty, false);
      s.history.redo();
      assert.deepEqual([...s.document.iterateRuns()], after);
      if (registered) {
        assert.ok(
          s.commitRegistry(
            s.registryCommands.prepare({
              kind: "edit",
              id: grass,
              name: "Grass",
              color: "#558855",
            }),
          ),
        );
        for (const w of preview)
          assert.deepEqual(
            s.document.getCell(buildings, w.x, w.y),
            registeredColor(grass),
          );
      }
      s.dispose();
    }
});

test("shape clicks, cancellation, outside-only and identical repaint preserve redo and checkpoints", () => {
  for (const kind of ["line", "filled", "outline"] as const) {
    const s = setup(),
      id = kind === "line" ? "line" : "rectangle";
    s.drawing.register(
      id,
      kind === "line" ? lineTool : rectangleTool(() => kind),
    );
    s.perform(id);
    s.drawing.begin(1, point(0, 0));
    s.drawing.commit(1, point(0, 0));
    assert.deepEqual(s.document.getCell(buildings, 0, 0), paint);
    s.drawing.begin(1, point(1, 1));
    s.drawing.commit(1, point(1, 1));
    s.history.undo();
    const state = s.history.state,
      before = [...s.document.iterateRuns()];
    for (const xy of [
      [0, 0],
      [200, 200],
    ]) {
      s.drawing.begin(1, point(...(xy as [number, number])));
      s.drawing.commit(1, point(...(xy as [number, number])));
      assert.deepEqual(s.history.state, state);
    }
    s.drawing.begin(1, point(60, 60));
    s.drawing.sample(1, point(67, 67));
    s.drawing.cancel();
    assert.deepEqual(s.history.state, state);
    assert.deepEqual([...s.document.iterateRuns()], before);
    assert.equal(s.drawing.preview.getSnapshot(), null);
    s.dispose();
  }
});

test("shipping shape selection/style are transient, cancel previews, respect gates and reset with a new session", () => {
  const s = setup(),
    before = [...s.document.iterateRuns()];
  assert.equal(s.rectangleMode.getSnapshot(), "filled");
  for (const [key, id] of [
    ["l", "line"],
    ["r", "rectangle"],
  ] as const) {
    assert.equal(s.routeKey({ key }, "canvas"), true);
    assert.equal(s.activeTool.getSnapshot(), id);
    s.drawing.begin(1, point(1, 1));
    s.drawing.commit(1, point(2, 2));
    s.history.undo();
    const history = s.history.state;
    s.drawing.begin(1, point(1, 1));
    s.drawing.sample(1, point(8, 8));
    s.setRectangleMode(
      s.rectangleMode.getSnapshot() === "filled" ? "outline" : "filled",
    );
    assert.equal(s.drawing.preview.getSnapshot(), null);
    assert.equal(s.drawing.pointerId, null);
    assert.deepEqual(s.history.state, history);
    assert.deepEqual([...s.document.iterateRuns()], before);
    for (const owner of ["text", "outside"] as const)
      assert.equal(s.routeKey({ key: key === "r" ? "l" : "r" }, owner), false);
    for (const input of [
      { key, isComposing: true },
      { key, metaKey: true },
      { key, altKey: true },
    ])
      assert.equal(s.routeKey(input, "canvas"), false);
    for (const unavailable of ["hidden", "overview", "loading"]) {
      if (unavailable === "hidden") s.setLayerVisible(buildings, false);
      if (unavailable === "overview") s.viewport.set({ x: 0, y: 0, zoom: 0.1 });
      if (unavailable === "loading") s.canvasState.set("loading");
      assert.ok(s.action(id).reason);
      assert.equal(s.drawing.begin(1, point(1, 1)), false);
      s.setLayerVisible(buildings, true);
      s.viewport.set({ x: 0, y: 0, zoom: 1 });
      s.canvasState.set("ready");
    }
  }
  s.dispose();
  const fresh = new EditorSession();
  assert.equal(fresh.rectangleMode.getSnapshot(), "filled");
  fresh.dispose();
});
