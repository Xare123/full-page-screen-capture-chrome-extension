import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const matrix = process.env.CS_BROWSER_MATRIX === "1";
if (matrix)
  for (const name of ["CS_MINIMUM_CHROME_EXECUTABLE", "CS_CHROME_EXECUTABLE"])
    if (!process.env[name] || !existsSync(process.env[name]))
      throw new Error(
        `Set ${name} to an installed Chrome for Testing executable.`,
      );
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: process.env.CS_MATRIX_REPORT
    ? [["line"], ["json", { outputFile: process.env.CS_MATRIX_REPORT }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium" },
    ...(matrix
      ? [
          {
            name: "chrome-minimum",
            use: {
              extensionExecutablePath: process.env.CS_MINIMUM_CHROME_EXECUTABLE,
            },
          },
          ...(process.env.CS_CHROME_EXECUTABLE
            ? [
                {
                  name: "google-chrome",
                  use: {
                    extensionExecutablePath: process.env.CS_CHROME_EXECUTABLE,
                  },
                },
              ]
            : []),
        ]
      : []),
  ],
  webServer: {
    command: "node tests/server.mjs",
    port: 4173,
    reuseExistingServer: process.env.CS_REUSE_TEST_SERVER === "1",
  },
});
