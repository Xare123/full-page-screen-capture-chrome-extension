export const MAX_TILE_PIXELS = 24_000_000;
export const MAX_DIMENSION = 16_000;
export const MAX_CAPTURE_PIXELS = 120_000_000;
export const MAX_CAPTURE_STEPS = 160;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${["B", "KB", "MB", "GB"][index]}`;
}
export function safeFilename(title = "capture") {
  return (
    title
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim()
      .slice(0, 100) || "capture"
  );
}
export function isCapturableUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:", "file:"].includes(url.protocol) &&
      !["chromewebstore.google.com", "chrome.google.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
export function planPositions(width, height, viewportWidth, viewportHeight) {
  if (
    ![width, height, viewportWidth, viewportHeight].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  )
    throw new Error("Invalid page dimensions.");
  if (
    Math.ceil(width / viewportWidth) * Math.ceil(height / viewportHeight) >
    MAX_CAPTURE_STEPS
  )
    throw new Error(
      "This page needs too many captures. Try a region or visible-area capture.",
    );
  const positions = [];
  const xs = [],
    ys = [];
  for (let x = 0; x < width; x += viewportWidth)
    xs.push(Math.min(x, Math.max(0, width - viewportWidth)));
  for (let y = 0; y < height; y += viewportHeight)
    ys.push(Math.min(y, Math.max(0, height - viewportHeight)));
  for (const y of [...new Set(ys)])
    for (const x of [...new Set(xs)]) positions.push({ x, y });
  if (positions.length > MAX_CAPTURE_STEPS)
    throw new Error(
      "This page needs too many captures. Try a region or visible-area capture.",
    );
  return positions;
}
export function planTiles(width, height) {
  width = Math.ceil(width);
  height = Math.ceil(height);
  if (
    ![width, height].every((v) => Number.isFinite(v) && v > 0) ||
    width * height > MAX_CAPTURE_PIXELS
  ) {
    throw new Error(
      "This page exceeds the safe capture size (120 megapixels). Try a region or zoom the page out.",
    );
  }
  const tileWidth = Math.min(width, MAX_DIMENSION);
  const tileHeight = Math.min(
    height,
    MAX_DIMENSION,
    Math.floor(MAX_TILE_PIXELS / tileWidth),
  );
  const tiles = [];
  for (let y = 0; y < height; y += tileHeight) {
    for (let x = 0; x < width; x += tileWidth)
      tiles.push({
        x,
        y,
        width: Math.min(tileWidth, width - x),
        height: Math.min(tileHeight, height - y),
      });
  }
  return tiles;
}
export function normalizeRect(start, end, width, height) {
  const x = clamp(Math.min(start.x, end.x), 0, width),
    y = clamp(Math.min(start.y, end.y), 0, height);
  return {
    x,
    y,
    width: clamp(Math.max(start.x, end.x), 0, width) - x,
    height: clamp(Math.max(start.y, end.y), 0, height) - y,
  };
}
export function rasterRect(rect, scaleX, scaleY) {
  if (
    ![rect.x, rect.y, rect.width, rect.height, scaleX, scaleY].every(
      Number.isFinite,
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    scaleX <= 0 ||
    scaleY <= 0
  )
    throw new Error("Invalid capture geometry.");
  const x = Math.round(rect.x * scaleX),
    y = Math.round(rect.y * scaleY);
  return {
    x,
    y,
    width: Math.round((rect.x + rect.width) * scaleX) - x,
    height: Math.round((rect.y + rect.height) * scaleY) - y,
  };
}
export function percentSaved(before, after) {
  return before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
}
export function escapeHTML(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
