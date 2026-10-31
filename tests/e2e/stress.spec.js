import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function importWhite(page, width = 800, height = 600) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  await page.locator("#image-input").setInputFiles({
    name: "Stress.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(png),
  });
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  return new URL(page.url()).hash.slice(1);
}
async function stored(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("capture-studio", 2);
        open.onsuccess = () => {
          const db = open.result,
            request = db
              .transaction("projects")
              .objectStore("projects")
              .get(id);
          request.onsuccess = async () => {
            const value = request.result;
            db.close();
            const thumb = await createImageBitmap(value.thumbnail);
            const canvas = document.createElement("canvas");
            canvas.width = thumb.width;
            canvas.height = thumb.height;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(thumb, 0, 0);
            thumb.close();
            const pixel = [...ctx.getImageData(16, 16, 1, 1).data];
            canvas.width = 1;
            resolve({
              title: value.title,
              revision: value.revision || 0,
              counts: value.images.map((image) => image.annotations.length),
              pixel,
            });
          };
          request.onerror = () => reject(request.error);
        };
        open.onerror = () => reject(open.error);
      }),
    id,
  );
}
async function drawRedaction(page) {
  await page.getByRole("button", { name: "Redact", exact: true }).click();
  const box = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 150);
  await page.mouse.up();
}

test("a pending redaction thumbnail survives rename and editing a different capture part", async ({
  studio,
}) => {
  const { page } = studio;
  const id = await importWhite(page);
  await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const open = indexedDB.open("capture-studio", 2);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("projects", "readwrite"),
            store = tx.objectStore("projects"),
            read = store.get(id);
          read.onsuccess = () => {
            const project = read.result;
            project.images.push(structuredClone(project.images[0]));
            store.put(project);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    id,
  );
  await page.reload();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    let first = true;
    window.createImageBitmap = async (...args) => {
      if (first) {
        first = false;
        window.thumbnailStarted = true;
        await new Promise((resolve) => {
          window.releaseThumbnail = resolve;
        });
      }
      return original(...args);
    };
  });
  await drawRedaction(page);
  await expect
    .poll(() => page.evaluate(() => Boolean(window.thumbnailStarted)))
    .toBe(true);
  await page.locator("#project-title").fill("Renamed while redacting");
  await page.locator("#project-title").press("Tab");
  await page.locator("#part-select").selectOption("1");
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page
    .getByRole("button", { name: "Numbered step", exact: true })
    .click();
  await page.locator("#overlay-canvas").click({ position: { x: 100, y: 100 } });
  await page.evaluate(() => window.releaseThumbnail());
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  const saved = await stored(page, id);
  expect(saved.title).toBe("Renamed while redacting");
  expect(saved.counts).toEqual([1, 1]);
  expect(saved.pixel.slice(0, 3).every((channel) => channel < 30)).toBe(true);
  await page.locator("#home-button").click();
  await page.locator(`[data-open="${id}"]`).first().click();
  await expect(page.locator("#project-title")).toHaveValue(saved.title);
});

