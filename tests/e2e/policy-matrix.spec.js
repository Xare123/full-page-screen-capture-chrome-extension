import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";

const policies = [
  [
    "nonce-only style and script",
    "default-src 'none'; style-src 'nonce-policy-fixture'; script-src 'nonce-policy-fixture'",
  ],
  [
    "separate style element and attribute restrictions",
    "default-src 'none'; style-src-elem 'nonce-policy-fixture'; style-src-attr 'none'; script-src 'nonce-policy-fixture'",
  ],
  [
    "Trusted Types with no allowed page policies",
    "default-src 'none'; style-src 'nonce-policy-fixture'; script-src 'nonce-policy-fixture'; require-trusted-types-for 'script'; trusted-types 'none'",
  ],
  [
    "self-only external styles",
    "default-src 'none'; style-src 'self'; script-src 'nonce-policy-fixture'",
  ],
];
const css = `
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:white}
#shell{position:fixed;inset:0;isolation:isolate}
#pane{position:absolute;left:100px;top:100px;width:1000px;height:700px;overflow:auto;background:white;z-index:1;border-radius:8px}
#content{position:relative;height:1600px}
#toolbar{position:absolute;left:100px;top:50px;width:1000px;height:50px;background:white;z-index:10;box-shadow:0 4px 6px #0008}
#shell::after{content:"";position:absolute;left:100px;top:100px;width:1000px;height:2px;background:#f00;z-index:30}
#pane::before{content:"Example generated heading";display:block;height:40px;color:#123}
#content::before{content:"";display:block;position:sticky;top:0;height:2px;background:#00f;z-index:20}
#animated{position:absolute;top:200px;left:80px;width:100px;height:100px;background:#278341;animation:pulse 8s infinite alternate;transition:opacity 4s}
@keyframes pulse{from{transform:translateX(0)}to{transform:translateX(60px)}}
#end{position:absolute;bottom:0;left:0;width:100%;height:20px;background:#ce783c}
`;
async function setup(studio, policy) {
  const source = await studio.context.newPage();
  await source.route("**/policy-fixture.css", (route) =>
    route.fulfill({ contentType: "text/css", body: css }),
  );
  await source.route("**/policy-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: { "Content-Security-Policy": policy },
      body: `<!doctype html><html><head>${policy.includes("style-src 'self'") ? '<link rel="stylesheet" href="/policy-fixture.css">' : `<style nonce="policy-fixture">${css}</style>`}</head><body><div id="shell" data-capture-studio-paint="original-marker"><div id="toolbar">Actions</div><main id="pane"><article id="content"><div id="animated"></div><div id="end"></div></article></main></div></body></html>`,
    }),
  );
  await source.goto("http://127.0.0.1:4173/policy-fixture");
  const popup = await studio.context.newPage();
  await popup.goto(`${studio.origin}/popup.html`);
  await source.bringToFront();
  const tabId = await popup.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  await popup.evaluate(
    (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      }),
    tabId,
  );
  const send = (type, data = {}) =>
    popup.evaluate(
      ({ tabId, type, data }) =>
        chrome.tabs.sendMessage(tabId, { type: `CS_PAGE_${type}`, ...data }),
      { tabId, type, data },
    );
  const snapshot = () =>
    source.evaluate(() => ({
      styles: [...document.querySelectorAll("body *")].map((n) => [
        n.id,
        n.getAttribute("style"),
        n.getAttribute("data-capture-studio-paint"),
        n.getAttribute("data-capture-studio-owned"),
      ]),
      styleCount: document.querySelectorAll("style").length,
      scroll: document.getElementById("pane").scrollTop,
      pseudo: getComputedStyle(document.getElementById("shell"), "::after")
        .opacity,
    }));
  return { source, popup, tabId, send, snapshot, before: await snapshot() };
}
for (const [label, policy] of policies) {
  test(`${label}: isolated-world pane CSS, pseudo rules and restoration`, async ({
    studio,
  }) => {
    const job = await setup(studio, policy);
    // Establish that the HTTP policy is active in the page world before testing
    // extension-owned CSS. MV3 content scripts execute in an isolated world.
    expect(
      await job.source.evaluate(() => {
        const blocked = document.createElement("style");
        blocked.textContent = "body{background:red}";
        document.head.append(blocked);
        const denied = blocked.sheet === null;
        blocked.remove();
        return denied;
      }),
    ).toBe(true);
    expect((await job.send("TARGET", { scope: "auto" })).data.kind).toBe(
      "pane",
    );
    const prepared = await job.send("PREPARE", { mode: "full" });
    expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
    expect(prepared.data.kind).toBe("pane");
    const paint = await job.source.evaluate(() => ({
      edge: getComputedStyle(document.getElementById("shell"), "::after")
        .opacity,
      sticky: getComputedStyle(document.getElementById("content"), "::before")
        .position,
      heading: getComputedStyle(document.getElementById("pane"), "::before")
        .content,
      animation: getComputedStyle(document.getElementById("animated"))
        .animationPlayState,
      transition: getComputedStyle(document.getElementById("animated"))
        .transitionDuration,
    }));
    expect(paint).toEqual({
      edge: "0",
      sticky: "relative",
      heading: '"Example generated heading"',
      animation: "paused",
      transition: "0s",
    });
    expect((await job.send("SCROLL", { x: 0, y: 940 })).ok).toBe(true);
    const data = await job.popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return (
        await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      ).split(",")[1];
    });
    const frame = PNG.sync.read(Buffer.from(data, "base64"));
    const sample = (x, y) => [
      ...frame.data.subarray(
        (y * frame.width + x) * 4,
        (y * frame.width + x) * 4 + 4,
      ),
    ];
    expect(sample(110, 101)).toEqual([255, 255, 255, 255]);
    expect(sample(110, 790)).toEqual([206, 120, 60, 255]);
    expect((await job.send("RESTORE")).ok).toBe(true);
    await expect.poll(job.snapshot).toEqual(job.before);
  });
  test(`${label}: cancellation during preparation removes temporary rules`, async ({
    studio,
  }) => {
    const job = await setup(studio, policy);
    expect((await job.send("TARGET", { scope: "auto" })).ok).toBe(true);
    // Hold the first preparation await in the extension's isolated world.
    // Polling a style node alone can send RESTORE after preparation has finished
    // when several browser workers compete for the host's CPU.
    await job.popup.evaluate(
      (tabId) =>
        chrome.scripting.executeScript({
          target: { tabId },
          world: "ISOLATED",
          func: () => {
            const original = globalThis.setTimeout;
            globalThis.setTimeout = (callback, milliseconds, ...args) => {
              if (milliseconds !== 120)
                return original(callback, milliseconds, ...args);
              globalThis.setTimeout = original;
              const timer = original(() => {}, 120000);
              globalThis.releasePreparation = () => {
                clearTimeout(timer);
                delete globalThis.releasePreparation;
                callback(...args);
              };
              return timer;
            };
          },
        }),
      job.tabId,
    );
    const pending = job.send("PREPARE", { mode: "full" });
    try {
      await expect
        .poll(() =>
          job.popup.evaluate(async (tabId) => {
            const [result] = await chrome.scripting.executeScript({
              target: { tabId },
              world: "ISOLATED",
              func: () => typeof globalThis.releasePreparation === "function",
            });
            return result.result;
          }, job.tabId),
        )
        .toBe(true);
      await expect
        .poll(() => job.source.locator("style").count())
        .toBe(job.before.styleCount + 1);
      expect((await job.send("RESTORE")).ok).toBe(true);
    } finally {
      await job.popup.evaluate(
        (tabId) =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            func: () => globalThis.releasePreparation?.(),
          }),
        job.tabId,
      );
    }
    expect((await pending).ok).toBe(false);
    await expect.poll(job.snapshot).toEqual(job.before);
    expect((await job.send("TARGET", { scope: "auto" })).ok).toBe(true);
    expect((await job.send("PREPARE", { mode: "full" })).ok).toBe(true);
    expect((await job.send("RESTORE")).ok).toBe(true);
    await expect.poll(job.snapshot).toEqual(job.before);
  });
  test(`${label}: region picker works and cleans up on escape`, async ({
    studio,
  }) => {
    const job = await setup(studio, policy);
    const pending = job.send("SELECT");
    await expect.poll(() => job.source.locator("html > div").count()).toBe(1);
    await job.source.keyboard.press("Escape");
    expect((await pending).ok).toBe(false);
    await expect.poll(job.snapshot).toEqual(job.before);
    expect(await job.source.locator("html > div").count()).toBe(0);
  });
}

