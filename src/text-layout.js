import { clamp } from "./core.js";
import { matrixPoint, inversePoint } from "./annotation-geometry.js";
import { nativeTextLayout, textFont } from "./native-text-layout.js";
export { textFont } from "./native-text-layout.js";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export const TEXT_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function textAngle(annotation) {
  return (((annotation.rotation || 0) % 360) * Math.PI) / 180;
}
export function textToImage(annotation, point) {
  const angle = textAngle(annotation),
    c = Math.cos(angle),
    s = Math.sin(angle);
  return matrixPoint(annotation.transform, {
    x: annotation.x + point.x * c - point.y * s,
    y: annotation.y + point.x * s + point.y * c,
  });
}
export function imageToText(annotation, point) {
  const angle = textAngle(annotation),
    c = Math.cos(angle),
    s = Math.sin(angle);
  const local = inversePoint(annotation.transform, point);
  const x = local.x - annotation.x,
    y = local.y - annotation.y;
  return { x: x * c + y * s, y: -x * s + y * c };
}

function wrapText(ctx, text, width) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/u).filter(Boolean)) {
      if (line && ctx.measureText(line + word).width > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (!line && /^\s+$/u.test(word)) continue;
      for (const { segment } of segmenter.segment(word)) {
        if (line && ctx.measureText(line + segment).width > width) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += segment;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function textLayout(ctx, annotation) {
  const fontSize = annotation.fontSize || 28,
    lineHeight = fontSize * 1.3;
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  const text = String(annotation.text || "");
  if (annotation.layoutVersion === 2) {
    ctx.font = textFont(annotation);
    const paddingX = annotation.legacyBox ? 5 : 6,
      paddingY = annotation.legacyBox ? 3 : 6;
    const width = Math.max(fontSize + paddingX * 2, annotation.boxWidth || 360);
    const native = nativeTextLayout(
      text,
      ctx.font,
      width - paddingX * 2,
      lineHeight,
    );
    let baseline = native.baseline;
    if (annotation.legacyBaseline) {
      ctx.save();
      ctx.textBaseline = "alphabetic";
      const alpha = ctx.measureText("Mg").actualBoundingBoxAscent;
      ctx.textBaseline = "top";
      baseline = alpha - ctx.measureText("Mg").actualBoundingBoxAscent;
      ctx.restore();
    }
    return {
      legacy: false,
      fontSize,
      lineHeight,
      paddingX,
      paddingY,
      x: 0,
      y: 0,
      width,
      ...native,
      baseline,
      nativeBaseline: native.baseline,
      // Height must include padding even when native metrics are spread above.
      height: Math.max(annotation.boxHeight || 0, native.height + paddingY * 2),
    };
  }
  if (!Number.isFinite(annotation.boxWidth)) {
    const lines = text.split("\n");
    return {
      legacy: true,
      fontSize,
      lineHeight,
      lines,
      x: -5,
      y: -3,
      width:
        Math.max(0, ...lines.map((line) => ctx.measureText(line).width)) + 10,
      height: Math.max(1, lines.length) * lineHeight,
    };
  }
  const paddingX = annotation.legacyBox ? 5 : 6;
  const paddingY = annotation.legacyBox ? 3 : 6;
  const widestGlyph = Math.max(
    fontSize,
    ...Array.from(
      segmenter.segment(text),
      ({ segment }) => ctx.measureText(segment).width,
    ),
  );
  const width = Math.max(widestGlyph + paddingX * 2, annotation.boxWidth);
  const lines = wrapText(ctx, text, width - paddingX * 2);
  return {
    legacy: false,
    fontSize,
    lineHeight,
    lines,
    paddingX,
    paddingY,
    x: 0,
    y: 0,
    width,
    height: Math.max(
      annotation.boxHeight || 0,
      lines.length * lineHeight + (annotation.legacyBox ? 0 : paddingY * 2),
    ),
  };
}

export function drawText(ctx, annotation) {
  const layout = textLayout(ctx, annotation);
  ctx.translate(annotation.x, annotation.y);
  ctx.rotate(textAngle(annotation));
  ctx.textBaseline = "top";
  if (!layout.legacy) {
    if (annotation.background !== "transparent") {
      ctx.fillStyle = annotation.background || "#ffffff";
      ctx.fillRect(0, 0, layout.width, layout.height);
    }
    ctx.fillStyle = annotation.color || "#7856ff";
    if (annotation.hideText) return;
    if (annotation.layoutVersion === 2) {
      ctx.textBaseline = "alphabetic";
      for (const run of layout.runs) {
        ctx.direction = run.rtl ? "rtl" : "ltr";
        ctx.textAlign = run.rtl ? "right" : "left";
        // Preserve the resolved run direction during Canvas's second bidi pass,
        // including explicit overrides, without reversing Arabic shaping text.
        ctx.fillText(
          (run.rtl ? "\u202e" : "\u202d") + run.text + "\u202c",
          layout.paddingX + (run.rtl ? run.right : run.x),
          layout.paddingY + layout.baseline + run.line * layout.lineHeight,
        );
      }
    } else
      layout.lines.forEach((line, i) =>
        ctx.fillText(
          line,
          layout.paddingX,
          layout.paddingY + i * layout.lineHeight,
        ),
      );
  } else {
    layout.lines.forEach((line, i) => {
      ctx.fillStyle = annotation.background || "#ffffff";
      ctx.fillRect(
        -5,
        i * layout.lineHeight - 3,
        ctx.measureText(line).width + 10,
        layout.lineHeight,
      );
      ctx.fillStyle = annotation.color || "#7856ff";
      ctx.fillText(line, 0, i * layout.lineHeight);
    });
  }
}

export function asTextBox(ctx, annotation) {
  if (Number.isFinite(annotation.boxWidth)) return { ...annotation };
  const layout = textLayout(ctx, annotation);
  const angle = textAngle(annotation),
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    ...annotation,
    x: annotation.x + layout.x * c - layout.y * s,
    y: annotation.y + layout.x * s + layout.y * c,
    boxWidth: layout.width,
    boxHeight: layout.height,
    legacyBox: true,
    background: annotation.background || "#ffffff",
  };
}

export function textHandles(ctx, annotation) {
  const r = textLayout(ctx, annotation);
  return TEXT_HANDLES.map((name) => {
    const x =
      r.x +
      (name.includes("w") ? 0 : name.includes("e") ? r.width : r.width / 2);
    const y =
      r.y +
      (name.includes("n") ? 0 : name.includes("s") ? r.height : r.height / 2);
    return { name, ...textToImage(annotation, { x, y }) };
  });
}
export function hitText(ctx, annotation, point, tolerance = 0) {
  const p = imageToText(annotation, point),
    r = textLayout(ctx, annotation);
  return (
    p.x >= r.x - tolerance &&
    p.y >= r.y - tolerance &&
    p.x <= r.x + r.width + tolerance &&
    p.y <= r.y + r.height + tolerance
  );
}
export function textBounds(ctx, annotation) {
  const r = textLayout(ctx, annotation);
  const corners = [
    [r.x, r.y],
    [r.x + r.width, r.y],
    [r.x, r.y + r.height],
    [r.x + r.width, r.y + r.height],
  ].map(([x, y]) => textToImage(annotation, { x, y }));
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  };
}
export function resizeText(ctx, annotation, handle, start, point) {
  const box = asTextBox(ctx, annotation),
    before = textLayout(ctx, box);
  const a = imageToText(box, start),
    b = imageToText(box, point);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (handle.includes("e") || handle.includes("w"))
    box.boxWidth = clamp(
      before.width + dx * (handle.includes("w") ? -1 : 1),
      before.fontSize + 12,
      16000,
    );
  if (handle.includes("n") || handle.includes("s"))
    box.boxHeight = clamp(
      before.height + dy * (handle.includes("n") ? -1 : 1),
      1,
      16000,
    );
  const after = textLayout(ctx, box);
  const dxOrigin = handle.includes("w") ? before.width - after.width : 0;
  const dyOrigin = handle.includes("n") ? before.height - after.height : 0;
  const angle = textAngle(box),
    c = Math.cos(angle),
    s = Math.sin(angle);
  return {
    ...box,
    x: box.x + dxOrigin * c - dyOrigin * s,
    y: box.y + dxOrigin * s + dyOrigin * c,
  };
}
export function moveText(annotation, dx, dy) {
  const zero = inversePoint(annotation.transform, { x: 0, y: 0 });
  const delta = inversePoint(annotation.transform, { x: dx, y: dy });
  return {
    ...annotation,
    x: annotation.x + delta.x - zero.x,
    y: annotation.y + delta.y - zero.y,
  };
}
