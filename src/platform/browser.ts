import type { PlatformServices } from "./services.ts";
import { createBrowserProjectFiles } from "./browser-project-files.ts";
import { downloadBrowserJson } from "./browser-download.ts";

/** Local file/download services. TW-059 owns browser recovery. No native adapters. */
export const browserServices: PlatformServices = {
  kind: "browser",
  projectFiles: createBrowserProjectFiles(),
  agentExport: {
    kind: "browser",
    available: true,
    download: downloadBrowserJson,
  },
};
