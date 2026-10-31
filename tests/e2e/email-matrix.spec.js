import { test, expect } from "./fixtures.js";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import {
  emailFamilies,
  readerShells,
  emailFixture,
  rowColors,
} from "./email-matrix-fixtures.js";

function pixel(image, x, y) {
  const offset = (Math.round(y) * image.width + Math.round(x)) * 4;
  return [...image.data.subarray(offset, offset + 3)];
}
async function snapshot(source) {
  return source.evaluate(() => ({
    window: [scrollX, scrollY],
    scrolls: ["reading-pane", "reader-wrapper", "folders"].map((id) => {
      const n = document.getElementById(id);
      return [n.scrollLeft, n.scrollTop];
    }),
    styles: [...document.querySelectorAll("body *")].map((n) => [
      n.id,
      n.getAttribute("style"),
      n.getAttribute("data-capture-studio-paint"),
    ]),
  }));
}
async function prepare(studio, shell, family, short = false) {
  const source = await studio.context.newPage();
  await source.goto("http://127.0.0.1:4173/");
  await source.setContent(emailFixture(shell, family, short));
  await source.evaluate(() => {
    document.getElementById("folders").scrollTop = 167;
    document.getElementById("reader-wrapper").scrollTop = 7;
  });
  const points = await source.evaluate(() => {
    const content = document.getElementById("message-content"),
      pane = document.getElementById("reading-pane"),
      r = content.getBoundingClientRect();
    const card = document
      .getElementById("message-card")
      .getBoundingClientRect();
    const position = (element) => {
      const p = element.getBoundingClientRect();
      return { x: p.x - r.x + p.width / 2, y: p.y - r.y + p.height / 2 };
    };
    const divider = document.getElementById("real-divider"),
      media = document.getElementById("email-media");
    return {
      x: r.x,
      y: r.y,
      width: pane.clientWidth,
      height: pane.clientHeight,
      contentHeight: content.offsetHeight,
      border: { x: card.x - r.x + 1, y: card.y - r.y + 12 },
      shadow: { x: card.x - r.x - 8, y: 300 },
      rows: [...document.querySelectorAll(".row-proof")].map(position),
      headings: [...document.querySelectorAll(".reply h2")].map((n) => ({
        ...position(n),
        height: n.getBoundingClientRect().height,
        color: getComputedStyle(n).backgroundColor.match(/\d+/g).map(Number),
      })),
      divider: divider ? position(divider) : null,
      media: media ? position(media) : null,
    };
  });
  await source.bringToFront();
  const reference = PNG.sync.read(await source.screenshot());
  const refScale = reference.width / shell.viewport.width;
  const shadowReference = pixel(
    reference,
    (points.x + points.shadow.x) * refScale,
    (points.y + points.shadow.y) * refScale,
  );
  // Horizontal gradients can dither by one color level between native rows.
  // Use the exact native palette so those real pixels remain valid, while a
  // repeated toolbar shadow introduces colors absent from this clean gutter.
  const gutterReferences = new Set();
  for (let y = 21; y < points.height - 20; y++)
    gutterReferences.add(
      pixel(
        reference,
        (points.x + 12) * refScale,
        (points.y + y) * refScale,
      ).join(),
    );
  const shortReferences = [10, 190].map((y) =>
    pixel(
      reference,
      (points.x + points.width / 2) * refScale,
      (points.y + y) * refScale,
    ),
  );
  await source.evaluate(() => {
    document.getElementById("reading-pane").scrollTop = 187;
  });
  const before = await snapshot(source);
  const popup = await studio.context.newPage();
  await popup.goto(`${studio.origin}/popup.html`);
  await source.bringToFront();
  return {
    source,
    popup,
    before,
    points,
    shadowReference,
    gutterReferences,
    shortReferences,
  };
}
async function capture(studio, job) {
  expect(
    await job.popup.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_START", mode: "full" }),
    ),
  ).toEqual({ ok: true });
  let state;
  await expect
    .poll(
      async () => {
        state = await job.popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "CS_STATUS" }),
        );
        if (state.phase === "error") throw new Error(state.message);
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
          (p) => p.url() === `${studio.origin}/app.html#${state.projectId}`,
        );
      return Boolean(editor);
    })
    .toBe(true);
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const download = editor.waitForEvent("download");
  await editor.locator("#export-button").click();
  const image = PNG.sync.read(await readFile(await (await download).path()));
  await expect.poll(() => snapshot(job.source)).toEqual(job.before);
  return image;
}

