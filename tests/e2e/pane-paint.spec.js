import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";

function pixel(image, x, y) {
  const start = (Math.round(y) * image.width + Math.round(x)) * 4;
  return [...image.data.subarray(start, start + 4)];
}
async function setup(
  studio,
  {
    kind = "fixed",
    height = 1290,
    transparent = false,
    background = "sibling",
    normalPseudo = false,
  } = {},
) {
  const source = await studio.context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.setContent(`<!doctype html><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:16px Arial;background:white}
    #shell{position:fixed;inset:0;isolation:isolate}
    #background{position:absolute;left:100px;top:100px;width:1000px;height:350px;background:rgb(100,150,200);z-index:0}
    #back-root{position:fixed;inset:0;z-index:0}#back-root #background{height:100%;width:100%;left:0;top:0;z-index:999}
    #toolbar{position:${kind === "fixed" ? "fixed" : kind === "absolute" ? "absolute" : "relative"};left:${kind === "relative" || kind === "pseudo" ? 0 : 100}px;top:${kind === "relative" || kind === "pseudo" ? 0 : 50}px;width:1000px;height:50px;background:white;z-index:20}
    #toolbar-holder{position:absolute;left:100px;top:50px;width:1000px;height:50px}
    .scrolled #toolbar{box-shadow:0 5px 5px #888}
    #reading-pane{position:absolute;left:100px;top:100px;width:1000px;height:700px;overflow:auto;background:${transparent ? "transparent" : "white"};z-index:1}
    #message-content{height:${height}px;position:relative}
    #subject{position:absolute;top:24px;left:80px;font-size:26px}
    #sender{position:absolute;top:340px;left:80px;font-weight:bold}
    #receipt{position:absolute;top:440px;left:80px;width:600px;height:${height - 620}px;background:#f7f7f7;border:2px solid #bbb;box-shadow:0 5px 15px #0005;padding:36px}
    #receipt h2{margin:0 0 40px}#receipt p{max-width:420px;line-height:1.6}
    #real-divider{position:absolute;bottom:55px;left:30px;right:30px;height:1px;background:#197d55}
    #cs-paint{position:absolute;left:800px;top:660px;width:40px;height:40px}#cs-paint::after{content:'';position:absolute;inset:0;background:orange}
    ${transparent && background === "ancestor" ? '#shell::before{content:"";position:absolute;inset:0;background:rgb(100,150,200);z-index:0}' : ""}
    ${kind === "ancestor" ? '.scrolled #shell::after{content:"";position:absolute;left:100px;top:100px;width:1000px;height:1px;background:#aaa;box-shadow:0 2px 3px #888;z-index:99}' : ""}
    ${kind === "inset" ? ".scrolled #toolbar{box-shadow:none}.scrolled #reading-pane{box-shadow:inset 0 6px 6px #888,inset 0 -6px 6px #888,0 0 12px #2345}" : ""}
    ${kind === "sticky-pseudo" ? '#message-content::before{content:"";display:block;position:sticky;top:0;width:100%;height:0;z-index:30}.scrolled #message-content::before{box-shadow:0 2px 3px 1px #999}' : ""}
    ${kind === "fixed-pseudo" ? '.scrolled #reading-pane::after{content:"";position:fixed;top:100px;left:100px;width:1000px;height:1px;background:#aaa;z-index:99}' : ""}
    ${kind === "pseudo" ? '.scrolled #toolbar{box-shadow:none}.scrolled #toolbar::after{content:"";position:absolute;left:0;right:0;bottom:-3px;height:3px;background:#bbb;box-shadow:0 2px 3px #0005}' : ""}
    ${normalPseudo ? '#reading-pane::before{content:"Account statement";display:block;height:40px;line-height:40px;padding-left:80px;font-size:30px;color:#235c91}' : ""}
  </style><div id="shell" data-capture-studio-paint="existing marker">${transparent && background === "nested" ? '<div id="back-root"><div id="background"></div></div>' : transparent && background === "sibling" ? '<div id="background"></div>' : ""}
    ${kind === "relative" || kind === "pseudo" ? '<div id="toolbar-holder"><div id="toolbar" style="opacity:var(--toolbar-opacity,1)">Message actions</div></div>' : '<div id="toolbar" style="opacity:var(--toolbar-opacity,1)">Message actions</div>'}
    <main id="reading-pane" aria-label="Message"><article id="message-content"><div id="subject">Your example subscription update</div><div id="sender">Example sender · fictional message</div><section id="receipt"><h2>Example receipt</h2><p>This fictional email includes a real border and box shadow. These details must survive capture.</p></section><div id="real-divider"></div><div id="cs-paint"></div></article></main>
  </div><script>
    const pane=document.getElementById('reading-pane');
    pane.addEventListener('scroll',()=>document.body.classList.toggle('scrolled',pane.scrollTop>0));
  </script>`);
  const popup = await studio.context.newPage();
  await popup.goto(`${studio.origin}/popup.html`);
  await source.bringToFront();
  const tabId = await popup.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  const reference = PNG.sync.read(
    Buffer.from(
      await popup.evaluate(async () => {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        return (
          await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
        ).split(",")[1];
      }),
      "base64",
    ),
  );
  const snapshot = () =>
    source.evaluate(() => ({
      scroll: document.getElementById("reading-pane").scrollTop,
      styles: [...document.querySelectorAll("body *")].map((node) => [
        node.id,
        node.getAttribute("style"),
        node.getAttribute("data-capture-studio-paint"),
      ]),
    }));
  const before = await snapshot();
  return {
    source,
    popup,
    tabId,
    reference,
    snapshot,
    before,
    status: () =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" })),
  };
}
async function finish(studio, job) {
  expect(
    await job.popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_START", mode: "full" }),
    ),
  ).toEqual({ ok: true });
  let state;
  await expect
    .poll(
      async () => {
        state = await job.status();
        if (state.phase === "error") throw new Error(state.message);
        return state.phase;
      },
      { timeout: 25000 },
    )
    .toBe("done");
  let editor;
  await expect
    .poll(() => {
      editor = studio.context
        .pages()
        .find(
          (page) =>
            page.url() === `${studio.origin}/app.html#${state.projectId}`,
        );
      return Boolean(editor);
    })
    .toBe(true);
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const pending = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const image = PNG.sync.read(await readFile(await (await pending).path()));
  await expect.poll(job.snapshot).toEqual(job.before);
  return image;
}
function compareStrip(
  image,
  reference,
  start,
  end,
  left = 5,
  right = image.width - 5,
) {
  let differences = 0;
  for (let y = start; y < end; y++)
    for (let x = left; x < right; x++)
      if (
        pixel(image, x, y).join() !== pixel(reference, x + 100, y + 100).join()
      )
        differences++;
  expect(differences).toBe(0);
}

