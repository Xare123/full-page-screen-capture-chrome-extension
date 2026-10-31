import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const env = { ...process.env, CS_BROWSER_MATRIX: "1" };
env.CS_MINIMUM_CHROME_EXECUTABLE ||= resolve(
  "artifacts/chrome-minimum/chrome-linux64/chrome",
);
env.CS_CHROME_EXECUTABLE ||= resolve(
  "artifacts/chrome-stable/chrome-linux64/chrome",
);
const browsers = [
  ["chromium", chromium.executablePath()],
  ["chrome-minimum", env.CS_MINIMUM_CHROME_EXECUTABLE],
  ["google-chrome", env.CS_CHROME_EXECUTABLE],
].map(([project, executable]) => {
  if (!existsSync(executable))
    throw new Error(
      `Missing ${project} browser: ${executable}. See docs/TESTING.md.`,
    );
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(`${project} did not start: ${result.stderr}`);
  const version = result.stdout.trim();
  const major = Number(version.match(/\b(\d+)\./)?.[1]);
  if (major < 147 || !Number.isFinite(major))
    throw new Error(`Unsupported browser version: ${version}`);
  if (project === "chrome-minimum" && major !== 147)
    throw new Error(
      "The minimum-version project must actually run Chrome 147.",
    );
  return { project, executable, version };
});
mkdirSync("artifacts", { recursive: true });
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
if (JSON.parse(readFileSync("dist/manifest.json", "utf8")).version !== version)
  throw new Error(
    "Build the current extension with npm run build before testing.",
  );
writeFileSync(
  "artifacts/matrix-browser-inventory.json",
  JSON.stringify({ extensionVersion: version, browsers }, null, 2) + "\n",
);
env.CS_MATRIX_REPORT ||= resolve(`artifacts/matrix-e2e-${version}.json`);
const workers = env.CS_MATRIX_WORKERS || "3";
if (!/^[1-6]$/.test(workers)) throw new Error("CS_MATRIX_WORKERS must be 1–6.");
const result = spawnSync(
  process.execPath,
  [
    "node_modules/playwright/cli.js",
    "test",
    `--workers=${workers}`,
    "--output=artifacts/matrix-e2e-tests",
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