test("rapid edits coalesce saves without rebuilding a large hidden library; unchanged PNG export copies bytes", async ({
  studio,
}, testInfo) => {
  const { page, errors } = studio;
  const id = await importWhite(page, 2400, 3000);
  const storedHash = await page.evaluate(async (id) => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open("capture-studio", 2);
      request.onsuccess = () => resolve(request.result);
    });
    const project = await new Promise((resolve) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .get(id);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction("summaries", "readwrite"),
      store = tx.objectStore("summaries");
    for (let i = 0; i < 500; i++)
      store.put({
        id: `seed-${i}`,
        title: `Library ${i}`,
        source: "",
        created: i,
        updated: i,
        mode: "import",
        thumbnail: project.thumbnail,
        parts: 1,
        width: 2400,
        height: 3000,
        bytes: project.images[0].blob.size,
      });
    await new Promise((resolve) => {
      tx.oncomplete = resolve;
    });
    db.close();
    const hash = await crypto.subtle.digest(
      "SHA-256",
      await project.images[0].blob.arrayBuffer(),
    );
    return [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }, id);
  await page.locator("#home-button").click();
  await expect(page.locator("#library-count")).toHaveText("501");
  await page.locator(`[data-open="${id}"]`).first().click();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#library-grid .library-card")).toHaveCount(0);
  await page.evaluate(() => {
    window.stressMetrics = {
      bitmapCalls: 0,
      encodes: 0,
      writes: 0,
      hiddenGridChanges: 0,
      insertedCards: 0,
    };
    const bitmap = window.createImageBitmap,
      encode = HTMLCanvasElement.prototype.toBlob,
      put = IDBObjectStore.prototype.put;
    window.createImageBitmap = (...args) => {
      window.stressMetrics.bitmapCalls++;
      return bitmap(...args);
    };
    HTMLCanvasElement.prototype.toBlob = function (...args) {
      window.stressMetrics.encodes++;
      return encode.apply(this, args);
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "projects") window.stressMetrics.writes++;
      return put.apply(this, args);
    };
    new MutationObserver((records) => {
      window.stressMetrics.hiddenGridChanges += records.length;
      window.stressMetrics.insertedCards += records.reduce(
        (sum, record) =>
          sum +
          [...record.addedNodes].filter(
            (node) => node.nodeType === 1 && node.matches(".library-card"),
          ).length,
        0,
      );
    }).observe(document.getElementById("library-grid"), { childList: true });
  });
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const bytes = await readFile(await (await pending).path());
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(storedHash);
  expect(
    await page.evaluate(() => [
      window.stressMetrics.bitmapCalls,
      window.stressMetrics.encodes,
    ]),
  ).toEqual([0, 0]);
  await page
    .getByRole("button", { name: "Numbered step", exact: true })
    .click();
  await page.locator("#overlay-canvas").evaluate((canvas) => {
    const box = canvas.getBoundingClientRect();
    window.stressStarted = performance.now();
    for (let i = 0; i < 20; i++)
      canvas.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: box.left + 40 + i * 5,
          clientY: box.top + 50,
        }),
      );
  });
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  const metrics = await page.evaluate(() => ({
    ...window.stressMetrics,
    elapsedMs: Math.round(performance.now() - window.stressStarted),
    imagePixels: 2400 * 3000,
    libraryProjects: 501,
    edits: 20,
  }));
  expect(metrics.bitmapCalls).toBeLessThanOrEqual(2);
  expect(metrics.encodes).toBeLessThanOrEqual(2);
  expect(metrics.writes).toBe(1);
  expect(metrics.insertedCards).toBe(0);
  expect(metrics.hiddenGridChanges).toBe(0);
  expect((await stored(page, id)).counts).toEqual([20]);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/stress-performance.json",
    JSON.stringify(metrics, null, 2) + "\n",
  );
  await testInfo.attach("stress-performance", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  expect(errors).toEqual([]);
});

test("a transient storage failure can be retried without a false version conflict", async ({
  studio,
}) => {
  const { page } = studio;
  const id = await importWhite(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    let first = true;
    IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
      if (first && mode === "readwrite" && [...stores].includes("projects")) {
        first = false;
        throw new DOMException(
          "Injected storage failure",
          "QuotaExceededError",
        );
      }
      return original.call(this, stores, mode, ...rest);
    };
  });
  await page.locator("#project-title").fill("Failed first save");
  await page.locator("#project-title").press("Tab");
  await expect(page.locator("#save-state")).toHaveText("Could not save");
  await expect(page.locator("#conflict-banner")).toBeHidden();
  await page.locator("#project-title").fill("Recovered save");
  await page.locator("#project-title").press("Tab");
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  expect(await stored(page, id)).toMatchObject({
    title: "Recovered save",
    revision: 1,
  });
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});

