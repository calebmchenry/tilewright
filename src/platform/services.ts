import type { AgentExportTransport } from "../editor/agent-export.ts";
import type { ApplicationActions } from "../editor/application-actions.ts";
import type { ProjectFileTransport } from "../editor/project-files.ts";
import type { RecoveryBridge } from "../editor/recovery.ts";
import type { RecoveryReviewBridge } from "../editor/recovery-discovery.ts";
import type { FocusOwner } from "../editor/session.ts";

/** Selected once at startup. Missing services are unavailable, never simulated. */
export interface PlatformServices {
  readonly kind: "browser" | "tauri";
  readonly projectFiles: ProjectFileTransport;
  readonly agentExport: AgentExportTransport;
  readonly recovery?: {
    readonly writer: RecoveryBridge;
    readonly review: RecoveryReviewBridge;
  };
  readonly bindNative?: (
    actions: ApplicationActions,
    context: () => FocusOwner,
  ) => () => void;
}
