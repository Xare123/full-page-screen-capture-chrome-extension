import { test } from "node:test";
import assert from "node:assert/strict";
import { completedRectangle } from "../../src/capture-coverage.js";
import {
  fitVideo,
  containedVideoRect,
  videoRegion,
  validateTrim,
  videoExtension,
  supportedVideoMime,
} from "../../src/media-core.js";
import { planFinish } from "../../src/finishes.js";
import { validateAnnotations } from "../../src/whiteboards.js";
import {
  affineAnnotations,
  inverseMatrix,
  redactionBounds,
} from "../../src/annotation-geometry.js";
test("stopped capture keeps covered prefixes without holes or incomplete last rows", () => {
  assert.equal(completedRectangle([], 1000, 1800), null);
  assert.deepEqual(
    completedRectangle([{ x: 0, y: 0, width: 600, height: 600 }], 1000, 1800),
    { x: 0, y: 0, width: 600, height: 600 },
  );
  assert.deepEqual(
    completedRectangle(
      [
        { x: 0, y: 0, width: 600, height: 600 },
        { x: 400, y: 0, width: 600, height: 600 },
        { x: 0, y: 600, width: 600, height: 600 },
      ],
      1000,
      1800,
    ),
    { x: 0, y: 0, width: 1000, height: 600 },
  );
  assert.deepEqual(
    completedRectangle(
      [
        { x: 0, y: 0, width: 600, height: 600 },
        { x: 0, y: 1200, width: 1000, height: 600 },
      ],
      1000,
      1800,
    ),
    { x: 0, y: 0, width: 600, height: 600 },
  );
});
test("video fitting contains every aspect and region is bounded", () => {
  for (const [w, h] of [
    [1920, 1080],
    [640, 480],
    [1080, 1920],
    [8192, 512],
    [2, 16000],
  ]) {
    const out = fitVideo(w, h, 1080);
    assert.ok(
      out.width <= 3840 &&
        out.height <= 1080 &&
        out.width * out.height <= 8294400,
    );
    assert.ok(
      Math.abs(out.width / out.height - w / h) <
        Math.max(2 / out.height, (2 * w) / h / out.height),
    );
  }
  assert.deepEqual(
    videoRegion({ x: 0.2, y: 0.1, width: 0.5, height: 0.7 }, 1000, 1000),
    { x: 200, y: 100, width: 500, height: 700 },
  );
  assert.throws(() =>
    videoRegion({ x: 0.8, y: 0, width: 0.5, height: 1 }, 1000, 1000),
  );
  assert.throws(() => validateTrim(2, 1, 10));
  assert.throws(() => validateTrim(0, Infinity, 10));
  assert.equal(videoExtension("video/mp4;codecs=avc1"), "mp4");
  assert.equal(
    supportedVideoMime("mp4", (s) => s === "video/mp4"),
    "video/mp4",
  );
});
test("image finishes stay within canvas limits and use one uniform transform", () => {
  for (const [w, h] of [
    [16000, 1500],
    [200, 16000],
    [4800, 5000],
    [1, 1],
  ])
    for (const padding of [0, 48, 400])
      for (const frame of [false, true]) {
        const out = planFinish(w, h, { padding, frame });
        assert.ok(
          out.width <= 16000 &&
            out.height <= 16000 &&
            out.width * out.height <= 24000000,
        );
        assert.equal(out.matrix[0], out.matrix[3]);
        assert.ok(out.matrix[4] >= 0 && out.matrix[5] >= 0);
      }
});
test("editable board schema preserves current text layout and rejects executable coordinates", () => {
  const a = {
    type: "text",
    id: "test",
    text: "مرحبا hello",
    x: 20,
    y: 30,
    layoutVersion: 2,
    boxWidth: 320,
    boxHeight: 110,
    fontFamily: "inter",
    fontWeight: 500,
    fontSize: 24,
    color: "#123456",
    background: "transparent",
    boxShape: "callout",
  };
  assert.deepEqual(validateAnnotations([a])[0], a);
  assert.throws(() =>
    validateAnnotations([{ type: "text", text: "x", x: NaN }]),
  );
  assert.throws(() =>
    validateAnnotations([
      {
        type: "rectangle",
        rect: { x: 0, y: 0, width: 2, height: 2 },
        color: "url(https://example.com)",
      },
    ]),
  );
  assert.throws(() =>
    validateAnnotations([
      { type: "pen", points: new Array(100001).fill({ x: 1, y: 1 }) },
    ]),
  );
});
test("affine object transforms keep solid mask coverage conservative", () => {
  const a = { type: "redact", rect: { x: 10, y: 20, width: 100, height: 50 } },
    matrix = [0.5, 0, 0, 0.5, 20, 30],
    mapped = affineAnnotations([a], matrix)[0],
    restored = affineAnnotations([mapped], inverseMatrix(matrix))[0],
    r = redactionBounds(restored),
    original = redactionBounds(a);
  assert.ok(
    r.x <= original.x &&
      r.y <= original.y &&
      r.x + r.width >= original.x + original.width &&
      r.y + r.height >= original.y + original.height,
  );
});

test("rounded video/GIF output dimensions contain the complete source without stretching", () => {
  for (const [w, h] of [
    [1, 16000],
    [16000, 1],
    [319, 601],
    [1920, 1080],
    [1080, 1920],
  ]) {
    const out = fitVideo(w, h, 720),
      r = containedVideoRect(w, h, out.width, out.height);
    assert.ok(
      r.x >= -1e-9 &&
        r.y >= -1e-9 &&
        r.x + r.width <= out.width + 1e-9 &&
        r.y + r.height <= out.height + 1e-9,
    );
    assert.ok(Math.abs(r.width / r.height - w / h) < 1e-8);
  }
});

test("compression presets reject invalid encoding requests before acquiring media", async () => {
  const { VIDEO_PRESETS, validateVideoEncoding } =
    await import("../../src/media-core.js");
  for (const options of Object.values(VIDEO_PRESETS))
    assert.deepEqual(validateVideoEncoding(options), options);
  for (const patch of [
    { height: 0 },
    { height: Infinity },
    { fps: 0 },
    { fps: NaN },
    { videoBitsPerSecond: -1 },
    { videoBitsPerSecond: Infinity },
    { audioBitsPerSecond: 1 },
  ])
    assert.throws(() =>
      validateVideoEncoding({ ...VIDEO_PRESETS.balanced, ...patch }),
    );
});
test("canceling metadata and seek waits removes every owned media listener", async () => {
  const { waitForMedia, seekVideo } = await import("../../src/suite-ui.js");
  class Video extends EventTarget {
    listeners = new Map();
    addEventListener(type, fn, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
      super.addEventListener(type, fn, options);
    }
    removeEventListener(type, fn, options) {
      this.listeners.get(type)?.delete(fn);
      super.removeEventListener(type, fn, options);
    }
    readyState = 0;
    duration = 10;
    currentTime = 0;
  }
  for (const seek of [false, true]) {
    const video = new Video(),
      abort = new AbortController();
    const task = seek
      ? seekVideo(video, 2, abort.signal)
      : waitForMedia(video, "loadedmetadata", 15000, abort.signal);
    abort.abort();
    await assert.rejects(task, { name: "AbortError" });
    assert.equal(
      [...video.listeners.values()].reduce((sum, set) => sum + set.size, 0),
      0,
    );
    video.dispatchEvent(new Event("loadedmetadata"));
    video.dispatchEvent(new Event("seeked"));
  }
});
