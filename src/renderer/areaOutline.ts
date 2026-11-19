import type { Bounds } from "../domain/coordinates.ts";
import {
  worldToScreen,
  type Viewport,
  type ViewSize,
} from "../editor/viewport.ts";

export interface OutlineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  corner: boolean;
}
/** Clip actual edges, never invent an edge at the viewport boundary. CSS pixels only. */
export function areaOutline(
  bounds: Bounds,
  view: Viewport,
  size: ViewSize,
): OutlineSegment[] {
  const a = worldToScreen(bounds.minX, bounds.minY, view);
  const b = worldToScreen(bounds.maxX, bounds.maxY, view);
  const lines: OutlineSegment[] = [];
  function horizontal(x1: number, x2: number, y: number, corner = false) {
    const left = Math.max(0, Math.min(x1, x2)),
      right = Math.min(size.width, Math.max(x1, x2));
    if (y >= 0 && y <= size.height && right > left)
      lines.push({ x1: left, y1: y, x2: right, y2: y, corner });
  }
  function vertical(x: number, y1: number, y2: number, corner = false) {
    const top = Math.max(0, Math.min(y1, y2)),
      bottom = Math.min(size.height, Math.max(y1, y2));
    if (x >= 0 && x <= size.width && bottom > top)
      lines.push({ x1: x, y1: top, x2: x, y2: bottom, corner });
  }
  horizontal(a.x, b.x, a.y);
  horizontal(a.x, b.x, b.y);
  vertical(a.x, a.y, b.y);
  vertical(b.x, a.y, b.y);
  const dx = Math.min(7, (b.x - a.x) / 2),
    dy = Math.min(7, (b.y - a.y) / 2);
  for (const [x, directionX] of [
    [a.x, 1],
    [b.x, -1],
  ])
    for (const [y, directionY] of [
      [a.y, 1],
      [b.y, -1],
    ]) {
      horizontal(x, x + directionX * dx, y, true);
      vertical(x, y, y + directionY * dy, true);
    }
  return lines;
}
