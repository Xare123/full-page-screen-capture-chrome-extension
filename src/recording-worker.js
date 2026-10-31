let canvas,
  ctx,
  options,
  overlay,
  camera,
  stopped = false,
  writer,
  sourceReader,
  cameraReader,
  firstTimestamp;
const close = (value) => {
  try {
    value?.close();
  } catch {}
};
self.onmessage = async ({ data }) => {
  if (data.type === "overlay") {
    close(overlay);
    overlay = data.bitmap;
    return;
  }
  if (data.type === "options") {
    options = { ...options, ...data.options };
    return;
  }
  if (data.type === "stop") {
    stopped = true;
    await sourceReader?.cancel().catch(() => {});
    await cameraReader?.cancel().catch(() => {});
    return;
  }
  if (data.type !== "start") return;
  options = data.options;
  canvas = new OffscreenCanvas(options.width, options.height);
  ctx = canvas.getContext("2d", { alpha: false });
  writer = data.writable.getWriter();
  sourceReader = data.readable.getReader();
  if (data.camera) {
    cameraReader = data.camera.getReader();
    (async () => {
      try {
        while (!stopped) {
          const { done, value } = await cameraReader.read();
          if (done) break;
          close(camera);
          camera = value;
        }
      } catch {}
    })();
  }
  try {
    while (!stopped) {
      const { done, value: frame } = await sourceReader.read();
      if (done) break;
      let output;
      try {
        firstTimestamp ??= frame.timestamp;
        if (
          options.duration &&
          (frame.timestamp - firstTimestamp) / 1e6 >= options.duration
        ) {
          self.postMessage({ type: "limit" });
          break;
        }
        const r = options.region || { x: 0, y: 0, width: 1, height: 1 },
          sx = r.x * frame.displayWidth,
          sy = r.y * frame.displayHeight,
          sw = r.width * frame.displayWidth,
          sh = r.height * frame.displayHeight,
          scale = Math.min(canvas.width / sw, canvas.height / sh),
          dw = sw * scale,
          dh = sh * scale;
        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          frame,
          sx,
          sy,
          sw,
          sh,
          (canvas.width - dw) / 2,
          (canvas.height - dh) / 2,
          dw,
          dh,
        );
        if (camera) {
          const size = Math.max(
              80,
              Math.round(Math.min(canvas.width, canvas.height) * 0.24),
            ),
            left = options.bubble?.includes("left"),
            top = options.bubble?.includes("top"),
            x = left ? 20 : canvas.width - size - 20,
            y = top ? 20 : canvas.height - size - 20;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
          ctx.clip();
          const crop = Math.min(camera.displayWidth, camera.displayHeight);
          ctx.drawImage(
            camera,
            (camera.displayWidth - crop) / 2,
            (camera.displayHeight - crop) / 2,
            crop,
            crop,
            x,
            y,
            size,
            size,
          );
          ctx.restore();
        }
        if (overlay) ctx.drawImage(overlay, 0, 0, canvas.width, canvas.height);
        output = new VideoFrame(canvas, {
          timestamp: frame.timestamp,
          duration: frame.duration || undefined,
        });
        await writer.write(output);
      } finally {
        close(output);
        close(frame);
      }
    }
  } catch (error) {
    if (!stopped) self.postMessage({ type: "error", error: error.message });
  } finally {
    stopped = true;
    close(camera);
    close(overlay);
    await writer.close().catch(() => {});
    await cameraReader?.cancel().catch(() => {});
    self.postMessage({ type: "ended" });
  }
};
