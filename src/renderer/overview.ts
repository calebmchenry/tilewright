import type { Bounds } from "../domain/coordinates.ts";
import type { MapDocument } from "../domain/document.ts";
import { cellKey, type LayerId } from "../domain/values.ts";
import type { CanvasInvalidation } from "../editor/invalidation.ts";
import { TILE_PIXELS, type Viewport } from "../editor/viewport.ts";
import { intersects, visibleChunks, type VisibleChunk } from "./chunks.ts";
import { resolveColor, type Rgba } from "./colors.ts";

export const OVERVIEW_THRESHOLD = 2; // CSS pixels/tile; editing has its own gate.
export const OVERVIEW_BYTES = 32 * 1024 * 1024; // CPU, plus equal GPU payload.
export const OVERVIEW_ENTRIES = 512;
export const OVERVIEW_TTL = 30_000;
export const OVERVIEW_SLICE_MS = 4;
export interface OverviewRegion extends VisibleChunk {
  readonly size: number;
  readonly step: number;
  readonly pixels: number;
}

/** At most 256 visible regions and 16 MiB, even for huge bounds or dense displays. */
export function overviewRegions(
  bounds: Bounds,
  view: Viewport,
  width: number,
  height: number,
  density = 1,
): OverviewRegion[] {
  if (
    ![view.x, view.y, view.zoom, width, height, density].every(
      Number.isFinite,
    ) ||
    view.zoom <= 0 ||
    density <= 0
  )
    throw new RangeError(
      "Overview viewport and density must be finite and positive.",
    );
  const scale = TILE_PIXELS * view.zoom;
  let size = 256;
  // Bound the lattice before enumerating it, independent of document size.
  const spanX = Math.min(bounds.maxX - bounds.minX, Math.max(0, width) / scale);
  const spanY = Math.min(
    bounds.maxY - bounds.minY,
    Math.max(0, height) / scale,
  );
  while ((Math.ceil(spanX / size) + 1) * (Math.ceil(spanY / size) + 1) > 256)
    size *= 2;
  const regions = visibleChunks(bounds, view, width, height, size);
  let step = 2 ** Math.max(0, Math.floor(Math.log2(1 / (scale * density))));
  while (
    size / step > 256 ||
    regions.length * (size / step) ** 2 * 4 > OVERVIEW_BYTES / 2
  )
    step *= 2;
  step = Math.min(size, step);
  return regions.map((region) => ({
    ...region,
    key: `${size}:${step}:${region.key}`,
    size,
    step,
    pixels: size / step,
  }));
}

/** Composite exact tiles BEFORE averaging, so overlapping holes/alpha stay correct.
 * Each next() finishes a <=256x16 tile block; no live document iterator crosses a yield.
 * One job uses <=2 MiB accumulation + 16 KiB workspace + 256 KiB output.
 */
