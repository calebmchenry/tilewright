import type { FocusOwner } from "./session";

/** Inspect the event target, not a cached owner: focus can change between events. */
export function focusOwner(target: EventTarget | null): FocusOwner {
  if (!(target instanceof Element)) return "outside";
  if (
    target.closest(
      'input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
    )
  )
    return "text";
  if (target.closest('[data-focus-owner="canvas"]')) return "canvas";
  if (target.closest("[data-editor-root]")) return "panel";
  return "outside";
}
