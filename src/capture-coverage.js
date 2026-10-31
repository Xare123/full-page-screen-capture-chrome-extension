// The first row may be only partly captured. Once one full row is available,
import { planPositions } from "./core.js";
export function planElementPositions(
  pageWidth,
  pageHeight,
  viewportWidth,
  viewportHeight,
  element,
) {
  if (
    element.x < -0.5 ||
    element.y < -0.5 ||
    element.x + element.width > pageWidth + 0.5 ||
    element.y + element.height > pageHeight + 0.5
  )
    throw new Error(
      "This element extends outside the scrollable page. Capture a visible region instead.",
    );
  const seen = new Set();
  return planPositions(
    element.width,
    element.height,
    viewportWidth,
    viewportHeight,
  )
    .map((p) => ({
      x: Math.max(0, Math.min(pageWidth - viewportWidth, element.x + p.x)),
      y: Math.max(0, Math.min(pageHeight - viewportHeight, element.y + p.y)),
    }))
    .filter((p) => {
      const key = `${p.x}:${p.y}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
// keep only completed full-width bands. A bounding box alone would include holes.
export function completedRectangle(rectangles, width, height) {
  const xs = [0, width],
    ys = [0, height];
  for (const r of rectangles) {
    xs.push(Math.max(0, r.x), Math.min(width, r.x + r.width));
    ys.push(Math.max(0, r.y), Math.min(height, r.y + r.height));
  }
  const rows = [...new Set(ys)].sort((a, b) => a - b);
  let completeHeight = 0,
    firstWidth = 0,
    firstHeight = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const top = rows[i],
      bottom = rows[i + 1];
    if (bottom <= top) continue;
    const spans = rectangles
      .filter((r) => r.y <= top && r.y + r.height >= bottom)
      .map((r) => [Math.max(0, r.x), Math.min(width, r.x + r.width)])
      .sort((a, b) => a[0] - b[0]);
    let right = 0;
    for (const [start, end] of spans) {
      if (start > right) break;
      right = Math.max(right, end);
    }
    if (top === 0) {
      firstWidth = right;
      firstHeight = bottom;
    } else if (top === firstHeight && right >= firstWidth) firstHeight = bottom;
    if (top === completeHeight && right >= width) completeHeight = bottom;
    else if (top === completeHeight) break;
  }
  if (completeHeight > 0) return { x: 0, y: 0, width, height: completeHeight };
  if (firstWidth > 0 && firstHeight > 0)
    return { x: 0, y: 0, width: firstWidth, height: firstHeight };
  return null;
}