export function* rasterizeOverview(
  document: MapDocument,
  region: OverviewRegion,
  hidden: readonly LayerId[],
): Generator<void, Uint8Array | null> {
  const layers = document.layers.filter(({ id }) => !hidden.includes(id));
  const sums = new Float64Array(region.pixels ** 2 * 4);
  const block = new Uint8Array(256 * 16 * 4);
  let occupied = false;
  for (let y = region.bounds.minY; y < region.bounds.maxY; y += 16) {
    for (let x = region.bounds.minX; x < region.bounds.maxX; x += 256) {
      const bounds = {
        minX: x,
        minY: y,
        maxX: Math.min(x + 256, region.bounds.maxX),
        maxY: Math.min(y + 16, region.bounds.maxY),
      };
      const width = bounds.maxX - x;
      block.fill(0);
      // Only block-local colors: an arbitrarily varied map cannot grow a palette cache.
      for (const { id } of layers) {
        const colors = new Map<string, Rgba>();
        for (const run of document.iterateRuns(id, bounds)) {
          occupied = true;
          const key = cellKey(run.value);
          let color = colors.get(key);
          if (!color) {
            const [r, g, b, a] = resolveColor(document, run.value);
            color = [
              Math.round((r * a) / 255),
              Math.round((g * a) / 255),
              Math.round((b * a) / 255),
              a,
            ];
            colors.set(key, color);
          }
          const [r, g, b, a] = color;
          const inverse = 1 - a / 255;
          let offset = ((run.y - y) * width + run.x - x) * 4;
          for (let i = 0; i < run.length; i++, offset += 4) {
            block[offset] = Math.round(r + block[offset] * inverse);
            block[offset + 1] = Math.round(g + block[offset + 1] * inverse);
            block[offset + 2] = Math.round(b + block[offset + 2] * inverse);
            block[offset + 3] = Math.round(a + block[offset + 3] * inverse);
          }
        }
      }
      let offset = 0;
      for (let py = y; py < bounds.maxY; py++) {
        const row = Math.floor((py - region.y) / region.step) * region.pixels;
        for (let px = x; px < bounds.maxX; px++, offset += 4) {
          const dest = (row + Math.floor((px - region.x) / region.step)) * 4;
          for (let c = 0; c < 4; c++) sums[dest + c] += block[offset + c];
        }
      }
      yield;
    }
  }
  if (!occupied) return null;
  const pixels = new Uint8Array(sums.length);
  for (let y = 0; y < region.pixels; y++) {
    const worldY = region.y + y * region.step;
    const rows = Math.max(
      0,
      Math.min(worldY + region.step, region.bounds.maxY) -
        Math.max(worldY, region.bounds.minY),
    );
    for (let x = 0; x < region.pixels; x++) {
      const worldX = region.x + x * region.step;
      const count =
        rows *
        Math.max(
          0,
          Math.min(worldX + region.step, region.bounds.maxX) -
            Math.max(worldX, region.bounds.minX),
        );
      if (!count) continue;
      const offset = (y * region.pixels + x) * 4;
      for (let c = 0; c < 4; c++)
        pixels[offset + c] = Math.round(sums[offset + c] / count);
    }
  }
  return pixels;
}

export interface OverviewEntry {
  readonly region: OverviewRegion;
  pixels: Uint8Array | null;
  dirty: boolean;
  ready: boolean;
  used: number;
}
export interface OverviewHooks {
  now(): number;
  schedule(work: () => void): () => void;
  expire(work: () => void, delay: number): () => void;
  publish(entry: OverviewEntry): void;
  release(entry: OverviewEntry): void;
  changed(): void;
  error(error: unknown): void;
}

