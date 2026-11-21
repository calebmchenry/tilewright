import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./App";
import "./styles.css";
import { bindApplicationInput } from "./editor/application-bindings";
import { createEditorApplication } from "./platform/application";
import { selectPlatformServices } from "./platform/select";

let disposed = false;
let teardown: (() => void) | undefined;
void selectPlatformServices().then((platform) => {
  if (disposed) return;
  const app = createEditorApplication(platform);
  const input = bindApplicationInput(app.actions);
  const unbindNative = platform.bindNative?.(app.actions, input.context);
  const root = createRoot(document.getElementById("root")!);
  teardown = () => {
    root.unmount();
    input.dispose();
    unbindNative?.();
    app.dispose();
  };
  root.render(
    <StrictMode>
      <Workspace {...app} />
    </StrictMode>,
  );
});

// Window navigation/closure and Vite replacement own the same teardown path.
function dispose() {
  if (disposed) return;
  disposed = true;
  window.removeEventListener("pagehide", dispose);
  teardown?.();
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
