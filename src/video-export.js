import {
  supportedVideoMime,
  fitVideo,
  containedVideoRect,
  validateTrim,
  seekableWebM,
  validateVideoEncoding,
} from "./media-core.js";
import { seekVideo, waitForMedia } from "./suite-ui.js";
import { makeCanvas, canvasBlob } from "./graphics.js";
function aborted() {
  return new DOMException("Export cancelled.", "AbortError");
}
export async function exportVideo(
  sourceVideo,
  {
    start,
    end,
    duration,
    mute,
    format,
    height = 1080,
    fps = 30,
    videoBitsPerSecond = 6000000,
    audioBitsPerSecond = 128000,
    signal,
    progress = () => {},
  },
) {
  validateTrim(start, end, duration);
  validateVideoEncoding({
    height,
    fps,
    videoBitsPerSecond,
    audioBitsPerSecond,
  });
  if (signal?.aborted) throw aborted();
  const mime = supportedVideoMime(format);
  if (!mime) throw new Error("This browser cannot encode this format.");
  const video = await isolatedVideo(sourceVideo, signal);
  let source, output, worker, recorder, timer;
  const chunks = [];
  let bytes = 0;
  try {
    video.pause();
    await seekVideo(video, start, signal);
    if (signal?.aborted) throw aborted();
    source = video.captureStream();
    const sourceTrack = source.getVideoTracks()[0];
    if (!sourceTrack)
      throw new Error(
        "The browser could not read video frames. Press Play once and retry.",
      );
    const size = fitVideo(video.videoWidth, video.videoHeight, height),
      processor = new MediaStreamTrackProcessor({ track: sourceTrack }),
      generator = new MediaStreamTrackGenerator({ kind: "video" });
    output = new MediaStream([
      generator,
      ...(mute ? [] : source.getAudioTracks()),
    ]);
    worker = new Worker(chrome.runtime.getURL("recording-worker.js"), {
      type: "module",
    });
    recorder = new MediaRecorder(output, {
      mimeType: mime,
      videoBitsPerSecond,
      audioBitsPerSecond,
    });
    const result = new Promise((resolve, reject) => {
      let settled = false,
        error;
      const stop = () => {
        video.pause();
        if (recorder.state !== "inactive") recorder.stop();
      };
      const cancel = () => {
        error = aborted();
        stop();
      };
      signal?.addEventListener("abort", cancel, { once: true });
      const ended = () => stop();
      video.addEventListener("ended", ended, { once: true });
      worker.onerror = (event) => {
        error = new Error(event.message || "The video compositor stopped.");
        stop();
      };
      worker.onmessage = ({ data }) => {
        if (data.type === "limit") stop();
        if (data.type === "error") {
          error = new Error(data.error);
          stop();
        }
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          bytes += event.data.size;
          if (bytes > 512 * 1024 * 1024) {
            error = new Error(
              "This clip exceeds 512 MB. Choose a shorter clip or smaller export.",
            );
            stop();
          } else chunks.push(event.data);
        }
      };
      recorder.onerror = (event) => {
        error = event.error || new Error("Video export failed.");
        stop();
      };
      recorder.onstop = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", cancel);
        video.removeEventListener("ended", ended);
        if (!bytes)
          error ||= new Error(
            "The browser produced an empty video. Retry the export.",
          );
        error
          ? reject(error)
          : resolve(new Blob(chunks, { type: recorder.mimeType }));
      };
      if (signal?.aborted) {
        reject(aborted());
        return;
      }
      recorder.start(1000);
      worker.postMessage(
        {
          type: "start",
          readable: processor.readable,
          writable: generator.writable,
          options: { ...size, fps, duration: end - start },
        },
        [processor.readable, generator.writable],
      );
      timer = setInterval(() => {
        progress(Math.min(1, (video.currentTime - start) / (end - start)));
        if (video.currentTime >= end) stop();
      }, 100);
      video.play().catch((error) => {
        reject(error);
        stop();
      });
    });
    const blob = await result;
    return await seekableWebM(blob, end - start);
  } finally {
    clearInterval(timer);
    video.pause();
    if (recorder && recorder.state !== "inactive")
      try {
        recorder.stop();
      } catch {}
    worker?.terminate();
    for (const stream of [source, output])
      stream?.getTracks().forEach((t) => t.stop());
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}
export async function videoFrame(
  video,
  { type = "image/png", quality = 0.9 } = {},
) {
  const canvas = makeCanvas(video.videoWidth, video.videoHeight);
  try {
    canvas.getContext("2d").drawImage(video, 0, 0);
    return await canvasBlob(canvas, type, quality);
  } finally {
    canvas.width = canvas.height = 1;
  }
}
export async function exportGIF(
  sourceVideo,
  { start, end, duration, width = 640, fps = 8, signal, progress = () => {} },
) {
  validateTrim(start, end, duration);
  if (end - start > 20 || fps * (end - start) > 240)
    throw new Error("Choose a GIF clip up to 20 seconds and 240 frames.");
  if (![4, 8, 12].includes(fps) || ![320, 480, 640, 960].includes(width))
    throw new Error("Invalid GIF size or frame rate.");
  if (signal?.aborted) throw aborted();
  const video = await isolatedVideo(sourceVideo, signal);
  let canvas, worker, pendingFailure, workerError;
  try {
    const size = fitVideo(
      video.videoWidth,
      video.videoHeight,
      Math.min(720, (video.videoHeight * width) / video.videoWidth),
    );
    canvas = makeCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    worker = new Worker(chrome.runtime.getURL("gif-worker.js"), {
      type: "module",
    });
    worker.onerror = (event) => {
      workerError = new Error(event.message || "The GIF encoder stopped.");
      pendingFailure?.(workerError);
    };
    const wait = (type) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => finish(new Error("The GIF encoder timed out.")),
          30000,
        );
        const rejectPending = (error) => finish(error);
        pendingFailure = rejectPending;
        const cancel = () => finish(aborted()),
          message = ({ data }) => {
            if (data.type === "error") finish(new Error(data.error));
            else if (data.type === type) finish(null, data);
          };
        function finish(error, data) {
          clearTimeout(timer);
          if (pendingFailure === rejectPending) pendingFailure = null;
          worker.removeEventListener("message", message);
          signal?.removeEventListener("abort", cancel);
          error ? reject(error) : resolve(data);
        }
        worker.addEventListener("message", message);
        signal?.addEventListener("abort", cancel, { once: true });
        if (workerError) finish(workerError);
        else if (signal?.aborted) cancel();
      });
    video.pause();
    worker.postMessage({ type: "start" });
    const count = Math.ceil((end - start) * fps);
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw aborted();
      await seekVideo(video, Math.min(end - 0.001, start + i / fps), signal);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const fitted = containedVideoRect(
        video.videoWidth,
        video.videoHeight,
        canvas.width,
        canvas.height,
      );
      ctx.drawImage(video, fitted.x, fitted.y, fitted.width, fitted.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        ready = wait("frame");
      worker.postMessage(
        {
          type: "frame",
          pixels: pixels.buffer,
          width: canvas.width,
          height: canvas.height,
          // GIF stores hundredths of a second. Distribute rounding across
          // frames so 8/12 fps clips keep their selected total duration.
          delay: Math.max(
            10,
            (Math.round(Math.min(end - start, (i + 1) / fps) * 100) -
              Math.round((i / fps) * 100)) *
              10,
          ),
        },
        [pixels.buffer],
      );
      await ready;
      progress((i + 1) / count);
    }
    const ready = wait("done");
    worker.postMessage({ type: "finish" });
    const result = await ready;
    return new Blob([result.bytes], { type: "image/gif" });
  } finally {
    worker?.terminate();
    if (canvas) canvas.width = canvas.height = 1;
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

async function isolatedVideo(source, signal) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.style.cssText =
    "position:fixed;width:1px;height:1px;left:-100px;top:0;opacity:0;pointer-events:none";
  video.src = source.currentSrc || source.src;
  document.body.append(video);
  try {
    await waitForMedia(video, "loadedmetadata", 15000, signal);
    return video;
  } catch (error) {
    video.removeAttribute("src");
    video.load();
    video.remove();
    throw error;
  }
}
