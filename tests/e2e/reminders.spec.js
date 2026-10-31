import { test, expect } from "./fixtures.js";
test.use({ grantedOptionalPermissions: ["alarms", "notifications"] });
test("real browser alarms notify once and Done clears reminders without a self-conflict", async ({
  studio,
}) => {
  const { page, worker } = studio;
  await page.locator("#nav-notes").click();
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.locator("#note-title").fill("Revisit a capture");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const soon = Date.now() + 3000;
  await page
    .locator("#note-reminder")
    .fill(
      new Date(soon - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19),
    );
  await page.getByRole("button", { name: "Set reminder", exact: true }).click();
  await expect(page.locator("#toast")).toContainText("Reminder scheduled");
  await expect
    .poll(
      () =>
        worker.evaluate(
          async () => Object.keys(await chrome.notifications.getAll()).length,
        ),
      { timeout: 10000 },
    )
    .toBe(1);
  await page
    .locator("#note-reminder")
    .fill(
      new Date(Date.now() + 60000 - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 19),
    );
  await page.getByRole("button", { name: "Set reminder", exact: true }).click();
  await page.getByLabel("Done", { exact: true }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator("#note-title").fill("Done and still editable");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".suite-status")).toHaveText("Saved locally");
  expect(
    await worker.evaluate(async () =>
      (await chrome.alarms.getAll()).filter((a) => a.name.startsWith("note:")),
    ),
  ).toEqual([]);
});
