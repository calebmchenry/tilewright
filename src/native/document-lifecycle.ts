import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocumentLifecycle } from "../editor/document-lifecycle";

/** Installed once outside React; startup and HMR cannot leave duplicate handlers. */
export function bindNativeDocumentLifecycle(
  lifecycle: DocumentLifecycle,
): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const report = (error: unknown) => {
    if (!disposed)
      lifecycle.files.workspace.state
        .getSnapshot()
        .session.reportError(error, "Window close unavailable");
  };
  const request = async () => {
    if (disposed) return;
    if ((await invoke<boolean>("take_document_close_request")) && !disposed)
      await lifecycle.close(() => invoke<void>("finish_document_close"));
  };
  void listen("document-close-requested", () => {
    void request().catch(report);
  })
    .then(async (stop) => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
      await request(); // Native request may predate listener registration.
    })
    .catch(report);
  return () => {
    disposed = true;
    unlisten?.();
  };
}
