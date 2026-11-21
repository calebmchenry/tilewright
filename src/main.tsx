import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./App";
import "./styles.css";
import { bindApplicationInput } from "./editor/application-bindings";
import { createEditorApplication } from "./platform/application";
import { selectPlatformServices } from "./platform/select";
import { bindBrowserNavigation } from "./platform/browser-navigation";

let disposed = false;
let teardown: (() => void) | undefined;
let resume: (() => void) | undefined;
void selectPlatformServices().then((platform) => {
  if (disposed) return;
  const app = createEditorApplication(platform);
  const input = bindApplicationInput(app.actions);
  const unbindNative = platform.bindNative?.(app.actions, input.context);
  const navigation =
    platform.kind === "browser"
      ? bindBrowserNavigation(app.lifecycle.files)
      : undefined;
  resume = () => {
    input.context();
    navigation?.refresh();
  };
  const root = createRoot(document.getElementById("root")!);
  teardown = () => {
    navigation?.dispose();
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

// A cached page resumes the same live application. Disposing it on persisted
// pagehide would leave a frozen DOM pointing at a closed editor on return.
function pagehide(event: PageTransitionEvent) {
  if (!event.persisted) dispose();
}
function pageshow(event: PageTransitionEvent) {
  if (event.persisted && !disposed) resume?.();
}
function dispose() {
  if (disposed) return;
  disposed = true;
  window.removeEventListener("pagehide", pagehide);
  window.removeEventListener("pageshow", pageshow);
  teardown?.();
  teardown = undefined;
  resume = undefined;
}
window.addEventListener("pagehide", pagehide);
window.addEventListener("pageshow", pageshow);
if (import.meta.hot) import.meta.hot.dispose(dispose);
