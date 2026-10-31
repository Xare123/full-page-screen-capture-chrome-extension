import { getEmbeddingLevels } from "./vendor/bidi-js/embeddingLevels.js";
// Match the browser's textarea wrapping without changing the user's text.
// This probe is clipped and hidden; project text is always assigned as textContent.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cache = new Map();
let probe, baselineProbe, baselineMarker;
let measurementRoot;
export function setTextMeasurementRoot(root) {
  measurementRoot = root;
  probe?.parentNode?.remove();
  probe = baselineProbe = baselineMarker = undefined;
  cache.clear();
}

export const TEXT_FONTS = {
  inter: '"Capture Inter", sans-serif',
  system: "system-ui, sans-serif",
  mono: "ui-monospace, monospace",
};
export function textFont(annotation) {
  const family = TEXT_FONTS[annotation.fontFamily] || TEXT_FONTS.system;
  return `${annotation.fontWeight || (annotation.layoutVersion === 2 ? 500 : 600)} ${annotation.fontSize || 28}px ${family}`;
}
export function nativeTextLayout(text, font, width, lineHeight) {
  const key = JSON.stringify([text, font, width, lineHeight]);
  if (cache.has(key)) return cache.get(key);
  if (!probe) {
    const clip = document.createElement("div");
    clip.setAttribute("aria-hidden", "true");
    clip.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;contain:strict";
    probe = document.createElement("div");
    probe.style.cssText =
      "margin:0;padding:0;border:0;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;tab-size:4;letter-spacing:normal;text-align:left;direction:ltr";
    baselineProbe = document.createElement("div");
    baselineProbe.style.cssText =
      "width:max-content;white-space:pre;margin:0;padding:0;border:0";
    baselineMarker = document.createElement("span");
    baselineMarker.style.cssText =
      "display:inline-block;width:0;height:0;vertical-align:baseline";
    baselineProbe.append("Mg", baselineMarker);
    clip.append(probe, baselineProbe);
    (measurementRoot || document.body).append(clip);
  }
  probe.style.font = baselineProbe.style.font = font;
  probe.style.lineHeight = baselineProbe.style.lineHeight = `${lineHeight}px`;
  probe.style.width = `${width}px`;
  // The zero-width sentinel gives empty and trailing-newline text a real last line.
  probe.textContent = text + "\u200b";
  const node = probe.firstChild,
    origin = probe.getBoundingClientRect();
  const baseline =
    baselineMarker.getBoundingClientRect().top -
    baselineProbe.getBoundingClientRect().top;
  const fontRange = document.createRange();
  fontRange.selectNodeContents(baselineProbe.firstChild);
  const fontTop =
    fontRange.getBoundingClientRect().top -
    baselineProbe.getBoundingClientRect().top;
  const count = Math.max(1, Math.round(origin.height / lineHeight));
  const lines = Array.from({ length: count }, () => ""),
    runs = [];
  const range = document.createRange();
  const glyphs = [],
    levels = getEmbeddingLevels(text, "ltr").levels;
  // Resolve the complete paragraph before soft wrapping. A standalone line
  // would give neutral punctuation and numerals a different bidi order.
  for (const { segment, index } of segmenter.segment(text)) {
    if (segment === "\n" || segment === "\r\n") continue;
    range.setStart(node, index);
    range.setEnd(node, index + segment.length);
    const rect = range.getClientRects()[0];
    if (!rect) continue;
    const line = Math.max(
      0,
      Math.round((rect.top - origin.top - fontTop) / lineHeight),
    );
    while (lines.length <= line) lines.push("");
    lines[line] += segment;
    glyphs.push({
      segment,
      line,
      level: levels[index],
      left: rect.left - origin.left,
      right: rect.right - origin.left,
    });
  }
  // UBA L1 resets trailing whitespace on each soft line to the base level.
  let trailing = true,
    lastLine = -1;
  for (let i = glyphs.length - 1; i >= 0; i--) {
    const g = glyphs[i];
    if (g.line !== lastLine) {
      trailing = true;
      lastLine = g.line;
    }
    if (trailing && /^\s+$/u.test(g.segment)) g.level = 0;
    else trailing = false;
  }
  let run;
  for (const g of glyphs) {
    if (g.segment === "\t") {
      run = null;
      continue;
    }
    // Controls already affected the resolved levels. Retain joining controls,
    // but avoid starting their original bidi embeddings again inside a fragment.
    const visible = g.segment.replace(
      /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
      "",
    );
    if (!visible) continue;
    if (!run || run.line !== g.line || run.level !== g.level) {
      run = {
        line: g.line,
        level: g.level,
        rtl: Boolean(g.level % 2),
        x: g.left,
        right: g.right,
        text: "",
      };
      runs.push(run);
    }
    run.x = Math.min(run.x, g.left);
    run.right = Math.max(run.right, g.right);
    run.text += visible;
  }
  const result = { lines, runs, baseline, height: count * lineHeight };
  cache.set(key, result);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return result;
}
