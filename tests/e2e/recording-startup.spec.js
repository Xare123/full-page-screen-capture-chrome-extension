import { test, expect } from "./fixtures.js";
test.use({
  extensionArgs: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
async function setup(page, suppressAck = true) {
  await page.locator("#nav-recordings").click();
  await page.locator("#record-source").selectOption("camera");
  await page.getByLabel("Microphone", { exact: true }).check();
  await page.evaluate((suppressAck) => {
    window.originalTestWorker = window.Worker;
    if (suppressAck)
      window.Worker = class extends window.originalTestWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener("message", (e) => {
            if (e.data.type === "frame") e.stopImmediatePropagation();
          });
        }
      };
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    window.testOwnedTracks = [];
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await acquire(options);
      window.testOwnedTracks.push(...stream.getTracks());
      return stream;
    };
  }, suppressAck);
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
}
async function records(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open("capture-studio-suite");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            q = db.transaction("recordings").objectStore("recordings").getAll();
          q.onsuccess = () => {
            resolve(q.result);
            db.close();
          };
          q.onerror = () => reject(q.error);
        };
      }),
  );
}
async function released(page) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.testOwnedTracks.every((t) => t.readyState === "ended"),
      ),
    )
    .toBeTruthy();
}
test("cancelling first-frame startup releases audio and video and allows immediate retry", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await setup(page);
  await expect(page.locator("#record-state")).toContainText("Starting");
  await page
    .getByRole("button", { name: "Cancel source", exact: true })
    .click();
  await released(page);
  await expect
    .poll(async () =>
      (await records(page)).every((r) => r.status === "interrupted"),
    )
    .toBeTruthy();
  await page.evaluate(() => {
    window.Worker = window.originalTestWorker;
  });
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("Recording");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#video-player")).toBeVisible();
  await released(page);
  expect(errors).toEqual([]);
});
test("missing first-frame acknowledgement times out and never completes an audio-bearing startup", async ({
  studio,
}) => {
  const { page } = studio;
  await setup(page);
  await expect(page.locator("#record-state")).toContainText("Starting");
  await expect(
    page.getByRole("button", { name: "Choose source", exact: true }),
  ).toBeEnabled({ timeout: 20000 });
  await released(page);
  const items = await records(page);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    status: "interrupted",
    error: expect.stringContaining("video frame"),
  });
  expect(items[0].bytes).toBeGreaterThan(0);
});
test("an encoder emitting no payload becomes interrupted rather than a complete empty recording", async ({
  studio,
}) => {
  const { page } = studio;
  await page.evaluate(() => {
    const Native = window.MediaRecorder;
    window.MediaRecorder = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener("dataavailable", (e) =>
          e.stopImmediatePropagation(),
        );
      }
    };
  });
  await setup(page, false);
  await expect(page.locator("#record-state")).toContainText("Recording");
  await page.waitForTimeout(350);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await released(page);
  await expect
    .poll(async () => (await records(page))[0]?.status)
    .toBe("interrupted");
  expect((await records(page))[0]).toMatchObject({
    bytes: 0,
    nextChunk: 0,
    error: expect.stringContaining("No video frames"),
  });
  await expect(page.locator("#video-player")).toBeHidden();
});
