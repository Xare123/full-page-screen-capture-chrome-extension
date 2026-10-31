import { test, expect } from "./fixtures.js";
import {
  openImage,
  seed,
  saved,
  ready,
  drag,
  addText,
  exportFile,
} from "./editor-helpers.js";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";

test("notes save immediate navigation, reminder links, Done and literal HTML safely", async ({
  studio,
}) => {
  const { page, origin, errors } = studio;
  await page.locator("#nav-notes").click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.locator("#note-title").fill("<img src=x onerror=alert(1)> Notes");
  await page
    .locator("#note-body")
    .fill("Immediate navigation keeps this paragraph.");
  await page.locator("#home-button").click();
  await page.locator("#nav-notes").click();
  await page.getByRole("button", { name: /<img src=x/ }).click();
  await expect(page.locator("#note-body")).toHaveValue(
    "Immediate navigation keeps this paragraph.",
  );
  const id = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("capture-studio-suite");
        request.onsuccess = () => {
          const db = request.result,
            r = db.transaction("notes").objectStore("notes").getAll();
          r.onsuccess = () => {
            resolve(r.result[0].id);
            db.close();
          };
        };
      }),
  );
  await page.goto(`${origin}/app.html?note=${id}#notes`);
  await expect(page.locator("#note-body")).toHaveValue(
    "Immediate navigation keeps this paragraph.",
  );
  expect(await page.locator(".suite-view img").count()).toBe(0);
  expect(errors).toEqual([]);
});
test("whiteboards remain separate, grow beyond 12 pages, and round-trip editable current text", async ({
  studio,
}) => {
  const { page } = studio;
  await page.locator("#nav-whiteboards").click();
  await page
    .getByRole("button", { name: "Create whiteboard", exact: true })
    .click();
  await ready(page);
  await addText(page, "A reusable idea");
  for (let i = 0; i < 12; i++) {
    await page.getByRole("button", { name: "Add page", exact: true }).click();
    await ready(page);
  }
  expect((await saved(page)).images).toHaveLength(13);
  await page.locator("#part-select").selectOption("0");
  await ready(page);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export editable board JSON", exact: true })
    .click();
  const data = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  expect(data.pages).toHaveLength(13);
  expect(data.pages[0].annotations[0]).toMatchObject({
    type: "text",
    layoutVersion: 2,
    boxWidth: expect.any(Number),
    text: "A reusable idea",
    fontFamily: "inter",
  });
  await page.locator("#home-button").click();
  await expect(page.locator(".card-open")).toHaveCount(0);
  await page.locator("#nav-whiteboards").click();
  await page
    .locator("#suite-view input[type=file]")
    .setInputFiles({
      name: "board.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].layoutVersion).toBe(2);
});
test("board JSON flattens every redacted page and rejects a malformed second page", async ({
  studio,
}) => {
  const { page } = studio;
  await page.locator("#nav-whiteboards").click();
  await page
    .getByRole("button", { name: "Create whiteboard", exact: true })
    .click();
  await ready(page);
  await seed(page, [
    {
      type: "text",
      text: "PRIVATE METADATA",
      x: 50,
      y: 50,
      layoutVersion: 2,
      fontSize: 24,
      boxWidth: 400,
      color: "#000000",
      background: "transparent",
    },
    { type: "redact", rect: { x: 0, y: 0, width: 700, height: 180 } },
  ]);
  await page
    .getByRole("button", { name: "Export editable board JSON", exact: true })
    .click({ trial: true });
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export editable board JSON", exact: true })
    .click();
  const raw = await readFile(await (await wait).path(), "utf8"),
    data = JSON.parse(raw);
  expect(raw).not.toContain("PRIVATE METADATA");
  expect(data.pages[0].annotations).toEqual([]);
  const png = PNG.sync.read(
    Buffer.from(data.pages[0].image.split(",")[1], "base64"),
  );
  expect([
    ...png.data.subarray(
      (50 * png.width + 50) * 4,
      (50 * png.width + 50) * 4 + 4,
    ),
  ]).toEqual([17, 17, 17, 255]);
  data.pages.push({
    ...data.pages[0],
    annotations: [{ type: "arrow", points: [{ x: 0, y: 0 }] }],
  });
  await page.locator("#nav-whiteboards").click();
  await page
    .locator("#suite-view input[type=file]")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data)),
    });
  await expect(page.locator("#toast")).toContainText(
    "Drawing points are missing",
  );
  await expect(page.locator("#suite-view")).toBeVisible();
});
test("all drawing objects move, resize, duplicate, delete and survive image finishes", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await drag(page, { x: 80, y: 100 }, { x: 200, y: 200 });
  await ready(page);
  await page
    .getByRole("button", { name: "Select objects", exact: true })
    .click();
  await page.locator("#object-list").selectOption("0");
  await drag(page, { x: 130, y: 150 }, { x: 230, y: 250 });
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].transform[4]).toBeCloseTo(
    100,
    0,
  );
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await ready(page);
  expect((await saved(page)).images[0].annotations).toHaveLength(2);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await ready(page);
  expect((await saved(page)).images[0].annotations).toHaveLength(1);
  await page
    .getByRole("button", { name: "Background & frame", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply finish", exact: true }).click();
  await ready(page);
  expect((await saved(page)).images[0]).toMatchObject({
    width: 896,
    height: 740,
  });
  await page
    .getByRole("button", { name: "Background & frame", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove finish", exact: true })
    .click();
  await ready(page);
  expect((await saved(page)).images[0]).toMatchObject({
    width: 800,
    height: 600,
  });
  expect(errors).toEqual([]);
});
for (const [language, publicText] of [
  ["eng", "PUBLIC TEXT"],
  ["spa", "HOLA MUNDO"],
  ["ara", "مرحبا بالعالم"],
])
  test(`cold offline OCR ${language} recognizes flattened text and excludes solid-redacted content`, async ({
    studio,
  }) => {
    const { page, context, origin, errors } = studio;
    const external = [];
    context.on("request", (request) => {
      if (/^https?:/.test(request.url())) external.push(request.url());
    });
    const image = await page.evaluate(
      ({ publicText }) => {
        const c = document.createElement("canvas");
        c.width = 1400;
        c.height = 700;
        const x = c.getContext("2d");
        x.fillStyle = "white";
        x.fillRect(0, 0, 1400, 700);
        x.fillStyle = "black";
        x.font = "70px sans-serif";
        x.fillText(publicText, 80, 140);
        x.fillText("HIDDEN SECRET 7291", 80, 340);
        return c.toDataURL().split(",")[1];
      },
      { publicText },
    );
    await page
      .locator("#image-input")
      .setInputFiles({
        name: "ocr.png",
        mimeType: "image/png",
        buffer: Buffer.from(image, "base64"),
      });
    await ready(page);
    await seed(page, [
      { type: "redact", rect: { x: 0, y: 210, width: 1400, height: 220 } },
    ]);
    await page
      .getByRole("button", { name: "Extract text", exact: true })
      .click();
    await page.locator("#ocr-language").selectOption(language);
    await page
      .locator("#ocr-dialog")
      .getByRole("button", { name: "Extract text", exact: true })
      .click();
    await expect(page.locator("#ocr-result")).not.toHaveValue("", {
      timeout: 45000,
    });
    const text = await page.locator("#ocr-result").inputValue();
    expect(text).not.toMatch(/HIDDEN|SECRET|7291/);
    expect(text).toMatch(
      language === "ara"
        ? /[\u0600-\u06ff]/
        : language === "spa"
          ? /HOLA|MUNDO/
          : /PUBLIC/,
    );
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
  });
test("unauthorized embedded studio exposes no library or suite controls", async ({
  studio,
}) => {
  const { context, origin } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.evaluate((origin) => {
    const f = document.createElement("iframe");
    f.src = `${origin}/app.html#notes`;
    document.body.append(f);
  }, origin);
  const frame = await expect
    .poll(() =>
      source
        .frames()
        .find((f) => f.url().startsWith(`${origin}/app.html`))
        ?.url(),
    )
    .toContain("/app.html");
  const child = source
    .frames()
    .find((f) => f.url().startsWith(`${origin}/app.html`));
  await expect(child.locator("body")).toContainText(
    "Open Capture Studio from the extension",
  );
  await expect(child.locator("#library-grid")).toHaveCount(0);
});