for (const kind of [
  "fixed",
  "absolute",
  "relative",
  "ancestor",
  "inset",
  "sticky-pseudo",
  "fixed-pseudo",
])
  test(`${kind} pane chrome leaves no line at the final overlap and retains the message shadow`, async ({
    studio,
  }) => {
    const job = await setup(studio, { kind });
    const image = await finish(studio, job);
    expect([image.width, image.height]).toEqual([1000, 1290]);
    compareStrip(image, job.reference, 575, 610);
    expect(pixel(image, 50, 1234)).toEqual([25, 125, 85, 255]);
    expect(pixel(image, 820, 670)).toEqual([255, 165, 0, 255]);
    if (kind === "fixed") {
      await mkdir("artifacts", { recursive: true });
      await writeFile(
        "artifacts/email-shadow-corrected.png",
        PNG.sync.write(image),
      );
    }
  });

test("long messages keep every frame boundary clean and adapt to replacement CSS and toolbar nodes", async ({
  studio,
}) => {
  const job = await setup(studio, { height: 2500 });
  await job.source.evaluate(() => {
    const pane = document.getElementById("reading-pane");
    let changed = false;
    pane.addEventListener("scroll", () => {
      if (pane.scrollTop <= 700 || changed) return;
      changed = true;
      const old = document.getElementById("toolbar");
      const replacement = document.createElement("div");
      replacement.id = "new-site-toolbar";
      replacement.className = "view-header-v2";
      const stylesheet = document.createElement("style");
      stylesheet.textContent =
        ".site-design-v2 .view-header-v2{position:fixed;left:100px;top:50px;width:1000px;height:50px;background:white;z-index:100;filter:drop-shadow(0 5px 5px #888)}";
      document.head.append(stylesheet);
      old.replaceWith(replacement);
      document.body.classList.add("site-design-v2");
    });
  });
  // Compare all surviving nodes and check the replacement's own original styles below.
  job.before.styles = job.before.styles.filter(([id]) => id !== "toolbar");
  const snapshot = job.snapshot;
  job.snapshot = async () => {
    const value = await snapshot();
    value.styles = value.styles.filter(([id]) => id !== "new-site-toolbar");
    return value;
  };
  const image = await finish(studio, job);
  for (let y = 0; y < image.height; y++)
    expect(pixel(image, 20, y)).toEqual([255, 255, 255, 255]);
  expect(
    await job.source.locator("#new-site-toolbar").getAttribute("style"),
  ).toBeNull();
  expect(await job.source.locator("[data-capture-studio-paint]").count()).toBe(
    1,
  );
});

