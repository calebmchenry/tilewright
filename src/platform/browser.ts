import type { PlatformServices } from "./services.ts";
import { createBrowserProjectFiles } from "./browser-project-files.ts";

const unavailable = async (): Promise<never> => {
  throw new Error("This file operation is not available in the browser yet.");
};

/** TW-058/059 will supply export/recovery. No native adapters or recovery jobs. */
export const browserServices: PlatformServices = {
  kind: "browser",
  projectFiles: createBrowserProjectFiles(),
  agentExport: {
    available: false,
    choose: unavailable,
    prepare: unavailable,
    commit: unavailable,
    cancel: unavailable,
  },
};