for (const shell of readerShells) {
  test.describe(shell.name, () => {
    test.use({ viewport: shell.viewport });
    for (const family of emailFamilies) {
      test(`${family.name} retains all message content, decoration and clean capture joins`, async ({
        studio,
      }) => {
        const job = await prepare(studio, shell, family);
        const image = await capture(studio, job);
        const scale = image.width / job.points.width;
        expect(image.height).toBe(Math.round(1440 * scale));
        expect(pixel(image, image.width / 2, 10 * scale)).toEqual([
          118, 51, 188,
        ]);
        expect(
          pixel(image, image.width / 2, image.height - 10 * scale),
        ).toEqual([230, 119, 72]);
        job.points.rows.forEach((p, i) =>
          expect(pixel(image, p.x * scale, p.y * scale)).toEqual(rowColors[i]),
        );
        expect(
          pixel(
            image,
            job.points.border.x * scale,
            job.points.border.y * scale,
          ),
        ).toEqual([65, 85, 110]);
        expect(
          pixel(
            image,
            job.points.shadow.x * scale,
            job.points.shadow.y * scale,
          ),
        ).toEqual(job.shadowReference);
        expect(
          pixel(
            image,
            job.points.divider.x * scale,
            job.points.divider.y * scale,
          ),
        ).toEqual([25, 125, 85]);
        let dirtyRows = 0;
        for (
          let y = Math.ceil(21 * scale);
          y < image.height - Math.ceil(21 * scale);
          y++
        ) {
          if (!job.gutterReferences.has(pixel(image, 12 * scale, y).join()))
            dirtyRows++;
        }
        expect(
          dirtyRows,
          "the complete message gutter must not contain repeated toolbar or seam paint",
        ).toBe(0);
        for (const h of job.points.headings) {
          let paintedRows = 0;
          for (let y = 0; y < image.height; y++)
            if (pixel(image, h.x * scale, y).join() === h.color.join())
              paintedRows++;
          expect(
            paintedRows,
            "each reply heading appears once, without repeated sticky copies",
          ).toBeGreaterThanOrEqual(Math.floor(h.height * scale));
          expect(
            paintedRows,
            "each reply heading appears once, without repeated sticky copies",
          ).toBeLessThanOrEqual(Math.ceil(h.height * scale) + 1);
        }
        if (family.image || family.deferredImage) {
          expect(
            pixel(
              image,
              job.points.media.x * scale,
              job.points.media.y * scale,
            ),
          ).toEqual([40, 130, 170]);
          expect(
            await job.source
              .locator("#email-media")
              .evaluate((img) => img.complete && img.naturalWidth === 300),
          ).toBe(true);
        }
        if (shell.dynamic)
          expect(
            await job.source.locator("#site-shell").getAttribute("class"),
          ).toContain("reader-v2");
      });
    }
    for (const state of ["short", "empty"]) {
      test(`${state} email preserves the whole app instead of capturing a long folder list`, async ({
        studio,
      }) => {
        const job = await prepare(
          studio,
          shell,
          {
            name: state,
            html:
              state === "short"
                ? "<h1>Example short email</h1><p>The complete message fits.</p>"
                : "",
          },
          true,
        );
        const image = await capture(studio, job);
        const scale = image.width / shell.viewport.width;
        expect(image.height).toBe(Math.round(shell.viewport.height * scale));
        expect(
          pixel(
            image,
            (job.points.x + job.points.width / 2) * scale,
            (job.points.y + 10) * scale,
          ),
        ).toEqual(job.shortReferences[0]);
        expect(
          pixel(
            image,
            (job.points.x + job.points.width / 2) * scale,
            (job.points.y + 190) * scale,
          ),
        ).toEqual(job.shortReferences[1]);
      });
    }
  });
}
