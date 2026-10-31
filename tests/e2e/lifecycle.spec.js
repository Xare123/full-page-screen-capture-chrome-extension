import { test, expect } from "./fixtures.js";
import { PNG } from "pngjs";

async function importWhite(page, name, width = 800, height = 600) {
  const png = new PNG({ width, height });
  png.data.fill(255);
  await page.locator("#image-input").setInputFiles({
    name: `${name}.png`,
    mimeType: "image/png",
    buffer: PNG.sync.write(png),
  });
  await expect(page.locator("#editor-view")).toBeVisible();
  await expect(page.locator("#busy-overlay")).toBeHidden();
  return new URL(page.url()).hash.slice(1);
}
async function record(page, id) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("capture-studio", 2);
        open.onsuccess = () => {
          const db = open.result,
            read = db.transaction("projects").objectStore("projects").get(id);
          read.onsuccess = () => {
            const value = read.result;
            db.close();
            resolve(
              value
                ? {
                    title: value.title,
                    revision: value.revision || 0,
                    annotations: value.images[0].annotations,
                  }
                : null,
            );
          };
          read.onerror = () => reject(read.error);
        };
      }),
    id,
  );
}
test("stale editors preserve newer edits and cannot resurrect a deleted capture", async ({
  studio,
}) => {
  const { page: a, context, origin } = studio;
  const id = await importWhite(a, "Original");
  const b = await context.newPage();
  await b.goto(`${origin}/app.html#${id}`);
  await expect(b.locator("#editor-view")).toBeVisible();
  await a.getByRole("button", { name: "Redact", exact: true }).click();
  const box = await a.locator("#overlay-canvas").boundingBox();
  await a.mouse.move(box.x + 30, box.y + 30);
  await a.mouse.down();
  await a.mouse.move(box.x + 100, box.y + 100);
  await a.mouse.up();
  await expect(a.locator("#save-state")).toHaveText("Saved locally");
  await expect(b.locator("#conflict-banner")).toBeVisible();
  await b.locator("#project-title").fill("Stale rename");
  await b.locator("#project-title").press("Tab");
  await expect(b.locator("#save-state")).toHaveText("Unsaved changes");
  const saved = await record(a, id);
  expect(saved.title).toBe("Original");
  expect(saved.annotations.map((a) => a.type)).toEqual(["redact"]);
  await b.locator("#conflict-copy").click();
  await expect(b.locator("#busy-overlay")).toBeHidden();
  await expect(b.locator("#project-title")).toHaveValue("Stale rename (copy)");
  expect(b.url()).not.toContain(id);
  const stale = await context.newPage();
  await stale.goto(`${origin}/app.html#${id}`);
  await expect(stale.locator("#editor-view")).toBeVisible();
  await a.locator("#home-button").click();
  await a.locator(`[data-delete="${id}"]`).click();
  await a.locator("#delete-confirm").click();
  await expect(stale.locator("#conflict-banner")).toBeVisible();
  await expect(stale.locator("#conflict-message")).toContainText("deleted");
  await stale.locator("#project-title").fill("Do not resurrect");
  await stale.locator("#project-title").press("Tab");
  await expect(stale.locator("#save-state")).toHaveText("Unsaved changes");
  expect(await record(a, id)).toBeNull();
  await stale.locator("#conflict-copy").click();
  await expect(stale.locator("#busy-overlay")).toBeHidden();
  expect(stale.url()).not.toContain(id);
  expect(await record(a, id)).toBeNull();
});
test("a pending image decode disables editing and clears the prior canvas gesture", async ({
  studio,
}) => {
  const { page } = studio;
  const first = await importWhite(page, "First");
  await page.locator("#home-button").click();
  await importWhite(page, "Second", 400, 300);
  await page.evaluate(() => {
    const original = window.createImageBitmap;
    window.createImageBitmap = async (...args) => {
      window.decodeStarted = true;
      await new Promise((resolve) => {
        window.releaseDecode = resolve;
      });
      return original(...args);
    };
  });
  await page.locator(`[data-open="${first}"]`).first().click();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.decodeStarted)))
    .toBe(true);
  expect(
    await page.locator("#editor-view").evaluate((node) => node.inert),
  ).toBe(true);
  await page.keyboard.press("c");
  await page.locator("#overlay-canvas").evaluate((node) => {
    node.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
        button: 0,
      }),
    );
    node.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        clientX: 100,
        clientY: 100,
        button: 0,
      }),
    );
  });
  await page.evaluate(() => window.releaseDecode());
  await expect(page.locator("#canvas-viewport")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  expect((await record(page, first)).annotations).toEqual([]);
  await expect(page.locator("#canvas-dimensions")).toHaveText("800 × 600 px");
});
test("transactional conflict checks work even without a change broadcast", async ({
  studio,
}) => {
  const { page } = studio;
  const id = await importWhite(page, "Silent conflict");
  async function silentChange(remove = false) {
    await page.evaluate(
      ({ id, remove }) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("capture-studio", 2);
          open.onsuccess = () => {
            const db = open.result,
              tx = db.transaction("projects", "readwrite"),
              store = tx.objectStore("projects");
            const read = store.get(id);
            read.onsuccess = () => {
              if (remove) store.delete(id);
              else
                store.put({
                  ...read.result,
                  title: "Newer stored title",
                  revision: (read.result.revision || 0) + 1,
                });
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
      { id, remove },
    );
  }
  await silentChange();
  await page.locator("#project-title").fill("Stale attempted title");
  await page.locator("#project-title").press("Tab");
  await expect(page.locator("#conflict-banner")).toBeVisible();
  expect((await record(page, id)).title).toBe("Newer stored title");
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(true);
  await page.locator("#conflict-reload").click();
  await expect(page.locator("#project-title")).toHaveValue(
    "Newer stored title",
  );
  await silentChange(true);
  await page.locator("#project-title").fill("Deleted stale title");
  await page.locator("#project-title").press("Tab");
  await expect(page.locator("#conflict-message")).toContainText("deleted");
  expect(await record(page, id)).toBeNull();
  // Explicitly save the surviving in-memory edits under a new identity before leaving.
  await page.locator("#conflict-copy").click();
  await expect(page.locator("#busy-overlay")).toBeHidden();
});
