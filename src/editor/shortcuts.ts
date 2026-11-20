import type { ActionId } from "./session.ts";
import type { SelectionTransform } from "../domain/selection.ts";

/** One vocabulary for dispatch and visible button hints. */
export const toolShortcuts = {
  i: "inspect",
  h: "pan",
  b: "pencil",
  e: "eraser",
  d: "eyedropper",
  g: "fill",
  l: "line",
  r: "rectangle",
  v: "select",
  a: "area",
  f: "fit-map",
} as const satisfies Record<string, ActionId>;

export const transformShortcuts = {
  z: "rotate-clockwise",
  "shift+z": "rotate-counterclockwise",
  x: "flip-horizontal",
  y: "flip-vertical",
} as const satisfies Record<string, SelectionTransform>;

export const shortcutHints: Partial<
  Record<ActionId | "new" | "open" | "save-as" | "export-agent", string>
> = {
  ...Object.fromEntries(
    Object.entries(toolShortcuts).map(([key, id]) => [id, key.toUpperCase()]),
  ),
  new: "⌘N",
  open: "⌘O",
  save: "⌘S",
  "save-as": "⇧⌘S",
  "export-agent": "⇧⌘E",
  undo: "⌘Z",
  redo: "⇧⌘Z",
  copy: "⌘C",
  cut: "⌘X",
  paste: "⌘V",
  cancel: "Esc",
};
