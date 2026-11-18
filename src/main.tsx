import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { EditorSession } from "./editor/session";

const root = createRoot(document.getElementById("root")!);
const session = new EditorSession();
root.render(
  <StrictMode>
    <App session={session} />
  </StrictMode>,
);

// Window navigation/closure and Vite replacement own the same teardown path.
function dispose() {
  window.removeEventListener("pagehide", dispose);
  root.unmount();
  session.dispose();
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
