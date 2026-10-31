import { test, expect } from "./fixtures.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";

test("one static source frame survives delayed encoder startup and keeps camera and ink live", async ({
  studio,
}) => {
  const result = await studio.page.evaluate(async () => {
    const source = new MediaStreamTrackGenerator({ kind: "video" }),
      camera = new MediaStreamTrackGenerator({ kind: "video" }),
      output = new MediaStreamTrackGenerator({ kind: "video" }),
      sourceReader = new MediaStreamTrackProcessor({ track: source }),
      cameraReader = new MediaStreamTrackProcessor({ track: camera }),
      worker = new Worker(chrome.runtime.getURL("recording-worker.js"), {
        type: "module",
      }),
      stream = new MediaStream([output]),
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" }),
      chunks = [],
      sourceWriter = source.writable.getWriter(),
      cameraWriter = camera.writable.getWriter();
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function frame(writer, color) {
      const c = new OffscreenCanvas(640, 480),
        x = c.getContext("2d");
      x.fillStyle = color;
      x.fillRect(0, 0, 640, 480);
      const f = new VideoFrame(c, {
        timestamp: Math.round(performance.now() * 1000),
      });
      try {
        await writer.write(f);
      } finally {
        f.close();
      }
    }
    try {
      let firstResolve, firstReject;
      const first = new Promise((resolve, reject) => {
        firstResolve = resolve;
        firstReject = reject;
      });
      worker.onmessage = ({ data }) => {
        if (data.type === "frame") firstResolve();
        if (data.type === "error") firstReject(new Error(data.error));
      };
      worker.onerror = (e) => firstReject(new Error(e.message));
      const timeout = setTimeout(
        () => firstReject(new Error("No compositor output")),
        10000,
      );
      worker.postMessage(
        {
          type: "start",
          readable: sourceReader.readable,
          camera: cameraReader.readable,
          writable: output.writable,
          options: {
            width: 640,
            height: 480,
            live: true,
            bubble: "bottom-right",
          },
        },
        [sourceReader.readable, cameraReader.readable, output.writable],
      );
      await frame(cameraWriter, "#22c55e");
      await frame(sourceWriter, "#2563eb");
      await first;
      clearTimeout(timeout);
      // The old worker loses this only source frame before the encoder listens.
      await wait(250);
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start(200);
      await wait(450);
      await frame(cameraWriter, "#ef4444");
      const ink = new OffscreenCanvas(640, 480),
        x = ink.getContext("2d");
      x.fillStyle = "#111111";
      x.fillRect(40, 40, 120, 100);
      const bitmap = await createImageBitmap(ink);
      worker.postMessage({ type: "overlay", bitmap }, [bitmap]);
      await wait(650);
      recorder.stop();
      await stopped;
      const bytes = new Uint8Array(
        await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer(),
      );
      return [...bytes];
    } finally {
      worker.terminate();
      for (const track of [source, camera, output]) track.stop();
      if (recorder.state !== "inactive") recorder.stop();
    }
  });
  const dir = await mkdtemp(join(tmpdir(), "capture-static-video-"));
  try {
    const path = join(dir, "static.webm");
    await writeFile(path, Buffer.from(result));
    expect(result.length).toBeGreaterThan(500);
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        ["-v", "error", "-count_frames", "-show_streams", "-of", "json", path],
        { encoding: "utf8" },
      ),
    );
    expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(15);
    // Native muxers normalize the start offset differently. Inspect actual
    // decoded frame indices rather than assuming a particular duration header.
    for (const [index, name] of [
      [0, "first"],
      [Number(probe.streams[0].nb_read_frames) - 1, "last"],
    ])
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-i",
        path,
        "-vf",
        `select='eq(n,${index})'`,
        "-frames:v",
        "1",
        join(dir, `${name}.png`),
      ]);
    const first = PNG.sync.read(await readFile(join(dir, "first.png"))),
      last = PNG.sync.read(await readFile(join(dir, "last.png")));
    const at = (png, x, y) => [
      ...png.data.subarray(
        (y * png.width + x) * 4,
        (y * png.width + x) * 4 + 3,
      ),
    ];
    expect(at(first, 80, 80)[2]).toBeGreaterThan(200);
    expect(at(last, 80, 80).every((v) => v < 30)).toBeTruthy();
    expect(at(first, 563, 402)[1]).toBeGreaterThan(150);
    expect(at(last, 563, 402)[0]).toBeGreaterThan(200);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
