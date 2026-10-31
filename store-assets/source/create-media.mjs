/** Reproduce native screenshots and raw tutorial recordings.
 * Run from repository root: node store-assets/source/create-media.mjs
 * Uses only the shipped MV3 UI plus fictional local example pages.
 * The temporary extension gets automation-only host access; dist is untouched.
 */
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, cp, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = resolve("store-assets");
const sourceRoot = join(root, "source");
const screenshots = join(root, "screenshots");
const work = join(sourceRoot, "recordings");
await Promise.all([
  mkdir(screenshots, { recursive: true }),
  mkdir(work, { recursive: true }),
  mkdir(join(root, "video"), { recursive: true }),
]);
const server = createServer(async (req, res) => {
  try {
    const name = req.url === "/email" ? "email.html" : "fieldnotes.html";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(join(sourceRoot, "fixtures", name)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(4181, "127.0.0.1", r));
const temporary = await mkdtemp(join(tmpdir(), "capture-studio-marketing-"));
const extension = join(temporary, "extension");
await cp("dist", extension, { recursive: true });
const manifest = JSON.parse(
  await readFile(join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["<all_urls>"];
await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(
  join(temporary, "profile"),
  {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    recordVideo: { dir: work, size: { width: 1280, height: 800 } },
    args: [
      "--no-sandbox",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  },
);
await context.route(/^https?:\/\//, (route) =>
  route.request().url().startsWith("http://127.0.0.1:4181/")
    ? route.continue()
    : route.abort(),
);
const worker =
  context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
const origin = worker.url().replace("/background.js", "");
const pageInfo = new Map(),
  scenes = [];
const errors = [];
context.on("page", (page) => {
  pageInfo.set(page, {
    started: Date.now(),
    video: page.video(),
    name: `page-${pageInfo.size}`,
  });
  page.on("pageerror", (e) => errors.push(e.message));
});
async function newPage(url, name) {
  const page = await context.newPage();
  pageInfo.get(page).name = name;
  await page.goto(url);
  await page.waitForTimeout(300);
  return page;
}
async function editorReady(page) {
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#busy-overlay")).toBeHidden();
}
async function scene(name, page, action, minSeconds = 3) {
  await page.bringToFront();
  const start = Date.now();
  await action();
  const elapsed = (Date.now() - start) / 1000;
  if (elapsed < minSeconds)
    await page.waitForTimeout((minSeconds - elapsed) * 1000);
  scenes.push({
    name,
    page: pageInfo.get(page).name,
    start: (start - pageInfo.get(page).started) / 1000,
    end: (Date.now() - pageInfo.get(page).started) / 1000,
  });
  console.log(`Recorded ${name}`);
}
const control = await newPage(`${origin}/app.html`, "control");
const web = await newPage("http://127.0.0.1:4181/fieldnotes", "fieldnotes");
await web.screenshot({
  path: join(sourceRoot, "fieldnotes-source.jpg"),
  type: "jpeg",
  quality: 95,
});
const popup = await newPage(`${origin}/popup.html`, "popup");
await popup.screenshot({
  path: join(sourceRoot, "popup.png"),
  clip: { x: 0, y: 0, width: 354, height: 742 },
});
await scene(
  "capture-options",
  popup,
  async () => {
    await popup.locator('[data-mode="full"]').hover();
    await popup.waitForTimeout(1000);
    await popup.locator('[data-mode="visible"]').hover();
    await popup.waitForTimeout(1000);
    await popup.locator('[data-mode="region"]').hover();
  },
  4,
);
await scene(
  "pane-option",
  popup,
  async () => {
    await popup.locator("#capture-target").selectOption("pick");
    await popup.waitForTimeout(1200);
    await popup.locator("#capture-target").selectOption("auto");
  },
  3,
);
async function capture(source, mode = "full", scope = "auto", during) {
  await source.bringToFront();
  const result = await control.evaluate(
    ({ mode, scope }) =>
      chrome.runtime.sendMessage({
        type: "CS_START",
        mode,
        scope,
        bars: "smart",
        delay: 0,
      }),
    { mode, scope },
  );
  if (!result.ok) throw Error(result.error);
  if (during) await during();
  let state;
  await expect
    .poll(
      async () => {
        state = await control.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        );
        if (state.phase === "error") throw Error(state.message);
        return state.phase;
      },
      { timeout: 40000 },
    )
    .toBe("done");
  let page;
  await expect
    .poll(() => {
      page = context
        .pages()
        .find((p) => p.url() === `${origin}/app.html#${state.projectId}`);
      return Boolean(page);
    })
    .toBe(true);
  pageInfo.get(page).name = `editor-${mode}-${scope}-${scenes.length}`;
  await editorReady(page);
  return page;
}
let full;
await scene(
  "full-capture",
  web,
  async () => {
    full = await capture(web);
  },
  5,
);
await full.locator("#project-title").fill("A slower kind of weekend · Demo");
await full.locator("#project-title").press("Tab");
// Capture two other genuine modes for a realistic local library.
await web.bringToFront();
await web.evaluate(() => scrollTo(0, 720));
const visible = await capture(web, "visible");
await visible
  .locator("#project-title")
  .fill("Weekend field guide · Visible area");
await visible.locator("#project-title").press("Tab");
await web.bringToFront();
await web.evaluate(() => scrollTo(0, 0));
let region;
await scene(
  "region-capture",
  web,
  async () => {
    region = await capture(web, "region", "auto", async () => {
      await expect
        .poll(() =>
          control
            .evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" }))
            .then((s) => s.phase),
        )
        .toBe("selecting");
      await web.mouse.move(76, 88);
      await web.mouse.down();
      await web.mouse.move(1203, 762, { steps: 35 });
      await web.waitForTimeout(700);
      await web.mouse.up();
    });
  },
  4,
);
await region.locator("#project-title").fill("Coastal route · Selected region");
await region.locator("#project-title").press("Tab");
const email = await newPage("http://127.0.0.1:4181/email", "email");
await email.screenshot({
  path: join(sourceRoot, "email-source.jpg"),
  type: "jpeg",
  quality: 95,
});
let mailEditor;
await scene(
  "email-auto",
  email,
  async () => {
    mailEditor = await capture(email);
  },
  6,
);
await mailEditor
  .locator("#project-title")
  .fill("Sunday dispatch · Complete email");
await mailEditor.locator("#project-title").press("Tab");
await scene(
  "email-manual",
  email,
  async () => {
    const manual = await capture(email, "full", "pick", async () => {
      await expect
        .poll(() =>
          control
            .evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" }))
            .then((s) => s.phase),
        )
        .toBe("selecting");
      await email.waitForTimeout(900);
      await email.mouse.move(790, 420, { steps: 15 });
      await email.waitForTimeout(500);
      await email.mouse.click(790, 420);
    });
    await manual
      .locator("#project-title")
      .fill("Sunday dispatch · Manual pane");
    await manual.locator("#project-title").press("Tab");
    await manual.close();
  },
  6,
);
await mailEditor.bringToFront();
await mailEditor.locator(".topbar").click({ position: { x: 330, y: 30 } });
await mailEditor.waitForTimeout(500);
await mailEditor.screenshot({
  path: join(screenshots, "03-complete-email.jpg"),
  type: "jpeg",
  quality: 95,
  animations: "disabled",
});
await scene(
  "email-result",
  mailEditor,
  async () => {
    await mailEditor.locator("#canvas-viewport").hover();
    await mailEditor.mouse.wheel(0, 625);
    await mailEditor.waitForTimeout(800);
    await mailEditor.mouse.wheel(0, 650);
    await mailEditor.waitForTimeout(800);
    await mailEditor
      .locator("#canvas-viewport")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await mailEditor.waitForTimeout(1000);
    await mailEditor
      .locator("#canvas-viewport")
      .evaluate((el) => (el.scrollTop = 0));
  },
  5,
);
async function dragTool(page, tool, from, to) {
  await page.getByRole("button", { name: tool, exact: true }).click();
  const r = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.move(r.x + from[0] * r.width, r.y + from[1] * r.width, {
    steps: 8,
  });
  await page.mouse.down();
  await page.mouse.move(r.x + to[0] * r.width, r.y + to[1] * r.width, {
    steps: 30,
  });
  await page.mouse.up();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}
await scene(
  "annotate",
  full,
  async () => {
    await dragTool(full, "Highlight", [0.072, 0.176], [0.49, 0.195]);
    await full.waitForTimeout(500);
    await dragTool(full, "Arrow", [0.71, 0.24], [0.52, 0.15]);
    await full.waitForTimeout(600);
    await full
      .getByRole("button", { name: "Numbered step", exact: true })
      .click();
    let r = await full.locator("#overlay-canvas").boundingBox();
    await full.mouse.click(r.x + r.width * 0.07, r.y + r.width * 0.3);
    await full.getByRole("button", { name: "Text", exact: true }).click();
    await full.mouse.click(r.x + r.width * 0.6, r.y + r.width * 0.205);
    await full.locator("#annotation-text").fill("Save this route");
    await full.locator("#text-done").click();
    await expect(full.locator("#save-state")).toHaveText("Saved locally");
  },
  9,
);
await full.getByRole("button", { name: "Arrow", exact: true }).click();
await full.waitForTimeout(500);
await full.screenshot({
  path: join(screenshots, "02-annotate-full-page.jpg"),
  type: "jpeg",
  quality: 95,
  animations: "disabled",
});
await scene(
  "redact-undo",
  full,
  async () => {
    await full
      .locator("#canvas-viewport")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await full.waitForTimeout(400);
    // Bring the fictional contact into the visible canvas before drawing a solid redact box.
    const canvas = await full.locator("#overlay-canvas").boundingBox();
    const viewport = await full.locator("#canvas-viewport").boundingBox();
    await full.getByRole("button", { name: "Redact", exact: true }).click();
    await full.mouse.move(
      viewport.x + viewport.width * 0.51,
      viewport.y + viewport.height * 0.65,
    );
    await full.mouse.down();
    await full.mouse.move(
      viewport.x + viewport.width * 0.85,
      viewport.y + viewport.height * 0.71,
      { steps: 25 },
    );
    await full.mouse.up();
    await full.waitForTimeout(700);
    await full.locator("#undo-button").click();
    await full.waitForTimeout(600);
    await full.locator("#redo-button").click();
    await full.waitForTimeout(600);
    await full.locator("#canvas-viewport").evaluate((el) => (el.scrollTop = 0));
  },
  6,
);
await scene(
  "pdf-options",
  full,
  async () => {
    await full.locator('[data-format="pdf"]').click();
    await full.waitForTimeout(1200);
    await full.locator("#pdf-size").selectOption("legal");
    await full.waitForTimeout(1000);
    await full.locator("#pdf-orientation").selectOption("landscape");
    await full.waitForTimeout(1000);
    await full.locator("#pdf-size").selectOption("image");
    await full.waitForTimeout(1500);
    await full.locator("#pdf-size").selectOption("auto");
    await full.locator("#pdf-orientation").selectOption("auto");
  },
  8,
);
await full.getByRole("button", { name: "Pan", exact: true }).click();
await full.waitForTimeout(500);
await full.locator(".inspector").evaluate((el) => (el.scrollTop = 245));
await full.screenshot({
  path: join(screenshots, "04-flexible-pdf-export.jpg"),
  type: "jpeg",
  quality: 95,
  animations: "disabled",
});
let capturedPDF;
await scene(
  "pdf-export",
  full,
  async () => {
    const downloadPromise = full.waitForEvent("download");
    await full.locator("#export-button").click();
    const download = await downloadPromise;
    capturedPDF = await readFile(await download.path());
    await writeFile(join(sourceRoot, "demo-capture.pdf"), capturedPDF);
  },
  4,
);
await scene(
  "image-compression",
  full,
  async () => {
    await full.locator('[data-format="webp"]').click();
    await full.locator("#export-scale").fill("75");
    await full.locator("#export-scale").dispatchEvent("input");
    await full.locator("#export-quality").fill("80");
    await full.locator("#export-quality").dispatchEvent("input");
    await full.waitForTimeout(1000);
    await full.locator("#check-size").click();
    await expect(full.locator("#busy-overlay")).toBeHidden();
    await full.waitForTimeout(1300);
    const pending = full.waitForEvent("download");
    await full.locator("#export-button").click();
    await pending;
  },
  7,
);
// A real content-preserving PDF optimization demo with intentionally uncompressed PDF objects.
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const titleFont = await doc.embedFont(StandardFonts.TimesRoman);
for (let p = 0; p < 8; p++) {
  const page = doc.addPage([595, 842]);
  page.drawRectangle({
    x: 0,
    y: 0,
    width: 595,
    height: 842,
    color: rgb(0.965, 0.95, 0.91),
  });
  page.drawText("fieldnotes.", {
    x: 48,
    y: 770,
    size: 30,
    font: titleFont,
    color: rgb(0.1, 0.25, 0.23),
  });
  page.drawText(`EXAMPLE FIELD GUIDE / CHAPTER ${p + 1}`, {
    x: 48,
    y: 730,
    size: 10,
    font,
    color: rgb(0.6, 0.35, 0.2),
  });
  page.drawText(
    [
      "Find your horizon",
      "Take the scenic route",
      "Make room for wonder",
      "A slower kind of weekend",
    ][p % 4],
    { x: 48, y: 661, size: 30, font: titleFont, color: rgb(0.1, 0.25, 0.23) },
  );
  for (let line = 0; line < 27; line++)
    page.drawText(
      `Field note ${line + 1}: Follow the quiet route. Leave time for the unexpected.`,
      {
        x: 48,
        y: 610 - line * 17,
        size: 11,
        font,
        color: rgb(0.25, 0.37, 0.32),
      },
    );
  page.drawText("Fictional sample document. No personal information.", {
    x: 48,
    y: 75,
    size: 10,
    font,
  });
}
const pdfBytes = Buffer.from(await doc.save({ useObjectStreams: false }));
await writeFile(join(sourceRoot, "fieldnotes-guide.pdf"), pdfBytes);
await scene(
  "pdf-compression",
  full,
  async () => {
    await full.locator("#editor-pdf-button").click();
    await full
      .locator("#pdf-input")
      .setInputFiles({
        name: "Fieldnotes guide — example.pdf",
        mimeType: "application/pdf",
        buffer: pdfBytes,
      });
    await full.waitForTimeout(700);
    await full.locator("#pdf-run").click();
    await expect(full.locator("#pdf-download")).toBeVisible();
    await full.waitForTimeout(1800);
  },
  6,
);
await full.screenshot({
  path: join(screenshots, "05-local-pdf-compression.jpg"),
  type: "jpeg",
  quality: 95,
  animations: "disabled",
});
await scene(
  "raster-options",
  full,
  async () => {
    await full.locator("#pdf-compression-mode").selectOption("raster");
    await full.locator("#pdf-dpi").selectOption("90");
    await full.locator("#pdf-jpeg-quality").selectOption("0.6");
    await full.waitForTimeout(1600);
    await full.locator('[data-close="pdf-dialog"]').click();
  },
  4,
);
await full.locator("#home-button").click();
await full.waitForTimeout(1000);
await full.screenshot({
  path: join(sourceRoot, "library-overview.jpg"),
  type: "jpeg",
  quality: 95,
  animations: "disabled",
});
await full.evaluate(() => scrollTo(0, 400));
await full.waitForTimeout(500);
await full.screenshot({
  path: join(screenshots, "01-private-capture-library.jpg"),
  type: "jpeg",
  quality: 95,
  animations: "disabled",
});
await scene(
  "library",
  full,
  async () => {
    await full.locator("#search-input").fill("Sunday");
    await full.waitForTimeout(1000);
    await full.locator(".card-open").first().click();
    await editorReady(full);
    await full.waitForTimeout(1000);
    await full.locator("#home-button").click();
    await full.locator("#search-input").fill("");
    await full.waitForTimeout(600);
  },
  6,
);
const install = await newPage("chrome://extensions", "install");
await scene(
  "install",
  install,
  async () => {
    const toggle = install
      .locator("extensions-manager")
      .locator("extensions-toolbar")
      .locator("#devMode");
    if (!(await toggle.getAttribute("checked"))) await toggle.click();
    await install.waitForTimeout(800);
    await install
      .getByRole("button", { name: "Load unpacked", exact: true })
      .hover();
    await install.waitForTimeout(1000);
  },
  5,
);
// The finished screenshot set is always validated for exact native pixels.
const evidence = {
  created: new Date().toISOString(),
  extensionVersion: manifest.version,
  viewport: { width: 1280, height: 800 },
  fictionalContent: true,
  errors,
  scenes,
};
for (const [page, info] of pageInfo) {
  await page.close().catch(() => {});
  info.path = await info.video.path();
}
evidence.pages = Object.fromEntries(
  [...pageInfo.values()].map(({ name, path }) => [name, path]),
);
await context.close();
await rm(temporary, { recursive: true, force: true });
await new Promise((r) => server.close(r));
await writeFile(
  join(sourceRoot, "recordings.json"),
  JSON.stringify(evidence, null, 2),
);
console.log(
  JSON.stringify({ screenshots, scenes: scenes.length, errors }, null, 2),
);
if (errors.length) process.exitCode = 1;
