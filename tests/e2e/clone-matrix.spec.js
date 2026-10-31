import { test as base, expect, chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Use the real MV3 isolated world, with a disposable source build. This suite
// can validate in-progress content changes without modifying the release dist.
const test = base.extend({
  extensionExecutablePath: [undefined, { option: true }],
  capture: async ({ extensionExecutablePath }, use) => {
    const dir = await mkdtemp(join(tmpdir(), "capture-clones-"));
    let context;
    try {
      await writeFile(
        join(dir, "manifest.json"),
        JSON.stringify({
          manifest_version: 3,
          name: "Clone cleanup regression",
          version: "1.0",
          permissions: ["scripting", "tabs"],
          host_permissions: ["<all_urls>"],
          background: { service_worker: "background.js" },
        }),
      );
      await writeFile(
        join(dir, "background.js"),
        "chrome.runtime.onInstalled.addListener(() => {});",
      );
      await writeFile(
        join(dir, "harness.html"),
        "<!doctype html><title>Capture test</title>",
      );
      await build({
        entryPoints: ["src/content.js"],
        bundle: true,
        outfile: join(dir, "content.js"),
        format: "iife",
        target: "chrome147",
      });
      context = await chromium.launchPersistentContext(join(dir, "profile"), {
        channel: "chromium",
        headless: true,
        viewport: { width: 1200, height: 800 },
        ...(extensionExecutablePath
          ? { executablePath: extensionExecutablePath }
          : {}),
        args: [
          "--no-sandbox",
          `--disable-extensions-except=${dir}`,
          `--load-extension=${dir}`,
        ],
      });
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker"));
      const harness = await context.newPage();
      await harness.goto(worker.url().replace("background.js", "harness.html"));
      const page = await context.newPage();
      await use(async (body, css = "") => {
        await page.route("**/clone-fixture", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><style>html,body{margin:0}body{height:2800px}#bar{position:fixed;left:0;top:0;width:1000px;height:40px;background:red}${css}</style>${body}`,
          }),
        );
        await page.goto("http://127.0.0.1:4173/clone-fixture");
        const tabId = await harness.evaluate(
          async () =>
            (
              await chrome.tabs.query({
                url: "http://127.0.0.1:4173/clone-fixture",
              })
            )[0].id,
        );
        await harness.evaluate(
          (tabId) =>
            chrome.scripting.executeScript({
              target: { tabId },
              files: ["content.js"],
            }),
          tabId,
        );
        const send = (type, data = {}) =>
          harness.evaluate(
            ({ tabId, type, data }) =>
              chrome.tabs.sendMessage(tabId, {
                type: `CS_PAGE_${type}`,
                ...data,
              }),
            { tabId, type, data },
          );
        return { page, send };
      });
    } finally {
      await context?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
});
const prepare = async (job) => {
  expect((await job.send("TARGET", { scope: "page" })).ok).toBe(true);
  const result = await job.send("PREPARE", { mode: "full" });
  expect(result.ok, JSON.stringify(result)).toBe(true);
};
const clean = async (page) => {
  expect(
    await page
      .locator("[data-capture-studio-owned],[data-capture-studio-paint]")
      .count(),
  ).toBe(0);
};

test("scroll-triggered fixed header clone restores its absent style attribute", async ({
  capture,
}) => {
  const job = await capture(
    `<div id="bar">Header</div><script>addEventListener('scroll',()=>{if(scrollY>500&&!window.replaced){window.replaced=true;bar.replaceWith(bar.cloneNode(true));}})</script>`,
  );
  await prepare(job);
  expect(await job.page.evaluate(() => window.replaced)).toBe(true);
  expect(
    await job.page
      .locator("#bar")
      .evaluate((n) => n.getBoundingClientRect().top),
  ).toBe(0);
  expect((await job.send("SCROLL", { x: 0, y: 1600 })).ok).toBe(true);
  await job.send("RESTORE");
  expect(await job.page.locator("#bar").getAttribute("style")).toBe(null);
  await clean(job.page);
});

test("a detached shallow clone retains ownership from an earlier placement", async ({
  capture,
}) => {
  const job = await capture('<div id="bar">Header</div>');
  await prepare(job);
  await job.send("SCROLL", { x: 0, y: 800 });
  await job.page.evaluate(() => {
    window.deferred = bar.cloneNode(false);
  });
  await job.send("SCROLL", { x: 0, y: 1600 });
  await job.page.evaluate(() => bar.replaceWith(window.deferred));
  await job.send("SCROLL", { x: 0, y: 0 });
  expect(
    await job.page
      .locator("#bar")
      .evaluate((n) => n.getBoundingClientRect().top),
  ).toBe(0);
  await job.send("RESTORE");
  expect(await job.page.locator("#bar").getAttribute("style")).toBe(null);
  await clean(job.page);
});

test("deep clones restore sticky descendants, original shorthand and custom markers", async ({
  capture,
}) => {
  const original = "margin:var(--gap);--gap:2px 4px;color:blue";
  const job = await capture(
    `<section id="wrapper"><div id="bar" style="${original}" data-capture-studio-owned="author-owned"><span id="sticky" style="position:sticky;top:3px" data-capture-studio-paint="author-paint">Sticky</span></div></section>`,
  );
  await prepare(job);
  await job.page.evaluate(() => wrapper.replaceWith(wrapper.cloneNode(true)));
  await job.send("SCROLL", { x: 0, y: 800 });
  await job.send("RESTORE");
  expect(await job.page.locator("#bar").getAttribute("style")).toBe(original);
  expect(
    await job.page.locator("#bar").getAttribute("data-capture-studio-owned"),
  ).toBe("author-owned");
  expect(await job.page.locator("#sticky").getAttribute("style")).toBe(
    "position:sticky;top:3px",
  );
  expect(
    await job.page.locator("#sticky").getAttribute("data-capture-studio-paint"),
  ).toBe("author-paint");
});

test("clone adoption preserves authored changes to owned and unrelated declarations", async ({
  capture,
}) => {
  const job = await capture(
    '<div id="bar" style="margin:2px 4px;color:blue">Header</div>',
  );
  await prepare(job);
  await job.page.evaluate(() => {
    const clone = bar.cloneNode(true);
    clone.style.setProperty("width", "777px", "important");
    clone.style.setProperty("margin-left", "19px", "important");
    clone.style.color = "green";
    bar.replaceWith(clone);
  });
  await job.send("RESTORE");
  expect(
    await job.page.locator("#bar").evaluate((n) => ({
      width: n.style.width,
      margin: [
        n.style.marginTop,
        n.style.marginRight,
        n.style.marginBottom,
        n.style.marginLeft,
      ],
      color: n.style.color,
      top: n.style.top,
    })),
  ).toEqual({
    width: "777px",
    margin: ["2px", "4px", "2px", "19px"],
    color: "green",
    top: "",
  });
  await clean(job.page);
});

test("restoration preserves authored updates on the original styled node", async ({
  capture,
}) => {
  const job = await capture(
    '<div id="bar" style="margin:var(--gap);--gap:2px">Header</div>',
  );
  await prepare(job);
  await job.page.evaluate(() => {
    bar.style.setProperty("top", "23px", "important");
    bar.style.setProperty("margin", "var(--new-gap)", "important");
    bar.style.setProperty("--new-gap", "9px");
  });
  await job.send("RESTORE");
  expect(
    await job.page.locator("#bar").evaluate((n) => ({
      top: n.style.top,
      margin: n.style.margin,
      width: n.style.width,
      gap: n.style.getPropertyValue("--new-gap"),
    })),
  ).toEqual({ top: "23px", margin: "var(--new-gap)", width: "", gap: "9px" });
  await clean(job.page);
});

test("cancellation cleans clones inserted during asynchronous preparation", async ({
  capture,
}) => {
  const job = await capture(
    `<div id="bar">Header</div><script>addEventListener('scroll',()=>{if(scrollY>500&&!window.replaced){window.replaced=true;bar.replaceWith(bar.cloneNode(true));}})</script>`,
  );
  await job.send("TARGET", { scope: "page" });
  const pending = job.send("PREPARE", { mode: "full" });
  await job.page.waitForFunction(() => window.replaced);
  await job.send("RESTORE");
  expect((await pending).ok).toBe(false);
  expect(await job.page.locator("#bar").getAttribute("style")).toBe(null);
  expect(await job.page.evaluate(() => scrollY)).toBe(0);
  await clean(job.page);
});

test("pane clones release inherited opacity and generated-paint markers", async ({
  capture,
}) => {
  const job = await capture(
    '<main id="pane"><article id="content" data-capture-studio-paint="author-paint"></article></main><aside id="overlay" data-capture-studio-owned="author-owned"></aside>',
    `html,body{height:100%;overflow:hidden}#pane{position:absolute;left:100px;top:100px;width:900px;height:600px;overflow:auto;background:white}#content{height:1800px}#content::before{content:"";display:block;position:sticky;top:0;height:2px;background:blue}#overlay{position:fixed;left:100px;top:100px;width:900px;height:10px;background:red;z-index:10}`,
  );
  expect((await job.send("TARGET", { scope: "auto" })).data.kind).toBe("pane");
  expect((await job.send("PREPARE", { mode: "full" })).ok).toBe(true);
  expect(
    await job.page.locator("#overlay").evaluate((n) => n.style.opacity),
  ).toBe("0");
  await job.page.evaluate(() => {
    const clone = content.cloneNode(true);
    clone.id = "content-clone";
    pane.append(clone);
    overlay.replaceWith(overlay.cloneNode(false));
  });
  await job.send("RESTORE");
  expect(await job.page.locator("#overlay").getAttribute("style")).toBe(null);
  expect(
    await job.page
      .locator("#overlay")
      .getAttribute("data-capture-studio-owned"),
  ).toBe("author-owned");
  expect(
    await job.page
      .locator("#content-clone")
      .getAttribute("data-capture-studio-paint"),
  ).toBe("author-paint");
  expect(
    await job.page
      .locator("#content-clone")
      .getAttribute("data-capture-studio-owned"),
  ).toBe(null);
});

test("subsequent placement retains new author dimensions, variable margins and marker values", async ({
  capture,
}) => {
  const job = await capture(
    '<div id="bar" style="margin:var(--gap);--gap:2px">Header</div>',
  );
  await prepare(job);
  await job.page.evaluate(() => {
    window.oldClone = bar.cloneNode(false);
    bar.style.setProperty("width", "777px", "important");
    bar.style.setProperty("margin", "var(--new-gap)", "important");
    bar.style.setProperty("--new-gap", "9px");
    bar.setAttribute("data-capture-studio-owned", "new-author-marker");
  });
  await job.send("SCROLL", { x: 0, y: 800 });
  await job.page.evaluate(() => {
    bar.replaceWith(bar.cloneNode(false));
    window.oldClone.id = "old-bar";
    document.body.append(window.oldClone);
  });
  await job.send("RESTORE");
  expect(
    await job.page.locator("#bar").evaluate((n) => ({
      width: n.style.width,
      margin: n.style.margin,
      gap: n.style.getPropertyValue("--new-gap"),
      marker: n.getAttribute("data-capture-studio-owned"),
    })),
  ).toEqual({
    width: "777px",
    margin: "var(--new-gap)",
    gap: "9px",
    marker: "new-author-marker",
  });
  expect(await job.page.locator("#old-bar").getAttribute("style")).toBe(
    "margin:var(--gap);--gap:2px",
  );
  expect(
    await job.page
      .locator("#old-bar")
      .getAttribute("data-capture-studio-owned"),
  ).toBe(null);
});
