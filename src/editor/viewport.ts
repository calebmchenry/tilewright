import type { Bounds } from "../domain/coordinates.ts";

/** CSS pixel transform only. Device pixels are exclusively a renderer concern. */
export interface Viewport {
  /** World coordinate at the fixed canvas inset. */
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface ViewSize {
  readonly width: number;
  readonly height: number;
}
export const TILE_PIXELS = 24;
export const CANVAS_INSET = 24;
export const MAX_ZOOM = 8;
export const MIN_ZOOM = 1 / 1024;
export const MIN_EDIT_PIXELS = 8;
export const OVERVIEW_MESSAGE =
  "Overview · Zoom in for this tool (8 px per tile minimum). Pencil and Eraser work at any zoom.";

export function worldToScreen(x: number, y: number, view: Viewport): Point {
  const scale = TILE_PIXELS * view.zoom;
  return {
    x: CANVAS_INSET + (x - view.x) * scale,
    y: CANVAS_INSET + (y - view.y) * scale,
  };
}
export function screenToWorld(x: number, y: number, view: Viewport): Point {
  const scale = TILE_PIXELS * view.zoom;
  return {
    x: view.x + (x - CANVAS_INSET) / scale,
    y: view.y + (y - CANVAS_INSET) / scale,
  };
}
/** Snap only floating-point roundoff at an integer edge, then use mathematical floor. */
function tileFloor(value: number, magnitude = Math.abs(value)): number {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <=
    Number.EPSILON * 8 * Math.max(1, Math.abs(value), magnitude)
    ? nearest === 0
      ? 0
      : nearest
    : Math.floor(value);
}
export function worldToTile(x: number, y: number): Point {
  return Object.freeze({ x: tileFloor(x), y: tileFloor(y) });
}
/** A tile address maps to its center; use worldToScreen for grid intersections. */
export function tileToScreen(x: number, y: number, view: Viewport): Point {
  return worldToScreen(x + 0.5, y + 0.5, view);
}
export function screenToTile(x: number, y: number, view: Viewport): Point {
  const world = screenToWorld(x, y, view);
  return Object.freeze({
    x: tileFloor(
      world.x,
      Math.abs(view.x) +
        Math.abs((x - CANVAS_INSET) / (TILE_PIXELS * view.zoom)),
    ),
    y: tileFloor(
      world.y,
      Math.abs(view.y) +
        Math.abs((y - CANVAS_INSET) / (TILE_PIXELS * view.zoom)),
    ),
  });
}
/** Brushes work at every zoom; precise tile picking keeps the detail threshold. */
export function canEditTiles(view: Viewport, tool?: string): boolean {
  return (
    tool === "pencil" ||
    tool === "eraser" ||
    view.zoom * TILE_PIXELS >= MIN_EDIT_PIXELS
  );
}
export function viewCenter(size: ViewSize): Point {
  return { x: size.width / 2, y: size.height / 2 };
}
/** Padding shrinks for tiny/hidden hosts; fit remains finite and positive. */
export function fitZoom(bounds: Bounds, size: ViewSize): number {
  const available = (length: number) =>
    Math.max(1, length - Math.min(CANVAS_INSET * 2, length / 2));
  return Math.min(
    MAX_ZOOM,
    available(size.width) / ((bounds.maxX - bounds.minX) * TILE_PIXELS),
    available(size.height) / ((bounds.maxY - bounds.minY) * TILE_PIXELS),
  );
}
export function zoomLimits(bounds: Bounds, size: ViewSize) {
  return { min: Math.min(MIN_ZOOM, fitZoom(bounds, size)), max: MAX_ZOOM };
}
export function clampZoom(
  zoom: number,
  bounds: Bounds,
  size: ViewSize,
): number {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new RangeError("Zoom must be finite and positive.");
  const limits = zoomLimits(bounds, size);
  return Math.max(limits.min, Math.min(limits.max, zoom));
}
/** Solve from the current world anchor, without rounding camera coordinates. */
export function zoomAt(view: Viewport, zoom: number, anchor: Point): Viewport {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new RangeError("Zoom must be finite and positive.");
  if (zoom === view.zoom) return view;
  const world = screenToWorld(anchor.x, anchor.y, view);
  const scale = TILE_PIXELS * zoom;
  return Object.freeze({
    x: world.x - (anchor.x - CANVAS_INSET) / scale,
    y: world.y - (anchor.y - CANVAS_INSET) / scale,
    zoom,
  });
}
export function fitToMap(bounds: Bounds, size: ViewSize): Viewport {
  const zoom = fitZoom(bounds, size),
    scale = TILE_PIXELS * zoom;
  return Object.freeze({
    x:
      bounds.minX +
      (bounds.maxX - bounds.minX) / 2 -
      (size.width / 2 - CANVAS_INSET) / scale,
    y:
      bounds.minY +
      (bounds.maxY - bounds.minY) / 2 -
      (size.height / 2 - CANVAS_INSET) / scale,
    zoom,
  });
}
/** Reveal an area with Fit padding, without magnifying small features past 100%. */
export function focusOnBounds(bounds: Bounds, size: ViewSize): Viewport {
  const fitted = fitToMap(bounds, size);
  return zoomAt(fitted, Math.min(1, fitted.zoom), viewCenter(size));
}
/** Constrain pan only. Zoom anchoring must not be shifted by a second clamp. */
export function panBy(
  view: Viewport,
  dx: number,
  dy: number,
  bounds: Bounds,
  size: ViewSize,
): Viewport {
  if (![dx, dy].every(Number.isFinite))
    throw new RangeError("Pan must be finite.");
  const scale = TILE_PIXELS * view.zoom;
  const axis = (
    position: number,
    delta: number,
    min: number,
    max: number,
    length: number,
  ) => {
    const overlap = Math.min(
      48,
      Math.max(1, length / 2),
      ((max - min) * scale) / 2,
    );
    const low = min - (Math.max(1, length) - overlap - CANVAS_INSET) / scale;
    const high = max - (overlap - CANVAS_INSET) / scale;
    return Math.max(low, Math.min(high, position - delta / scale));
  };
  return Object.freeze({
    x: axis(view.x, dx, bounds.minX, bounds.maxX, size.width),
    y: axis(view.y, dy, bounds.minY, bounds.maxY, size.height),
    zoom: view.zoom,
  });
}
