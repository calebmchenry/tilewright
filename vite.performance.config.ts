import { defineConfig } from "vite";

// Separate entry/output: deterministic fixtures never enter the shipping app.
export default defineConfig({
  build: {
    target: "safari15",
    outDir: "artifacts/performance/dist",
    rollupOptions: { input: "tests/native-performance.html" },
  },
});
