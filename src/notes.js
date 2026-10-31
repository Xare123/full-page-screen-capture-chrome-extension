import {
  listSuiteItems,
  getSuiteItem,
  putSuiteItem,
  deleteSuiteItem,
} from "./suite-db.js";
import {
  el,
  button,
  field,
  downloadBlob,
  safeSourceURL,
  noteText,
} from "./suite-ui.js";

export function createNotebook({ toast, fail }) {
  let root,
    current,
    query = "",
    filter = "all",
    chain = Promise.resolve(),
    dirty = false,
    timer,
    revision = 0,
    pending = 0;
  const status = el("span", { role: "status", className: "suite-status" });
  const title = el("input", {
    id: "note-title",
    maxLength: 200,
    placeholder: "Note title",
    oninput: edit,
  });
  const body = el("textarea", {
    id: "note-body",
    maxLength: 100000,
    placeholder: "Ideas, capture context, talking points…",
    oninput: edit,
  });
  const source = el("input", {
    id: "note-source",
    type: "url",
    placeholder: "https://…",
    oninput: edit,
  });
  const date = el("input", { id: "note-reminder", type: "datetime-local" });
  const pinned = el("input", { type: "checkbox", onchange: edit }),
    done = el("input", { type: "checkbox", onchange: edit });
  const list = el("div", { className: "suite-list" }),
    editor = el(
      "div",
      { className: "note-editor", hidden: true },
      field("Title", title),
      field("Note", body),
      field("Source link", source),
      el(
        "div",
        { className: "suite-row" },
        field("Pinned", pinned),
        field("Done", done),
        status,
      ),
    );
  const link = el(
    "a",
    { target: "_blank", rel: "noopener noreferrer", hidden: true },
    "Open source",
  );
  source.addEventListener("change", () => {
    link.href = safeSourceURL(source.value);
    link.hidden = !link.href || !safeSourceURL(source.value);
  });
  const actions = el(
    "div",
    { className: "suite-row" },
    button("Save", () => void flush().catch(fail)),
    button("Download .txt", () => void exportNote(false).catch(fail)),
    button("Download .md", () => void exportNote(true).catch(fail)),
    button("Delete note", () => void remove().catch(fail)),
    button("Reload saved note", () => void reloadSaved().catch(fail)),
    button("Save as new note", () => void saveCopy().catch(fail)),
    link,
  );
  editor.append(
    el(
      "div",
      { className: "suite-row" },
      field("Browser reminder", date),
      button("Set reminder", () => void schedule().catch(fail)),
      button("Clear reminder", () => void clearReminder().catch(fail)),
    ),
    actions,
  );
  function edit() {
    if (!current) return;
    dirty = true;
    revision++;
    status.textContent = "Unsaved…";
    clearTimeout(timer);
    timer = setTimeout(() => void flush().catch(fail), 500);
  }
  function snapshot() {
    return {
      ...current,
      title: noteText(title.value, 200) || "Untitled note",
      body: noteText(body.value),
      source: safeSourceURL(source.value),
      pinned: pinned.checked,
      done: done.checked,
    };
  }
  async function flush() {
    clearTimeout(timer);
    if (dirty) {
      const copy = snapshot(),
        generation = revision;
      if (copy.done) copy.reminder = null;
      dirty = false;
      pending++;
      chain = chain
        .catch(() => {})
        .then(async () => {
          try {
            const saved = await putSuiteItem(
              "notes",
              copy,
              current?.id === copy.id ? current.revision : copy.revision,
            );
            if (current?.id === saved.id) {
              current = {
                ...current,
                revision: saved.revision,
                reminder: saved.reminder,
              };
              if (generation === revision) status.textContent = "Saved locally";
            }
            if (saved.done)
              await chrome.runtime.sendMessage({
                type: "CS_NOTE_CLEAR_ALARM",
                id: saved.id,
              });
            await renderList();
          } catch (error) {
            if (current?.id === copy.id) {
              dirty = true;
              status.textContent =
                "Could not save — download a copy to keep your text";
            }
            throw error;
          } finally {
            pending--;
          }
        });
    }
    await chain;
  }
  async function renderList() {
    if (!root) return;
    const items = (await listSuiteItems("notes"))
      .filter(
        (n) =>
          (filter === "all" ||
            (filter === "done" && n.done) ||
            (filter === "open" && !n.done)) &&
          `${n.title} ${n.body} ${n.source}`
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated - a.updated,
      );
    list.replaceChildren(
      ...items.map((n) =>
        button(
          `${n.pinned ? "★ " : ""}${n.done ? "✓ " : ""}${n.title}`,
          () => void open(n.id).catch(fail),
          current?.id === n.id ? "primary" : "secondary",
        ),
      ),
    );
    if (!items.length) list.append(el("p", {}, "No matching notes."));
  }
  async function open(id) {
    await flush();
    const next = await getSuiteItem("notes", id);
    if (!next) throw new Error("This note was removed.");
    current = next;
    revision++;
    title.value = next.title;
    body.value = next.body;
    source.value = next.source || "";
    pinned.checked = !!next.pinned;
    done.checked = !!next.done;
    date.value = next.reminder ? localDate(next.reminder) : "";
    link.hidden = !next.source;
    link.href = safeSourceURL(next.source);
    status.textContent = "Saved locally";
    editor.hidden = false;
    await renderList();
  }
  async function add(data = {}) {
    await flush();
    const note = await putSuiteItem("notes", {
      id: crypto.randomUUID(),
      title: noteText(data.title || "Untitled note", 200),
      body: noteText(data.body || ""),
      source: safeSourceURL(data.source),
      created: Date.now(),
      pinned: false,
      done: false,
      reminder: null,
      revision: 0,
    });
    await open(note.id);
    title.focus();
  }
  async function reloadSaved() {
    if (!current) return;
    const id = current.id;
    clearTimeout(timer);
    await chain.catch(() => {});
    dirty = false;
    chain = Promise.resolve();
    await open(id);
    toast("Reloaded the saved note.");
  }
  async function saveCopy() {
    if (!current) return;
    const copy = snapshot();
    clearTimeout(timer);
    await chain.catch(() => {});
    chain = Promise.resolve();
    pending++;
    try {
      const next = await putSuiteItem(
        "notes",
        {
          ...copy,
          id: crypto.randomUUID(),
          title: `${copy.title.slice(0, 190)} (copy)`,
          revision: 0,
          reminder: null,
          created: Date.now(),
        },
        0,
      );
      dirty = false;
      await open(next.id);
      toast("Your edits were saved as a separate note.");
    } catch (error) {
      dirty = true;
      throw error;
    } finally {
      pending--;
    }
  }
  async function remove() {
    if (!current) return;
    await flush();
    const id = current.id;
    await deleteSuiteItem("notes", id);
    await chrome.runtime.sendMessage({
      type: "CS_NOTE_REMINDER",
      id,
      when: null,
    });
    current = null;
    editor.hidden = true;
    await renderList();
    toast("Note deleted.");
  }
  async function schedule() {
    if (!current) return;
    const id = current.id;
    await flush();
    const when = new Date(date.value).getTime();
    if (!Number.isFinite(when) || when < Date.now() + 1000)
      throw new Error("Choose a future reminder time.");
    const granted = await chrome.permissions.request({
      permissions: ["alarms", "notifications"],
    });
    if (!granted) return;
    const response = await chrome.runtime.sendMessage({
      type: "CS_NOTE_REMINDER",
      id,
      when,
    });
    if (!response?.ok)
      throw new Error(response?.error || "Could not schedule this reminder.");
    if (current?.id === id) current = await getSuiteItem("notes", id);
    toast(
      "Reminder scheduled in this browser. Keep the browser available for timely alerts.",
    );
  }
  async function clearReminder() {
    if (!current) return;
    const id = current.id;
    await flush();
    const response = await chrome.runtime.sendMessage({
      type: "CS_NOTE_REMINDER",
      id,
      when: null,
    });
    if (!response?.ok)
      throw new Error(response?.error || "Could not clear this reminder.");
    if (current?.id === id) {
      current = await getSuiteItem("notes", id);
      date.value = "";
    }
    toast("Reminder cleared.");
  }
  async function exportNote(markdown) {
    if (!current) return;
    const copy = snapshot();
    downloadBlob(
      new Blob(
        [
          `${markdown ? "# " : ""}${copy.title}\n\n${copy.body}${copy.source ? `\n\nSource: ${copy.source}` : ""}\n`,
        ],
        { type: "text/plain;charset=utf-8" },
      ),
      `${copy.title}.${markdown ? "md" : "txt"}`,
    );
  }
  function mount(node) {
    root = node;
    const search = el("input", {
        type: "search",
        placeholder: "Search notes…",
        oninput: (e) => {
          query = e.target.value.toLocaleLowerCase();
          void renderList().catch(fail);
        },
      }),
      select = el(
        "select",
        {
          onchange: (e) => {
            filter = e.target.value;
            void renderList().catch(fail);
          },
        },
        ...[
          ["all", "All notes"],
          ["open", "Open"],
          ["done", "Done"],
        ].map(([value, text]) => el("option", { value }, text)),
      );
    node.replaceChildren(
      el(
        "div",
        { className: "suite-heading" },
        el(
          "div",
          {},
          el("h1", {}, "Notes"),
          el(
            "p",
            {},
            "Capture context, ideas and reminders, saved on this device.",
          ),
        ),
        button("New note", () => void add().catch(fail), "primary"),
      ),
      el("div", { className: "suite-row" }, search, select),
      el("div", { className: "notebook-layout" }, list, editor),
    );
    void renderList().catch(fail);
  }
  return { mount, flush, add, open, hasPending: () => dirty || pending > 0 };
}
function localDate(timestamp) {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
