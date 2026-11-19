import type { AreaTier } from "../domain/annotations.ts";
import type { Bounds } from "../domain/coordinates.ts";
import {
  TILE_PIXELS,
  worldToScreen,
  type Point,
  type Viewport,
  type ViewSize,
} from "../editor/viewport.ts";

export const LABEL_FONT_SIZE = {
  detail: 13,
  locality: 15,
  region: 17,
} as const;
export interface LabelArea {
  readonly id: string;
  readonly name: string;
  readonly tier: AreaTier;
  readonly bounds: Bounds;
}
/** Even an invalid/unnamed draft suppresses the selected record's old label. */
export interface LabelSelection {
  readonly id: string | null;
  readonly area: LabelArea | null;
}
export interface LabelCandidate extends LabelArea {
  readonly anchor: Point;
  readonly selected: boolean;
}
export interface LabelText {
  readonly text: string;
  readonly width: number;
  readonly height: number;
}
export interface PlacedLabel extends LabelCandidate, LabelText {
  readonly x: number;
  readonly y: number;
}

export function visibleLabelTier(view: Viewport): AreaTier {
  const pixels = TILE_PIXELS * view.zoom;
  return pixels >= 8 ? "detail" : pixels >= 1 ? "locality" : "region";
}

/** CSS-only culling; no edge pinning for offscreen anchors, no tier fallback. */
export function labelCandidates(
  areas: Iterable<LabelArea>,
  view: Viewport,
  size: ViewSize,
  selection: LabelSelection | null = null,
): LabelCandidate[] {
  const tier = visibleLabelTier(view);
  const candidates: LabelCandidate[] = [];
  const add = (area: LabelArea, selected: boolean) => {
    if (!selected && area.tier !== tier) return;
    const b = area.bounds;
    const start = worldToScreen(b.minX, b.minY, view);
    const end = worldToScreen(b.maxX, b.maxY, view);
    if (
      end.x <= 0 ||
      end.y <= 0 ||
      start.x >= size.width ||
      start.y >= size.height
    )
      return;
    const anchor = worldToScreen(
      b.minX + (b.maxX - b.minX) / 2,
      b.minY + (b.maxY - b.minY) / 2,
      view,
    );
    if (
      anchor.x < 0 ||
      anchor.y < 0 ||
      anchor.x >= size.width ||
      anchor.y >= size.height
    )
      return;
    candidates.push({ ...area, anchor, selected });
  };
  if (selection?.area) add(selection.area, true);
  for (const area of areas) if (area.id !== selection?.id) add(area, false);
  return candidates.sort((a, b) =>
    a.selected !== b.selected
      ? a.selected
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Measure with the actual renderer font; never split an emoji/combining sequence. */
export function fitLabelText(
  name: string,
  tier: AreaTier,
  size: ViewSize,
  measure: (text: string) => number,
): LabelText | null {
  const cap = Math.min(240, size.width - 8);
  const height = LABEL_FONT_SIZE[tier] + 12;
  const ellipsis = measure("…");
  if (height > size.height - 8 || ellipsis + 12 > cap) return null;
  const width = measure(name);
  if (width + 12 <= cap) return { text: name, width: width + 12, height };
  let prefix = "";
  let fittedWidth = ellipsis;
  // Stop at the visible prefix: no array proportional to a huge hidden name.
  for (const { segment } of graphemes.segment(name)) {
    const nextWidth = measure(prefix + segment + "…");
    if (nextWidth + 12 > cap) break;
    prefix += segment;
    fittedWidth = nextWidth;
  }
  return { text: prefix + "…", width: fittedWidth + 12, height };
}

export function placeLabels(
  candidates: readonly LabelCandidate[],
  size: ViewSize,
  textFor: (candidate: LabelCandidate) => LabelText | null,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  for (const candidate of candidates) {
    const text = textFor(candidate);
    if (!text) continue;
    const box = {
      ...candidate,
      ...text,
      x: Math.max(
        4,
        Math.min(
          size.width - 4 - text.width,
          candidate.anchor.x - text.width / 2,
        ),
      ),
      y: Math.max(
        4,
        Math.min(
          size.height - 4 - text.height,
          candidate.anchor.y - text.height / 2,
        ),
      ),
    };
    if (
      placed.some(
        (other) =>
          box.x < other.x + other.width + 4 &&
          box.x + box.width > other.x - 4 &&
          box.y < other.y + other.height + 4 &&
          box.y + box.height > other.y - 4,
      )
    )
      continue;
    placed.push(box);
  }
  return placed;
}
