import { test, expect } from "./fixtures.js";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const colors = [
  [40, 100, 160],
  [60, 150, 110],
  [190, 160, 70],
  [100, 130, 190],
];
function pixel(png, x, y) {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [...png.data.subarray(i, i + 3)];
}
async function mail(studio) {
  const page = await studio.context.newPage();
  await page.goto("http://127.0.0.1:4173/email");
  await page.evaluate(() => {
    document.querySelector("#reading-pane").scrollTop = 333;
    document.querySelector("#folders").scrollTop = 912;
  });
  return page;
}
async function start(studio, source, settings = {}) {
  const popup = await studio.context.newPage();
  await popup.goto(`${studio.origin}/popup.html`);
  await source.bringToFront();
  const tabId = await popup.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  const response = await popup.evaluate(
    (settings) =>
      chrome.runtime.sendMessage({
        type: "CS_START",
        mode: "full",
        ...settings,
      }),
    settings,
  );
  expect(response.ok).toBe(true);
  return {
    popup,
    tabId,
    status: () =>
      popup.evaluate(() => chrome.runtime.sendMessage({ type: "CS_STATUS" })),
    frame: () =>
      popup.evaluate(
        (id) => chrome.tabs.sendMessage(id, { type: "CS_PAGE_FRAME" }),
        tabId,
      ),
  };
}
async function finished(studio, job) {
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
      return !!editor;
    })
    .toBe(true);
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  return editor;
}
async function exported(editor) {
  const pending = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  return PNG.sync.read(await readFile(await (await pending).path()));
}

test("automatic full capture chooses the long email pane, stitches every row and restores app state", async ({
  studio,
}) => {
  const source = await mail(studio);
  const before = await source.evaluate(() => ({
    pane: document.querySelector("#reading-pane").scrollTop,
    folders: document.querySelector("#folders").scrollTop,
    styles: [
      "#reading-pane",
      "#message-heading",
      "#pane-fixed-footer",
      "#toast",
      "#mail-app",
    ].map((s) => document.querySelector(s).getAttribute("style")),
  }));
  const job = await start(studio, source);
  let dimensions;
  await expect
    .poll(
      async () => {
        const state = await job.status();
        if (state.phase === "error") throw new Error(state.message);
        if (state.progress > 0 && state.progress < 1)
          dimensions = (await job.frame()).data;
        return dimensions?.kind;
      },
      { timeout: 12000 },
    )
    .toBe("pane");
  const editor = await finished(studio, job);
  const png = await exported(editor);
  expect(png.width).toBe(dimensions.width);
  expect(png.height).toBe(4400);
  expect(pixel(png, png.width - 10, 20)).toEqual([118, 51, 188]);
  for (let i = 0; i < 36; i++)
    expect(pixel(png, png.width - 10, 48 + i * 120 + 60)).toEqual(
      colors[i % 4],
    );
  expect(pixel(png, png.width - 10, 4390)).toEqual([230, 119, 72]);
  let footerRows = 0,
    headingRows = 0;
  for (let y = 0; y < png.height; y++) {
    if (pixel(png, 30, y).join() === "214,73,140") footerRows++;
    if (pixel(png, png.width - 10, y).join() === "118,51,188") headingRows++;
    expect(pixel(png, 320, y)).not.toEqual([255, 0, 0]);
  }
  expect(footerRows).toBe(24);
  expect(headingRows).toBe(48);
  await expect
    .poll(() =>
      source.evaluate(() => ({
        pane: document.querySelector("#reading-pane").scrollTop,
        folders: document.querySelector("#folders").scrollTop,
        styles: [
          "#reading-pane",
          "#message-heading",
          "#pane-fixed-footer",
          "#toast",
          "#mail-app",
        ].map((s) => document.querySelector(s).getAttribute("style")),
      })),
    )
    .toEqual(before);
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/long-email-capture.png", PNG.sync.write(png));
  await editor.screenshot({ path: "artifacts/long-email-studio.png" });
});

test("the main-page override keeps a complete visible mail application", async ({
  studio,
}) => {
  const source = await mail(studio);
  const editor = await finished(
    studio,
    await start(studio, source, { scope: "page" }),
  );
  const png = await exported(editor);
  expect([png.width, png.height]).toEqual([1440, 960]);
  expect(pixel(png, 1400, 20)).toEqual([175, 20, 50]);
  expect(
    await source.locator("#reading-pane").evaluate((node) => node.scrollTop),
  ).toBe(333);
});

test("Auto preserves the page when only navigation scrolls", async ({
  studio,
}) => {
  const source = await mail(studio);
  await source.evaluate(() => {
    document.querySelector("#reading-pane").innerHTML =
      "<p>A short email that fits on the screen.</p>";
    document.querySelector("#folders").style.width = "500px";
  });
  const png = await exported(
    await finished(studio, await start(studio, source)),
  );
  expect([png.width, png.height]).toEqual([1440, 960]);
  expect(pixel(png, 1400, 20)).toEqual([175, 20, 50]);
  expect(
    await source.locator("#folders").evaluate((node) => node.scrollTop),
  ).toBe(912);
});

