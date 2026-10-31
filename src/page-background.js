import { isCapturableUrl } from "./core.js";
const waiting = new Map();
async function grants() {
  return (await chrome.storage.session.get("inlineGrants")).inlineGrants || {};
}
async function saveGrants(value) {
  await chrome.storage.session.set({ inlineGrants: value });
}
async function sourceLive(grant) {
  const response = await chrome.tabs.sendMessage(
    grant.tabId,
    { type: "CS_PAGE_PING" },
    { documentId: grant.sourceDocument },
  );
  if (!response?.ok) throw new Error("The source page changed.");
}
export async function openCapturedEditor(job, id) {
  if (job.mode !== "region" || !job.inline || !job.documentId) return false;
  const token = crypto.randomUUID(),
    grant = {
      token,
      tabId: job.tab.id,
      sourceDocument: job.documentId,
      projectId: id,
      expires: Date.now() + 30000,
    };
  const all = await grants();
  for (const [key, value] of Object.entries(all))
    if (value.expires < Date.now()) delete all[key];
  all[token] = grant;
  await saveGrants(all);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: job.tab.id, documentIds: [job.documentId] },
      files: ["inline-host.js"],
    });
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(token);
        reject(new Error("The page blocked its embedded editor."));
      }, 6000);
      waiting.set(token, {
        resolve: () => {
          clearTimeout(timer);
          waiting.delete(token);
          resolve();
        },
        cancel: () => {
          clearTimeout(timer);
          waiting.delete(token);
          resolve();
        },
      });
    });
    ready.catch(() => {});
    await chrome.tabs.sendMessage(
      job.tab.id,
      {
        type: "CS_INLINE_OPEN",
        token,
        url: chrome.runtime.getURL(
          `app.html?grant=${encodeURIComponent(token)}#${id}`,
        ),
      },
      { documentId: job.documentId },
    );
    await ready;
    return true;
  } catch {
    waiting.get(token)?.cancel();
    waiting.delete(token);
    const current = await grants();
    delete current[token];
    await saveGrants(current);
    await chrome.tabs
      .sendMessage(
        job.tab.id,
        { type: "CS_INLINE_REMOVE", token },
        { documentId: job.documentId },
      )
      .catch(() => {});
    return false;
  }
}
export function setupPageBackground() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    const top = (sender.frameId ?? 0) === 0,
      trusted =
        top &&
        ["app.html", "popup.html"].some(
          (file) =>
            sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(file),
        );
    if (
      ![
        "CS_EMBED_AUTH",
        "CS_EMBED_READY",
        "CS_EMBED_CLOSE",
        "CS_PRESENT",
        "CS_PRESENT_SNAPSHOT",
        "CS_PRESENT_RECORD_CONTROL",
        "CS_OPEN_GUIDE",
      ].includes(message.type)
    )
      return;
    const handle = async () => {
      if (message.type === "CS_OPEN_GUIDE") {
        if (!top || !sender.tab?.id || !isCapturableUrl(sender.url))
          throw new Error("Open the guide from page tools.");
        await chrome.tabs.create({
          url: chrome.runtime.getURL("app.html#guide"),
        });
        return { ok: true };
      }
      if (message.type === "CS_PRESENT") {
        if (!trusted) throw new Error("Open page tools from the extension.");
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!isCapturableUrl(tab?.url))
          throw new Error(
            "Page tools work on regular websites. This browser page is protected.",
          );
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["presentation.js"],
        });
        return { ok: true };
      }
      if (message.type === "CS_PRESENT_SNAPSHOT") {
        if (!top || !sender.tab?.id || !isCapturableUrl(sender.url))
          throw new Error("Invalid presentation source.");
        const tab = await chrome.tabs.get(sender.tab.id);
        if (!tab.active) throw new Error("Keep the source tab active.");
        const data = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
        return { ok: true, data };
      }
      if (message.type === "CS_PRESENT_RECORD_CONTROL") {
        if (
          !top ||
          !sender.tab?.id ||
          !isCapturableUrl(sender.url) ||
          !["pause", "stop"].includes(message.action)
        )
          throw new Error("Invalid recording control.");
        const { recordingOwner: owner } =
          await chrome.storage.session.get("recordingOwner");
        if (!owner) throw new Error("No recording is active.");
        await chrome.tabs.sendMessage(owner.tabId, {
          type: "CS_RECORD_CONTROL",
          id: owner.id,
          session: owner.session,
          action: message.action,
        });
        return { ok: true };
      }
      const all = await grants(),
        grant = all[message.token];
      if (!grant || sender.tab?.id !== grant.tabId)
        throw new Error("This embedded editor session expired.");
      await sourceLive(grant);
      if (message.type === "CS_EMBED_AUTH") {
        if (
          top ||
          sender.url?.split(/[?#]/)[0] !== chrome.runtime.getURL("app.html") ||
          grant.expires < Date.now() ||
          grant.frameDocument
        )
          throw new Error("This embedded editor is not authorized.");
        grant.frameDocument = sender.documentId;
        grant.frameId = sender.frameId;
        all[message.token] = grant;
        await saveGrants(all);
        return { ok: true, projectId: grant.projectId };
      }
      if (message.type === "CS_EMBED_READY") {
        if (
          sender.documentId !== grant.frameDocument ||
          sender.frameId !== grant.frameId ||
          message.projectId !== grant.projectId
        )
          throw new Error("Invalid embedded editor.");
        waiting.get(message.token)?.resolve();
        return { ok: true };
      }
      if (!top || sender.documentId !== grant.sourceDocument)
        throw new Error("Invalid editor host.");
      const response = await chrome.tabs.sendMessage(
        grant.tabId,
        { type: "CS_EMBED_FLUSH", projectId: grant.projectId },
        { documentId: grant.frameDocument },
      );
      if (!response?.ok)
        throw new Error(response?.error || "Could not save this capture.");
      delete all[message.token];
      await saveGrants(all);
      await chrome.tabs.sendMessage(
        grant.tabId,
        { type: "CS_INLINE_REMOVE", token: message.token },
        { documentId: grant.sourceDocument },
      );
      if (message.open)
        await chrome.tabs.create({
          url: chrome.runtime.getURL(`app.html#${grant.projectId}`),
        });
      return { ok: true };
    };
    handle().then(respond, (error) =>
      respond({ ok: false, error: error.message }),
    );
    return true;
  });
}
