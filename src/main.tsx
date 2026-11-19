import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./App";
import "./styles.css";
import { EditorWorkspace } from "./editor/workspace";

import { ProjectFiles } from "./editor/project-files";
import { nativeProjectFiles } from "./native/project-files";

const root = createRoot(document.getElementById("root")!);
const workspace = new EditorWorkspace();
const files = new ProjectFiles(workspace, nativeProjectFiles);
root.render(
  <StrictMode>
    <Workspace workspace={workspace} files={files} />
  </StrictMode>,
);

// Window navigation/closure and Vite replacement own the same teardown path.
function dispose() {
  window.removeEventListener("pagehide", dispose);
  root.unmount();
  files.dispose();
  workspace.dispose();
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
