import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";

async function openImage(page) {
  const image = new PNG({ width: 400, height: 300 });
  image.data.fill(255);
  await page.locator("#image-input").setInputFiles({
    name: "Context actions.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(image),
  });
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
}

async function rightButtonRelease(page, target) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
}

async function canvasMenu(page) {
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await rightButtonRelease(page, page.locator("#overlay-canvas"));
  await expect(page.locator("#image-menu")).toBeVisible();
}

test("canvas context menu stays open after the same right-button release without drawing an annotation", async ({
  studio,
}) => {
  const { page } = studio;
  await openImage(page);
  await canvasMenu(page);
  await expect(page.locator("#menu-copy-image")).toBeFocused();
  await expect(page.locator("#menu-save-image")).toBeVisible();
  await expect(page.locator("#menu-open-capture")).toBeHidden();
  await expect(page.locator("#undo-button")).toBeDisabled();
  expect(
    await page
      .locator("#image-menu")
      .evaluate((node) => node.matches(":popover-open")),
  ).toBe(true);
  expect(studio.errors).toEqual([]);
});

test("canvas menu supports arrow, Home and End navigation, Escape focus restoration and Tab dismissal", async ({
  studio,
}) => {
  const { page } = studio;
  await openImage(page);
  await canvasMenu(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#menu-save-image")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#menu-copy-image")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#menu-save-image")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator("#menu-copy-image")).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator("#menu-save-image")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#image-menu")).toBeHidden();
  await expect(page.locator("#overlay-canvas")).toBeFocused();
  await canvasMenu(page);
  await page.keyboard.press("Tab");
  await expect(page.locator("#image-menu")).toBeHidden();
  expect(
    await page
      .locator("#image-menu")
      .evaluate((node) => node.contains(document.activeElement)),
  ).toBe(false);
  await canvasMenu(page);
  await page.evaluate(() => {
    location.hash = "";
  });
  await expect(page.locator("#home-view")).toBeVisible();
  await expect(page.locator("#image-menu")).toBeHidden();
  expect(studio.errors).toEqual([]);
});

test("outside pointer click dismisses the image menu and activates the clicked annotation tool", async ({
  studio,
}) => {
  const { page } = studio;
  await openImage(page);
  await canvasMenu(page);
  const ellipse = page.getByRole("button", { name: "Ellipse", exact: true });
  await ellipse.click();
  await expect(page.locator("#image-menu")).toBeHidden();
  await expect(ellipse).toHaveAttribute("aria-pressed", "true");
  await expect(ellipse).toBeFocused();
  await expect(page.locator("#undo-button")).toBeDisabled();
  expect(studio.errors).toEqual([]);
});

async function dropFile(page, name, type, bytes) {
  await page.evaluate(
    ({ name, type, base64 }) => {
      const dataTransfer = new DataTransfer();
      const buffer = Uint8Array.from(atob(base64), (char) =>
        char.charCodeAt(0),
      );
      dataTransfer.items.add(new File([buffer], name, { type }));
      document.getElementById("canvas-stage").dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer,
        }),
      );
    },
    { name, type, base64: bytes.toString("base64") },
  );
}

test("image and PDF file drops close an open menu before busy work or a modal transition", async ({
  studio,
}) => {
  const { page } = studio;
  await openImage(page);
  await canvasMenu(page);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.menuOriginalBitmap = original;
    let first = true;
    window.createImageBitmap = async (...args) => {
      if (first) {
        first = false;
        window.menuDropDecodeStarted = true;
        await new Promise((resolve) => {
          window.releaseMenuDropDecode = resolve;
        });
      }
      return original(...args);
    };
  });
  const dropped = new PNG({ width: 320, height: 240 });
  dropped.data.fill(255);
  await dropFile(
    page,
    "Dropped capture.png",
    "image/png",
    PNG.sync.write(dropped),
  );
  try {
    await expect
      .poll(() => page.evaluate(() => Boolean(window.menuDropDecodeStarted)))
      .toBe(true);
    await expect(page.locator("#busy-overlay")).toBeVisible();
    await expect(page.locator("#image-menu")).toBeHidden();
    expect(await page.locator(".main").evaluate((node) => node.inert)).toBe(
      true,
    );
  } finally {
    await page.evaluate(() => window.releaseMenuDropDecode?.());
  }
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#project-title")).toHaveValue("Dropped capture");
  await expect(page.locator("#canvas-dimensions")).toHaveText("320 × 240 px");
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
  await page.evaluate(() => {
    window.createImageBitmap = window.menuOriginalBitmap;
  });
  await canvasMenu(page);
  const pdf = await PDFDocument.create();
  pdf.addPage([288, 432]);
  await dropFile(
    page,
    "Dropped document.pdf",
    "application/pdf",
    Buffer.from(await pdf.save()),
  );
  await expect(page.locator("#pdf-dialog")).toBeVisible();
  await expect(page.locator("#pdf-file-name")).toHaveText(
    "Dropped document.pdf",
  );
  await expect(page.locator("#image-menu")).toBeHidden();
  await page.getByRole("button", { name: "Close PDF compressor" }).click();
  await page.locator("#home-button").click();
  await expect(page.locator(".library-card")).toHaveCount(2);
  expect(studio.errors).toEqual([]);
});

test("library menu survives right-button release, restores its card on Escape and preserves native Pan preview context actions", async ({
  studio,
}) => {
  const { page } = studio;
  await openImage(page);
  await page.locator("#home-button").click();
  const card = page.locator(".card-open");
  await expect(card).toHaveCount(1);
  await rightButtonRelease(page, page.locator(".card-preview img"));
  await expect(page.locator("#image-menu")).toBeVisible();
  await expect(page.locator("#menu-copy-image")).toBeFocused();
  await expect(page.locator("#menu-open-capture")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#image-menu")).toBeHidden();
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.getByRole("button", { name: "Pan", exact: true }).click();
  await expect(page.locator("#preview-image")).toBeVisible();
  await page.evaluate(() => {
    window.nativePreviewContextEvents = [];
    document.addEventListener("contextmenu", (event) => {
      window.nativePreviewContextEvents.push({
        target: event.target.id,
        prevented: event.defaultPrevented,
      });
    });
  });
  await rightButtonRelease(page, page.locator("#preview-image"));
  await expect(page.locator("#image-menu")).toBeHidden();
  expect(await page.evaluate(() => window.nativePreviewContextEvents)).toEqual([
    { target: "preview-image", prevented: false },
  ]);
  await page.keyboard.press("Escape");
  expect(studio.errors).toEqual([]);
});