for (const background of ["sibling", "nested", "ancestor"])
  test(`transparent panes retain ${background} backgrounds while excluding external pseudo shadows`, async ({
    studio,
  }) => {
    const job = await setup(studio, {
      kind: "pseudo",
      transparent: true,
      background,
    });
    const image = await finish(studio, job);
    // Partial sibling backgrounds are viewport-anchored. Compare the opaque
    // message itself and separately verify those visible background pixels.
    compareStrip(
      image,
      job.reference,
      575,
      610,
      background === "sibling" ? 100 : 5,
      background === "sibling" ? 650 : image.width - 5,
    );
    expect(pixel(image, 20, 100)).toEqual([100, 150, 200, 255]);
    if (background === "sibling")
      expect(pixel(image, 20, 590)).toEqual([100, 150, 200, 255]);
  });

test("live theme changes release stale opacity overrides and retain page-authored styles", async ({
  studio,
}) => {
  const job = await setup(studio, { kind: "pseudo", background: "nested" });
  await job.source.evaluate(() => {
    const background = document.createElement("div");
    background.id = "live-background";
    background.style.cssText =
      "position:fixed;inset:0;background:rgb(53,127,65);z-index:0";
    document.getElementById("shell").prepend(background);
  });
  const send = (type, data = {}) =>
    job.popup.evaluate(
      ({ tabId, type, data }) =>
        chrome.tabs.sendMessage(tabId, { type: `CS_PAGE_${type}`, ...data }),
      { tabId: job.tabId, type, data },
    );
  await job.popup.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      }),
    job.tabId,
  );
  expect((await send("TARGET", { scope: "auto" })).ok).toBe(true);
  expect((await send("PREPARE", { mode: "full" })).ok).toBe(true);
  expect(
    await job.source
      .locator("#live-background")
      .evaluate((node) => getComputedStyle(node).opacity),
  ).toBe("0");
  await job.source.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ".updated-theme #reading-pane{background:transparent}";
    document.head.append(style);
    document.body.classList.add("updated-theme");
    document.getElementById("toolbar").style.opacity = "0.6";
  });
  expect((await send("SCROLL", { x: 0, y: 590 })).ok).toBe(true);
  const data = await job.popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return (
      await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
    ).split(",")[1];
  });
  const image = PNG.sync.read(Buffer.from(data, "base64"));
  expect(pixel(image, 120, 200)).toEqual([53, 127, 65, 255]);
  expect((await send("RESTORE")).ok).toBe(true);
  expect(
    await job.source.locator("#toolbar").evaluate((node) => node.style.opacity),
  ).toBe("0.6");
  expect(
    await job.source
      .locator("#reading-pane")
      .evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");
  expect(await job.source.locator("[data-capture-studio-paint]").count()).toBe(
    1,
  );
});