test("PDF settings stay consistent during work and repeated cancellation releases workers", async ({
  studio,
}) => {
  const { page } = studio;
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 40; i++) pdf.addPage([612, 792]);
  const buffer = Buffer.from(await pdf.save());
  await page.locator("#compress-button").click();
  await page.locator("#pdf-input").setInputFiles({
    name: "40-pages.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page.evaluate(() => {
    const original = Blob.prototype.arrayBuffer;
    let first = true;
    Blob.prototype.arrayBuffer = async function () {
      if (first) {
        first = false;
        window.pdfReadStarted = true;
        await new Promise((resolve) => {
          window.releasePDFRead = resolve;
        });
      }
      return original.call(this);
    };
  });
  await page.locator("#pdf-run").click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.pdfReadStarted)))
    .toBe(true);
  for (const id of [
    "pdf-compression-mode",
    "pdf-dpi",
    "pdf-jpeg-quality",
    "choose-pdf",
  ])
    await expect(page.locator(`#${id}`)).toBeDisabled();
  await page.evaluate(() => window.releasePDFRead());
  await expect(page.locator("#pdf-download")).toBeVisible();
  await expect(page.locator("#pdf-compression-mode")).toBeEnabled();
  await page.locator("#pdf-compression-mode").selectOption("raster");
  await expect(page.locator("#pdf-download")).toBeHidden();
  for (let i = 0; i < 3; i++) {
    await page.locator("#pdf-run").click();
    await page.locator("#pdf-cancel").click();
    await expect(page.locator("#pdf-status")).toContainText("cancelled");
    await expect(page.locator("#pdf-run")).toBeEnabled();
    await expect.poll(() => page.workers().length).toBe(0);
  }
  await page.locator("#pdf-input").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nbroken"),
  });
  await page.locator("#pdf-run").click();
  await expect(page.locator("#pdf-status")).toContainText("Could not compress");
  await expect(page.locator("#pdf-run")).toBeEnabled();
  await expect.poll(() => page.workers().length).toBe(0);
  await page.locator("#pdf-input").setInputFiles({
    name: "valid-again.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await page.locator("#pdf-run").click();
  // The recovered 40-page raster job processes about 54MP at 120 DPI.
  // With six workers it was still progressing at 85–90% after the ordinary
  // 10-second UI deadline; give only this processing assertion a bounded budget.
  await expect(page.locator("#pdf-download")).toBeVisible({ timeout: 30000 });
  const recoveredDownload = page.waitForEvent("download");
  await page.locator("#pdf-download").click();
  const recoveredBytes = await readFile(await (await recoveredDownload).path());
  expect((await PDFDocument.load(recoveredBytes)).getPageCount()).toBe(40);
  await expect.poll(() => page.workers().length).toBe(0);
});

async function sourcePage(studio, html) {
  const source = await studio.context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.setContent(html);
  const popup = await studio.context.newPage();
  await popup.goto(`${studio.origin}/popup.html`);
  await source.bringToFront();
  const tabId = await popup.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  return { source, popup, tabId };
}
async function capture(studio, job) {
  expect(
    await job.popup.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "CS_START",
        mode: "full",
        scope: "page",
      }),
    ),
  ).toEqual({ ok: true });
  let state;
  await expect
    .poll(
      async () => {
        state = await job.popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        );
        if (state.phase === "error") throw new Error(state.message);
        return state.phase;
      },
      { timeout: 25000 },
    )
    .toBe("done");
  let editor;
  await expect
    .poll(() => {
      editor = studio.context
        .pages()
        .find(
          (page) =>
            page.url() === `${studio.origin}/app.html#${state.projectId}`,
        );
      return Boolean(editor);
    })
    .toBe(true);
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  return editor;
}

