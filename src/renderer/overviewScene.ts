import {
  BufferImageSource,
  Container,
  Rectangle,
  Sprite,
  Texture,
} from "pixi.js";
import type { MapDocument } from "../domain/document";
import type { LayerId } from "../domain/values";
import type { CanvasInvalidation } from "../editor/invalidation";
import { CANVAS_INSET, TILE_PIXELS, type Viewport } from "../editor/viewport";
import { OverviewCache, overviewRegions, type OverviewEntry } from "./overview";

type Image = {
  sprite: Sprite;
  source: BufferImageSource;
  entry: OverviewEntry;
};

/** GPU resources follow the cache's explicit LRU/TTL lifetime, including offscreen images. */
export class OverviewScene {
  readonly container = new Container();
  #document: MapDocument;
  #cache: OverviewCache;
  #images = new Map<string, Image>();
  #view: Viewport = { x: 0, y: 0, zoom: 1 };
  #created = 0;
  #released = 0;
  constructor(
    document: MapDocument,
    changed: () => void,
    error: (error: unknown) => void,
  ) {
    this.#document = document;
    this.#cache = new OverviewCache(document, {
      now: () => performance.now(),
      schedule: (work) => {
        const id = requestAnimationFrame(work);
        return () => cancelAnimationFrame(id);
      },
      expire: (work, delay) => {
        const id = setTimeout(work, delay);
        return () => clearTimeout(id);
      },
      publish: (entry) => this.#publish(entry),
      release: (entry) => this.#release(entry),
      changed,
      error,
    });
    this.container.visible = false;
  }
  sync(
    view: Viewport,
    width: number,
    height: number,
    hidden: readonly LayerId[],
    density: number,
    active: boolean,
  ): void {
    this.#view = view;
    this.container.visible = active;
    this.#cache.sync(
      active
        ? overviewRegions(this.#document.bounds, view, width, height, density)
        : [],
      hidden,
    );
    for (const image of this.#images.values()) this.#position(image);
  }
  invalidate(change: CanvasInvalidation): boolean {
    return this.#cache.invalidate(change);
  }
  #publish(entry: OverviewEntry): void {
    if (!entry.pixels) {
      this.#release(entry);
      return;
    }
    const region = entry.region;
    let image = this.#images.get(region.key);
    if (image) {
      (image.source.resource as Uint8Array).set(entry.pixels);
      entry.pixels = image.source.resource as Uint8Array;
      image.source.update();
    } else {
      const source = new BufferImageSource({
        resource: entry.pixels,
        width: region.pixels,
        height: region.pixels,
        format: "rgba8unorm",
        alphaMode: "premultiplied-alpha",
        scaleMode: "nearest",
        autoGenerateMipmaps: false,
      });
      // Crop fractional edge texels to exact world bounds. Never paint outside the map.
      const frame = new Rectangle(
        (region.bounds.minX - region.x) / region.step,
        (region.bounds.minY - region.y) / region.step,
        (region.bounds.maxX - region.bounds.minX) / region.step,
        (region.bounds.maxY - region.bounds.minY) / region.step,
      );
      const sprite = new Sprite(new Texture({ source, frame }));
      image = { source, sprite, entry };
      this.#images.set(region.key, image);
      this.container.addChild(sprite);
      this.#created++;
    }
    this.#position(image);
  }
  #position({ sprite, entry }: Image): void {
    sprite.visible = this.#cache.visible.has(entry.region.key);
    const scale = TILE_PIXELS * this.#view.zoom;
    sprite.position.set(
      CANVAS_INSET + (entry.region.bounds.minX - this.#view.x) * scale,
      CANVAS_INSET + (entry.region.bounds.minY - this.#view.y) * scale,
    );
    sprite.scale.set(scale * entry.region.step);
  }
  #release(entry: OverviewEntry): void {
    const image = this.#images.get(entry.region.key);
    if (!image) return;
    image.sprite.destroy({ texture: true, textureSource: true });
    this.#images.delete(entry.region.key);
    this.#released++;
  }
  snapshot() {
    return {
      ...this.#cache.snapshot(),
      textures: this.#images.size,
      sprites: this.#images.size,
      created: this.#created,
      released: this.#released,
    };
  }
  destroy(): void {
    this.#cache.destroy();
    this.container.destroy();
  }
}
