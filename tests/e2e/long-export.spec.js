import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";

const emailParts = [
  { x: 0, y: 0, width: 2320, height: 10344, color: "#2458bc", top: "#bc2424" },
  {
    x: 0,
    y: 10344,
    width: 2320,
    height: 1125,
    color: "#24883c",
    bottom: "#f08020",
  },
];

async function seed(page, parts = emailParts, title = "Complete long email") {
  const id = await page.evaluate(
    async ({ parts, title }) => {
      const images = [];
      for (const spec of parts) {
        const canvas = document.createElement("canvas");
        canvas.width = spec.width;
        canvas.height = spec.height;
        const ctx = canvas.getContext("2d");
        if (spec.color) {
          ctx.fillStyle = spec.color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        if (spec.top) {
          ctx.fillStyle = spec.top;
          ctx.fillRect(0, 0, canvas.width, 50);
        }
        if (spec.bottom) {
          ctx.fillStyle = spec.bottom;
          ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve));
        canvas.width = canvas.height = 1;
        images.push({ ...spec, blob, annotations: spec.annotations || [] });
      }
      const id = crypto.randomUUID();
      const project = {
        id,
        title,
        images,
        created: Date.now(),
        updated: Date.now(),
        source: "https://example.test/mail",
        mode: "pane",
      };
      await new Promise((resolve, reject) => {
        const open = indexedDB.open("capture-studio", 2);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("projects", "readwrite");
          tx.objectStore("projects").put(project);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      });
      return id;
    },
    { parts, title },
  );
  await page.goto(`${page.url().split("#")[0]}#${id}`);
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  return id;
}

async function size(page, percent) {
  await page.locator("#export-scale").fill(String(percent));
  await page.locator("#export-scale").dispatchEvent("input");
}
async function exported(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const download = await pending;
  return {
    data: await readFile(await download.path()),
    name: download.suggestedFilename(),
  };
}
async function decoded(page, data, points, mime) {
  return page.evaluate(
    async ({ bytes, points, mime }) => {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
          type: mime,
        }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const result = {
        width: canvas.width,
        height: canvas.height,
        pixels: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]),
      };
      canvas.width = canvas.height = 1;
      return result;
    },
    { bytes: data.toString("base64"), points, mime },
  );
}

for (const format of ["png", "jpeg", "webp"])
  test(`long ${format} compression retains the whole page, ratio, join and final footer`, async ({
    studio,
  }) => {
    const { page, errors } = studio;
    await seed(page);
    await page.locator(`[data-format="${format}"]`).click();
    await size(page, 40);
    if (format !== "png") {
      await page.locator("#export-quality").fill("35");
      await page.locator("#export-quality").dispatchEvent("input");
    }
    await expect(page.locator("#output-dimensions")).toHaveText(
      "928 × 4,588 px",
    );
    await expect(page.locator("#export-layout-summary")).toContainText(
      "All 2 parts joined",
    );
    await page.locator("#part-select").selectOption("1");
    await expect(page.locator("#output-dimensions")).toHaveText(
      "928 × 4,588 px",
    );
    const output = await exported(page);
    expect(output.name).toMatch(
      format === "jpeg" ? /\.jpg$/ : new RegExp(`\\.${format}$`),
    );
    const result = await decoded(
      page,
      output.data,
      [
        [400, 0],
        [400, 4120],
        [400, 4160],
        [400, 4587],
      ],
      `image/${format}`,
    );
    expect([result.width, result.height]).toEqual([928, 4588]);
    const colors = [
      [188, 36, 36, 255],
      [36, 88, 188, 255],
      [36, 136, 60, 255],
      [240, 128, 32, 255],
    ];
    for (let i = 0; i < colors.length; i++)
      for (let c = 0; c < 4; c++)
        expect(
          Math.abs(result.pixels[i][c] - colors[i][c]),
          `format=${format}, point=${i}, channel=${c}, pixels=${JSON.stringify(result.pixels)}`,
        ).toBeLessThanOrEqual(format === "png" ? 0 : 12);
    if (format !== "png") {
      await page.locator("#export-quality").fill("100");
      await page.locator("#export-quality").dispatchEvent("input");
      const higher = await exported(page);
      const other = await decoded(
        page,
        higher.data,
        [[400, 4587]],
        `image/${format}`,
      );
      expect([other.width, other.height]).toEqual([928, 4588]);
    }
    expect(errors).toEqual([]);
  });

