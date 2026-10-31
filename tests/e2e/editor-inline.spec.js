import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";
import {
  openImage,
  ready,
  screen,
  saved,
  addText,
  change,
  selectText,
  seed,
  exportFile,
  pixel,
  crop,
} from "./editor-helpers.js";

async function start(page, text, p = { x: 60, y: 70 }) {
  await page.getByRole("button", { name: "Text", exact: true }).click();
  const at = await screen(page, p);
  await page.mouse.click(at.x, at.y);
  await expect(page.locator("#annotation-text")).toBeFocused();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  if (text !== undefined) await page.locator("#annotation-text").fill(text);
}
function ink(png) {
  const positions = [];
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] > 180 && png.data[i + 1] < 90 && png.data[i + 2] < 90)
        positions.push([x, y]);
    }
  return positions;
}
function nearFraction(a, b) {
  const pixels = new Set(b.map(([x, y]) => `${x},${y}`));
  return (
    a.filter(([x, y]) =>
      [-1, 0, 1].some((dx) =>
        [-1, 0, 1].some((dy) => pixels.has(`${x + dx},${y + dy}`)),
      ),
    ).length / a.length
  );
}

test("new inline text defaults to local Inter, charcoal and clear; style changes stay one cancellable transaction", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const before = await saved(page);
  await start(page, "Direct typing");
  await expect(page.locator("#text-transparent")).toBeChecked();
  await expect(page.locator("#text-font")).toHaveValue("inter");
  await expect(page.locator("#annotation-color")).toHaveValue("#1f2937");
  await expect(page.locator("#font-size")).toHaveValue("24");
  await change(page, "text-background", "#ffe000");
  await expect(page.locator("#inline-text-frame")).toBeVisible();
  await expect(page.locator("#text-transparent")).not.toBeChecked();
  expect(await saved(page)).toEqual(before);
  await page.locator("#text-cancel").click();
  expect(await saved(page)).toEqual(before);
  await start(page, "Keep this text");
  await page.locator("#text-transparent").check();
  await page.locator("#text-done").click();
  await ready(page);
  const a = (await saved(page)).images[0].annotations[0];
  expect(a).toMatchObject({
    text: "Keep this text",
    fontFamily: "inter",
    fontWeight: 500,
    color: "#1f2937",
    background: "transparent",
    layoutVersion: 2,
  });
  await expect(
    page.getByRole("button", { name: "Select text", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await change(page, "text-background", "#00ff00");
  let png = PNG.sync.read((await exportFile(page)).bytes);
  expect(pixel(png, a.x + 1, a.y + 1)).toEqual([0, 255, 0, 255]);
  await page.locator("#text-transparent").check();
  await ready(page);
  png = PNG.sync.read((await exportFile(page)).bytes);
  expect(pixel(png, a.x + 1, a.y + 1)).toEqual([35, 90, 140, 255]);
  await page.reload();
  await ready(page);
  await selectText(page);
  await expect(page.locator("#text-transparent")).toBeChecked();
  expect(errors).toEqual([]);
});

test("Enter, native undo, Escape, blank deletion and application undo keep separate transactions", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await start(page);
  await page.locator("#annotation-text").pressSequentially("First line");
  await page.keyboard.press("Enter");
  await page.locator("#annotation-text").pressSequentially("Second line");
  await expect(page.locator("#annotation-text")).toHaveValue(
    "First line\nSecond line",
  );
  await page.keyboard.press("Control+z");
  await expect(page.locator("#annotation-text")).not.toHaveValue(
    "First line\nSecond line",
  );
  expect((await saved(page)).images[0].annotations).toEqual([]);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator("#annotation-text")).toHaveValue(
    "First line\nSecond line",
  );
  await page.keyboard.press("Control+Enter");
  await ready(page);
  const original = (await saved(page)).images[0].annotations[0];
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Discard");
  await page.keyboard.press("Escape");
  expect((await saved(page)).images[0].annotations[0]).toEqual(original);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("");
  await page.locator("#text-done").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations).toEqual([]);
  await page.locator("#undo-button").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0]).toEqual(original);
  expect(errors).toEqual([]);
});

