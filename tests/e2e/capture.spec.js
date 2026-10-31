import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

test("large captures remain editable in parts and export one automatically fitted image", async ({
  studio,
}) => {
  const { context, origin } = studio;
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.evaluate(() => {
    document.body.style.minHeight = "17100px";
    document.documentElement.style.background = "#faf8f2";
    const footer = document.createElement("div");
    footer.style.cssText =
      "position:absolute;top:17000px;left:0;width:100%;height:100px;background:#006644";
    document.body.append(footer);
  });
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const pending = context.waitForEvent("page");
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "full" }),
  );
  const editor = await pending;
  await editor.waitForURL(`${origin}/app.html#*`);
  await expect(editor.locator("#part-select option")).toHaveCount(2);
  await editor.locator("#part-select").selectOption("1");
  await expect(editor.locator("#canvas-dimensions")).toHaveText(
    "1,440 × 1,100 px",
  );
  const download = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const output = await download;
  expect(output.suggestedFilename()).toMatch(/\.png$/);
  const full = PNG.sync.read(await readFile(await output.path()));
  expect([full.width, full.height]).toEqual([1347, 16000]);
  const tail = ((full.height - 1) * full.width + 300) * 4;
  expect([...full.data.subarray(tail, tail + 4)]).toEqual([0, 102, 68, 255]);
  await editor.locator("#export-scale").fill("50");
  await editor.locator("#export-scale").dispatchEvent("input");
  await expect(editor.locator("#output-dimensions")).toHaveText(
    "720 × 8,550 px",
  );
  const compressedDownload = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const compressed = PNG.sync.read(
    await readFile(await (await compressedDownload).path()),
  );
  expect([compressed.width, compressed.height]).toEqual([720, 8550]);
  const last = ((compressed.height - 1) * compressed.width + 300) * 4;
  expect([...compressed.data.subarray(last, last + 4)]).toEqual([
    0, 102, 68, 255,
  ]);
});
test.describe("High DPI", () => {
  test.use({ deviceScaleFactor: 2 });
  test("visible capture uses actual screenshot scaling", async ({ studio }) => {
    const { context, origin } = studio;
    const source = await context.newPage();
    await source.goto("http://127.0.0.1:4173/");
    const popup = await context.newPage();
    await popup.goto(`${origin}/popup.html`);
    await source.bringToFront();
    expect(await source.evaluate(() => devicePixelRatio)).toBe(2);
    const actual = await popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const data = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
        img.src = data;
      });
    });
    const pending = context.waitForEvent("page");
    await popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_START", mode: "visible" }),
    );
    const editor = await pending;
    await editor.waitForURL(`${origin}/app.html#*`);
    await expect(editor.locator("#canvas-dimensions")).toHaveText(
      `${actual[0].toLocaleString()} × ${actual[1].toLocaleString()} px`,
    );
    const download = editor.waitForEvent("download");
    await editor.locator("#export-button").click();
    const png = PNG.sync.read(await readFile(await (await download).path()));
    expect([png.width, png.height]).toEqual(actual);
  });
});
