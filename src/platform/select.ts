import { isTauri } from "@tauri-apps/api/core";
import { createBrowserServices } from "./browser";
import type { PlatformServices } from "./services";

/** The only platform selection boundary; browser startup never loads native I/O. */
export async function selectPlatformServices(): Promise<PlatformServices> {
  return isTauri()
    ? (await import("./tauri")).tauriServices
    : createBrowserServices();
}
