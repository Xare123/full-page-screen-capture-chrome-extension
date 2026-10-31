import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import { readFile, writeFile } from "node:fs/promises";
import {
  webpageCases,
  webpageHTML,
  railColors,
} from "./webpage-matrix-fixtures.js";

function pixel(png, x, y) {
  const i = (Math.round(y) * png.width + Math.round(x)) * 4;
  return [...png.data.subarray(i, i + 3)];
}
async function snapshot(source, ignoredIDs = []) {
  return source.evaluate(
    (ignoredIDs) => ({
      x: scrollX,
      y: scrollY,
      styles: [...document.querySelectorAll("[id]")]
        .filter((n) => !ignoredIDs.includes(n.id))
        .map((n) => [
          n.id,
          n.getAttribute("style"),
          n.getAttribute("data-capture-studio-paint"),
        ]),
      form: [...document.querySelectorAll("input,select,textarea,details")].map(
        (n) => [n.id, n.value ?? null, n.checked ?? null, n.open ?? null],
      ),
    }),
    ignoredIDs,
  );
}
async function setup(studio, spec) {
  const source = await studio.context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.setContent(webpageHTML(spec));
  const geometry = await source.evaluate(() => {
    const feature = window.matrixFeature || document.querySelector("#feature");
    const r = feature.getBoundingClientRect();
    const width = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      innerWidth,
    );
    const offset =
      getComputedStyle(document.body).direction === "rtl"
        ? scrollX + width - innerWidth
        : scrollX;
    return {
      width,
      height: Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
        innerHeight,
      ),
      feature: {
        x: r.left + r.width / 2 + offset,
        y: r.top + r.height / 2 + scrollY,
      },
      dpr: devicePixelRatio,
      viewportWidth: innerWidth,
    };
  });
  await source.evaluate(
    ({ rtl }) =>
      scrollTo({ left: rtl ? -137 : 137, top: 173, behavior: "instant" }),
    spec,
  );
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
  geometry.captureScale = reference.width / geometry.viewportWidth;
  const snap = () => snapshot(source, spec.lateIDs || []);
  return {
    source,
    popup,
    tabId,
    geometry,
    reference,
    snapshot: snap,
    before: await snap(),
  };
}
async function exported(studio, job, settings = {}) {
  const response = await job.popup.evaluate(
    (settings) =>
      chrome.runtime.sendMessage({
        type: "CS_START",
        mode: "full",
        scope: "page",
        ...settings,
      }),
    settings,
  );
  expect(response.ok).toBe(true);
  let state;
  await expect
    .poll(
      async () => {
        state = await job.popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        );
        if (state.phase === "error") throw Error(state.message);
        return state.phase;
      },
      { timeout: 30000 },
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
  const pending = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const image = PNG.sync.read(await readFile(await (await pending).path()));
  await expect.poll(job.snapshot).toEqual(job.before);
  return image;
}
function checkDocument(image, job, spec) {
  const { geometry: g } = job,
    dpr = g.captureScale;
  expect([image.width, image.height]).toEqual([
    Math.round(g.width * dpr),
    Math.round(g.height * dpr),
  ]);
  expect(pixel(image, g.feature.x * dpr, g.feature.y * dpr)).toEqual([
    92, 47, 151,
  ]);
  expect(pixel(image, image.width - 60 * dpr, 1820 * dpr)).toEqual([
    210, 81, 53,
  ]);
  const mismatches = [];
  // The top bar's real shadow belongs in the first frame; only later repeats are artifacts.
  for (
    let y = Math.ceil((spec.header ? 75 : 50) * dpr);
    y < Math.floor((2500 - 50) * dpr);
    y++
  ) {
    const cssY = y / dpr,
      edge = cssY % 100;
    if (edge < 2 || edge > 98) continue;
    const expected = railColors[Math.floor(cssY / 100) % railColors.length];
    if (
      pixel(image, (spec.sidebar ? 52 : 12) * dpr, y).join() !== expected.join()
    )
      mismatches.push(y);
  }
  expect(
    mismatches.slice(0, 20),
    "colored content rail must remain continuous across every join",
  ).toEqual([]);
  if (spec.header) {
    expect(pixel(image, 600 * dpr, 20 * dpr)).toEqual([18, 59, 124]);
  }
  if (spec.footer) {
    expect(pixel(image, 600 * dpr, image.height - 20 * dpr)).toEqual([
      214, 73, 140,
    ]);
  }
  if (spec.sidebar) {
    const wrong = [];
    for (let y = 0; y < image.height; y++)
      if (pixel(image, 15 * dpr, y).join() !== "36,53,42") wrong.push(y);
    expect(
      wrong.slice(0, 20),
      "late sidebar must extend from the top to the final row",
    ).toEqual([]);
  }
}