test("normal-flow generated message text is preserved while temporary markers restore", async ({
  studio,
}) => {
  const job = await setup(studio, {
    kind: "sticky-pseudo",
    normalPseudo: true,
  });
  const image = await finish(studio, job);
  compareStrip(image, job.reference, 0, 40);
  expect(
    await job.source
      .locator("#shell")
      .getAttribute("data-capture-studio-paint"),
  ).toBe("existing marker");
  expect(
    await job.source
      .locator("#cs-paint")
      .evaluate((node) => getComputedStyle(node, "::after").backgroundColor),
  ).toBe("rgb(255, 165, 0)");
});

test("cancel and geometry failures restore pane-paint changes and the next capture works", async ({
  studio,
}) => {
  const job = await setup(studio, { kind: "ancestor", height: 2500 });
  for (const action of ["cancel", "resize"]) {
    await job.source.bringToFront();
    await job.popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_START", mode: "full" }),
    );
    await expect
      .poll(async () => (await job.status()).progress)
      .toBeGreaterThan(0);
    if (action === "cancel")
      await job.popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: "CS_CANCEL" }),
      );
    else
      await job.source.locator("#message-content").evaluate((node) => {
        node.style.height = "3000px";
      });
    await expect.poll(async () => (await job.status()).phase).toBe("error");
    if (action === "resize")
      await job.source
        .locator("#message-content")
        .evaluate((node) => node.removeAttribute("style"));
    await expect.poll(job.snapshot).toEqual(job.before);
  }
  await job.source.bringToFront();
  const image = await finish(studio, job);
  expect([image.width, image.height]).toEqual([1000, 2500]);
});

test.describe("fractional screenshot scaling", () => {
  test.use({ deviceScaleFactor: 1.25 });
  test("fractional pane edges stay clean at every stitched row", async ({
    studio,
  }) => {
    const job = await setup(studio, { height: 2500, kind: "ancestor" });
    await job.source.locator("#reading-pane").evaluate((node) => {
      node.style.left = "100.5px";
      node.style.top = "100.5px";
    });
    job.before = await job.snapshot();
    const image = await finish(studio, job),
      scaleX = job.reference.width / 1440,
      scaleY = job.reference.height / 960;
    expect([image.width, image.height]).toEqual([
      Math.ceil(1000 * scaleX),
      Math.ceil(2500 * scaleY),
    ]);
    for (let y = 0; y < image.height; y++)
      expect(pixel(image, 20 * scaleX, y)).toEqual([255, 255, 255, 255]);
  });
});

for (const owner of ["reading-pane", "message-content"])
  test(`absolute pseudo on static ${owner} uses its live containing block`, async ({
    studio,
  }) => {
    const job = await setup(studio);
    await job.source.locator("#message-content").evaluate((node) => {
      node.innerHTML =
        '<div id="content-marker" style="position:relative;top:900px;left:100px;width:600px;height:20px;background:#2f8544"></div>';
    });
    await job.source.addStyleTag({
      content: `
      #reading-pane{position:static;margin:100px 0 0 100px}
      ${owner === "message-content" ? "#message-content{position:static}" : ""}
      .scrolled #${owner}::after{content:"";position:absolute;left:100px;top:100px;width:1000px;height:1px;background:#999;z-index:99}
      #content-marker::before{content:"";position:absolute;left:0;top:0;width:600px;height:1px;background:#d25135}
    `,
    });
    job.before = await job.snapshot();
    const image = await finish(studio, job);
    for (let y = 0; y < image.height; y++)
      expect(pixel(image, 20, y)).toEqual([255, 255, 255, 255]);
    expect(pixel(image, 200, 900)).toEqual([210, 81, 53, 255]);
    expect(pixel(image, 200, 910)).toEqual([47, 133, 68, 255]);
  });
