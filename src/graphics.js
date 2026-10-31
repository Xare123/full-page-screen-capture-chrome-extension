import { MAX_DIMENSION, MAX_TILE_PIXELS } from "./core.js";
import { drawText } from "./text-layout.js";
import { redactionBounds, transformedRect } from "./annotation-geometry.js";
import {
  fitsImage,
  planImageExport,
  scaledDimensions,
  validatedDimensions,
} from "./image-layout.js";

export function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
export function canvasBlob(canvas, type = "image/png", quality = 0.85) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error(
                "The browser could not encode this image. Try a smaller export.",
              ),
            ),
      type,
      quality,
    ),
  );
}
export function drawAnnotations(ctx, annotations, base) {
  // Redactions always draw last, so later blurs cannot reveal the original underneath.
  for (const a of [
    ...annotations.filter((a) => a.type !== "redact"),
    ...annotations.filter((a) => a.type === "redact"),
  ]) {
    ctx.save();
    if (a.clip) {
      const r = a.clip;
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.width, r.height);
      ctx.clip();
    }
    if (a.transform && !["redact", "blur"].includes(a.type))
      ctx.transform(...a.transform);
    ctx.strokeStyle = a.color || "#7856ff";
    ctx.fillStyle = a.color || "#7856ff";
    ctx.lineWidth = a.size || 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const r = a.rect;
    if (a.type === "pen") {
      ctx.beginPath();
      a.points.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      ctx.stroke();
    } else if (a.type === "arrow") {
      const [start, end] = a.points;
      const angle = Math.atan2(end.y - start.y, end.x - start.x),
        head = Math.max(14, ctx.lineWidth * 4);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.moveTo(
        end.x - head * Math.cos(angle - Math.PI / 6),
        end.y - head * Math.sin(angle - Math.PI / 6),
      );
      ctx.lineTo(end.x, end.y);
      ctx.lineTo(
        end.x - head * Math.cos(angle + Math.PI / 6),
        end.y - head * Math.sin(angle + Math.PI / 6),
      );
      ctx.stroke();
    } else if (a.type === "rectangle")
      ctx.strokeRect(r.x, r.y, r.width, r.height);
    else if (a.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        r.x + r.width / 2,
        r.y + r.height / 2,
        r.width / 2,
        r.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else if (a.type === "highlight") {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(r.x, r.y, r.width, r.height);
    } else if (a.type === "redact") {
      const covered = redactionBounds(a);
      ctx.fillStyle = "#111111";
      ctx.fillRect(covered.x, covered.y, covered.width, covered.height);
    } else if (a.type === "blur") {
      const bounds = transformedRect(a.transform, r);
      const x = Math.max(0, bounds.x),
        y = Math.max(0, bounds.y);
      const width = Math.min(base.width, bounds.x + bounds.width) - x;
      const height = Math.min(base.height, bounds.y + bounds.height) - y;
      if (width <= 0 || height <= 0) {
        ctx.restore();
        continue;
      }
      const small = makeCanvas(
        Math.max(1, width / 14),
        Math.max(1, height / 14),
      );
      small
        .getContext("2d")
        .drawImage(base, x, y, width, height, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, x, y, width, height);
      small.width = 1;
    } else if (a.type === "text") {
      drawText(ctx, a);
    } else if (a.type === "step") {
      const radius = Math.max(18, a.size * 4);
      ctx.beginPath();
      ctx.arc(a.x, a.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${radius}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(a.number), a.x, a.y);
    }
    ctx.restore();
  }
}
export async function renderImage(image, { scale = 1, background } = {}) {
  validatedDimensions(image);
  const size = scaledDimensions(image, scale);
  if (!fitsImage(size)) throw new Error("Choose a smaller image size.");
  const crop = image.crop || {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  };
  const bitmap = await createImageBitmap(image.blob);
  let canvas, output;
  try {
    if (bitmap.width !== image.width || bitmap.height !== image.height)
      throw new Error("The stored image dimensions do not match its pixels.");
    canvas = makeCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    drawAnnotations(ctx, image.annotations || [], canvas);
    if (
      scale === 1 &&
      crop.x === 0 &&
      crop.y === 0 &&
      crop.width === canvas.width &&
      crop.height === canvas.height
    ) {
      if (background) {
        ctx.save();
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
      const result = canvas;
      canvas = null;
      return result;
    }
    output = makeCanvas(size.width, size.height);
    const out = output.getContext("2d");
    if (background) {
      out.fillStyle = background;
      out.fillRect(0, 0, output.width, output.height);
    }
    out.imageSmoothingQuality = "high";
    out.drawImage(
      canvas,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      output.width,
      output.height,
    );
    const result = output;
    output = null;
    return result;
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 1;
    if (output) output.width = output.height = 1;
  }
}
export async function renderCapture(images, { scale = 1, background } = {}) {
  const plan = planImageExport(images, { scale });
  if (!plan.joined) throw new Error("These parts cannot form one safe image.");
  const output = makeCanvas(plan.width, plan.height);
  let complete = false;
  try {
    const ctx = output.getContext("2d");
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, output.width, output.height);
    }
    ctx.imageSmoothingQuality = "high";
    for (const tile of plan.tiles) {
      if (!tile.width || !tile.height) continue;
      const canvas = await renderImage(images[tile.index]);
      try {
        ctx.drawImage(canvas, tile.x, tile.y, tile.width, tile.height);
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
    complete = true;
    return output;
  } finally {
    if (!complete) output.width = output.height = 1;
  }
}
export async function readImage(blob) {
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
    ].includes(blob.type)
  )
    throw new Error("Choose a PNG, JPEG, WebP, AVIF, or GIF image.");
  const bitmap = await createImageBitmap(blob);
  try {
    if (
      bitmap.width > MAX_DIMENSION ||
      bitmap.height > MAX_DIMENSION ||
      bitmap.width * bitmap.height > MAX_TILE_PIXELS
    )
      throw new Error(
        "This image is too large to edit safely. Use an image below 24 megapixels and 16,000 pixels per side.",
      );
    const canvas = makeCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const result = {
      blob: await canvasBlob(canvas),
      width: canvas.width,
      height: canvas.height,
      annotations: [],
    };
    canvas.width = 1;
    return result;
  } finally {
    bitmap.close();
  }
}
