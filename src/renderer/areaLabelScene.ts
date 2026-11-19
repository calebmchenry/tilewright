import {
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
  TextStyle,
  TexturePool,
} from "pixi.js";
import { validateNamedArea, type AreaTier } from "../domain/annotations";
import type { MapDocument } from "../domain/document";
import { annotationId } from "../domain/values";
import type { Point, Viewport, ViewSize } from "../editor/viewport";
import {
  LABEL_FONT_SIZE,
  fitLabelText,
  labelCandidates,
  placeLabels,
  type LabelArea,
  type LabelSelection,
  type LabelText,
  type PlacedLabel,
} from "./areaLabels";

type Visual = {
  container: Container;
  background: Graphics;
  text: Text;
  label: PlacedLabel;
  density: number;
};
type Measurement = {
  name: string;
  tier: AreaTier;
  cap: number;
  height: number;
  fitted: LabelText | null;
};

/** Only current candidates retain measurements; only accepted boxes own Pixi objects. */
export class AreaLabelScene {
  readonly container = new Container({ eventMode: "none" });
  #document: MapDocument;
  #visuals = new Map<string, Visual>();
  #measurements = new Map<string, Measurement>();
  #styles = new Map<AreaTier, TextStyle>();
  #lastKey = "";
  #dirty = true;
  #destroyed = false;
  #created = 0;
  #released = 0;
  #textUpdates = 0;
  #layouts = 0;
  #candidates = 0;
  #placed: PlacedLabel[] = [];

  constructor(document: MapDocument) {
    this.#document = document;
    for (const tier of ["detail", "locality", "region"] as const)
      this.#styles.set(
        tier,
        new TextStyle({
          fontFamily: [
            "system-ui",
            "-apple-system",
            "BlinkMacSystemFont",
            "Segoe UI",
            "sans-serif",
          ],
          fontSize: LABEL_FONT_SIZE[tier],
          fontWeight: "500",
          lineHeight: LABEL_FONT_SIZE[tier] + 4,
          fill: "#f5f7fb",
          wordWrap: false,
        }),
      );
  }

  invalidate(ids: readonly string[]): void {
    if (!ids.length) return;
    this.#dirty = true;
    // The new name/tier is compared before measuring; description-only edits
    // preserve both the measurement and the live text texture.
  }

  *#areas(): Generator<LabelArea> {
    for (const [id, record] of this.#document.annotations) {
      try {
        const { name, tier, bounds } = validateNamedArea(
          record,
          this.#document.bounds,
        );
        yield { id, name, tier, bounds };
      } catch {
        // Generic metadata fixtures are not named-area records. Never invent a label.
      }
    }
  }

  sync(
    view: Viewport,
    size: ViewSize,
    selection: LabelSelection | null,
    density: number,
  ): void {
    if (this.#destroyed) return;
    const key = JSON.stringify([view, size, selection, density]);
    if (!this.#dirty && key === this.#lastKey) return;
    this.#dirty = false;
    this.#lastKey = key;
    this.#layouts++;
    const candidates = labelCandidates(this.#areas(), view, size, selection);
    this.#candidates = candidates.length;
    const visible = new Set(candidates.map((area) => area.id));
    for (const id of this.#measurements.keys())
      if (!visible.has(id)) this.#measurements.delete(id);
    const placed = placeLabels(candidates, size, (area) => {
      let measured = this.#measurements.get(area.id);
      const cap = Math.min(240, size.width - 8);
      if (
        !measured ||
        measured.name !== area.name ||
        measured.tier !== area.tier ||
        measured.cap !== cap ||
        measured.height !== size.height
      ) {
        const style = this.#styles.get(area.tier)!;
        measured = {
          name: area.name,
          tier: area.tier,
          cap,
          height: size.height,
          fitted: fitLabelText(
            area.name,
            area.tier,
            size,
            (text) => CanvasTextMetrics.measureText(text, style).width,
          ),
        };
        this.#measurements.set(area.id, measured);
      }
      return measured.fitted;
    });
    const accepted = new Set(placed.map((label) => label.id));
    for (const [id, visual] of this.#visuals)
      if (!accepted.has(id)) {
        this.#drop(visual);
        this.#visuals.delete(id);
      }
    for (const label of placed) {
      let visual = this.#visuals.get(label.id);
      if (!visual) {
        const container = new Container({ eventMode: "none" });
        const background = new Graphics();
        const text = new Text({
          text: label.text,
          style: this.#styles.get(label.tier),
          resolution: density,
          anchor: 0.5,
        });
        container.addChild(background, text);
        this.container.addChild(container);
        visual = { container, background, text, label, density };
        this.#visuals.set(label.id, visual);
        this.#created++;
        this.#background(visual, label);
      } else {
        if (
          visual.label.text !== label.text ||
          visual.label.tier !== label.tier ||
          visual.density !== density
        ) {
          visual.text.text = label.text;
          if (visual.label.tier !== label.tier)
            visual.text.style = this.#styles.get(label.tier)!;
          if (visual.density !== density) visual.text.resolution = density;
          this.#textUpdates++;
        }
        if (
          visual.label.width !== label.width ||
          visual.label.height !== label.height ||
          visual.label.selected !== label.selected
        )
          this.#background(visual, label);
        visual.label = label;
        visual.density = density;
      }
      visual.container.position.set(label.x, label.y);
      visual.text.position.set(label.width / 2, label.height / 2);
    }
    this.#placed = placed;
  }

  #background(visual: Visual, label: PlacedLabel): void {
    visual.background
      .clear()
      .roundRect(0, 0, label.width, label.height, 4)
      .fill({ color: label.selected ? "#352345" : "#101722", alpha: 0.92 });
    if (label.selected)
      visual.background.stroke({ color: "#dda6ff", width: 1.5, alignment: 1 });
  }
  #drop(visual: Visual): void {
    // Shared tier styles belong to this scene, not to individual Text instances.
    visual.container.destroy({ children: true, context: true });
    this.#released++;
  }
  /** Call after render: Pixi returns replaced text textures to its global idle pool. */
  releaseIdleTextures(): void {
    TexturePool.clear(true);
  }
  areaAt(point: Point) {
    const hit = this.#placed.find(
      (box) =>
        box.id &&
        point.x >= box.x &&
        point.y >= box.y &&
        point.x < box.x + box.width &&
        point.y < box.y + box.height,
    );
    return hit ? annotationId(hit.id) : null;
  }
  snapshot() {
    return {
      candidates: this.#candidates,
      measurements: this.#measurements.size,
      live: this.#visuals.size,
      created: this.#created,
      released: this.#released,
      textUpdates: this.#textUpdates,
      layouts: this.#layouts,
      labels: this.#placed.map((label) => ({
        ...label,
        uid: this.#visuals.get(label.id)!.text.uid,
      })),
    };
  }
  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    for (const visual of this.#visuals.values()) this.#drop(visual);
    this.#visuals.clear();
    this.#measurements.clear();
    this.#placed = [];
    this.#candidates = 0;
    this.#lastKey = "";
    for (const style of this.#styles.values()) style.destroy();
    this.#styles.clear();
    this.container.destroy();
    this.releaseIdleTextures();
  }
}
