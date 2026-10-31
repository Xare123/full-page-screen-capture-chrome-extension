import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAPER_SIZES,
  choosePDFLayout,
  PDF_MARGIN,
  describePDFLayout,
  MAX_PDF_PAGES,
} from "../../src/pdf-layout.js";

test("automatic paper selection uses landscape for a wide image and shows a real page estimate", () => {
  const wide = choosePDFLayout([{ width: 1200, height: 650 }]);
  assert.equal(wide.page.orientation, "landscape");
  assert.equal(wide.count, 1);
  assert.match(describePDFLayout(wide), /Recommended: .+ · landscape · 1 page/);
  const tall = choosePDFLayout([{ width: 1000, height: 1800 }]);
  assert.equal(tall.page.orientation, "portrait");
  assert.equal(tall.count, 2);
});
test("common paper sizes match standards in both explicit orientations", () => {
  for (const paper of PAPER_SIZES)
    for (const orientation of ["portrait", "landscape"]) {
      const result = choosePDFLayout([{ width: 800, height: 1200 }], {
        pageSize: paper.id,
        orientation,
      });
      assert.equal(
        result.page.width,
        orientation === "landscape" ? paper.height : paper.width,
      );
      assert.equal(
        result.page.height,
        orientation === "landscape" ? paper.width : paper.height,
      );
      assert.ok(
        result.plans.every(
          (p) => p.sliceHeight > 0 && Number.isInteger(p.sliceHeight),
        ),
      );
    }
});
test("continuous pages fit image dimensions at 96 DPI and count each selected part once", () => {
  const result = choosePDFLayout(
    [
      { width: 800, height: 3000 },
      { width: 800, height: 600 },
    ],
    { pageSize: "image", scale: 0.5, footer: true },
  );
  assert.equal(result.count, 2);
  assert.equal(result.plans[0].sliceHeight, 1500);
  assert.equal(result.plans[0].page.width, 400 * 0.75 + PDF_MARGIN * 2);
  assert.equal(result.plans[0].page.height, 1500 * 0.75 + PDF_MARGIN * 2 + 18);
  assert.equal(result.plans[1].pages, 1);
});
test("pagination estimates use the same rounding, image resize and footer space as export", () => {
  const images = [
    { width: 1235, height: 11553 },
    { width: 1235, height: 300 },
  ];
  const result = choosePDFLayout(images, {
    pageSize: "a4",
    orientation: "portrait",
    scale: 0.75,
    footer: true,
  });
  let count = 0;
  for (const plan of result.plans) {
    for (let y = 0; y < plan.height; y += plan.sliceHeight) count++;
    assert.ok(
      (plan.sliceHeight * (plan.page.width - 48)) / plan.width <=
        plan.page.height - 48 - 18,
    );
  }
  assert.equal(count, result.count);
});
test("invalid PDF dimensions and layout choices fail explicitly", () => {
  for (const settings of [
    { pageSize: "unsupported" },
    { orientation: "sideways" },
    { scale: NaN },
    { scale: 0 },
  ])
    assert.throws(() =>
      choosePDFLayout([{ width: 800, height: 600 }], settings),
    );
  assert.throws(() => choosePDFLayout([]));
  assert.throws(() => choosePDFLayout([{ width: Infinity, height: 10 }]));
  assert.throws(() =>
    choosePDFLayout([{ width: 30000, height: 30000 }], { pageSize: "image" }),
  );
});
test("extreme aspect ratios stay inside each page and excessive pagination fails before rendering", () => {
  for (const paper of PAPER_SIZES)
    for (const footer of [false, true]) {
      const layout = choosePDFLayout([{ width: 1, height: 20 }], {
        pageSize: paper.id,
        orientation: "landscape",
        footer,
      });
      const plan = layout.plans[0];
      assert.ok(plan.fill <= 1);
      assert.ok(
        (plan.sliceHeight * plan.drawWidth) / plan.width <=
          plan.page.height - PDF_MARGIN * 2 - (footer ? 18 : 0) + 1e-9,
      );
    }
  for (const width of [1, 5]) {
    assert.throws(
      () => choosePDFLayout([{ width, height: 16000 }]),
      new RegExp(`${MAX_PDF_PAGES} pages.*Image-sized`),
    );
    assert.equal(
      choosePDFLayout([{ width, height: 16000 }], { pageSize: "image" }).count,
      1,
    );
  }
});
