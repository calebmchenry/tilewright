import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./App";
import "./styles.css";
import { EditorWorkspace } from "./editor/workspace";

import { ProjectFiles } from "./editor/project-files";
import { nativeProjectFiles } from "./native/project-files";
import { DocumentLifecycle } from "./editor/document-lifecycle";
import { bindNativeDocumentLifecycle } from "./native/document-lifecycle";

const root = createRoot(document.getElementById("root")!);
const workspace = new EditorWorkspace();
const files = new ProjectFiles(workspace, nativeProjectFiles);
const lifecycle = new DocumentLifecycle(files);
const unbindNative = bindNativeDocumentLifecycle(lifecycle);
root.render(
  <StrictMode>
    <Workspace workspace={workspace} lifecycle={lifecycle} />
  </StrictMode>,
);

// Window navigation/closure and Vite replacement own the same teardown path.
function dispose() {
  window.removeEventListener("pagehide", dispose);
  root.unmount();
  unbindNative();
  lifecycle.dispose();
  files.dispose();
  workspace.dispose();
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