test("native text selection, context menu and fractional zoom retain the caret without panning", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await start(page, "Select these words");
  await page
    .locator("#annotation-text")
    .evaluate((el) => el.setSelectionRange(2, 9));
  for (let i = 0; i < 3; i++) await page.locator("#zoom-out").click();
  const selection = await page
    .locator("#annotation-text")
    .evaluate((el) => [el.selectionStart, el.selectionEnd]);
  expect(selection).toEqual([2, 9]);
  await page.locator("#annotation-text").click({ button: "right" });
  await expect(page.locator("#image-menu")).toBeHidden();
  await page.locator("#annotation-text").focus();
  await page.keyboard.press("Control+Enter");
  await ready(page);
  expect(errors).toEqual([]);
});

for (const text of [
  "\n  leading  spaces\nand trailing newline\n",
  "word".repeat(28) + " 👨‍👩‍👧‍👦 漢字 café",
  "שלום עולם — مرحبا بالعالم",
  "Hello שלום 123 — مرحبا world",
  "\tשלום\tworld\nمرحبا\t123 end",
])
  test(`native textarea and exported glyphs agree: ${JSON.stringify(text).slice(0, 65)}`, async ({
    studio,
  }, testInfo) => {
    const { page, errors } = studio;
    await openImage(page);
    await start(page, text);
    await change(page, "annotation-color", "#ff0000");
    await page.locator("#text-box-width").fill("260");
    await page.locator("#text-box-width").press("Tab");
    // The box has native focus/caret during capture; suppress only its blinking caret.
    await page.locator("#annotation-text").focus();
    await page
      .locator("#annotation-text")
      .evaluate((el) => (el.style.caretColor = "transparent"));
    const scale = await page
      .locator("#canvas-stage")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().width /
          document.querySelector("#base-canvas").width,
      );
    // At the default 1440px test viewport this 800px image is shown at 100%.
    expect(scale).toBeCloseTo(1, 3);
    const editing = PNG.sync.read(
      await page.locator("#canvas-stage").screenshot(),
    );
    await page.keyboard.press("Control+Enter");
    await ready(page);
    const exported = PNG.sync.read((await exportFile(page)).bytes),
      a = ink(editing),
      b = ink(exported);
    await testInfo.attach("native-typing.png", {
      body: PNG.sync.write(editing),
      contentType: "image/png",
    });
    await testInfo.attach("exported-text.png", {
      body: PNG.sync.write(exported),
      contentType: "image/png",
    });
    expect(a.length).toBeGreaterThan(80);
    expect(b.length).toBeGreaterThan(80);
    expect(nearFraction(a, b)).toBeGreaterThan(0.98);
    expect(nearFraction(b, a)).toBeGreaterThan(0.98);
    expect((await saved(page)).images[0].annotations[0].text).toBe(text);
    expect(errors).toEqual([]);
  });

test("IME commit waits for final composition input before export; clipboard activation remains immediate", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await start(page, "候補");
  await page
    .locator("#annotation-text")
    .dispatchEvent("compositionstart", { data: "候補" });
  // Synthetic composition deliberately finishes after the export click.
  await page.locator("#export-button").click();
  await expect(page.locator("#inline-text-frame")).toBeVisible();
  expect((await saved(page)).images[0].annotations).toEqual([]);
  const download = page.waitForEvent("download");
  await page.locator("#annotation-text").evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "確定済み",
      }),
    );
    return Promise.resolve().then(() => {
      el.value = "確定済み";
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "確定済み",
        }),
      );
    });
  });
  await download;
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].text).toBe("確定済み");
  await selectText(page);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Copied final");
  await page.evaluate(() => {
    window.clipboardInvocation = null;
    Object.defineProperty(navigator.clipboard, "write", {
      configurable: true,
      value(items) {
        window.clipboardInvocation = {
          immediate: !document.querySelector("#busy-overlay").hidden,
        };
        window.clipboardBlob = items[0].getType("image/png");
        return window.clipboardBlob.then(() => {});
      },
    });
  });
  await page
    .locator("#annotation-text")
    .dispatchEvent("compositionstart", { data: "Copied final" });
  await page.locator("#copy-button").click();
  expect(await page.evaluate(() => Boolean(window.clipboardInvocation))).toBe(
    true,
  );
  await page.locator("#annotation-text").evaluate((el) => {
    el.value = "Copied with IME";
    el.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "Copied with IME",
      }),
    );
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  await expect(page.locator("#toast")).toHaveText("Image copied to clipboard.");
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].text).toBe(
    "Copied with IME",
  );
  expect(errors).toEqual([]);
});

