import { test, expect } from "./fixtures.js";
import { saved, exportFile } from "./editor-helpers.js";
import { PNG } from "pngjs";
async function clickAX(context, page, name) {
  const client = await context.newCDPSession(page),
    { nodes } = await client.send("Accessibility.getFullAXTree"),
    node = nodes.find(
      (n) => n.role?.value === "button" && n.name?.value === name,
    );
  expect(node).toBeTruthy();
  const { object } = await client.send("DOM.resolveNode", {
    backendNodeId: node.backendDOMNodeId,
  });
  await client.send("Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration: "function(){this.click();}",
  });
  await client.detach();
}
async function captureEditor(studio, options) {
  await studio.page.evaluate(
    (options) => chrome.runtime.sendMessage({ type: "CS_START", ...options }),
    options,
  );
  let result;
  await expect
    .poll(
      async () => {
        result = await studio.worker.evaluate(
          async () =>
            (await chrome.storage.session.get("captureStatus")).captureStatus,
        );
        if (result?.phase === "error") throw new Error(result.message);
        return result?.phase;
      },
      { timeout: 20000, intervals: [80] },
    )
    .toBe("done");
  let editor;
  await expect
    .poll(() => {
      editor = studio.context
        .pages()
        .find((p) => p.url().endsWith(`#${result.projectId}`));
      return !!editor;
    })
    .toBeTruthy();
  return editor;
}
test("on-page redactions become editable layers at the original email scroll position", async ({
  studio,
}) => {
  const { context, page } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173/email");
  const origin = await source.evaluate(() => {
    const pane = document.getElementById("reading-pane");
    pane.scrollTop = 333;
    const r = pane.getBoundingClientRect();
    return {
      x: r.x + pane.clientLeft,
      y: r.y + pane.clientTop,
      scroll: pane.scrollTop,
    };
  });
  await source.bringToFront();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_PRESENT" }));
  await clickAX(context, source, "Redact");
  await source.mouse.move(950, 300);
  await source.mouse.down();
  await source.mouse.move(1150, 380);
  await source.mouse.up();
  const editor = await captureEditor(studio, { mode: "full", scope: "auto" });
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
    { timeout: 20000 },
  );
  const project = await saved(editor);
  expect(
    project.images[0].annotations.some((a) => a.type === "redact"),
  ).toBeTruthy();
  const output = await exportFile(editor),
    png = PNG.sync.read(output.bytes),
    x = Math.round(1050 - origin.x),
    y = Math.round(340 - origin.y + origin.scroll),
    at = (x, y) => [
      ...png.data.subarray(
        (y * png.width + x) * 4,
        (y * png.width + x) * 4 + 4,
      ),
    ];
  expect(at(x, y)).toEqual([17, 17, 17, 255]);
  expect(at(x, y + 1000)).not.toEqual([17, 17, 17, 255]);
  expect(
    await source.locator("#reading-pane").evaluate((p) => p.scrollTop),
  ).toBe(333);
  await expect(
    source.locator("[data-capture-studio-presentation]"),
  ).toBeVisible();
});
test("page annotation text stays inside the closed shadow and remains editable after capture", async ({
  studio,
}) => {
  const { context, page } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.evaluate(() => scrollTo(0, 300));
  await source.bringToFront();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_PRESENT" }));
  await clickAX(context, source, "Text");
  await source.mouse.click(700, 300);
  await source.keyboard.type("LOCAL ANNOTATION 8317");
  await source.keyboard.press("Control+Enter");
  expect(await source.locator("body").textContent()).not.toContain(
    "LOCAL ANNOTATION 8317",
  );
  const editor = await captureEditor(studio, { mode: "visible" });
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const project = await saved(editor),
    text = project.images[0].annotations.find((a) => a.type === "text");
  expect(text).toMatchObject({
    text: "LOCAL ANNOTATION 8317",
    layoutVersion: 2,
  });
  await editor
    .getByRole("button", { name: "Select text", exact: true })
    .click();
  await editor.locator("#text-object-select").selectOption("0");
  await expect(editor.locator("#text-edit")).toBeEnabled();
});

for (const kind of ["fixed", "sticky"])
  test(`full capture refuses a displaced on-page mask over ${kind} content`, async ({
    studio,
  }) => {
    const { page, context, worker, origin } = studio,
      source = await context.newPage();
    await source.goto(
      kind === "sticky"
        ? "http://127.0.0.1:4173/email"
        : "http://127.0.0.1:4173",
    );
    if (kind === "fixed") {
      await source.setContent(
        "<style>body{height:4000px;margin:0}header{position:fixed;left:700px;top:200px;width:500px;height:80px;background:#fff}</style><header>PRIVATE FIXED LABEL</header><p>Long source fixture</p>",
      );
      await source.evaluate(() => scrollTo(0, 500));
    } else
      await source
        .locator("#reading-pane")
        .evaluate((p) => (p.scrollTop = 333));
    await source.bringToFront();
    await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CS_PRESENT" }),
    );
    await clickAX(context, source, "Redact");
    const y = kind === "sticky" ? 130 : 205;
    await source.mouse.move(800, y);
    await source.mouse.down();
    await source.mouse.move(1100, y + 30);
    await source.mouse.up();
    await page.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "CS_START",
        mode: "full",
        scope: "auto",
      }),
    );
    let state;
    await expect
      .poll(
        async () => {
          state = await worker.evaluate(
            async () =>
              (await chrome.storage.session.get("captureStatus")).captureStatus,
          );
          return state?.phase;
        },
        { timeout: 15000 },
      )
      .toBe("error");
    expect(state.message).toContain("on-page redactions");
    expect(
      context.pages().filter((p) => p.url().startsWith(`${origin}/app.html`)),
    ).toHaveLength(1);
    await expect(
      source.locator("[data-capture-studio-presentation]"),
    ).toBeVisible();
  });
test("fading ink never weakens redactions and an active mask draft is included", async ({
  studio,
}) => {
  const { page, context } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.bringToFront();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_PRESENT" }));
  await clickAX(context, source, "More");
  await clickAX(context, source, "Fading ink");
  await clickAX(context, source, "Redact");
  await source.mouse.move(800, 300);
  await source.mouse.down();
  await source.mouse.move(1000, 400);
  const editor = await captureEditor(studio, { mode: "visible" });
  await source.mouse.up();
  await expect(editor.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const project = await saved(editor);
  expect(
    project.images[0].annotations.filter((a) => a.type === "redact"),
  ).toHaveLength(1);
  const output = await exportFile(editor),
    png = PNG.sync.read(output.bytes),
    at = (350 * png.width + 900) * 4;
  expect([...png.data.subarray(at, at + 4)]).toEqual([17, 17, 17, 255]);
});
