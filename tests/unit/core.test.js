import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planPositions,
  planTiles,
  isCapturableUrl,
  safeFilename,
  normalizeRect,
  formatBytes,
  percentSaved,
  escapeHTML,
  MAX_TILE_PIXELS,
  MAX_DIMENSION,
  rasterRect,
} from "../../src/core.js";

test("scroll plan covers the document, including overlapping bottom and right edges", () => {
  const positions = planPositions(2100, 1900, 1200, 800);
  for (let y = 0; y < 1900; y += 31)
    for (let x = 0; x < 2100; x += 37)
      assert.ok(
        positions.some(
          (p) => x >= p.x && x < p.x + 1200 && y >= p.y && y < p.y + 800,
        ),
        `Uncovered ${x},${y}`,
      );
  assert.ok(
    positions.every((p) => p.x >= 0 && p.y >= 0 && p.x <= 900 && p.y <= 1100),
  );
  assert.equal(
    new Set(positions.map((p) => `${p.x},${p.y}`)).size,
    positions.length,
  );
});
test("small pages need exactly one viewport and huge plans are rejected before allocating", () => {
  assert.deepEqual(planPositions(400, 300, 1200, 800), [{ x: 0, y: 0 }]);
  assert.throws(() => planPositions(1e12, 1e12, 1000, 1000), /too many/);
  for (const value of [0, NaN, Infinity, -3])
    assert.throws(() => planPositions(value, 100, 100, 100), /Invalid/);
});
test("large captures split into exact, nonoverlapping tiles within safe canvas limits", () => {
  for (const [width, height] of [
    [1200, 2000],
    [20000, 5000],
    [1234, 50000],
  ]) {
    const tiles = planTiles(width, height);
    assert.equal(
      tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0),
      width * height,
    );
    for (const tile of tiles) {
      assert.ok(tile.width <= MAX_DIMENSION);
      assert.ok(tile.height <= MAX_DIMENSION);
      assert.ok(tile.width * tile.height <= MAX_TILE_PIXELS);
    }
  }
  assert.throws(() => planTiles(100000, 100000), /safe capture size/);
});
test("capture URLs exclude privileged pages and both Web Store hosts", () => {
  for (const url of [
    "https://example.com",
    "http://localhost:4173/a",
    "file:///tmp/a.html",
  ])
    assert.equal(isCapturableUrl(url), true);
  for (const url of [
    "chrome://settings",
    "chrome-extension://123/app.html",
    "about:blank",
    "https://chromewebstore.google.com/detail/x",
    "https://chrome.google.com/webstore",
    "javascript:alert(1)",
    "bad",
  ])
    assert.equal(isCapturableUrl(url), false);
});
test("export names and HTML labels cannot inject path separators or markup", () => {
  assert.equal(safeFilename("../secret/<name>.png"), "..-secret--name-.png");
  assert.equal(safeFilename(" . "), "capture");
  assert.equal(
    escapeHTML('<script a="x">&\''),
    "&lt;script a=&quot;x&quot;&gt;&amp;&#39;",
  );
});
test("crop rectangles normalize reverse drags and clamp to image boundaries", () => {
  assert.deepEqual(
    normalizeRect({ x: 90, y: 100 }, { x: -50, y: 40 }, 80, 90),
    { x: 0, y: 40, width: 80, height: 50 },
  );
});
test("compression results never claim negative or impossible savings", () => {
  assert.equal(percentSaved(1000, 250), 75);
  assert.equal(percentSaved(1000, 2000), 0);
  assert.equal(percentSaved(0, 5), 0);
  assert.equal(formatBytes(1024), "1.0 KB");
  assert.equal(formatBytes(0), "0 B");
});
test("fractional screenshot crop edges and adjacent destination rectangles share the same pixel boundary", () => {
  const first = rasterRect({ x: 0.5, y: 1.5, width: 3, height: 3 }, 1.5, 1.5);
  const next = rasterRect({ x: 3.5, y: 1.5, width: 4, height: 3 }, 1.5, 1.5);
  assert.deepEqual(first, { x: 1, y: 2, width: 4, height: 5 });
  assert.equal(first.x + first.width, next.x);
  assert.equal(first.y, next.y);
  assert.equal(first.height, next.height);
  assert.throws(
    () => rasterRect({ x: NaN, y: 0, width: 10, height: 10 }, 1, 1),
    /Invalid/,
  );
});
