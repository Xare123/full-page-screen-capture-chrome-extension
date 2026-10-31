import { test, expect } from "./fixtures.js";
import { openImage, ready, seed } from "./editor-helpers.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
test("whiteboard presentation masks private content before and after each reveal", async ({
  studio,
}) => {
  const { page } = studio;
  await page.locator("#nav-whiteboards").click();
  await page
    .getByRole("button", { name: "Create whiteboard", exact: true })
    .click();
  await ready(page);
  await seed(page, [
    {
      type: "text",
      text: "PRIVATE CARD",
      x: 40,
      y: 40,
      layoutVersion: 2,
      fontSize: 32,
      boxWidth: 400,
      color: "#000000",
      background: "transparent",
    },
    { type: "redact", rect: { x: 20, y: 20, width: 500, height: 150 } },
  ]);
  await page
    .getByRole("button", { name: "Present board", exact: true })
    .click();
  await expect(page.locator(".board-presenter")).toBeVisible();
  const pixel = () =>
    page
      .locator(".board-presenter canvas")
      .evaluate((c) => [...c.getContext("2d").getImageData(80, 80, 1, 1).data]);
  expect(await pixel()).toEqual([17, 17, 17, 255]);
  await page.getByRole("button", { name: "Next reveal", exact: true }).click();
  await expect(page.locator(".board-presenter [role=status]")).toContainText(
    "Reveal 1 / 1",
  );
  expect(await pixel()).toEqual([17, 17, 17, 255]);
  await page
    .getByRole("button", { name: "Close presentation", exact: true })
    .click();
});
test("cancelled OCR initialization stops its worker and permits a fresh retry", async ({
  studio,
}) => {
  const { page, context } = studio;
  await openImage(page);
  await page.getByRole("button", { name: "Extract text", exact: true }).click();
  const started = page.waitForEvent("worker");
  await page
    .locator("#ocr-dialog")
    .getByRole("button", { name: "Extract text", exact: true })
    .click();
  const worker = await started,
    closed = new Promise((resolve) => worker.once("close", resolve));
  await page
    .getByRole("button", { name: "Cancel recognition", exact: true })
    .click();
  await closed;
  await expect(
    page
      .locator("#ocr-dialog")
      .getByRole("button", { name: "Extract text", exact: true }),
  ).toBeEnabled();
  await page
    .locator("#ocr-dialog")
    .getByRole("button", { name: "Extract text", exact: true })
    .click();
  await expect(page.locator("#ocr-dialog [role=status]")).toContainText(
    "Ready",
    { timeout: 30000 },
  );
});
test("a corrupt local OCR model fails cleanly instead of leaving recognition busy", async ({
  studio,
}) => {
  const { page, extension } = studio;
  await writeFile(
    join(extension, "ocr/models/eng.traineddata.gz"),
    new Uint8Array([1, 2, 3, 4]),
  );
  await openImage(page);
  await page.getByRole("button", { name: "Extract text", exact: true }).click();
  await page
    .locator("#ocr-dialog")
    .getByRole("button", { name: "Extract text", exact: true })
    .click();
  await expect(
    page
      .locator("#ocr-dialog")
      .getByRole("button", { name: "Extract text", exact: true }),
  ).toBeEnabled({ timeout: 35000 });
  await expect(page.locator("#ocr-dialog [role=status]")).not.toHaveText("");
  expect(await page.locator("#ocr-result").inputValue()).toBe("");
});

test("popup keeps capture, recording and page-tool actions accessible within its normal height", async ({
  studio,
}) => {
  const popup = await studio.context.newPage();
  await popup.setViewportSize({ width: 354, height: 600 });
  await popup.goto(`${studio.origin}/popup.html`);
  await expect(popup.locator("#open-page-tools")).toBeInViewport();
  await expect(popup.locator("#open-recordings")).toBeInViewport();
  expect(
    await popup.evaluate(() => document.documentElement.scrollHeight),
  ).toBeLessThanOrEqual(600);
  await popup.getByText("Capture options", { exact: true }).click();
  await expect(popup.locator("#capture-target")).toBeVisible();
  await expect(popup.locator("#capture-clean")).toBeVisible();
});
