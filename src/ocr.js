import { createWorker } from "tesseract.js";
import { el, button, field, downloadBlob } from "./suite-ui.js";
import { makeCanvas, canvasBlob } from "./graphics.js";

export function createOCR({ snapshot, toast, fail, saveNote }) {
  let worker,
    workerLanguage,
    operation = 0,
    running = false,
    initializing,
    rejectOperation;
  function guarded(promise, timeout = 120000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (rejectOperation === cancel) rejectOperation = null;
          error ? reject(error) : resolve(value);
        },
        cancel = (error) => finish(error),
        timer = setTimeout(
          () =>
            finish(
              new Error(
                "Text recognition timed out. Try a smaller image or another language.",
              ),
            ),
          timeout,
        );
      rejectOperation = cancel;
      Promise.resolve(promise).then(
        (value) => finish(null, value),
        (error) => finish(error),
      );
    });
  }
  const dialog = el("dialog", {
      className: "suite-dialog",
      id: "ocr-dialog",
      ariaLabel: "Extract text offline",
    }),
    language = el(
      "select",
      { id: "ocr-language" },
      ...[
        ["eng", "English"],
        ["spa", "Spanish"],
        ["ara", "Arabic"],
      ].map(([value, name]) => el("option", { value }, name)),
    ),
    quality = el("input", { type: "checkbox" }),
    progress = el("p", { role: "status" }),
    text = el("textarea", {
      id: "ocr-result",
      className: "ocr-result",
      ariaLabel: "Recognized text",
      placeholder: "Recognized text appears here. Review it before using it.",
    });
  const start = button(
    "Extract text",
    () => void recognize().catch(fail),
    "primary",
  );
  dialog.append(
    el(
      "div",
      { className: "suite-heading" },
      el("h2", {}, "Extract text on this device"),
      button("Close", () => {
        cancel();
        dialog.close();
      }),
    ),
    el(
      "p",
      {},
      "Recognition uses your flattened image, including solid redactions. Review the result for errors.",
    ),
    el(
      "div",
      { className: "suite-row" },
      field("Language", language),
      field("Full resolution (slower)", quality),
      start,
      button("Cancel recognition", cancel),
    ),
    progress,
    text,
    el(
      "div",
      { className: "suite-row" },
      button(
        "Copy text",
        () =>
          void navigator.clipboard
            .writeText(text.value)
            .then(() => toast("Text copied."), fail),
      ),
      button("Download .txt", () =>
        downloadBlob(
          new Blob([text.value], { type: "text/plain;charset=utf-8" }),
          "recognized-text.txt",
        ),
      ),
      button(
        "Save as note",
        () => void saveNote(text.value).then(() => dialog.close(), fail),
      ),
    ),
  );
  document.body.append(dialog);
  async function cancel() {
    rejectOperation?.(new DOMException("Recognition cancelled.", "AbortError"));
    rejectOperation = null;
    initializing?.terminate();
    initializing = null;
    operation++;
    running = false;
    start.disabled = false;
    progress.textContent = "Recognition cancelled.";
    const old = worker;
    worker = null;
    workerLanguage = null;
    await old?.terminate().catch(() => {});
  }
  async function recognize() {
    if (running) return;
    const generation = ++operation;
    running = true;
    start.disabled = true;
    text.value = "";
    try {
      let blob = await snapshot();
      if (generation !== operation) return;
      const bitmap = await createImageBitmap(blob);
      try {
        const scale = quality.checked
          ? 1
          : Math.min(1, Math.sqrt(6000000 / (bitmap.width * bitmap.height)));
        if (scale < 1) {
          const canvas = makeCanvas(
            bitmap.width * scale,
            bitmap.height * scale,
          );
          canvas
            .getContext("2d")
            .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          blob = await canvasBlob(canvas);
          canvas.width = canvas.height = 1;
          progress.textContent =
            "Working image uniformly fitted to 6 megapixels. No edges cropped.";
        }
      } finally {
        bitmap.close();
      }
      if (generation !== operation) return;
      const lang = language.value;
      if (workerLanguage !== lang) {
        await worker?.terminate();
        if (generation !== operation) return;
        worker = null;
        workerLanguage = null;
        const created = await guarded(
          createWorker(lang, 1, {
            onWorker: (value) => {
              initializing = value;
            },
            workerPath: chrome.runtime.getURL("ocr/worker.min.js"),
            corePath: chrome.runtime.getURL("ocr/core"),
            langPath: chrome.runtime.getURL("ocr/models"),
            workerBlobURL: false,
            cacheMethod: "none",
            gzip: true,
            logger: (message) => {
              if (generation === operation)
                progress.textContent = `${message.status} · ${Math.round((message.progress || 0) * 100)}%`;
            },
            errorHandler: (error) => {
              if (generation === operation) {
                progress.textContent = String(error);
                rejectOperation?.(new Error(String(error)));
              }
            },
          }),
          30000,
        );
        initializing = null;
        if (generation !== operation) {
          await created.terminate();
          return;
        }
        worker = created;
        workerLanguage = lang;
      }
      if (generation !== operation) return;
      const result = await guarded(worker.recognize(blob));
      if (generation === operation) {
        text.value = result.data.text;
        progress.textContent = `Ready · confidence ${Math.round(result.data.confidence)}% · review the text below.`;
      }
    } catch (error) {
      if (generation === operation) {
        progress.textContent = error.message;
        initializing?.terminate();
        initializing = null;
        await worker?.terminate().catch(() => {});
        worker = null;
        workerLanguage = null;
        if (error.name !== "AbortError") throw error;
      }
    } finally {
      if (generation === operation) {
        running = false;
        start.disabled = false;
      }
    }
  }
  dialog.addEventListener("cancel", () => void cancel());
  return { open: () => dialog.showModal(), close: cancel };
}
