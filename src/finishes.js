import { makeCanvas, canvasBlob, renderImage } from "./graphics.js";
import { affineAnnotations, inverseMatrix } from "./annotation-geometry.js";
export function planFinish(
  width,
  height,
  { padding = 48, frame = false } = {},
) {
  padding = Math.max(0, Math.min(400, Number(padding) || 0));
  const header = frame ? 44 : 0,
    fullWidth = width + padding * 2,
    fullHeight = height + padding * 2 + header,
    scale = Math.min(
      1,
      16000 / fullWidth,
      16000 / fullHeight,
      Math.sqrt(24000000 / (fullWidth * fullHeight)),
    );
  let w = Math.max(1, Math.floor(fullWidth * scale)),
    h = Math.max(1, Math.floor(fullHeight * scale));
  return {
    width: w,
    height: h,
    scale,
    padding: padding * scale,
    header: header * scale,
    matrix: [scale, 0, 0, scale, padding * scale, (padding + header) * scale],
  };
}
export async function finishImage(record, options) {
  let original = record.finish
    ? {
        blob: record.finish.blob,
        width: record.finish.width,
        height: record.finish.height,
        annotations: [],
      }
    : { ...record, annotations: [] };
  let annotations = record.finish
    ? affineAnnotations(
        record.annotations || [],
        inverseMatrix(record.finish.matrix),
      )
    : structuredClone(record.annotations || []);
  // Bake every existing mask before resizing; backups never retain covered pixels.
  const base = await renderImage({
    ...original,
    annotations: annotations.filter((a) => a.type === "redact"),
  });
  let out;
  try {
    if (original.crop)
      annotations = affineAnnotations(annotations, [
        1,
        0,
        0,
        1,
        -original.crop.x,
        -original.crop.y,
      ]);
    const safeBase = await canvasBlob(base);
    if (options.remove)
      return {
        ...record,
        blob: safeBase,
        width: base.width,
        height: base.height,
        annotations,
        finish: null,
        crop: null,
        layoutChanged: true,
      };
    const plan = planFinish(base.width, base.height, options);
    out = makeCanvas(plan.width, plan.height);
    const ctx = out.getContext("2d");
    if (options.background !== "transparent") {
      let color = options.background || "#eee9ff";
      if (options.gradient) {
        const gradient = ctx.createLinearGradient(0, 0, out.width, out.height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, "#fef3e7");
        color = gradient;
      }
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    const p = plan.padding,
      header = plan.header,
      w = base.width * plan.scale,
      h = base.height * plan.scale,
      radius = Math.min(32, Number(options.radius) || 0) * plan.scale;
    if (options.shadow) {
      ctx.save();
      ctx.shadowColor = "#17203555";
      ctx.shadowBlur = 24 * plan.scale;
      ctx.shadowOffsetY = 8 * plan.scale;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.roundRect(p, p, w, h + header, radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(p, p, w, h + header, radius);
    ctx.clip();
    if (header) {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(p, p, w, header);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ["#fb7185", "#fbbf24", "#34d399"][i];
        ctx.beginPath();
        ctx.arc(
          p + (17 + i * 15) * plan.scale,
          p + 22 * plan.scale,
          4 * plan.scale,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = "#475569";
      ctx.font = `${12 * plan.scale}px sans-serif`;
      ctx.fillText(
        String(options.title || "Capture Studio").slice(0, 100),
        p + 72 * plan.scale,
        p + 26 * plan.scale,
        Math.max(1, w - 90 * plan.scale),
      );
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(base, p, p + header, w, h);
    ctx.restore();
    return {
      ...record,
      blob: await canvasBlob(out),
      width: out.width,
      height: out.height,
      annotations: affineAnnotations(annotations, plan.matrix),
      finish: {
        blob: safeBase,
        width: base.width,
        height: base.height,
        matrix: plan.matrix,
        options: structuredClone(options),
      },
      crop: null,
      layoutChanged: true,
    };
  } finally {
    base.width = base.height = 1;
    if (out) out.width = out.height = 1;
  }
}