for (const nested of [false, true])
  for (const kind of ["dialog", "popover"])
    test(`${nested ? "nested transparent" : "opaque"} pane excludes external top-layer ${kind} and backdrop`, async ({
      studio,
    }) => {
      const job = await setup(studio, policies[0][1]);
      await job.source.evaluate(
        ({ kind, nested }) => {
          const sheet = document.createElement("style");
          sheet.nonce = "policy-fixture";
          sheet.textContent =
            "#overlay{position:fixed;left:300px;top:300px;width:200px;height:150px;margin:0;border:0;background:yellow}#overlay::backdrop{background:rgb(0 0 0 / 50%)}";
          document.head.append(sheet);
          const overlay = document.createElement(
            kind === "dialog" ? "dialog" : "div",
          );
          overlay.id = "overlay";
          if (kind === "popover") overlay.setAttribute("popover", "manual");
          if (nested) {
            const branch = document.createElement("div");
            branch.id = "layer-branch";
            sheet.sheet.insertRule(
              "#layer-branch{position:fixed;inset:0;z-index:-1}",
            );
            sheet.sheet.insertRule("#pane{background:transparent}");
            document.body.append(branch);
            branch.append(overlay);
          } else document.body.append(overlay);
          if (kind === "dialog") overlay.showModal();
          else overlay.showPopover();
        },
        { kind, nested },
      );
      job.before = await job.snapshot();
      expect((await job.send("TARGET", { scope: "auto" })).data.kind).toBe(
        "pane",
      );
      const result = await job.send("PREPARE", { mode: "full" });
      expect(result.ok, JSON.stringify(result)).toBe(true);
      const image = PNG.sync.read(await job.source.screenshot());
      for (const [x, y] of [
        [900, 500],
        [350, 350],
      ]) {
        const i = (y * image.width + x) * 4;
        expect([...image.data.subarray(i, i + 4)]).toEqual([
          255, 255, 255, 255,
        ]);
      }
      expect((await job.send("RESTORE")).ok).toBe(true);
      await expect.poll(job.snapshot).toEqual(job.before);
      expect(
        await job.source
          .locator("#overlay")
          .evaluate(
            (node, kind) =>
              kind === "dialog" ? node.open : node.matches(":popover-open"),
            kind,
          ),
      ).toBe(true);
      expect(
        await job.source
          .locator("#overlay")
          .evaluate(
            (node) => getComputedStyle(node, "::backdrop").backgroundColor,
          ),
      ).toBe("rgba(0, 0, 0, 0.5)");
    });