function registerPageCase(spec) {
  test(`web matrix: ${spec.name}`, async ({ studio }, testInfo) => {
    const job = await setup(studio, spec);
    const image = await exported(studio, job);
    try {
      checkDocument(image, job, spec);
    } catch (error) {
      const capturePath = testInfo.outputPath("exported-capture.png");
      await writeFile(capturePath, PNG.sync.write(image));
      await testInfo.attach("exported-capture.png", {
        path: capturePath,
        contentType: "image/png",
      });
      throw error;
    }
    for (const id of spec.lateIDs || []) {
      expect(
        await job.source.locator("#" + id).getAttribute("style"),
      ).toBeNull();
      expect(
        await job.source
          .locator("#" + id)
          .evaluate((n) => getComputedStyle(n).position),
      ).toBe("fixed");
    }
    expect(studio.errors).toEqual([]);
  });
}
for (const spec of webpageCases) {
  if (spec.viewport)
    test.describe("tablet context", () => {
      test.use({ viewport: spec.viewport });
      registerPageCase(spec);
    });
  else registerPageCase(spec);
}

for (const name of [
  "magazine article with floated figure",
  "storefront with responsive product grid",
  "RTL wide financial table",
  "dark article with native color scheme controls",
]) {
  test(`web matrix visible-area: ${name}`, async ({ studio }) => {
    const spec = {
      ...webpageCases.find((s) => s.name === name),
      header: true,
      footer: true,
    };
    const job = await setup(studio, spec);
    const reference = job.reference;
    const image = await exported(studio, job, { mode: "visible" });
    expect([image.width, image.height]).toEqual([
      reference.width,
      reference.height,
    ]);
    expect(
      image.data.equals(reference.data),
      "visible-area export must match native browser screenshot pixels",
    ).toBe(true);
  });
}

for (const dpr of [1.25, 1.5]) {
  test.describe(`web matrix at ${dpr} DPR`, () => {
    test.use({ deviceScaleFactor: dpr });
    for (const name of [
      "wide comparison table with sticky first column",
      "checkout page with fixed bottom action bar",
    ]) {
      test(name, async ({ studio }) => {
        const spec = webpageCases.find((s) => s.name === name),
          job = await setup(studio, spec);
        expect(job.geometry.dpr).toBe(dpr);
        checkDocument(await exported(studio, job), job, spec);
      });
    }
  });
}

for (const dimension of ["height", "width"]) {
  test(`web matrix rejects changed ${dimension}, restores state, and captures the next complete page`, async ({
    studio,
  }) => {
    const spec = { ...webpageCases[0], width: 2240 },
      job = await setup(studio, spec);
    expect(
      (
        await job.popup.evaluate(() =>
          chrome.runtime.sendMessage({
            type: "CS_START",
            mode: "full",
            scope: "page",
          }),
        )
      ).ok,
    ).toBe(true);
    await expect
      .poll(
        async () => {
          const state = await job.popup.evaluate(() =>
            chrome.runtime.sendMessage({ type: "CS_STATUS" }),
          );
          if (state.phase === "error") throw Error(state.message);
          return state.progress;
        },
        { intervals: [50, 100], timeout: 20000 },
      )
      .toBeGreaterThan(0);
    await job.source
      .locator("#track")
      .evaluate(
        (node, dimension) =>
          (node.style[dimension] =
            dimension === "height" ? "2800px" : "2500px"),
        dimension,
      );
    await expect
      .poll(() =>
        job.popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        ),
      )
      .toMatchObject({
        phase: "error",
        message: expect.stringMatching(/changed size/),
      });
    expect(
      studio.context
        .pages()
        .filter((page) => page.url().includes("/app.html#")),
    ).toHaveLength(0);
    await job.source
      .locator("#track")
      .evaluate((node) => node.removeAttribute("style"));
    await expect.poll(() => snapshot(job.source)).toEqual(job.before);
    checkDocument(await exported(studio, job), job, spec);
  });
}

for (const bars of ["smart", "hide"]) {
  test(`web matrix cancellation restores ${bars} bars and permits a complete retry`, async ({
    studio,
  }) => {
    const spec = { ...webpageCases[0], header: true, footer: true },
      job = await setup(studio, spec);
    expect(
      (
        await job.popup.evaluate(
          (bars) =>
            chrome.runtime.sendMessage({
              type: "CS_START",
              mode: "full",
              scope: "page",
              bars,
            }),
          bars,
        )
      ).ok,
    ).toBe(true);
    await expect
      .poll(
        async () => {
          const state = await job.popup.evaluate(() =>
            chrome.runtime.sendMessage({ type: "CS_STATUS" }),
          );
          if (state.phase === "error") throw Error(state.message);
          return state.progress;
        },
        { intervals: [50, 100], timeout: 20000 },
      )
      .toBeGreaterThan(0);
    await job.popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_CANCEL" }),
    );
    await expect
      .poll(async () => {
        const state = await job.popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        );
        return state.phase === "error" && /cancelled/.test(state.message);
      })
      .toBe(true);
    await expect.poll(() => snapshot(job.source)).toEqual(job.before);
    checkDocument(await exported(studio, job), job, spec);
  });
}
