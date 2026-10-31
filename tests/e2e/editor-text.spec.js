import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { textToImage } from "../../src/text-layout.js";
import {
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
} from "./editor-helpers.js";

test("placed text moves and resizes with one undo entry per gesture and survives reload", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const original = await addText(page, "Move and resize this text");
  const before = await saved(page);
  await drag(
    page,
    { x: original.x + 50, y: original.y + 20 },
    { x: original.x + 90, y: original.y + 50 },
  );
  await ready(page);
  const moved = await saved(page),
    a = moved.images[0].annotations[0];
  expect(a.x).toBeCloseTo(original.x + 40, 4);
  expect(a.y).toBeCloseTo(original.y + 30, 4);
  expect(moved.revision).toBe(before.revision + 1);
  const width = Number(await page.locator("#text-box-width").inputValue()),
    height = Number(await page.locator("#text-box-height").inputValue());
  await drag(
    page,
    { x: a.x + width, y: a.y + height },
    { x: a.x + width + 80, y: a.y + height + 30 },
  );
  await ready(page);
  const resized = (await saved(page)).images[0].annotations[0];
  expect(resized.boxWidth).toBeCloseTo(a.boxWidth + 80, 0);
  expect(resized.fontSize).toBe(original.fontSize);
  await page.locator("#undo-button").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0]).toEqual(a);
  await page.locator("#redo-button").click();
  await ready(page);
  await page.reload();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0]).toEqual(resized);
  await selectText(page);
  await expect(page.locator("#text-box-width")).toHaveValue(
    String(Math.round(resized.boxWidth)),
  );
  expect(errors).toEqual([]);
});

test("text content, color, background, transparency, font and wrapping remain editable after placement", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const original = await addText(page, "Original");
  await change(page, "annotation-color", "#ff0000");
  await change(page, "text-background", "#ffe000");
  await change(page, "font-size", 40);
  await change(page, "text-box-width", 180);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Edited words wrap\n👨‍👩‍👧‍👦 example");
  await page.locator("#text-done").click();
  await ready(page);
  const a = (await saved(page)).images[0].annotations[0];
  expect(a).toMatchObject({
    id: original.id,
    color: "#ff0000",
    background: "#ffe000",
    fontSize: 40,
    text: "Edited words wrap\n👨‍👩‍👧‍👦 example",
  });
  expect(
    Number(await page.locator("#text-box-height").inputValue()),
  ).toBeGreaterThan(100);
  let png = PNG.sync.read((await exportFile(page)).bytes);
  expect(pixel(png, Math.ceil(a.x) + 1, Math.ceil(a.y) + 1)).toEqual([
    255, 224, 0, 255,
  ]);
  expect(
    png.data.some(
      (v, i) =>
        i % 4 === 0 &&
        v === 255 &&
        png.data[i + 1] === 0 &&
        png.data[i + 2] === 0,
    ),
  ).toBe(true);
  await page.locator("#text-transparent").check();
  await ready(page);
  png = PNG.sync.read((await exportFile(page)).bytes);
  expect(pixel(png, Math.ceil(a.x) + 1, Math.ceil(a.y) + 1)).toEqual([
    35, 90, 140, 255,
  ]);
  await page.reload();
  await ready(page);
  await selectText(page);
  await expect(page.locator("#text-transparent")).toBeChecked();
  const at = await screen(page, { x: a.x + 20, y: a.y + 20 });
  await page.mouse.dblclick(at.x, at.y);
  await expect(page.locator("#inline-text-frame")).toBeVisible();
  await page.locator("#annotation-text").fill("<img src=x onerror=alert(1)>");
  await page.locator("#text-done").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].text).toBe(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Escape and pointer cancellation discard text drafts without saving or consuming undo", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const a = await addText(page);
  const before = await saved(page),
    start = await screen(page, { x: a.x + 40, y: a.y + 20 }),
    end = await screen(page, { x: a.x + 100, y: a.y + 70 });
  for (const cancel of ["Escape", "pointercancel"]) {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else
      await page
        .locator("#overlay-canvas")
        .dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
    expect(await saved(page)).toEqual(before);
  }
  await page.locator("#undo-button").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations).toEqual([]);
  expect(errors).toEqual([]);
});

test("crop preview can be adjusted or cancelled and blocks every editor copy/export route until applied", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await addText(page, "Keep this annotation", { x: 150, y: 120 });
  const before = await saved(page);
  await crop(page, { x: 100, y: 80, width: 500, height: 400 }, false);
  await expect(page.locator("#canvas-dimensions")).toHaveText("800 × 600 px");
  await expect(page.locator("#export-button")).toBeDisabled();
  await expect(page.locator("#copy-button")).toBeDisabled();
  await page.locator("#overlay-canvas").focus();
  await page.keyboard.press("Control+c");
  await expect(page.locator("#toast")).toHaveText(
    "Apply or cancel the crop before exporting or copying.",
  );
  const p = await screen(page, { x: 200, y: 150 });
  await page.mouse.click(p.x, p.y, { button: "right" });
  await expect(page.locator("#image-menu")).toBeHidden();
  expect(await saved(page)).toEqual(before);
  await page.locator("#crop-cancel").click();
  await expect(page.locator("#crop-controls")).toBeHidden();
  expect(await saved(page)).toEqual(before);
  await crop(page, { x: 100, y: 80, width: 500, height: 400 });
  await expect(page.locator("#canvas-dimensions")).toHaveText("500 × 400 px");
  expect((await saved(page)).images[0].annotations[0].type).toBe("text");
  await selectText(page);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Editable after cropping");
  await page.locator("#text-done").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].text).toBe(
    "Editable after cropping",
  );
  await page.locator("#undo-button").click();
  await ready(page);
  await page.locator("#undo-button").click();
  await ready(page);
  await expect(page.locator("#canvas-dimensions")).toHaveText("800 × 600 px");
  expect((await saved(page)).images[0].annotations).toEqual(
    before.images[0].annotations,
  );
  expect(errors).toEqual([]);
});

