import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { readFile } from "node:fs/promises";

function pattern(width = 257, height = 193, alpha = true, noisy = false) {
  const image = new PNG({ width, height });
  const colors = [
    [210, 55, 85, 255],
    [45, 110, 200, 255],
    [40, 160, 105, 255],
    [215, 95, 45, alpha ? 87 : 255],
  ];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const color =
        colors[(y >= height / 2 ? 2 : 0) + (x >= width / 2 ? 1 : 0)];
      image.data.set(
        noisy
          ? [
              (x * 17 + y * 43) % 256,
              (x * 71 + y * 13) % 256,
              (x * 37 + y * 97) % 256,
              255,
            ]
          : color,
        i,
      );
    }
  return PNG.sync.write(image);
}

async function encodedFile(
  page,
  type,
  width = 257,
  height = 193,
  alpha = true,
) {
  const input = pattern(width, height, alpha);
  if (type === "png") return input;
  return Buffer.from(
    await page.evaluate(
      async ({ base64, type }) => {
        const blob = new Blob(
          [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
          { type: "image/png" },
        );
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (type === "jpeg") {
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        return canvas.toDataURL(`image/${type}`, 0.92).split(",")[1];
      },
      { base64: input.toString("base64"), type },
    ),
    "base64",
  );
}

async function decoded(page, bytes, type) {
  return page.evaluate(
    async ({ base64, type }) => {
      const blob = new Blob(
        [Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))],
        { type: `image/${type}` },
      );
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        samples: [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ].map(([x, y]) => [
          ...ctx.getImageData(
            Math.floor(canvas.width * x),
            Math.floor(canvas.height * y),
            1,
            1,
          ).data,
        ]),
      };
    },
    { base64: bytes.toString("base64"), type },
  );
}

async function importOne(
  page,
  buffer = pattern(),
  name = "Matrix.png",
  mimeType = "image/png",
) {
  await page.locator("#image-input").setInputFiles({ name, mimeType, buffer });
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}

async function exportOne(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const download = await pending;
  return {
    bytes: await readFile(await download.path()),
    name: download.suggestedFilename(),
  };
}

async function gesture(page, name, from, to, width) {
  await page.getByRole("button", { name, exact: true }).click();
  const box = await page.locator("#overlay-canvas").boundingBox();
  const scale = box.width / width;
  await page.mouse.move(box.x + from[0] * scale, box.y + from[1] * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0] * scale, box.y + to[1] * scale, {
    steps: 5,
  });
  await page.mouse.up();
  if (name === "Crop") await page.locator("#crop-apply").click();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}

function pixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [...image.data.subarray(i, i + 4)];
}

for (const input of ["png", "jpeg", "webp"])
  for (const output of ["png", "jpeg", "webp"])
    for (const scale of [100, 50])
      test(`${input} import to ${output} at ${scale}% preserves dimensions, color and alpha semantics`, async ({
        studio,
      }) => {
        const { page, errors } = studio;
        const [width, height] =
          input === "jpeg"
            ? [193, 257]
            : input === "webp"
              ? [321, 177]
              : [257, 193];
        const source = await encodedFile(page, input, width, height);
        const reference = await decoded(page, source, input);
        await importOne(
          page,
          source,
          `Example.${input === "jpeg" ? "jpg" : input}`,
          `image/${input}`,
        );
        await page.locator(`[data-format="${output}"]`).click();
        if (output !== "png") {
          const quality = scale === 100 ? 92 : 40;
          await page.locator("#export-quality").fill(String(quality));
          await page.locator("#export-quality").dispatchEvent("input");
          await expect(page.locator("#quality-value")).toHaveText(
            `${quality}%`,
          );
        }
        await page.locator("#export-scale").fill(String(scale));
        await page.locator("#export-scale").dispatchEvent("input");
        const result = await exportOne(page);
        expect(result.name).toMatch(
          new RegExp(`\\.${output === "jpeg" ? "jpg" : output}$`),
        );
        const actual = await decoded(page, result.bytes, output);
        expect([actual.width, actual.height]).toEqual([
          Math.round((width * scale) / 100),
          Math.round((height * scale) / 100),
        ]);
        for (let n = 0; n < reference.samples.length; n++) {
          const wanted = [...reference.samples[n]];
          if (output === "jpeg") {
            for (let c = 0; c < 3; c++)
              wanted[c] = Math.round(
                (wanted[c] * wanted[3]) / 255 + 255 - wanted[3],
              );
            wanted[3] = 255;
          }
          expect(actual.samples[n][3]).toBe(wanted[3]);
          for (let c = 0; c < 3; c++)
            expect(
              Math.abs(actual.samples[n][c] - wanted[c]),
            ).toBeLessThanOrEqual(output === "png" ? 2 : 14);
        }
        expect(errors).toEqual([]);
      });

