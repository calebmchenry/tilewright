import type { ProjectFiles } from "../editor/project-files";

/** Best-effort browser warning only. Never start asynchronous work on unload. */
export function bindBrowserNavigation(files: ProjectFiles) {
  let registered = false;
  let disposed = false;
  const warn = (event: BeforeUnloadEvent) => {
    if (!files.browserStatus.getSnapshot().workAtRisk) return;
    event.preventDefault();
    // Legacy engines require a truthy value; browsers choose the visible text.
    event.returnValue = " ";
  };
  const refresh = () => {
    if (disposed) return;
    const needed = files.browserStatus.getSnapshot().workAtRisk;
    if (needed === registered) return;
    registered = needed;
    if (needed) window.addEventListener("beforeunload", warn);
    else window.removeEventListener("beforeunload", warn);
  };
  const unsubscribe = files.browserStatus.subscribe(refresh);
  refresh();
  return {
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      if (registered) window.removeEventListener("beforeunload", warn);
      registered = false;
    },
  };
}
