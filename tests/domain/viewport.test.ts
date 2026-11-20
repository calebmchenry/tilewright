import test from "node:test";
import assert from "node:assert/strict";
import {
  canEditTiles,
  clampZoom,
  fitToMap,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToTile,
  screenToWorld,
  tileToScreen,
  worldToScreen,
  worldToTile,
  zoomAt,
  zoomLimits,
} from "../../src/editor/viewport.ts";

const bounds = { minX: -64, minY: -128, maxX: 6336, maxY: 6272 };
const size = { width: 752, height: 640 };
const close = (actual: number, expected: number, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

test("world/screen and tile-center round trips across detail, overview and negative bounds", () => {
  for (const zoom of [MIN_ZOOM, 0.004321, 0.333333333333, 1, 2.75, MAX_ZOOM]) {
    const view = { x: -23.3125, y: 3107.125, zoom };
    for (const x of [-128, -65, -64, -1, 0, 0.5, 31, 32, 63, 64, 6399.999]) {
      const screen = worldToScreen(x, -x, view);
      const world = screenToWorld(screen.x, screen.y, view);
      close(world.x, x);
      close(world.y, -x);
      const tile = tileToScreen(Math.floor(x), Math.floor(-x), view);
      assert.deepEqual(screenToTile(tile.x, tile.y, view), {
        x: Math.floor(x),
        y: Math.floor(-x) || 0,
      });
    }
  }
});

test("half-open picking floors both sides of signed tile/chunk/map edges", () => {
  const view = { x: 19.123, y: -32.234, zoom: 0.12345 };
  for (const edge of [-128, -65, -64, -1, 0, 1, 31, 32, 63, 64, 6336]) {
    for (const delta of [-0.000001, 0, 0.000001]) {
      const p = worldToScreen(edge + delta, edge + delta, view);
      assert.deepEqual(screenToTile(p.x, p.y, view), {
        x: edge + (delta < 0 ? -1 : 0),
        y: edge + (delta < 0 ? -1 : 0),
      });
    }
  }
  assert.deepEqual(worldToTile(-0.1, 0.9999), { x: -1, y: 0 });
});

test("10000 inverse anchored zooms do not drift or round the world anchor", () => {
  const initial = { x: 1000.125, y: -65.25, zoom: 2 };
  const anchor = { x: 381.25, y: 197.75 };
  const expected = screenToWorld(anchor.x, anchor.y, initial);
  let view = initial;
  for (let i = 0; i < 10000; i++) {
    view = zoomAt(view, 0.003783, anchor);
    view = zoomAt(view, initial.zoom, anchor);
  }
  close(view.x, initial.x);
  close(view.y, initial.y);
  const actual = screenToWorld(anchor.x, anchor.y, view);
  close(actual.x, expected.x);
  close(actual.y, expected.y);
  assert.equal(zoomAt(view, view.zoom, anchor), view);
});

test("fit includes all 100 by 100 chunks in resized hosts; limits always admit fit", () => {
  for (const dimensions of [
    size,
    { width: 268, height: 230 },
    { width: 1, height: 1 },
  ]) {
    const view = fitToMap(bounds, dimensions);
    const min = worldToScreen(bounds.minX, bounds.minY, view);
    const max = worldToScreen(bounds.maxX, bounds.maxY, view);
    assert.ok(min.x >= -1e-9 && min.y >= -1e-9);
    assert.ok(
      max.x <= dimensions.width + 1e-9 && max.y <= dimensions.height + 1e-9,
    );
    assert.ok(view.zoom >= zoomLimits(bounds, dimensions).min);
    close((min.x + max.x) / 2, dimensions.width / 2);
    close((min.y + max.y) / 2, dimensions.height / 2);
    assert.equal(canEditTiles(view), false);
  }
  assert.equal(clampZoom(100, bounds, size), MAX_ZOOM);
  assert.equal(clampZoom(1e-9, bounds, size), MIN_ZOOM);
  for (const zoom of [NaN, Infinity, -1, 0])
    assert.throws(() => clampZoom(zoom, bounds, size));
  assert.equal(canEditTiles({ x: 0, y: 0, zoom: 1 / 3 }), true);
  assert.equal(canEditTiles({ x: 0, y: 0, zoom: 1 / 3 - 1e-10 }), false);
});

test("pan has bounded overscroll in all directions, even when map is smaller than host", () => {
  for (const zoom of [MIN_ZOOM, 0.1, 1, MAX_ZOOM]) {
    for (const delta of [-1e8, 1e8]) {
      const view = panBy({ x: 0, y: 0, zoom }, delta, delta, bounds, size);
      const min = worldToScreen(bounds.minX, bounds.minY, view);
      const max = worldToScreen(bounds.maxX, bounds.maxY, view);
      const overlap = Math.min(48, (6400 * 24 * zoom) / 2);
      assert.ok(
        min.x <= size.width - overlap + 1e-7 && max.x >= overlap - 1e-7,
      );
      assert.ok(
        min.y <= size.height - overlap + 1e-7 && max.y >= overlap - 1e-7,
      );
      assert.deepEqual(panBy(view, delta, delta, bounds, size), view);
    }
  }
  const initial = { x: 320, y: 320, zoom: 1.25 };
  const panned = panBy(initial, 91.5, -131.75, bounds, size);
  const back = panBy(panned, -91.5, 131.75, bounds, size);
  close(back.x, initial.x);
  close(back.y, initial.y);
  assert.throws(() => panBy(initial, NaN, 0, bounds, size));
});

test("tile-edge round trips tolerate cancellation at distant camera origins", () => {
  for (const origin of [-6400.234, -3200.123, 3200.123, 6400.234])
    for (const zoom of [MIN_ZOOM, 0.12345, 1, MAX_ZOOM]) {
      const view = { x: origin, y: -origin, zoom };
      for (const edge of [-64, -1, 0, 1, 64]) {
        const screen = worldToScreen(edge, edge, view);
        assert.deepEqual(screenToTile(screen.x, screen.y, view), {
          x: edge,
          y: edge,
        });
      }
    }
});

test("session navigation is transient, tool picking is gated, and text keeps shortcuts", async () => {
  const { EditorSession } = await import("../../src/editor/session.ts");
  const { MapDocument } = await import("../../src/domain/document.ts");
  const session = new EditorSession(new MapDocument({ bounds }));
  session.setCanvasSize(size.width, size.height);
  session.canvasState.set("ready");
  const version = session.document.version;
  const history = session.history.state;
  const originalBounds = session.document.bounds;
  session.pan(-100, -100);
  session.setZoom(2, { x: 40, y: 50 });
  session.perform("pan");
  assert.equal(session.activeTool.getSnapshot(), "pan");
  session.fitMap();
  assert.equal(session.action("pencil").reason, null);
  assert.equal(session.action("eraser").reason, null);
  assert.match(session.action("line").reason!, /Overview/);
  assert.equal(session.editableTileAt({ x: 100, y: 100 }), null);
  assert.equal(session.routeKey({ key: "0" }, "text"), false);
  session.routeKey({ key: "0" }, "canvas");
  assert.equal(session.viewport.getSnapshot().zoom, 1);
  const tile = session.editableTileAt({
    x: size.width / 2,
    y: size.height / 2,
  });
  assert.ok(tile);
  session.viewport.set({ x: bounds.minX - 10, y: bounds.minY - 10, zoom: 1 });
  assert.equal(session.editableTileAt({ x: 24, y: 24 }), null);
  const view = session.viewport.getSnapshot();
  session.setCanvasSize(268, 240);
  assert.equal(session.viewport.getSnapshot(), view);
  assert.equal(session.document.bounds, originalBounds);
  assert.equal(session.document.version, version);
  assert.deepEqual(session.history.state, history);
  session.dispose();
  assert.equal(session.editableTileAt({ x: 100, y: 100 }), null);
});
