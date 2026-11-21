import type { BrowserProjectFileBridge } from "../editor/project-files.ts";
import { downloadBrowserJson } from "./browser-download.ts";

/** Local File reads and Blob downloads. No filesystem handle or network I/O. */
export function createBrowserProjectFiles(): BrowserProjectFileBridge {
  let cancelPick: (() => void) | undefined;
  return {
    kind: "browser",
    available: true,
    cancelPick() {
      cancelPick?.();
    },
    choose() {
      cancelPick?.();
      return new Promise((resolve, reject) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".tilewright,.json,application/json";
        input.setAttribute("aria-label", "Choose project file");
        input.hidden = true;
        const cleanup = () => {
          input.remove();
          input.removeEventListener("change", change);
          input.removeEventListener("cancel", cancel);
          cancelPick = undefined;
        };
        const cancel = () => {
          cleanup();
          resolve(null);
        };
        const change = () => {
          const files = Array.from(input.files ?? []);
          cleanup();
          resolve(files.length ? files : null);
        };
        cancelPick = cancel;
        input.addEventListener("change", change, { once: true });
        input.addEventListener("cancel", cancel, { once: true });
        document.body.append(input);
        // No async boundary: the Open button/shortcut owns user activation.
        try {
          input.click();
        } catch (error) {
          cleanup();
          reject(error);
        }
      });
    },
    download: downloadBrowserJson,
  };
}