/** Document-owned projection lifetime, deterministic scheduling seams for tests. */
export class OverviewCache {
  #document: MapDocument;
  #hooks: OverviewHooks;
  #entries = new Map<string, OverviewEntry>();
  #visible = new Set<string>();
  #hidden: readonly LayerId[] = [];
  #job?: {
    entry: OverviewEntry;
    version: number;
    task: ReturnType<typeof rasterizeOverview>;
  };
  #cancel?: () => void;
  #expiry?: () => void;
  #destroyed = false;
  #builds = 0;
  #discarded = 0;
  #slices = 0;
  #maxSliceMs = 0;
  #workMs = 0;
  #evictions = 0;

  constructor(document: MapDocument, hooks: OverviewHooks) {
    this.#document = document;
    this.#hooks = hooks;
  }
  get entries(): Iterable<OverviewEntry> {
    return this.#entries.values();
  }
  get visible(): ReadonlySet<string> {
    return this.#visible;
  }

  sync(regions: readonly OverviewRegion[], hidden: readonly LayerId[]): void {
    if (this.#destroyed) return;
    if (
      hidden.length !== this.#hidden.length ||
      hidden.some((id, i) => id !== this.#hidden[i])
    ) {
      this.#hidden = [...hidden];
      this.#abort();
      for (const entry of this.#entries.values()) entry.dirty = true;
    }
    this.#visible = new Set(regions.map(({ key }) => key));
    if (this.#job && !this.#visible.has(this.#job.entry.region.key))
      this.#abort();
    const now = this.#hooks.now();
    for (const region of regions) {
      let entry = this.#entries.get(region.key);
      if (!entry) {
        entry = { region, pixels: null, ready: false, dirty: true, used: now };
        this.#entries.set(region.key, entry);
      }
      entry.used = now;
    }
    this.#prune();
    this.#schedule();
  }
  invalidate(change: CanvasInvalidation): boolean {
    if (this.#destroyed) return false;
    // A live iterator is never resumed across a version change, even for unrelated edits.
    this.#abort();
    if (change.bounds) this.#clear();
    const all = change.composition || !!change.registryIds.length;
    let visibleDirty = change.bounds;
    for (const entry of this.#entries.values()) {
      if (
        all ||
        change.regions.some((region) => intersects(region, entry.region.bounds))
      ) {
        entry.dirty = true;
        visibleDirty ||= this.#visible.has(entry.region.key);
      }
    }
    this.#schedule();
    return visibleDirty;
  }
  #abort(): void {
    if (this.#job) this.#discarded++;
    this.#job = undefined;
  }
  #schedule(): void {
    if (this.#cancel || this.#destroyed || !this.#pending()) return;
    this.#cancel = this.#hooks.schedule(() => {
      this.#cancel = undefined;
      if (this.#destroyed) return;
      try {
        this.#work();
      } catch (error) {
        this.destroy();
        this.#hooks.error(error);
      }
    });
  }
  #pending(): OverviewEntry | undefined {
    for (const key of this.#visible) {
      const entry = this.#entries.get(key);
      if (entry?.dirty) return entry;
    }
  }
  #work(): void {
    const start = this.#hooks.now();
    let published = false;
    // Work-budget yield plus a unit cap for deterministic clocks and cheap empty blocks.
    for (let units = 0; units < 64; units++) {
      if (this.#job && this.#job.version !== this.#document.version)
        this.#abort();
      if (!this.#job) {
        const entry = this.#pending();
        if (!entry) break;
        this.#job = {
          entry,
          version: this.#document.version,
          task: rasterizeOverview(this.#document, entry.region, this.#hidden),
        };
      }
      const result = this.#job.task.next();
      if (result.done) {
        const entry = this.#job.entry;
        entry.pixels = result.value;
        entry.ready = true;
        entry.dirty = false;
        this.#hooks.publish(entry);
        this.#job = undefined;
        this.#builds++;
        published = true;
        this.#prune();
      }
      if (this.#hooks.now() - start >= OVERVIEW_SLICE_MS) break;
    }
    const duration = this.#hooks.now() - start;
    this.#slices++;
    this.#workMs += duration;
    this.#maxSliceMs = Math.max(this.#maxSliceMs, duration);
    this.#schedule();
    if (published || !this.#pending()) this.#hooks.changed();
  }
  #drop(entry: OverviewEntry): void {
    this.#hooks.release(entry);
    this.#entries.delete(entry.region.key);
    this.#evictions++;
  }
  #prune(): void {
    const now = this.#hooks.now();
    const unused = [...this.#entries.values()]
      .filter((e) => !this.#visible.has(e.region.key))
      .sort((a, b) => a.used - b.used);
    let bytes = this.#bytes();
    for (const entry of unused) {
      if (
        now - entry.used < OVERVIEW_TTL &&
        bytes <= OVERVIEW_BYTES &&
        this.#entries.size <= OVERVIEW_ENTRIES
      )
        break;
      bytes -= entry.pixels?.byteLength ?? 0;
      this.#drop(entry);
    }
    this.#expiry?.();
    this.#expiry = undefined;
    const oldest = [...this.#entries.values()]
      .filter((e) => !this.#visible.has(e.region.key))
      .sort((a, b) => a.used - b.used)[0];
    if (oldest)
      this.#expiry = this.#hooks.expire(
        () => {
          this.#expiry = undefined;
          if (!this.#destroyed) this.#prune();
        },
        Math.max(1, oldest.used + OVERVIEW_TTL - now),
      );
  }
  #bytes(): number {
    let bytes = 0;
    for (const entry of this.#entries.values())
      bytes += entry.pixels?.byteLength ?? 0;
    return bytes;
  }
  snapshot() {
    let pending = 0;
    for (const key of this.#visible)
      if (this.#entries.get(key)?.dirty) pending++;
    return {
      entries: this.#entries.size,
      visible: this.#visible.size,
      pending,
      bytes: this.#bytes(),
      builds: this.#builds,
      discarded: this.#discarded,
      slices: this.#slices,
      maxSliceMs: this.#maxSliceMs,
      workMs: this.#workMs,
      evictions: this.#evictions,
      scheduled: !!this.#cancel,
    };
  }
  #clear(): void {
    for (const entry of [...this.#entries.values()]) this.#drop(entry);
  }
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancel?.();
    this.#cancel = undefined;
    this.#expiry?.();
    this.#expiry = undefined;
    this.#abort();
    this.#visible.clear();
    this.#clear();
  }
}
