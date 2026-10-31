import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as core from "../../src/core.js";
import {
  affineAnnotations,
  redactionBounds,
} from "../../src/annotation-geometry.js";
import {
  completedRectangle,
  planElementPositions,
} from "../../src/capture-coverage.js";

async function harness({
  scrollFrame,
  screenshotFrame,
  holdSave = false,
  holdBoundary,
} = {}) {
  let listener, currentStatus, releaseSave, markBoundary, releaseBoundary;
  let tab = {
    id: 1,
    windowId: 1,
    active: true,
    url: "https://example.test/",
    title: "Stress",
  };
  const phases = [],
    opened = [],
    canvases = [];
  let saved = 0,
    restored = 0,
    captured = false,
    captureCount = 0;
  const dimensions = {
    width: 800,
    height: 1200,
    viewportWidth: 800,
    viewportHeight: 600,
    dpr: 1,
  };
  let position = { x: 0, y: 0 };
  let markSaving;
  const saving = new Promise((resolve) => {
    markSaving = resolve;
  });
  const saveGate = new Promise((resolve) => {
    releaseSave = resolve;
  });
  const boundary = new Promise((resolve) => {
    markBoundary = resolve;
  });
  const boundaryGate = new Promise((resolve) => {
    releaseBoundary = resolve;
  });
  const sandbox = {
    ...core,
    completedRectangle,
    planElementPositions,
    affineAnnotations,
    redactionBounds,
    setupSuiteBackground() {},
    setupPageBackground() {},
    openCapturedEditor: async () => false,
    Blob,
    Uint8Array,
    atob,
    console,
    crypto: { randomUUID: () => "stress-capture" },
    setTimeout: (fn) => {
      queueMicrotask(fn);
      return 1;
    },
    setInterval: () => 1,
    clearInterval() {},
    createImageBitmap: async () => ({ width: 800, height: 600, close() {} }),
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        canvases.push(this);
      }
      getContext() {
        return {
          drawImage() {},
          save() {},
          restore() {},
          scale() {},
          fillRect() {},
          beginPath() {},
          rect() {},
          clip() {},
        };
      }
      async convertToBlob() {
        return new Blob(["pixels"], { type: "image/png" });
      }
    },
    putProject: async () => {
      markSaving();
      if (holdSave) await saveGate;
      saved++;
    },
    chrome: {
      runtime: {
        id: "studio",
        getURL: (file) => `chrome-extension://studio/${file}`,
        onMessage: {
          addListener: (fn) => {
            listener = fn;
          },
        },
      },
      commands: { onCommand: { addListener() {} } },
      scripting: { executeScript: async () => {} },
      storage: {
        session: {
          get: async () => ({ captureStatus: currentStatus }),
          set: async ({ captureStatus }) => {
            if (holdBoundary === "status" && captureStatus.phase === "done") {
              markBoundary();
              await boundaryGate;
            }
            currentStatus = captureStatus;
            phases.push(captureStatus.phase);
          },
        },
      },
      tabs: {
        query: async () => [tab],
        get: async () => {
          if (holdBoundary === "active-check" && saved) {
            markBoundary();
            await boundaryGate;
          }
          if (!tab) throw new Error("No tab with id: 1");
          return tab;
        },
        create: async (value) => {
          opened.push(value);
        },
        captureVisibleTab: async () => {
          captured = true;
          captureCount++;
          return "data:image/png;base64,AQ==";
        },
        sendMessage: async (_, message) => {
          if (message.type === "CS_PAGE_RESTORE") {
            restored++;
            return { ok: true };
          }
          if (message.type === "CS_PAGE_TARGET")
            return { ok: true, data: { kind: "page" } };
          if (message.type === "CS_PAGE_PREPARE")
            return { ok: true, data: dimensions };
          if (message.type === "CS_PAGE_SCROLL") {
            position = { x: message.x, y: message.y };
            captured = false;
          }
          const changed =
            message.type === "CS_PAGE_SCROLL"
              ? scrollFrame
              : captured && captureCount > 1
                ? screenshotFrame
                : undefined;
          return { ok: true, data: { ...dimensions, ...position, ...changed } };
        },
      },
    },
  };
  const source = (
    await readFile(new URL("../../src/background.js", import.meta.url), "utf8")
  )
    .replace(/^import[\s\S]*?from "\.\/core.js";\n/, "")
    .replace(/^import[\s\S]*?from ["'][^"']+["'];\n/gm, "");
  vm.runInNewContext(source, sandbox);
  const send = (message) =>
    new Promise((resolve) =>
      listener(
        message,
        { id: "studio", url: "chrome-extension://studio/popup.html" },
        resolve,
      ),
    );
  const finish = async () => {
    for (
      let i = 0;
      i < 500 && !["done", "error"].includes(currentStatus?.phase);
      i++
    )
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      ["done", "error"].includes(currentStatus?.phase),
      "capture must reach a terminal state",
    );
    await new Promise((resolve) => setImmediate(resolve));
    return currentStatus;
  };
  return {
    send,
    finish,
    saving,
    releaseSave,
    boundary,
    releaseBoundary,
    phases,
    opened,
    canvases,
    changeTab: (value) => {
      tab = value === null ? null : { ...tab, ...value };
    },
    get saved() {
      return saved;
    },
    get restored() {
      return restored;
    },
  };
}

