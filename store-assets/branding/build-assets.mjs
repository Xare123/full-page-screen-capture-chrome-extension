// Normalize original image-generation artwork with the browser's native canvas.
// No illustration is drawn or altered here: only cropping, sizing, and encoding.
import { chromium } from "playwright";
import { PNG } from "pngjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();

const source = async (name) =>
  `data:image/png;base64,${(await fs.readFile(path.join(root, "masters", name))).toString("base64")}`;

const iconSource = await source("icon-generated.png");
const icon = PNG.sync.read(
  await fs.readFile(path.join(root, "masters", "icon-generated.png")),
);
let left = icon.width;
let top = icon.height;
let right = 0;
let bottom = 0;
for (let y = 0; y < icon.height; y++) {
  for (let x = 0; x < icon.width; x++) {
    // Discard sub-1%-opacity isolated generator artifacts outside the artwork.
    if (icon.data[(y * icon.width + x) * 4 + 3] > 1) {
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
}
const sourceBox = [left, top, right - left + 1, bottom - top + 1];

async function canvasImage({ src, width, height, crop, inset = 0 }) {
  const encoded = await page.evaluate(
    async ({ src, width, height, crop, inset }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      const source = crop || [0, 0, img.naturalWidth, img.naturalHeight];
      ctx.drawImage(
        img,
        ...source,
        inset,
        inset,
        width - 2 * inset,
        height - 2 * inset,
      );
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { src, width, height, crop, inset },
  );
  return Buffer.from(encoded, "base64");
}

const outputs = [];
for (const size of [16, 48, 128, 512]) {
  const buffer = await canvasImage({
    src: iconSource,
    width: size,
    height: size,
    crop: sourceBox,
    inset: size / 8,
  });
  const name = `icon${size}.png`;
  await fs.writeFile(path.join(root, name), buffer);
  outputs.push(name);
}

for (const [master, name, width, height] of [
  ["marquee-generated.png", "marquee-promo-1400x560.png", 1400, 560],
  ["small-promo-generated.png", "small-promo-440x280.png", 440, 280],
]) {
  const buffer = await canvasImage({
    src: await source(master),
    width,
    height,
  });
  const rgba = PNG.sync.read(buffer);
  const rgb = PNG.sync.write(rgba, { colorType: 2, inputHasAlpha: true });
  await fs.writeFile(path.join(root, name), rgb);
  outputs.push(name);
}

// Context preview only. This is not a Chrome Web Store upload asset.
await page.setViewportSize({ width: 600, height: 300 });
const previewIcon = (
  await fs.readFile(path.join(root, "icon128.png"))
).toString("base64");
await page.setContent(
  `<!doctype html><style>*{box-sizing:border-box}body{margin:0;font:14px system-ui;display:flex}section{width:300px;height:300px;display:grid;place-content:center;text-align:center;gap:16px;background:#faf9ff;color:#312846}section+section{background:#211a30;color:#eee7ff}img{width:128px;height:128px;display:block;margin:auto}p{margin:0}</style><section><img src="data:image/png;base64,${previewIcon}" alt="Capture Studio icon"><p>Light background</p></section><section><img src="data:image/png;base64,${previewIcon}" alt="Capture Studio icon"><p>Dark background</p></section>`,
);
await page.screenshot({ path: path.join(root, "icon-context-preview.png") });
await browser.close();

const report = [];
for (const name of outputs) {
  const buffer = await fs.readFile(path.join(root, name));
  const image = PNG.sync.read(buffer);
  const colorType = buffer[25];
  let alphaBounds = null;
  if (colorType === 6) {
    let minX = image.width,
      minY = image.height,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3] > 0) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    alphaBounds = [minX, minY, maxX, maxY];
  }
  report.push({
    name,
    width: image.width,
    height: image.height,
    bitDepth: buffer[24],
    colorType,
    alphaBounds,
    bytes: buffer.length,
  });
}
await fs.writeFile(
  path.join(root, "asset-validation.json"),
  JSON.stringify({ iconSourceBox: sourceBox, outputs: report }, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