for (const format of ["png", "jpeg", "webp"])
  test(`oversized ${format} capture automatically exports one complete safe image`, async ({
    studio,
  }) => {
    const { page } = studio;
    await seed(page);
    await page.locator(`[data-format="${format}"]`).click();
    await expect(page.locator("#output-dimensions")).toHaveText(
      "2,203 × 10,893 px",
    );
    await expect(page.locator("#export-layout-summary")).toContainText(
      "Automatically resized uniformly",
    );
    await expect(page.locator("#export-scale")).toHaveValue("100");
    for (const quality of format === "png" ? [100] : [35, 67, 100]) {
      if (format !== "png") {
        await page.locator("#export-quality").fill(String(quality));
        await page.locator("#export-quality").dispatchEvent("input");
      }
      const result = await exported(page);
      expect(result.name).toMatch(
        new RegExp(`\\.${format === "jpeg" ? "jpg" : format}$`),
      );
      const fit = await decoded(
        page,
        result.data,
        [[20, 10892]],
        `image/${format}`,
      );
      expect([fit.width, fit.height]).toEqual([2203, 10893]);
      const wanted = [240, 128, 32, 255];
      for (let c = 0; c < 4; c++)
        expect(Math.abs(fit.pixels[0][c] - wanted[c])).toBeLessThanOrEqual(
          format === "png" ? 0 : 12,
        );
    }
  });

test("complete/current exports are single files and labeled correctly and new captures reset to complete", async ({
  studio,
}) => {
  const { page } = studio;
  await seed(page, [
    { x: 0, y: 0, width: 100, height: 100, color: "#123456" },
    { x: 0, y: 100, width: 100, height: 100, color: "#654321" },
  ]);
  await size(page, 40);
  expect(PNG.sync.read((await exported(page)).data).height).toBe(80);
  await expect(
    page.locator('#export-scope option[value="separate"]'),
  ).toHaveCount(0);
  await page.locator("#part-select").selectOption("1");
  await page.locator("#export-scope").selectOption("current");
  await expect(page.locator("#export-layout-summary")).toContainText(
    "Only part 2 of 2",
  );
  expect(PNG.sync.read((await exported(page)).data).height).toBe(40);
  await seed(
    page,
    [
      { x: 0, y: 0, width: 100, height: 100, color: "#123456" },
      { x: 0, y: 100, width: 100, height: 100, color: "#654321" },
    ],
    "Next capture",
  );
  await expect(page.locator("#export-scope")).toHaveValue("all");
  await expect(page.locator("#output-dimensions")).toHaveText("40 × 80 px");
});

test("square rotations and end-part crops retain all parts in one image, undo restores original layout", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await seed(page, [
    { x: 0, y: 0, width: 300, height: 300, color: "#123456" },
    { x: 0, y: 300, width: 300, height: 300, color: "#654321" },
  ]);
  await page.locator("#rotate-button").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#export-button")).toContainText("image");
  await expect(page.locator("#export-layout-summary")).toContainText(
    "arranged vertically",
  );
  await page.locator("#undo-button").click();
  await expect(page.locator("#export-button")).toContainText("image");
  await expect(page.locator("#output-dimensions")).toHaveText("300 × 600 px");
  await page.locator("#part-select").selectOption("1");
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  const box = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.locator("#crop-apply").click();
  await expect(page.locator("#export-button")).toContainText("image");
  const combined = PNG.sync.read((await exported(page)).data);
  expect([combined.width, combined.height]).toEqual([300, 460]);
  expect([
    ...combined.data.subarray((459 * 300 + 150) * 4, (459 * 300 + 150) * 4 + 4),
  ]).toEqual([101, 67, 33, 255]);
  expect([...combined.data.subarray(459 * 300 * 4, 459 * 300 * 4 + 4)]).toEqual(
    [0, 0, 0, 0],
  );
  await page.locator("#undo-button").click();
  await expect(page.locator("#output-dimensions")).toHaveText("300 × 600 px");
  expect(errors).toEqual([]);
});

test("unordered 2D parts share rounded edges, preserve alpha and flatten redactions before resizing", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await seed(page, [
    { x: 101, y: 101, width: 102, height: 102, color: "#24883c" },
    {
      x: 0,
      y: 0,
      width: 101,
      height: 101,
      color: "#2458bc",
      annotations: [
        { type: "redact", rect: { x: 20, y: 20, width: 50, height: 50 } },
        { type: "blur", rect: { x: 10, y: 10, width: 70, height: 70 } },
      ],
    },
    { x: 0, y: 101, width: 101, height: 102 },
    { x: 101, y: 0, width: 102, height: 101, color: "#bc2424" },
  ]);
  await size(page, 39);
  const points = [
    [15, 15],
    [20, 38],
    [20, 39],
    [38, 20],
    [39, 20],
    [39, 39],
    [78, 78],
  ];
  const result = await decoded(
    page,
    (await exported(page)).data,
    points,
    "image/png",
  );
  expect([result.width, result.height]).toEqual([79, 79]);
  expect(result.pixels).toEqual([
    [17, 17, 17, 255],
    [36, 88, 188, 255],
    [0, 0, 0, 0],
    [36, 88, 188, 255],
    [188, 36, 36, 255],
    [36, 136, 60, 255],
    [36, 136, 60, 255],
  ]);
  await page.locator('[data-format="webp"]').click();
  const webp = await decoded(
    page,
    (await exported(page)).data,
    [[10, 60]],
    "image/webp",
  );
  expect(webp.pixels[0][3]).toBe(0);
  await page.locator('[data-format="jpeg"]').click();
  const jpg = await decoded(
    page,
    (await exported(page)).data,
    [[10, 60]],
    "image/jpeg",
  );
  expect(jpg.pixels[0]).toEqual([255, 255, 255, 255]);
  expect(errors).toEqual([]);
});

