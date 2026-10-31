import { test as base, chromium, expect } from "@playwright/test";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const test = base.extend({
  extensionExecutablePath: [undefined, { option: true }],
  studio: async (
    { deviceScaleFactor, extensionExecutablePath, viewport },
    use,
  ) => {
    const dir = await mkdtemp(join(tmpdir(), "capture-studio-test-"));
    const extension = join(dir, "extension");
    let context;
    try {
      await cp("dist", extension, { recursive: true });
      // Automated capture needs the equivalent of clicking the browser action to grant activeTab.
      // Chrome captureVisibleTab accepts only activeTab or <all_urls>, not a single host grant.
      // Only this disposable test copy gets host access; the release has no host permissions.
      const manifest = JSON.parse(
        await readFile(join(extension, "manifest.json"), "utf8"),
      );
      manifest.host_permissions = ["<all_urls>"];
      await writeFile(
        join(extension, "manifest.json"),
        JSON.stringify(manifest),
      );
      context = await chromium.launchPersistentContext(join(dir, "profile"), {
        channel: "chromium",
        ...(extensionExecutablePath
          ? { executablePath: extensionExecutablePath }
          : {}),
        headless: true,
        viewport: viewport || { width: 1440, height: 960 },
        deviceScaleFactor: deviceScaleFactor || 1,
        acceptDownloads: true,
        args: [
          "--no-sandbox",
          `--disable-extensions-except=${extension}`,
          `--load-extension=${extension}`,
        ],
      });
      const worker =
        context.serviceWorkers()[0] ||
        (await context.waitForEvent("serviceworker", { timeout: 20000 }));
      await context.route(/^https?:\/\//, (route) =>
        route.request().url().startsWith("http://127.0.0.1:4173/")
          ? route.continue()
          : route.abort(),
      );
      const origin = worker.url().replace("/background.js", "");
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(`${origin}/app.html`);
      await expect(page.locator("#home-view")).toBeVisible();
      await use({ context, worker, origin, page, errors });
    } finally {
      await context?.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
});
export { expect };
