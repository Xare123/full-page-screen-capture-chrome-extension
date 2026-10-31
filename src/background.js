import {
  isCapturableUrl,
  planPositions,
  planTiles,
  rasterRect,
} from "./core.js";
import { putProject } from "./db.js";

let activeJob = null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function status(value) {
  await chrome.storage.session.set({
    captureStatus: { ...value, updated: Date.now() },
  });
}
async function pageMessage(tabId, type, data = {}) {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: `CS_PAGE_${type}`,
    ...data,
  });
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
    await chrome.scripting.executeScript({
      target: { tabId: job.tab.id },
      files: ["content.js"],
    });
    injected = true;
    await assertActive(job);
    let region;
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
      mode: job.mode,
      bars: job.bars,
    });
    const full = job.mode === "full";
    const positions = full
      ? planPositions(
          dimensions.width,
          dimensions.height,
          dimensions.captureViewportWidth || dimensions.viewportWidth,
          dimensions.captureViewportHeight || dimensions.viewportHeight,
        )
      : [null];
    const cssWidth =
      region?.width || (full ? dimensions.width : dimensions.viewportWidth);
    const cssHeight =
      region?.height || (full ? dimensions.height : dimensions.viewportHeight);
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
        const source = position.source ||
          region || {
            x: 0,
            y: 0,
            width: dimensions.viewportWidth,
            height: dimensions.viewportHeight,
          };
        const sample = rasterRect(source, scaleX, scaleY);
        const destination = rasterRect(
          {
            x: full ? position.x : 0,
            y: full ? position.y : 0,
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
        annotations: [],
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
      images,
    });
    // A fully committed capture remains in the library; cancellation/navigation must
    // still prevent completion UI and an unexpected editor tab during the save.
    await assertActive(job);
    await status({
      phase: "done",
      progress: 1,
      message: "Your capture is ready.",
      projectId: id,
    });
    await assertActive(job);
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
      mode: ["full", "visible", "region"].includes(message.mode)
        ? message.mode
        : "full",
      delay: [0, 3, 5, 10].includes(Number(message.delay))
        ? Number(message.delay)
        : 0,
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
    !trustedPage ||
    !["CS_START", "CS_CANCEL", "CS_STATUS"].includes(message.type)
  )
    return;
  const handle = async () => {
    if (message.type === "CS_START") return startCapture(message);
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
