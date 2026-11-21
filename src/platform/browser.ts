import type { PlatformServices } from "./services.ts";

const unavailable = async (): Promise<never> => {
  throw new Error("This file operation is not available in the browser yet.");
};

/** TW-056/058/059 will supply browser I/O. No native adapters or recovery jobs. */
export const browserServices: PlatformServices = {
  kind: "browser",
  projectFiles: {
    available: false,
    choose: unavailable,
    read: unavailable,
    write: unavailable,
  },
  agentExport: {
    available: false,
    choose: unavailable,
    prepare: unavailable,
    commit: unavailable,
    cancel: unavailable,
  },
};
