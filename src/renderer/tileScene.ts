import { BufferImageSource, Container, Sprite, Texture } from "pixi.js";
import type { MapDocument } from "../domain/document";
import type { LayerId, RegistryId } from "../domain/values";
import type { CanvasInvalidation } from "../editor/invalidation";
import { CANVAS_INSET, TILE_PIXELS, type Viewport } from "../editor/viewport";
import { OverviewScene } from "./overviewScene";
import { OVERVIEW_THRESHOLD } from "./overview";
import {
  CHUNK_BYTES,
  RENDER_CHUNK_SIZE,
  intersects,
  rasterizeChunk,
  visibleChunks,
  type VisibleChunk,
} from "./chunks";

type Chunk = {
  region: VisibleChunk;
  registryIds: Set<RegistryId>;
  cells: number;
  sprite?: Sprite;
  source?: BufferImageSource;
};
type Layer = { container: Container; chunks: Map<string, Chunk> };

/** Disposable GPU projection; authoritative tiles stay in the document. */
export class TileScene {
  readonly container = new Container();
  #document: MapDocument;
  #layers = new Map<LayerId, Layer>();
  #builds = 0;
  #uploads = 0;
  #created = 0;
  #released = 0;
  #runs = 0;
  #destroyed = false;
  #overview: OverviewScene;
  #mode: "detail" | "overview" = "detail";

  constructor(
    document: MapDocument,
    changed: () => void,
    error: (error: unknown) => void,
  ) {
    this.#document = document;
    this.#overview = new OverviewScene(document, changed, error);
    this.container.addChild(this.#overview.container);
  }

  sync(
    view: Viewport,
    width: number,
    height: number,
    hidden: readonly LayerId[] = [],
    density = 1,
  ): void {
    if (this.#destroyed) return;
    this.#mode =
      TILE_PIXELS * view.zoom < OVERVIEW_THRESHOLD ? "overview" : "detail";
    this.#overview.sync(
      view,
      width,
      height,
      hidden,
      density,
      this.#mode === "overview",
    );
    if (this.#mode === "overview") {
      for (const layer of this.#layers.values()) this.#dropLayer(layer);
      this.#layers.clear();
      return;
    }
    const regions = visibleChunks(this.#document.bounds, view, width, height);
    const keys = new Set(regions.map((region) => region.key));
    const order = this.#document.layers.filter(
      ({ id }) => !hidden.includes(id),
    );
    const ids = new Set(order.map(({ id }) => id));
    for (const [id, layer] of this.#layers)
      if (!ids.has(id)) {
        this.#dropLayer(layer);
        this.#layers.delete(id);
      }
    for (const [index, { id }] of order.entries()) {
      let layer = this.#layers.get(id);
      if (!layer) {
        layer = { container: new Container(), chunks: new Map() };
        this.#layers.set(id, layer);
        this.container.addChild(layer.container);
      }
      this.container.setChildIndex(layer.container, index);
      for (const [key, chunk] of layer.chunks)
        if (!keys.has(key)) {
          this.#release(chunk);
          layer.chunks.delete(key);
        }
      for (const region of regions) {
        if (layer.chunks.has(region.key)) continue;
        const chunk: Chunk = { region, registryIds: new Set(), cells: 0 };
        layer.chunks.set(region.key, chunk);
        this.#build(id, layer, chunk);
      }
      // Camera-relative positions avoid large world coordinates in GPU float32.
      const scale = TILE_PIXELS * view.zoom;
      for (const chunk of layer.chunks.values()) {
        if (!chunk.sprite) continue;
        chunk.sprite.position.set(
          CANVAS_INSET + (chunk.region.x - view.x) * scale,
          CANVAS_INSET + (chunk.region.y - view.y) * scale,
        );
        chunk.sprite.scale.set(scale);
      }
    }
  }

  invalidate(change: CanvasInvalidation): boolean {
    if (this.#destroyed) return false;
    const overviewChanged = this.#overview.invalidate(change);
    if (this.#mode === "overview") return overviewChanged;
    if (change.bounds) {
      for (const layer of this.#layers.values()) {
        for (const chunk of layer.chunks.values()) this.#release(chunk);
        layer.chunks.clear();
      }
      return true;
    }
    let changed = change.composition;
    const ids = new Set(this.#document.layers.map(({ id }) => id));
    for (const [id, layer] of this.#layers) {
      if (!ids.has(id)) continue;
      const regions = change.regions.filter((region) => region.layerId === id);
      for (const chunk of layer.chunks.values()) {
        if (
          regions.some((region) => intersects(region, chunk.region.bounds)) ||
          change.registryIds.some((id) => chunk.registryIds.has(id))
        ) {
          this.#build(id, layer, chunk);
          changed = true;
        }
      }
    }
    return changed;
  }

  #build(id: LayerId, layer: Layer, chunk: Chunk): void {
    const data = rasterizeChunk(this.#document, id, chunk.region);
    this.#builds++;
    this.#runs += data.runs;
    chunk.registryIds = data.registryIds;
    chunk.cells = data.cells;
    if (!data.pixels) {
      this.#release(chunk);
      return;
    }
    if (chunk.source) {
      (chunk.source.resource as Uint8Array).set(data.pixels);
      chunk.source.update();
    } else {
      chunk.source = new BufferImageSource({
        resource: data.pixels,
        width: RENDER_CHUNK_SIZE,
        height: RENDER_CHUNK_SIZE,
        format: "rgba8unorm",
        alphaMode: "premultiplied-alpha",
        scaleMode: "nearest",
        autoGenerateMipmaps: false,
      });
      chunk.sprite = new Sprite(new Texture({ source: chunk.source }));
      layer.container.addChild(chunk.sprite);
      this.#created++;
    }
    this.#uploads++;
  }
  #release(chunk: Chunk): void {
    if (!chunk.sprite) return;
    chunk.sprite.destroy({ texture: true, textureSource: true });
    chunk.sprite = undefined;
    chunk.source = undefined;
    this.#released++;
  }
  #dropLayer(layer: Layer): void {
    for (const chunk of layer.chunks.values()) this.#release(chunk);
    layer.chunks.clear();
    layer.container.destroy();
  }
  snapshot() {
    let chunks = 0,
      textures = 0,
      cells = 0;
    for (const layer of this.#layers.values())
      for (const chunk of layer.chunks.values()) {
        chunks++;
        textures += Number(!!chunk.sprite);
        cells += chunk.cells;
      }
    return {
      mode: this.#mode,
      overview: this.#overview.snapshot(),
      layers: this.#layers.size,
      chunks,
      textures,
      sprites: textures,
      cells,
      textureBytes: textures * CHUNK_BYTES,
      cpuPixelBytes: textures * CHUNK_BYTES,
      builds: this.#builds,
      uploads: this.#uploads,
      created: this.#created,
      released: this.#released,
      runs: this.#runs,
    };
  }
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const layer of this.#layers.values()) this.#dropLayer(layer);
    this.#layers.clear();
    this.#overview.destroy();
    this.container.destroy();
  }
}