for (const [rootDirection, bodyDirection] of [
  ["rtl", "rtl"],
  ["ltr", "rtl"],
  ["rtl", "ltr"],
])
  test(`wide documents with ${rootDirection} root / ${bodyDirection} body stitch both halves and restore native scroll`, async ({
    studio,
  }) => {
    const job = await sourcePage(
      studio,
      `<!doctype html><html dir="${rootDirection}"><style>body{margin:0;direction:${bodyDirection}}#surface{width:2400px;height:1400px;position:relative;background:#349567}.half{position:absolute;top:0;bottom:0;width:1200px}.left{left:0;background:#c8455d}.right{right:0;background:#316bba}</style><div id="surface"><div class="half left"></div><div class="half right"></div></div></html>`,
    );
    await job.source.setViewportSize({ width: 1200, height: 800 });
    await job.source.evaluate(
      (left) => scrollTo({ left, top: 234, behavior: "instant" }),
      bodyDirection === "rtl" ? -321 : 321,
    );
    const before = await job.source.evaluate(() => ({
      x: scrollX,
      y: scrollY,
    }));
    const editor = await capture(studio, job);
    const pending = editor.waitForEvent("download");
    await editor.locator("#export-button").click();
    const png = PNG.sync.read(await readFile(await (await pending).path()));
    expect([png.width, png.height]).toEqual([2400, 1400]);
    for (const y of [50, 750, 1350]) {
      const left = (y * png.width + 200) * 4,
        right = (y * png.width + 2200) * 4;
      expect([...png.data.subarray(left, left + 4)]).toEqual([
        200, 69, 93, 255,
      ]);
      expect([...png.data.subarray(right, right + 4)]).toEqual([
        49, 107, 186, 255,
      ]);
    }
    await expect
      .poll(() => job.source.evaluate(() => ({ x: scrollX, y: scrollY })))
      .toEqual(before);
  });

test("fixed-heavy preparation batches layout work and restores every original style", async ({
  studio,
}, testInfo) => {
  const job = await sourcePage(
    studio,
    `<!doctype html><style>body{margin:0}.row{height:15px;display:flex}.bar{position:fixed;top:0;height:10px;width:20px;background:red}</style>${'<div class="row"><div class="bar"></div><span>row</span></div>'.repeat(1500)}`,
  );
  await job.source.setViewportSize({ width: 1200, height: 800 });
  await job.source.evaluate(() => scrollTo({ top: 333, behavior: "instant" }));
  await job.popup.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      }),
    job.tabId,
  );
  const metrics = await job.popup.evaluate(async (tabId) => {
    const start = performance.now();
    const prepared = await chrome.tabs.sendMessage(tabId, {
      type: "CS_PAGE_PREPARE",
      mode: "full",
      bars: "smart",
    });
    const preparedMs = Math.round(performance.now() - start);
    if (!prepared.ok) return { prepared, preparedMs };
    const scrollStart = performance.now();
    const scrolled = await chrome.tabs.sendMessage(tabId, {
      type: "CS_PAGE_SCROLL",
      x: 0,
      y: 1600,
    });
    const scrollMs = Math.round(performance.now() - scrollStart);
    await chrome.tabs.sendMessage(tabId, { type: "CS_PAGE_RESTORE" });
    return { prepared, scrolled, preparedMs, scrollMs, fixedElements: 1500 };
  }, job.tabId);
  expect(metrics.prepared.ok).toBe(true);
  expect(metrics.prepared.data.height).toBeGreaterThanOrEqual(22500);
  expect(metrics.scrolled.ok).toBe(true);
  expect(metrics.scrolled.data.y).toBe(1600);
  expect(
    await job.source.evaluate(() => ({
      scrollY,
      changed: [...document.querySelectorAll(".bar")].filter((node) =>
        node.hasAttribute("style"),
      ).length,
    })),
  ).toEqual({ scrollY: 333, changed: 0 });
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/fixed-layout-performance.json",
    JSON.stringify(metrics, null, 2) + "\n",
  );
  await testInfo.attach("fixed-layout-performance", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
});

