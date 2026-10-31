import { hydrateIcons } from "./icons.js";
hydrateIcons();
const $ = (id) => document.getElementById(id);
let startedAt = Date.now();
let closeOnSelection = false;
function showStatus(state) {
  if (
    state.phase === "idle" ||
    (state.updated < startedAt - 1500 &&
      ["done", "error"].includes(state.phase))
  )
    return;
  $("capture-status").hidden = false;
  $("capture-progress").value = state.progress || 0;
  $("status-message").textContent = state.message;
  if (state.phase === "selecting" && closeOnSelection) {
    closeOnSelection = false;
    window.close();
  }
  if (["done", "error"].includes(state.phase)) closeOnSelection = false;
  const busy = ["capturing", "selecting"].includes(state.phase);
  $("cancel-capture").hidden = !busy;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.disabled = busy;
  });
}
document.querySelectorAll("[data-mode]").forEach((button) =>
  button.addEventListener("click", async () => {
    startedAt = Date.now();
    closeOnSelection = ["full", "region"].includes(button.dataset.mode);
    const response = await chrome.runtime.sendMessage({
      type: "CS_START",
      mode: button.dataset.mode,
      delay: Number($("capture-delay").value),
      bars: $("capture-bars").value,
      scope: $("capture-target").value,
    });
    if (!response?.ok) {
      closeOnSelection = false;
      showStatus({
        phase: "error",
        updated: Date.now(),
        message: response?.error || "Could not start capture.",
      });
    }
  }),
);
$("cancel-capture").addEventListener("click", () =>
  chrome.runtime.sendMessage({ type: "CS_CANCEL" }),
);
$("open-studio").addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
  window.close();
});
$("capture-delay").addEventListener("change", () =>
  chrome.storage.local.set({ captureDelay: Number($("capture-delay").value) }),
);
chrome.storage.local.get("captureDelay").then((result) => {
  $("capture-delay").value = result.captureDelay || 0;
});
$("capture-bars").addEventListener("change", () =>
  chrome.storage.local.set({ captureBars: $("capture-bars").value }),
);
chrome.storage.local.get("captureBars").then((result) => {
  $("capture-bars").value = result.captureBars === "hide" ? "hide" : "smart";
});
$("capture-target").addEventListener("change", () =>
  chrome.storage.local.set({ captureTarget: $("capture-target").value }),
);
chrome.storage.local.get("captureTarget").then((result) => {
  $("capture-target").value = ["page", "pick"].includes(result.captureTarget)
    ? result.captureTarget
    : "auto";
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.captureStatus?.newValue)
    showStatus(changes.captureStatus.newValue);
});
chrome.runtime.sendMessage({ type: "CS_STATUS" }).then(showStatus);
