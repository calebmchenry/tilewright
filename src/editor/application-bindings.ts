import { focusOwner } from "./focus";
import type { ApplicationActions } from "./application-actions";

/** Shared DOM shortcuts/focus; no native menu or IPC dependency. */
export function bindApplicationInput(actions: ApplicationActions) {
  const context = () => {
    const owner = focusOwner(document.activeElement);
    actions.setContext({
      owner,
      modal: !!document.querySelector("dialog[open]"),
    });
    return owner;
  };
  const keydown = (event: KeyboardEvent) => {
    context();
    if (actions.routeKey(event)) event.preventDefault();
  };
  window.addEventListener("keydown", keydown, true);
  document.addEventListener("focusin", context);
  document.addEventListener("focusout", context);
  const observer = new MutationObserver(context);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  context();
  return {
    context,
    dispose() {
      observer.disconnect();
      window.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", context);
      document.removeEventListener("focusout", context);
    },
  };
}
