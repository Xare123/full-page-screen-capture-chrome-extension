// Match the browser's textarea wrapping without changing the user's text.
// This probe is clipped and hidden; project text is always assigned as textContent.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cache = new Map();
let probe, baselineProbe, baselineMarker;

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
    document.body.append(clip);
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
  let run;
  // Cache the result, not DOM nodes or raw project records. At most 1,000 graphemes.
  for (const { segment, index } of segmenter.segment(text)) {
    if (segment === "\n" || segment === "\r\n") {
      run = null;
      continue;
    }
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
    if (segment === "\t") {
      run = null;
      continue;
    }
    if (!run || run.line !== line) {
      run = { line, x: rect.left - origin.left, text: "" };
      runs.push(run);
    }
    // A logical first character may be visually rightmost in RTL text.
    run.x = Math.min(run.x, rect.left - origin.left);
    run.text += segment;
  }
  const result = { lines, runs, baseline, height: count * lineHeight };
  cache.set(key, result);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return result;
}
