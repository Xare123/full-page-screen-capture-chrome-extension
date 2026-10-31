import {
  putSuiteItem,
  patchSuiteItem,
  appendRecordingChunk,
} from "./suite-db.js";
import { fitVideo, videoRegion, supportedVideoMime } from "./media-core.js";

export class RecordingSession {
  constructor({ onState = () => {}, onError = () => {} } = {}) {
    this.onState = onState;
    this.onError = onError;
    this.streams = new Set();
    this.cancelled = false;
    this.state = "idle";
    this.writes = Promise.resolve();
    this.pendingBytes = 0;
    this.duration = 0;
    this.startedAt = 0;
    this.index = 0;
  }
  own(stream) {
    if (this.cancelled) {
      stream.getTracks().forEach((t) => t.stop());
      throw new DOMException("Recording cancelled.", "AbortError");
    }
    this.streams.add(stream);
    return stream;
  }
  elapsed() {
    return (
      this.duration +
      (this.state === "recording"
        ? (performance.now() - this.startedAt) / 1000
        : 0)
    );
  }
  setState(state) {
    this.state = state;
    this.onState(state, this);
  }
  async acquire(options) {
    this.options = options;
    this.setState("choosing");
    try {
      let source;
      if (options.source === "camera")
        source = this.own(
          await navigator.mediaDevices.getUserMedia({
            video: options.cameraId
              ? { deviceId: { exact: options.cameraId } }
              : true,
            audio: false,
          }),
        );
      else
        source = this.own(
          await navigator.mediaDevices.getDisplayMedia({
            video: {
              frameRate: { ideal: options.fps || 30 },
              ...(options.source !== "screen"
                ? { displaySurface: "browser" }
                : {}),
            },
            audio: !!options.systemAudio,
            selfBrowserSurface: "exclude",
            ...(options.source !== "screen" ? { preferCurrentTab: false } : {}),
          }),
        );
      if (
        ["tab", "region"].includes(options.source) &&
        source.getVideoTracks()[0].getSettings().displaySurface !== "browser"
      )
        throw new Error(
          "Choose a browser tab in the sharing dialog for tab recording.",
        );
      this.source = source;
      source.getVideoTracks()[0].addEventListener(
        "ended",
        () => {
          this.cancelled = true;
          void this.stop();
        },
        { once: true },
      );
      if (options.camera && options.source !== "camera")
        this.camera = this.own(
          await navigator.mediaDevices.getUserMedia({
            video: options.cameraId
              ? { deviceId: { exact: options.cameraId } }
              : true,
            audio: false,
          }),
        );
      if (options.microphone)
        this.microphone = this.own(
          await navigator.mediaDevices.getUserMedia({
            audio: options.microphoneId
              ? { deviceId: { exact: options.microphoneId } }
              : true,
            video: false,
          }),
        );
      this.assertLive();
      this.setState("ready");
      return source;
    } catch (error) {
      await this.cleanup();
      this.setState("idle");
      throw error;
    }
  }
  assertLive() {
    if (
      this.cancelled ||
      this.source?.getVideoTracks().some((t) => t.readyState !== "live")
    )
      throw new DOMException("The recording source was stopped.", "AbortError");
  }
  async start(region) {
    if (this.state !== "ready" || this.cancelled)
      throw new Error("Choose a source before recording.");
    this.setState("starting");
    try {
      const options = this.options,
        settings = this.source.getVideoTracks()[0].getSettings(),
        r = videoRegion(region, settings.width, settings.height),
        size = fitVideo(r.width, r.height, Number(options.height) || 1080),
        mime = supportedVideoMime(options.format);
      if (!mime)
        throw new Error(
          "This browser cannot encode the selected video format.",
        );
      // A Web Lock prevents two studio tabs from owning the same active recording.
      let resolveLock, rejectLock;
      const acquired = new Promise((resolve, reject) => {
        resolveLock = resolve;
        rejectLock = reject;
      });
      this.lockTask = navigator.locks.request(
        "capture-studio-recorder",
        { ifAvailable: true },
        (lock) => {
          if (!lock) {
            rejectLock(
              new Error(
                "A recording is already running in another studio tab.",
              ),
            );
            return;
          }
          resolveLock();
          return new Promise((resolve) => {
            this.releaseLock = resolve;
          });
        },
      );
      await acquired;
      this.assertLive();
      const track = this.source.getVideoTracks()[0],
        processor = new MediaStreamTrackProcessor({ track }),
        generator = new MediaStreamTrackGenerator({ kind: "video" }),
        worker = new Worker(chrome.runtime.getURL("recording-worker.js"), {
          type: "module",
        });
      this.worker = worker;
      const stream = this.own(new MediaStream([generator]));
      this.output = stream;
      let camera;
      if (this.camera)
        camera = new MediaStreamTrackProcessor({
          track: this.camera.getVideoTracks()[0],
        }).readable;
      const compositorError = (error) =>
        this.settleFrame ? this.settleFrame(error) : this.abort(error);
      worker.onerror = (event) =>
        compositorError(
          new Error(event.message || "The recording compositor stopped."),
        );
      worker.onmessage = ({ data }) => {
        if (data.type === "error") compositorError(new Error(data.error));
        if (data.type === "frame") this.settleFrame?.();
        if (data.type === "ended" && this.state === "starting")
          this.settleFrame?.(
            new Error("The recording source ended before producing a frame."),
          );
        if (
          data.type === "ended" &&
          ["recording", "paused"].includes(this.state)
        )
          void this.stop();
      };
      const audio = [
        ...(options.systemAudio ? this.source.getAudioTracks() : []),
        ...(this.microphone?.getAudioTracks() || []),
      ];
      if (audio.length) {
        this.audioContext = new AudioContext();
        const destination = this.audioContext.createMediaStreamDestination();
        for (const audioTrack of audio)
          this.audioContext
            .createMediaStreamSource(new MediaStream([audioTrack]))
            .connect(destination);
        await this.audioContext.resume();
        for (const audioTrack of destination.stream.getAudioTracks())
          stream.addTrack(audioTrack);
        this.streams.add(destination.stream);
      }
      this.recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: Number(options.bitrate) || 6000000,
        audioBitsPerSecond: 128000,
      });
      this.record = await putSuiteItem("recordings", {
        id: crypto.randomUUID(),
        title: options.title || `Recording ${new Date().toLocaleString()}`,
        session: crypto.randomUUID(),
        created: Date.now(),
        revision: 0,
        status: "recording",
        bytes: 0,
        nextChunk: 0,
        duration: 0,
        width: size.width,
        height: size.height,
        mime: this.recorder.mimeType || mime,
        source: options.source,
      });
      this.assertLive();
      const registered = await chrome.runtime.sendMessage({
        type: "CS_RECORD_OWNER",
        id: this.record.id,
        session: this.record.session,
        sourceTab: options.sourceTab,
      });
      if (!registered?.ok)
        throw new Error(
          registered?.error || "Could not register the recording.",
        );
      this.assertLive();
      this.recorder.ondataavailable = (event) => this.enqueue(event.data);
      this.recorder.onerror = (event) =>
        compositorError(event.error || new Error("The video encoder stopped."));
      this.finished = new Promise((resolve) => {
        this.resolveFinished = resolve;
      });
      this.recorder.onstop = () => {
        this.settleFrame?.(
          new DOMException("Recording stopped during startup.", "AbortError"),
        );
        void this.finalize();
      };
      const firstFrame = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            this.settleFrame?.(
              new Error(
                "The source did not provide a video frame. Choose the source again.",
              ),
            ),
          10000,
        );
        this.settleFrame = (error) => {
          clearTimeout(timer);
          this.settleFrame = null;
          error ? reject(error) : resolve();
        };
      });
      // Cleanup can reject readiness if a synchronous startup operation fails.
      firstFrame.catch(() => {});
      this.size = size;
      this.recorder.start(1000);
      this.encoderStarted = true;
      worker.postMessage(
        {
          type: "start",
          readable: processor.readable,
          writable: generator.writable,
          camera,
          options: {
            ...size,
            live: true,
            region: region || null,
            bubble: options.bubble || "bottom-right",
          },
        },
        [processor.readable, generator.writable, ...(camera ? [camera] : [])],
      );
      await firstFrame;
      this.assertLive();
      if (this.recorder.state !== "recording")
        throw new DOMException("Recording cancelled.", "AbortError");
      this.startedAt = performance.now();
      this.setState("recording");
      return this.record;
    } catch (error) {
      this.storageError ??= error;
      // Once started, onstop/finalize owns the terminal write, including an
      // already-inactive encoder whose final chunk events are still queued.
      if (this.encoderStarted) {
        if (this.recorder.state !== "inactive") await this.stop();
        else await this.finished;
      }
      if (this.record && !this.encoderStarted)
        await transitionRecording(this.record.id, this.record.session, {
          status: "interrupted",
          error: error.message,
        }).catch(() => {});
      await this.cleanup();
      if (this.state !== "stopped") this.setState("idle");
      throw error;
    }
  }
  enqueue(blob) {
    if (!blob.size || this.storageError) return;
    const index = this.index++,
      duration = this.elapsed();
    this.pendingBytes += blob.size;
    if (
      this.pendingBytes > 32 * 1024 * 1024 &&
      this.recorder.state === "recording"
    ) {
      this.backpressure = true;
      this.pause();
    }
    this.writes = this.writes.then(async () => {
      if (this.storageError) return;
      try {
        this.record = await appendRecordingChunk(
          this.record.id,
          this.record.session,
          index,
          blob,
          duration,
        );
      } catch (error) {
        this.storageError = error;
        this.abort(error);
      } finally {
        this.pendingBytes -= blob.size;
        if (
          this.backpressure &&
          this.pendingBytes < 4 * 1024 * 1024 &&
          !this.storageError &&
          this.state === "paused"
        ) {
          this.backpressure = false;
          this.resume();
        }
      }
    });
  }
  pause() {
    if (this.state !== "recording") return;
    this.duration = this.elapsed();
    this.recorder.pause();
    this.setState("paused");
  }
  resume() {
    if (this.state !== "paused" || this.storageError || this.backpressure)
      return;
    this.startedAt = performance.now();
    this.recorder.resume();
    this.setState("recording");
  }
  async stop() {
    if (["idle", "stopped"].includes(this.state)) return this.record;
    if (this.state === "stopping") return this.finished;
    this.duration = this.elapsed();
    this.setState("stopping");
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
      this.stopTracks();
      return this.finished;
    }
    await this.cleanup();
    this.setState("stopped");
    return this.record;
  }
  abort(error) {
    if (!this.storageError) this.storageError = error;
    this.onError(error);
    void this.stop();
  }
  async finalize() {
    try {
      await this.writes;
      if (
        this.record &&
        (!this.record.bytes || !this.record.nextChunk) &&
        !this.storageError
      ) {
        this.storageError = new Error(
          "No video frames were saved. Choose the source again.",
        );
        this.onError(this.storageError);
      }
      if (this.record) {
        this.record = await transitionRecording(
          this.record.id,
          this.record.session,
          {
            status: this.storageError ? "interrupted" : "complete",
            duration: this.storageError ? this.record.duration : this.duration,
            error: this.storageError?.message || "",
          },
        );
      }
    } catch (error) {
      this.onError(error);
    } finally {
      await this.cleanup();
      this.setState("stopped");
      this.resolveFinished?.(this.record);
    }
  }
  stopTracks() {
    for (const stream of this.streams)
      for (const track of stream.getTracks())
        try {
          track.stop();
        } catch {}
  }
  async cleanup() {
    this.settleFrame?.(new DOMException("Recording cancelled.", "AbortError"));
    this.cancelled = true;
    this.stopTracks();
    this.worker?.postMessage({ type: "stop" });
    this.worker?.terminate();
    this.worker = null;
    await this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.releaseLock?.();
    this.releaseLock = null;
    this.streams.clear();
    if (this.record)
      await chrome.runtime
        .sendMessage({
          type: "CS_RECORD_RELEASE",
          id: this.record.id,
          session: this.record.session,
        })
        .catch(() => {});
  }
  async overlay(canvas) {
    if (!this.worker) return;
    const bitmap = await createImageBitmap(canvas);
    if (!this.worker) {
      bitmap.close();
      return;
    }
    this.worker.postMessage({ type: "overlay", bitmap }, [bitmap]);
  }
}

export async function transitionRecording(id, session, patch) {
  const { openSuiteDB } = await import("./suite-db.js"),
    db = await openSuiteDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", "readwrite"),
      store = tx.objectStore("recordings"),
      request = store.get(id);
    let result, error;
    request.onsuccess = () => {
      const current = request.result;
      if (
        !current ||
        current.session !== session ||
        !["recording", "stopping", "interrupted"].includes(current.status)
      ) {
        error = new Error("Recording ownership changed.");
        tx.abort();
        return;
      }
      result = {
        ...current,
        ...patch,
        revision: (current.revision || 0) + 1,
        updated: Date.now(),
      };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(error || tx.error);
  });
}