for (const kind of ["dialog", "popover"]) {
  test(`a pane inside its own top-layer ${kind} keeps its containing surface`, async ({
    studio,
  }) => {
    const job = await setup(studio, policies[0][1]);
    await job.source.evaluate((kind) => {
      const sheet = document.createElement("style");
      sheet.nonce = "policy-fixture";
      sheet.textContent =
        "#own-surface{position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;height:100vh;max-width:none;max-height:none;background:rgb(240,250,230)}#pane{background:transparent}#own-surface::backdrop{background:#0008}";
      document.head.append(sheet);
      const surface = document.createElement(
        kind === "dialog" ? "dialog" : "div",
      );
      surface.id = "own-surface";
      if (kind === "popover") surface.setAttribute("popover", "manual");
      document.body.append(surface);
      surface.append(document.getElementById("shell"));
      if (kind === "dialog") surface.showModal();
      else surface.showPopover();
    }, kind);
    job.before = await job.snapshot();
    expect((await job.send("TARGET", { scope: "auto" })).data.kind).toBe(
      "pane",
    );
    expect((await job.send("PREPARE", { mode: "full" })).ok).toBe(true);
    expect(
      await job.source
        .locator("#own-surface")
        .evaluate((node) => getComputedStyle(node).opacity),
    ).toBe("1");
    const image = PNG.sync.read(await job.source.screenshot());
    const i = (500 * image.width + 900) * 4;
    expect([...image.data.subarray(i, i + 4)]).toEqual([240, 250, 230, 255]);
    expect((await job.send("RESTORE")).ok).toBe(true);
    await expect.poll(job.snapshot).toEqual(job.before);
    expect(
      await job.source
        .locator("#own-surface")
        .evaluate(
          (node, kind) =>
            kind === "dialog" ? node.open : node.matches(":popover-open"),
          kind,
        ),
    ).toBe(true);
  });
  test(`live external ${kind} opening and closing keeps authored state on restore`, async ({
    studio,
  }) => {
    const job = await setup(studio, policies[0][1]);
    await job.source.evaluate((kind) => {
      const sheet = document.createElement("style");
      sheet.nonce = "policy-fixture";
      sheet.textContent =
        "#live-overlay::backdrop{background:#0008}#live-overlay{background:yellow}#pane{background:transparent}";
      document.head.append(sheet);
      const overlay = document.createElement(
        kind === "dialog" ? "dialog" : "div",
      );
      overlay.id = "live-overlay";
      if (kind === "popover") overlay.setAttribute("popover", "manual");
      document.body.append(overlay);
    }, kind);
    expect((await job.send("TARGET", { scope: "auto" })).data.kind).toBe(
      "pane",
    );
    expect((await job.send("PREPARE", { mode: "full" })).ok).toBe(true);
    const toggle = (open) =>
      job.source.locator("#live-overlay").evaluate(
        (node, { kind, open }) => {
          if (kind === "dialog") {
            if (open) node.showModal();
            else node.close();
          } else {
            if (open) node.showPopover();
            else node.hidePopover();
          }
        },
        { kind, open },
      );
    const paint = () =>
      job.source.locator("#live-overlay").evaluate((node) => ({
        opacity: getComputedStyle(node).opacity,
        backdrop: getComputedStyle(node, "::backdrop").opacity,
      }));
    await toggle(true);
    expect((await job.send("SCROLL", { x: 0, y: 500 })).ok).toBe(true);
    expect(await paint()).toEqual({ opacity: "0", backdrop: "0" });
    await job.source
      .locator("#live-overlay")
      .evaluate((node) => (node.style.opacity = "0.4"));
    expect((await job.send("SCROLL", { x: 0, y: 700 })).ok).toBe(true);
    expect(await paint()).toEqual({ opacity: "0", backdrop: "0" });
    await toggle(false);
    expect((await job.send("SCROLL", { x: 0, y: 400 })).ok).toBe(true);
    expect(
      await job.source
        .locator("#live-overlay")
        .evaluate((node) => node.style.opacity),
    ).toBe("0.4");
    await toggle(true);
    expect((await job.send("SCROLL", { x: 0, y: 500 })).ok).toBe(true);
    expect(await paint()).toEqual({ opacity: "0", backdrop: "0" });
    expect((await job.send("RESTORE")).ok).toBe(true);
    expect(await paint()).toEqual({ opacity: "0.4", backdrop: "1" });
    expect(
      await job.source
        .locator("#live-overlay")
        .evaluate(
          (node, kind) =>
            kind === "dialog" ? node.open : node.matches(":popover-open"),
          kind,
        ),
    ).toBe(true);
    expect(
      await job.source.locator("[data-capture-studio-paint]").count(),
    ).toBe(1);
    expect(
      await job.source.locator("[data-capture-studio-owned]").count(),
    ).toBe(0);
  });
}
