import {
  isCapturableUrl,
  planPositions,
  planTiles,
  rasterRect,
} from "./core.js";
import { putProject } from "./db.js";
import {
  completedRectangle,
  planElementPositions,
} from "./capture-coverage.js";
import { setupSuiteBackground } from "./suite-background.js";
import { setupPageBackground, openCapturedEditor } from "./page-background.js";
import { affineAnnotations, redactionBounds } from "./annotation-geometry.js";
setupSuiteBackground();
setupPageBackground();

let activeJob = null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function status(value) {
  await chrome.storage.session.set({
    captureStatus: { ...value, updated: Date.now() },
  });
}
async function pageMessage(tabId, type, data = {}) {
  const response = await chrome.tabs.sendMessage(
    tabId,
    {
      type: `CS_PAGE_${type}`,
      ...data,
    },
    activeJob?.tab?.id === tabId && activeJob.documentId
      ? { documentId: activeJob.documentId }
      : undefined,
  );
  if (!response?.ok)
    throw new Error(
      response?.error ||
        "The page stopped responding. Reload it and try again.",
    );
  return response.data;
}
async function assertActive(job) {
  if (job.cancelled) throw new Error("Capture cancelled.");
  const tab = await chrome.tabs.get(job.tab.id);
  if (job.cancelled) throw new Error("Capture cancelled.");
  if (!tab.active || tab.url !== job.tab.url)
    throw new Error(
      "Capture stopped because the page or active tab changed. Keep the source tab open and try again.",
    );
  return tab;
}
async function runCapture(job) {
  let injected = false,
    tiles;
  const coverage = [];
  let stopped = false;
  const keepAlive = setInterval(
    () => chrome.storage.session.get("captureStatus").catch(() => {}),
    20000,
  );
  try {
    await status({
      phase: "capturing",
      progress: 0,
      message: job.delay
        ? `Starting in ${job.delay} seconds…`
        : "Preparing the page…",
    });
    for (let i = 0; i < job.delay * 5; i++) {
      await wait(200);
      await assertActive(job);
    }
    await assertActive(job);
    const injection = await chrome.scripting.executeScript({
      target: { tabId: job.tab.id },
      files: ["content.js"],
    });
    job.documentId = injection?.[0]?.documentId;
    injected = true;
    job.presentation = await chrome.tabs
      .sendMessage(
        job.tab.id,
        { type: "CS_PRESENT_CAPTURE", action: "hide" },
        { documentId: job.documentId },
      )
      .catch(() => null);
    await assertActive(job);
    let region;
    if (job.mode === "element") {
      await status({
        phase: "selecting",
        progress: 0,
        message:
          "Choose an element. Up/down arrows select parent or child; Esc cancels.",
      });
      await pageMessage(job.tab.id, "SELECT_ELEMENT");
    }
    if (job.mode === "full") {
      const target = await pageMessage(job.tab.id, "TARGET", {
        scope: job.scope,
      });
      if (target.kind === "choose") {
        await status({
          phase: "selecting",
          progress: 0,
          message:
            "Click a scrolling area to capture. Tab switches panes; Esc cancels.",
        });
        await assertActive(job);
        await pageMessage(job.tab.id, "SELECT_PANE");
      }
      await assertActive(job);
    }
    if (job.mode === "region") {
      await status({
        phase: "selecting",
        progress: 0,
        message: "Drag a region on the page. Press Esc to cancel.",
      });
      await assertActive(job);
      region = await pageMessage(job.tab.id, "SELECT");
      await assertActive(job);
    }
    await status({
      phase: "capturing",
      progress: 0,
      message: "Preparing the capture…",
    });
    await assertActive(job);
    const dimensions = await pageMessage(job.tab.id, "PREPARE", {
      mode: job.mode === "element" ? "full" : job.mode,
      clean: job.clean,
      presentationRedactions: (job.presentation?.annotations || [])
        .filter((a) => a.type === "redact")
        .map(redactionBounds),
      bars: job.bars,
    });
    const full = ["full", "element"].includes(job.mode);
    const element = dimensions.element;
    let origin = full
      ? { x: element?.x || 0, y: element?.y || 0 }
      : {
          x: (dimensions.rootPosition?.x || 0) + (region?.x || 0),
          y: (dimensions.rootPosition?.y || 0) + (region?.y || 0),
        };
    if (full && dimensions.rootRTL) origin.x -= dimensions.rootMaxX;
    let pageAnnotations = job.presentation?.annotations || [];
    if (dimensions.originalPane) {
      const p = dimensions.originalPane;
      origin = {
        x: p.box.x + p.rootX - p.scroll.x,
        y: p.box.y + p.rootY - p.scroll.y,
      };
      const clip = {
        x: Math.max(0, p.box.x) + p.rootX,
        y: Math.max(0, p.box.y) + p.rootY,
        width: Math.max(
          0,
          Math.min(dimensions.viewportWidth, p.box.x + p.box.width) -
            Math.max(0, p.box.x),
        ),
        height: Math.max(
          0,
          Math.min(dimensions.viewportHeight, p.box.y + p.box.height) -
            Math.max(0, p.box.y),
        ),
      };
      pageAnnotations = pageAnnotations.map((a) => ({ ...a, clip }));
    }
    const tileAnnotations = (tile) =>
      affineAnnotations(pageAnnotations, [
        scaleX,
        0,
        0,
        scaleY,
        -origin.x * scaleX - tile.x,
        -origin.y * scaleY - tile.y,
      ]);
    const positions = full
      ? element
        ? planElementPositions(
            dimensions.width,
            dimensions.height,
            dimensions.viewportWidth,
            dimensions.viewportHeight,
            element,
          )
        : planPositions(
            dimensions.width,
            dimensions.height,
            dimensions.captureViewportWidth || dimensions.viewportWidth,
            dimensions.captureViewportHeight || dimensions.viewportHeight,
          ).filter(
            (p) =>
              !element ||
              (p.x < element.x + element.width &&
                p.x + dimensions.viewportWidth > element.x &&
                p.y < element.y + element.height &&
                p.y + dimensions.viewportHeight > element.y),
          )
      : [null];
    const cssWidth =
      region?.width ||
      element?.width ||
      (full ? dimensions.width : dimensions.viewportWidth);
    const cssHeight =
      region?.height ||
      element?.height ||
      (full ? dimensions.height : dimensions.viewportHeight);
    let scaleX,
      scaleY,
      lastCapture = 0;
    function validateFrame(frame, requested) {
      if (
        frame.viewportWidth !== dimensions.viewportWidth ||
        frame.viewportHeight !== dimensions.viewportHeight ||
        frame.dpr !== dimensions.dpr
      )
        throw new Error(
          "The viewport changed during capture. Please try again.",
        );
      if (
        Math.abs(frame.width - dimensions.width) > 1 ||
        Math.abs(frame.height - dimensions.height) > 1
      )
        throw new Error(
          "The scrolling content changed size during capture. Let it finish loading and try again.",
        );
      if (
        Math.abs(frame.x - requested.x) > 1 ||
        Math.abs(frame.y - requested.y) > 1
      )
        throw new Error(
          "The page or scrolling area moved during capture. Keep it still and try again.",
        );
      if (
        element &&
        (!frame.element ||
          ["x", "y", "width", "height"].some(
            (key) => Math.abs(frame.element[key] - element[key]) > 0.5,
          ))
      )
        throw new Error(
          "The selected element moved or changed size during capture. Try again after the page settles.",
        );
      if (dimensions.kind === "pane") {
        if (
          !frame.source ||
          ["x", "y", "width", "height"].some(
            (key) => Math.abs(frame.source[key] - dimensions.source[key]) > 0.5,
          )
        )
          throw new Error(
            "The scrolling area moved during capture. Keep the pane still and try again.",
          );
      }
    }
    for (let index = 0; index < positions.length; index++) {
      if (job.stop) {
        if (!coverage.length)
          throw new Error(
            "Capture stopped before the first section was ready.",
          );
        stopped = true;
        break;
      }
      await assertActive(job);
      let position = { x: 0, y: 0 };
      if (full) {
        position = await pageMessage(job.tab.id, "SCROLL", {
          ...positions[index],
        });
        validateFrame(position, positions[index]);
      }
      await wait(Math.max(0, 570 - (Date.now() - lastCapture)));
      await assertActive(job);
      if (full) {
        const current = await pageMessage(job.tab.id, "FRAME");
        validateFrame(current, position);
        position = current;
      }
      const data = await chrome.tabs.captureVisibleTab(job.tab.windowId, {
        format: "png",
      });
      lastCapture = Date.now();
      await assertActive(job);
      if (full) validateFrame(await pageMessage(job.tab.id, "FRAME"), position);
      const bytes = Uint8Array.from(atob(data.split(",")[1]), (char) =>
        char.charCodeAt(0),
      );
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/png" }),
      );
      try {
        if (
          tiles &&
          (bitmap.width !== Math.round(dimensions.viewportWidth * scaleX) ||
            bitmap.height !== Math.round(dimensions.viewportHeight * scaleY))
        )
          throw new Error(
            "The screenshot scale changed during capture. Please try again.",
          );
        if (!tiles) {
          scaleX = bitmap.width / dimensions.viewportWidth;
          scaleY = bitmap.height / dimensions.viewportHeight;
          tiles = planTiles(cssWidth * scaleX, cssHeight * scaleY).map(
            (tile) => ({
              ...tile,
              canvas: new OffscreenCanvas(tile.width, tile.height),
            }),
          );
        }
        let source = position.source ||
          region || {
            x: 0,
            y: 0,
            width: dimensions.viewportWidth,
            height: dimensions.viewportHeight,
          };
        let destinationX = full ? position.x : 0,
          destinationY = full ? position.y : 0;
        if (element) {
          const left = Math.max(position.x, element.x),
            top = Math.max(position.y, element.y),
            right = Math.min(
              position.x + dimensions.viewportWidth,
              element.x + element.width,
            ),
            bottom = Math.min(
              position.y + dimensions.viewportHeight,
              element.y + element.height,
            );
          source = {
            x: left - position.x,
            y: top - position.y,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top),
          };
          destinationX = left - element.x;
          destinationY = top - element.y;
        }
        if (source.width <= 0 || source.height <= 0) continue;
        const sample = rasterRect(source, scaleX, scaleY);
        const destination = rasterRect(
          {
            x: destinationX,
            y: destinationY,
            width: source.width,
            height: source.height,
          },
          scaleX,
          scaleY,
        );
        const {
          x: sourceX,
          y: sourceY,
          width: sourceWidth,
          height: sourceHeight,
        } = sample;
        const {
          x: destX,
          y: destY,
          width: destWidth,
          height: destHeight,
        } = destination;
        coverage.push({
          x: destX,
          y: destY,
          width: destWidth,
          height: destHeight,
        });
        for (const tile of tiles) {
          if (
            destX < tile.x + tile.width &&
            destX + destWidth > tile.x &&
            destY < tile.y + tile.height &&
            destY + destHeight > tile.y
          ) {
            tile.canvas
              .getContext("2d")
              .drawImage(
                bitmap,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                destX - tile.x,
                destY - tile.y,
                destWidth,
                destHeight,
              );
          }
        }
      } finally {
        bitmap.close();
      }
      await status({
        phase: "capturing",
        progress: (index + 1) / positions.length,
        message: `Captured ${index + 1} of ${positions.length} sections`,
      });
    }
    await assertActive(job);
    await status({
      phase: "capturing",
      progress: 1,
      message: "Saving to your local library…",
    });
    if (!tiles?.length || !coverage.length)
      throw new Error("No visible pixels were captured.");
    if (stopped || job.stop) {
      const complete = completedRectangle(
        coverage,
        Math.round(cssWidth * scaleX),
        Math.round(cssHeight * scaleY),
      );
      if (!complete)
        throw new Error("No completed capture section was available.");
      const cropped = [];
      for (const tile of tiles) {
        const width = Math.min(tile.width, complete.width - tile.x),
          height = Math.min(tile.height, complete.height - tile.y);
        if (width <= 0 || height <= 0) {
          tile.canvas.width = tile.canvas.height = 1;
          continue;
        }
        if (width !== tile.width || height !== tile.height) {
          const canvas = new OffscreenCanvas(width, height);
          canvas.getContext("2d").drawImage(tile.canvas, 0, 0);
          tile.canvas.width = tile.canvas.height = 1;
          cropped.push({ ...tile, width, height, canvas });
        } else cropped.push(tile);
      }
      tiles = cropped;
      stopped = true;
    }
    const images = [];
    const preview = new OffscreenCanvas(
      320,
      Math.min(220, Math.round((tiles[0].height * 320) / tiles[0].width)),
    );
    preview
      .getContext("2d")
      .drawImage(
        tiles[0].canvas,
        0,
        0,
        tiles[0].width,
        (preview.height * tiles[0].width) / 320,
        0,
        0,
        preview.width,
        preview.height,
      );
    const previewContext = preview.getContext("2d");
    previewContext.save();
    previewContext.scale(320 / tiles[0].width, 320 / tiles[0].width);
    for (const a of tileAnnotations(tiles[0]).filter(
      (a) => a.type === "redact",
    )) {
      const r = redactionBounds(a);
      previewContext.save();
      if (a.clip) {
        previewContext.beginPath();
        previewContext.rect(a.clip.x, a.clip.y, a.clip.width, a.clip.height);
        previewContext.clip();
      }
      previewContext.fillStyle = "#111111";
      previewContext.fillRect(r.x, r.y, r.width, r.height);
      previewContext.restore();
    }
    previewContext.restore();
    const thumbnail = await preview.convertToBlob({
      type: "image/jpeg",
      quality: 0.7,
    });
    preview.width = preview.height = 1;
    for (const tile of tiles) {
      await assertActive(job);
      images.push({
        blob: await tile.canvas.convertToBlob({ type: "image/png" }),
        width: tile.width,
        height: tile.height,
        x: tile.x,
        y: tile.y,
        annotations: tileAnnotations(tile),
      });
      tile.canvas.width = 1;
      tile.canvas.height = 1;
    }
    const id = crypto.randomUUID();
    await assertActive(job);
    await putProject({
      id,
      title: job.tab.title || "Untitled capture",
      source: job.tab.url,
      thumbnail,
      created: Date.now(),
      updated: Date.now(),
      mode: dimensions.kind === "pane" ? "pane" : job.mode,
      partial: stopped,
      images,
    });
    // A fully committed capture remains in the library; cancellation/navigation must
    // still prevent completion UI and an unexpected editor tab during the save.
    await assertActive(job);
    await status({
      phase: "done",
      progress: 1,
      message: stopped
        ? "Your completed capture area is ready."
        : "Your capture is ready.",
      projectId: id,
    });
    await assertActive(job);
    if (injected) {
      await pageMessage(job.tab.id, "RESTORE");
      injected = false;
    }
    await chrome.tabs
      .sendMessage(
        job.tab.id,
        { type: "CS_PRESENT_CAPTURE", action: "restore" },
        job.documentId ? { documentId: job.documentId } : undefined,
      )
      .catch(() => {});
    if (await openCapturedEditor(job, id)) return;
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`app.html#${id}`),
      windowId: job.tab.windowId,
    });
  } catch (error) {
    await status({
      phase: "error",
      progress: 0,
      message:
        error.message ||
        "Capture failed. Please reload the page and try again.",
    });
  } finally {
    clearInterval(keepAlive);
    for (const tile of tiles || []) tile.canvas.width = tile.canvas.height = 1;
    if (injected) await pageMessage(job.tab.id, "RESTORE").catch(() => {});
    await chrome.tabs
      .sendMessage(
        job.tab.id,
        { type: "CS_PRESENT_CAPTURE", action: "restore" },
        job.documentId ? { documentId: job.documentId } : undefined,
      )
      .catch(() => {});
    if (activeJob === job) activeJob = null;
  }
}
async function startCapture(message) {
  if (activeJob)
    throw new Error("A capture is already running. Finish or cancel it first.");
  const job = { cancelled: false };
  activeJob = job;
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id || !isCapturableUrl(tab.url))
      throw new Error(
        "Open a regular web page to capture it. Browser settings, the Web Store, and extension pages are protected.",
      );
    Object.assign(job, {
      tab,
      mode: ["full", "visible", "region", "element"].includes(message.mode)
        ? message.mode
        : "full",
      delay: [0, 3, 5, 10].includes(Number(message.delay))
        ? Number(message.delay)
        : 0,
      clean: message.clean === true,
      inline: message.inline === true,
      bars: message.bars === "hide" ? "hide" : "smart",
      scope: ["page", "pick"].includes(message.scope) ? message.scope : "auto",
    });
    void runCapture(job);
    return { ok: true };
  } catch (error) {
    if (activeJob === job) activeJob = null;
    throw error;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const trustedPage = ["popup.html", "app.html"].some(
    (file) => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(file),
  );
  if (
    sender.id !== chrome.runtime.id ||
    (sender.frameId ?? 0) !== 0 ||
    !trustedPage ||
    !["CS_START", "CS_CANCEL", "CS_STATUS", "CS_STOP"].includes(message.type)
  )
    return;
  const handle = async () => {
    if (message.type === "CS_START") return startCapture(message);
    if (message.type === "CS_STOP") {
      if (activeJob) activeJob.stop = true;
      return { ok: true };
    }
    if (message.type === "CS_CANCEL") {
      if (activeJob) {
        activeJob.cancelled = true;
        if (activeJob.tab)
          await pageMessage(activeJob.tab.id, "RESTORE").catch(() => {});
      }
      return { ok: true };
    }
    const { captureStatus } = await chrome.storage.session.get("captureStatus");
    if (!activeJob && ["capturing", "selecting"].includes(captureStatus?.phase))
      return {
        phase: "error",
        message: "The previous capture was interrupted. Please try again.",
      };
    return captureStatus || { phase: "idle" };
  };
  handle().then(respond, (error) =>
    respond({ ok: false, error: error.message }),
  );
  return true;
});
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-studio")
    void chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
  if (command === "capture-full-page")
    void startCapture({ mode: "full" }).catch((error) =>
      status({ phase: "error", message: error.message }),
    );
});
