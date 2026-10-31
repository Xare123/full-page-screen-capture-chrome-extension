import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
const status = (worker) =>
  worker.evaluate(
    async () =>
      (await chrome.storage.session.get("captureStatus")).captureStatus,
  );
async function start(studio, source, options) {
  await source.bringToFront();
  return studio.page.evaluate(
    (options) =>
      chrome.runtime.sendMessage({
        type: "CS_START",
        delay: 0,
        bars: "smart",
        ...options,
      }),
    options,
  );
}
async function clickAX(context, page, name) {
  const client = await context.newCDPSession(page),
    { nodes } = await client.send("Accessibility.getFullAXTree"),
    node = nodes.find(
      (n) => n.role?.value === "button" && n.name?.value === name,
    );
  expect(node, `accessible button ${name}`).toBeTruthy();
  const { object } = await client.send("DOM.resolveNode", {
    backendNodeId: node.backendDOMNodeId,
  });
  await client.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function(){this.click();}",
  });
  await client.detach();
}
test("a small element on a huge page captures independently of full-page step limits", async ({
  studio,
}) => {
  const { context, page, worker } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.setContent(
    '<style>body{margin:0;width:1440px;height:300000px;background:#fff}article{position:absolute;left:200px;top:200px;width:300px;height:200px;background:#22c55e}</style><article id="target">Element capture</article>',
  );
  await start(studio, source, { mode: "element" });
  await expect
    .poll(async () => (await status(worker))?.phase)
    .toBe("selecting");
  await source.locator("[data-capture-studio-picker=element]").waitFor();
  await source.mouse.move(300, 300);
  const opened = context.waitForEvent("page");
  await source.mouse.click(300, 300);
  const editor = await opened;
  await editor.waitForLoadState();
  await expect(editor.locator("#canvas-dimensions")).toHaveText("300 × 200 px");
  const wait = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const png = PNG.sync.read(await readFile(await (await wait).path()));
  expect([png.width, png.height]).toEqual([300, 200]);
  expect([
    ...png.data.subarray((100 * 300 + 250) * 4, (100 * 300 + 250) * 4 + 4),
  ]).toEqual([34, 197, 94, 255]);
});
test("Stop & edit crops allocated canvases to completed coverage", async ({
  studio,
}) => {
  const { context, worker, page } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.setContent(
    "<style>html,body{margin:0;width:2400px;height:4000px;background:#2563eb}</style>",
  );
  await start(studio, source, { mode: "full", scope: "page" });
  await expect
    .poll(async () => (await status(worker))?.message, {
      timeout: 15000,
      intervals: [40],
    })
    .toMatch(/^Captured 1 of/);
  const opened = context.waitForEvent("page");
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STOP" }));
  const editor = await opened;
  await expect(editor.locator("#editor-view")).toBeVisible();
  const wait = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const png = PNG.sync.read(await readFile(await (await wait).path()));
  expect(png.width).toBeGreaterThanOrEqual(1400);
  expect(png.height).toBeLessThanOrEqual(960);
  expect([...png.data.subarray(png.data.length - 4)]).toEqual([
    37, 99, 235, 255,
  ]);
  expect((await status(worker)).message).toContain("completed");
});
test("selected region edits on the page, retains one project and saves before closing", async ({
  studio,
}) => {
  const { context, page, worker, origin } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await start(studio, source, { mode: "region", inline: true });
  await expect
    .poll(async () => (await status(worker))?.phase)
    .toBe("selecting");
  await source.mouse.move(100, 150);
  await source.mouse.down();
  await source.mouse.move(600, 450);
  await source.mouse.up();
  await expect
    .poll(
      () =>
        source
          .frames()
          .find((f) => f.url().startsWith(`${origin}/app.html`))
          ?.url(),
      { timeout: 15000 },
    )
    .toContain("/app.html");
  const frame = source
    .frames()
    .find((f) => f.url().startsWith(`${origin}/app.html`));
  await expect(frame.locator("#editor-view")).toBeVisible();
  await expect(frame.locator(".sidebar")).toBeHidden();
  await frame.locator("#project-title").fill("Inline capture saved");
  await frame.locator("#project-title").press("Tab");
  await expect(frame.locator("#save-state")).toHaveText("Saved locally");
  await clickAX(context, source, "Save & close");
  await expect(source.locator("[data-capture-studio-inline]")).toHaveCount(0);
  expect(
    context.pages().filter((p) => p.url().startsWith(`${origin}/app.html`)),
  ).toHaveLength(1);
  await page.locator("#home-button").click();
  await expect(page.locator(".card-title")).toContainText(
    "Inline capture saved",
  );
});
test("website removing an embedded editor falls back to exactly one studio tab", async ({
  studio,
}) => {
  const { context, worker, origin } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.setContent(
    '<meta http-equiv="Content-Security-Policy" content="frame-src \'none\'"><h1>Protected embedding fixture</h1>',
  );
  await source.evaluate(() =>
    new MutationObserver(() => {
      document.querySelector("[data-capture-studio-inline]")?.remove();
    }).observe(document.documentElement, { childList: true, subtree: true }),
  );
  await start(studio, source, { mode: "region", inline: true });
  await expect
    .poll(async () => (await status(worker))?.phase)
    .toBe("selecting");
  await source.mouse.move(80, 120);
  await source.mouse.down();
  await source.mouse.move(480, 420);
  const opened = context.waitForEvent("page");
  await source.mouse.up();
  const editor = await opened;
  await expect(editor.locator("#editor-view")).toBeVisible();
  await expect(source.locator("[data-capture-studio-inline]")).toHaveCount(0);
  expect(
    context.pages().filter((p) => p.url().startsWith(`${origin}/app.html`)),
  ).toHaveLength(2);
});
test("page toolbar effects, drawing, native snapshot zoom and visual toggle work", async ({
  studio,
}) => {
  const { context, page, worker } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.bringToFront();
  expect(
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_PRESENT" }),
    ),
  ).toMatchObject({ ok: true });
  await expect(
    source.locator("[data-capture-studio-presentation]"),
  ).toBeVisible();
  await clickAX(context, source, "Draw");
  await source.mouse.move(500, 400);
  await source.mouse.down();
  await source.mouse.move(700, 500, { steps: 6 });
  await source.mouse.up();
  await clickAX(context, source, "More");
  await clickAX(context, source, "Spotlight");
  await clickAX(context, source, "More");
  await clickAX(context, source, "Reset effects (keep drawings)");
  await source.keyboard.press("Escape");
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_PRESENT" }));
  await expect(
    source.locator("[data-capture-studio-presentation]"),
  ).toBeHidden();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_PRESENT" }));
  await expect(
    source.locator("[data-capture-studio-presentation]"),
  ).toBeVisible();
  await clickAX(context, source, "More");
  await clickAX(context, source, "Snapshot zoom");
  await expect
    .poll(async () => {
      const client = await context.newCDPSession(source),
        { nodes } = await client.send("Accessibility.getFullAXTree");
      await client.detach();
      return nodes.some((n) => n.name?.value?.includes("Move to magnify"));
    })
    .toBeTruthy();
  await source.keyboard.press("Escape");
});