// Fixed encoded fixtures exercise actual decoders; the test runner needs no image encoders.
for (const [type, width, height, base64] of [
  ["gif", 1, 1, "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"],
  [
    "avif",
    16,
    16,
    "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAZAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAhbWRhdAoGGAz/2wCAMg8YAAAAUAAAAACpRqXWkBY=",
  ],
])
  test(`${type} decoder imports ${width}×${height} and preserves its decoded pixels in PNG`, async ({
    studio,
  }) => {
    const { page } = studio;
    const buffer = Buffer.from(base64, "base64");
    const reference = await decoded(page, buffer, type);
    expect([reference.width, reference.height]).toEqual([width, height]);
    await importOne(page, buffer, `Decoded.${type}`, `image/${type}`);
    const image = PNG.sync.read((await exportOne(page)).bytes);
    expect([image.width, image.height]).toEqual([width, height]);
    const actual = pixel(image, 0, 0);
    expect(actual[3]).toBe(reference.samples[0][3]);
    for (let channel = 0; channel < 3; channel++)
      expect(
        Math.abs(actual[channel] - reference.samples[0][channel]),
      ).toBeLessThanOrEqual(2);
    expect(studio.errors).toEqual([]);
  });

// Paper dimensions are published standards, independent of the runtime's layout table.
const papers = [
  ["letter", 612, 792],
  ["a4", (210 * 72) / 25.4, (297 * 72) / 25.4],
  ["legal", 612, 1008],
  ["tabloid", 792, 1224],
  ["a3", (297 * 72) / 25.4, (420 * 72) / 25.4],
  ["a5", (148 * 72) / 25.4, (210 * 72) / 25.4],
  ["a6", (105 * 72) / 25.4, (148 * 72) / 25.4],
  ["b4", (250 * 72) / 25.4, (353 * 72) / 25.4],
  ["b5", (176 * 72) / 25.4, (250 * 72) / 25.4],
  ["executive", 522, 756],
  ["statement", 396, 612],
  ["photo4x6", 288, 432],
  ["photo5x7", 360, 504],
];
for (const [i, [size, portraitWidth, portraitHeight]] of papers.entries())
  test(`${size} PDF exports use standard media boxes and accurate pagination with ${i % 2 ? "landscape/footer" : "portrait"}`, async ({
    studio,
  }) => {
    const { page } = studio;
    await importOne(page, pattern(420, 990), `${size}.png`);
    await page.locator('[data-format="pdf"]').click();
    await page.locator("#pdf-size").selectOption(size);
    const landscape = Boolean(i % 2);
    await page
      .locator("#pdf-orientation")
      .selectOption(landscape ? "landscape" : "portrait");
    if (landscape) await page.locator("#pdf-footer").check();
    const document = await PDFDocument.load((await exportOne(page)).bytes);
    const [width, height] = landscape
      ? [portraitHeight, portraitWidth]
      : [portraitWidth, portraitHeight];
    for (const sheet of document.getPages()) {
      expect(sheet.getWidth()).toBeCloseTo(width, 3);
      expect(sheet.getHeight()).toBeCloseTo(height, 3);
    }
    const rowsPerPage = Math.floor(
      ((height - 48 - (landscape ? 18 : 0)) * 420) / (width - 48),
    );
    expect(document.getPageCount()).toBe(Math.ceil(990 / rowsPerPage));
    await expect(page.locator("#pdf-layout-summary")).toContainText(
      `${document.getPageCount()} page`,
    );
    expect(studio.errors).toEqual([]);
  });

for (const [label, width, height] of [
  ["wide slide", 800, 360],
  ["tall receipt", 250, 1300],
  ["square artwork", 600, 600],
])
  test(`automatic PDF layout for ${label} agrees with its exported pages`, async ({
    studio,
  }) => {
    const { page } = studio;
    await importOne(page, pattern(width, height));
    await page.locator('[data-format="pdf"]').click();
    const document = await PDFDocument.load((await exportOne(page)).bytes);
    const sheet = document.getPage(0);
    const orientation =
      sheet.getWidth() > sheet.getHeight() ? "landscape" : "portrait";
    if (label === "wide slide") expect(orientation).toBe("landscape");
    if (label === "tall receipt") expect(orientation).toBe("portrait");
    await expect(page.locator("#pdf-layout-summary")).toContainText(
      `Recommended:`,
    );
    await expect(page.locator("#pdf-layout-summary")).toContainText(
      orientation,
    );
    await expect(page.locator("#pdf-layout-summary")).toContainText(
      `${document.getPageCount()} page`,
    );
  });

