import { test, expect } from "./fixtures.js";
test.use({
  extensionArgs: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
for (const encoderFailure of [false, true])
  test(`recording stop ${encoderFailure ? "retains a real encoder flush failure" : "ignores an owned compositor shutdown error"}`, async ({
    studio,
  }) => {
    const { page } = studio;
    await page.evaluate(() => {
      const NativeWorker = Worker,
        NativeRecorder = MediaRecorder;
      window.ownedWorkers = [];
      window.ownedRecorders = [];
      window.Worker = class extends NativeWorker {
        constructor(...args) {
          super(...args);
          window.ownedWorkers.push(this);
        }
      };
      window.MediaRecorder = class extends NativeRecorder {
        constructor(...args) {
          super(...args);
          window.ownedRecorders.push(this);
        }
      };
    });
    await page.locator("#nav-recordings").click();
    await page.locator("#record-source").selectOption("camera");
    await page
      .getByRole("button", { name: "Choose source", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    const read = () =>
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
                resolve(q.result[0]);
                db.close();
              };
            };
          }),
      );
    await expect
      .poll(async () => (await read())?.nextChunk || 0)
      .toBeGreaterThan(0);
    await page.evaluate((failed) => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent === "Stop")
        .click();
      if (failed) window.ownedRecorders[0].dispatchEvent(new Event("error"));
      else
        window.ownedWorkers[0].dispatchEvent(
          new MessageEvent("message", {
            data: { type: "error", error: "The writable stream is closed." },
          }),
        );
    }, encoderFailure);
    await expect(page.locator("#video-player")).toBeVisible();
    await expect
      .poll(async () => (await read()).status)
      .toBe(encoderFailure ? "interrupted" : "complete");
    const item = await read();
    expect(item.bytes).toBeGreaterThan(0);
    if (encoderFailure) expect(item.error).toContain("encoder");
    else expect(item.error).toBe("");
  });
