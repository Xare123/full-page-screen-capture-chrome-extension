import { chromium, expect } from "@playwright/test";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

await mkdir("artifacts", { recursive: true });
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const archive = await readFile(`release/capture-studio-${version}.zip`);
const entries = unzipSync(archive);
const manifestBytes = entries["manifest.json"];
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
assert.equal(manifest.version, version);
assert.equal(manifest.host_permissions, undefined);
const dir = await mkdtemp(join(tmpdir(), "capture-studio-release-"));
let context;
try {
  const extension = join(dir, "extension");
  for (const [name, bytes] of Object.entries(entries)) {
    assert.ok(!name.startsWith("/") && !name.split("/").includes(".."));
    const target = join(extension, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  assert.deepEqual(
    await readFile(join(extension, "manifest.json")),
    Buffer.from(manifestBytes),
  );
  context = await chromium.launchPersistentContext(join(dir, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 960 },
    acceptDownloads: true,
    args: [
      "--no-sandbox",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.route(/^https?:\/\//, (route) => route.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(worker.url().replace("/background.js", "/app.html"));
  await expect(page.locator("#home-view")).toBeVisible();
  const image = new PNG({ width: 800, height: 600 });
  image.data.fill(255);
  const input = PNG.sync.write(image);
  await page.locator("#image-input").setInputFiles({
    name: "Release check.png",
    mimeType: "image/png",
    buffer: input,
  });
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  const storedHash = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("capture-studio");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const projects = await new Promise((resolve, reject) => {
        const request = db
          .transaction("projects")
          .objectStore("projects")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await projects[0].images[0].blob.arrayBuffer(),
      );
      return [...new Uint8Array(digest)]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    } finally {
      db.close();
    }
  });
  const downloading = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const downloaded = await downloading;
  const output = await readFile(await downloaded.path());
  const decoded = PNG.sync.read(output);
  assert.equal(decoded.width, 800);
  assert.equal(decoded.height, 600);
  assert.ok(
    decoded.data.equals(image.data),
    "Import/export must preserve every pixel",
  );
  assert.equal(createHash("sha256").update(output).digest("hex"), storedHash);
  assert.deepEqual(errors, []);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const box = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.click(box.x + 60, box.y + 70);
  await expect(page.locator("#annotation-text")).toBeFocused();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator("#text-transparent")).toBeChecked();
  await expect(page.locator("#text-font")).toHaveValue("inter");
  await page.locator("#annotation-text").fill("Editable release text");
  await page.locator("#text-done").click();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  await page.locator("#text-background").evaluate((el) => {
    el.value = "#ffe000";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  for (const [id, value] of [
    ["crop-x", 20],
    ["crop-y", 30],
    ["crop-width", 400],
    ["crop-height", 250],
  ]) {
    await page.locator("#" + id).fill(String(value));
    await page.locator("#" + id).press("Tab");
  }
  await page.locator("#crop-apply").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#canvas-dimensions")).toHaveText("400 × 250 px");
  await page.getByRole("button", { name: "Select text", exact: true }).click();
  await page.locator("#text-object-select").selectOption("0");
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Still editable after cropping");
  await page.locator("#text-done").click();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  await page.reload();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Select text", exact: true }).click();
  await page.locator("#text-object-select").selectOption("0");
  await page.locator("#text-edit").click();
  await expect(page.locator("#annotation-text")).toHaveValue(
    "Still editable after cropping",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const styledDownload = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const styled = PNG.sync.read(
    await readFile(await (await styledDownload).path()),
  );
  assert.deepEqual([styled.width, styled.height], [400, 250]);
  const offset = (41 * 400 + 41) * 4;
  assert.deepEqual(
    [...styled.data.subarray(offset, offset + 4)],
    [255, 224, 0, 255],
  );
  assert.deepEqual(errors, []);
  const result = {
    version,
    releaseManifestUnmodified: true,
    hostPermissions: false,
    importAndPNGExport: true,
    exactImportExportPixels: true,
    unchangedStoredPNGBytes: true,
    browser: context.browser().version(),
    pageErrors: errors,
    inlineTextWithoutDialog: true,
    localInterFont: true,
    transparentTextDefault: true,
    postCaptureCrop: true,
    editableTextAfterCropAndReload: true,
    styledTextExportPixels: true,
  };
  await writeFile(
    `artifacts/release-smoke-${version}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await context?.close();
  await rm(dir, { recursive: true, force: true });
}
