import { defineConfig, mergeConfig } from "vite";
import desktop from "./vite.config.ts";
import { webBase } from "./scripts/web-base.ts";

// Keep the Tauri build and its asset paths independent of Pages configuration.
export default defineConfig(() =>
  mergeConfig(desktop, {
    base: webBase(),
    publicDir: false,
    build: {
      outDir: "dist-web",
      emptyOutDir: true,
      rollupOptions: { input: "index.html" },
    },
  }),
);
