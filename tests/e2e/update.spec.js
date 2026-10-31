import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir } from "node:fs/promises";

async function importImage(page, width = 1200, height = 750) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  await page.locator("#image-input").setInputFiles({
    name: "Preview.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(png),
  });
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#editor-view")).toBeVisible();
}
async function exported(page) {
  const pending = page.waitForEvent("download");
  await page.locator("#export-button").click();
  return readFile(await (await pending).path());
}
function pixel(png, x, y) {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [...png.data.subarray(i, i + 3)];
}
async function capture(studio, bars = "smart", mode = "full") {
  const { context, origin } = studio;
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/dashboard");
  const before = await source.evaluate(() => {
    const shell = document.createElement("div");
    shell.style.cssText =
      "position:absolute;top:0;left:0;width:100%;height:80px;overflow:hidden";
    document.body.append(shell);
    shell.append(
      document.querySelector("#sidebar"),
      document.querySelector("#footer"),
    );
    document.querySelector("#nested").style.cssText =
      "position:absolute;left:1100px;top:1400px;width:200px;height:1200px;transform:none;scale:.5;transform-origin:top left;margin:0";
    document.querySelector("#local-fixed").style.cssText =
      "top:100px;left:0;width:100px;height:40px";
    const drawer = document.createElement("div");
    drawer.id = "closed-drawer";
    drawer.style.cssText =
      "position:fixed;right:0;top:0;width:200px;height:100vh;transform:translateX(100%);background:red";
    document.body.append(drawer);
    document
      .querySelector("#footer")
      .style.setProperty("margin-top", "13px", "important");
    const r = document.querySelector("#sticky-child").getBoundingClientRect();
    const initial = {
      height: document.documentElement.scrollHeight,
      child: { x: r.left + r.width / 2, y: r.top + scrollY + r.height / 2 },
    };
    // Record normal-flow geometry before scroll handlers pin and remove the dynamic header.
    scrollTo({ top: 286, behavior: "instant" });
    return initial;
  });
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const pending = context.waitForEvent("page");
  pending.catch(() => {});
  const response = await popup.evaluate(
    ({ bars, mode }) =>
      chrome.runtime.sendMessage({ type: "CS_START", mode, bars }),
    { bars, mode },
  );
  expect(response.ok).toBe(true);
  await expect
    .poll(
      async () => {
        const state = await popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        );
        if (state.phase === "error") throw new Error(state.message);
        return state.phase;
      },
      { timeout: 20000 },
    )
    .toBe("done");
  const editor = await pending;
  await editor.waitForURL(`${origin}/app.html#*`);
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect.poll(() => source.evaluate(() => scrollY)).toBe(286);
  return { source, editor, before };
}
test("smart bars belong at document edges, preserve transforms, and restore original styles", async ({
  studio,
}) => {
  const { source, editor, before } = await capture(studio);
  const png = PNG.sync.read(await exported(editor));
  expect(png.width).toBe(1440);
  expect(png.height).toBe(before.height);
  expect(pixel(png, 600, 25)).toEqual([18, 59, 124]);
  expect(pixel(png, 600, png.height - 15)).toEqual([214, 73, 140]);
  expect(pixel(png, 5, png.height - 100)).toEqual([36, 53, 42]);
  expect(pixel(png, before.child.x, before.child.y)).toEqual([118, 51, 188]);
  expect(pixel(png, 1120, 1455)).toEqual([175, 78, 16]);
  const pink = [],
    dynamic = [],
    green = [],
    local = [];
  for (let y = 0; y < png.height; y++) {
    if (pixel(png, 600, y).join() === "214,73,140") pink.push(y);
    if (pixel(png, 600, y).join() === "185,182,254") dynamic.push(y);
    if (pixel(png, 1370, y).join() === "46,164,79") green.push(y);
    if (pixel(png, 1120, y).join() === "175,78,16") local.push(y);
  }
  expect(pink).toHaveLength(54);
  expect(Math.min(...pink)).toBe(png.height - 54);
  expect(dynamic).toHaveLength(50);
  expect(Math.min(...dynamic)).toBe(100);
  expect(green).toHaveLength(50);
  expect(local).toHaveLength(20);
  expect(Math.min(...local)).toBe(1450);
  expect(
    await source
      .locator("#footer")
      .evaluate((node) => [
        node.style.getPropertyValue("margin-top"),
        node.style.getPropertyPriority("margin-top"),
        getComputedStyle(node).position,
      ]),
  ).toEqual(["13px", "important", "fixed"]);
  expect(
    await source
      .locator("#sticky")
      .evaluate((node) => getComputedStyle(node).position),
  ).toBe("sticky");
  expect(
    await source
      .locator("#transformed-widget")
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBe(50);
  expect(
    await source
      .locator("#closed-drawer")
      .evaluate((node) => node.getBoundingClientRect().left),
  ).toBe(1440);
  await mkdir("artifacts", { recursive: true });
  await editor.screenshot({ path: "artifacts/sticky-bars-fixed.png" });
});
test("CSS variable shorthands and unrelated page style changes survive capture restoration", async ({
  studio,
}) => {
  const { context, origin } = studio;
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/dashboard");
  await source.evaluate(() => {
    const node = document.createElement("div");
    node.id = "variable-widget";
    node.style.cssText =
      'position:fixed;--gap:13px;--pins:200px 20px auto auto;--label:"semi;colon:(){}";margin:var(--gap) 0 0 0!important;inset:var(--pins)!important;width:40px;height:40px;color:rgb(1,2,3)';
    document.body.append(node);
  });
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const id = await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    return tab.id;
  });
  expect(
    (
      await popup.evaluate(
        (id) =>
          chrome.tabs.sendMessage(id, {
            type: "CS_PAGE_PREPARE",
            mode: "full",
          }),
        id,
      )
    ).ok,
  ).toBe(true);
  await source.locator("#variable-widget").evaluate((node) => {
    node.style.color = "rgb(9, 8, 7)";
  });
  await popup.evaluate(
    (id) => chrome.tabs.sendMessage(id, { type: "CS_PAGE_RESTORE" }),
    id,
  );
  const result = await source.locator("#variable-widget").evaluate((node) => ({
    margin: node.style.getPropertyValue("margin"),
    priority: node.style.getPropertyPriority("margin"),
    inset: node.style.getPropertyValue("inset"),
    top: getComputedStyle(node).marginTop,
    color: node.style.color,
    label: node.style.getPropertyValue("--label"),
  }));
  expect(result).toEqual({
    margin: "var(--gap) 0 0 0",
    priority: "important",
    inset: "var(--pins)",
    top: "13px",
    color: "rgb(9, 8, 7)",
    label: '"semi;colon:(){}"',
  });
});
test("fixed bars can be hidden for a full-page capture while viewport captures keep them", async ({
  studio,
}) => {
  const hidden = await capture(studio, "hide");
  const png = PNG.sync.read(await exported(hidden.editor));
  expect(pixel(png, 600, 25)).toEqual([255, 255, 255]);
  expect(pixel(png, 600, png.height - 15)).toEqual([255, 255, 255]);
  const visible = await capture(studio, "smart", "visible");
  const viewport = PNG.sync.read(await exported(visible.editor));
  expect(viewport.height).toBe(960);
  expect(pixel(viewport, 600, viewport.height - 15)).toEqual([214, 73, 140]);
});
test("a delayed scroll-triggered header cannot clamp away the final image rows", async ({
  studio,
}) => {
  const { context, origin } = studio;
  const source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.setContent(
    '<style>*{box-sizing:border-box}body{margin:0}header{height:60px;background:#293f78}body.pinned header{position:fixed;top:0;left:0;right:0}main{height:1400px;background:white;padding-top:1320px}footer{height:80px;background:rgb(230,119,72)}aside{position:fixed;bottom:0;left:1100px;width:100px;height:16px;background:rgb(214,73,140)}</style><header></header><main><footer></footer></main><aside></aside><script>let timer;addEventListener("scroll",()=>{clearTimeout(timer);timer=setTimeout(()=>document.body.classList.toggle("pinned",scrollY>100),150)})</script>',
  );
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup.html`);
  await source.bringToFront();
  const pending = context.waitForEvent("page");
  await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "full" }),
  );
  const editor = await pending;
  await editor.waitForURL(`${origin}/app.html#*`);
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const png = PNG.sync.read(await exported(editor));
  expect(png.height).toBe(1460);
  expect(pixel(png, 600, 1445)).toEqual([230, 119, 72]);
  expect(pixel(png, 1120, 1450)).toEqual([214, 73, 140]);
  let footerRows = 0;
  for (let y = 0; y < png.height; y++)
    if (pixel(png, 1120, y).join() === "214,73,140") footerRows++;
  expect(footerRows).toBe(16);
});
test("native preview and context menus copy flattened full-resolution images across edits", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await importImage(page);
  await page.getByRole("button", { name: "Redact", exact: true }).click();
  const box = await page.locator("#overlay-canvas").boundingBox();
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 140);
  await page.mouse.up();
  await expect(page.locator("#save-state")).toHaveText("Saved locally");
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
      pixel: [...ctx.getImageData(150, 130, 1, 1).data],
      nativeContext: !img.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    };
  });
  expect(preview.width).toBe(1200);
  expect(preview.pixel).toEqual([17, 17, 17, 255]);
  expect(preview.nativeContext).toBe(false);
  await page.locator("#rotate-button").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#preview-image")).toBeVisible();
  await page.locator("#undo-button").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#preview-image")).toBeVisible();
  await page.locator("#preview-image").focus();
  await page.keyboard.press("Control+c");
  await expect(page.locator("#toast")).toHaveText("Image copied to clipboard.");
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page
    .locator("#overlay-canvas")
    .click({ button: "right", position: { x: 10, y: 10 } });
  await expect(page.locator("#image-menu")).toBeVisible();
  await page.locator("#menu-copy-image").click();
  await expect(page.locator("#toast")).toHaveText("Image copied to clipboard.");
  await page.locator("#home-button").click();
  await page.locator(".card-preview img").click({ button: "right" });
  const pending = page.waitForEvent("download");
  await page.locator("#menu-save-image").click();
  const full = PNG.sync.read(await readFile(await (await pending).path()));
  expect(full.width).toBe(1200);
  expect(pixel(full, 150, 130)).toEqual([17, 17, 17]);
  expect(errors).toEqual([]);
});
test("PDF paper recommendations, orientation and continuous pages match the exported media boxes", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await importImage(page, 1200, 650);
  await page.locator('[data-format="pdf"]').click();
  await expect(page.locator("#pdf-size option")).toHaveCount(15);
  await expect(page.locator("#pdf-layout-summary")).toContainText(
    /Recommended: .+ · landscape · 1 page/,
  );
  for (const [size, orientation, dimensions] of [
    ["legal", "portrait", [612, 1008]],
    ["a3", "landscape", [1190.551181, 841.889764]],
    ["photo4x6", "portrait", [288, 432]],
  ]) {
    await page.locator("#pdf-size").selectOption(size);
    await page.locator("#pdf-orientation").selectOption(orientation);
    const pdf = await PDFDocument.load(await exported(page));
    const [width, height] = pdf.getPage(0).getSize
      ? [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()]
      : [];
    expect(width).toBeCloseTo(dimensions[0], 3);
    expect(height).toBeCloseTo(dimensions[1], 3);
    const count = await page.locator("#pdf-layout-summary").innerText();
    expect(count).toContain(`${pdf.getPageCount()} page`);
  }
  await page.locator("#pdf-size").selectOption("image");
  await expect(page.locator("#pdf-orientation")).toBeDisabled();
  const continuous = await PDFDocument.load(await exported(page));
  expect(continuous.getPageCount()).toBe(1);
  expect(continuous.getPage(0).getWidth()).toBe(948);
  expect(continuous.getPage(0).getHeight()).toBe(535.5);
  await page.locator("#pdf-size").selectOption("auto");
  await page.locator("#pdf-orientation").selectOption("auto");
  await page.screenshot({ path: "artifacts/pdf-paper-options.png" });
  expect(errors).toEqual([]);
});
