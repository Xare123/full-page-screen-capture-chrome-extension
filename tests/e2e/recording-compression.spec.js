import { test, expect } from "./fixtures.js";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
const hash = (b) => createHash("sha256").update(b).digest("hex");
async function fixture(dir, width = 1280, height = 720, sourceFormat = "webm") {
  const path = join(dir, `source.${sourceFormat}`);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=${width}x${height}:rate=30`,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "3",
    "-vf",
    "drawbox=x=0:y=0:w=20:h=20:color=0xff0000:t=fill,drawbox=x=iw-20:y=0:w=20:h=20:color=0x00ff00:t=fill,drawbox=x=0:y=ih-20:w=20:h=20:color=0x0000ff:t=fill,drawbox=x=iw-20:y=ih-20:w=20:h=20:color=0xffff00:t=fill",
    ...(sourceFormat === "mp4"
      ? [
          "-c:v",
          "libx264",
          "-threads",
          "2",
          "-preset",
          "ultrafast",
          "-crf",
          "18",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
        ]
      : [
          "-c:v",
          "libvpx-vp9",
          "-threads",
          "2",
          "-deadline",
          "realtime",
          "-cpu-used",
          "8",
          "-b:v",
          "6000k",
          "-c:a",
          "libopus",
          "-b:a",
          "128k",
        ]),
    path,
  ]);
  return { path, bytes: await readFile(path) };
}
async function load(page, path) {
  await page.locator("#nav-recordings").click();
  await page.locator("#suite-view input[type=file]").setInputFiles(path);
  await expect(page.locator("#video-player")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Compress video", exact: true }),
  ).toBeEnabled();
}
for (const sourceFormat of ["webm", "mp4"])
  for (const format of ["webm", "mp4"])
    for (const [name, width, height] of [
      ["landscape", 1280, 720],
      ["portrait", 480, 854],
      ["ultrawide", 1280, 240],
      ["small", 320, 180],
    ]) {
      test(`native ${sourceFormat} source compressed to ${format} preserves ${name} video and audio`, async ({
        studio,
      }) => {
        test.setTimeout(60000);
        const { page, errors } = studio,
          dir = await mkdtemp(join(tmpdir(), "capture-compression-"));
        try {
          const input = await fixture(dir, width, height, sourceFormat);
          await load(page, input.path);
          test.skip(
            await page
              .locator(`#video-format option[value=${format}]`)
              .isDisabled(),
            "Native encoder not available on this platform.",
          );
          await page.locator("#video-format").selectOption(format);
          await page.locator("#video-preset").selectOption("small");
          let downloads = 0;
          page.on("download", () => downloads++);
          await page
            .getByRole("button", { name: "Compress video", exact: true })
            .click();
          await expect(page.locator("#video-preset")).toBeDisabled();
          await expect(
            page.getByRole("button", { name: "Import video", exact: true }),
          ).toBeDisabled();
          await expect(page.locator("#compression-result")).toBeVisible({
            timeout: 20000,
          });
          expect(downloads).toBe(0);
          await expect(page.locator("#compression-summary")).toContainText(
            "original",
          );
          const previewHash = await page
            .locator("#compressed-video")
            .evaluate(async (v) =>
              [
                ...new Uint8Array(
                  await crypto.subtle.digest(
                    "SHA-256",
                    await (await fetch(v.src)).arrayBuffer(),
                  ),
                ),
              ]
                .map((n) => n.toString(16).padStart(2, "0"))
                .join(""),
            );
          const wait = page.waitForEvent("download");
          await page
            .getByRole("button", {
              name: "Download compressed video",
              exact: true,
            })
            .click();
          const download = await wait,
            bytes = await readFile(await download.path()),
            out = join(dir, `result.${format}`);
          await writeFile(out, bytes);
          expect(hash(bytes)).toBe(previewHash);
          expect(download.suggestedFilename()).toMatch(
            new RegExp(`-compressed\\.${format}$`),
          );
          expect(downloads).toBe(1);
          const probe = JSON.parse(
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
                out,
              ],
              { encoding: "utf8" },
            ),
          );
          const video = probe.streams.find((s) => s.codec_type === "video");
          expect(video.width / video.height).toBeCloseTo(width / height, 2);
          expect(video.height).toBeLessThanOrEqual(Math.min(480, height));
          expect(video.width).toBeLessThanOrEqual(width);
          expect(Number(video.nb_read_frames)).toBeGreaterThan(25);
          expect(Number(video.nb_read_frames)).toBeLessThanOrEqual(48);
          expect(Number(probe.format.duration)).toBeGreaterThan(2.7);
          expect(Number(probe.format.duration)).toBeLessThan(3.5);
          expect(
            probe.streams.some((s) => s.codec_type === "audio"),
          ).toBeTruthy();
          const volume = spawnSync(
            "ffmpeg",
            [
              "-v",
              "info",
              "-i",
              out,
              "-map",
              "0:a:0",
              "-af",
              "volumedetect",
              "-f",
              "null",
              "-",
            ],
            { encoding: "utf8" },
          );
          expect(volume.status).toBe(0);
          const mean = volume.stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/);
          expect(mean).toBeTruthy();
          expect(Number(mean[1])).toBeGreaterThan(-50);
          execFileSync("ffmpeg", [
            "-v",
            "error",
            "-i",
            out,
            "-fps_mode",
            "passthrough",
            "-f",
            "null",
            "-",
          ]);
          const packets = JSON.parse(
            execFileSync(
              "ffprobe",
              [
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_packets",
                "-show_entries",
                "packet=dts",
                "-of",
                "json",
                out,
              ],
              { encoding: "utf8" },
            ),
          ).packets;
          // Matroska/WebM permits equal packet timestamps (AVFMT_TS_NONSTRICT).
          // MP4 requires strictly increasing DTS. Neither may move backwards.
          for (const packet of packets)
            expect(Number.isSafeInteger(Number(packet.dts))).toBeTruthy();
          for (let i = 1; i < packets.length; i++) {
            const current = Number(packets[i].dts),
              previous = Number(packets[i - 1].dts);
            if (format === "webm")
              expect(current).toBeGreaterThanOrEqual(previous);
            else expect(current).toBeGreaterThan(previous);
          }
          const framePath = join(dir, "corner.png");
          execFileSync("ffmpeg", [
            "-v",
            "error",
            "-i",
            out,
            "-frames:v",
            "1",
            framePath,
          ]);
          const frame = PNG.sync.read(await readFile(framePath));
          for (const [x, y, expected] of [
            [4, 4, [255, 0, 0]],
            [frame.width - 5, 4, [0, 255, 0]],
            [4, frame.height - 5, [0, 0, 255]],
            [frame.width - 5, frame.height - 5, [255, 255, 0]],
          ]) {
            const at = (y * frame.width + x) * 4;
            for (let c = 0; c < 3; c++)
              expect(Math.abs(frame.data[at + c] - expected[c])).toBeLessThan(
                85,
              );
          }
          if (name === "landscape")
            expect(bytes.length).toBeLessThan(input.bytes.length);
          const originalWait = page.waitForEvent("download");
          await page
            .getByRole("button", { name: "Download original", exact: true })
            .click();
          expect(hash(await readFile(await (await originalWait).path()))).toBe(
            hash(input.bytes),
          );
          await page.locator("#video-bitrate").fill("1.2");
          await expect(page.locator("#compression-result")).toBeHidden();
          expect(errors).toEqual([]);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
    }
