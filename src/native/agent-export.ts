import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AgentExportBridge } from "../editor/agent-export";
import type { ProjectFileHandle } from "../editor/project-files";

export const nativeAgentExport: AgentExportBridge = {
  get available() {
    return isTauri();
  },
  choose: (protectedPath, suggestedName) =>
    invoke<ProjectFileHandle | null>("choose_agent_export", {
      protectedPath,
      suggestedName,
    }),
  prepare: (token, bytes) =>
    invoke<void>("prepare_agent_export", bytes, {
      headers: { "x-export-token": token },
    }),
  commit: (token) => invoke<string | null>("commit_agent_export", { token }),
  cancel: (token) => invoke<void>("cancel_agent_export", { token }),
};
