import { test } from "node:test";
import assert from "node:assert/strict";
import {
  captureLayout,
  fitsImage,
  planImageExport,
  scaledDimensions,
  validatedDimensions,
} from "../../src/image-layout.js";
import { planTiles } from "../../src/core.js";
import { choosePDFLayout } from "../../src/pdf-layout.js";

const email = [
  { x: 0, y: 0, width: 2320, height: 10344 },
  { x: 0, y: 10344, width: 2320, height: 1125 },
];

test("long email fits one image at every requested size and preserves its final edge", () => {
  const result = planImageExport(email, { scale: 0.4 });
  assert.deepEqual([result.width, result.height], [928, 4588]);
  assert.equal(result.tiles[1].y + result.tiles[1].height, 4588);
  const full = planImageExport(email);
  assert.equal(full.kind, "image");
  assert.equal(full.fitted, true);
  assert.deepEqual([full.width, full.height], [2203, 10893]);
  assert.ok(full.effectiveScale < 1);
  assert.equal(planImageExport(email, { scale: 0.94 }).fitted, false);
  assert.equal(planImageExport(email, { scale: 0.95 }).fitted, true);
});

test("an unordered two-dimensional grid shares every rounded edge including the last pixel", () => {
  const images = [
    { x: 501, y: 1001, width: 502, height: 1002 },
    { x: 0, y: 0, width: 501, height: 1001 },
    { x: 0, y: 1001, width: 501, height: 1002 },
    { x: 501, y: 0, width: 502, height: 1001 },
  ];
  const result = planImageExport(images, { scale: 0.39 });
  assert.deepEqual([result.width, result.height], [391, 781]);
  const [br, tl, bl, tr] = result.tiles;
  assert.equal(tl.x + tl.width, tr.x);
  assert.equal(tr.y + tr.height, br.y);
  assert.equal(bl.x + bl.width, br.x);
  assert.equal(br.x + br.width, 391);
  assert.equal(br.y + br.height, 781);
  assert.equal(
    result.tiles.reduce((a, t) => a + t.width * t.height, 0),
    391 * 781,
  );
});

test("missing, overlapping and offset coordinates produce one explicitly stacked image", () => {
  const examples = [
    [
      { width: 100, height: 100 },
      { width: 50, height: 60 },
    ],
    [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 0, y: 101, width: 50, height: 60 },
    ],
    [
      { x: 1, y: 0, width: 100, height: 100 },
      { x: 1, y: 100, width: 50, height: 60 },
    ],
    [
      { x: 0, y: 0, width: 2, height: 2 },
      { x: 1, y: 0, width: 2, height: 2 },
      { x: 3, y: 1, width: 2, height: 1 },
    ],
  ];
  for (const images of examples) {
    const plan = planImageExport(images);
    assert.equal(plan.kind, "image");
    assert.equal(plan.layoutMode, "stack");
    assert.equal(plan.tiles.length, images.length);
  }
  const plan = planImageExport(examples[0]);
  assert.deepEqual([plan.width, plan.height], [100, 160]);
  assert.deepEqual(plan.tiles, [
    { index: 0, x: 0, y: 0, width: 100, height: 100 },
    { index: 1, x: 25, y: 100, width: 50, height: 60 },
  ]);
  for (const x of [-1, NaN, Infinity, 0.5])
    assert.equal(
      planImageExport([{ ...email[0], x }, email[1]]).layoutMode,
      "stack",
    );
});

test("crop-aware and rotated parts stack at their own dimensions without stretching", () => {
  const images = [
    { ...email[0], layoutChanged: true },
    { ...email[1], crop: { x: 10, y: 20, width: 501, height: 601 } },
  ];
  const plan = planImageExport(images, { scale: 0.4 });
  assert.equal(plan.layoutMode, "stack");
  assert.equal(plan.reason, "edited");
  assert.deepEqual([plan.sourceWidth, plan.sourceHeight], [2320, 10945]);
  assert.equal(plan.tiles[1].width, 200);
  assert.equal(plan.tiles[1].height, 240);
  const square = planImageExport([
    { x: 0, y: 0, width: 50, height: 50, layoutChanged: true },
    { x: 0, y: 50, width: 50, height: 50 },
  ]);
  assert.equal(square.layoutMode, "stack");
});

