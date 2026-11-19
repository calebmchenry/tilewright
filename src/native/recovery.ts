import { invoke, isTauri } from "@tauri-apps/api/core";
import type { RecoveryBridge } from "../editor/recovery";

export const nativeRecovery: RecoveryBridge = {
  get available() {
    return isTauri();
  },
  initialize: () => invoke("initialize_recovery"),
  control: (control) => invoke("control_recovery", { control }),
  prepare: (capture, bytes) =>
    invoke("prepare_recovery", bytes, {
      // HTTP header values are ASCII; JSON escapes preserve Unicode display paths.
      headers: {
        "x-recovery-capture": JSON.stringify(capture).replace(
          /[^\x20-\x7e]/g,
          (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
        ),
      },
    }),
  commit: (ticket) => invoke("commit_recovery", { ticket }),
  cancel: (ticket) => invoke("cancel_recovery", { ticket }),
};

export const nativeRecoveryReview: import("../editor/recovery-discovery").RecoveryReviewBridge =
  {
    get available() {
      return isTauri();
    },
    discover: () => invoke("discover_recovery"),
    async read(selection, source = false) {
      return new Uint8Array(
        await invoke<ArrayBuffer | number[]>("read_recovery", {
          selection,
          source,
        }),
      );
    },
    claim: (selection, writer) =>
      invoke("claim_recovery", { selection, writer }),
    release: (documentId, writer) =>
      invoke("release_recovery", { documentId, writer }),
    discard: (documentId) => invoke("discard_recovery", { documentId }),
  };
