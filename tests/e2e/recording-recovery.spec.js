import { test, expect } from "./fixtures.js";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
test.use({
  extensionArgs: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
async function camera(page) {
  await page.locator("#record-source").selectOption("camera");
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("Recording");
  await expect
    .poll(() =>
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
                resolve(
                  q.result.some(
                    (x) => x.status === "recording" && x.nextChunk > 0,
                  ),
                );
                db.close();
              };
            };
          }),
      ),
    )
    .toBeTruthy();
}
test("opening saved playback while recording keeps pause/stop callbacks and controls working", async ({
  studio,
}) => {
  const { page } = studio;
  await page.locator("#nav-recordings").click();
  await camera(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#video-player")).toBeVisible();
  await camera(page);
  await page
    .locator(".suite-list button")
    .filter({ hasText: /^Recording / })
    .first()
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator("#record-state")).toContainText("Paused");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Choose source", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("#record-state")).toContainText("stopped");
});
test("native MP4 recording and trim use real MP4 files when the browser encoder supports them", async ({
  studio,
}) => {
  const { page } = studio;
  await page.locator("#nav-recordings").click();
  const format = page.getByLabel("Format", { exact: true });
  test.skip(
    await format.locator("option[value=mp4]").isDisabled(),
    "The native MP4 encoder is unavailable in this browser/platform.",
  );
  await format.selectOption("mp4");
  await page.getByLabel("Microphone", { exact: true }).check();
  await camera(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#video-player")).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download original", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.mp4$/);
  const bytes = await readFile(await file.path());
  expect(bytes.toString("ascii", 4, 8)).toBe("ftyp");
  const dir = await mkdtemp(join(tmpdir(), "capture-mp4-"));
  try {
    const path = join(dir, "native.mp4");
    await writeFile(path, bytes);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", path],
        { encoding: "utf8" },
      ),
    );
    expect(probe.streams.some((s) => s.codec_type === "video")).toBeTruthy();
    expect(probe.streams.some((s) => s.codec_type === "audio")).toBeTruthy();
    await page.getByLabel("Video format", { exact: true }).selectOption("mp4");
    await page.locator("#video-start").fill("0");
    await page.locator("#video-end").fill(".5");
    const trim = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export edited video", exact: true })
      .click();
    const result = await trim;
    expect(result.suggestedFilename()).toMatch(/\.mp4$/);
    expect((await readFile(await result.path())).toString("ascii", 4, 8)).toBe(
      "ftyp",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
