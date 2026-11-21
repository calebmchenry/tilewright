import { defineConfig } from "@playwright/test";
import { webBase } from "./scripts/web-base";

export default defineConfig({
  testDir: "./tests/web",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        // Linux headless Firefox cannot initialize the editor's WebGL canvas.
        // CI supplies an Xvfb display; other engines retain their proven mode.
        headless:
          process.env.CI && process.platform === "linux" ? false : undefined,
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  outputDir: "test-results-web",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results-web/results.json" }],
    ["html", { open: "never", outputFolder: "playwright-report-web" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:4173${webBase()}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview:web",
    url: `http://127.0.0.1:4173${webBase()}`,
    reuseExistingServer: false,
  },
});
