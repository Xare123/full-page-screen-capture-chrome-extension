import { test, expect } from "./fixtures.js";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
test.use({
  extensionArgs: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--auto-select-tab-capture-source-by-title=Capture Suite Source",
  ],
});
async function watchTracks(page) {
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    window.testTracks = [];
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await acquire(options);
      window.testTracks.push(...stream.getTracks());
      return stream;
    };
  });
}
test("repeated source cancellation and a late permission grant release every device track", async ({
  studio,
}) => {
  const { page } = studio;
  await page.locator("#nav-recordings").click();
  await page.locator("#record-source").selectOption("camera");
  await watchTracks(page);
  for (let i = 0; i < 6; i++) {
    await page
      .getByRole("button", { name: "Choose source", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start recording", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel source", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Choose source", exact: true }),
    ).toBeEnabled();
  }
  expect(
    await page.evaluate(() =>
      window.testTracks.every((t) => t.readyState === "ended"),
    ),
  ).toBeTruthy();
  await page.evaluate(() => {
    const acquire = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await acquire(options);
      await new Promise((resolve) => (window.releaseTestPermission = resolve));
      return stream;
    };
  });
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => typeof window.releaseTestPermission))
    .toBe("function");
  await page
    .getByRole("button", { name: "Cancel source", exact: true })
    .click();
  await page.evaluate(() => window.releaseTestPermission());
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.testTracks.every((t) => t.readyState === "ended"),
      ),
    )
    .toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Choose source", exact: true }),
  ).toBeEnabled();
});
test("a storage failure stops devices, retains committed chunks, and releases recording ownership", async ({
  studio,
}) => {
  const { page, worker } = studio;
  await page.locator("#nav-recordings").click();
  await page.locator("#record-source").selectOption("camera");
  await watchTracks(page);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    let chunks = 0;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === "chunks" && ++chunks === 2)
        throw new DOMException("Test quota exhausted", "QuotaExceededError");
      return add.apply(this, args);
    };
  });
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("stopped", {
    timeout: 15000,
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.testTracks.every((t) => t.readyState === "ended"),
      ),
    )
    .toBeTruthy();
  expect(
    await worker.evaluate(
      async () =>
        (await chrome.storage.session.get("recordingOwner")).recordingOwner,
    ),
  ).toBeUndefined();
  await expect(
    page.getByRole("button", { name: "Save original file", exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save original file", exact: true })
    .click();
  const bytes = await readFile(await (await download).path());
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
});
test("closing a recording studio recovers saved chunks in a new studio", async ({
  studio,
}) => {
  const { page, context, origin } = studio;
  await page.locator("#nav-recordings").click();
  await page.locator("#record-source").selectOption("camera");
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("Recording");
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              const r = indexedDB.open("capture-studio-suite");
              r.onsuccess = () => {
                const db = r.result,
                  q = db
                    .transaction("recordings")
                    .objectStore("recordings")
                    .getAll();
                q.onsuccess = () => {
                  resolve(q.result[0]?.nextChunk || 0);
                  db.close();
                };
              };
            }),
        ),
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  await page.close();
  const recovered = await context.newPage();
  await recovered.goto(`${origin}/app.html#recordings`);
  await expect(recovered.locator(".suite-list")).toContainText("Recording");
  await expect(
    recovered.getByRole("button", { name: "Save original file", exact: true }),
  ).toBeVisible();
});
test("real native camera recording persists chunks, pauses, survives hidden studio and exports playable video", async ({
  studio,
}) => {
  test.setTimeout(90000);
  const { page, context, errors } = studio;
  await page.locator("#nav-recordings").click();
  await page.locator("#record-source").selectOption("camera");
  await page.getByLabel("Microphone", { exact: true }).check();
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start recording", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("Recording");
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator("#record-state")).toContainText("Paused");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:4173");
  await page.waitForTimeout(2200);
  await page.bringToFront();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#video-player")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#record-state")).toContainText("stopped");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  const file = await download,
    dir = await mkdtemp(join(tmpdir(), "capture-media-"));
  try {
    const path = join(dir, "recording.webm");
    await writeFile(path, await readFile(await file.path()));
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
        { encoding: "utf8" },
      ),
    );
    expect(probe.streams[0]).toMatchObject({
      codec_type: "video",
      width: 640,
      height: 480,
    });
    expect(Number(probe.format.duration)).toBeGreaterThan(2);
    expect(probe.streams.some((s) => s.codec_type === "audio")).toBeTruthy();
    execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"]);
    await page.locator("#video-start").fill("0.5");
    await page.locator("#video-end").fill("2");
    await page.locator("#video-mute").check();
    const editedWait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export edited video", exact: true })
      .click();
    await page.locator("#video-player").evaluate((video) => {
      video.currentTime = 3;
      video.pause();
    });
    const edited = await editedWait,
      editedPath = join(dir, "edited.webm");
    await writeFile(editedPath, await readFile(await edited.path()));
    const muted = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          editedPath,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(muted.streams.filter((s) => s.codec_type === "audio")).toHaveLength(
      0,
    );
    expect(Number(muted.format.duration)).toBeGreaterThan(1);
    expect(Number(muted.format.duration)).toBeLessThan(2);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      editedPath,
      "-f",
      "null",
      "-",
    ]);
    await page.locator("#video-start").fill("0");
    await page.locator("#video-end").fill("1");
    const gifWait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export GIF (up to 20 sec)", exact: true })
      .click();
    const gif = await gifWait,
      gifBytes = await readFile(await gif.path());
    expect(gif.suggestedFilename()).toMatch(/\.gif$/);
    expect(gifBytes.toString("ascii", 0, 6)).toMatch(/^GIF8[79]a$/);
    expect([gifBytes.readUInt16LE(6), gifBytes.readUInt16LE(8)]).toEqual([
      640, 480,
    ]);
    const frameWait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Save frame PNG", exact: true })
      .click();
    expect((await frameWait).suggestedFilename()).toMatch(/\.png$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  expect(errors).toEqual([]);
});
test.describe("native tab chooser", () => {
  test.use({
    extensionArgs: [
      "--use-fake-device-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--auto-select-tab-capture-source-by-title=Capture Suite Source",
    ],
  });
  test("native browser-tab region recording keeps crop geometry and includes a positioned camera bubble", async ({
    studio,
  }) => {
    test.setTimeout(45000);
    const { page, context, origin } = studio;
    await context.grantPermissions(["camera", "microphone"]);
    const source = await context.newPage();
    await source.goto("http://127.0.0.1:4173");
    await source.setContent(
      "<title>Capture Suite Source</title><style>html,body{margin:0;width:100%;height:100%;background:linear-gradient(to right,#ef4444 50%,#2563eb 50%)}</style>",
    );
    await page.bringToFront();
    await page.locator("#nav-recordings").click();
    await page.locator("#record-source").selectOption("region");
    await page.getByLabel("Camera bubble", { exact: true }).check();
    await page
      .getByRole("button", { name: "Choose source", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start recording", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    const box = await page.locator("#record-ink").boundingBox();
    await page.mouse.move(box.x + box.width * 0.5 + 1, box.y + 1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height - 1);
    await page.mouse.up();
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await expect(page.locator("#record-state")).toContainText("Recording");
    await source.bringToFront();
    await page.waitForTimeout(1800);
    await page.bringToFront();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    await expect(page.locator("#video-player")).toBeVisible();
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    const file = await wait,
      dir = await mkdtemp(join(tmpdir(), "capture-region-"));
    try {
      const path = join(dir, "region.webm");
      await writeFile(path, await readFile(await file.path()));
      const probe = JSON.parse(
        execFileSync(
          "ffprobe",
          ["-v", "error", "-show_streams", "-of", "json", path],
          { encoding: "utf8" },
        ),
      );
      expect(probe.streams[0].width / probe.streams[0].height).toBeCloseTo(
        0.75,
        1,
      );
      expect(probe.streams[0].height).toBeLessThanOrEqual(1080);
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        path,
        "-frames:v",
        "1",
        "-f",
        "image2",
        join(dir, "frame.png"),
      ]);
      const { PNG } = await import("pngjs"),
        png = PNG.sync.read(await readFile(join(dir, "frame.png"))),
        at = (x, y) => [
          ...png.data.subarray(
            (Math.floor(y) * png.width + Math.floor(x)) * 4,
            (Math.floor(y) * png.width + Math.floor(x)) * 4 + 3,
          ),
        ];
      const pixel = at(png.width * 0.3, png.height * 0.3);
      expect(pixel[2]).toBeGreaterThan(pixel[0] + 80);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
