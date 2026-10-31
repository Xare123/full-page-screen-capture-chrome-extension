import { test } from "node:test";
import assert from "node:assert/strict";
import {
  transformAnnotations,
  redactionBounds,
  matrixPoint,
} from "../../src/annotation-geometry.js";
import {
  asTextBox,
  hitText,
  imageToText,
  moveText,
  resizeText,
  textLayout,
  textToImage,
} from "../../src/text-layout.js";

const context = () => ({
  font: "",
  measureText: (text) => ({
    width:
      [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ].length * 15,
  }),
});
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("quarter-turns preserve the complete actual redaction coverage, including its expanded border", () => {
  const original = {
    type: "redact",
    rect: { x: 10, y: 10, width: 10, height: 10 },
  };
  let [a] = transformAnnotations([original], {
    rotate: true,
    width: 100,
    height: 100,
  });
  assert.deepEqual(redactionBounds(a), { x: 79, y: 10, width: 11, height: 11 });
  for (let i = 0; i < 3; i++)
    [a] = transformAnnotations([a], { rotate: true, width: 100, height: 100 });
  assert.deepEqual(redactionBounds(a), redactionBounds(original));
});
test("fractional crop scaling matches actual raster edges and text coordinates", () => {
  const original = { type: "text", x: 20, y: 30, text: "Scaled", fontSize: 28 };
  const [a] = transformAnnotations([original], {
    crop: { x: 4.2, y: 7.1, width: 50.6, height: 40.4 },
    width: 51,
    height: 40,
    rotate: true,
  });
  const p = textToImage(a, { x: 0, y: 0 });
  close(p.x, 40 - ((30 - 7.1) * 40) / 40.4);
  close(p.y, ((20 - 4.2) * 51) / 50.6);
  const moved = moveText(a, 13, -7),
    q = textToImage(moved, { x: 0, y: 0 });
  close(q.x, p.x + 13);
  close(q.y, p.y - 7);
});
test("rotated and scaled text hit testing and resize share inverse image coordinates", () => {
  const ctx = context();
  const [a] = transformAnnotations(
    [
      {
        type: "text",
        x: 30,
        y: 20,
        text: "Example",
        fontSize: 20,
        boxWidth: 150,
        boxHeight: 50,
      },
    ],
    {
      crop: { x: 10, y: 10, width: 100, height: 80 },
      width: 101,
      height: 79,
      rotate: true,
    },
  );
  const start = textToImage(a, { x: 150, y: 50 }),
    point = textToImage(a, { x: 210, y: 70 });
  const resized = resizeText(ctx, a, "se", start, point);
  close(resized.boxWidth, 210);
  close(resized.boxHeight, 70);
  const inside = textToImage(resized, { x: 100, y: 30 });
  assert.ok(hitText(ctx, resized, inside));
  const local = imageToText(resized, inside);
  close(local.x, 100);
  close(local.y, 30);
});
test("legacy box migration retains the first glyph origin and usable single-line width", () => {
  const ctx = context(),
    a = {
      type: "text",
      x: 100,
      y: 80,
      text: "Legacy text",
      fontSize: 28,
      rotation: 90,
    };
  const before = textLayout(ctx, a),
    box = asTextBox(ctx, a),
    after = textLayout(ctx, box);
  assert.deepEqual(after.lines, before.lines);
  assert.equal(after.width, before.width);
  assert.equal(after.height, before.height);
  const p = textToImage(a, { x: 0, y: 0 }),
    q = textToImage(box, { x: after.paddingX, y: after.paddingY });
  close(p.x, q.x);
  close(p.y, q.y);
});
test("wrapping retains long Unicode graphemes and expands height instead of discarding lines", () => {
  const ctx = context(),
    text = "abc👨‍👩‍👧‍👦def漢字".repeat(5);
  const layout = textLayout(ctx, {
    text,
    fontSize: 20,
    boxWidth: 72,
    boxHeight: 1,
  });
  assert.equal(layout.lines.join(""), text);
  assert.ok(layout.height >= layout.lines.length * 26 + 12);
  for (const line of layout.lines)
    assert.ok(!line.startsWith("\u200d") && !line.endsWith("\u200d"));
});
test("four rotations restore every annotation's image-space coordinates without flattening it", () => {
  const original = [
    {
      type: "pen",
      points: [
        { x: 12, y: 34 },
        { x: 56, y: 78 },
      ],
    },
    { type: "text", x: 25, y: 30, text: "Editable", fontSize: 28 },
  ];
  let current = original,
    width = 200,
    height = 100;
  for (let i = 0; i < 4; i++) {
    current = transformAnnotations(current, { rotate: true, width, height });
    [width, height] = [height, width];
  }
  assert.deepEqual(
    current.map((a) => a.type),
    ["pen", "text"],
  );
  const p = matrixPoint(current[0].transform, current[0].points[0]);
  close(p.x, 12);
  close(p.y, 34);
  const q = textToImage(current[1], { x: 0, y: 0 });
  close(q.x, 25);
  close(q.y, 30);
});