test("typing preserves later annotation layers and final redactions, including forced colors", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const a = await addText(page, "Covered glyphs", { x: 100, y: 100 });
  await seed(page, [
    a,
    {
      type: "text",
      x: 100,
      y: 100,
      boxWidth: 360,
      boxHeight: 80,
      text: "",
      fontSize: 24,
      color: "#000000",
      background: "#00ff00",
    },
    { type: "redact", rect: { x: 110, y: 110, width: 50, height: 30 } },
  ]);
  await selectText(page, 0);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Edited behind the cover");
  for (const forcedColors of ["none", "active"]) {
    await page.emulateMedia({ forcedColors });
    const screenshot = PNG.sync.read(
      await page.locator("#canvas-stage").screenshot(),
    );
    expect(pixel(screenshot, 150, 150)).toEqual([0, 255, 0, 255]);
    expect(pixel(screenshot, 120, 120)).toEqual([17, 17, 17, 255]);
  }
  await page.emulateMedia({ forcedColors: "none" });
  await page.locator("#text-done").click();
  await ready(page);
  expect(errors).toEqual([]);
});

test("unchanged legacy edits are pixel and record exact, including after cancellation", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const a = {
    type: "text",
    x: 70,
    y: 80,
    text: "Legacy text",
    fontSize: 28,
    color: "#7955e8",
  };
  await seed(page, [a]);
  const before = (await exportFile(page)).bytes;
  await selectText(page);
  await page.locator("#text-edit").click();
  await page.locator("#text-done").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0]).toEqual(a);
  expect((await exportFile(page)).bytes.equals(before)).toBe(true);
  await selectText(page);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Discarded text");
  await page.locator("#text-cancel").click();
  expect((await saved(page)).images[0].annotations[0]).toEqual(a);
  expect(errors).toEqual([]);
});

test("rotated text keeps its native glyph positions and selection at fractional zoom", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  await addText(page, "Rotation stays editable", { x: 160, y: 140 });
  await crop(page, { x: 80, y: 60, width: 600, height: 400 });
  await page.locator("#rotate-button").click();
  await ready(page);
  await selectText(page);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Rotated שלום\nsecond line");
  await change(page, "annotation-color", "#ff0000");
  await page
    .locator("#annotation-text")
    .evaluate((el) => el.setSelectionRange(2, 8));
  await page.locator("#zoom-out").click();
  await page.locator("#zoom-out").click();
  expect(
    await page
      .locator("#annotation-text")
      .evaluate((el) => [el.selectionStart, el.selectionEnd]),
  ).toEqual([2, 8]);
  await page.locator("#annotation-text").focus();
  await page.locator("#annotation-text").evaluate((el) => {
    el.setSelectionRange(el.value.length, el.value.length);
    el.style.caretColor = "transparent";
  });
  const typing = PNG.sync.read(
    await page.locator("#canvas-stage").screenshot(),
  );
  await page.keyboard.press("Control+Enter");
  await ready(page);
  const committed = PNG.sync.read(
    await page.locator("#canvas-stage").screenshot(),
  );
  const a = ink(typing),
    b = ink(committed);
  expect(a.length).toBeGreaterThan(80);
  expect(b.length).toBeGreaterThan(80);
  expect(nearFraction(a, b)).toBeGreaterThan(0.98);
  expect(nearFraction(b, a)).toBeGreaterThan(0.98);
  await page.reload();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0].text).toBe(
    "Rotated שלום\nsecond line",
  );
  expect(errors).toEqual([]);
});

