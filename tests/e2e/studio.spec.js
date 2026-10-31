import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile, mkdir } from "node:fs/promises";

function testImage(width = 1200, height = 1600) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      png.data[i] = 220 + ((x * 17 + y * 7) % 34);
      png.data[i + 1] = 215 + ((x + y * 13) % 40);
      png.data[i + 2] = 224 + ((x * 3 + y) % 30);
      png.data[i + 3] = 255;
    }
  return PNG.sync.write(png);
}
async function importImage(
  page,
  name = "Sunday fieldnotes.png",
  buffer = testImage(),
) {
  await page
    .locator("#image-input")
    .setInputFiles({ name, mimeType: "image/png", buffer });
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}
async function dragTool(page, name, from, to) {
  await page.getByRole("button", { name, exact: true }).click();
  const r = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.move(r.x + from[0], r.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(r.x + to[0], r.y + to[1], { steps: 5 });
  await page.mouse.up();
  if (name === "Crop") await page.locator("#crop-apply").click();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}
async function exported(page) {
  const download = page.waitForEvent("download");
  await page.locator("#export-button").click();
  return {
    data: await readFile(await (await download).path()),
    name: (await download).suggestedFilename(),
  };
}

test("image editing flattens redaction, preserves autosave across navigation, and exports resized formats", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await importImage(page);
  await dragTool(page, "Redact", [100, 100], [240, 175]);
  await dragTool(page, "Pixelate", [110, 110], [230, 165]);
  const output = await exported(page);
  const png = PNG.sync.read(output.data);
  const bounds = await page.locator("#overlay-canvas").boundingBox();
  const scale = bounds.width / 1200;
  const i = (Math.round(140 / scale) * png.width + Math.round(160 / scale)) * 4;
  expect([...png.data.subarray(i, i + 4)]).toEqual([17, 17, 17, 255]);
  await page
    .locator("#project-title")
    .fill("<img src=x onerror=alert(1)> My saved capture");
  await page.locator("#project-title").press("Tab");
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  const r = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.move(r.x + 10, r.y + 10);
  await page.mouse.down();
  await page.mouse.move(r.x + 75, r.y + 60);
  await page.mouse.up();
  // Navigate immediately, before thumbnail generation can finish.
  await page.locator("#home-button").click();
  await expect(page.locator(".card-title")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await page.locator(".card-open").click();
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#project-title")).toHaveValue(
    "<img src=x onerror=alert(1)> My saved capture",
  );
  await page.reload();
  await expect(page.locator("#editor-view")).toBeVisible();
  await page.locator('[data-format="jpeg"]').click();
  await page.locator("#export-scale").fill("50");
  await page.locator("#export-scale").dispatchEvent("input");
  const jpeg = await exported(page);
  expect(jpeg.data[0]).toBe(255);
  expect(jpeg.data[1]).toBe(216);
  expect(jpeg.name).toMatch(/\.jpg$/);
  await page.locator('[data-format="webp"]').click();
  const webp = await exported(page);
  expect(webp.data.toString("ascii", 8, 12)).toBe("WEBP");
  expect(errors).toEqual([]);
  await page.locator("#copy-button").click();
  await expect(page.locator("#toast")).toHaveText("Image copied to clipboard.");
  await page.locator("#fullscreen-button").click();
  expect(await page.evaluate(() => Boolean(document.fullscreenElement))).toBe(
    true,
  );
  await page.locator("#fullscreen-button").click();
});