test("a scrolling area can be chosen explicitly and cancelled without activating email actions", async ({
  studio,
}) => {
  const source = await mail(studio);
  await source.evaluate(() => {
    globalThis.clickCount = 0;
    document.body.addEventListener("click", () => globalThis.clickCount++);
  });
  const cancel = await start(studio, source, { scope: "pick" });
  await expect
    .poll(async () => (await cancel.status()).phase)
    .toBe("selecting");
  await source.keyboard.press("Escape");
  await expect.poll(async () => (await cancel.status()).phase).toBe("error");
  expect(await source.locator("[data-capture-studio-picker]").count()).toBe(0);
  expect(
    await source.locator("#reading-pane").evaluate((node) => node.scrollTop),
  ).toBe(333);
  await source.evaluate(() => {
    document.querySelector("#folders div").style.height = "1500px";
    document.querySelector("#folders").scrollTop = 177;
  });
  const chosen = await start(studio, source, { scope: "pick" });
  await expect
    .poll(async () => (await chosen.status()).phase)
    .toBe("selecting");
  await source.mouse.click(100, 400);
  const png = await exported(await finished(studio, chosen));
  expect(png.height).toBe(1500);
  expect(pixel(png, 5, 1490)).toEqual([25, 60, 90]);
  expect(
    await source.locator("#folders").evaluate((node) => node.scrollTop),
  ).toBe(177);
  expect(await source.evaluate(() => globalThis.clickCount)).toBe(0);
});

for (const direction of ["ltr", "rtl"]) {
  test(`horizontal ${direction} panes capture the bottom and both content edges`, async ({
    studio,
  }) => {
    const source = await mail(studio);
    await source.evaluate((direction) => {
      const pane = document.querySelector("#reading-pane");
      pane.style.direction = direction;
      pane.innerHTML =
        '<div style="position:relative;width:1800px;height:1555px;background:rgb(80,100,120)"><div style="position:absolute;left:0;top:0;width:24px;height:100%;background:rgb(25,150,70)"></div><div style="position:absolute;right:0;top:0;width:24px;height:100%;background:rgb(190,80,20)"></div><div style="position:absolute;bottom:0;left:0;right:0;height:18px;background:rgb(70,60,190)"></div></div>';
      pane.scrollLeft = direction === "rtl" ? -244 : 244;
      pane.scrollTop = 211;
    }, direction);
    const before = await source
      .locator("#reading-pane")
      .evaluate((node) => [node.scrollLeft, node.scrollTop]);
    const png = await exported(
      await finished(studio, await start(studio, source)),
    );
    expect([png.width, png.height]).toEqual([1800, 1555]);
    expect(pixel(png, 8, 900)).toEqual([25, 150, 70]);
    expect(pixel(png, 1791, 900)).toEqual([190, 80, 20]);
    expect(pixel(png, 900, 1549)).toEqual([70, 60, 190]);
    expect(
      await source
        .locator("#reading-pane")
        .evaluate((node) => [node.scrollLeft, node.scrollTop]),
    ).toEqual(before);
  });
}

test("comparable reading panes ask for a target and support keyboard selection", async ({
  studio,
}) => {
  const source = await mail(studio);
  await source.evaluate(() => {
    const first = document.querySelector("#reading-pane");
    first.style.width = "510px";
    const second = first.cloneNode(true);
    second.id = "other-pane";
    second.style.cssText =
      "position:absolute;left:850px;top:120.5px;width:510px;height:760px;border:4px solid black;overflow:auto;scrollbar-gutter:stable";
    second.querySelector("#pane-fixed-footer").remove();
    second.querySelector("#message-end").style.background = "rgb(60,170,222)";
    document.querySelector("#mail-app").append(second);
    second.scrollTop = 777;
  });
  const job = await start(studio, source);
  await expect.poll(async () => (await job.status()).phase).toBe("selecting");
  await expect(
    source.locator("[data-capture-studio-picker=pane]"),
  ).toBeVisible();
  await source.keyboard.press("Tab");
  await source.keyboard.press("Enter");
  const png = await exported(await finished(studio, job));
  expect(png.height).toBe(4400);
  expect(pixel(png, png.width - 10, 4390)).toEqual([60, 170, 222]);
  expect(
    await source.locator("#other-pane").evaluate((node) => node.scrollTop),
  ).toBe(777);
  expect(
    await source.locator("#reading-pane").evaluate((node) => node.scrollTop),
  ).toBe(333);
});

