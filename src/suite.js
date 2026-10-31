import { el, button, field, downloadBlob } from "./suite-ui.js";
import { createNotebook } from "./notes.js";
import { createRecorder } from "./recorder-ui.js";
import {
  mountWhiteboards,
  boardPage,
  exportBoard,
  BOARD_LIMIT,
} from "./whiteboards.js";
import { mountGuide } from "./guide.js";
import { createOCR } from "./ocr.js";
import { presentBoard } from "./board-presenter.js";

export function createSuite(context) {
  const { toast, fail } = context,
    root = el("section", {
      id: "suite-view",
      className: "suite-view",
      hidden: true,
    });
  document.querySelector(".main").append(root);
  const notebook = createNotebook({ toast, fail }),
    recorder = createRecorder({
      toast,
      fail,
      importFrame: (blob) => context.importImage(blob, "Video frame"),
    });
  let active;
  const views = {
      recordings: "Record & explain",
      whiteboards: "Whiteboards",
      notes: "Notes",
      guide: "Guide & settings",
    },
    nav = {};
  const anchor = document.getElementById("compress-button");
  for (const [key, label] of Object.entries(views)) {
    const node = button(label, () => void open(key).catch(fail), "nav-item");
    node.id = `nav-${key}`;
    node.className = "nav-item";
    anchor.parentNode.insertBefore(node, anchor.nextSibling);
    nav[key] = node;
  }
  async function flush() {
    await notebook.flush();
  }
  async function open(name) {
    const requestedNote = new URLSearchParams(location.search).get("note");
    if (!views[name]) return false;
    await flush();
    if (!(await context.leave())) return true;
    active = name;
    root.hidden = false;
    document.getElementById("home-view").hidden = true;
    document.getElementById("page-name").textContent = views[name];
    document.getElementById("home-button").classList.remove("active");
    for (const [key, node] of Object.entries(nav))
      node.classList.toggle("active", key === name);
    window.history.replaceState(null, "", `app.html#${name}`);
    document.title = `${views[name]} · Capture Studio`;
    if (name === "notes") {
      notebook.mount(root);
      const id = requestedNote;
      if (id) await notebook.open(id);
    }
    if (name === "recordings") await recorder.mount(root);
    if (name === "whiteboards")
      await mountWhiteboards(root, {
        openProject: context.openProject,
        toast,
        fail,
      });
    if (name === "guide")
      await mountGuide(root, {
        toast,
        fail,
        defaultKeys: context.defaultKeys,
        updateKeys: context.updateKeys,
      });
    return true;
  }
  function hide() {
    active = null;
    root.hidden = true;
    for (const node of Object.values(nav)) node.classList.remove("active");
  }
  async function saveNote(text) {
    const title = context.project()?.title || "Extracted text";
    await open("notes");
    await notebook.add({ title, body: text, source: "" });
  }
  const ocr = createOCR({ snapshot: context.snapshot, toast, fail, saveNote });
  const editorActions = el(
    "div",
    { className: "suite-editor-actions" },
    button("Extract text", () => ocr.open()),
    button("Background & frame", () => finishes.showModal()),
    button("Share", () => void openShare().catch(fail)),
    button("Keep a note", () => {
      const project = context.project();
      void open("notes")
        .then(() =>
          notebook.add({ title: project.title, source: project.source }),
        )
        .catch(fail);
    }),
  );
  document.querySelector(".editor-heading").after(editorActions);
  const pageBar = el("div", {
      className: "suite-row",
      id: "board-page-actions",
      hidden: true,
    }),
    template = el(
      "select",
      { ariaLabel: "New board page template" },
      ...["blank", "grid", "lined", "plan"].map((value) =>
        el("option", { value }, value),
      ),
    );
  pageBar.append(
    button(
      "Present board",
      () =>
        void context
          .commit()
          .then(() => presentBoard(context.project()))
          .catch(fail),
    ),
    template,
    ...[
      ["Add page", "add"],
      ["Duplicate page", "duplicate"],
      ["Move earlier", "earlier"],
      ["Move later", "later"],
      ["Delete page", "delete"],
    ].map(([label, action]) =>
      button(label, async () => {
        try {
          if (
            action === "add" &&
            context.project().images.length >= BOARD_LIMIT
          )
            throw new Error("Each board supports up to 100 pages.");
          await context.pages(
            action,
            action === "add" ? await boardPage(template.value) : null,
          );
        } catch (error) {
          fail(error);
        }
      }),
    ),
    button(
      "Export editable board JSON",
      () =>
        void context
          .commit()
          .then(() => exportBoard(context.project()))
          .catch(fail),
    ),
  );
  document.querySelector(".canvas-footer").after(pageBar);
  const padding = el("input", { type: "number", min: 0, max: 400, value: 48 }),
    background = el("input", { type: "color", value: "#e8dfff" }),
    transparent = el("input", { type: "checkbox" }),
    gradient = el("input", { type: "checkbox", checked: true }),
    frame = el("input", { type: "checkbox", checked: true }),
    shadow = el("input", { type: "checkbox", checked: true }),
    radius = el("input", { type: "number", min: 0, max: 32, value: 12 });
  const finishes = el(
    "dialog",
    { id: "finish-dialog", className: "suite-dialog" },
    el("h2", {}, "Background & browser frame"),
    el(
      "p",
      {},
      "Applied to the current part. The complete image fits uniformly within browser limits. Drawings and text remain editable.",
    ),
    el(
      "div",
      { className: "record-settings" },
      field("Padding", padding),
      field("Background", background),
      field("Transparent background", transparent),
      field("Gradient", gradient),
      field("Browser frame", frame),
      field("Shadow", shadow),
      field("Corner radius", radius),
    ),
    el(
      "div",
      { className: "suite-row" },
      button(
        "Apply finish",
        () => {
          finishes.close();
          void context
            .finish({
              padding: Number(padding.value),
              background: transparent.checked
                ? "transparent"
                : background.value,
              gradient: gradient.checked,
              frame: frame.checked,
              shadow: shadow.checked,
              radius: Number(radius.value),
              title: context.project()?.title,
            })
            .catch(fail);
        },
        "primary",
      ),
      button("Remove finish", () => {
        finishes.close();
        void context.finish({ remove: true }).catch(fail);
      }),
      button("Close", () => finishes.close()),
    ),
  );
  document.body.append(finishes);
  async function openShare() {
    const target = context.project();
    const blob = await context.snapshot();
    if (context.project() !== target)
      throw new Error(
        "The capture changed. Open Share again for the current image.",
      );
    const name = `${target.title}.png`,
      file = new File([blob], name, { type: "image/png" }),
      dialog = el(
        "dialog",
        { className: "suite-dialog" },
        el("h2", {}, `Share ${target.title}`),
        el(
          "p",
          {},
          "Download the file, then attach it to your draft. You choose the recipient and send it. Source links and private context are excluded.",
        ),
      );
    const native = button("Share file…", () => {
      void navigator
        .share({ files: [file], title: target.title })
        .catch((error) => {
          if (error.name !== "AbortError") fail(error);
        });
    });
    native.disabled = !navigator.canShare?.({ files: [file] });
    dialog.append(
      el(
        "div",
        { className: "suite-row" },
        button("Download PNG", () => downloadBlob(blob, name), "primary"),
        native,
        button("Email draft", () => {
          location.href = `mailto:?subject=${encodeURIComponent("Capture Studio image")}&body=${encodeURIComponent("I would like to share an image. I will attach the downloaded file.")}`;
        }),
        button("WhatsApp draft", () => {
          window.open(
            `https://wa.me/?text=${encodeURIComponent("I would like to share an image. I will attach the downloaded file.")}`,
            "_blank",
            "noopener,noreferrer",
          );
        }),
        button("Close", () => dialog.close()),
      ),
    );
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }
  function projectChanged() {
    pageBar.hidden = context.project()?.mode !== "whiteboard";
    hide();
  }
  return {
    open,
    hide,
    flush,
    projectChanged,
    hasPending: () => notebook.hasPending() || recorder.hasPending(),
    handles: (name) => !!views[name],
  };
}
