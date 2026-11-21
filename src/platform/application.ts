import { EditorWorkspace } from "../editor/workspace.ts";
import { ProjectFiles } from "../editor/project-files.ts";
import { AgentExports } from "../editor/agent-export.ts";
import { DocumentLifecycle } from "../editor/document-lifecycle.ts";
import { ApplicationActions } from "../editor/application-actions.ts";
import { RecoveryCoordinator } from "../editor/recovery.ts";
import { RecoveryBrowser } from "../editor/recovery-discovery.ts";
import type { PlatformServices } from "./services.ts";

/** Both targets use exactly the same editor/controllers/codec and teardown. */
export function createEditorApplication(platform: PlatformServices) {
  const workspace = new EditorWorkspace();
  const recovery = platform.recovery
    ? new RecoveryCoordinator(workspace, platform.recovery.writer)
    : undefined;
  const files = new ProjectFiles(workspace, platform.projectFiles, recovery);
  const agentExport = new AgentExports(workspace, platform.agentExport);
  const lifecycle = new DocumentLifecycle(files, agentExport);
  const actions = new ApplicationActions(lifecycle);
  const recoveryBrowser = platform.recovery
    ? new RecoveryBrowser(lifecycle, platform.recovery.review)
    : undefined;
  if (recoveryBrowser) void recoveryBrowser.refresh(true);
  return {
    platform,
    workspace,
    lifecycle,
    actions,
    recoveryBrowser,
    dispose() {
      actions.dispose();
      recoveryBrowser?.dispose();
      lifecycle.dispose();
      agentExport.dispose();
      files.dispose();
      recovery?.dispose();
      workspace.dispose();
    },
  };
}
