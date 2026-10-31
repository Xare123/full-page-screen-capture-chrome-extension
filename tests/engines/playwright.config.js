import { defineConfig } from "@playwright/test";

// Browser engines exercise content-script DOM/layout behavior only. They do not
// represent Firefox or Safari MV3 extension support.
export default defineConfig({
  testDir: ".",
  testMatch: "layout.spec.js",
  fullyParallel: true,
  workers: 3,
  timeout: 30000,
  expect: { timeout: 5000 },
  outputDir: "../../artifacts/engine-tests",
  reporter: [
    ["list"],
    ...(process.env.CS_ENGINE_REPORT
      ? [["json", { outputFile: process.env.CS_ENGINE_REPORT }]]
      : []),
    ["html", { outputFolder: "../../artifacts/engine-report", open: "never" }],
  ],
  use: {
    viewport: { width: 1000, height: 800 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-layout",
      use: {
        browserName: "chromium",
        channel: "chromium",
        launchOptions: { args: ["--no-sandbox"] },
      },
    },
    { name: "firefox-layout", use: { browserName: "firefox" } },
    {
      name: "webkit-layout",
      use: {
        browserName: "webkit",
        launchOptions: process.env.CS_WEBKIT_EXECUTABLE
          ? { executablePath: process.env.CS_WEBKIT_EXECUTABLE }
          : {},
      },
    },
  ],
});
