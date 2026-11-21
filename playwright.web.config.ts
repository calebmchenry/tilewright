import { defineConfig } from "@playwright/test";
import { webBase } from "./scripts/web-base";

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:4173${webBase()}`,
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview:web",
    url: `http://127.0.0.1:4173${webBase()}`,
    reuseExistingServer: false,
  },
});
