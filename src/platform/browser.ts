import { BrowserRecovery } from "./browser-recovery.ts";
import type { PlatformServices } from "./services.ts";
import { createBrowserProjectFiles } from "./browser-project-files.ts";
import { downloadBrowserJson } from "./browser-download.ts";

/** Local file/download and origin-local recovery services. No native adapters. */
export function createBrowserServices(): PlatformServices {
  const recovery = new BrowserRecovery();
  return {
    kind: "browser",
    recovery: { writer: recovery, review: recovery },
    projectFiles: createBrowserProjectFiles(),
    agentExport: {
      kind: "browser",
      available: true,
      download: downloadBrowserJson,
    },
  };
}
