import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workspace } from "./App";
import "./styles.css";
import { EditorWorkspace } from "./editor/workspace";

import { ProjectFiles } from "./editor/project-files";
import { AgentExports } from "./editor/agent-export";
import { nativeAgentExport } from "./native/agent-export";
import { nativeProjectFiles } from "./native/project-files";
import { DocumentLifecycle } from "./editor/document-lifecycle";
import { bindNativeDocumentLifecycle } from "./native/document-lifecycle";
import { ApplicationActions } from "./editor/application-actions";
import { RecoveryCoordinator } from "./editor/recovery";
import { RecoveryBrowser } from "./editor/recovery-discovery";
import { nativeRecovery, nativeRecoveryReview } from "./native/recovery";
import { bindApplicationMenu } from "./native/application-menu";

const root = createRoot(document.getElementById("root")!);
const workspace = new EditorWorkspace();
const recovery = new RecoveryCoordinator(workspace, nativeRecovery);
const files = new ProjectFiles(workspace, nativeProjectFiles, recovery);
const agentExport = new AgentExports(workspace, nativeAgentExport);
const lifecycle = new DocumentLifecycle(files, agentExport);
const actions = new ApplicationActions(lifecycle);
const recoveryBrowser = new RecoveryBrowser(lifecycle, nativeRecoveryReview);
void recoveryBrowser.refresh(true);
const unbindMenu = bindApplicationMenu(actions);
const unbindNative = bindNativeDocumentLifecycle(lifecycle);
root.render(
  <StrictMode>
    <Workspace
      workspace={workspace}
      lifecycle={lifecycle}
      actions={actions}
      recoveryBrowser={recoveryBrowser}
    />
  </StrictMode>,
);

// Window navigation/closure and Vite replacement own the same teardown path.
function dispose() {
  window.removeEventListener("pagehide", dispose);
  root.unmount();
  unbindMenu();
  actions.dispose();
  unbindNative();
  recoveryBrowser.dispose();
  lifecycle.dispose();
  agentExport.dispose();
  files.dispose();
  recovery.dispose();
  workspace.dispose();
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
