import { test, expect } from "./fixtures.js";
import { openImage } from "./editor-helpers.js";
import AxeBuilder from "@axe-core/playwright";
for (const [width, height] of [
  [320, 740],
  [390, 844],
  [768, 800],
  [1280, 600],
  [1440, 960],
  [1920, 1080],
]) {
  test(`workspace controls reflow and remain reachable at ${width}x${height}`, async ({
    studio,
  }, info) => {
    const { page, errors } = studio;
    await page.setViewportSize({ width, height });
    await expect(page.locator("#import-button svg")).toBeVisible();
    for (const view of ["recordings", "whiteboards", "notes", "guide"]) {
      const nav = page.locator(`#nav-${view}`);
      await nav.scrollIntoViewIfNeeded();
      await expect(nav.locator("svg")).toBeVisible();
      const box = await nav.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      await nav.click();
      await expect
        .poll(() =>
          page.evaluate(() => document.body.scrollWidth <= innerWidth),
        )
        .toBeTruthy();
      await expect(page.locator("#suite-view")).toBeVisible();
    }
    await page.locator("#home-button").click();
    await openImage(page);
    const header = await page.locator(".editor-heading").boundingBox(),
      actions = await page.locator(".suite-editor-actions").boundingBox();
    expect(actions.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(actions.x).toBeGreaterThanOrEqual(header.x);
    for (const label of [
      "Pan",
      "Select text",
      "Select objects",
      "Text",
      "Callout",
      "Crop",
    ]) {
      const button = page.getByRole("button", { name: label, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toHaveAttribute("aria-label", label);
      await expect(button.locator("svg")).toBeVisible();
      if (width > 740)
        await expect(button.locator(".tool-label")).toBeVisible();
      const b = await button.boundingBox();
      expect(b.width).toBeGreaterThanOrEqual(38);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width + 1);
    }
    await page
      .getByRole("button", { name: "Select objects", exact: true })
      .click();
    await expect(
      page
        .locator(".object-panel")
        .getByRole("button", { name: "Duplicate", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .locator(".object-panel")
        .getByRole("button", { name: "Edit text", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`editor-${width}.png`),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
test("recording, whiteboard, notes and guide meet automated WCAG A/AA checks", async ({
  studio,
}) => {
  test.setTimeout(90000);
  const { page } = studio;
  for (const name of ["recordings", "whiteboards", "notes", "guide"]) {
    await page.locator(`#nav-${name}`).click();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          reason: n.failureSummary,
        })),
      })),
      name,
    ).toEqual([]);
  }
});
