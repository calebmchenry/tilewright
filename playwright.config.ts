import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/web/**",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:1420", browserName: "chromium" },
  webServer: {
    command: "npm run dev:frontend",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: false,
  },
});