test("crop, rotate, undo and redo restore dimensions and pixels", async ({
  studio,
}) => {
  const { page } = studio;
  await importImage(page, "transform.png", testImage(800, 600));
  await dragTool(page, "Crop", [50, 50], [350, 250]);
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#canvas-dimensions")).toHaveText("300 × 200 px");
  await page.locator("#rotate-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("200 × 300 px");
  await page.locator("#undo-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("300 × 200 px");
  await page.locator("#undo-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("800 × 600 px");
  await page.locator("#redo-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("300 × 200 px");
  const png = PNG.sync.read((await exported(page)).data);
  expect([png.width, png.height]).toEqual([300, 200]);
});

test("PDF exports paginate and local PDF compression preserves page count and never enlarges originals", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await importImage(page, "long-page.png", testImage(800, 2600));
  await page.locator('[data-format="pdf"]').click();
  const capturePDF = await exported(page);
  const document = await PDFDocument.load(capturePDF.data);
  expect(document.getPageCount()).toBeGreaterThan(1);
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 6; i++)
    source
      .addPage()
      .drawText(`Searchable original page ${i + 1}`, { x: 50, y: 700, font });
  const bytes = Buffer.from(await source.save({ useObjectStreams: false }));
  await page.locator("#editor-pdf-button").click();
  await page.locator("#pdf-input").setInputFiles({
    name: "readable.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page.locator("#pdf-run").click();
  await expect(page.locator("#pdf-download")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.locator("#pdf-download").click();
  const optimizedBytes = await readFile(await (await download).path());
  expect(optimizedBytes.length).toBeLessThanOrEqual(bytes.length);
  expect((await PDFDocument.load(optimizedBytes)).getPageCount()).toBe(6);
  await page.locator("#pdf-compression-mode").selectOption("raster");
  await page.locator("#pdf-run").click();
  await expect(page.locator("#pdf-download")).toBeVisible();
  await expect(page.locator("#pdf-status")).toContainText(
    /smaller|Already compact/,
  );
  await page.locator("#pdf-input").setInputFiles({
    name: "scanned.pdf",
    mimeType: "application/pdf",
    buffer: capturePDF.data,
  });
  await page.locator("#pdf-dpi").selectOption("90");
  await page.locator("#pdf-jpeg-quality").selectOption("0.6");
  await page.locator("#pdf-run").click();
  await expect(page.locator("#pdf-download")).toBeVisible();
  const rasterDownload = page.waitForEvent("download");
  await page.locator("#pdf-download").click();
  const rasterBytes = await readFile(await (await rasterDownload).path());
  expect(rasterBytes.length).toBeLessThan(capturePDF.data.length);
  expect((await PDFDocument.load(rasterBytes)).getPageCount()).toBe(
    document.getPageCount(),
  );
  expect(errors).toEqual([]);
});

test("full-page capture stitches real browser pixels, preserves sticky content and restores scroll/styles", async ({
  studio,
}) => {
  const { page, context, origin } = studio;
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.evaluate(() => scrollTo({ top: 234, behavior: "instant" }));
  const expectedHeight = await source.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const probeY = await source
    .locator("#color-probe")
    .evaluate((node) => node.getBoundingClientRect().top + scrollY);
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const finished = context.waitForEvent("page", {
    predicate: (p) => p !== source && p !== popup && p !== page,
  });
  const response = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "full" }),
  );
  expect(response.ok).toBe(true);
  const editor = await finished;
  await editor.waitForURL(`${origin}/app.html#*`);
  await expect(editor.locator("#editor-view")).toBeVisible();
  await expect(editor.locator("#canvas-dimensions")).toHaveText(
    `1,440 × ${expectedHeight.toLocaleString()} px`,
  );
  await expect.poll(() => source.evaluate(() => scrollY)).toBe(234);
  expect(
    await source
      .locator("#sticky-probe")
      .evaluate((node) => getComputedStyle(node).position),
  ).toBe("sticky");
  const png = PNG.sync.read((await exported(editor)).data);
  const i = (Math.round(probeY + 20) * png.width + 20) * 4;
  expect([...png.data.subarray(i, i + 3)]).toEqual([201, 71, 113]);
  await mkdir("artifacts", { recursive: true });
  await editor.screenshot({ path: "artifacts/editor-desktop.png" });
  await editor.locator("#home-button").click();
  await editor.screenshot({
    path: "artifacts/library-desktop.png",
    fullPage: true,
  });
});

test("capture cancellation, double-start and region selection are controlled", async ({
  studio,
}) => {
  const { page, context, origin } = studio;
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.evaluate(() => scrollTo({ top: 157, behavior: "instant" }));
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const results = await popup.evaluate(() =>
    Promise.all([
      chrome.runtime.sendMessage({ type: "CS_START", mode: "full", delay: 3 }),
      chrome.runtime.sendMessage({ type: "CS_START", mode: "full", delay: 3 }),
    ]),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_CANCEL" }));
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" })),
    )
    .toMatchObject({ phase: "error", message: "Capture cancelled." });
  expect(await source.evaluate(() => scrollY)).toBe(157);
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "region" }),
  );
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" })),
    )
    .toMatchObject({ phase: "selecting" });
  await source.keyboard.press("Escape");
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" })),
    )
    .toMatchObject({ phase: "error" });
  const finished = context.waitForEvent("page", {
    predicate: (p) => p !== source && p !== popup && p !== page,
  });
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "region" }),
  );
  await expect
    .poll(() =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" })),
    )
    .toMatchObject({ phase: "selecting" });
  await source.mouse.move(100, 120);
  await source.mouse.down();
  await source.mouse.move(500, 420, { steps: 4 });
  await source.mouse.up();
  const editor = await finished;
  await editor.waitForURL(`${origin}/app.html#*`);
  await expect(editor.locator("#canvas-dimensions")).toHaveText("400 × 300 px");
});

test("responsive studio and library deletion work without overflow or remote requests", async ({
  studio,
}) => {
  const { page, errors } = studio;
  const external = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url())) external.push(request.url());
  });
  await importImage(page, "tablet.png", testImage(900, 700));
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator("#export-button")).toBeVisible();
  await page.screenshot({
    path: "artifacts/editor-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 430, height: 932 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "artifacts/editor-mobile.png",
    fullPage: true,
  });
  await page.locator("#home-button").click();
  await page.locator("[data-delete]").click();
  await page.locator("#delete-confirm").click();
  await expect(page.locator("#empty-library")).toBeVisible();
  await expect(page.locator(".library-card")).toHaveCount(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