test("document geometry and position changes fail before publishing incomplete captures", async () => {
  for (const scrollFrame of [
    { height: 700 },
    { width: 900 },
    { x: 100 },
    { y: 100 },
  ]) {
    const h = await harness({ scrollFrame });
    await h.send({ type: "CS_START", mode: "full" });
    const result = await h.finish();
    assert.equal(result.phase, "error");
    assert.match(result.message, /changed size|moved/);
    assert.equal(h.saved, 0);
    assert.equal(h.opened.length, 0);
    assert.ok(h.restored > 0);
  }
});
test("document changes during screenshot acquisition fail and release allocated canvases", async () => {
  const h = await harness({ screenshotFrame: { height: 700 } });
  await h.send({ type: "CS_START", mode: "full" });
  assert.match((await h.finish()).message, /changed size/);
  assert.equal(h.saved, 0);
  assert.ok(h.canvases.length > 0);
  assert.ok(
    h.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1),
  );
});
test("cancel, navigation, tab switching and tab closure during saving never open an editor", async () => {
  for (const action of ["cancel", "navigate", "switch", "close"]) {
    const h = await harness({ holdSave: true });
    await h.send({ type: "CS_START", mode: "visible" });
    await h.saving;
    if (action === "cancel") await h.send({ type: "CS_CANCEL" });
    if (action === "navigate")
      h.changeTab({ url: "https://example.test/next" });
    if (action === "switch") h.changeTab({ active: false });
    if (action === "close") h.changeTab(null);
    h.releaseSave();
    assert.equal((await h.finish()).phase, "error");
    assert.equal(
      h.saved,
      1,
      "an already committed complete capture remains recoverable in the library",
    );
    assert.equal(h.opened.length, 0);
    assert.ok(!h.phases.includes("done"));
    assert.ok(h.restored > 0);
    assert.ok(
      h.canvases.every((canvas) => canvas.width === 1 && canvas.height === 1),
    );
  }
});
test("cancellation during final asynchronous checks cannot cross the editor-opening boundary", async () => {
  for (const holdBoundary of ["active-check", "status"]) {
    const h = await harness({ holdBoundary });
    await h.send({ type: "CS_START", mode: "visible" });
    await h.boundary;
    await h.send({ type: "CS_CANCEL" });
    h.releaseBoundary();
    assert.equal((await h.finish()).phase, "error");
    assert.equal(h.opened.length, 0);
    assert.equal(h.saved, 1);
    assert.ok(h.restored > 0);
  }
});
