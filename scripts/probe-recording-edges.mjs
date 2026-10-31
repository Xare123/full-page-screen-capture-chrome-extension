/** Optional native rotated/4K compression probe. Build first; requires FFmpeg with the display_rotation input option. Uses only synthetic local fixtures. */
import { chromium, expect } from "@playwright/test";
import { PNG } from "pngjs";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const root = process.cwd(),
  temp = await mkdtemp(join(tmpdir(), "capture-edge-"));
let context;
const extension = join(temp, "extension");
await cp(join(root, "dist"), extension, { recursive: true });
const version = JSON.parse(
  await readFile(join(root, "manifest.json"), "utf8"),
).version;
await mkdir(join(root, "artifacts"), { recursive: true });
await rm(join(root, "artifacts", `recording-edge-probe-${version}.json`), {
  force: true,
});
const report = {
  runtimeCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  runtimeSourceTree: execFileSync("git", ["rev-parse", "HEAD:src"], {
    encoding: "utf8",
  }).trim(),
  bundleSHA256: Object.fromEntries(
    await Promise.all(
      ["app.js", "recording-worker.js", "manifest.json"].map(async (name) => [
        name,
        createHash("sha256")
          .update(await readFile(join(extension, name)))
          .digest("hex"),
      ]),
    ),
  ),
  source: "synthetic native H264 MP4 fixtures",
  cases: [],
};
try {
  context = await chromium.launchPersistentContext(join(temp, "profile"), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1440, height: 960 },
    args: [
      "--no-sandbox",
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  await context.route(/^https?:/, (r) => r.abort());
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(worker.url().replace("/background.js", "/app.html"));
  await page.locator("#nav-recordings").click();
  for (const [
    name,
    width,
    height,
    rotation,
    preset,
    expectedWidth,
    expectedHeight,
  ] of [
    ["phone-rotation", 640, 360, 90, "small", 270, 480],
    ["4K", 3840, 2160, 0, "balanced", 1280, 720],
  ]) {
    const original = join(temp, `${name}-base.mp4`),
      input = join(temp, `${name}.mp4`);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${width}x${height}:rate=30`,
      "-t",
      "3",
      "-vf",
      "drawbox=x=0:y=0:w=80:h=80:color=0xff0000:t=fill,drawbox=x=iw-80:y=0:w=80:h=80:color=0x00ff00:t=fill,drawbox=x=0:y=ih-80:w=80:h=80:color=0x0000ff:t=fill,drawbox=x=iw-80:y=ih-80:w=80:h=80:color=0xffff00:t=fill",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      original,
    ]);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-display_rotation:v:0",
      String(rotation),
      "-i",
      original,
      "-c",
      "copy",
      input,
    ]);
    const sourceInfo = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-show_streams", "-of", "json", input],
        { encoding: "utf8" },
      ),
    );
    if (rotation)
      assert(
        sourceInfo.streams[0].side_data_list.some(
          (d) => d.rotation === rotation,
        ),
      );
    const reference = join(temp, `${name}-reference.png`);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      input,
      "-frames:v",
      "1",
      reference,
    ]);
    const ref = PNG.sync.read(await readFile(reference));
    await page.locator("#suite-view input[type=file]").setInputFiles(input);
    await expect(page.locator("#video-player")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Compress video", exact: true }),
    ).toBeEnabled();
    const sourceDimensions = await page
      .locator("#video-player")
      .evaluate((v) => ({ width: v.videoWidth, height: v.videoHeight }));
    await page.locator("#video-preset").selectOption(preset);
    await page
      .getByRole("button", { name: "Compress video", exact: true })
      .click();
    await expect(page.locator("#compression-result")).toBeVisible({
      timeout: 30000,
    });
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download compressed video", exact: true })
      .click();
    const output = join(temp, `${name}-out.webm`);
    await writeFile(output, await readFile(await (await wait).path()));
    const meta = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-count_frames",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          output,
        ],
        { encoding: "utf8" },
      ),
    );
    const video = meta.streams.find((s) => s.codec_type === "video");
    assert.equal(video.width, expectedWidth);
    assert.equal(video.height, expectedHeight);
    assert(Number(video.nb_read_frames) > 25);
    const framePath = join(temp, `${name}-output.png`);
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-frames:v",
      "1",
      framePath,
    ]);
    const frame = PNG.sync.read(await readFile(framePath));
    const corners = (p) =>
      [
        [5, 5],
        [p.width - 6, 5],
        [5, p.height - 6],
        [p.width - 6, p.height - 6],
      ].map(([x, y]) => [
        ...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
      ]);
    const a = corners(ref),
      b = corners(frame);
    for (let i = 0; i < 4; i++)
      for (let c = 0; c < 3; c++)
        assert(
          Math.abs(a[i][c] - b[i][c]) < 85,
          `${name} corner${i} channel${c}`,
        );
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-i",
      output,
      "-fps_mode",
      "passthrough",
      "-enc_time_base",
      "demux",
      "-f",
      "null",
      "-",
    ]);
    report.cases.push({
      name,
      sourceDimensions,
      output: { width: video.width, height: video.height },
      frames: Number(video.nb_read_frames),
      fourCorners: true,
      fullDecode: true,
    });
  }
  assert.deepEqual(errors, []);
  report.status = "passed";
  report.browser = context.browser().version();
  await writeFile(
    `${root}/artifacts/recording-edge-probe-${version}.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