test("1% exports skip collapsed tiles without overwriting the remaining pixel and PDF agrees", async ({
  studio,
}) => {
  const { page } = studio;
  await seed(page, [
    { x: 0, y: 0, width: 1, height: 1, color: "#bc2424" },
    { x: 0, y: 1, width: 1, height: 99, color: "#24883c" },
  ]);
  await size(page, 1);
  const png = PNG.sync.read((await exported(page)).data);
  expect([png.width, png.height, ...png.data]).toEqual([
    1, 1, 36, 136, 60, 255,
  ]);
  await page.locator('[data-format="pdf"]').click();
  await page.locator("#pdf-size").selectOption("image");
  const pdf = await PDFDocument.load((await exported(page)).data);
  expect(pdf.getPageCount()).toBe(2);
  expect(pdf.getPages().map((p) => p.getSize())).toEqual([
    { width: 48.75, height: 48.75 },
    { width: 48.75, height: 48.75 },
  ]);
});

test("joining decodes one bounded source tile at a time and releases its buffers", async ({
  studio,
}) => {
  const { page } = studio;
  await seed(page);
  await size(page, 40);
  await page.evaluate(() => {
    const decode = window.createImageBitmap,
      context = HTMLCanvasElement.prototype.getContext;
    window.exportMemory = { active: 0, peak: 0, decoded: 0, allocated: [] };
    window.createImageBitmap = async (...args) => {
      const bitmap = await decode(...args),
        close = bitmap.close.bind(bitmap);
      window.exportMemory.active++;
      window.exportMemory.decoded++;
      window.exportMemory.peak = Math.max(
        window.exportMemory.peak,
        window.exportMemory.active,
      );
      bitmap.close = () => {
        window.exportMemory.active--;
        close();
      };
      return bitmap;
    };
    HTMLCanvasElement.prototype.getContext = function (...args) {
      window.exportMemory.allocated.push([this.width, this.height]);
      return context.apply(this, args);
    };
  });
  await exported(page);
  const memory = await page.evaluate(() => window.exportMemory);
  expect(memory.decoded).toBe(2);
  expect(memory.peak).toBe(1);
  expect(memory.active).toBe(0);
  for (const [width, height] of memory.allocated) {
    expect(width).toBeLessThanOrEqual(16000);
    expect(height).toBeLessThanOrEqual(16000);
    expect(width * height).toBeLessThanOrEqual(24000000);
  }
  expect(memory.allocated).toContainEqual([928, 4588]);
});

test("export failures close bitmaps, release temporary canvases and allow a clean retry", async ({
  studio,
}) => {
  const { page } = studio;
  await seed(page, [
    { x: 0, y: 0, width: 100, height: 100, color: "#2458bc" },
    { x: 0, y: 100, width: 100, height: 100, color: "#24883c" },
  ]);
  await page.evaluate(() => {
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    window.failedExportCanvases = [];
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (this.canvas.height === 200) {
        window.failedExportCanvases.push(this.canvas, args[0]);
        CanvasRenderingContext2D.prototype.drawImage = draw;
        throw new Error("Simulated export draw failure");
      }
      return draw.apply(this, args);
    };
  });
  await page.locator("#export-button").click();
  await expect(page.locator("#toast")).toHaveText(
    "Simulated export draw failure",
  );
  expect(
    await page.evaluate(() =>
      window.failedExportCanvases.map((c) => [c.width, c.height]),
    ),
  ).toEqual([
    [1, 1],
    [1, 1],
  ]);
  expect(PNG.sync.read((await exported(page)).data).height).toBe(200);
});

