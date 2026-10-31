import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import AxeBuilder from "@axe-core/playwright";
import {
  openImage,
  ready,
  saved,
  seed,
  crop,
  selectText,
  change,
  exportFile,
  pixel,
  addText,
  drag,
} from "./editor-helpers.js";

async function legacyReference(page, annotation, width, height) {
  return Buffer.from(
    await page.evaluate(
      ({ a, width, height }) => {
        const c = document.createElement("canvas");
        c.width = width;
        c.height = height;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "rgb(35,90,140)";
        ctx.fillRect(0, 0, width, height);
        if (a.transform) ctx.transform(...a.transform);
        ctx.translate(a.x, a.y);
        ctx.rotate(((a.rotation || 0) * Math.PI) / 180);
        ctx.font = `600 ${a.fontSize || 28}px system-ui, sans-serif`;
        ctx.textBaseline = "top";
        const lineHeight = (a.fontSize || 28) * 1.3;
        for (const [i, line] of a.text.split("\n").entries()) {
          ctx.fillStyle = a.background || "#ffffff";
          ctx.fillRect(
            -5,
            i * lineHeight - 3,
            ctx.measureText(line).width + 10,
            lineHeight,
          );
          ctx.fillStyle = a.color;
          ctx.fillText(line, 0, i * lineHeight);
        }
        return c.toDataURL().split(",")[1];
      },
      { a: annotation, width, height },
    ),
    "base64",
  );
}

for (const operation of ["crop", "redo"])
  test(`${operation} saves before a delayed native preview so reload cannot lose the edit`, async ({
    studio,
  }) => {
    const { page, errors } = studio;
    await openImage(page);
    if (operation === "redo") {
      await crop(page, { x: 20, y: 30, width: 200, height: 150 });
      await page.locator("#undo-button").click();
      await ready(page);
    } else await crop(page, { x: 20, y: 30, width: 200, height: 150 }, false);
    await page.evaluate(() => {
      const native = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function (...args) {
        if (this.src.startsWith("blob:") && !window.editorPreviewHeld) {
          window.editorPreviewHeld = true;
          await new Promise((resolve) => {
            window.editorReleasePreview = resolve;
          });
        }
        return native.apply(this, args);
      };
    });
    await page
      .locator(operation === "crop" ? "#crop-apply" : "#redo-button")
      .click();
    await expect
      .poll(() => page.evaluate(() => Boolean(window.editorPreviewHeld)))
      .toBe(true);
    await expect
      .poll(async () => (await saved(page)).images[0].width)
      .toBe(200);
    await expect(page.locator("#save-state")).toHaveText("Saved locally");
    await page.reload();
    await ready(page);
    await expect(page.locator("#canvas-dimensions")).toHaveText("200 × 150 px");
    expect(errors).toEqual([]);
  });

test("legacy single-line text preserves exact pixels and glyph positions through color-only edits and rotation", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await seed(page, [
    {
      type: "text",
      x: 80,
      y: 70,
      text: "Legacy single line",
      fontSize: 28,
      color: "#7955e8",
    },
  ]);
  let a = (await saved(page)).images[0].annotations[0];
  let actual = PNG.sync.read((await exportFile(page)).bytes),
    expected = PNG.sync.read(await legacyReference(page, a, 800, 600));
  expect(actual.data.equals(expected.data)).toBe(true);
  await selectText(page);
  await change(page, "annotation-color", "#ff0000");
  a = (await saved(page)).images[0].annotations[0];
  expect(a.boxWidth).toBeUndefined();
  expect([a.x, a.y]).toEqual([80, 70]);
  actual = PNG.sync.read((await exportFile(page)).bytes);
  expected = PNG.sync.read(await legacyReference(page, a, 800, 600));
  expect(actual.data.equals(expected.data)).toBe(true);
  await page.locator("#rotate-button").click();
  await ready(page);
  await selectText(page);
  await change(page, "annotation-color", "#008000");
  a = (await saved(page)).images[0].annotations[0];
  expect(a.boxWidth).toBeUndefined();
  actual = PNG.sync.read((await exportFile(page)).bytes);
  expected = PNG.sync.read(await legacyReference(page, a, 600, 800));
  expect(actual.data.equals(expected.data)).toBe(true);
  await change(page, "text-box-width", 350);
  expect((await saved(page)).images[0].annotations[0].legacyBox).toBe(true);
  expect(errors).toEqual([]);
});

