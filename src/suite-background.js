import { getSuiteItem, listSuiteItems, patchSuiteItem } from "./suite-db.js";
export function setupSuiteBackground() {
  const trusted = (sender) =>
    sender.id === chrome.runtime.id &&
    (sender.frameId ?? 0) === 0 &&
    sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL("app.html");
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      !trusted(sender) ||
      ![
        "CS_NOTE_REMINDER",
        "CS_NOTE_CLEAR_ALARM",
        "CS_RECORD_OWNER",
        "CS_RECORD_RELEASE",
      ].includes(message.type)
    )
      return;
    const handle = async () => {
      if (message.type === "CS_NOTE_CLEAR_ALARM") {
        if (typeof message.id === "string" && chrome.alarms)
          await chrome.alarms.clear(`note:${message.id}`);
        return { ok: true };
      }
      if (message.type === "CS_NOTE_REMINDER") {
        if (typeof message.id !== "string") throw new Error("Invalid note.");
        const note = await getSuiteItem("notes", message.id),
          name = `note:${message.id}`;
        if (message.when === null) {
          if (chrome.alarms) await chrome.alarms.clear(name);
          if (note) await patchSuiteItem("notes", note.id, { reminder: null });
          return { ok: true };
        }
        if (!note || note.done)
          throw new Error("Open an unfinished note before setting a reminder.");
        if (
          !Number.isFinite(message.when) ||
          message.when < Date.now() + 500 ||
          message.when > Date.now() + 5 * 365 * 86400000
        )
          throw new Error("Choose a reminder within the next five years.");
        if (
          !(await chrome.permissions.contains({
            permissions: ["alarms", "notifications"],
          }))
        )
          throw new Error("Allow browser reminders first.");
        await patchSuiteItem("notes", note.id, { reminder: message.when });
        await chrome.alarms.create(name, { when: message.when });
        return { ok: true };
      }
      const { recordingOwner: owner } =
        await chrome.storage.session.get("recordingOwner");
      if (message.type === "CS_RECORD_OWNER") {
        if (owner) {
          const live = await chrome.tabs.get(owner.tabId).catch(() => null);
          if (live && owner.session !== message.session) {
            const ping = await chrome.tabs
              .sendMessage(
                owner.tabId,
                { type: "CS_RECORD_PING", session: owner.session },
                owner.documentId ? { documentId: owner.documentId } : undefined,
              )
              .catch(() => null);
            if (ping?.ok) throw new Error("Another studio is recording.");
          }
        }
        const item = await getSuiteItem("recordings", message.id);
        if (
          !sender.tab?.id ||
          !item ||
          item.session !== message.session ||
          item.status !== "recording"
        )
          throw new Error("Invalid recording session.");
        await chrome.storage.session.set({
          recordingOwner: {
            id: item.id,
            session: item.session,
            tabId: sender.tab.id,
            documentId: sender.documentId,
          },
        });
        await chrome.action.setBadgeText({ text: "REC" });
        await chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
        return { ok: true };
      }
      if (
        owner?.tabId === sender.tab?.id &&
        owner?.id === message.id &&
        owner?.session === message.session
      ) {
        await chrome.storage.session.remove("recordingOwner");
        await chrome.action.setBadgeText({ text: "" });
      }
      return { ok: true };
    };
    handle().then(respond, (error) =>
      respond({ ok: false, error: error.message }),
    );
    return true;
  });
  async function reconcile() {
    if (
      !(await chrome.permissions.contains({
        permissions: ["alarms", "notifications"],
      }))
    )
      return;
    const notes = await listSuiteItems("notes"),
      existing = await chrome.alarms.getAll(),
      wanted = new Set();
    for (const note of notes)
      if (note.reminder && !note.done) {
        const name = `note:${note.id}`;
        wanted.add(name);
        await chrome.alarms.create(name, {
          when: Math.max(Date.now() + 1000, note.reminder),
        });
      }
    for (const alarm of existing)
      if (alarm.name.startsWith("note:") && !wanted.has(alarm.name))
        await chrome.alarms.clear(alarm.name);
  }
  let listeningAlarms = false,
    listeningNotifications = false;
  function registerReminderEvents() {
    if (chrome.alarms && !listeningAlarms) {
      listeningAlarms = true;
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (!alarm.name.startsWith("note:")) return;
        void (async () => {
          const id = alarm.name.slice(5),
            note = await getSuiteItem("notes", id);
          if (!note?.reminder || note.done) return;
          if (note.reminder > Date.now() + 1000) {
            await chrome.alarms.create(alarm.name, { when: note.reminder });
            return;
          }
          await patchSuiteItem("notes", id, { reminder: null });
          await chrome.notifications.create(alarm.name, {
            type: "basic",
            iconUrl: "icon128.png",
            title: "Capture Studio reminder",
            message: note.title || "You have a note to revisit.",
          });
        })().catch(console.error);
      });
    }
    if (chrome.notifications && !listeningNotifications) {
      listeningNotifications = true;
      chrome.notifications.onClicked.addListener((id) => {
        if (!id.startsWith("note:")) return;
        void chrome.tabs.create({
          url: chrome.runtime.getURL(
            `app.html?note=${encodeURIComponent(id.slice(5))}#notes`,
          ),
        });
        void chrome.notifications.clear(id);
      });
    }
  }
  registerReminderEvents();
  chrome.runtime.onStartup.addListener(
    () => void reconcile().catch(console.error),
  );
  chrome.runtime.onInstalled.addListener(
    () => void reconcile().catch(console.error),
  );
  chrome.permissions.onAdded.addListener(() => {
    registerReminderEvents();
    void reconcile().catch(console.error);
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== "loading") return;
    void (async () => {
      const { recordingOwner: owner } =
        await chrome.storage.session.get("recordingOwner");
      if (owner?.tabId === tabId) {
        await chrome.storage.session.remove("recordingOwner");
        await chrome.action.setBadgeText({ text: "" });
      }
    })().catch(console.error);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const { recordingOwner: owner } =
        await chrome.storage.session.get("recordingOwner");
      if (owner?.tabId !== tabId) return;
      await chrome.storage.session.remove("recordingOwner");
      await chrome.action.setBadgeText({ text: "" });
    })().catch(console.error);
  });
}