test("an export finishing after navigation keeps its original filename and cannot replace the new capture cache", async ({
  studio,
}) => {
  const { page, errors } = studio;
  const original = await seed(
    page,
    [
      { x: 0, y: 0, width: 100, height: 100, color: "#2458bc" },
      { x: 0, y: 100, width: 100, height: 100, color: "#24883c" },
    ],
    "Original capture",
  );
  const next = await seed(
    page,
    [{ x: 0, y: 0, width: 200, height: 100, color: "#bc2424" }],
    "Next capture",
  );
  await page.goto(`${page.url().split("#")[0]}#${original}`);
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => {
    const decode = window.createImageBitmap;
    let first = true;
    window.createImageBitmap = async (...args) => {
      if (first) {
        first = false;
        window.exportDecodeHeld = true;
        await new Promise((resolve) => {
          window.releaseExportDecode = resolve;
        });
      }
      return decode(...args);
    };
  });
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.exportDecodeHeld)))
    .toBe(true);
  await page.evaluate((next) => {
    location.hash = next;
  }, next);
  await expect(page.locator("#project-title")).toHaveValue("Next capture");
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => window.releaseExportDecode());
  const download = await pending;
  expect(download.suggestedFilename()).toBe("Original capture.png");
  expect(PNG.sync.read(await readFile(await download.path())).height).toBe(200);
  await expect(page.locator("#output-dimensions")).toHaveText("200 × 100 px");
  await expect(page.locator("#export-result")).toHaveText(
    "Adjust size or choose JPG / WebP to reduce file size.",
  );
  const output = await exported(page);
  expect(output.name).toBe("Next capture.png");
  const png = PNG.sync.read(output.data);
  expect([png.width, png.height, ...png.data.subarray(0, 4)]).toEqual([
    200, 100, 188, 36, 36, 255,
  ]);
  expect(errors).toEqual([]);
});

test("legacy parts stack into one complete image and PDF remains one file", async ({
  studio,
}) => {
  const { page } = studio;
  await seed(page, [
    { width: 100, height: 100, color: "#2458bc" },
    { width: 100, height: 60, color: "#24883c" },
  ]);
  await size(page, 50);
  await expect(page.locator("#export-layout-summary")).toContainText(
    "Original page layout is unavailable",
  );
  const joined = PNG.sync.read((await exported(page)).data);
  expect([joined.width, joined.height]).toEqual([50, 80]);
  await page.locator('[data-format="pdf"]').click();
  await expect(
    page.locator('#export-scope option[value="separate"]'),
  ).toHaveCount(0);
  await expect(page.locator("#export-scope")).toHaveValue("all");
  const output = await exported(page);
  expect(output.name).toMatch(/\.pdf$/);
  expect((await PDFDocument.load(output.data)).getPageCount()).toBe(2);
});

for (const format of ["png", "jpeg", "webp"])
  test(`fractional saved crop ${format} dimensions agree with the actual single-file export`, async ({
    studio,
  }) => {
    const { page } = studio;
    await seed(page, [
      {
        width: 100,
        height: 100,
        color: "#24883c",
        crop: { x: 0.1, y: 0.2, width: 50.6, height: 50.6 },
      },
    ]);
    await page.locator(`[data-format="${format}"]`).click();
    await size(page, 50);
    await expect(page.locator("#output-dimensions")).toHaveText("25 × 25 px");
    const result = await exported(page);
    const actual = await decoded(
      page,
      result.data,
      [[12, 24]],
      `image/${format}`,
    );
    expect([actual.width, actual.height]).toEqual([25, 25]);
  });

for (const format of ["png", "jpeg", "webp"])
  for (const horizontal of [false, true])
    test(`superlong ${horizontal ? "horizontal" : "vertical"} ${format} capture automatically fits below1% as one file`, async ({
      studio,
    }) => {
      const { page, errors } = studio;
      const parts = Array.from({ length: 101 }, (_, i) => ({
        x: horizontal ? i * 16000 : 0,
        y: horizontal ? 0 : i * 16000,
        width: horizontal ? 16000 : 1,
        height: horizontal ? 1 : 16000,
        color: i === 0 ? "#bc2424" : i === 100 ? "#24883c" : "#2458bc",
      }));
      await seed(page, parts);
      await page.locator(`[data-format="${format}"]`).click();
      await size(page, 1);
      await expect(page.locator("#output-dimensions")).toHaveText(
        horizontal ? "16,000 × 1 px" : "1 × 16,000 px",
      );
      await expect(page.locator("#export-layout-summary")).toContainText(
        "Automatically resized uniformly",
      );
      const result = await exported(page);
      const decodedImage = await decoded(
        page,
        result.data,
        horizontal
          ? [
              [0, 0],
              [15999, 0],
            ]
          : [
              [0, 0],
              [0, 15999],
            ],
        `image/${format}`,
      );
      expect([decodedImage.width, decodedImage.height]).toEqual(
        horizontal ? [16000, 1] : [1, 16000],
      );
      for (let n = 0; n < 2; n++)
        for (let c = 0; c < 4; c++)
          expect(
            Math.abs(
              decodedImage.pixels[n][c] -
                [
                  [188, 36, 36, 255],
                  [36, 136, 60, 255],
                ][n][c],
            ),
          ).toBeLessThanOrEqual(format === "png" ? 0 : 12);
      expect(errors).toEqual([]);
    });