for (const [width, height, scale, footer] of [
  [240, 120, 100, false],
  [13, 970, 50, true],
  [900, 9, 100, true],
])
  test(`continuous PDF ${width}×${height} at ${scale}% keeps one image-sized page${footer ? " with footer" : ""}`, async ({
    studio,
  }) => {
    const { page } = studio;
    await importOne(page, pattern(width, height));
    await page.locator('[data-format="pdf"]').click();
    await page.locator("#pdf-size").selectOption("image");
    await page.locator("#export-scale").fill(String(scale));
    await page.locator("#export-scale").dispatchEvent("input");
    if (footer) await page.locator("#pdf-footer").check();
    await expect(page.locator("#pdf-orientation")).toBeDisabled();
    const document = await PDFDocument.load((await exportOne(page)).bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getPage(0).getWidth()).toBeCloseTo(
      Math.round((width * scale) / 100) * 0.75 + 48,
      3,
    );
    expect(document.getPage(0).getHeight()).toBeCloseTo(
      Math.round((height * scale) / 100) * 0.75 + 48 + (footer ? 18 : 0),
      3,
    );
  });

test("redaction survives crop, rotation, undo, redo and a fresh editor load", async ({
  studio,
}) => {
  const { page } = studio;
  await importOne(page, pattern(400, 300));
  await gesture(page, "Redact", [70, 80], [150, 140], 400);
  await gesture(page, "Crop", [40, 50], [240, 210], 400);
  await expect(page.locator("#canvas-dimensions")).toHaveText("200 × 160 px");
  let image = PNG.sync.read((await exportOne(page)).bytes);
  expect(pixel(image, 70, 60)).toEqual([17, 17, 17, 255]);
  await page.locator("#rotate-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("160 × 200 px");
  image = PNG.sync.read((await exportOne(page)).bytes);
  expect(pixel(image, 100, 70)).toEqual([17, 17, 17, 255]);
  await page.locator("#undo-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("200 × 160 px");
  await page.locator("#undo-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("400 × 300 px");
  await page.locator("#redo-button").click();
  await expect(page.locator("#canvas-dimensions")).toHaveText("200 × 160 px");
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  await page.reload();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  image = PNG.sync.read((await exportOne(page)).bytes);
  expect([image.width, image.height]).toEqual([200, 160]);
  expect(pixel(image, 70, 60)).toEqual([17, 17, 17, 255]);
  expect(studio.errors).toEqual([]);
});

test("transparent redacted captures retain full-resolution native preview, clipboard and library save actions", async ({
  studio,
}) => {
  const { page } = studio;
  await importOne(page, pattern(400, 300));
  await gesture(page, "Redact", [70, 80], [150, 140], 400);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(page.locator("#preview-image")).toBeVisible();
  const preview = await page.locator("#preview-image").evaluate((img) => {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return {
      width: canvas.width,
      height: canvas.height,
      redacted: [...ctx.getImageData(110, 110, 1, 1).data],
      alpha: ctx.getImageData(300, 225, 1, 1).data[3],
      nativeMenu: img.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    };
  });
  expect(preview).toEqual({
    width: 400,
    height: 300,
    redacted: [17, 17, 17, 255],
    alpha: 87,
    nativeMenu: true,
  });
  await page.locator("#copy-button").click();
  await expect(page.locator("#toast")).toHaveText("Image copied to clipboard.");
  await page.locator("#home-button").click();
  await page.locator(".card-preview img").click({ button: "right" });
  const pending = page.waitForEvent("download");
  await page.locator("#menu-save-image").click();
  const image = PNG.sync.read(await readFile(await (await pending).path()));
  expect([image.width, image.height]).toEqual([400, 300]);
  expect(pixel(image, 110, 110)).toEqual([17, 17, 17, 255]);
  expect(pixel(image, 300, 225)[3]).toBe(87);
});

test("mixed PNG, JPEG and WebP batch imports retain every project and reopen correct image dimensions", async ({
  studio,
}) => {
  const { page } = studio;
  const cases = [
    ["01 portrait", "png", 120, 200],
    ["02 landscape", "jpeg", 200, 120],
    ["03 square", "webp", 64, 64],
  ];
  const files = [];
  for (const [title, type, width, height] of cases)
    files.push({
      name: `${title}.${type}`,
      mimeType: `image/${type}`,
      buffer: await encodedFile(page, type, width, height),
    });
  await page.locator("#image-input").setInputFiles(files);
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#canvas-dimensions")).toHaveText("64 × 64 px");
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  await page.locator("#home-button").click();
  await expect(page.locator(".library-card")).toHaveCount(3);
  expect((await page.locator(".card-title").allTextContents()).sort()).toEqual(
    cases.map((c) => c[0]),
  );
  for (const [title, , width, height] of cases) {
    await page
      .locator(".library-card")
      .filter({ has: page.locator(".card-title", { hasText: title }) })
      .locator(".card-open")
      .click();
    await expect(page.locator("#canvas-viewport")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    const image = PNG.sync.read((await exportOne(page)).bytes);
    expect([image.width, image.height]).toEqual([width, height]);
    await page.locator("#home-button").click();
  }
  expect(studio.errors).toEqual([]);
});

for (const type of ["png", "jpeg", "webp", "pdf"])
  test(`malformed ${type} preserves the open project and allows the next valid import`, async ({
    studio,
  }) => {
    const { page } = studio;
    await importOne(page, pattern(300, 180));
    const before = page.url();
    if (type === "pdf") {
      await page.locator("#editor-pdf-button").click();
      await page.locator("#pdf-input").setInputFiles({
        name: "broken.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.7\nbroken"),
      });
      await page.locator("#pdf-run").click();
      await expect(page.locator("#pdf-status")).toContainText(
        "Could not compress",
      );
      await expect(page.locator("#pdf-run")).toBeEnabled();
      await expect.poll(() => page.workers().length).toBe(0);
      await page.getByRole("button", { name: "Close PDF compressor" }).click();
    } else {
      await page.locator("#image-input").setInputFiles({
        name: `broken.${type}`,
        mimeType: `image/${type}`,
        buffer: Buffer.from("This is not an encoded image"),
      });
      await expect(page.locator("#toast")).toContainText("0 imported");
    }
    expect(page.url()).toBe(before);
    const old = PNG.sync.read((await exportOne(page)).bytes);
    expect([old.width, old.height]).toEqual([300, 180]);
    await importOne(page, pattern(190, 250), "Recovered.png");
    const recovered = PNG.sync.read((await exportOne(page)).bytes);
    expect([recovered.width, recovered.height]).toEqual([190, 250]);
    await page.locator("#home-button").click();
    await expect(page.locator(".library-card")).toHaveCount(2);
  });

for (const mode of ["lossless", "raster"])
  for (const scanned of [false, true])
    test(`${mode} compression preserves pages and media boxes for a ${scanned ? "scanned newsletter" : "vector invoice"}`, async ({
      studio,
    }) => {
      const { page } = studio;
      const source = await PDFDocument.create();
      const font = await source.embedFont(StandardFonts.Helvetica);
      const embedded = scanned
        ? await source.embedPng(pattern(400, 600, false, true))
        : null;
      const count = scanned ? 3 : 2;
      for (let n = 0; n < count; n++) {
        const sheet = source.addPage([420, 595]);
        if (embedded)
          sheet.drawImage(embedded, { x: 24, y: 24, width: 372, height: 520 });
        sheet.drawText(
          `Fictional ${scanned ? "newsletter" : "invoice"} page ${n + 1}`,
          { x: 24, y: 560, size: 16, font },
        );
      }
      const buffer = Buffer.from(
        await source.save({ useObjectStreams: false }),
      );
      await page.locator("#compress-button").click();
      await page.locator("#pdf-input").setInputFiles({
        name: "Fictional.pdf",
        mimeType: "application/pdf",
        buffer,
      });
      await page.locator("#pdf-compression-mode").selectOption(mode);
      if (mode === "raster") {
        await page.locator("#pdf-dpi").selectOption("90");
        await page.locator("#pdf-jpeg-quality").selectOption("0.6");
      }
      await page.locator("#pdf-run").click();
      await expect(page.locator("#pdf-download")).toBeVisible();
      const pending = page.waitForEvent("download");
      await page.locator("#pdf-download").click();
      const output = await readFile(await (await pending).path());
      const compressed = await PDFDocument.load(output);
      expect(output.length).toBeLessThanOrEqual(buffer.length);
      expect(compressed.getPageCount()).toBe(count);
      for (const sheet of compressed.getPages()) {
        expect(sheet.getWidth()).toBeCloseTo(420, 3);
        expect(sheet.getHeight()).toBeCloseTo(595, 3);
      }
      await expect.poll(() => page.workers().length).toBe(0);
      expect(studio.errors).toEqual([]);
    });