test("compression cancellation, retry, trim and mute retain original bytes", async ({
  studio,
}) => {
  test.setTimeout(60000);
  const { page, errors } = studio,
    dir = await mkdtemp(join(tmpdir(), "capture-cancel-compression-"));
  try {
    const input = await fixture(dir);
    await load(page, input.path);
    await page.evaluate(() => {
      const original = HTMLMediaElement.prototype.captureStream;
      window.exportTracks = [];
      HTMLMediaElement.prototype.captureStream = function (...args) {
        const stream = original.apply(this, args);
        window.exportTracks.push(...stream.getTracks());
        return stream;
      };
    });
    await page
      .getByRole("button", { name: "Compress video", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Cancel export", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Compress video", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("#compression-result")).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.exportTracks.every((t) => t.readyState === "ended"),
        ),
      )
      .toBeTruthy();
    await page.locator("#video-start").fill("0.5");
    await page.locator("#video-end").fill("2.5");
    await page.locator("#video-mute").check();
    await page.locator("#video-preset").selectOption("balanced");
    await page
      .getByRole("button", { name: "Compress video", exact: true })
      .click();
    await expect(page.locator("#compression-result")).toBeVisible({
      timeout: 20000,
    });
    await expect(page.locator("#compression-summary")).toContainText(
      "full original",
    );
    const wait = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download compressed video", exact: true })
      .click();
    const path = join(dir, "muted.webm");
    await writeFile(path, await readFile(await (await wait).path()));
    const info = JSON.parse(
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
          path,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(info.streams.some((s) => s.codec_type === "audio")).toBeFalsy();
    expect(Number(info.format.duration)).toBeCloseTo(2, 0);
    expect(
      Number(info.streams.find((s) => s.codec_type === "video").nb_read_frames),
    ).toBeGreaterThan(40);
    execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"]);
    await page.locator("#home-button").click();
    await page.locator("#nav-recordings").click();
    await expect(page.locator("#compression-result")).toBeHidden();
    const original = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download original", exact: true })
      .click();
    expect(hash(await readFile(await (await original).path()))).toBe(
      hash(input.bytes),
    );
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Run these cadence benchmarks in isolation; the parallel suite verifies integrity under load.
for (const format of ["webm", "mp4"])
  test(`${format} Balanced and Clear presets retain their requested motion cadence`, async ({
    studio,
  }) => {
    test.setTimeout(60000);
    const { page } = studio,
      dir = await mkdtemp(join(tmpdir(), "capture-cadence-"));
    try {
      const input = await fixture(dir);
      await load(page, input.path);
      test.skip(
        await page
          .locator(`#video-format option[value=${format}]`)
          .isDisabled(),
        "Native encoder not available.",
      );
      await page.locator("#video-format").selectOption(format);
      for (const [preset, fps] of [
        ["balanced", 24],
        ["clear", 30],
      ]) {
        await page.locator("#video-preset").selectOption(preset);
        await page
          .getByRole("button", { name: "Compress video", exact: true })
          .click();
        await expect(page.locator("#compression-result")).toBeVisible({
          timeout: 20000,
        });
        const wait = page.waitForEvent("download");
        await page
          .getByRole("button", {
            name: "Download compressed video",
            exact: true,
          })
          .click();
        const path = join(dir, `${preset}.${format}`);
        await writeFile(path, await readFile(await (await wait).path()));
        const probe = JSON.parse(
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
              path,
            ],
            { encoding: "utf8" },
          ),
        );
        const video = probe.streams.find((s) => s.codec_type === "video"),
          rate = Number(video.nb_read_frames) / Number(probe.format.duration);
        expect(rate).toBeGreaterThan(fps - 3);
        expect(rate).toBeLessThan(fps + 1);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
test("leaving during compression aborts owned tracks and cannot recreate a hidden result", async ({
  studio,
}) => {
  const { page, errors } = studio,
    dir = await mkdtemp(join(tmpdir(), "capture-leave-compression-"));
  try {
    const input = await fixture(dir);
    await load(page, input.path);
    await page.evaluate(() => {
      const capture = HTMLMediaElement.prototype.captureStream;
      window.jobTracks = [];
      HTMLMediaElement.prototype.captureStream = function (...args) {
        const s = capture.apply(this, args);
        window.jobTracks.push(...s.getTracks());
        return s;
      };
    });
    await page
      .getByRole("button", { name: "Compress video", exact: true })
      .click();
    await expect
      .poll(() => page.evaluate(() => window.jobTracks.length))
      .toBeGreaterThan(0);
    await page.locator("#nav-guide").click();
    await expect(page.locator("#page-name")).toHaveText("Guide & settings");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.jobTracks.every((t) => t.readyState === "ended"),
        ),
      )
      .toBeTruthy();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            [...document.querySelectorAll("video")].filter(
              (v) => v.style.left === "-100px",
            ).length,
        ),
      )
      .toBe(0);
    await page.locator("#nav-recordings").click();
    await expect(page.locator("#compression-result")).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Compress video", exact: true }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
