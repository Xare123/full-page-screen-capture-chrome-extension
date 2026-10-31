import { RecordingSession, transitionRecording } from "./recording.js";
import {
  listSuiteItems,
  getSuiteItem,
  importRecording,
  putSuiteItem,
  patchSuiteItem,
  deleteSuiteItem,
  appendRecordingChunk,
  recordingBlob,
} from "./suite-db.js";
import {
  el,
  button,
  field,
  downloadBlob,
  waitForMedia,
  readableDuration,
} from "./suite-ui.js";
import { formatBytes } from "./core.js";
import {
  videoExtension,
  supportedVideoMime,
  seekableWebM,
} from "./media-core.js";
import { exportVideo, exportGIF, videoFrame } from "./video-export.js";
import { drawAnnotations } from "./graphics.js";

export function createRecorder({ toast, fail, importFrame }) {
  let root,
    session,
    record,
    url,
    operation = 0,
    acquisition = 0,
    abort,
    region,
    drag,
    annotations = [],
    selectedTool = "pen",
    drawing,
    timer,
    locked = false;
  const source = el(
      "select",
      { id: "record-source" },
      ...[
        ["screen", "Screen or window"],
        ["tab", "Browser tab"],
        ["region", "Custom tab region"],
        ["camera", "Camera only"],
      ].map(([value, name]) => el("option", { value }, name)),
    ),
    mic = el("input", { type: "checkbox" }),
    camera = el("input", { type: "checkbox" }),
    audio = el("input", { type: "checkbox" }),
    height = el(
      "select",
      {},
      ...[720, 1080, 1440, 2160].map((value) =>
        el("option", { value, selected: value === 1080 }, `${value}p maximum`),
      ),
    ),
    format = el(
      "select",
      {},
      ...["webm", "mp4"].map((value) =>
        el(
          "option",
          { value, disabled: !supportedVideoMime(value) },
          value.toUpperCase(),
        ),
      ),
    ),
    bubble = el(
      "select",
      {
        onchange: () =>
          session?.worker?.postMessage({
            type: "options",
            options: { bubble: bubble.value },
          }),
      },
      ...["bottom-right", "bottom-left", "top-right", "top-left"].map((value) =>
        el("option", { value }, value.replace("-", " ")),
      ),
    ),
    micDevice = el(
      "select",
      {},
      el("option", { value: "" }, "Default microphone"),
    ),
    camDevice = el("select", {}, el("option", { value: "" }, "Default camera"));
  const preview = el("video", {
      id: "record-preview",
      muted: true,
      autoplay: true,
      playsInline: true,
    }),
    ink = el("canvas", { id: "record-ink" }),
    previewBox = el("div", { className: "record-preview" }, preview, ink),
    state = el(
      "p",
      { role: "status", id: "record-state" },
      "Choose a source to begin.",
    ),
    list = el("div", { className: "suite-list" });
  const choose = button(
      "Choose source",
      () => void acquire().catch(fail),
      "primary",
    ),
    start = button(
      "Start recording",
      () => void startRecording().catch(fail),
      "primary",
    ),
    pause = button("Pause", () =>
      session?.state === "paused" ? session.resume() : session?.pause(),
    ),
    stop = button("Stop", () => void session?.stop()),
    cancel = button("Cancel source", () => void cancelSource());
  const player = el("video", {
      id: "video-player",
      controls: true,
      playsInline: true,
    }),
    title = el("input", {
      id: "record-title",
      maxLength: 200,
      ariaLabel: "Recording title",
    }),
    trimStart = el("input", {
      id: "video-start",
      type: "number",
      min: 0,
      step: 0.01,
      value: 0,
    }),
    trimEnd = el("input", {
      id: "video-end",
      type: "number",
      min: 0,
      step: 0.01,
    }),
    mute = el("input", { id: "video-mute", type: "checkbox" }),
    exportFormat = el(
      "select",
      {},
      ...["webm", "mp4"].map((value) =>
        el(
          "option",
          { value, disabled: !supportedVideoMime(value) },
          value.toUpperCase(),
        ),
      ),
    ),
    gifWidth = el(
      "select",
      {},
      ...[320, 480, 640, 960].map((value) =>
        el("option", { value, selected: value === 640 }, `${value}px`),
      ),
    ),
    gifFps = el(
      "select",
      {},
      ...[4, 8, 12].map((value) =>
        el("option", { value, selected: value === 8 }, `${value} fps`),
      ),
    ),
    exportProgress = el("p", { role: "status" }),
    edit = el("div", { className: "record-editor", hidden: true });
  const saveSettings = async () => {
    if (record)
      record = await patchSuiteItem("recordings", record.id, {
        title: title.value || "Untitled recording",
        edit: {
          start: Number(trimStart.value),
          end: Number(trimEnd.value),
          mute: mute.checked,
        },
      });
  };
  for (const node of [title, trimStart, trimEnd, mute])
    node.addEventListener("change", () => void saveSettings().catch(fail));
  const fileInput = el("input", {
    type: "file",
    accept: "video/webm,video/mp4,video/ogg,video/quicktime",
    hidden: true,
    onchange: async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      try {
        if (file.size > 1024 * 1024 * 1024)
          throw new Error("Import a video below 1 GB.");
        const created = await importRecording(file),
          id = created.id;
        await open(id);
        await refresh();
      } catch (error) {
        fail(error);
      }
    },
  });
  const status = async (next) => {
    state.textContent =
      next === "ready"
        ? source.value === "region"
          ? "Drag a rectangle over the preview, then start recording."
          : "Source ready. Click Start recording."
        : next === "paused"
          ? "Paused. Resume when ready."
          : next === "recording"
            ? "Recording — chunks are saving locally."
            : next === "stopping"
              ? "Saving final chunks…"
              : next === "starting"
                ? "Starting the video encoder…"
                : next === "choosing"
                  ? "Waiting for browser permission…"
                  : "Recording stopped.";
    sync();
    if (next === "stopped") {
      preview.srcObject = null;
      annotations = [];
      drawInk();
      await refresh();
      if (session?.record?.nextChunk) await open(session.record.id);
    }
  };
  function sync() {
    const active = !!session && !["idle", "stopped"].includes(session.state);
    choose.disabled = active || locked;
    for (const input of [
      source,
      mic,
      camera,
      audio,
      height,
      format,
      micDevice,
      camDevice,
    ])
      input.disabled = active || locked;
    start.hidden = session?.state !== "ready";
    cancel.hidden = !["ready", "choosing", "starting"].includes(session?.state);
    pause.hidden = !["recording", "paused"].includes(session?.state);
    pause.textContent = session?.state === "paused" ? "Resume" : "Pause";
    stop.hidden = !["recording", "paused", "stopping"].includes(session?.state);
    stop.disabled = session?.state === "stopping";
    previewBox.hidden = !active;
    ink.style.pointerEvents =
      (session?.state === "ready" && source.value === "region") ||
      ["recording", "paused"].includes(session?.state)
        ? "auto"
        : "none";
  }
  async function acquire() {
    if (locked || (session && !["idle", "stopped"].includes(session.state)))
      return;
    operation++;
    const generation = ++acquisition;
    region = null;
    annotations = [];
    let created;
    created = new RecordingSession({
      onState: (next) => {
        if (session === created && generation === acquisition)
          void status(next).catch(fail);
      },
      onError: (error) => {
        if (session === created && generation === acquisition) fail(error);
      },
    });
    session = created;
    try {
      const stream = await session.acquire({
        source: source.value,
        microphone: mic.checked,
        camera: camera.checked,
        systemAudio: audio.checked,
        cameraId: camDevice.value,
        microphoneId: micDevice.value,
        height: height.value,
        format: format.value,
        bubble: bubble.value,
      });
      if (generation !== acquisition) return;
      preview.srcObject = stream;
      await preview.play();
      ink.width = preview.videoWidth;
      ink.height = preview.videoHeight;
      previewBox.style.aspectRatio = `${ink.width}/${ink.height}`;
      drawInk();
      const devices = await navigator.mediaDevices.enumerateDevices();
      for (const [kind, select] of [
        ["audioinput", micDevice],
        ["videoinput", camDevice],
      ]) {
        const value = select.value;
        select.replaceChildren(
          el(
            "option",
            { value: "" },
            `Default ${kind === "audioinput" ? "microphone" : "camera"}`,
          ),
          ...devices
            .filter((d) => d.kind === kind)
            .map((d, i) =>
              el("option", { value: d.deviceId }, d.label || `Device ${i + 1}`),
            ),
        );
        select.value = value;
      }
      sync();
    } catch (error) {
      if (generation === acquisition) {
        sync();
        throw error;
      }
    }
  }
  async function cancelSource() {
    acquisition++;
    operation++;
    await session?.stop();
    preview.srcObject = null;
    state.textContent = "Source cancelled.";
    sync();
  }
  async function startRecording() {
    if (session?.state !== "ready") return;
    if (source.value === "region" && !region)
      throw new Error("Drag a region on the preview first.");
    const target = session,
      generation = acquisition;
    try {
      target.options.bubble = bubble.value;
      await target.start(region);
      if (
        target !== session ||
        generation !== acquisition ||
        target.state !== "recording"
      )
        return;
      preview.srcObject = session.output;
      await preview.play();
      previewBox.style.aspectRatio = `${session.size.width}/${session.size.height}`;
      ink.width = session.size.width;
      ink.height = session.size.height;
      annotations = [];
      drawInk();
    } catch (error) {
      await target.cleanup();
      if (target !== session || generation !== acquisition) return;
      sync();
      throw error;
    }
  }
  const coordinate = (event) => {
    const rect = ink.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          ink.width,
          ((event.clientX - rect.left) * ink.width) / rect.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          ink.height,
          ((event.clientY - rect.top) * ink.height) / rect.height,
        ),
      ),
    };
  };
  ink.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const p = coordinate(event);
    drag = p;
    ink.setPointerCapture(event.pointerId);
    if (session.state !== "ready")
      drawing = {
        type: selectedTool,
        color: "#f43f5e",
        size: Math.max(3, ink.width / 360),
        points: [p, p],
        rect: { x: p.x, y: p.y, width: 0, height: 0 },
      };
  });
  ink.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const p = coordinate(event),
      r = {
        x: Math.min(drag.x, p.x),
        y: Math.min(drag.y, p.y),
        width: Math.abs(p.x - drag.x),
        height: Math.abs(p.y - drag.y),
      };
    if (session.state === "ready")
      region = {
        x: r.x / ink.width,
        y: r.y / ink.height,
        width: r.width / ink.width,
        height: r.height / ink.height,
      };
    else {
      if (selectedTool === "pen") drawing.points.push(p);
      else drawing.points[1] = p;
      drawing.rect = r;
    }
    drawInk();
  });
  ink.addEventListener("pointerup", (event) => {
    if (drawing) {
      annotations.push(drawing);
      drawing = null;
    }
    drag = null;
    if (ink.hasPointerCapture(event.pointerId))
      ink.releasePointerCapture(event.pointerId);
    drawInk();
  });
  ink.addEventListener("pointercancel", () => {
    drag = null;
    drawing = null;
    drawInk();
  });
  function drawInk() {
    const ctx = ink.getContext("2d");
    ctx.clearRect(0, 0, ink.width, ink.height);
    drawAnnotations(ctx, [...annotations, ...(drawing ? [drawing] : [])], ink);
    if (region && session?.state === "ready") {
      ctx.strokeStyle = "#7955e8";
      ctx.lineWidth = Math.max(3, ink.width / 400);
      ctx.strokeRect(
        region.x * ink.width,
        region.y * ink.height,
        region.width * ink.width,
        region.height * ink.height,
      );
    }
    if (["recording", "paused"].includes(session?.state))
      void session.overlay(ink).catch(fail);
  }
  async function refresh() {
    if (!root) return;
    const items = await listSuiteItems("recordings");
    await navigator.locks.request(
      "capture-studio-recorder",
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return;
        for (const item of items)
          if (
            item.status === "recording" &&
            item.id !== session?.record?.id &&
            !item.imported
          ) {
            const updated = await transitionRecording(item.id, item.session, {
              status: "interrupted",
            }).catch(() => null);
            if (updated) Object.assign(item, updated);
          }
      },
    );
    list.replaceChildren(
      ...items.map((item) =>
        el(
          "div",
          { className: "suite-row" },
          button(
            `${item.title} · ${readableDuration(item.duration)} · ${formatBytes(item.bytes)}${item.status === "interrupted" ? " · recovered portion" : item.status === "recording" ? " · recording…" : ""}`,
            () => void open(item.id).catch(fail),
            record?.id === item.id ? "primary" : "secondary",
          ),
          ...(["complete", "interrupted"].includes(item.status) &&
          item.nextChunk
            ? [
                button(
                  "Save original file",
                  () =>
                    void recordingBlob(item).then(
                      (blob) =>
                        downloadBlob(
                          blob,
                          item.originalName ||
                            `${item.title}.${videoExtension(item.mime)}`,
                        ),
                      fail,
                    ),
                ),
              ]
            : []),
        ),
      ),
    );
    if (!items.length) list.append(el("p", {}, "No recordings yet."));
  }
  async function open(id) {
    if (locked) throw new Error("Finish or cancel the current export first.");
    const next = await getSuiteItem("recordings", id);
    if (!next) return;
    if (["recording", "stopping"].includes(next.status))
      throw new Error("Stop this recording before editing it.");
    if (!next.nextChunk) throw new Error("No recording chunks were saved.");
    const generation = ++operation;
    let blob = await recordingBlob(next);
    blob = await seekableWebM(blob, next.duration);
    if (generation !== operation) return;
    player.pause();
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(blob);
    player.src = url;
    await waitForMedia(player);
    if (generation !== operation) return;
    let duration = player.duration;
    if (!Number.isFinite(duration)) {
      const ready = waitForMedia(player, "seeked", 15000);
      player.currentTime = 1e10;
      await ready;
      duration = player.duration;
      player.currentTime = 0;
    }
    if (!Number.isFinite(duration) || duration <= 0) duration = next.duration;
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(
        "This interrupted video has no readable duration. You can still download its saved original.",
      );
    const metadata =
      next.duration !== duration || !next.width
        ? await patchSuiteItem("recordings", next.id, {
            duration,
            width: next.width || player.videoWidth,
            height: next.height || player.videoHeight,
          })
        : next;
    record = { ...metadata, duration };
    title.value = record.title;
    trimStart.value = record.edit?.start || 0;
    trimEnd.value = record.edit?.end || duration;
    trimStart.max = trimEnd.max = duration;
    mute.checked = !!record.edit?.mute;
    edit.hidden = false;
    exportProgress.textContent = `${record.width || player.videoWidth} × ${record.height || player.videoHeight} · ${readableDuration(duration)}${next.status === "interrupted" ? " · recovered saved portion; verify playback" : ""}`;
    await refresh();
  }
  async function original() {
    if (!record) return;
    downloadBlob(
      await seekableWebM(await recordingBlob(record), record.duration),
      record.originalName || `${title.value}.${videoExtension(record.mime)}`,
    );
  }
  async function render(gif = false) {
    if (!record || locked) return;
    locked = true;
    abort = new AbortController();
    sync();
    exportProgress.textContent = gif
      ? "Encoding GIF…"
      : "Exporting the selected clip in real time…";
    try {
      const options = {
        start: Number(trimStart.value),
        end: Number(trimEnd.value),
        duration: record.duration,
        mute: mute.checked,
        format: exportFormat.value,
        width: Number(gifWidth.value),
        fps: Number(gifFps.value),
        signal: abort.signal,
        progress: (value) => {
          exportProgress.textContent = `${gif ? "GIF" : "Video"} export ${Math.round(value * 100)}%`;
        },
      };
      const blob = await (gif
        ? exportGIF(player, options)
        : exportVideo(player, options));
      downloadBlob(
        blob,
        `${title.value}-edited.${gif ? "gif" : videoExtension(blob.type)}`,
      );
      exportProgress.textContent = "Export ready.";
    } catch (error) {
      exportProgress.textContent =
        error.name === "AbortError" ? "Export cancelled." : error.message;
      if (error.name !== "AbortError") throw error;
    } finally {
      locked = false;
      abort = null;
      sync();
    }
  }
  async function remove() {
    if (!record || locked) return;
    const id = record.id;
    player.pause();
    player.removeAttribute("src");
    player.load();
    if (url) URL.revokeObjectURL(url);
    url = null;
    await deleteSuiteItem("recordings", id);
    record = null;
    edit.hidden = true;
    await refresh();
  }
  const tools = el(
    "div",
    { className: "suite-row" },
    ...["pen", "arrow", "highlight", "redact"].map((value) =>
      button(value, () => {
        selectedTool = value;
      }),
    ),
    button("Undo ink", () => {
      annotations.pop();
      drawInk();
    }),
    button("Clear ink", () => {
      annotations = [];
      drawInk();
    }),
  );
  edit.append(
    field("Title", title),
    player,
    el(
      "div",
      { className: "suite-row" },
      field("Trim start (seconds)", trimStart),
      field("Trim end (seconds)", trimEnd),
      field("Remove audio", mute),
      field("Video format", exportFormat),
    ),
    el(
      "div",
      { className: "suite-row" },
      button("Export edited video", () => void render().catch(fail), "primary"),
      button("Download original", () => void original().catch(fail)),
      button("Restore original settings", () => {
        trimStart.value = 0;
        trimEnd.value = record.duration;
        mute.checked = false;
        void saveSettings().catch(fail);
      }),
      button("Cancel export", () => abort?.abort()),
    ),
    el(
      "div",
      { className: "suite-row" },
      ...[
        ["image/png", "png"],
        ["image/jpeg", "jpg"],
        ["image/webp", "webp"],
      ].map(([type, ext]) =>
        button(
          `Save frame ${ext.toUpperCase()}`,
          () =>
            void videoFrame(player, { type }).then(
              (blob) => downloadBlob(blob, `${title.value}-frame.${ext}`),
              fail,
            ),
        ),
      ),
      button(
        "Edit current frame",
        () => void videoFrame(player).then(importFrame, fail),
      ),
    ),
    el(
      "div",
      { className: "suite-row" },
      field("GIF width", gifWidth),
      field("GIF frame rate", gifFps),
      button("Export GIF (up to 20 sec)", () => void render(true).catch(fail)),
      button("Delete recording", () => void remove().catch(fail)),
    ),
    exportProgress,
  );
  async function mount(node) {
    root = node;
    node.replaceChildren(
      el(
        "div",
        { className: "suite-heading" },
        el(
          "div",
          {},
          el("h1", {}, "Record & explain"),
          el(
            "p",
            {},
            "Screen, tab, region or camera. Saved in chunks on this device.",
          ),
        ),
        button("Import video", () => fileInput.click()),
      ),
      el(
        "div",
        { className: "record-settings" },
        field("Source", source),
        field("Microphone", mic),
        field("Camera bubble", camera),
        field("Shared source audio", audio),
        field("Quality", height),
        field("Format", format),
        field("Bubble position", bubble),
        field("Microphone device", micDevice),
        field("Camera device", camDevice),
      ),
      el("div", { className: "suite-row" }, choose, start, pause, stop, cancel),
      state,
      previewBox,
      tools,
      el("h2", {}, "Saved recordings"),
      list,
      edit,
      fileInput,
    );
    sync();
    await refresh();
    clearInterval(timer);
    timer = setInterval(() => {
      if (session?.state === "recording")
        state.textContent = `Recording ${readableDuration(session.elapsed())} · ${formatBytes(session.record?.bytes || 0)} saved locally`;
    }, 1000);
  }
  window.addEventListener("pagehide", () => {
    abort?.abort();
    session?.stopTracks();
    void session?.stop();
    clearInterval(timer);
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message.type === "CS_RECORD_PING") {
      respond({
        ok:
          message.session === session?.record?.session &&
          ["recording", "paused", "starting", "stopping"].includes(
            session?.state,
          ),
      });
      return;
    }
    if (
      message.type !== "CS_RECORD_CONTROL" ||
      message.id !== session?.record?.id ||
      message.session !== session?.record?.session
    )
      return;
    if (message.action === "pause")
      session.state === "paused" ? session.resume() : session.pause();
    if (message.action === "stop") void session.stop();
  });
  return {
    mount,
    hasPending: () =>
      locked || (!!session && !["idle", "stopped"].includes(session.state)),
    flush: async () => {},
    active: () => session?.state,
  };
}
