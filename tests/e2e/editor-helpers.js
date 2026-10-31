import { expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { readFile } from "node:fs/promises";

function image(width = 800, height = 600, color = [35, 90, 140, 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) png.data.set(color, i);
  return PNG.sync.write(png);
}
async function ready(page) {
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}
async function openImage(page, width = 800, height = 600) {
  await page.locator("#image-input").setInputFiles({
    name: "Editable capture.png",
    mimeType: "image/png",
    buffer: image(width, height),
  });
  await ready(page);
}
async function saved(page, id = new URL(page.url()).hash.slice(1)) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("capture-studio", 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            read = db.transaction("projects").objectStore("projects").get(id);
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            db.close();
            const p = read.result;
            resolve({
              id: p.id,
              revision: p.revision,
              images: p.images.map((i) => ({
                width: i.width,
                height: i.height,
                crop: i.crop,
                annotations: i.annotations,
              })),
            });
          };
        };
      }),
    id,
  );
}
async function seed(page, annotations, crop = null) {
  await page.evaluate(
    ({ annotations, crop }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("capture-studio", 2);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("projects", "readwrite"),
            store = tx.objectStore("projects"),
            read = store.get(location.hash.slice(1));
          read.onsuccess = () => {
            const p = read.result;
            p.images[0].annotations = annotations;
            p.images[0].crop = crop;
            store.put(p);
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { annotations, crop },
  );
  await page.reload();
  await ready(page);
}
async function screen(page, p) {
  const box = await page.locator("#overlay-canvas").boundingBox();
  const width = await page.locator("#overlay-canvas").evaluate((c) => c.width);
  const scale = box.width / width;
  return { x: box.x + p.x * scale, y: box.y + p.y * scale };
}
async function drag(page, from, to) {
  const a = await screen(page, from),
    b = await screen(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}
async function addText(page, text = "Editable text", p = { x: 60, y: 70 }) {
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const at = await screen(page, p);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#inline-text-frame")).toBeVisible();
  await page.locator("#annotation-text").fill(text);
  await page.locator("#text-done").click();
  await ready(page);
  return (await saved(page)).images[0].annotations.find(
    (a) => a.type === "text",
  );
}
async function selectText(page, index = 0) {
  await page.getByRole("button", { name: "Select text", exact: true }).click();
  await page.locator("#text-object-select").selectOption(String(index));
  await expect(page.locator("#text-edit")).toBeEnabled();
}
async function change(page, id, value) {
  if (id.includes("color") || id === "text-background")
    await page.locator("#" + id).evaluate((el, v) => {
      el.value = v;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  else {
    await page.locator("#" + id).fill(String(value));
    await page.locator("#" + id).press("Tab");
  }
  await expect(page.locator("#save-state")).toHaveText(
    (await page.locator("#inline-text-frame").isVisible())
      ? "Editing text…"
      : "Saved locally",
  );
}
async function exportFile(page, format = "png") {
  await page.locator(`[data-format="${format}"]`).click();
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  const result = await pending;
  return {
    bytes: await readFile(await result.path()),
    name: result.suggestedFilename(),
  };
}
function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [...png.data.subarray(i, i + 4)];
}
async function crop(page, rect, apply = true) {
  await page.getByRole("button", { name: "Crop", exact: true }).click();
  for (const [key, value] of Object.entries(rect))
    await change(page, "crop-" + key, value);
  if (apply) {
    await page.locator("#crop-apply").click();
    await ready(page);
  }
}
async function decode(page, bytes, mime, points) {
  return page.evaluate(
    async ({ base64, mime, points }) => {
      const blob = new Blob(
        [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
        { type: mime },
      );
      const bitmap = await createImageBitmap(blob),
        canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        width: canvas.width,
        height: canvas.height,
        pixels: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]),
      };
    },
    { base64: bytes.toString("base64"), mime, points },
  );
}

export {
  image,
  ready,
  openImage,
  saved,
  seed,
  screen,
  drag,
  addText,
  selectText,
  change,
  exportFile,
  pixel,
  crop,
  decode,
};