test("thin axes and collapsed tiles use whole-pixel bounds, and image/PDF scaling agrees", () => {
  const plan = planImageExport(
    [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0, y: 1, width: 1, height: 99 },
    ],
    { scale: 0.01 },
  );
  assert.deepEqual([plan.width, plan.height], [1, 1]);
  assert.equal(plan.tiles[0].height, 0);
  assert.equal(plan.tiles[1].height, 1);
  assert.equal(plan.tiles[1].width, 1);
  const pdf = choosePDFLayout([{ width: 300, height: 700 }], {
    scale: 0.01,
    pageSize: "image",
  });
  assert.deepEqual([pdf.plans[0].width, pdf.plans[0].height], [3, 7]);
  for (const scale of [0, -0.1, 1.1, NaN, Infinity])
    assert.throws(() => planImageExport(email, { scale }));
});

test("single fractional crops use the same single rounding as their renderer", () => {
  for (const [size, scale, expected] of [
    [50.6, 0.5, 25],
    [3.51, 0.4, 1],
  ]) {
    const image = {
      width: 100,
      height: 100,
      crop: { x: 0.1, y: 0.2, width: size, height: size },
    };
    const plan = planImageExport([image], { scale });
    assert.deepEqual([plan.width, plan.height], [expected, expected]);
    assert.deepEqual(scaledDimensions(image, scale), {
      width: plan.width,
      height: plan.height,
    });
  }
});

test("superlong and padded stacks can fit below1% without an unsafe intermediate canvas", () => {
  const images = Array.from({ length: 101 }, () => ({
    width: 1,
    height: 16000,
  }));
  const plan = planImageExport(images, { scale: 0.01 });
  assert.ok(plan.effectiveScale < 0.01);
  assert.deepEqual([plan.width, plan.height], [1, 16000]);
  assert.equal(plan.tiles.at(-1).y + plan.tiles.at(-1).height, 16000);
  const padded = planImageExport([{ width: 16000, height: 1 }, ...images]);
  assert.equal(padded.layoutMode, "stack");
  assert.ok(padded.sourceWidth * padded.sourceHeight > 120000000);
  assert.ok(fitsImage(padded));
});

test("invalid source sizes and crops error before a composition can omit or pad data", () => {
  for (const image of [
    { width: 16001, height: 1 },
    { width: 0, height: 20 },
    { width: 4000, height: 6001 },
    { width: NaN, height: 1 },
  ])
    assert.throws(() => planImageExport([image]));
  for (const crop of [
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: Infinity, height: 1 },
    { x: 50, y: 0, width: 60, height: 10 },
    { x: 0, y: 0, width: 0, height: 1 },
  ])
    assert.throws(() => validatedDimensions({ width: 100, height: 100, crop }));
  assert.throws(() =>
    planImageExport(
      Array.from({ length: 6 }, () => ({ width: 4000, height: 6000 })),
    ),
  );
  assert.deepEqual(scaledDimensions({ width: 1, height: 1200000 }, 0.001), {
    width: 1,
    height: 1200,
  });
});

test("all100 slider sizes cover varied full grids with bounded output and no omitted edge", () => {
  const shapes = [
    [2320, 11469],
    [1440, 17100],
    [16001, 1001],
    [1, 1800000],
    [1800000, 1],
    [8001, 13500],
    [4000, 6000],
    [6000, 4000],
    [203, 203],
    [17, 31],
  ];
  for (const [width, height] of shapes) {
    const images = planTiles(width, height);
    assert.ok(captureLayout(images).tiles);
    let previous = 0;
    for (let percent = 1; percent <= 100; percent++) {
      const plan = planImageExport(images, { scale: percent / 100 });
      assert.equal(plan.kind, "image");
      assert.ok(fitsImage(plan));
      assert.ok(plan.effectiveScale <= percent / 100);
      assert.ok(plan.width * plan.height >= previous);
      previous = plan.width * plan.height;
      assert.equal(
        Math.max(...plan.tiles.map((t) => t.x + t.width)),
        plan.width,
      );
      assert.equal(
        Math.max(...plan.tiles.map((t) => t.y + t.height)),
        plan.height,
      );
      assert.equal(
        plan.tiles.reduce((sum, t) => sum + t.width * t.height, 0),
        plan.width * plan.height,
      );
      assert.deepEqual(
        scaledDimensions({ width, height }, plan.effectiveScale),
        { width: plan.width, height: plan.height },
      );
    }
  }
});
