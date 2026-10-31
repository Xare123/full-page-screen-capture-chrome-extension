/** Optional native long-duration check. Build first; requires Playwright and ffprobe.
 * Run with a display, e.g. xvfb-run -a node scripts/stress-recording.mjs on Linux.
 * CS_STRESS_SECONDS defaults to 360; CS_CHROME_EXECUTABLE selects another Chrome.
 * Uses a fictional static tab, no audio or camera, and a disposable test profile.
 */
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

const seconds = Number(process.env.CS_STRESS_SECONDS || 360);
if (!Number.isFinite(seconds) || seconds < 10 || seconds > 1800)
  throw Error("Choose a stress duration between 10 and 1800 seconds.");
const runId = randomUUID(),
  startedAtUTC = new Date().toISOString();
await mkdir("artifacts", { recursive: true });
await rm("artifacts/long-recording-stress.json", { force: true });
const temporary = await mkdtemp(join(tmpdir(), "capture-long-recording-"));
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(
    "<title>Capture Studio Long Stress Source</title><style>html,body{margin:0;width:100%;height:100%;background:#2563eb;color:white;font:40px system-ui}h1{padding:70px}</style><h1>Fictional static capture source</h1>",
  );
});
let context, heartbeat, browser, browserProcess, downloadWaitTimer;
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sourceURL = `http://127.0.0.1:${server.address().port}/`;
  const extension = join(temporary, "extension");
  await cp("dist", extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  if (manifest.host_permissions)
    throw Error("Use the unmodified release manifest");
  const profile = join(temporary, "profile");
  const downloads = join(temporary, "downloads");
  await mkdir(downloads);
  browserProcess = spawn(
    process.env.CS_CHROME_EXECUTABLE || chromium.executablePath(),
    [
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1",
      "--window-size=1600,1100",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--enable-unsafe-extension-debugging",
      "--no-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--auto-select-tab-capture-source-by-title=Capture Studio Long Stress Source",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
    { stdio: "ignore" },
  );
  const portFile = join(profile, "DevToolsActivePort");
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = Number((await readFile(portFile, "utf8")).split("\n")[0]);
      if (port) break;
    } catch {}
    if (browserProcess.exitCode !== null)
      throw Error("Chrome exited during startup");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!port) throw Error("Chrome did not start its local testing connection");
  // noDefaults prevents Playwright's primary session from installing focus
  // emulation. A second CDP session cannot undo the primary session's override.
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, {
    noDefaults: true,
  });
  context = browser.contexts()[0];
  context.setDefaultTimeout(20000);
  const browserCDP = await browser.newBrowserCDPSession();
  await browserCDP.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloads,
    eventsEnabled: true,
  });
  const { id: extensionId } = await browserCDP.send("Extensions.loadUnpacked", {
    path: extension,
  });
  if (!extensionId) throw Error("Chrome did not return the test extension ID");
  await context.route(/^https?:/, (r) =>
    r.request().url().startsWith(sourceURL) ? r.continue() : r.abort(),
  );
  const origin = `chrome-extension://${extensionId}`;
  const page = await context.newPage();
  const studioCDP = await context.newCDPSession(page);
  // Only chooser setup gets emulated focus (Xvfb has no window manager).
  // This same session disables it before the measured quiet interval.
  await studioCDP.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${origin}/app.html#recordings`);
  const opened = context.waitForEvent("page");
  opened.catch(() => {}); // Preserve a source-creation error if cleanup closes the context.
  const sourceId = await page.evaluate(
    async ({ origin, sourceURL }) => {
      const studio = await chrome.tabs.getCurrent();
      return (
        await chrome.tabs.create({
          windowId: studio.windowId,
          url: sourceURL,
          active: false,
        })
      ).id;
    },
    { origin, sourceURL },
  );
  const source = await opened;
  await source.setViewportSize({ width: 1440, height: 960 });
  await source.waitForLoadState();
  await page.locator("#record-source").selectOption("tab");
  await page.getByLabel("Quality", { exact: true }).selectOption("720");
  await page.bringToFront();
  await page.evaluate(async () =>
    chrome.tabs.update((await chrome.tabs.getCurrent()).id, { active: true }),
  );
  console.log("Acquiring the static browser-tab source.");
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("Recording");
  // Playwright independently forces every page to appear focused/visible,
  // even in headed mode. Disable that emulation before the real tab switch.
  await studioCDP.send("Emulation.setFocusEmulationEnabled", {
    enabled: false,
  });
  await page.evaluate(() => {
    window.captureStressVisibility = [];
    document.addEventListener("visibilitychange", () =>
      window.captureStressVisibility.push({
        state: document.visibilityState,
        at: performance.now(),
      }),
    );
  });
  await source.bringToFront();
  await page.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    sourceId,
  );
  expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");
  console.log("Studio genuinely hidden; beginning the quiet interval.");
  const started = Date.now();
  heartbeat = setInterval(
    () =>
      console.log(
        `Hidden recording: ${Math.round((Date.now() - started) / 1000)} seconds`,
      ),
    30000,
  );
  // No page evaluation, locator or focus calls during this interval: CDP must
  // not wake the hidden studio and hide background timer throttling defects.
  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  clearInterval(heartbeat);
  const quietElapsedSeconds = (Date.now() - started) / 1000;
  expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");
  const visibilityEvents = await page.evaluate(
    () => window.captureStressVisibility,
  );
  expect(
    visibilityEvents.every((event) => event.state === "hidden"),
  ).toBeTruthy();
  await page.bringToFront();
  await studioCDP.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#video-player")).toBeVisible({ timeout: 30000 });
  const pending = new Promise((resolve, reject) => {
    const begin = (event) => {
      clearTimeout(downloadWaitTimer);
      resolve(event);
    };
    browserCDP.once("Browser.downloadWillBegin", begin);
    downloadWaitTimer = setTimeout(() => {
      browserCDP.off("Browser.downloadWillBegin", begin);
      reject(Error("The native browser download did not begin"));
    }, 20000);
  });
  pending.catch(() => {});
  await page
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  const file = await pending;
  const downloaded = join(downloads, file.suggestedFilename);
  await expect
    .poll(
      async () => {
        try {
          return (await readFile(downloaded)).length > 0;
        } catch {
          return false;
        }
      },
      { timeout: 30000 },
    )
    .toBeTruthy();
  const bytes = await readFile(downloaded),
    path = join(temporary, "long.webm");
  await writeFile(path, bytes);
  const info = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_streams",
        "-count_frames",
        "-show_packets",
        "-show_entries",
        "packet=pts_time:stream=width,height,codec_name,nb_read_frames",
        "-of",
        "json",
        path,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  const times = info.packets
      .map((p) => Number(p.pts_time))
      .filter(Number.isFinite),
    gaps = times.slice(1).map((t, i) => t - times[i]),
    span = times.at(-1) - times[0],
    maxGap = Math.max(...gaps);
  expect(span).toBeGreaterThan(seconds - 3);
  const averageFramesPerSecond = (times.length - 1) / span;
  await writeFile(
    "artifacts/long-recording-stress-observations.json",
    JSON.stringify(
      {
        status: "observed",
        runId,
        startedAtUTC,
        quietElapsedSeconds,
        packetCount: times.length,
        decodedFrames: Number(info.streams[0].nb_read_frames),
        videoSpanSeconds: span,
        averageFramesPerSecond,
        maximumPacketGapSeconds: maxGap,
        visibilityEvents,
      },
      null,
      2,
    ) + "\n",
  );
  expect(averageFramesPerSecond).toBeGreaterThan(20);
  expect(Number(info.streams[0].nb_read_frames)).toBe(times.length);
  expect(gaps.every((g) => g > 0)).toBeTruthy();
  expect(maxGap).toBeLessThan(0.5);
  const records = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const r = indexedDB.open("capture-studio-suite");
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("recordings").objectStore("recordings").getAll();
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
        };
      }),
  );
  expect(records[0].status).toBe("complete");
  // timeslice is a delivery target, not an exact clock. Continuity is verified
  // from decoded packets above; this confirms storage used multiple chunks.
  expect(records[0].nextChunk).toBeGreaterThan(1);
  const report = {
    runId,
    startedAtUTC,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    bundleSHA256: Object.fromEntries(
      await Promise.all(
        ["app.js", "recording-worker.js", "manifest.json"].map(async (name) => [
          name,
          createHash("sha256")
            .update(await readFile(join(extension, name)))
            .digest("hex"),
        ]),
      ),
    ),
    scriptSHA256: createHash("sha256")
      .update(await readFile(new URL(import.meta.url)))
      .digest("hex"),
    version: manifest.version,
    releaseManifestUnmodified: true,
    status: "passed",
    browser: browser.version(),
    hiddenSeconds: seconds,
    quietElapsedSeconds,
    visibilityEvents,
    averageFramesPerSecond,
    quietStaticBrowserTab: true,
    headedChrome: true,
    backgroundThrottlingBypassesRemoved: true,
    focusEmulationDisabled: true,
    setupOnlyFocusEmulation: true,
    playwrightNoDefaults: true,
    camera: false,
    audio: false,
    noExplicitStudioCallsDuringInterval: true,
    everyEncodedPacketDecoded: true,
    packetCount: times.length,
    videoSpanSeconds: span,
    maximumPacketGapSeconds: maxGap,
    dimensions: info.streams[0],
    committedChunksAtCompletion: records[0].nextChunk,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/long-recording-stress.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  clearInterval(heartbeat);
  clearTimeout(downloadWaitTimer);
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (browserProcess.exitCode === null) browserProcess.kill("SIGKILL");
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
