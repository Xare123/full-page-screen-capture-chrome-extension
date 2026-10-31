import { test, expect } from "./fixtures.js";
import { openImage, screen, ready, exportFile } from "./editor-helpers.js";
import { PNG } from "pngjs";
test("an unfinished studio redaction cannot be silently omitted by copy or export", async ({
  studio,
}) => {
  const { page } = studio;
  await openImage(page);
  await page.evaluate(() => {
    window.maskClipboardWrites = 0;
    navigator.clipboard.write = async () => {
      window.maskClipboardWrites++;
    };
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "Redact", exact: true }).click();
  const a = await screen(page, { x: 100, y: 100 }),
    b = await screen(page, { x: 300, y: 250 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y);
  await page.keyboard.press("Control+c");
  await expect(page.locator("#toast")).toContainText(
    "Finish placing the redaction",
  );
  await page.locator("#export-button").evaluate((node) => node.click());
  await expect(page.locator("#toast")).toContainText(
    "Finish placing the redaction",
  );
  expect(await page.evaluate(() => window.maskClipboardWrites)).toBe(0);
  expect(downloads).toBe(0);
  await page.mouse.up();
  await ready(page);
  const output = await exportFile(page),
    png = PNG.sync.read(output.bytes),
    at = (160 * png.width + 160) * 4;
  expect([...png.data.subarray(at, at + 4)]).toEqual([17, 17, 17, 255]);
});
