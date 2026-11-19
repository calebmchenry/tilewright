import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { focusOwner } from "../editor/focus";
import {
  applicationActionIds,
  isEditAction,
  type ApplicationAction,
  type ApplicationActions,
  type MenuActionState,
} from "../editor/application-actions";

/** One lifetime outside React. Always inspect current DOM focus at dispatch. */
export function bindApplicationMenu(actions: ApplicationActions): () => void {
  let disposed = false;
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
  let stop: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  const report = (error: unknown) => {
    if (!disposed)
      actions.lifecycle.files.workspace.state
        .getSnapshot()
        .session.reportError(error, "Application menu unavailable");
  };
  if (isTauri()) {
    // Coalesce transient store notifications and serialize IPC: a slow earlier
    // update must never overwrite newer focus/history/operation enablement.
    let pending: readonly MenuActionState[] | undefined;
    let sending = false;
    const publish = async () => {
      pending = actions.menu.getSnapshot();
      if (sending) return;
      sending = true;
      try {
        while (pending && !disposed) {
          const items = pending;
          pending = undefined;
          await invoke("update_application_menu", { items });
        }
      } catch (error) {
        report(error);
      } finally {
        sending = false;
      }
    };
    void listen<string>("application-action", (event) => {
      if (
        disposed ||
        !applicationActionIds.includes(event.payload as ApplicationAction)
      )
        return;
      const id = event.payload as ApplicationAction;
      const owner = context();
      if (isEditAction(id) && owner === "text") {
        // Ask AppKit's actual first responder to edit text, including the OS
        // pasteboard and native undo stack. Never emulate text via map actions.
        void invoke("edit_focused_text", { action: id }).catch(report);
      } else actions.perform(id);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        stop = unlisten;
        unsubscribe = actions.menu.subscribe(() => {
          void publish();
        });
        void publish(); // Native actions start disabled until their listener exists.
      })
      .catch(report);
  }
  return () => {
    disposed = true;
    stop?.();
    unsubscribe?.();
    observer.disconnect();
    window.removeEventListener("keydown", keydown, true);
    document.removeEventListener("focusin", context);
    document.removeEventListener("focusout", context);
  };
}
