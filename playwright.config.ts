import "./scripts/build.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: ".test-profile/playwright-results",
  testMatch: "**/*.spec.ts",
  // The local macOS guest permits one Chromium rendezvous registration at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
  },
});
