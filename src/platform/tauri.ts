import { nativeAgentExport } from "../native/agent-export";
import { nativeProjectFiles } from "../native/project-files";
import { nativeRecovery, nativeRecoveryReview } from "../native/recovery";
import { bindNativeApplicationMenu } from "../native/application-menu";
import { bindNativeDocumentLifecycle } from "../native/document-lifecycle";
import type { PlatformServices } from "./services";

export const tauriServices: PlatformServices = {
  kind: "tauri",
  projectFiles: nativeProjectFiles,
  agentExport: nativeAgentExport,
  recovery: { writer: nativeRecovery, review: nativeRecoveryReview },
  bindNative(actions, context) {
    const menu = bindNativeApplicationMenu(actions, context);
    const close = bindNativeDocumentLifecycle(actions.lifecycle);
    return () => {
      menu();
      close();
    };
  },
};
