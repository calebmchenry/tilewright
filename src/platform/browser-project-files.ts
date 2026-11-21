import type { BrowserProjectFileBridge } from "../editor/project-files.ts";

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
    download(filename, bytes) {
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      let handedOff = false;
      try {
        document.body.append(link);
        link.click();
        handedOff = true;
      } finally {
        link.remove();
        // Keep the URL alive across the browser's asynchronous handoff. This
        // bounded cleanup also runs if the editor is disposed after the request.
        if (handedOff) setTimeout(() => URL.revokeObjectURL(url), 1_000);
        else URL.revokeObjectURL(url);
      }
    },
  };
}
