import { safeFilename } from "./core.js";
export const el = (tag, attributes = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "className") node.className = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2), value);
    else if (key in node && !["aria-label", "role"].includes(key))
      node[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined)
      node.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return node;
};
export const button = (label, action, style = "secondary") =>
  el(
    "button",
    { type: "button", className: `button ${style}`, onclick: action },
    label,
  );
export function field(label, node) {
  return el("label", { className: "suite-field" }, el("span", {}, label), node);
}
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    a = el("a", { href: url, download: safeFilename(name) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function safeSourceURL(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return "";
  }
}
export function noteText(value, max = 100000) {
  const text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (text.length > max)
    throw new Error(
      `Text exceeds the ${max.toLocaleString()} character limit.`,
    );
  return text;
}
export const readableDuration = (seconds) => {
  seconds = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
export async function waitForMedia(
  video,
  event = "loadedmetadata",
  timeout = 15000,
) {
  if (event === "loadedmetadata" && video.readyState >= 1) return;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("The browser could not read this video.")),
      timeout,
    );
    const ready = () => finish(),
      error = () =>
        finish(
          new Error("This video format could not be played by the browser."),
        );
    function finish(err) {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", error);
      err ? reject(err) : resolve();
    }
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", error, { once: true });
  });
}
export async function seekVideo(video, time) {
  time = Math.max(
    0,
    Math.min(Number.isFinite(video.duration) ? video.duration : time, time),
  );
  if (
    Math.abs(video.currentTime - time) < 0.0001 &&
    !video.seeking &&
    video.readyState >= 2
  )
    return;
  const ready = waitForMedia(video, "seeked");
  video.currentTime = time;
  await ready;
}