test("fractional legacy crops preserve raster-scaled text alignment and every previously redacted pixel", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page, 100, 100);
  await seed(
    page,
    [
      { type: "text", x: 15, y: 30, text: "X", fontSize: 8, color: "#ff0000" },
      { type: "redact", rect: { x: 10, y: 10, width: 10, height: 10 } },
    ],
    { x: 4.2, y: 7.1, width: 50.6, height: 40.4 },
  );
  const before = PNG.sync.read((await exportFile(page)).bytes);
  expect([before.width, before.height]).toEqual([51, 40]);
  await page.locator("#rotate-button").click();
  await ready(page);
  const out = PNG.sync.read((await exportFile(page)).bytes);
  expect([out.width, out.height]).toEqual([40, 51]);
  let covered = 0;
  for (let y = 0; y < before.height; y++)
    for (let x = 0; x < before.width; x++)
      if (pixel(before, x, y).every((v, i) => v === [17, 17, 17, 255][i])) {
        covered++;
        expect(pixel(out, before.height - 1 - y, x)).toEqual([17, 17, 17, 255]);
      }
  expect(covered).toBeGreaterThan(50);
  const a = (await saved(page)).images[0].annotations[0],
    m = a.transform;
  const origin = {
    x: m[0] * a.x + m[2] * a.y + m[4],
    y: m[1] * a.x + m[3] * a.y + m[5],
  };
  expect(origin.x).toBeCloseTo(40 - ((30 - 7.1) * 40) / 40.4, 7);
  expect(origin.y).toBeCloseTo(((15 - 4.2) * 51) / 50.6, 7);
  await selectText(page);
  await page.locator("#overlay-canvas").focus();
  await page.keyboard.press("ArrowRight");
  await ready(page);
  const moved = (await saved(page)).images[0].annotations[0];
  expect(
    moved.transform[0] * moved.x +
      moved.transform[2] * moved.y +
      moved.transform[4],
  ).toBeCloseTo(origin.x + 1, 6);
  expect(errors).toEqual([]);
});

test("a real browser capture can be cropped after capture with exact source pixels and undo", async ({
  studio,
}) => {
  const { page, context, origin } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const pending = context.waitForEvent("page", {
    predicate: (p) => p !== page && p !== source && p !== popup,
  });
  const response = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "visible" }),
  );
  expect(response.ok).toBe(true);
  const editor = await pending;
  await editor.waitForURL(`${origin}/app.html#*`);
  await ready(editor);
  const before = PNG.sync.read((await exportFile(editor)).bytes);
  await crop(editor, { x: 20, y: 35, width: 230, height: 140 });
  const after = PNG.sync.read((await exportFile(editor)).bytes);
  expect([after.width, after.height]).toEqual([230, 140]);
  for (let y = 0; y < 140; y++)
    expect(
      after.data
        .subarray(y * 230 * 4, (y + 1) * 230 * 4)
        .equals(
          before.data.subarray(
            ((y + 35) * before.width + 20) * 4,
            ((y + 35) * before.width + 250) * 4,
          ),
        ),
    ).toBe(true);
  await editor.locator("#undo-button").click();
  await ready(editor);
  await expect(editor.locator("#canvas-dimensions")).toHaveText(
    `${before.width.toLocaleString()} × ${before.height.toLocaleString()} px`,
  );
});

test("failed crop encoding releases allocated canvases, leaves the original untouched and can be retried", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const before = await saved(page);
  await crop(page, { x: 20, y: 30, width: 200, height: 150 }, false);
  await page.evaluate(() => {
    const native = HTMLCanvasElement.prototype.toBlob;
    window.editorNativeToBlob = native;
    window.editorFailedCanvases = [];
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (
        this.width === 200 &&
        this.height === 150 &&
        !window.editorFailedCanvases.length
      ) {
        window.editorFailedCanvases.push(this);
        queueMicrotask(() => callback(null));
      } else return native.call(this, callback, ...args);
    };
  });
  await page.locator("#crop-apply").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("could not encode");
  expect(await saved(page)).toEqual(before);
  await expect(page.locator("#undo-button")).toBeDisabled();
  expect(
    await page.evaluate(() =>
      window.editorFailedCanvases.map((c) => [c.width, c.height]),
    ),
  ).toEqual([[1, 1]]);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = window.editorNativeToBlob;
  });
  expect(errors.join(" ")).toContain("could not encode");
  errors.length = 0;
  await page.locator("#crop-apply").click();
  await ready(page);
  await expect(page.locator("#canvas-dimensions")).toHaveText("200 × 150 px");
  expect(errors).toEqual([]);
});

for (const width of [640, 1100])
  test.describe(`responsive text editing at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, deviceScaleFactor: 1.5 });
    test("zoomed text handles and wrapped controls stay usable without page overflow", async ({
      studio,
    }) => {
      const { page, errors } = studio;
      await openImage(page);
      const a = await addText(page, "Resize this box");
      await page.locator("#zoom-out").click();
      await page.locator("#zoom-out").click();
      await drag(
        page,
        { x: a.x + 25, y: a.y + 20 },
        { x: a.x + 65, y: a.y + 30 },
      );
      await ready(page);
      const moved = (await saved(page)).images[0].annotations[0];
      expect(moved.x).toBeCloseTo(a.x + 40, 1);
      expect(moved.y).toBeCloseTo(a.y + 10, 1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await change(page, "text-box-width", 180);
      await change(page, "text-background", "#ffe000");
      await expect(page.locator("#text-edit")).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("text properties and crop controls pass automated WCAG A/AA checks", async ({
      studio,
    }) => {
      const { page } = studio;
      await openImage(page);
      await addText(page, "Accessible text controls");
      for (const tool of ["Select text", "Crop"]) {
        await page.getByRole("button", { name: tool, exact: true }).click();
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              reason: n.failureSummary,
            })),
          })),
        ).toEqual([]);
      }
    });
  });
