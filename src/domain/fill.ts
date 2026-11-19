import { containsTile } from "./coordinates.ts";
import type {
  MapDocument,
  PreparedTiles,
  TilePreparationOptions,
  TileWrite,
} from "./document.ts";
import { copyCell, equalCells, type Cell, type LayerId } from "./values.ts";

/** Four-neighbor connectivity on one layer; identity equality, never resolved RGB.
 * A bounded scanline worklist and sparse visited bitsets avoid recursion and
 * per-cell object queues. Each generator step probes at most a small row segment.
 */
function* fillWrites(
  document: MapDocument,
  layerId: LayerId,
  x: number,
  y: number,
  value: Cell,
): Generator<TileWrite | null> {
  const bounds = document.bounds;
  if (!containsTile(bounds, x, y)) return;
  const source = document.getCell(layerId, x, y);
  if (equalCells(source, value)) return;
  const visited = new Map<string, Uint32Array>();
  const bits = (x: number, y: number, mark = false) => {
    const cx = Math.floor(x / 32),
      cy = Math.floor(y / 32),
      key = `${cx},${cy}`;
    let block = visited.get(key);
    if (!block && mark) visited.set(key, (block = new Uint32Array(32)));
    const row = y - cy * 32,
      mask = 1 << (x - cx * 32);
    const seen = !!(block && block[row] & mask);
    if (mark) block![row] |= mask;
    return seen;
  };
  const matches = (x: number, y: number) =>
    containsTile(bounds, x, y) &&
    !bits(x, y) &&
    equalCells(document.getCell(layerId, x, y), source);
  const stack: { x: number; y: number }[] = [{ x, y }];
  let skipped = 0;
  while (stack.length) {
    const seed = stack.pop()!;
    if (!matches(seed.x, seed.y)) {
      if (++skipped % 256 === 0) yield null;
      continue;
    }
    let left = seed.x,
      right = seed.x;
    while (seed.x - left < 256 && matches(left - 1, seed.y)) left--;
    while (right - seed.x < 256 && matches(right + 1, seed.y)) right++;
    for (let x = left; x <= right; x++) bits(x, seed.y, true);
    if (matches(left - 1, seed.y)) stack.push({ x: left - 1, y: seed.y });
    if (matches(right + 1, seed.y)) stack.push({ x: right + 1, y: seed.y });
    for (const y of [seed.y - 1, seed.y + 1]) {
      let previous = false;
      for (let x = left; x <= right; x++) {
        const match = matches(x, y);
        if (match && !previous) stack.push({ x, y });
        previous = match;
      }
    }
    yield { layerId, x: left, y: seed.y, length: right - left + 1, value };
  }
}

/** Staging is cancelable and leaves the entire live document/history untouched. */
export function prepareFloodFill(
  document: MapDocument,
  layerId: LayerId,
  seed: { readonly x: number; readonly y: number },
  replacement: Cell,
  options: TilePreparationOptions = {},
): Promise<PreparedTiles> {
  const value = copyCell(replacement);
  return document.prepareTiles(
    fillWrites(document, layerId, seed.x, seed.y, value),
    options,
  );
}