test("fixed panes escape non-containing overflow ancestors and render virtualized rows", async ({
  studio,
}) => {
  const source = await studio.context.newPage();
  await source.goto("http://127.0.0.1:4173/email");
  await source.setContent(
    '<!doctype html><style>body{margin:0;overflow:hidden}#shell{position:relative;height:50px;overflow:hidden}main{position:fixed;inset:100px 180px 60px 320px;overflow:auto;border:2px solid black}#spacer{position:relative;height:4800px}.row{position:absolute;left:0;right:0;height:120px}</style><div id="shell"><main><div id="spacer"></div></main></div>',
  );
  await source.evaluate(() => {
    const pane = document.querySelector("main"),
      spacer = document.querySelector("#spacer");
    const colors = [
      "rgb(40,100,160)",
      "rgb(60,150,110)",
      "rgb(190,160,70)",
      "rgb(100,130,190)",
    ];
    const rows = Array.from({ length: 9 }, () => {
      const row = document.createElement("div");
      row.className = "row";
      spacer.append(row);
      return row;
    });
    const render = () =>
      rows.forEach((row, offset) => {
        const index = Math.floor(pane.scrollTop / 120) + offset;
        row.style.top = `${index * 120}px`;
        row.style.background = colors[index % 4];
        row.style.display = index < 40 ? "block" : "none";
      });
    pane.addEventListener("scroll", render);
    pane.scrollTop = 333;
    render();
  });
  const png = await exported(
    await finished(studio, await start(studio, source)),
  );
  expect(png.height).toBe(4800);
  for (let i = 0; i < 40; i++)
    expect(pixel(png, 20, i * 120 + 60)).toEqual(colors[i % 4]);
  expect(await source.locator("main").evaluate((node) => node.scrollTop)).toBe(
    333,
  );
});

test("capture cancellation and hidden content stop without leaving the mail pane scrolled", async ({
  studio,
}) => {
  const source = await mail(studio);
  for (const action of ["cancel", "hide", "grow"]) {
    const job = await start(studio, source);
    await expect
      .poll(
        async () => {
          const s = await job.status();
          return s.progress > 0 && s.progress < 1;
        },
        { timeout: 12000 },
      )
      .toBe(true);
    if (action === "cancel")
      await job.popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: "CS_CANCEL" }),
      );
    else
      await source.evaluate((action) => {
        const pane = document.querySelector("#reading-pane");
        if (action === "hide") pane.style.visibility = "hidden";
        else {
          const extra = document.createElement("div");
          extra.id = "extra";
          extra.style.height = "200px";
          pane.append(extra);
        }
      }, action);
    await expect.poll(async () => (await job.status()).phase).toBe("error");
    const state = await job.status();
    expect(state.message).toMatch(
      action === "cancel"
        ? /cancelled/
        : action === "hide"
          ? /hidden/
          : /changed size/,
    );
    await expect
      .poll(() =>
        source.locator("#reading-pane").evaluate((node) => node.scrollTop),
      )
      .toBe(333);
    expect(
      await source.locator("#folders").evaluate((node) => node.scrollTop),
    ).toBe(912);
    await source.evaluate(() => {
      document
        .querySelector("#reading-pane")
        .style.removeProperty("visibility");
      document.querySelector("#extra")?.remove();
    });
  }
  await expect(studio.page.locator(".library-card")).toHaveCount(0);
});

test("partially clipped and transformed panes fail clearly and restore ancestor scrolling", async ({
  studio,
}) => {
  const source = await mail(studio);
  await source.evaluate(() => {
    const pane = document.querySelector("#reading-pane");
    const shell = document.createElement("div");
    shell.style.cssText =
      "position:absolute;left:320px;top:120px;width:1050px;height:400px;overflow:hidden";
    document.querySelector("#mail-app").append(shell);
    pane.style.left = "0";
    pane.style.top = "0";
    shell.append(pane);
    pane.scrollTop = 333;
    shell.scrollTop = 91;
    globalThis.originalAncestorScroll = shell.scrollTop;
  });
  const job = await start(studio, source, { scope: "pick" });
  await expect.poll(async () => (await job.status()).phase).toBe("selecting");
  await source.keyboard.press("Enter");
  await expect.poll(async () => (await job.status()).phase).toBe("error");
  expect((await job.status()).message).toMatch(/clipped/);
  expect(
    await source
      .locator("#reading-pane")
      .evaluate((node) => node.parentElement.scrollTop),
  ).toBe(await source.evaluate(() => globalThis.originalAncestorScroll));
  expect(
    await source.locator("#reading-pane").evaluate((node) => node.scrollTop),
  ).toBe(333);
  await source.evaluate(() => {
    const pane = document.querySelector("#reading-pane");
    document.querySelector("#mail-app").append(pane);
    pane.style.cssText = "scale:.9;transform-origin:top left";
  });
  const scaled = await start(studio, source);
  await expect.poll(async () => (await scaled.status()).phase).toBe("error");
  expect((await scaled.status()).message).toMatch(/scaled or rotated/);
  expect(
    await source.locator("#reading-pane").evaluate((node) => node.style.scale),
  ).toBe("0.9");
});