test("Cancel also cancels an export waiting on composition, and Delete undoes once to the original object", async ({
  studio,
}) => {
  const { page, errors } = studio;
  await openImage(page);
  const original = await addText(page, "Original before edit");
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Uncommitted words");
  await page
    .locator("#annotation-text")
    .dispatchEvent("compositionstart", { data: "Uncommitted words" });
  const downloads = [];
  page.on("download", (file) => downloads.push(file));
  await page.locator("#export-button").click();
  await page.locator("#text-cancel").click();
  await ready(page);
  await page
    .locator("#annotation-text")
    .dispatchEvent("compositionend", { data: "Uncommitted words" });
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(downloads).toEqual([]);
  expect((await saved(page)).images[0].annotations[0]).toEqual(original);
  await page.locator("#text-edit").click();
  await page.locator("#annotation-text").fill("Will be deleted");
  await page.locator("#text-delete").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations).toEqual([]);
  await page.locator("#undo-button").click();
  await ready(page);
  expect((await saved(page)).images[0].annotations[0]).toEqual(original);
  expect(errors).toEqual([]);
});


test("paragraph bidi survives wrapping around neutral punctuation, numerals, Arabic joins and isolates", async ({studio}, testInfo) => {
  test.setTimeout(120000);
  const {page, errors} = studio;
  await openImage(page);
  await start(page, "Hello שלום 123 — مرحبا world");
  await change(page, "annotation-color", "#ff0000");
  const cases = [
    ...[172,188,210,228,248,260,292,320].map(width => ({text:"Hello שלום 123 — مرحبا world",width})),
    {text:"مرحبا (123) שלום — Hello ٤٥٦ end",width:230},
    {text:"سلام لا لَا مُرَحَّبًا — 123 abc",width:188},
    {text:"A \u2067שלום (123) مرحبا\u2069 Z",width:210},
    {text:"A \u202eabc (123)\u202c Z",width:172},
    {text:"A \u202dשלום (123) مرحبا\u202c Z",width:210},
    {text:"A \u2067שלום \u202dمرحبا (123)\u202c\u2069 Z",width:188},
    {text:"עברית\t123 (test) — مرحبا\nNext שלום!",width:210},
  ];
  const evidence=[];
  for(let i=0;i<cases.length;i++){
    const c=cases[i];
    if(i) await page.locator("#text-edit").click();
    await page.locator("#annotation-text").fill(c.text);
    await change(page,"text-box-width",c.width);
    await page.locator("#annotation-text").focus();
    await page.locator("#annotation-text").evaluate(el=>el.style.caretColor="transparent");
    const typing=PNG.sync.read(await page.locator("#canvas-stage").screenshot());
    await page.keyboard.press("Control+Enter"); await ready(page);
    const exported=PNG.sync.read((await exportFile(page)).bytes), a=ink(typing), b=ink(exported);
    const forward=nearFraction(a,b), reverse=nearFraction(b,a);
    evidence.push({...c,forward,reverse,typingPixels:a.length,exportedPixels:b.length});
    if(forward<=.98||reverse<=.98){
      await testInfo.attach("native-bidi-"+i+".png",{body:PNG.sync.write(typing),contentType:"image/png"});
      await testInfo.attach("exported-bidi-"+i+".png",{body:PNG.sync.write(exported),contentType:"image/png"});
    }
    expect(a.length,JSON.stringify(c)).toBeGreaterThan(80);
    expect(b.length,JSON.stringify(c)).toBeGreaterThan(80);
    expect(forward,JSON.stringify(c)).toBeGreaterThan(.98);
    expect(reverse,JSON.stringify(c)).toBeGreaterThan(.98);
  }
  await testInfo.attach("bidi-wrapping-cases",{body:JSON.stringify(evidence),contentType:"application/json"});
  expect(errors).toEqual([]);
});
