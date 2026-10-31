import { test, expect } from "./fixtures.js";
import AxeBuilder from "@axe-core/playwright";
import { PNG } from "pngjs";

test("workspace, editor, and PDF dialog meet automated WCAG A/AA checks", async ({
  studio,
}) => {
  const { page } = studio;
  async function inspect() {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          reason: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  }
  await inspect();
  const png = new PNG({ width: 500, height: 400 });
  png.data.fill(255);
  await page.locator("#image-input").setInputFiles({
    name: "Accessible image.png",
    mimeType: "image/png",
    buffer: PNG.sync.write(png),
  });
  await expect(page.locator("#busy-overlay")).toBeHidden();
  await expect(page.locator("#editor-view")).toBeVisible();
  await inspect();
  await page.locator("#editor-pdf-button").click();
  await inspect();
});
