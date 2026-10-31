import {
  textBounds,
  resizeText,
  moveText,
  textHandles,
} from "./text-layout.js";
import {
  transformedRect,
  redactionBounds,
  affineAnnotations,
} from "./annotation-geometry.js";
export function objectBounds(ctx, a) {
  if (a.type === "text") return textBounds(ctx, a);
  if (a.type === "redact") return redactionBounds(a);
  let r = a.rect;
  if (a.type === "step") {
    const radius = Math.max(18, (a.size || 4) * 4);
    r = {
      x: a.x - radius,
      y: a.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
  } else if (a.points?.length) {
    const xs = a.points.map((p) => p.x),
      ys = a.points.map((p) => p.y),
      padding = (a.size || 4) * (a.type === "arrow" ? 3 : 1);
    r = {
      x: Math.min(...xs) - padding,
      y: Math.min(...ys) - padding,
      width: Math.max(...xs) - Math.min(...xs) + padding * 2,
      height: Math.max(...ys) - Math.min(...ys) + padding * 2,
    };
  }
  return transformedRect(a.transform, r || { x: 0, y: 0, width: 1, height: 1 });
}
export function objectHandles(ctx, a) {
  if (a.type === "text") return textHandles(ctx, a);
  const r = objectBounds(ctx, a);
  return [
    ["nw", 0, 0],
    ["n", 0.5, 0],
    ["ne", 1, 0],
    ["e", 1, 0.5],
    ["se", 1, 1],
    ["s", 0.5, 1],
    ["sw", 0, 1],
    ["w", 0, 0.5],
  ].map(([name, x, y]) => ({
    name,
    x: r.x + r.width * x,
    y: r.y + r.height * y,
  }));
}
export function hitObject(ctx, annotations, p) {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const r = objectBounds(ctx, annotations[i]);
    if (
      p.x >= r.x - 5 &&
      p.y >= r.y - 5 &&
      p.x <= r.x + r.width + 5 &&
      p.y <= r.y + r.height + 5
    )
      return i;
  }
  return null;
}
export function moveObject(a, dx, dy) {
  return a.type === "text"
    ? moveText(a, dx, dy)
    : affineAnnotations([a], [1, 0, 0, 1, dx, dy])[0];
}
export function resizeObject(ctx, a, handle, start, end) {
  if (a.type === "text") return resizeText(ctx, a, handle, start, end);
  const r = objectBounds(ctx, a);
  let x = r.x,
    y = r.y,
    right = x + r.width,
    bottom = y + r.height;
  if (handle.includes("w")) x = Math.min(right - 2, x + end.x - start.x);
  if (handle.includes("e")) right = Math.max(x + 2, right + end.x - start.x);
  if (handle.includes("n")) y = Math.min(bottom - 2, y + end.y - start.y);
  if (handle.includes("s")) bottom = Math.max(y + 2, bottom + end.y - start.y);
  const sx = (right - x) / Math.max(1, r.width),
    sy = (bottom - y) / Math.max(1, r.height);
  return affineAnnotations([a], [sx, 0, 0, sy, x - r.x * sx, y - r.y * sy])[0];
}
