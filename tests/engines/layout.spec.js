import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

const contentScript = await readFile(
  new URL("../../src/content.js", import.meta.url),
  "utf8",
);
const white = [255, 255, 255, 255];
const blue = [100, 150, 200, 255];

async function fixture(
  page,
  { css = "", before = "", inside = "", after = "", root = false } = {},
) {
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;background:white;font:16px Arial}
    ${root ? "" : "html,body{width:100%;height:100%;overflow:hidden}"}
    #shell{position:relative;width:100%;height:${root ? "1800px" : "100%"}}
    #pane{position:absolute;left:100px;top:100px;width:700px;height:500px;overflow:auto;background:white}
    #message{position:relative;height:1200px}
    #content-mark{position:absolute;left:40px;top:850px;width:80px;height:40px;background:rgb(25,125,85)}
    ${css}
  </style></head><body><div id="shell">${before}${root ? inside : `<main id="pane" aria-label="Fictional message"><article id="message">${inside}<div id="content-mark"></div></article></main>`}${after}</div></body></html>`);
  await page.evaluate(() => {
    globalThis.chrome = {
      runtime: {
        id: "capture-studio-layout-test",
        onMessage: {
          addListener(listener) {
            globalThis.captureListener = listener;
          },
        },
      },
    };
    globalThis.captureMessage = (message) =>
      new Promise((resolve) => {
        globalThis.captureListener(message, { id: chrome.runtime.id }, resolve);
      });
  });
  await page.addScriptTag({ content: contentScript });
}
async function message(page, type, fields = {}) {
  return page.evaluate((value) => globalThis.captureMessage(value), {
    type: `CS_PAGE_${type}`,
    ...fields,
  });
}
async function ok(page, type, fields = {}) {
  const result = await message(page, type, fields);
  expect(result, `${type} should succeed`).toMatchObject({ ok: true });
  return result.data;
}
async function prepare(page, scope = "auto") {
  const target = await ok(page, "TARGET", { scope });
  const size = await ok(page, "PREPARE", { mode: "full" });
  return { target, size };
}
async function snapshot(page) {
  return page.evaluate(() => ({
    styles: [...document.querySelectorAll("body,body *")].map((node) => [
      node.id,
      node.getAttribute("style"),
      node.getAttribute("data-capture-studio-paint"),
    ]),
    scrolls: [...document.querySelectorAll("html,body,body *")]
      .filter((node) => node.scrollTop || node.scrollLeft)
      .map((node) => [
        node.id || node.tagName,
        node.scrollLeft,
        node.scrollTop,
      ]),
    sheets: document.styleSheets.length,
  }));
}
async function pixels(page, points) {
  const image = PNG.sync.read(await page.screenshot());
  return points.map(([x, y]) => [
    ...image.data.subarray(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    ),
  ]);
}
async function restore(page, before) {
  await ok(page, "RESTORE");
  expect(await snapshot(page)).toEqual(before);
}

test("long document takes priority over an embedded reader and restores root scroll", async ({
  page,
}) => {
  await fixture(page, {
    root: true,
    inside:
      '<main id="pane"><div style="height:1200px">Embedded fictional notes</div></main>',
  });
  await page.evaluate(() => scrollTo(0, 250));
  const before = await snapshot(page);
  const { target, size } = await prepare(page);
  expect(target.kind).toBe("document");
  expect(size.height).toBe(1800);
  const frame = await ok(page, "SCROLL", { x: 0, y: 700 });
  expect(frame.y).toBe(700);
  expect(frame.kind).toBeUndefined();
  await restore(page, before);
});

test("bordered padded reader reports its client crop and preserves exact inline styles", async ({
  page,
}) => {
  await fixture(page, {
    css: "#pane{border:6px solid #345;padding:12px;border-radius:22px}",
  });
  await page.locator("#pane").evaluate((node) => {
    node.setAttribute("style", "overflow-anchor: auto; --spacing: 12px");
    node.scrollTop = 175;
  });
  const before = await snapshot(page);
  const { target, size } = await prepare(page);
  expect(target.kind).toBe("pane");
  const client = await page.locator("#pane").evaluate((node) => ({
    width: node.clientWidth,
    height: node.clientHeight,
  }));
  expect(size.source).toEqual({ x: 106, y: 106, ...client });
  expect(size.height).toBe(1224);
  expect((await ok(page, "SCROLL", { x: 0, y: 400 })).y).toBe(400);
  await restore(page, before);
});

test("a large navigation scrollbox does not displace the message reader", async ({
  page,
}) => {
  await fixture(page, {
    css: "#pane{left:380px;width:580px}nav{position:absolute;left:0;top:0;width:360px;height:780px;overflow:auto}",
    before: '<nav><div style="height:6000px">Fictional folders</div></nav>',
  });
  expect(await ok(page, "TARGET", { scope: "auto" })).toEqual({ kind: "pane" });
  const size = await ok(page, "PREPARE", { mode: "full" });
  expect(size.source.x).toBe(380);
  expect(size.height).toBe(1200);
  await ok(page, "RESTORE");
});

test("equally prominent independent readers require a choice without modifying either", async ({
  page,
}) => {
  await fixture(page, {
    css: "#pane{left:20px;width:450px}#other{position:absolute;left:520px;top:100px;width:450px;height:500px;overflow:auto}",
    after:
      '<main id="other"><div style="height:1200px">Second fictional email</div></main>',
  });
  const before = await snapshot(page);
  expect(await ok(page, "TARGET", { scope: "auto" })).toEqual({
    kind: "choose",
  });
  expect(await snapshot(page)).toEqual(before);
});

test("a compose textarea is excluded from automatic scrolling-area selection", async ({
  page,
}) => {
  await fixture(page, {
    root: true,
    css: "#shell{height:100vh}textarea{width:850px;height:650px}",
    inside: `<textarea>${"Fictional draft line\n".repeat(150)}</textarea>`,
  });
  expect(
    await page
      .locator("textarea")
      .evaluate((node) => node.scrollHeight > node.clientHeight),
  ).toBe(true);
  expect(await ok(page, "TARGET", { scope: "auto" })).toEqual({
    kind: "document",
  });
});

test("opaque readers suppress external toolbar shadow pixels throughout scrolling", async ({
  page,
}) => {
  await fixture(page, {
    before: '<div id="toolbar">Message actions</div>',
    css: "#toolbar{position:fixed;left:100px;top:60px;width:700px;height:40px;background:white;box-shadow:0 8px 10px #333;z-index:10}",
  });
  const before = await snapshot(page);
  expect((await pixels(page, [[300, 103]]))[0]).not.toEqual(white);
  await prepare(page);
  await ok(page, "SCROLL", { x: 0, y: 480 });
  expect(
    await pixels(page, [
      [300, 103],
      [300, 595],
    ]),
  ).toEqual([white, white]);
  await restore(page, before);
});

test("transparent reader preserves a nested backdrop with its own high z-index descendant", async ({
  page,
}) => {
  await fixture(page, {
    before:
      '<div id="back"><div id="back-child"></div></div><div id="toolbar"></div>',
    css: "#back{position:absolute;inset:0;z-index:0}#back-child{position:absolute;inset:0;background:rgb(100,150,200);z-index:999}#pane{background:transparent;z-index:1}#toolbar{position:absolute;left:100px;top:70px;width:700px;height:30px;background:white;box-shadow:0 8px 10px black;z-index:2}",
  });
  const before = await snapshot(page);
  await prepare(page);
  await ok(page, "SCROLL", { x: 0, y: 400 });
  expect(
    await pixels(page, [
      [300, 103],
      [300, 500],
    ]),
  ).toEqual([blue, blue]);
  await restore(page, before);
});

test("nested external top-layer dialogs and popovers lose their paint but keep their open state", async ({
  page,
}) => {
  await fixture(page, {
    before:
      '<aside id="outside"><dialog id="dialog">Fictional account alert</dialog><div id="popover" popover="manual">Fictional message actions</div></aside>',
    css: "#outside{position:absolute;z-index:0}#dialog,#popover{position:fixed;inset:auto;margin:0;border:0;padding:0;left:250px;top:200px;width:250px;height:100px;background:red}#popover{top:350px;background:blue}#dialog::backdrop{background:rgba(0,0,0,.6)}#popover::backdrop{background:rgba(0,255,0,.2)}",
  });
  await page.evaluate(() => {
    document.querySelector("#dialog").showModal();
    document.querySelector("#popover").showPopover();
  });
  const before = await snapshot(page);
  expect((await pixels(page, [[300, 250]]))[0]).not.toEqual(white);
  await prepare(page);
  await ok(page, "SCROLL", { x: 0, y: 400 });
  expect(
    await pixels(page, [
      [300, 150],
      [300, 250],
      [300, 400],
    ]),
  ).toEqual([white, white, white]);
  expect(
    await page.evaluate(() => [
      document.querySelector("#dialog").matches(":modal"),
      document.querySelector("#popover").matches(":popover-open"),
    ]),
  ).toEqual([true, true]);
  await restore(page, before);
  expect((await pixels(page, [[300, 250]]))[0]).not.toEqual(white);
  expect(
    await page.evaluate(() => [
      document.querySelector("#dialog").matches(":modal"),
      document.querySelector("#popover").matches(":popover-open"),
    ]),
  ).toEqual([true, true]);
});

test("transparent reader keeps a full ancestor pseudo background while removing its edge rule", async ({
  page,
}) => {
  await fixture(page, {
    css: '#shell::before{content:"";position:absolute;inset:0;background:rgb(100,150,200);z-index:0}#shell::after{content:"";position:absolute;left:100px;top:100px;width:700px;height:3px;background:red;z-index:3}#pane{background:transparent;z-index:1}',
  });
  const before = await snapshot(page);
  await prepare(page);
  expect(
    await pixels(page, [
      [300, 101],
      [300, 400],
    ]),
  ).toEqual([blue, blue]);
  await restore(page, before);
});

test("pane inset edge shading disappears while the outside shadow survives", async ({
  page,
}) => {
  await fixture(page, {
    css: "#pane{box-shadow:inset 0 12px 12px #000,0 0 14px rgb(0,0,0)}",
  });
  const before = await snapshot(page);
  const outside = (await pixels(page, [[95, 300]]))[0];
  expect(outside).not.toEqual(white);
  await prepare(page);
  expect((await pixels(page, [[400, 102]]))[0]).toEqual(white);
  expect((await pixels(page, [[95, 300]]))[0]).toEqual(outside);
  await restore(page, before);
});

test("ordinary receipt borders shadows and generated text remain visible inside a reader", async ({
  page,
}) => {
  await fixture(page, {
    inside: '<section id="receipt"></section>',
    css: '#receipt{position:absolute;left:40px;top:40px;width:300px;height:180px;border:3px solid rgb(25,125,85);background:rgb(240,240,240);box-shadow:0 6px 10px #333}#receipt::before{content:"Fictional receipt";display:block;color:navy}#receipt::after{content:"";position:absolute;left:0;right:0;bottom:20px;height:2px;background:orange}',
  });
  const points = [
    [141, 170],
    [220, 260],
    [220, 297],
    [220, 324],
  ];
  const reference = await pixels(page, points);
  const before = await snapshot(page);
  await prepare(page);
  expect(await pixels(page, points)).toEqual(reference);
  expect(
    await page
      .locator("#receipt")
      .evaluate((node) => getComputedStyle(node, "::before").content),
  ).toBe('"Fictional receipt"');
  await restore(page, before);
});

test("sticky mail heading scrolls away while retaining its absolute child containing block", async ({
  page,
}) => {
  await fixture(page, {
    inside: '<header id="heading"><span id="badge"></span></header>',
    css: "#heading{position:sticky;top:0;height:60px;background:orange}#badge{position:absolute;right:10px;top:10px;width:20px;height:20px;background:blue}",
  });
  const before = await snapshot(page);
  await prepare(page);
  const badge = await page.locator("#badge").boundingBox();
  const heading = await page.locator("#heading").boundingBox();
  expect(badge.x + badge.width).toBe(heading.x + heading.width - 10);
  await ok(page, "SCROLL", { x: 0, y: 300 });
  expect((await pixels(page, [[300, 120]]))[0]).toEqual(white);
  await restore(page, before);
});

test("sticky generated section heading becomes ordinary flow content and restores", async ({
  page,
}) => {
  await fixture(page, {
    css: '#message::before{content:"Fictional statement";display:block;position:sticky;top:0;height:35px;background:orange}',
  });
  const before = await snapshot(page);
  await prepare(page);
  expect((await pixels(page, [[300, 110]]))[0]).toEqual([255, 165, 0, 255]);
  await ok(page, "SCROLL", { x: 0, y: 300 });
  expect((await pixels(page, [[300, 110]]))[0]).toEqual(white);
  await restore(page, before);
});

test("viewport-fixed empty pseudo divider is excluded from every reader frame", async ({
  page,
}) => {
  await fixture(page, {
    css: '#pane::after{content:"";position:fixed;left:100px;top:100px;width:700px;height:3px;background:red;z-index:9}',
  });
  const before = await snapshot(page);
  await prepare(page);
  for (const y of [0, 480, 700]) {
    await ok(page, "SCROLL", { x: 0, y });
    expect((await pixels(page, [[300, 101]]))[0]).toEqual(white);
  }
  await restore(page, before);
});

test("fixed content inside a transformed message block retains its local coordinates", async ({
  page,
}) => {
  await fixture(page, {
    inside: '<div id="local-fixed"></div>',
    css: "#message{transform:translate(0px,0px)}#local-fixed{position:fixed;left:40px;top:300px;width:80px;height:40px;background:orange}",
  });
  const before = await snapshot(page);
  await prepare(page);
  expect((await pixels(page, [[160, 410]]))[0]).toEqual([255, 165, 0, 255]);
  await ok(page, "SCROLL", { x: 0, y: 250 });
  expect((await pixels(page, [[160, 160]]))[0]).toEqual([255, 165, 0, 255]);
  expect(await page.locator("#local-fixed").getAttribute("style")).toBeNull();
  await restore(page, before);
});

test("replacement toolbar and late CSS are classified from the live document", async ({
  page,
}) => {
  await fixture(page, {
    before: '<div id="toolbar"></div>',
    css: "#toolbar{position:fixed;left:100px;top:60px;width:700px;height:40px;background:white;z-index:10}",
  });
  await prepare(page);
  await page.evaluate(() => {
    const node = document.createElement("div");
    node.id = "replacement";
    document.querySelector("#toolbar").replaceWith(node);
    const style = document.createElement("style");
    style.textContent =
      "#replacement{position:absolute;left:100px;top:60px;width:700px;height:40px;background:white;filter:drop-shadow(0 8px 8px black);z-index:10}";
    document.head.append(style);
  });
  await ok(page, "SCROLL", { x: 0, y: 400 });
  expect((await pixels(page, [[300, 102]]))[0]).toEqual(white);
  await ok(page, "RESTORE");
  expect(await page.locator("#replacement").getAttribute("style")).toBeNull();
  expect(await page.locator("[data-capture-studio-paint]").count()).toBe(0);
});

test("ancestor pseudo changing from edge chrome to background is reclassified", async ({
  page,
}) => {
  await fixture(page, {
    css: '#pane{background:transparent;z-index:1}#shell::before{content:"";position:absolute;left:100px;top:100px;width:700px;height:3px;background:red;z-index:3}.backdrop#shell::before{inset:0;width:auto;height:auto;background:rgb(100,150,200);z-index:0}',
  });
  await prepare(page);
  expect((await pixels(page, [[300, 101]]))[0]).toEqual(white);
  await page
    .locator("#shell")
    .evaluate((node) => node.classList.add("backdrop"));
  await ok(page, "SCROLL", { x: 0, y: 400 });
  expect((await pixels(page, [[300, 101]]))[0]).toEqual(blue);
  await ok(page, "RESTORE");
  expect(
    await page.locator("#shell").getAttribute("data-capture-studio-paint"),
  ).toBeNull();
});

test("important variable shorthands and preexisting paint markers restore byte for byte", async ({
  page,
}) => {
  await fixture(page, {
    inside:
      '<header id="heading" data-capture-studio-paint="site-marker" style="position:sticky;inset:var(--edge,0px)!important; margin:var(--space, 2px 3px);--note:&#39;a;b:c&#39;;height:40px;background:orange">Fictional invoice</header>',
    css: '#heading::after{content:"";position:sticky;top:0;display:block;width:500px;height:2px;background:red}',
  });
  const before = await snapshot(page);
  await prepare(page);
  await ok(page, "SCROLL", { x: 0, y: 400 });
  await restore(page, before);
});

test("unrelated page-authored style changes survive restoring capture-owned changes", async ({
  page,
}) => {
  await fixture(page, {
    inside:
      '<header id="heading" style="position:sticky;top:0;color:navy;height:40px">Fictional update</header>',
    before:
      '<div id="toolbar" style="position:fixed;top:60px;left:100px;height:40px;width:700px;opacity:.8"></div>',
  });
  await prepare(page);
  await page.evaluate(() => {
    document.querySelector("#heading").style.color = "rgb(25, 125, 85)";
    document
      .querySelector("#toolbar")
      .style.setProperty("--site-update", "kept");
  });
  await ok(page, "RESTORE");
  expect(
    await page
      .locator("#heading")
      .evaluate((node) => [
        node.style.position,
        node.style.top,
        node.style.color,
      ]),
  ).toEqual(["sticky", "0px", "rgb(25, 125, 85)"]);
  expect(
    await page
      .locator("#toolbar")
      .evaluate((node) => [
        node.style.opacity,
        node.style.getPropertyValue("--site-update"),
      ]),
  ).toEqual(["0.8", "kept"]);
});

test("RTL wide reader uses left-origin frame coordinates and restores negative scrollLeft", async ({
  page,
}) => {
  await fixture(page, {
    css: "#pane{direction:rtl}#message{width:1200px;height:900px}",
  });
  await page.locator("#pane").evaluate((node) => {
    node.scrollLeft = -120;
    node.scrollTop = 80;
  });
  const before = await snapshot(page);
  const { size } = await prepare(page);
  expect(size.width).toBe(1200);
  expect((await ok(page, "FRAME")).x).toBe(0);
  const frame = await ok(page, "SCROLL", { x: 300, y: 200 });
  expect([frame.x, frame.y]).toEqual([300, 200]);
  await restore(page, before);
});

test("RTL root scrolling follows a body direction override and restores viewport offsets", async ({
  page,
}) => {
  await fixture(page, {
    root: true,
    css: "html{direction:ltr}body{direction:rtl}#shell{width:1600px}",
    inside: "Fictional RTL newsletter",
  });
  await page.evaluate(() => scrollTo(-130, 160));
  const before = await snapshot(page);
  // WebKit leaves this body's left-side overflow outside the root scrollable
  // area; Chromium and Firefox expose it. Respect each engine's native range.
  const horizontalRange = await page.evaluate(
    () =>
      document.scrollingElement.scrollWidth -
      document.scrollingElement.clientWidth,
  );
  await prepare(page, "page");
  expect((await ok(page, "FRAME")).x).toBe(0);
  const frame = await ok(page, "SCROLL", { x: 250, y: 300 });
  expect([frame.x, frame.y]).toEqual([Math.min(250, horizontalRange), 300]);
  await restore(page, before);
});

test("absolute reader escapes an unpositioned overflow ancestor when its containing block is outside", async ({
  page,
}) => {
  await fixture(page, {
    css: "#shell{position:static}#clipper{overflow:hidden;width:40px;height:40px}",
  });
  await page.evaluate(() => {
    const clipper = document.createElement("div");
    clipper.id = "clipper";
    document.querySelector("#shell").append(clipper);
    clipper.append(document.querySelector("#pane"));
  });
  const before = await snapshot(page);
  const { size } = await prepare(page);
  expect(size.source.x).toBe(100);
  expect((await ok(page, "SCROLL", { x: 0, y: 400 })).y).toBe(400);
  expect((await pixels(page, [[160, 560]]))[0]).toEqual([25, 125, 85, 255]);
  await restore(page, before);
});

test("paint containment rejects a reader whose client area is cut off and still restores", async ({
  page,
}) => {
  await fixture(page, {
    css: "#shell{contain:paint;width:600px;height:400px}",
  });
  const before = await snapshot(page);
  expect(await ok(page, "TARGET", { scope: "auto" })).toEqual({ kind: "pane" });
  expect(await message(page, "PREPARE", { mode: "full" })).toMatchObject({
    ok: false,
    error: expect.stringMatching(/partly clipped/),
  });
  await restore(page, before);
});

test("scaled reader rejects unsafe crop geometry and restores all temporary state", async ({
  page,
}) => {
  await fixture(page, {
    css: "#pane{transform:scale(.8);transform-origin:top left}",
  });
  const before = await snapshot(page);
  expect(await ok(page, "TARGET", { scope: "auto" })).toEqual({ kind: "pane" });
  expect(await message(page, "PREPARE", { mode: "full" })).toMatchObject({
    ok: false,
    error: expect.stringMatching(/scaled or rotated/),
  });
  await restore(page, before);
});

test("masked reader rejects unsupported source clipping and restores after failure", async ({
  page,
}) => {
  await fixture(page, { css: "#pane{clip-path:inset(0 0 20px 0)}" });
  const before = await snapshot(page);
  expect(await ok(page, "TARGET", { scope: "auto" })).toEqual({ kind: "pane" });
  expect(await message(page, "PREPARE", { mode: "full" })).toMatchObject({
    ok: false,
    error: expect.stringMatching(/custom clipping mask/),
  });
  await restore(page, before);
});