test("cropped and rotated text remains selectable and resizable while every redaction border stays covered", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const a = await addText(page, "Still editable", { x: 150, y: 120 });
  await seed(page, [
    a,
    { type: "redact", rect: { x: 180, y: 160, width: 80, height: 40 } },
  ]);
  await crop(page, { x: 100, y: 80, width: 600, height: 400 });
  await page.locator("#rotate-button").click();
  await ready(page);
  await expect(page.locator("#canvas-dimensions")).toHaveText("400 × 600 px");
  await selectText(page);
  const current = (await saved(page)).images[0].annotations[0];
  const w = Number(await page.locator("#text-box-width").inputValue()),
    h = Number(await page.locator("#text-box-height").inputValue());
  const from = textToImage(current, { x: w, y: h }),
    to = textToImage(current, { x: w + 50, y: h + 20 });
  await drag(page, from, to);
  await ready(page);
  await change(page, "annotation-color", "#ff0000");
  await page.reload();
  await ready(page);
  await selectText(page);
  expect((await saved(page)).images[0].annotations[0].boxWidth).toBeCloseTo(
    a.boxWidth + 50,
    0,
  );
  const png = PNG.sync.read((await exportFile(page)).bytes);
  for (const [x, y] of [
    [279, 80],
    [279, 160],
    [319, 80],
    [319, 160],
    [300, 120],
  ])
    expect(pixel(png, x, y)).toEqual([17, 17, 17, 255]);
  expect(errors).toEqual([]);
});

test("keyboard selection, movement, editing, deletion and undo work without pointer selection", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const a = await addText(page);
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await page.locator("#preview-image").focus();
  await page.keyboard.press("s");
  await page.locator("#text-object-select").selectOption("0");
  await page.locator("#overlay-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await ready(page);
  const moved = (await saved(page)).images[0].annotations[0];
  expect(moved.x).toBe(a.x + 1);
  expect(moved.y).toBe(a.y + 10);
  await page.keyboard.press("Enter");
  await expect(page.locator("#inline-text-frame")).toBeVisible();
  await page.locator("#annotation-text").fill("Keyboard edited");
  await page.locator("#text-done").click();
  await ready(page);
  await page.locator("#overlay-canvas").focus();
  await page.keyboard.press("Delete");
  await ready(page);
  expect((await saved(page)).images[0].annotations).toEqual([]);
  await page.keyboard.press("Control+z");
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].text).toBe(
    "Keyboard edited",
  );
  expect(errors).toEqual([]);
});

test("inline drafts commit to their original capture before navigation", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const first = (await saved(page)).id;
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const p = await screen(page, { x: 100, y: 100 });
  await page.mouse.click(p.x, p.y);
  await page
    .locator("#annotation-text")
    .fill("Do not move this draft to another capture");
  await page.evaluate(() => {
    location.hash = "";
  });
  await expect(page.locator("#home-view")).toBeVisible();
  await expect(page.locator("#inline-text-frame")).toBeHidden();
  await openImage(page, 500, 400);
  expect((await saved(page)).images[0].annotations).toEqual([]);
  expect((await saved(page, first)).images[0].annotations[0].text).toBe(
    "Do not move this draft to another capture",
  );
  expect(errors).toEqual([]);
});

for (const format of ["png", "jpeg", "webp", "pdf"])
  test(`styled text and redactions flatten correctly into one ${format} file`, async ({
    studio,
  }) => {
    const { page, errors } = studio;
    await openImage(page);
    const a = await addText(page, "Exported text", { x: 100, y: 100 });
    await change(page, "text-background", "#ffe000");
    await change(page, "annotation-color", "#ff0000");
    const styled = (await saved(page)).images[0].annotations[0];
    await seed(page, [
      styled,
      { type: "redact", rect: { x: 110, y: 110, width: 100, height: 30 } },
    ]);
    if (format === "pdf") {
      await page.locator('[data-format="pdf"]').click();
      await page.locator("#pdf-size").selectOption("image");
    }
    const out = await exportFile(page, format);
    let raster = out.bytes;
    if (format === "pdf") {
      const pdf = await PDFDocument.load(out.bytes);
      expect(pdf.getPageCount()).toBe(1);
      const embedded = pdf.context
        .enumerateIndirectObjects()
        .map(([, o]) => o)
        .filter(
          (o) =>
            o instanceof PDFRawStream &&
            o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
        );
      expect(embedded).toHaveLength(1);
      raster = Buffer.from(embedded[0].contents);
    }
    const decoded = await decode(
      page,
      raster,
      format === "pdf" ? "image/jpeg" : `image/${format}`,
      [
        [Math.ceil(a.x) + 1, Math.ceil(a.y) + 1],
        [140, 120],
      ],
    );
    expect([decoded.width, decoded.height]).toEqual([800, 600]);
    for (let c = 0; c < 3; c++)
      expect(
        Math.abs(decoded.pixels[0][c] - [255, 224, 0][c]),
      ).toBeLessThanOrEqual(format === "png" ? 0 : 30);
    for (const c of decoded.pixels[1].slice(0, 3))
      expect(Math.abs(c - 17)).toBeLessThanOrEqual(format === "png" ? 0 : 10);
    expect(out.name).toMatch(
      new RegExp(`\\.${format === "jpeg" ? "jpg" : format}$`),
    );
    expect(errors).toEqual([]);
  });
