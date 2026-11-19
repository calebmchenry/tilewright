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

/** Restore abandoned focus after React removes a dialog or temporary control.
 * Never take focus from a newer dialog or the user's next field. */
export function restoreFocus(
  preferred?: Element | null,
  fromDialog = false,
): void {
  queueMicrotask(() => {
    if (document.querySelector("dialog[open]")) return;
    const active = document.activeElement;
    if (
      !fromDialog &&
      active &&
      active !== document.body &&
      active.isConnected &&
      !active.matches(":disabled")
    )
      return;
    const target =
      preferred instanceof HTMLElement &&
      preferred.isConnected &&
      !preferred.matches(":disabled")
        ? preferred
        : document.querySelector<HTMLElement>('[data-focus-owner="canvas"]');
    target?.focus({ preventScroll: true });
  });
}