test("document shrinkage stops cleanly and the next capture succeeds", async ({
  studio,
}) => {
  const job = await sourcePage(
    studio,
    `<!doctype html><style>body{margin:0}#surface{height:5000px;background:#4a849c}</style><main id="surface"></main>`,
  );
  await job.source.evaluate(() => scrollTo({ top: 123, behavior: "instant" }));
  await job.popup.evaluate(() =>
    chrome.runtime.sendMessage({
      type: "CS_START",
      mode: "full",
      scope: "page",
    }),
  );
  await expect
    .poll(
      async () =>
        (
          await job.popup.evaluate(() =>
            chrome.runtime.sendMessage({ type: "CS_STATUS" }),
          )
        ).progress,
    )
    .toBeGreaterThan(0);
  await job.source.evaluate(() => {
    document.querySelector("#surface").style.height = "1500px";
  });
  await expect
    .poll(
      async () =>
        (
          await job.popup.evaluate(() =>
            chrome.runtime.sendMessage({ type: "CS_STATUS" }),
          )
        ).phase,
    )
    .toBe("error");
  const state = await job.popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_STATUS" }),
  );
  expect(state.message).toMatch(/changed size/);
  await expect.poll(() => job.source.evaluate(() => scrollY)).toBe(123);
  expect(
    studio.context.pages().filter((page) => page.url().includes("app.html#")),
  ).toHaveLength(0);
  await job.source.bringToFront();
  const editor = await capture(studio, job);
  await expect(editor.locator("#canvas-dimensions")).toHaveText(
    "1,440 × 1,500 px",
  );
});

test("maximum-size image editing survives malformed and oversized imports", async ({
  studio,
}) => {
  const { page, errors } = studio;
  const id = await importWhite(page, 6000, 4000);
  await expect(page.locator("#canvas-dimensions")).toHaveText(
    "6,000 × 4,000 px",
  );
  await drawRedaction(page);
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const png = PNG.sync.read(await readFile(await (await pending).path()));
  expect([png.width, png.height]).toEqual([6000, 4000]);
  expect(png.data[(250 * png.width + 250) * 4]).toBe(17);
  await page.locator("#image-input").setInputFiles({
    name: "corrupt.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image"),
  });
  await expect(page.locator("#toast")).toContainText("0 imported");
  await expect(page.locator("#busy-overlay")).toBeHidden();
  const overwide = new PNG({ width: 16001, height: 1 });
  overwide.data.fill(255);
  await page.locator("#image-input").setInputFiles({
    name: "overwide.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(overwide),
  });
  await expect(page.locator("#toast")).toContainText(
    "too large to edit safely",
  );
  expect(new URL(page.url()).hash.slice(1)).toBe(id);
  expect((await stored(page, id)).counts).toEqual([1]);
  await page.locator("#home-button").click();
  await importWhite(page, 400, 300);
  await expect(page.locator("#canvas-dimensions")).toHaveText("400 × 300 px");
  expect(errors).toEqual([]);
});

test("file and batch limits reject before decoding and preserve the open capture", async ({
  studio,
}) => {
  const { page, errors } = studio;
  const id = await importWhite(page);
  await page.evaluate(() => {
    const chunk = new Blob([new Uint8Array(1024 * 1024)]),
      transfer = new DataTransfer();
    transfer.items.add(
      new File(Array(101).fill(chunk), "too-big.png", { type: "image/png" }),
    );
    const input = document.getElementById("image-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#toast")).toContainText(
    "exceeds the 100 MB limit",
  );
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    for (let i = 0; i < 31; i++)
      transfer.items.add(
        new File(["not decoded"], `batch-${i}.png`, { type: "image/png" }),
      );
    const input = document.getElementById("image-input");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change"));
  });
  await expect(page.locator("#toast")).toContainText("up to 30 images");
  expect(new URL(page.url()).hash.slice(1)).toBe(id);
  expect((await stored(page, id)).counts).toEqual([0]);
  await page.locator("#project-title").fill("Still editable");
  await page.locator("#project-title").press("Tab");
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  expect(errors).toEqual([]);
});