test("a long inner message pane wins over its slightly scrolling wrapper and restores both", async ({
  studio,
}) => {
  const source = await mail(studio);
  await source.evaluate(() => {
    const outer = document.querySelector("#reading-pane");
    outer.innerHTML =
      '<div style="height:60px">Message controls</div><article id="inner-message" role="document" style="height:720px;overflow:auto"><div style="position:relative;height:3000px;background:rgb(30,130,150)"><div style="position:absolute;bottom:0;height:32px;left:0;right:0;background:rgb(180,50,90)"></div></div></article>';
    outer.scrollTop = 11;
    document.querySelector("#inner-message").scrollTop = 219;
  });
  const png = await exported(
    await finished(studio, await start(studio, source)),
  );
  expect(png.height).toBe(3000);
  expect(pixel(png, 20, 500)).toEqual([30, 130, 150]);
  expect(pixel(png, 20, 2990)).toEqual([180, 50, 90]);
  expect(
    await source.locator("#reading-pane").evaluate((node) => node.scrollTop),
  ).toBe(11);
  expect(
    await source.locator("#inner-message").evaluate((node) => node.scrollTop),
  ).toBe(219);
});

test("paint containment and custom masks stop capture instead of producing missing bands", async ({
  studio,
}) => {
  for (const clipping of ["paint", "mask"]) {
    const source = await mail(studio);
    await source.evaluate((clipping) => {
      const pane = document.querySelector("#reading-pane");
      if (clipping === "mask") pane.style.clipPath = "inset(12px)";
      else {
        const shell = document.createElement("div");
        shell.style.cssText =
          "position:absolute;left:320px;top:120px;width:1050px;height:400px;contain:paint";
        document.querySelector("#mail-app").append(shell);
        shell.append(pane);
        pane.style.cssText = "top:0;left:0";
        pane.scrollTop = 333;
      }
    }, clipping);
    const job = await start(studio, source);
    await expect.poll(async () => (await job.status()).phase).toBe("error");
    expect((await job.status()).message).toMatch(
      clipping === "paint" ? /clipped/ : /clipping mask/,
    );
    await expect
      .poll(() =>
        source.locator("#reading-pane").evaluate((node) => node.scrollTop),
      )
      .toBe(333);
  }
});

test("lazy email images finish decoding before the final capture plan is measured", async ({
  studio,
}) => {
  const source = await mail(studio);
  const image = new PNG({ width: 300, height: 240 });
  for (let i = 0; i < image.data.length; i += 4)
    image.data.set([12, 160, 190, 255], i);
  await source.route("**/mail-image.png", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      contentType: "image/png",
      body: PNG.sync.write(image),
    });
  });
  await source.evaluate(() => {
    const image = document.createElement("img");
    image.loading = "lazy";
    image.src = "/mail-image.png";
    image.style.display = "block";
    document.querySelector("#message-end").before(image);
  });
  const png = await exported(
    await finished(studio, await start(studio, source)),
  );
  expect(png.height).toBe(4640);
  expect(pixel(png, 50, 4500)).toEqual([12, 160, 190]);
  expect(pixel(png, png.width - 10, 4630)).toEqual([230, 119, 72]);
});

test.describe("pane high DPI", () => {
  test.use({ deviceScaleFactor: 2 });
  test("pane crops use real screenshot scaling at fractional client-box positions", async ({
    studio,
  }) => {
    const source = await mail(studio);
    const probe = await studio.context.newPage();
    await probe.goto(`${studio.origin}/popup.html`);
    await source.bringToFront();
    expect(await source.evaluate(() => devicePixelRatio)).toBe(2);
    const scale = await probe.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const data = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      const image = new Image();
      image.src = data;
      await image.decode();
      return { x: image.naturalWidth / 1440, y: image.naturalHeight / 960 };
    });
    const png = await exported(
      await finished(studio, await start(studio, source)),
    );
    expect([png.width, png.height]).toEqual([
      Math.ceil(1042 * scale.x),
      Math.ceil(4400 * scale.y),
    ]);
    expect(pixel(png, 30 * scale.x, (48 + 17 * 120 + 60) * scale.y)).toEqual(
      colors[17 % 4],
    );
    expect(pixel(png, (1042 - 10) * scale.x, 4390 * scale.y)).toEqual([
      230, 119, 72,
    ]);
    expect(
      await source.locator("#reading-pane").evaluate((node) => node.scrollTop),
    ).toBe(333);
  });
});
