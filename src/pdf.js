import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { makeCanvas, canvasBlob, renderImage } from "./graphics.js";
import { MAX_TILE_PIXELS } from "./core.js";
import { choosePDFLayout, PDF_MARGIN } from "./pdf-layout.js";

GlobalWorkerOptions.workerSrc = new URL(
  "pdf.worker.min.mjs",
  location.href,
).href;
export async function imagesToPDF(
  images,
  {
    pageSize = "auto",
    orientation = "auto",
    quality = 0.85,
    scale = 1,
    title = "Capture",
    source = "",
    footer = false,
    onProgress = () => {},
  } = {},
) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("Capture Studio");
  pdf.setCreator("Capture Studio");
  const font = footer ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  const layout = choosePDFLayout(images, {
    pageSize,
    orientation,
    scale,
    footer,
  });
  for (let index = 0; index < images.length; index++) {
    const canvas = await renderImage(images[index], {
      scale,
      background: "#fff",
    });
    const {
      page: paper,
      sliceHeight,
      drawWidth: plannedWidth,
    } = layout.plans[index];
    const page = [paper.width, paper.height],
      margin = PDF_MARGIN;
    for (let y = 0; y < canvas.height; y += sliceHeight) {
      const height = Math.min(sliceHeight, canvas.height - y);
      const slice = makeCanvas(canvas.width, height);
      slice
        .getContext("2d")
        .drawImage(
          canvas,
          0,
          y,
          canvas.width,
          height,
          0,
          0,
          canvas.width,
          height,
        );
      const jpg = await pdf.embedJpg(
        await (await canvasBlob(slice, "image/jpeg", quality)).arrayBuffer(),
      );
      const pdfPage = pdf.addPage(page);
      const drawWidth = plannedWidth || page[0] - margin * 2,
        drawHeight = (height * drawWidth) / canvas.width;
      pdfPage.drawImage(jpg, {
        x: margin,
        y: page[1] - margin - drawHeight,
        width: drawWidth,
        height: drawHeight,
      });
      if (footer) {
        let label = (source || title)
          .replace(/[^\x20-\x7e]/g, "")
          .slice(0, 100);
        const suffix = `  |  ${pdf.getPageCount()}`;
        while (
          label.length &&
          font.widthOfTextAtSize(label + suffix, 7) > drawWidth
        )
          label = label.slice(0, -1);
        const text = label + suffix;
        pdfPage.drawText(text, {
          x: margin,
          y: 18,
          size: Math.min(
            7,
            (7 * drawWidth) / Math.max(1, font.widthOfTextAtSize(text, 7)),
          ),
          font,
          color: rgb(0.4, 0.4, 0.45),
        });
      }
      slice.width = 1;
    }
    canvas.width = 1;
    onProgress((index + 1) / images.length);
  }
  return new Blob([await pdf.save({ useObjectStreams: true })], {
    type: "application/pdf",
  });
}
export async function compressPDF(
  file,
  {
    mode = "lossless",
    quality = 0.75,
    dpi = 110,
    onProgress = () => {},
    signal,
  } = {},
) {
  signal?.throwIfAborted();
  const data = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  if (mode === "lossless") {
    const pdf = await PDFDocument.load(data, { updateMetadata: false });
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const result = new Blob(
      [await pdf.save({ useObjectStreams: true, addDefaultPage: false })],
      { type: "application/pdf" },
    );
    signal?.throwIfAborted();
    onProgress(1);
    return {
      blob: result.size < file.size ? result : file,
      changed: result.size < file.size,
      pages: pdf.getPageCount(),
    };
  }
  const task = getDocument({
    data,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: true,
    cMapUrl: new URL("cmaps/", location.href).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", location.href).href,
    wasmUrl: new URL("wasm/", location.href).href,
    iccUrl: new URL("iccs/", location.href).href,
  });
  const abort = () => {
    void task.destroy();
  };
  signal?.addEventListener("abort", abort, { once: true });
  let document;
  try {
    document = await task.promise;
    if (document.numPages > 300)
      throw new Error(
        "Raster compression supports up to 300 pages per PDF. Use content-preserving optimization for larger files.",
      );
    const output = await PDFDocument.create();
    for (let number = 1; number <= document.numPages; number++) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const page = await document.getPage(number);
      const original = page.getViewport({ scale: 1 });
      if (original.width > 14400 || original.height > 14400)
        throw new Error(
          "This PDF has unusually large pages. Use content-preserving optimization.",
        );
      const scale = Math.min(
        dpi / 72,
        5000 / Math.max(original.width, original.height),
        Math.sqrt(MAX_TILE_PIXELS / (original.width * original.height)),
      );
      const viewport = page.getViewport({ scale });
      const canvas = makeCanvas(viewport.width, viewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          background: "#ffffff",
        }).promise;
        const jpg = await output.embedJpg(
          await (await canvasBlob(canvas, "image/jpeg", quality)).arrayBuffer(),
        );
        output.addPage([original.width, original.height]).drawImage(jpg, {
          x: 0,
          y: 0,
          width: original.width,
          height: original.height,
        });
      } finally {
        canvas.width = 1;
        page.cleanup();
      }
      onProgress(number / document.numPages);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const result = new Blob([await output.save({ useObjectStreams: true })], {
      type: "application/pdf",
    });
    signal?.throwIfAborted();
    return {
      blob: result.size < file.size ? result : file,
      changed: result.size < file.size,
      pages: document.numPages,
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
