/** Native v3 workspace screenshots. All example content and media devices are synthetic.
 * Run from the repository root after npm run build. No release permissions are changed.
 */
import { chromium, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = "store-assets/suite-screenshots";
await mkdir(target, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), "capture-suite-media-"));
const context = await chromium.launchPersistentContext(temporary, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    `--disable-extensions-except=${process.cwd()}/dist`,
    `--load-extension=${process.cwd()}/dist`,
  ],
});
try {
  await context.route(/^https?:/, (r) => r.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(() =>
    chrome.storage.local.set({ tipWhiteboard: true }),
  );
  const origin = worker.url().replace("/background.js", "");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/app.html`);
  async function shot(name) {
    await page.locator("#toast").evaluate((e) => e.classList.remove("visible"));
    await page.screenshot({
      path: `${target}/${name}.jpg`,
      type: "jpeg",
      quality: 95,
      animations: "disabled",
    });
    console.log(`Saved native ${name} screenshot`);
  }
  async function ready() {
    await expect(page.locator("#editor-view")).toBeVisible();
    await expect(page.locator("#save-state")).toHaveText("Saved locally");
    await expect(page.locator("#canvas-viewport")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  async function text(value, x, y) {
    await page.getByRole("button", { name: "Text", exact: true }).click();
    const box = await page.locator("#overlay-canvas").boundingBox();
    const width = await page
      .locator("#overlay-canvas")
      .evaluate((c) => c.width);
    await page.mouse.click(
      box.x + (x * box.width) / width,
      box.y + (y * box.width) / width,
    );
    await page.locator("#annotation-text").fill(value);
    await page.locator("#text-done").click();
    await ready();
  }
  await page.locator("#nav-notes").click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.locator("#note-title").fill("An idea worth keeping");
  await page
    .locator("#note-body")
    .fill(
      "A calmer way to share an idea.\n\n1. Capture the whole story.\n2. Mark the part that matters.\n3. Turn it into a simple explanation.\n\nEverything stays in this browser, ready for next time.",
    );
  await page.locator("#note-body").press("Tab");
  await shot("notes");
  await page.locator("#nav-whiteboards").click();
  await page.getByLabel("First page", { exact: true }).selectOption("plan");
  await page
    .getByRole("button", { name: "Create whiteboard", exact: true })
    .click();
  await ready();
  await page.locator("#project-title").fill("Small ideas, next steps");
  await page.locator("#project-title").press("Tab");
  await expect(page.locator("#project-title")).toHaveValue(
    "Small ideas, next steps",
  );
  await ready();
  await text(
    "A clearer explanation\nA useful screenshot\nA little room to think",
    90,
    240,
  );
  await text("Capture the page\nMark what matters\nShare when ready", 585, 240);
  await text("No account\nNo paid tier\nAll on this device", 1080, 240);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await shot("whiteboard");
  await page.getByRole("button", { name: "Extract text", exact: true }).click();
  await page
    .locator("#ocr-dialog")
    .getByRole("button", { name: "Extract text", exact: true })
    .click();
  await expect(page.locator("#ocr-result")).not.toHaveValue("", {
    timeout: 45000,
  });
  await shot("offline-ocr");
  await page
    .locator("#ocr-dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.locator("#nav-recordings").click();
  await page.locator("#record-source").selectOption("camera");
  await page
    .getByRole("button", { name: "Choose source", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .click();
  await expect(page.locator("#record-state")).toContainText("Recording");
  await page.waitForTimeout(1200);
  await shot("recording");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#video-player")).toBeVisible();
  await page.locator("#record-title").fill("A smaller explanation");
  await page.locator("#video-preset").selectOption("small");
  await page
    .getByRole("button", { name: "Compress video", exact: true })
    .click();
  await expect(page.locator("#compression-result")).toBeVisible({
    timeout: 20000,
  });
  await page.locator(".video-compression").scrollIntoViewIfNeeded();
  await shot("video-compression");
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await context.close();
  await rm(temporary, { recursive: true, force: true });
}
