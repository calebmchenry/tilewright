import { defineConfig } from "@playwright/test";
import production from "./playwright.web.config";
import { webBase } from "./scripts/web-base";

const target = process.env.TILEWRIGHT_LIVE_URL;
if (!target)
  throw new Error("TILEWRIGHT_LIVE_URL must name the deployed HTTPS site.");
const url = new URL(target);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== webBase()
)
  throw new Error("The live HTTPS URL must match TILEWRIGHT_WEB_BASE exactly.");

// Reuse the complete production qualification in fresh browser contexts, with
// no local preview or dev server. Build from the deployed revision first: the
// asset test compares the live response bytes with that local artifact.
export default defineConfig({
  ...production,
  webServer: undefined,
  outputDir: "test-results-live",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results-live/results.json" }],
    ["html", { open: "never", outputFolder: "playwright-report-live" }],
  ],
  use: { ...production.use, baseURL: url.href },
});
