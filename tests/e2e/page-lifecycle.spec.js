import { test, expect } from "./fixtures.js";
async function terminal(worker) {
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
  return state;
}
test("same-URL navigation during visible capture cannot save pixels from the new document", async ({
  studio,
}) => {
  const { page, context, worker, origin } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.bringToFront();
  const tabId = await worker.evaluate(
    async () =>
      (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
  );
  await worker.evaluate((tabId) => {
    const capture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
    chrome.tabs.captureVisibleTab = async (...args) => {
      await chrome.tabs.reload(tabId);
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 20));
        if ((await chrome.tabs.get(tabId)).status === "complete") break;
      }
      return capture(...args);
    };
  }, tabId);
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "visible" }),
  );
  await terminal(worker);
  expect(
    context.pages().filter((p) => p.url().startsWith(`${origin}/app.html`)),
  ).toHaveLength(1);
  await page.locator("#home-button").click();
  await expect(page.locator(".card-open")).toHaveCount(0);
});
test("a failed page-tools snapshot stops capture before any image is saved", async ({
  studio,
}) => {
  const { page, context, worker } = studio,
    source = await context.newPage();
  await source.goto("http://127.0.0.1:4173");
  await source.bringToFront();
  await page.evaluate(() => chrome.runtime.sendMessage({ type: "CS_PRESENT" }));
  await worker.evaluate(() => {
    const send = chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage = async (id, message, ...rest) => {
      if (message.type === "CS_PRESENT_CAPTURE" && message.action === "hide")
        throw new Error("Test snapshot port failure");
      return send(id, message, ...rest);
    };
  });
  await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "CS_START", mode: "visible" }),
  );
  expect((await terminal(worker)).message).toContain("safe capture");
  await page.locator("#home-button").click();
  await expect(page.locator(".card-open")).toHaveCount(0);
});
