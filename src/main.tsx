import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./App";
import "./styles.css";
import { EditorWorkspace } from "./editor/workspace";

const root = createRoot(document.getElementById("root")!);
const workspace = new EditorWorkspace();
root.render(
  <StrictMode>
    <Workspace workspace={workspace} />
  </StrictMode>,
);

// Window navigation/closure and Vite replacement own the same teardown path.
function dispose() {
  window.removeEventListener("pagehide", dispose);
  root.unmount();
  workspace.dispose();
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
