(() => {
  if (globalThis.__captureStudioInline) return;
  globalThis.__captureStudioInline = true;
  let host, shadow, grant;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === "CS_INLINE_REMOVE") {
      if (!message.token || grant === message.token) {
        host?.remove();
        host = null;
        grant = null;
      }
      respond({ ok: true });
      return;
    }
    if (message.type !== "CS_INLINE_OPEN") return;
    host?.remove();
    grant = message.token;
    host = document.createElement("div");
    host.setAttribute("data-capture-studio-inline", "");
    host.style.cssText =
      "all:initial!important;position:fixed!important;inset:12px!important;z-index:2147483647!important;display:block!important;isolation:isolate!important";
    shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent =
      ":host{all:initial}section{height:100%;display:flex;flex-direction:column;background:#fff;border:1px solid #d8c9ec;border-radius:14px;box-shadow:0 12px 80px #0005;overflow:hidden}header{display:flex;align-items:center;gap:12px;padding:8px 14px;background:#f6f2ff;font:13px system-ui;color:#302443}span{flex:1}button{border:1px solid #d9cce8;border-radius:7px;background:white;padding:7px 12px;cursor:pointer}iframe{width:100%;flex:1;border:0;background:#fff}";
    const box = document.createElement("section"),
      bar = document.createElement("header"),
      label = document.createElement("span"),
      close = document.createElement("button"),
      full = document.createElement("button"),
      frame = document.createElement("iframe");
    label.textContent = "Capture Studio · editing this capture on your page";
    close.textContent = "Save & close";
    full.textContent = "Open in studio";
    frame.title = "Capture Studio image editor";
    frame.src = message.url;
    const act = async (action) => {
      close.disabled = full.disabled = true;
      const result = await chrome.runtime
        .sendMessage({
          type: "CS_EMBED_CLOSE",
          token: grant,
          open: action === "open",
        })
        .catch((error) => ({ ok: false, error: error.message }));
      if (!result?.ok) {
        label.textContent =
          result?.error ||
          "Could not save. Keep the editor open and try again.";
        close.disabled = full.disabled = false;
      }
    };
    close.onclick = () => void act("close");
    full.onclick = () => void act("open");
    bar.append(label, full, close);
    box.append(bar, frame);
    shadow.append(style, box);
    document.documentElement.append(host);
    respond({ ok: true });
  });
})();
