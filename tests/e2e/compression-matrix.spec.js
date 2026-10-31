import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import {
  PDFDocument,
  PDFArray,
  decodePDFRawStream,
  PDFName,
  PDFRawStream,
  rgb,
} from "pdf-lib";

test.describe.configure({ mode: "parallel" });
const compatibility =
  process.env.CS_COMPRESSION_MATRIX_PROFILE === "compatibility";

async function sourceFile(page, input) {
  if (["gif", "avif"].includes(input))
    return readFile(`tests/fixtures/compression/pattern.${input}`);
  return Buffer.from(
    await page.evaluate(async (input) => {
      const c = document.createElement("canvas");
      c.width = 203;
      c.height = 307;
      const ctx = c.getContext("2d");
      for (const [color, y, h] of [
        ["#bc2424", 0, 101],
        ["#2458bc", 101, 105],
        ["#24883c", 206, 101],
      ]) {
        ctx.fillStyle = color;
        ctx.fillRect(0, y, 203, h);
      }
      ctx.clearRect(0, 285, 203, 22);
      ctx.fillStyle = "rgba(36,136,60,0.34)";
      ctx.fillRect(0, 285, 203, 22);
      if (input === "jpeg") {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, 203, 307);
      }
      const blob = await new Promise((r) =>
        c.toBlob(r, `image/${input}`, 0.95),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());
      c.width = c.height = 1;
      return [...bytes];
    }, input),
  );
}
async function importAndSplit(page, input) {
  await page.locator("#image-input").setInputFiles({
    name: `Sizing.${input}`,
    mimeType: `image/${input}`,
    buffer: await sourceFile(page, input),
  });
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#busy-overlay")).toBeHidden();
  const id = new URL(page.url()).hash.slice(1);
  await page.evaluate(
    async ({ id, input }) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open("capture-studio", 2);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const project = await new Promise((resolve, reject) => {
        const r = db.transaction("projects").objectStore("projects").get(id);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const bitmap = await createImageBitmap(project.images[0].blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      window.matrixCorners = [
        [0, 0],
        [202, 0],
        [0, 306],
        [202, 306],
      ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      const tiles =
        input === "png"
          ? [
              { x: 0, y: 0, width: 101, height: 151 },
              { x: 101, y: 0, width: 102, height: 151 },
              { x: 0, y: 151, width: 101, height: 156 },
              { x: 101, y: 151, width: 102, height: 156 },
            ]
          : [
              { x: 0, y: 0, width: 203, height: 151 },
              { x: 0, y: 151, width: 203, height: 156 },
            ];
      const images = [];
      for (const tile of tiles) {
        const part = document.createElement("canvas");
        part.width = tile.width;
        part.height = tile.height;
        part
          .getContext("2d")
          .drawImage(
            canvas,
            tile.x,
            tile.y,
            tile.width,
            tile.height,
            0,
            0,
            tile.width,
            tile.height,
          );
        const blob = await new Promise((r) => part.toBlob(r));
        images.push({ ...tile, blob, annotations: [] });
        part.width = part.height = 1;
      }
      project.images = images;
      canvas.width = canvas.height = 1;
      await new Promise((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put(project);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { id, input },
  );
  // Reload the seeded multipart project, then build an independent source oracle.
  await page.reload();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  // Read the source oracle again from the input, rather than from exported tiles.
  const original = await sourceFile(page, input);
  await page.evaluate(
    async ({ bytes, input, compatibility }) => {
      const b = await createImageBitmap(
        new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], {
          type: `image/${input}`,
        }),
      );
      const c = document.createElement("canvas");
      c.width = b.width;
      c.height = b.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(b, 0, 0);
      b.close();
      window.matrixCorners = [
        [0, 0],
        [202, 0],
        [0, 306],
        [202, 306],
      ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
      // Independent codec oracle starts with the decoded whole input, never
      // the app's capture tiles. Low-quality JPEG ringing is expected content.
      window.matrixCodecCorners = async (
        width,
        height,
        mime,
        quality,
        crop,
      ) => {
        const ref = document.createElement("canvas");
        ref.width = width;
        ref.height = height;
        const context = ref.getContext("2d");
        context.imageSmoothingQuality = "high";
        if (mime === "image/jpeg") {
          context.fillStyle = "white";
          context.fillRect(0, 0, width, height);
        }
        const bounds = crop || { x: 0, y: 0, width: c.width, height: c.height };
        context.drawImage(
          c,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          width,
          height,
        );
        const blob = await new Promise((resolve) =>
          ref.toBlob(resolve, mime, quality),
        );
        const bitmap = await createImageBitmap(blob);
        context.clearRect(0, 0, width, height);
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const corners = [
          [0, 0],
          [width - 1, 0],
          [0, height - 1],
          [width - 1, height - 1],
        ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
        ref.width = ref.height = 1;
        return corners;
      };
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL),
        objects = new Map(),
        click = HTMLAnchorElement.prototype.click;
      window.matrixEmissions = 0;
      window.matrixUnexpected = [];
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        objects.set(url, blob);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        objects.delete(url);
        revoke(url);
      };
      HTMLAnchorElement.prototype.click = function () {
        if (!this.download) return click.call(this);
        const blob = objects.get(this.href);
        const emission = {
          name: this.download,
          mime: blob?.type,
          sequence: ++window.matrixEmissions,
          unexpected:
            !this.href.startsWith(`blob:${location.origin}/`) || !blob,
          blob,
        };
        if (emission.unexpected) window.matrixUnexpected.push(this.href);
        window.matrixLastEmission = emission;
        window.matrixResolve?.(emission);
        // The large sweep observes the exact production download payload. The
        // compatibility profile also delivers it through Chrome's download API.
        if (compatibility) return click.call(this);
      };
    },
    { bytes: original.toString("base64"), input, compatibility },
  );
}
function casesFor(output) {
  const unique = new Map();
  const add = (scale, quality) =>
    unique.set(`${scale}/${quality}`, { scale, quality });
  for (const scale of compatibility
    ? [1, 9, 10, 39, 40, 50, 94, 95, 99, 100]
    : Array.from({ length: 100 }, (_, i) => i + 1))
    for (const q of output === "png" ? [100] : [35, 67, 100]) add(scale, q);
  if (output !== "png" && !compatibility)
    for (let quality = 35; quality <= 100; quality++)
      for (const scale of [1, 39, 100]) add(scale, quality);
  return [...unique.values()];
}
for (const input of ["png", "jpeg", "webp", "gif", "avif"])
  for (const output of ["png", "jpeg", "webp", "pdf"])
    test(`${input} input → one ${output} file across ${compatibility ? "compatibility sizes and quality boundaries" : "every size and supported quality"}`, async ({
      studio,
    }, testInfo) => {
      test.setTimeout(600000);
      const { page, errors } = studio;
      await importAndSplit(page, input);
      await page.locator(`[data-format="${output}"]`).click();
      if (output === "pdf")
        await page.locator("#pdf-size").selectOption("image");
      let downloads = 0;
      page.on("download", () => downloads++);
      const cases = casesFor(output),
        checked = [];
      for (const settings of cases) {
        await expect(page.locator("#busy-overlay")).toBeHidden();
        const ui = await page.evaluate(({ scale, quality }) => {
          window.matrixPending = new Promise((resolve) => {
            window.matrixResolve = resolve;
          });
          for (const [id, value] of [
            ["export-scale", scale],
            ["export-quality", quality],
          ]) {
            const field = document.getElementById(id);
            field.value = String(value);
            field.dispatchEvent(new Event("input", { bubbles: true }));
          }
          const dimensions =
            document.getElementById("output-dimensions").textContent;
          return { dimensions };
        }, settings);
        const pending = compatibility
          ? page.waitForEvent("download", { timeout: 30000 })
          : null;
        await page.locator("#export-button").click();
        const download = pending ? await pending : null;
        const emission = await page.evaluate(async (includeBytes) => {
          const { blob, ...metadata } = await window.matrixPending;
          return {
            ...metadata,
            bytes: includeBytes
              ? [...new Uint8Array(await blob.arrayBuffer())]
              : null,
          };
        }, !compatibility);
        const bytes = compatibility
          ? await readFile(await download.path())
          : Buffer.from(emission.bytes);
        expect(emission.sequence).toBe(checked.length + 1);
        expect(emission.unexpected).toBe(false);
        expect(emission.mime).toBe(
          output === "pdf" ? "application/pdf" : `image/${output}`,
        );
        if (download) expect(download.suggestedFilename()).toBe(emission.name);
        const width = Math.max(1, Math.round((203 * settings.scale) / 100)),
          height = Math.max(1, Math.round((307 * settings.scale) / 100));
        const label = `${input}→${output}, size=${settings.scale}%, quality=${settings.quality}%`;
        expect(ui.dimensions, label).toBe(
          output === "pdf"
            ? `${input === "png" ? 4 : 2} capture parts`
            : `${width.toLocaleString()} × ${height.toLocaleString()} px`,
        );
        expect(emission.name, label).toMatch(
          new RegExp(`\\.${output === "jpeg" ? "jpg" : output}$`),
        );
        expect(bytes.subarray(0, 2).toString("ascii"), label).not.toBe("PK");
        if (output === "pdf") {
          expect(bytes.subarray(0, 5).toString(), label).toBe("%PDF-");
          const doc = await PDFDocument.load(bytes);
          const dimensions =
            input === "png"
              ? [
                  [101, 151],
                  [102, 151],
                  [101, 156],
                  [102, 156],
                ]
              : [
                  [203, 151],
                  [203, 156],
                ];
          const sizes = dimensions.map(([w, h]) => [
            Math.max(1, Math.round((w * settings.scale) / 100)),
            Math.max(1, Math.round((h * settings.scale) / 100)),
          ]);
          expect(
            doc.getPages().map((p) => [p.getWidth(), p.getHeight()]),
            label,
          ).toEqual(sizes.map(([w, h]) => [w * 0.75 + 48, h * 0.75 + 48]));
          const rasters = doc.context
            .enumerateIndirectObjects()
            .map(([, o]) => o)
            .filter(
              (o) =>
                o instanceof PDFRawStream &&
                o.dict
                  .get(PDFName.of("Filter"))
                  ?.toString()
                  .includes("DCTDecode"),
            );
          expect(
            rasters.map((o) => [
              o.dict.get(PDFName.of("Width")).asNumber(),
              o.dict.get(PDFName.of("Height")).asNumber(),
            ]),
            label,
          ).toEqual(sizes);
          if (sizes.every(([w, h]) => w >= 64 && h >= 64)) {
            const edges = await page.evaluate(
              async ({ images, crops, scale, quality }) => {
                const pixels = [],
                  reference = [];
                for (let i = 0; i < images.length; i++) {
                  const b = await createImageBitmap(
                    new Blob([Uint8Array.from(images[i])], {
                      type: "image/jpeg",
                    }),
                  );
                  const canvas = document.createElement("canvas");
                  canvas.width = b.width;
                  canvas.height = b.height;
                  const ctx = canvas.getContext("2d");
                  ctx.drawImage(b, 0, 0);
                  b.close();
                  pixels.push([
                    ...ctx.getImageData(
                      i === 0 ? 0 : canvas.width - 1,
                      i === 0 ? 0 : canvas.height - 1,
                      1,
                      1,
                    ).data,
                  ]);
                  const [x, y, width, height] = crops[i];
                  const corners = await window.matrixCodecCorners(
                    Math.max(1, Math.round((width * scale) / 100)),
                    Math.max(1, Math.round((height * scale) / 100)),
                    "image/jpeg",
                    quality / 100,
                    { x, y, width, height },
                  );
                  reference.push(corners[i === 0 ? 0 : 3]);
                  canvas.width = canvas.height = 1;
                }
                return { pixels, reference };
              },
              {
                images: [
                  [...rasters[0].getContents()],
                  [...rasters.at(-1).getContents()],
                ],
                crops:
                  input === "png"
                    ? [
                        [0, 0, 101, 151],
                        [101, 151, 102, 156],
                      ]
                    : [
                        [0, 0, 203, 151],
                        [0, 151, 203, 156],
                      ],
                ...settings,
              },
            );
            for (let n = 0; n < 2; n++)
              for (let c = 0; c < 3; c++)
                expect(
                  Math.abs(edges.pixels[n][c] - edges.reference[n][c]),
                  label,
                ).toBeLessThanOrEqual(25);
          }
          checked.push({ ...settings, width, height });
          if (checked.length % 100 === 0)
            console.log(
              `${input}→${output}: ${checked.length}/${cases.length} exports verified`,
            );
          continue;
        }
        if (output === "png")
          expect(bytes.subarray(0, 8).toString("hex"), label).toBe(
            "89504e470d0a1a0a",
          );
        else if (output === "jpeg")
          expect(bytes.subarray(0, 2).toString("hex"), label).toBe("ffd8");
        else
          expect(bytes.subarray(8, 12).toString("ascii"), label).toBe("WEBP");
        const actual = await page.evaluate(
          async ({ quality, bytes, mime }) => {
            const blob = new Blob(
                [Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))],
                { type: mime },
              ),
              b = await createImageBitmap(blob),
              c = document.createElement("canvas");
            c.width = b.width;
            c.height = b.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(b, 0, 0);
            b.close();
            const pixels = [
              [0, 0],
              [c.width - 1, 0],
              [0, c.height - 1],
              [c.width - 1, c.height - 1],
            ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
            const result = {
              width: c.width,
              height: c.height,
              mime: blob.type,
              pixels,
              reference:
                blob.type === "image/png"
                  ? window.matrixCorners
                  : await window.matrixCodecCorners(
                      c.width,
                      c.height,
                      blob.type,
                      quality / 100,
                    ),
            };
            c.width = c.height = 1;
            return result;
          },
          { ...settings, bytes: bytes.toString("base64"), mime: emission.mime },
        );
        expect([actual.width, actual.height], label).toEqual([width, height]);
        expect(actual.mime, label).toBe(`image/${output}`);
        // At tiny resolutions the whole-pixel output mixes bands. At readable sizes,
        // independent original-input codec controls identify both marked ends.
        // Horizontal end markers are also covered by the superwide export cases.
        const markerMinimum = output === "png" ? 20 : 64;
        if (width >= markerMinimum && height >= markerMinimum)
          for (let n = 0; n < 4; n++) {
            const wanted = [...actual.reference[n]];
            expect(
              Math.abs(actual.pixels[n][3] - wanted[3]),
              label,
            ).toBeLessThanOrEqual(1);
            for (let c = 0; c < 3; c++)
              expect(
                Math.abs(actual.pixels[n][c] - wanted[c]),
                `${label},corner${n},channel${c}`,
              ).toBeLessThanOrEqual(output === "png" ? 3 : 25);
          }
        checked.push({ ...settings, width, height });
        if (checked.length % 100 === 0)
          console.log(
            `${input}→${output}: ${checked.length}/${cases.length} exports verified`,
          );
      }
      expect(downloads).toBe(compatibility ? cases.length : 0);
      expect(await page.evaluate(() => window.matrixEmissions)).toBe(
        cases.length,
      );
      expect(await page.evaluate(() => window.matrixUnexpected)).toEqual([]);
      expect(errors).toEqual([]);
      await testInfo.attach("compression-cases", {
        body: JSON.stringify({
          profile: compatibility ? "compatibility" : "full",
          input,
          output,
          cases: checked,
          delivery: compatibility ? "browser-download" : "download-payload",
          downloads,
          emissions: cases.length,
          markerMinimumPixelsPerAxis: output === "png" ? 20 : 64,
          noZIP: true,
        }),
        contentType: "application/json",
      });
    });

for (const mode of [
  "lossless",
  ...[90, 120, 160].flatMap((dpi) =>
    [0.6, 0.8, 0.92].map((quality) => ({ dpi, quality })),
  ),
])
  test(`PDF ${typeof mode === "string" ? mode : `raster ${mode.dpi}DPI quality${mode.quality}`} keeps all pages, dimensions and final content`, async ({
    studio,
  }) => {
    const { page, errors } = studio,
      pdf = await PDFDocument.create(),
      sizes = [
        [203, 107],
        [203, 1307],
        [701, 103],
      ];
    // Uncompressed source noise makes actual raster results smaller than the input.
    const noise = new PNG({ width: 400, height: 900 });
    for (let i = 0; i < noise.data.length; i += 4) {
      noise.data[i] = (i * 17) % 251;
      noise.data[i + 1] = (i * 43) % 253;
      noise.data[i + 2] = (i * 71) % 255;
      noise.data[i + 3] = 255;
    }
    const image = await pdf.embedPng(PNG.sync.write(noise));
    for (const [w, h] of sizes) {
      const p = pdf.addPage([w, h]);
      p.drawImage(image, { x: 0, y: 0, width: w, height: h });
      p.drawRectangle({
        x: 0,
        y: 0,
        width: w,
        height: 20,
        color: rgb(0, 0.6, 0.2),
      });
      p.drawRectangle({
        x: 0,
        y: h - 20,
        width: w,
        height: 20,
        color: rgb(0.8, 0.1, 0.1),
      });
    }
    // Harmless source metadata padding ensures each raster configuration actually
    // returns the compressed copy, so checks cannot pass by inspecting the original.
    pdf.setSubject("source-padding-".repeat(50000));
    const source = Buffer.from(await pdf.save({ useObjectStreams: false }));
    await page.locator("#compress-button").click();
    await page.locator("#pdf-input").setInputFiles({
      name: "Compression.pdf",
      mimeType: "application/pdf",
      buffer: source,
    });
    await expect(page.locator("#pdf-dialog")).toBeVisible();
    await page
      .locator("#pdf-compression-mode")
      .selectOption(typeof mode === "string" ? "lossless" : "raster");
    if (typeof mode !== "string") {
      await page.locator("#pdf-dpi").selectOption(String(mode.dpi));
      await page
        .locator("#pdf-jpeg-quality")
        .selectOption(String(mode.quality));
    }
    await page.locator("#pdf-run").click();
    await expect(page.locator("#pdf-download")).toBeVisible({ timeout: 30000 });
    const pending = page.waitForEvent("download");
    await page.locator("#pdf-download").click();
    const download = await pending,
      bytes = await readFile(await download.path());
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const actual = await PDFDocument.load(bytes);
    expect(actual.getPages().map((p) => [p.getWidth(), p.getHeight()])).toEqual(
      sizes,
    );
    if (typeof mode === "string") {
      const before = await PDFDocument.load(source);
      const contents = (document) =>
        document.getPages().map((page) => {
          const value = page.node.Contents();
          const streams =
            value instanceof PDFArray
              ? value.asArray().map((ref) => document.context.lookup(ref))
              : [value];
          return streams.map((stream) =>
            Buffer.from(decodePDFRawStream(stream).decode()).toString("base64"),
          );
        });
      expect(contents(actual)).toEqual(contents(before));
      const imageBytes = (document) =>
        document.context
          .enumerateIndirectObjects()
          .map(([, o]) => o)
          .filter(
            (o) =>
              o instanceof PDFRawStream &&
              o.dict.get(PDFName.of("Subtype"))?.toString() === "/Image",
          )
          .map((o) => Buffer.from(o.getContents()).toString("base64"));
      expect(imageBytes(actual)).toEqual(imageBytes(before));
    }
    if (typeof mode !== "string") {
      const rasters = actual.context
        .enumerateIndirectObjects()
        .map(([, o]) => o)
        .filter(
          (o) =>
            o instanceof PDFRawStream &&
            o.dict.get(PDFName.of("Filter"))?.toString().includes("DCTDecode"),
        );
      expect(rasters).toHaveLength(3);
      for (let i = 0; i < rasters.length; i++) {
        const [w, h] = sizes[i];
        expect([
          rasters[i].dict.get(PDFName.of("Width")).asNumber(),
          rasters[i].dict.get(PDFName.of("Height")).asNumber(),
        ]).toEqual([
          Math.round((w * mode.dpi) / 72),
          Math.round((h * mode.dpi) / 72),
        ]);
        const pixels = await page.evaluate(
          async (bytes) => {
            const b = await createImageBitmap(
              new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" }),
            );
            const c = document.createElement("canvas");
            c.width = b.width;
            c.height = b.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(b, 0, 0);
            b.close();
            const colors = [
              ...ctx.getImageData(10, 5, 1, 1).data,
              ...ctx.getImageData(10, c.height - 6, 1, 1).data,
            ];
            c.width = c.height = 1;
            return colors;
          },
          [...rasters[i].getContents()],
        );
        expect(pixels[0]).toBeGreaterThan(160);
        expect(pixels[1]).toBeLessThan(60);
        expect(pixels[5]).toBeGreaterThan(120);
        expect(pixels[4]).toBeLessThan(40);
      }
    }
    expect(errors).toEqual([]);
  });
