import { createSuite } from "./suite.js";
import { el, button, field } from "./suite-ui.js";
import { finishImage } from "./finishes.js";
import {
  objectBounds,
  objectHandles,
  hitObject,
  moveObject,
  resizeObject,
} from "./objects.js";
// Embedded editors must authenticate before any database access or workspace setup.
const embedded = window.top !== window;
const embeddedToken = new URLSearchParams(location.search).get("grant");
let embeddedGrant;
if (embedded) {
  embeddedGrant = await chrome.runtime.sendMessage({
    type: "CS_EMBED_AUTH",
    token: embeddedToken,
  });
  if (!embeddedGrant?.ok) {
    document.body.replaceChildren(
      document.createTextNode(
        "Open Capture Studio from the extension to edit this capture.",
      ),
    );
    throw new Error("Unauthenticated embedded studio.");
  }
}
let suite;
let drawingKeys = {};
import {
  clamp,
  formatBytes,
  safeFilename,
  normalizeRect,
  percentSaved,
  escapeHTML,
  MAX_FILE_BYTES,
} from "./core.js";
import {
  listProjects,
  getProject,
  putProject,
  updateProject,
  deleteProject,
  ProjectConflict,
} from "./db.js";
import { icon, hydrateIcons } from "./icons.js";
import {
  makeCanvas,
  canvasBlob,
  drawAnnotations,
  renderImage,
  renderCapture,
  readImage,
} from "./graphics.js";
import { planImageExport, scaledDimensions } from "./image-layout.js";
import {
  TEXT_HANDLES,
  asTextBox,
  hitText,
  moveText,
  resizeText,
  textBounds,
  textHandles,
  textLayout,
  textFont,
  textToImage,
} from "./text-layout.js";
import { transformAnnotations } from "./annotation-geometry.js";
import { imagesToPDF, compressPDF } from "./pdf.js";
import {
  PAPER_SIZES,
  choosePDFLayout,
  describePDFLayout,
} from "./pdf-layout.js";

hydrateIcons();
document.querySelector(".key-hint").textContent = (
  navigator.userAgentData?.platform || navigator.platform
).includes("Mac")
  ? "⇧ ⌥ P"
  : "⇧ Alt P";
const $ = (id) => document.getElementById(id);
$("pdf-size").innerHTML =
  '<option value="auto">Auto · best paper & orientation</option><option value="image">Image-sized · continuous page</option>' +
  PAPER_SIZES.map(
    (paper) =>
      `<option value="${paper.id}">${paper.label} · ${paper.description}</option>`,
  ).join("");
const base = $("base-canvas"),
  overlay = $("overlay-canvas"),
  stage = $("canvas-stage");
const previewImage = $("preview-image"),
  imageMenu = $("image-menu");
let nativePreviewURL,
  previewReady = false,
  previewRequest = 0,
  menuSource,
  menuReturnFocus;
const viewport = $("canvas-viewport");
let project,
  part = 0,
  zoom = 1,
  bitmap,
  tool = "select",
  draft,
  drag,
  textSession,
  selectedTextIndex = null,
  textDraft,
  selectedObjectIndex = null,
  objectDraft,
  textListKey,
  cropPreview;
const defaultTextStyle = {
  color: "#1f2937",
  fontSize: 24,
  fontFamily: "inter",
  fontWeight: 500,
  background: "transparent",
};
let newTextStyle = { ...defaultTextStyle },
  drawingColor = "#7955e8";
const textInput = $("annotation-text"),
  textFrame = $("inline-text-frame"),
  editingRedactions = $("editing-redactions");
let summaries = [],
  previewURLs = [],
  histories = new Map(),
  exportCache,
  deletingId;
let saveChain = Promise.resolve(),
  pendingSaves = 0,
  working = false,
  toastTimer,
  loadGeneration = 0;
let pdfFile,
  pdfResult,
  pdfAbort,
  pdfRunning = false;
const editorId = crypto.randomUUID(),
  conflicts = new Map(),
  failedSaves = new Set(),
  saveStates = new WeakMap();
const tools = [
  ["select", "cursor", "Pan", "V"],
  ["text-select", "cursor", "Select text", "S"],
  ["object-select", "cursor", "Select objects", "Q"],
  ["arrow", "arrow", "Arrow", "A"],
  ["rectangle", "rectangle", "Rectangle", "R"],
  ["ellipse", "ellipse", "Ellipse", "O"],
  ["pen", "pen", "Draw", "P"],
  ["text", "text", "Text", "T"],
  ["callout", "text", "Callout", "L"],
  ["highlight", "highlight", "Highlight", "H"],
  ["blur", "blur", "Pixelate", "B"],
  ["redact", "redact", "Redact", "X"],
  ["crop", "crop", "Crop", "C"],
  ["step", "step", "Numbered step", "N"],
];
const hints = {
  "object-select":
    "Select, move or resize any object · use the object list for small marks",
  callout: "Click to type a callout directly on the image",
  select: "Drag to pan around your capture",
  arrow: "Drag to point something out",
  rectangle: "Drag to frame a detail",
  ellipse: "Drag to circle a detail",
  pen: "Draw directly on your capture",
  text: "Click and type on your image · click a text box to edit · Select text (S) to move or resize",
  "text-select":
    "Select a text box to move, resize or restyle · double-click to edit",
  highlight: "Drag over something worth highlighting",
  blur: "Drag to pixelate · use Redact for sensitive information",
  redact: "Drag to permanently cover details in exported files",
  crop: "Drag a crop area · adjust its handles or dimensions · Apply to keep it",
  step: "Click to add the next numbered step",
};
$("drawing-tools").innerHTML = tools
  .map(
    ([id, glyph, label, key]) =>
      `<button class="tool-button${id === "select" ? " selected" : ""}" data-tool="${id}" title="${label} (${key})" aria-label="${label}" aria-pressed="${id === "select"}">${icon(glyph, 18)}${["crop", "text-select"].includes(id) ? `<span class="tool-label">${id === "crop" ? "Crop" : "Select text"}</span>` : ""}</button>`,
  )
  .join("");

function toast(message) {
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 5500);
}
function fail(error) {
  if (!(error instanceof ProjectConflict)) console.error(error);
  toast(error.message || "Something went wrong. Please try again.");
}
async function busy(label, callback) {
  if (working) return;
  if (pendingMask()) {
    toast("Finish placing the redaction before exporting or copying.");
    return;
  }
  if ((await finishText()) === false) return;
  if (working) return;
  cancelGesture();
  drawOverlay();
  closeImageMenu();
  working = true;
  $("busy-label").textContent = label;
  $("busy-overlay").hidden = false;
  document.querySelector(".main").inert = true;
  document.querySelector(".sidebar").inert = true;
  try {
    return await callback();
  } catch (error) {
    fail(error);
  } finally {
    working = false;
    $("busy-overlay").hidden = true;
    document.querySelector(".main").inert = false;
    document.querySelector(".sidebar").inert = false;
  }
}
function image() {
  return project?.images[part];
}
function pendingMask() {
  return (
    draft?.type === "redact" ||
    objectDraft?.type === "redact" ||
    drag?.original?.type === "redact"
  );
}
function invalidateExport() {
  exportCache = null;
  $("export-result").textContent =
    "Adjust size or choose JPG / WebP to reduce file size.";
}
function history() {
  if (!histories.has(part)) histories.set(part, { undo: [], redo: [] });
  return histories.get(part);
}
function snapshot() {
  return structuredClone(image());
}
function pushUndo() {
  const h = history();
  h.undo.push(snapshot());
  if (h.undo.length > 35) h.undo.shift();
  h.redo = [];
  updateUndo();
}
function updateUndo() {
  const h = history();
  $("undo-button").disabled = !h.undo.length;
  $("redo-button").disabled = !h.redo.length;
}
async function persist(target = project, makeThumbnail = false) {
  if (!target) return;
  if (embedded && target.id !== embeddedGrant.projectId)
    throw new Error("This embedded editor is limited to its captured project.");
  target.updated = Date.now();
  if (!saveStates.has(target))
    saveStates.set(target, {
      generation: 0,
      imageGeneration: 0,
      thumbnailGeneration: 0,
      thumbnail: target.thumbnail,
    });
  const state = saveStates.get(target),
    generation = ++state.generation;
  if (makeThumbnail) state.imageGeneration++;
  const imageGeneration = state.imageGeneration;
  const copy = structuredClone(target);
  pendingSaves++;
  $("save-state").textContent = "Saving…";
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      if (conflicts.has(copy.id)) throw conflicts.get(copy.id);
      // Later snapshots contain every earlier edit. Skip obsolete queued renders/writes.
      if (generation !== state.generation) return;
      if (state.thumbnailGeneration !== imageGeneration) {
        state.thumbnail = await thumbnail(copy.images[0]);
        state.thumbnailGeneration = imageGeneration;
      }
      if (generation !== state.generation) return;
      copy.thumbnail = state.thumbnail;
      const expectedRevision = target.revision || 0;
      copy.revision = expectedRevision + 1;
      await updateProject(copy, expectedRevision);
      // Advance only after a durable write, so a failed save remains retryable.
      target.revision = copy.revision;
      target.thumbnail = copy.thumbnail;
      await chrome.storage.local
        .set({
          libraryChanged: { id: copy.id, at: Date.now(), editor: editorId },
        })
        .catch(() => {});
    });
  try {
    await saveChain;
    if (--pendingSaves === 0) {
      $("save-state").textContent = textSession
        ? "Editing text…"
        : "Saved locally";
      failedSaves.delete(copy.id);
    }
  } catch (error) {
    pendingSaves--;
    failedSaves.add(copy.id);
    $("save-state").textContent = "Could not save";
    if (error instanceof ProjectConflict) showConflict(copy.id, error);
    throw error;
  }
}
async function flushSaves() {
  let current;
  do {
    current = saveChain;
    try {
      await current;
    } catch (error) {
      if (current === saveChain) throw error;
    }
  } while (current !== saveChain);
}
function showConflict(id, error) {
  conflicts.set(id, error);
  if (project?.id !== id) return;
  $("conflict-message").textContent = error.message;
  $("conflict-reload").hidden = error.removed;
  $("conflict-banner").hidden = false;
  $("save-state").textContent = "Unsaved changes";
}
function blockEditor() {
  clearEditorInteractions();
  previewRequest++;
  previewReady = false;
  closeImageMenu();
  draft = null;
  drag = null;
  $("editor-view").inert = true;
  stage.style.visibility = "hidden";
  viewport.setAttribute("aria-busy", "true");
}
async function thumbnail(record) {
  const rendered = await renderImage(record);
  const width = 320,
    height = Math.max(
      1,
      Math.min(220, Math.round((rendered.height * width) / rendered.width)),
    );
  const canvas = makeCanvas(width, height);
  canvas
    .getContext("2d")
    .drawImage(
      rendered,
      0,
      0,
      rendered.width,
      (height * rendered.width) / width,
      0,
      0,
      width,
      height,
    );
  const blob = await canvasBlob(canvas, "image/jpeg", 0.7);
  rendered.width = 1;
  canvas.width = 1;
  return blob;
}
function timeLabel(timestamp) {
  const date = new Date(timestamp),
    now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function sourceLabel(source) {
  try {
    return new URL(source).hostname || "Local file";
  } catch {
    return "Imported image";
  }
}
async function refreshLibrary() {
  if (embedded) return;
  summaries = (await listProjects()).filter(
    (item) => item.mode !== "whiteboard",
  );
  $("nav-count").textContent = summaries.length;
  $("library-count").textContent = summaries.length;
  $("storage-size").textContent = formatBytes(
    summaries.reduce((sum, item) => sum + item.bytes, 0),
  );
  $("recent-list").innerHTML = summaries.length
    ? summaries
        .slice(0, 7)
        .map(
          (item) =>
            `<button class="recent-item${project?.id === item.id ? " selected" : ""}" data-open="${item.id}">${icon(item.mode === "import" ? "image" : "full", 15)}<span>${escapeHTML(item.title)}</span></button>`,
        )
        .join("")
    : '<p class="sidebar-empty">Your next great capture<br>starts here.</p>';
  renderLibrary();
}
function renderLibrary() {
  previewURLs.forEach((url) => URL.revokeObjectURL(url));
  previewURLs = [];
  if ($("home-view").hidden) {
    $("library-grid").replaceChildren();
    return;
  }
  const query = $("search-input").value.toLocaleLowerCase();
  const filtered = summaries.filter((item) =>
    `${item.title} ${item.source || ""}`.toLocaleLowerCase().includes(query),
  );
  $("library-grid").innerHTML = filtered
    .map((item) => {
      const url = item.thumbnail ? URL.createObjectURL(item.thumbnail) : null;
      if (url) previewURLs.push(url);
      return `<article class="library-card"><button class="card-open" data-open="${item.id}"><div class="card-preview">${url ? `<img src="${url}" alt="" loading="lazy">` : icon("image", 35)}<span class="card-kind">${icon(item.mode === "import" ? "image" : "full", 10)}${item.mode === "import" ? "IMPORTED" : item.mode === "region" ? "REGION" : item.mode === "visible" ? "VISIBLE AREA" : item.mode === "pane" ? "SCROLLING AREA" : "FULL PAGE"}</span></div><div class="card-body"><strong class="card-title">${escapeHTML(item.title)}</strong><span class="card-meta">${timeLabel(item.created)}<span>·</span>${item.parts > 1 ? `${item.parts} parts` : `${item.width.toLocaleString()} × ${item.height.toLocaleString()}`}<span>·</span>${formatBytes(item.bytes)}</span></div></button><button class="card-delete" data-delete="${item.id}" aria-label="Delete ${escapeHTML(item.title)}" title="Delete capture">${icon("trash", 14)}</button></article>`;
    })
    .join("");
  $("empty-library").hidden = filtered.length > 0;
  if (!filtered.length) {
    $("empty-library").querySelector("strong").textContent = query
      ? "No captures found."
      : "A blank canvas, in the best way.";
    $("empty-library").querySelector("p").textContent = query
      ? "Try a different title or website."
      : "Capture a webpage, or drop an image anywhere to get started.";
  }
}
function showHome() {
  if (embedded) return;
  suite?.hide();
  const finishing = finishText();
  if (finishing) {
    void finishing.then((completed) => {
      if (completed !== false) showHome();
    });
    return;
  }
  clearEditorInteractions();
  closeImageMenu();
  loadGeneration++;
  previewRequest++;
  previewReady = false;
  if (nativePreviewURL) URL.revokeObjectURL(nativePreviewURL);
  nativePreviewURL = undefined;
  previewImage.removeAttribute("src");
  $("editor-view").inert = false;
  project = null;
  bitmap?.close();
  bitmap = null;
  histories.clear();
  base.width = overlay.width = 1;
  $("home-view").hidden = false;
  $("editor-view").hidden = true;
  $("page-name").textContent = "My captures";
  $("breadcrumb").textContent = "Workspace";
  $("home-button").classList.add("active");
  window.history.replaceState(null, "", "app.html");
  document.title = "Capture Studio";
  void refreshLibrary().catch(fail);
}
async function openProject(id) {
  if (embedded && id !== embeddedGrant.projectId)
    throw new Error("This embedded editor is limited to its captured project.");
  await suite?.flush();
  suite?.hide();
  if ((await finishText()) === false) return;
  await flushSaves();
  window.history.replaceState(null, "", `app.html#${id}`);
  const generation = ++loadGeneration;
  blockEditor();
  const next = await getProject(id);
  if (generation !== loadGeneration) return;
  if (!next) {
    toast("This capture is no longer in your library.");
    showHome();
    return;
  }
  if (project?.id !== next.id) $("export-scope").value = "all";
  project = next;
  failedSaves.delete(id);
  conflicts.delete(id);
  $("conflict-banner").hidden = true;
  part = 0;
  histories.clear();
  invalidateExport();
  $("home-view").hidden = true;
  $("editor-view").hidden = false;
  $("home-button").classList.remove("active");
  $("breadcrumb").textContent = "My captures";
  $("page-name").textContent = "Editor";
  suite?.projectChanged();
  $("project-title").value = project.title;
  document.title = `${project.title} · Capture Studio`;
  $("project-meta").textContent =
    `${sourceLabel(project.source)} · ${new Date(project.created).toLocaleString()} · ${project.mode === "import" ? "Imported image" : "Captured locally"}`;
  refreshPartChoices();
  /* parts configured below */
  $("part-select").hidden = project.images.length <= 1;
  $("scope-field").hidden = project.images.length <= 1;
  $("part-select").innerHTML = project.images
    .map(
      (_, i) =>
        `<option value="${i}">Part ${i + 1} of ${project.images.length}</option>`,
    )
    .join("");
  window.history.replaceState(null, "", `app.html#${project.id}`);
  await loadPart();
  await refreshLibrary();
}
async function loadPart(fit = true) {
  const generation = ++loadGeneration,
    record = image();
  blockEditor();
  let nextBitmap;
  try {
    nextBitmap = await createImageBitmap(record.blob);
  } catch (error) {
    if (generation === loadGeneration) {
      $("editor-view").inert = false;
      viewport.setAttribute("aria-busy", "false");
    }
    throw error;
  }
  if (generation !== loadGeneration) {
    nextBitmap.close();
    return;
  }
  bitmap?.close();
  bitmap = nextBitmap;
  base.width = overlay.width = record.width;
  base.height = overlay.height = record.height;
  base.getContext("2d").drawImage(bitmap, 0, 0);
  drawOverlay();
  updateUndo();
  selectTool(tool);
  updateDimensions();
  if (fit) fitZoom();
  else setZoom(zoom);
  viewport.scrollTo(0, 0);
  if (tool === "select") {
    try {
      await refreshNativePreview(record);
    } catch (error) {
      if (generation === loadGeneration) fail(error);
    }
  }
  if (generation !== loadGeneration) return;
  stage.style.visibility = "visible";
  $("editor-view").inert = false;
  viewport.setAttribute("aria-busy", "false");
}
function updateDimensions() {
  if (!project) return;
  $("canvas-dimensions").textContent =
    `${image().width.toLocaleString()} × ${image().height.toLocaleString()} px`;
  const settings = exportSettings();
  const records = settings.scope === "current" ? [image()] : project.images;
  const dimensions = ({ width, height }) =>
    `${width.toLocaleString()} × ${height.toLocaleString()} px`;
  $("capture-parts-note").hidden = project.images.length <= 1;
  $("capture-parts-note").textContent =
    `Editing part ${part + 1} of ${project.images.length}. Choose Complete capture to export every part.`;
  $("copy-button").innerHTML =
    `${icon("copy", 17)}${project.images.length > 1 ? "Copy current part" : "Copy image"}`;
  const label = settings.format === "pdf" ? "PDF" : "image";
  if (settings.format === "pdf") {
    $("output-dimensions").textContent =
      records.length === 1
        ? dimensions(scaledDimensions(records[0], settings.scale))
        : `${records.length} capture parts`;
    $("export-layout-summary").textContent =
      settings.scope === "current" && project.images.length > 1
        ? `Only part ${part + 1} of ${project.images.length} is included.`
        : `All ${records.length} capture part${records.length === 1 ? " is" : "s are"} included in the PDF.`;
  } else {
    try {
      const plan = planImageExport(records, {
        scale: settings.scale,
      });
      $("output-dimensions").textContent = dimensions(plan);
      const percent = new Intl.NumberFormat(undefined, {
        maximumSignificantDigits: 4,
      }).format(plan.effectiveScale * 100);
      const layout =
        plan.layoutMode === "stack"
          ? `All ${records.length} parts arranged vertically in saved order using the same scale. Original page layout ${plan.reason === "edited" ? "was changed by edits" : "is unavailable"}.`
          : plan.joined
            ? `All ${records.length} parts joined into one complete image.`
            : settings.scope === "current" && project.images.length > 1
              ? `Only part ${part + 1} of ${project.images.length}. Choose Complete capture to include the rest.`
              : "Complete image.";
      $("export-layout-summary").textContent =
        `${layout} One ${settings.format === "jpeg" ? "JPG" : settings.format.toUpperCase()} file. ${plan.fitted ? `Automatically resized uniformly to approximately ${percent}% to fit safely (${Math.round(settings.scale * 100)}% requested).` : "Uniform resizing; dimensions rounded to whole pixels."}`;
    } catch (error) {
      $("output-dimensions").textContent = "Choose a smaller image size";
      $("export-layout-summary").textContent = error.message;
    }
  }
  $("export-button").innerHTML = `${icon("download", 18)}Export ${label}`;
  updatePDFSummary();
}
function updatePDFSummary() {
  if (!project) return;
  const settings = exportSettings();
  const records = settings.scope === "current" ? [image()] : project.images;
  $("pdf-orientation").disabled = settings.pageSize === "image";
  try {
    $("pdf-layout-summary").textContent = describePDFLayout(
      choosePDFLayout(records, settings),
    );
  } catch (error) {
    $("pdf-layout-summary").textContent = error.message;
  }
}
function setZoom(value) {
  cancelGesture();
  zoom = clamp(value, 0.01, 3);
  if (!image()) return;
  stage.style.width = `${image().width * zoom}px`;
  stage.style.height = `${image().height * zoom}px`;
  $("zoom-label").textContent = `${Math.round(zoom * 100)}%`;
  drawOverlay();
}
function fitZoom() {
  if (image())
    setZoom(
      Math.min(
        1,
        (viewport.clientWidth - (innerWidth < 740 ? 44 : 72)) / image().width,
      ),
    );
}
function selectTool(next) {
  if (next !== "object-select") selectedObjectIndex = null;
  const finishing = finishText();
  if (finishing) {
    void finishing.then((completed) => {
      if (completed !== false) selectTool(next);
    });
    return;
  }
  cancelGesture();
  tool = next;
  if (!["text", "text-select"].includes(tool))
    $("annotation-color").value = drawingColor;
  if (!["text", "text-select"].includes(tool)) selectedTextIndex = null;
  cropPreview = null;
  draft = null;
  drag = null;
  drawOverlay();
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.tool === tool);
    button.setAttribute("aria-pressed", button.dataset.tool === tool);
  });
  $("tool-hint").textContent = hints[tool];
  overlay.style.cursor =
    tool === "select" ? "grab" : tool === "text" ? "text" : "crosshair";
  syncPreviewLayers();
  if (tool === "select" && !previewReady && project && !$("editor-view").inert)
    void refreshNativePreview().catch(fail);
}
function selectedText() {
  if (sessionCurrent(textSession)) return textSession.draft;
  const annotation = image()?.annotations[selectedTextIndex];
  return annotation?.type === "text" ? textDraft || annotation : null;
}
function cancelGesture() {
  objectDraft = null;
  const previous = drag;
  drag = null;
  draft = null;
  textDraft = null;
  if (previous?.kind?.startsWith("crop")) cropPreview = previous.cropBefore;
  if (previous && overlay.hasPointerCapture(previous.pointerId))
    overlay.releasePointerCapture(previous.pointerId);
}
function clearEditorInteractions() {
  cancelGesture();
  selectedTextIndex = null;
  selectedObjectIndex = null;
  cropPreview = null;
  textListKey = undefined;
  cancelText();
}
function editorSession() {
  return { project, record: image(), part, generation: loadGeneration };
}
function sessionCurrent(session) {
  return (
    session &&
    session.project === project &&
    session.record === image() &&
    session.part === part &&
    session.generation === loadGeneration
  );
}
function syncTextControls() {
  $("text-controls").hidden = !["text", "text-select", "callout"].includes(
    tool,
  );
  const entries = (image()?.annotations || []).flatMap((a, index) =>
    a.type === "text" ? [{ a, index }] : [],
  );
  const key = JSON.stringify(entries.map(({ a, index }) => [index, a.text]));
  if (key !== textListKey) {
    textListKey = key;
    $("text-object-select").replaceChildren(
      new Option("Choose a text box", ""),
      ...entries.map(
        ({ a, index }, n) =>
          new Option(
            `${n + 1}. ${a.text.replace(/\s+/g, " ").slice(0, 45)}`,
            String(index),
          ),
      ),
    );
  }
  const annotation = selectedText();
  $("text-object-select").value =
    annotation && selectedTextIndex !== null ? String(selectedTextIndex) : "";
  $("text-done").hidden = $("text-cancel").hidden = !textSession;
  $("text-edit").hidden = Boolean(textSession);
  for (const id of [
    "text-edit",
    "text-delete",
    "text-center",
    "text-box-width",
    "text-box-height",
  ])
    $(id).disabled = !annotation;
  if (["text", "text-select"].includes(tool)) {
    const style = annotation || newTextStyle;
    $("annotation-color").value = style.color || "#7856ff";
    $("font-size").value = style.fontSize || 28;
    $("text-font").value = style.fontFamily || "system";
    $("text-transparent").checked = style.background === "transparent";
    if (style.background && style.background !== "transparent")
      $("text-background").value = style.background;
    else if (!style.background) $("text-background").value = "#ffffff";
  }
  if (annotation) {
    const bounds = textLayout(overlay.getContext("2d"), annotation);
    $("text-box-width").value = Math.round(bounds.width);
    $("text-box-height").value = Math.round(bounds.height);
  }
}
function syncCropControls() {
  $("crop-controls").hidden = tool !== "crop";
  const r = cropPreview || {
    x: 0,
    y: 0,
    width: image()?.width || 1,
    height: image()?.height || 1,
  };
  for (const [key, id] of [
    ["x", "crop-x"],
    ["y", "crop-y"],
    ["width", "crop-width"],
    ["height", "crop-height"],
  ])
    $(id).value = Math.round(r[key]);
  $("crop-apply").disabled = !cropPreview || r.width < 1 || r.height < 1;
  for (const id of ["export-button", "check-size", "copy-button"])
    $(id).disabled = tool === "crop" && Boolean(cropPreview);
}
function selectText(index) {
  const finishing = finishText();
  if (finishing) {
    void finishing.then((completed) => {
      if (completed !== false) selectText(index);
    });
    return;
  }
  cancelGesture();
  selectedTextIndex =
    image()?.annotations[index]?.type === "text" ? index : null;
  drawOverlay();
}
async function updateSelectedText(patch) {
  if (textSession && sessionCurrent(textSession)) {
    Object.assign(textSession.draft, patch);
    drawOverlay();
    $("save-state").textContent = "Editing text…";
    return;
  }
  if (!selectedText() || working || $("editor-view").inert) return;
  const next = {
    ...("boxWidth" in patch || "boxHeight" in patch || patch.layoutVersion === 2
      ? asTextBox(overlay.getContext("2d"), selectedText())
      : selectedText()),
    ...(patch.layoutVersion === 2 && selectedText().layoutVersion !== 2
      ? { legacyBaseline: true }
      : {}),
    ...patch,
  };
  if (
    JSON.stringify(next) ===
    JSON.stringify(image().annotations[selectedTextIndex])
  )
    return;
  pushUndo();
  image().annotations[selectedTextIndex] = next;
  await changed();
}
// A text session owns one capture record and one original annotation. Drafts are
// committed synchronously before snapshots; persistence is queued immediately.
function beginText(position, index = null) {
  const finishing = finishText();
  if (finishing) {
    void finishing.then((completed) => {
      if (completed !== false) beginText(position, index);
    });
    return;
  }
  if (working || $("editor-view").inert || !image()) return;
  cancelGesture();
  const original = index === null ? null : image().annotations[index];
  if (index !== null && original?.type !== "text") return;
  const annotation = original
    ? {
        ...asTextBox(overlay.getContext("2d"), original),
        layoutVersion: 2,
        fontFamily: original.fontFamily || "system",
        fontWeight:
          original.fontWeight || (original.layoutVersion === 2 ? 500 : 600),
        legacyBaseline:
          original.layoutVersion === 2 ? original.legacyBaseline : true,
      }
    : {
        type: "text",
        id: crypto.randomUUID(),
        ...position,
        text: "",
        ...newTextStyle,
        ...(tool === "callout"
          ? { boxShape: "callout", background: "#ede9fe", color: "#312e81" }
          : {}),
        layoutVersion: 2,
        boxWidth: Math.min(360, Math.max(60, image().width - position.x)),
        boxHeight: 0,
      };
  if (!original) {
    const bounds = textLayout(overlay.getContext("2d"), annotation);
    annotation.x = clamp(
      annotation.x,
      0,
      Math.max(0, image().width - bounds.width),
    );
    annotation.y = clamp(
      annotation.y,
      0,
      Math.max(0, image().height - bounds.height),
    );
  }
  textSession = {
    ...editorSession(),
    index,
    original,
    draft: annotation,
    composing: false,
  };
  selectedTextIndex = index;
  textInput.value = annotation.text;
  textFrame.hidden = false;
  drawOverlay();
  textInput.focus({ preventScroll: true });
  textInput.setSelectionRange(textInput.value.length, textInput.value.length);
  $("save-state").textContent = "Editing text…";
}
function cancelText(completed = false) {
  const cancelled = textSession;
  textSession = null;
  cancelled?.finishResolve?.(completed);
  textFrame.hidden = true;
  editingRedactions.hidden = true;
  editingRedactions.width = editingRedactions.height = 1;
  if (!pendingSaves && !(project && failedSaves.has(project.id)))
    $("save-state").textContent = "Saved locally";
}
function textDirty() {
  if (!sessionCurrent(textSession)) return false;
  if (!textSession.original) return Boolean(textSession.draft.text.trim());
  const { original, draft: next } = textSession;
  // Merely opening and closing an older annotation must not migrate its layout.
  const before = {
    ...asTextBox(overlay.getContext("2d"), original),
    fontFamily: original.fontFamily || "system",
    fontWeight:
      original.fontWeight || (original.layoutVersion === 2 ? 500 : 600),
  };
  return [
    "text",
    "color",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "background",
    "boxWidth",
    "boxHeight",
    "x",
    "y",
  ].some((key) => before[key] !== next[key]);
}
function finishText() {
  const session = textSession;
  if (!session) return;
  if (session.composing) {
    // Final IME input may arrive after blur; dependent actions wait for it.
    if (!session.finishing)
      session.finishing = new Promise(
        (resolve) => (session.finishResolve = resolve),
      );
    if (document.activeElement === textInput) textInput.blur();
    return session.finishing;
  }
  // Composition is finalized by focus leaving the input. Read the live value
  // here too so a toolbar click cannot export the preceding input event.
  session.draft.text = textInput.value;
  const valid =
    sessionCurrent(session) &&
    (session.index === null ||
      image().annotations[session.index] === session.original);
  const dirty = valid && textDirty();
  cancelText(valid);
  if (!dirty) {
    if (image()) drawOverlay();
    return;
  }
  pushUndo();
  if (session.draft.text.trim()) {
    if (session.index === null) {
      image().annotations.push(session.draft);
      selectedTextIndex = image().annotations.length - 1;
    } else image().annotations[session.index] = session.draft;
  } else {
    image().annotations.splice(session.index, 1);
    selectedTextIndex = null;
  }
  void changed().catch(fail);
}
function positionTextInput() {
  if (!sessionCurrent(textSession)) return;
  const annotation = textSession.draft,
    layout = textLayout(overlay.getContext("2d"), annotation);
  const origin = textToImage(annotation, { x: 0, y: 0 }),
    right = textToImage(annotation, { x: 1, y: 0 }),
    down = textToImage(annotation, { x: 0, y: 1 });
  const rect = stage.getBoundingClientRect();
  const scaleX = rect.width / image().width,
    scaleY = rect.height / image().height;
  textFrame.style.width = `${layout.width}px`;
  textFrame.style.height = `${layout.height}px`;
  textFrame.style.transform = `matrix(${(right.x - origin.x) * scaleX},${(right.y - origin.y) * scaleY},${(down.x - origin.x) * scaleX},${(down.y - origin.y) * scaleY},${origin.x * scaleX},${origin.y * scaleY})`;
  textInput.style.font = textFont(annotation);
  textInput.style.lineHeight = `${layout.lineHeight}px`;
  textInput.style.color = textInput.style.caretColor =
    annotation.color || "#7856ff";
  textInput.style.left = `${layout.paddingX}px`;
  textInput.style.top = `${layout.paddingY + layout.baseline - layout.nativeBaseline}px`;
  textInput.style.width = `${layout.width - layout.paddingX * 2}px`;
  textInput.style.height = `${Math.max(layout.lineHeight, layout.height - layout.paddingY * 2)}px`;
  editingRedactions.hidden = false;
  if (editingRedactions.width !== base.width)
    editingRedactions.width = base.width;
  if (editingRedactions.height !== base.height)
    editingRedactions.height = base.height;
  const ctx = editingRedactions.getContext("2d");
  ctx.clearRect(0, 0, editingRedactions.width, editingRedactions.height);
  // Editable DOM text is covered by the same final redaction masks as exports.
  const annotations = image().annotations || [];
  drawAnnotations(
    ctx,
    [
      ...(textSession.index === null
        ? []
        : annotations
            .slice(textSession.index + 1)
            .filter((a) => a.type !== "redact")),
      ...annotations.filter((a) => a.type === "redact"),
    ],
    base,
  );
}
function syncPreviewLayers() {
  const native = tool === "select" && previewReady;
  previewImage.hidden = !native;
  base.hidden = native;
  overlay.style.opacity = native ? "0" : "1";
  overlay.style.pointerEvents = tool === "select" ? "none" : "auto";
  overlay.tabIndex = tool === "select" ? -1 : 0;
}
async function flattenedPNG(record) {
  if (record === image() && pendingMask())
    throw new Error(
      "Finish placing the redaction before exporting or copying.",
    );
  if (
    !record.annotations?.length &&
    !record.crop &&
    record.blob.type === "image/png"
  )
    return record.blob;
  const canvas = await renderImage(record);
  try {
    return await canvasBlob(canvas);
  } finally {
    canvas.width = 1;
  }
}
async function refreshNativePreview(record = image()) {
  const request = ++previewRequest,
    generation = loadGeneration;
  previewReady = false;
  syncPreviewLayers();
  const blob = await flattenedPNG(structuredClone(record));
  if (request !== previewRequest || generation !== loadGeneration) return;
  const url = URL.createObjectURL(blob),
    loader = new Image();
  loader.src = url;
  try {
    await loader.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  if (request !== previewRequest || generation !== loadGeneration) {
    URL.revokeObjectURL(url);
    return;
  }
  const previous = nativePreviewURL;
  previewImage.src = url;
  nativePreviewURL = url;
  previewReady = true;
  syncPreviewLayers();
  if (previous) URL.revokeObjectURL(previous);
}
function drawOverlay() {
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!image()) return;
  drawAnnotations(
    ctx,
    [
      ...(image().annotations || []).flatMap((a, index) =>
        textSession &&
        (a.type === "redact" ||
          (textSession.index !== null && index > textSession.index))
          ? []
          : [
              textSession?.index === index
                ? { ...textSession.draft, hideText: true }
                : index === selectedTextIndex && textDraft
                  ? textDraft
                  : index === selectedObjectIndex && objectDraft
                    ? objectDraft
                    : a,
            ],
      ),
      ...(textSession?.index === null
        ? [{ ...textSession.draft, hideText: true }]
        : []),
      ...(draft ? [draft] : []),
    ],
    base,
  );
  if (tool === "crop" && cropPreview) {
    const r = cropPreview;
    ctx.save();
    ctx.fillStyle = "#18102466";
    ctx.fillRect(0, 0, overlay.width, r.y);
    ctx.fillRect(
      0,
      r.y + r.height,
      overlay.width,
      overlay.height - r.y - r.height,
    );
    ctx.fillRect(0, r.y, r.x, r.height);
    ctx.fillRect(r.x + r.width, r.y, overlay.width - r.x - r.width, r.height);
    ctx.restore();
    drawSelection(ctx, r, cropHandles(r));
  } else if (selectedText() && !textSession) {
    const annotation = selectedText(),
      r = textBounds(ctx, annotation);
    drawSelection(ctx, r);
    drawHandleSquares(ctx, textHandles(ctx, annotation));
  }
  if (tool === "object-select" && selectedObjectIndex !== null) {
    const a = objectDraft || image().annotations[selectedObjectIndex];
    if (a) {
      drawSelection(ctx, objectBounds(ctx, a));
      drawHandleSquares(ctx, objectHandles(ctx, a));
    }
  }
  syncObjectControls();
  syncTextControls();
  syncCropControls();
  positionTextInput();
}
function cropHandles(r) {
  return TEXT_HANDLES.map((name) => ({
    name,
    x:
      r.x +
      (name.includes("w") ? 0 : name.includes("e") ? r.width : r.width / 2),
    y:
      r.y +
      (name.includes("n") ? 0 : name.includes("s") ? r.height : r.height / 2),
  }));
}
function drawSelection(ctx, r, handles) {
  ctx.save();
  ctx.strokeStyle = "#6944d6";
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([5 / zoom, 3 / zoom]);
  ctx.strokeRect(r.x, r.y, r.width, r.height);
  ctx.restore();
  if (handles) drawHandleSquares(ctx, handles);
}
function drawHandleSquares(ctx, handles) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#6944d6";
  ctx.lineWidth = 1.5 / zoom;
  for (const p of handles) {
    ctx.fillRect(p.x - 4 / zoom, p.y - 4 / zoom, 8 / zoom, 8 / zoom);
    ctx.strokeRect(p.x - 4 / zoom, p.y - 4 / zoom, 8 / zoom, 8 / zoom);
  }
  ctx.restore();
}
function hitHandle(handles, point) {
  return handles.find(
    (p) =>
      Math.abs(p.x - point.x) <= 8 / zoom &&
      Math.abs(p.y - point.y) <= 8 / zoom,
  )?.name;
}
function textAt(point) {
  const annotations = image().annotations,
    ctx = overlay.getContext("2d");
  for (let i = annotations.length - 1; i >= 0; i--)
    if (annotations[i].type === "text" && hitText(ctx, annotations[i], point))
      return i;
  return null;
}
function roundedCrop(r) {
  const x = clamp(Math.round(r.x), 0, image().width - 1),
    y = clamp(Math.round(r.y), 0, image().height - 1);
  return {
    x,
    y,
    width: clamp(Math.round(r.width), 1, image().width - x),
    height: clamp(Math.round(r.height), 1, image().height - y),
  };
}
function point(event) {
  const r = overlay.getBoundingClientRect();
  return {
    x: clamp(
      ((event.clientX - r.left) * overlay.width) / r.width,
      0,
      overlay.width,
    ),
    y: clamp(
      ((event.clientY - r.top) * overlay.height) / r.height,
      0,
      overlay.height,
    ),
  };
}
async function changed() {
  invalidateExport();
  drawOverlay();
  updateUndo();
  previewRequest++;
  previewReady = false;
  syncPreviewLayers();
  const saving = persist(project, part === 0);
  if (tool === "select") void refreshNativePreview().catch(fail);
  await saving;
}
async function commitAnnotation(annotation) {
  pushUndo();
  image().annotations.push(annotation);
  await changed();
}
stage.addEventListener("pointerdown", (event) => {
  if (textFrame.contains(event.target) || textSession?.composing) return;
  if (working || $("editor-view").inert || !project || event.button !== 0)
    return;
  event.preventDefault();
  (tool === "select" && previewReady ? previewImage : overlay).focus({
    preventScroll: true,
  });
  const p = point(event),
    color = $("annotation-color").value,
    size = Number($("stroke-size").value);
  if (tool === "object-select") {
    const ctx = overlay.getContext("2d"),
      a = image().annotations[selectedObjectIndex],
      handle = a ? hitHandle(objectHandles(ctx, a), p) : null;
    const index = handle
      ? selectedObjectIndex
      : hitObject(ctx, image().annotations, p);
    selectedObjectIndex = index;
    selectedTextIndex = null;
    if (index !== null) {
      const original = image().annotations[index];
      drag = {
        ...editorSession(),
        kind: "object",
        index,
        handle,
        point: p,
        annotation: original,
        original: structuredClone(original),
        pointerId: event.pointerId,
      };
      overlay.setPointerCapture(event.pointerId);
    }
    drawOverlay();
    return;
  }
  if (tool === "callout") {
    beginText(p);
    return;
  }
  if (["text", "text-select"].includes(tool)) {
    const handle = selectedText()
      ? hitHandle(textHandles(overlay.getContext("2d"), selectedText()), p)
      : null;
    const index = handle ? selectedTextIndex : textAt(p);
    selectText(index);
    if (tool === "text" && !handle) {
      beginText(index === null ? p : null, index);
      return;
    }
    if (index === null) {
      if (tool === "text") beginText(p);
      return;
    }
    drag = {
      ...editorSession(),
      kind: "text",
      point: p,
      index,
      handle,
      annotation: image().annotations[index],
      original: structuredClone(image().annotations[index]),
      pointerId: event.pointerId,
    };
    overlay.setPointerCapture(event.pointerId);
    return;
  }
  if (tool === "step") {
    void commitAnnotation({
      type: "step",
      x: p.x,
      y: p.y,
      color,
      size,
      number: image().annotations.filter((a) => a.type === "step").length + 1,
    }).catch(fail);
    return;
  }
  drag = {
    ...editorSession(),
    kind: tool === "select" ? "pan" : tool === "crop" ? "crop-draw" : "draw",
    pointerId: event.pointerId,
    point: p,
    clientX: event.clientX,
    clientY: event.clientY,
    scrollLeft: viewport.scrollLeft,
    scrollTop: viewport.scrollTop,
  };
  overlay.setPointerCapture(event.pointerId);
  if (tool === "crop") {
    drag.cropBefore = cropPreview ? { ...cropPreview } : null;
    const handle = cropPreview ? hitHandle(cropHandles(cropPreview), p) : null;
    if (handle) {
      drag.kind = "crop-resize";
      drag.handle = handle;
    } else if (
      cropPreview &&
      p.x >= cropPreview.x &&
      p.x <= cropPreview.x + cropPreview.width &&
      p.y >= cropPreview.y &&
      p.y <= cropPreview.y + cropPreview.height
    )
      drag.kind = "crop-move";
    return;
  }
  if (tool !== "select")
    draft = {
      type: tool,
      color,
      size,
      points: [p, p],
      rect: { x: p.x, y: p.y, width: 0, height: 0 },
    };
});
stage.addEventListener("pointermove", (event) => {
  if (!drag && ["text", "text-select"].includes(tool) && image()) {
    const p = point(event),
      handle =
        selectedText() &&
        hitHandle(textHandles(overlay.getContext("2d"), selectedText()), p);
    overlay.style.cursor = handle
      ? `${["n", "s"].includes(handle) ? "ns" : ["e", "w"].includes(handle) ? "ew" : ["nw", "se"].includes(handle) ? "nwse" : "nesw"}-resize`
      : textAt(p) !== null
        ? "move"
        : tool === "text"
          ? "text"
          : "default";
  }
  if (!drag) return;
  if (!sessionCurrent(drag) || event.pointerId !== drag.pointerId) {
    cancelGesture();
    drawOverlay();
    return;
  }
  if (drag.kind === "pan") {
    viewport.scrollLeft = drag.scrollLeft - event.clientX + drag.clientX;
    viewport.scrollTop = drag.scrollTop - event.clientY + drag.clientY;
    return;
  }
  const p = point(event);
  if (drag.kind === "object") {
    objectDraft = drag.handle
      ? resizeObject(
          overlay.getContext("2d"),
          drag.original,
          drag.handle,
          drag.point,
          p,
        )
      : moveObject(drag.original, p.x - drag.point.x, p.y - drag.point.y);
    drawOverlay();
    return;
  }
  if (drag.kind === "text") {
    textDraft = drag.handle
      ? resizeText(
          overlay.getContext("2d"),
          drag.original,
          drag.handle,
          drag.point,
          p,
        )
      : moveText(drag.original, p.x - drag.point.x, p.y - drag.point.y);
    drawOverlay();
    return;
  }
  if (drag.kind.startsWith("crop")) {
    const r = drag.cropBefore;
    if (drag.kind === "crop-move")
      cropPreview = {
        ...r,
        x: clamp(r.x + p.x - drag.point.x, 0, image().width - r.width),
        y: clamp(r.y + p.y - drag.point.y, 0, image().height - r.height),
      };
    else if (drag.kind === "crop-resize") {
      cropPreview = normalizeRect(
        {
          x: drag.handle.includes("w") ? p.x : r.x,
          y: drag.handle.includes("n") ? p.y : r.y,
        },
        {
          x: drag.handle.includes("e") ? p.x : r.x + r.width,
          y: drag.handle.includes("s") ? p.y : r.y + r.height,
        },
        overlay.width,
        overlay.height,
      );
    } else
      cropPreview = normalizeRect(drag.point, p, overlay.width, overlay.height);
    drawOverlay();
    return;
  }
  if (tool === "pen") draft.points.push(p);
  else draft.points[1] = p;
  draft.rect = normalizeRect(drag.point, p, overlay.width, overlay.height);
  drawOverlay();
});
stage.addEventListener("pointerup", (event) => {
  if (!drag) return;
  if (event.pointerId !== drag.pointerId) return;
  const gesture = drag;
  const nextObject = objectDraft;
  objectDraft = null;
  const nextText = textDraft;
  const annotation = draft;
  drag = null;
  draft = null;
  textDraft = null;
  if (overlay.hasPointerCapture(event.pointerId))
    overlay.releasePointerCapture(event.pointerId);
  if (!sessionCurrent(gesture)) {
    drawOverlay();
    return;
  }
  if (gesture.kind === "object") {
    if (
      nextObject &&
      image().annotations[gesture.index] === gesture.annotation &&
      JSON.stringify(nextObject) !== JSON.stringify(gesture.original)
    ) {
      pushUndo();
      image().annotations[gesture.index] = nextObject;
      void changed().catch(fail);
    } else drawOverlay();
    return;
  }
  if (gesture.kind === "text") {
    if (
      nextText &&
      image().annotations[gesture.index] === gesture.annotation &&
      JSON.stringify(nextText) !== JSON.stringify(gesture.original)
    ) {
      pushUndo();
      image().annotations[gesture.index] = nextText;
      void changed().catch(fail);
    } else drawOverlay();
    return;
  }
  if (gesture.kind.startsWith("crop")) {
    cropPreview =
      cropPreview && cropPreview.width >= 1 && cropPreview.height >= 1
        ? roundedCrop(cropPreview)
        : gesture.cropBefore;
    drawOverlay();
    return;
  }
  if (
    !annotation ||
    (annotation.type !== "pen" &&
      annotation.type !== "arrow" &&
      (annotation.rect.width < 3 || annotation.rect.height < 3))
  ) {
    drawOverlay();
    return;
  }
  void commitAnnotation(annotation).catch(fail);
});
stage.addEventListener("pointercancel", () => {
  cancelGesture();
  drawOverlay();
});
overlay.addEventListener("lostpointercapture", () => {
  if (drag) {
    cancelGesture();
    drawOverlay();
  }
});
stage.addEventListener("dblclick", (event) => {
  if (textFrame.contains(event.target)) return;
  if (
    tool === "object-select" &&
    image()?.annotations[selectedObjectIndex]?.type === "text"
  ) {
    selectText(selectedObjectIndex);
    beginText(null, selectedObjectIndex);
    return;
  }
  if (
    !["text", "text-select", "callout"].includes(tool) ||
    !image() ||
    working ||
    $("editor-view").inert
  )
    return;
  const index = textAt(point(event));
  if (index !== null) {
    selectText(index);
    beginText(null, index);
  }
});
async function rasterOperation(label, { crop, rotate } = {}) {
  await busy(label, async () => {
    const session = editorSession(),
      original = structuredClone(session.record);
    const sourceCrop = crop || session.record.crop;
    let canvas, result;
    try {
      canvas = await renderImage({
        ...session.record,
        annotations: (session.record.annotations || []).filter(
          (a) => a.type === "redact",
        ),
        ...(crop ? { crop } : {}),
      });
      result = canvas;
      if (rotate) {
        result = makeCanvas(canvas.height, canvas.width);
        const ctx = result.getContext("2d");
        ctx.translate(result.width, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(canvas, 0, 0);
      }
      const blob = await canvasBlob(result);
      if (!sessionCurrent(session))
        throw new Error(
          "The capture changed. Your image operation was cancelled.",
        );
      const h = history();
      h.undo.push(original);
      if (h.undo.length > 35) h.undo.shift();
      h.redo = [];
      project.images[part] = {
        ...session.record,
        blob,
        width: result.width,
        height: result.height,
        annotations: transformAnnotations(session.record.annotations || [], {
          crop: sourceCrop,
          rotate,
          width: canvas.width,
          height: canvas.height,
        }),
        crop: null,
        finish: null,
        layoutChanged: true,
      };
      invalidateExport();
      if (crop) selectTool("select");
      const saving = persist(project, part === 0);
      await Promise.all([loadPart(), saving]);
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      if (result && result !== canvas) result.width = result.height = 1;
    }
  });
}
async function undo(redo = false) {
  if (!project || working) return;
  if ((await finishText()) === false) return;
  const h = history(),
    from = redo ? h.redo : h.undo,
    to = redo ? h.undo : h.redo;
  if (!from.length) return;
  await busy("Restoring your edit…", async () => {
    to.push(snapshot());
    project.images[part] = from.pop();
    invalidateExport();
    const saving = persist(project, part === 0);
    await Promise.all([loadPart(false), saving]);
  });
}

function exportSettings() {
  return {
    format: document.querySelector("[data-format].selected").dataset.format,
    quality: Number($("export-quality").value) / 100,
    scale: Number($("export-scale").value) / 100,
    pageSize: $("pdf-size").value,
    orientation: $("pdf-orientation").value,
    footer: $("pdf-footer").checked,
    scope: $("export-scope").value,
  };
}
async function prepareExport() {
  if ((await finishText()) === false) return;
  if (tool === "crop" && cropPreview)
    throw new Error("Apply or cancel the crop before exporting.");
  const settings = exportSettings(),
    target = project,
    selectedPart = part,
    generation = loadGeneration,
    updated = target.updated,
    title = target.title,
    source = target.source;
  const key = JSON.stringify({
    ...settings,
    id: target.id,
    updated,
    part: selectedPart,
  });
  if (exportCache?.key === key) return exportCache;
  const records = structuredClone(
    settings.scope === "current"
      ? [target.images[selectedPart]]
      : target.images,
  );
  let blob, extension;
  if (settings.format === "pdf") {
    blob = await imagesToPDF(records, {
      ...settings,
      title,
      source,
    });
    extension = "pdf";
  } else {
    const mime = `image/${settings.format}`;
    extension = settings.format === "jpeg" ? "jpg" : settings.format;
    const plan = planImageExport(records, {
      scale: settings.scale,
    });
    if (plan.joined) {
      const canvas = await renderCapture(records, {
        scale: settings.scale,
        background: settings.format === "jpeg" ? "#fff" : undefined,
      });
      try {
        blob = await canvasBlob(canvas, mime, settings.quality);
      } finally {
        canvas.width = canvas.height = 1;
      }
    } else {
      const record = records[0];
      if (settings.format === "png" && settings.scale === 1)
        blob = await flattenedPNG(record);
      else {
        const canvas = await renderImage(record, {
          scale: plan.effectiveScale,
          background: settings.format === "jpeg" ? "#fff" : undefined,
        });
        try {
          blob = await canvasBlob(canvas, mime, settings.quality);
        } finally {
          canvas.width = canvas.height = 1;
        }
      }
    }
  }
  const originalSize = records.reduce(
    (sum, record) => sum + (record.originalBytes || record.blob.size),
    0,
  );
  const savings = percentSaved(originalSize, blob.size);
  const result = { key, blob, extension, title };
  if (
    project === target &&
    target.updated === updated &&
    part === selectedPart &&
    loadGeneration === generation &&
    JSON.stringify(exportSettings()) === JSON.stringify(settings)
  ) {
    $("export-result").textContent =
      `${extension.toUpperCase()} · ${formatBytes(blob.size)}${savings ? ` · ${savings}% smaller than the original` : " · ready to save"}`;
    exportCache = result;
  }
  return result;
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportFile() {
  if ((await finishText()) === false) return;
  if (!project) return;
  await busy("Preparing your export, right here on your device…", async () => {
    const result = await prepareExport();
    download(result.blob, `${safeFilename(result.title)}.${result.extension}`);
    toast(
      `${result.extension.toUpperCase()} exported · ${formatBytes(result.blob.size)}`,
    );
  });
}
function updateExportPanel() {
  const format = exportSettings().format;
  if (!["all", "current"].includes($("export-scope").value))
    $("export-scope").value = "all";
  $("quality-field").hidden = format === "png";
  $("pdf-options").hidden = format !== "pdf";
  $("format-description").textContent = {
    png: "Crisp details. Lossless quality.",
    jpeg: "Smaller files. Great for sharing.",
    webp: "Efficient compression. Transparency supported.",
    pdf: "Your capture, ready for documents and print.",
  }[format];
  $("quality-value").textContent = `${$("export-quality").value}%`;
  $("scale-value").textContent = `${$("export-scale").value}%`;
  invalidateExport();
  updateDimensions();
}
async function importFiles(files) {
  if (embedded) throw new Error("Open the full studio to import files.");
  await suite?.flush();
  if (!files.length) return;
  closeImageMenu();
  const pdfs = files.filter(
    (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name),
  );
  if (pdfs.length) {
    setPDF(pdfs[0]);
    $("pdf-dialog").showModal();
    return;
  }
  if (files.length > 30) {
    toast("Import up to 30 images at a time.");
    return;
  }
  let lastId,
    imported = 0,
    errors = [];
  await busy("Bringing your images into the studio…", async () => {
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_BYTES)
          throw new Error(`${file.name} exceeds the 100 MB limit.`);
        const record = await readImage(file);
        record.originalBytes = file.size;
        const id = crypto.randomUUID();
        await putProject({
          id,
          title: file.name.replace(/\.[^.]+$/, "") || "Imported image",
          created: Date.now(),
          updated: Date.now(),
          source: "",
          mode: "import",
          thumbnail: await thumbnail(record),
          images: [record],
        });
        lastId = id;
        imported++;
      } catch (error) {
        errors.push(error.message);
      }
    }
    await refreshLibrary();
    if (lastId) await openProject(lastId);
  });
  toast(
    errors.length
      ? `${imported} imported. ${errors[0]}`
      : `${imported} image${imported === 1 ? "" : "s"} added to your local library.`,
  );
}
function setPDF(file) {
  if (pdfRunning) return;
  if (file.size > MAX_FILE_BYTES) {
    toast("Choose a PDF smaller than 100 MB.");
    return;
  }
  pdfFile = file;
  pdfResult = null;
  $("pdf-file-name").textContent = file.name;
  $("pdf-file-size").textContent = `${formatBytes(file.size)} · never uploaded`;
  $("pdf-run").disabled = false;
  $("pdf-download").hidden = true;
  $("pdf-status").textContent = "";
  $("pdf-status").className = "pdf-status";
  $("pdf-progress").hidden = true;
}
async function runPDF() {
  if (!pdfFile || pdfRunning) return;
  pdfRunning = true;
  pdfResult = null;
  pdfAbort = new AbortController();
  $("pdf-run").disabled = true;
  $("pdf-download").hidden = true;
  $("pdf-cancel").hidden = false;
  $("choose-pdf").disabled = true;
  for (const id of ["pdf-compression-mode", "pdf-dpi", "pdf-jpeg-quality"])
    $(id).disabled = true;
  $("pdf-progress").hidden = false;
  $("pdf-progress").value = 0;
  $("pdf-status").className = "pdf-status";
  $("pdf-status").textContent = "Working locally…";
  try {
    const result = await compressPDF(pdfFile, {
      mode: $("pdf-compression-mode").value,
      dpi: Number($("pdf-dpi").value),
      quality: Number($("pdf-jpeg-quality").value),
      signal: pdfAbort.signal,
      onProgress: (value) => {
        $("pdf-progress").value = value;
        $("pdf-status").textContent =
          `Processing · ${Math.round(value * 100)}%`;
      },
    });
    if (pdfAbort.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    pdfResult = result;
    $("pdf-status").textContent = result.changed
      ? `${formatBytes(pdfFile.size)} → ${formatBytes(result.blob.size)} · ${percentSaved(pdfFile.size, result.blob.size)}% smaller · ${result.pages} page${result.pages === 1 ? "" : "s"}`
      : `Already compact. The original ${formatBytes(pdfFile.size)} file is smaller, so we kept it.`;
    $("pdf-status").classList.add("success");
    $("pdf-download").hidden = false;
  } catch (error) {
    $("pdf-status").textContent = pdfAbort.signal.aborted
      ? "Compression cancelled. Your original is unchanged."
      : /encrypt|password/i.test(error.message)
        ? "This PDF is password protected. Unlock a copy before importing it."
        : `Could not compress this PDF. ${error.message}`;
  } finally {
    pdfRunning = false;
    $("pdf-run").disabled = false;
    $("pdf-cancel").hidden = true;
    $("choose-pdf").disabled = false;
    for (const id of ["pdf-compression-mode", "pdf-dpi", "pdf-jpeg-quality"])
      $(id).disabled = false;
  }
}

document.addEventListener("click", (event) => {
  const close = event.target.closest("[data-close]");
  if (close) $(close.dataset.close).close();
  const open = event.target.closest("[data-open]");
  if (open) void openProject(open.dataset.open).catch(fail);
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    deletingId = remove.dataset.delete;
    $("delete-dialog").showModal();
  }
  const nextTool = event.target.closest("[data-tool]");
  if (nextTool) selectTool(nextTool.dataset.tool);
  const format = event.target.closest("[data-format]");
  if (format) {
    document
      .querySelectorAll("[data-format]")
      .forEach((button) =>
        button.classList.toggle("selected", button === format),
      );
    updateExportPanel();
  }
});
for (const id of ["new-button", "hero-capture", "quick-capture"])
  $(id).addEventListener("click", () => $("capture-dialog").showModal());
for (const id of ["import-button", "quick-import", "empty-import"])
  $(id).addEventListener("click", () => $("image-input").click());
for (const id of ["compress-button", "quick-compress", "editor-pdf-button"])
  $(id).addEventListener("click", () => $("pdf-dialog").showModal());
$("home-button").addEventListener("click", async () => {
  try {
    if ((await finishText()) === false) return;
    await flushSaves();
    await suite?.flush();
    showHome();
  } catch (error) {
    fail(error);
  }
});
$("search-input").addEventListener("input", renderLibrary);
$("image-input").addEventListener("change", () => {
  const files = [...$("image-input").files];
  $("image-input").value = "";
  void importFiles(files).catch(fail);
});
$("choose-pdf").addEventListener("click", () => $("pdf-input").click());
$("pdf-input").addEventListener("change", () => {
  if ($("pdf-input").files[0]) setPDF($("pdf-input").files[0]);
  $("pdf-input").value = "";
});
$("pdf-run").addEventListener("click", runPDF);
$("pdf-cancel").addEventListener("click", () => pdfAbort?.abort());
$("pdf-dialog").addEventListener("close", () => {
  if (pdfRunning) pdfAbort?.abort();
});
$("pdf-download").addEventListener("click", () => {
  if (pdfResult)
    download(
      pdfResult.blob,
      `${safeFilename(pdfFile.name.replace(/\.pdf$/i, ""))}-compressed.pdf`,
    );
});
$("pdf-compression-mode").addEventListener("change", () => {
  $("pdf-raster-options").hidden = $("pdf-compression-mode").value !== "raster";
  $("pdf-download").hidden = true;
  pdfResult = null;
});
for (const id of ["pdf-dpi", "pdf-jpeg-quality"])
  $(id).addEventListener("change", () => {
    $("pdf-download").hidden = true;
    pdfResult = null;
  });
$("delete-confirm").addEventListener("click", async () => {
  try {
    await saveChain.catch(() => {});
    await deleteProject(deletingId);
    await chrome.storage.local.set({
      libraryChanged: {
        id: deletingId,
        at: Date.now(),
        editor: editorId,
        deleted: true,
      },
    });
    if (project?.id === deletingId) showHome();
    await refreshLibrary();
    $("delete-dialog").close();
    toast("Capture removed from this browser.");
  } catch (error) {
    fail(error);
  }
});
$("project-title").addEventListener("change", async () => {
  if (!project) return;
  project.title = $("project-title").value.trim() || "Untitled capture";
  $("project-title").value = project.title;
  document.title = `${project.title} · Capture Studio`;
  invalidateExport();
  try {
    await persist();
    await refreshLibrary();
  } catch (error) {
    fail(error);
  }
});
$("part-select").addEventListener("change", async () => {
  const selected = Number($("part-select").value);
  if ((await finishText()) === false) return;
  part = selected;
  invalidateExport();
  try {
    await loadPart();
  } catch (error) {
    fail(error);
  }
});
textInput.addEventListener("input", () => {
  if (!sessionCurrent(textSession)) return;
  textSession.draft.text = textInput.value;
  drawOverlay();
  $("save-state").textContent = "Editing text…";
  if (!textSession.composing && textSession.finishResolve) finishText();
});
textInput.addEventListener("compositionstart", () => {
  if (textSession) textSession.composing = true;
});
textInput.addEventListener("compositionend", () => {
  if (!sessionCurrent(textSession)) return;
  const session = textSession;
  session.composing = false;
  session.draft.text = textInput.value;
  drawOverlay();
  // A final input can follow compositionend across a microtask checkpoint.
  // Prefer that input; defer the fallback to the next task for engines that
  // emit input before compositionend or omit it entirely.
  if (session.finishResolve)
    setTimeout(() => {
      if (textSession === session && !session.composing) finishText();
    }, 0);
});
textInput.addEventListener("keydown", (event) => {
  if (event.isComposing || textSession?.composing || event.keyCode === 229)
    return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelText();
    drawOverlay();
    overlay.focus({ preventScroll: true });
  } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    event.stopPropagation();
    finishText();
    selectTool("text-select");
    overlay.focus({ preventScroll: true });
  }
});
$("text-done").addEventListener("click", () => {
  finishText();
  selectTool("text-select");
  overlay.focus({ preventScroll: true });
});
$("text-cancel").addEventListener("click", () => {
  cancelText();
  drawOverlay();
  overlay.focus({ preventScroll: true });
});
// Toolbar fields stay in the same transaction. Clicking anywhere else commits
// before that action can take a snapshot (including copy and navigation).
function withinTextEditing(target) {
  if (!target) return false;
  return (
    textFrame.contains(target) ||
    $("text-controls").contains(target) ||
    target.closest?.(".draw-settings") ||
    target.closest?.(".zoom-controls")
  );
}
document.addEventListener(
  "pointerdown",
  (event) => {
    if (textSession && !withinTextEditing(event.target)) finishText();
  },
  true,
);
textInput.addEventListener("focusout", (event) => {
  // Focusout precedes focusin. relatedTarget avoids committing and hiding a
  // toolbar button before its click arrives. Losing app focus retains the draft.
  if (event.relatedTarget && !withinTextEditing(event.relatedTarget))
    finishText();
});
$("text-edit").addEventListener("click", () => {
  if (selectedText()) beginText(null, selectedTextIndex);
});
$("text-font").addEventListener("change", () => {
  newTextStyle.fontFamily = $("text-font").value;
  void updateSelectedText({
    fontFamily: $("text-font").value,
    fontWeight: 500,
    layoutVersion: 2,
  }).catch(fail);
});
$("text-delete").addEventListener("click", () => {
  if (working || $("editor-view").inert) return;
  if (textSession) {
    const session = textSession;
    const valid =
      sessionCurrent(session) &&
      session.index !== null &&
      image().annotations[session.index] === session.original;
    cancelText();
    if (!valid) {
      drawOverlay();
      return;
    }
    // Delete the original object in one transaction, discarding uncommitted typing.
    pushUndo();
    image().annotations.splice(session.index, 1);
    selectedTextIndex = null;
    void changed().catch(fail);
    return;
  }
  if (!selectedText()) return;
  pushUndo();
  image().annotations.splice(selectedTextIndex, 1);
  selectedTextIndex = null;
  void changed().catch(fail);
});
$("text-center").addEventListener("click", () => {
  if (!selectedText()) return;
  const annotation = selectedText();
  const bounds = textBounds(overlay.getContext("2d"), annotation);
  void updateSelectedText(
    moveText(
      annotation,
      (image().width - bounds.width) / 2 - bounds.x,
      (image().height - bounds.height) / 2 - bounds.y,
    ),
  ).catch(fail);
});
$("text-object-select").addEventListener("change", () =>
  selectText(
    $("text-object-select").value === ""
      ? null
      : Number($("text-object-select").value),
  ),
);
$("annotation-color").addEventListener("change", () => {
  if (tool === "object-select" && selectedObjectIndex !== null) {
    const a = image().annotations[selectedObjectIndex];
    if (a && a.type !== "redact") {
      pushUndo();
      a.color = $("annotation-color").value;
      void changed().catch(fail);
    }
    return;
  }
  if (!["text", "text-select"].includes(tool)) {
    drawingColor = $("annotation-color").value;
    return;
  }
  newTextStyle.color = $("annotation-color").value;
  void updateSelectedText({ color: $("annotation-color").value }).catch(fail);
});
$("font-size").addEventListener("change", () => {
  const value = Number($("font-size").value);
  $("font-size").value = Number.isFinite(value) ? clamp(value, 8, 240) : 28;
  newTextStyle.fontSize = Number($("font-size").value);
  void updateSelectedText({ fontSize: Number($("font-size").value) }).catch(
    fail,
  );
});
$("text-background").addEventListener("change", () => {
  $("text-transparent").checked = false;
  newTextStyle.background = $("text-background").value;
  void updateSelectedText({ background: $("text-background").value }).catch(
    fail,
  );
});
$("text-transparent").addEventListener("change", () => {
  newTextStyle.background = $("text-transparent").checked
    ? "transparent"
    : $("text-background").value;
  void updateSelectedText({
    background: $("text-transparent").checked
      ? "transparent"
      : $("text-background").value,
  }).catch(fail);
});
for (const [id, key] of [
  ["text-box-width", "boxWidth"],
  ["text-box-height", "boxHeight"],
])
  $(id).addEventListener("change", () => {
    const value = Number($(id).value);
    if (Number.isFinite(value) && value > 0)
      void updateSelectedText({ [key]: clamp(value, 1, 16000) }).catch(fail);
    else syncTextControls();
  });
for (const id of ["crop-x", "crop-y", "crop-width", "crop-height"])
  $(id).addEventListener("change", () => {
    if (!image() || tool !== "crop") return;
    const values = ["crop-x", "crop-y", "crop-width", "crop-height"].map(
      (key) => Number($(key).value),
    );
    if (values.every(Number.isFinite))
      cropPreview = roundedCrop({
        x: values[0],
        y: values[1],
        width: values[2],
        height: values[3],
      });
    drawOverlay();
  });
$("crop-apply").addEventListener("click", () => {
  if (!cropPreview || working || $("editor-view").inert) return;
  const crop = roundedCrop(cropPreview);
  void rasterOperation("Cropping your image…", { crop });
});
$("crop-cancel").addEventListener("click", () => selectTool("select"));
$("undo-button").addEventListener("click", () => {
  void undo().catch(fail);
});
$("redo-button").addEventListener("click", () => {
  void undo(true).catch(fail);
});
$("rotate-button").addEventListener("click", () => {
  void rasterOperation("Rotating your image…", { rotate: true });
});
$("zoom-out").addEventListener("click", () => setZoom(zoom / 1.2));
$("zoom-in").addEventListener("click", () => setZoom(zoom * 1.2));
$("zoom-fit").addEventListener("click", fitZoom);
$("export-button").addEventListener("click", exportFile);
$("check-size").addEventListener("click", () =>
  busy("Measuring the actual export size…", prepareExport),
);
for (const id of [
  "export-quality",
  "export-scale",
  "pdf-size",
  "pdf-orientation",
  "pdf-footer",
  "export-scope",
])
  $(id).addEventListener("input", updateExportPanel);
function copyCurrentImage() {
  const record = image(),
    title = project.title,
    finishing = finishText();
  // ClipboardItem is created during the user gesture, while its payload waits
  // for any final composition input to reach this owned record.
  return copyImage(
    Promise.resolve(finishing).then((completed) => {
      if (completed === false)
        throw new Error("Copy cancelled with the text edit.");
      return { record: structuredClone(record), title };
    }),
  );
}
$("copy-button").addEventListener("click", copyCurrentImage);
async function menuRecord(source) {
  if (source.record) return source.record;
  const target = await getProject(source.id);
  if (!target) throw new Error("This capture was deleted.");
  return target.images[0];
}
function copyImage(source) {
  if (working) return;
  if (cropExportBlocked(source)) return;
  // Pass a promise to ClipboardItem while still inside the click or keyboard gesture.
  const result = navigator.clipboard.write([
    new ClipboardItem({
      "image/png": Promise.resolve(source).then(menuRecord).then(flattenedPNG),
    }),
  ]);
  // Cancellation can end the busy operation before its callback observes this
  // promise; retain a rejection observer in that case too.
  void result.catch(() => {});
  return busy("Copying the selected image…", async () => {
    await result;
    toast("Image copied to clipboard.");
  });
}
function cropExportBlocked(source) {
  if (!source?.id && pendingMask()) {
    toast("Finish placing the redaction before exporting or copying.");
    return true;
  }
  if (!source?.id && tool === "crop" && cropPreview) {
    toast("Apply or cancel the crop before exporting or copying.");
    return true;
  }
  return false;
}
function closeImageMenu(restoreFocus = false) {
  if (!imageMenu.matches(":popover-open")) return;
  imageMenu.hidePopover();
  const target = menuReturnFocus;
  menuReturnFocus = undefined;
  if (restoreFocus && target?.isConnected)
    target.focus({ preventScroll: true });
}
function openImageMenu(event, source, returnFocus) {
  event.preventDefault();
  if (cropExportBlocked(source)) return;
  menuSource = source;
  menuReturnFocus = returnFocus;
  $("menu-open-capture").hidden = !source.id;
  const multiple = source.id
    ? summaries.find((item) => item.id === source.id)?.parts > 1
    : project?.images.length > 1;
  const label = multiple
    ? source.id
      ? "first part"
      : "current part"
    : "image";
  $("menu-copy-image").textContent = `Copy ${label}`;
  $("menu-save-image").textContent = `Save ${label} as PNG`;
  // Manual dismissal avoids Chrome 147 closing an auto-popover on the
  // same right-button release that opened the context menu.
  imageMenu.showPopover();
  imageMenu.style.left = `${clamp(event.clientX, 8, Math.max(8, innerWidth - imageMenu.offsetWidth - 8))}px`;
  imageMenu.style.top = `${clamp(event.clientY, 8, Math.max(8, innerHeight - imageMenu.offsetHeight - 8))}px`;
  $("menu-copy-image").focus();
}
stage.addEventListener("contextmenu", (event) => {
  if (textFrame.contains(event.target)) return;
  const finishing = finishText();
  if (finishing) {
    event.preventDefault();
    return;
  }
  if (!project || working || $("editor-view").inert) return;
  if (tool === "select" && previewReady && event.target === previewImage)
    return; // Native browser Copy image / Save image as.
  openImageMenu(
    event,
    { record: structuredClone(image()), title: project.title },
    overlay,
  );
});
$("library-grid").addEventListener("contextmenu", (event) => {
  const card = event.target.closest("[data-open]");
  if (card)
    openImageMenu(
      event,
      {
        id: card.dataset.open,
        title:
          summaries.find((item) => item.id === card.dataset.open)?.title ||
          "capture",
      },
      card,
    );
});
document.addEventListener(
  "pointerdown",
  (event) => {
    if (!event.composedPath().includes(imageMenu)) closeImageMenu();
  },
  true,
);
$("menu-copy-image").addEventListener("click", () => {
  closeImageMenu();
  void copyImage(menuSource);
});
$("menu-save-image").addEventListener("click", () => {
  const source = menuSource;
  closeImageMenu();
  if (cropExportBlocked(source)) return;
  void busy("Saving the selected image…", async () => {
    download(
      await flattenedPNG(await menuRecord(source)),
      `${safeFilename(source.title || project?.title || "capture")}.png`,
    );
  });
});
$("menu-open-capture").addEventListener("click", () => {
  const id = menuSource.id;
  closeImageMenu();
  void openProject(id).catch(fail);
});
imageMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    event.stopPropagation();
    closeImageMenu(true);
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...imageMenu.querySelectorAll("button:not([hidden])")],
    index = buttons.indexOf(document.activeElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? buttons.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
          buttons.length;
  buttons[next].focus();
});
$("fullscreen-button").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    fail(error);
  }
});
$("help-button").addEventListener("click", () => $("help-dialog").showModal());
window.addEventListener("keydown", (event) => {
  if (
    imageMenu.matches(":popover-open") ||
    /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
    document.querySelector("dialog[open]") ||
    !project ||
    working ||
    $("editor-view").inert
  )
    return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    void undo(event.shiftKey).catch(fail);
    return;
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "c" &&
    stage.contains(document.activeElement)
  ) {
    event.preventDefault();
    void copyCurrentImage();
    return;
  }
  if (event.key === "Escape") {
    const hadGesture = Boolean(drag);
    cancelGesture();
    if (!hadGesture && tool === "crop") selectTool("select");
    else if (!hadGesture) selectedTextIndex = null;
    drawOverlay();
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (
    tool === "object-select" &&
    selectedObjectIndex !== null &&
    stage.contains(document.activeElement)
  ) {
    if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      void deleteSelectedObject().catch(fail);
      return;
    }
    if (event.key.toLowerCase() === "d") {
      event.preventDefault();
      void duplicateSelectedObject().catch(fail);
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1,
        a = image().annotations[selectedObjectIndex];
      pushUndo();
      image().annotations[selectedObjectIndex] = moveObject(
        a,
        event.key === "ArrowLeft"
          ? -step
          : event.key === "ArrowRight"
            ? step
            : 0,
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0,
      );
      void changed().catch(fail);
      return;
    }
  }
  if (selectedText() && stage.contains(document.activeElement)) {
    if (event.key === "Enter") {
      event.preventDefault();
      beginText(null, selectedTextIndex);
      return;
    }
    if (["Delete", "Backspace"].includes(event.key)) {
      event.preventDefault();
      $("text-delete").click();
      return;
    }
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      cancelGesture();
      const a = selectedText(),
        step = event.shiftKey ? 10 : 1;
      void updateSelectedText(
        moveText(
          a,
          event.key === "ArrowLeft"
            ? -step
            : event.key === "ArrowRight"
              ? step
              : 0,
          event.key === "ArrowUp"
            ? -step
            : event.key === "ArrowDown"
              ? step
              : 0,
        ),
      ).catch(fail);
      return;
    }
  }
  const entry = tools.find(
    (item) =>
      (drawingKeys[item[0]] || item[3]).toLowerCase() ===
      event.key.toLowerCase(),
  );
  if (entry) {
    event.preventDefault();
    selectTool(entry[0]);
  }
});
window.addEventListener("beforeunload", (event) => {
  if (
    textDirty() ||
    pendingSaves ||
    suite?.hasPending() ||
    (project && failedSaves.has(project.id))
  ) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", () => {
  if (suite?.handles(location.hash.slice(1)))
    void suite.open(location.hash.slice(1)).catch(fail);
  else if (location.hash) void openProject(location.hash.slice(1)).catch(fail);
  else showHome();
});
let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  if (
    event.dataTransfer.types.includes("Files") &&
    !document.querySelector("dialog[open]")
  ) {
    event.preventDefault();
    dragDepth++;
    $("drop-overlay").hidden = false;
  }
});
window.addEventListener("dragover", (event) => {
  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
});
window.addEventListener("dragleave", () => {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    $("drop-overlay").hidden = true;
  }
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (pdfRunning || working) return;
  const files = [...event.dataTransfer.files];
  if ($("pdf-dialog").open) {
    const pdf = files.find(
      (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name),
    );
    if (pdf) setPDF(pdf);
  } else if (files.length) void importFiles(files).catch(fail);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.libraryChanged) {
    if (
      embedded &&
      changes.libraryChanged.newValue?.id !== embeddedGrant.projectId
    )
      return;
    const change = changes.libraryChanged.newValue,
      target = project;
    if (change?.editor === editorId) return;
    void refreshLibrary().catch(fail);
    if (target && change?.id === target.id && change.editor !== editorId) {
      void getProject(target.id)
        .then((latest) => {
          if (
            project === target &&
            (!latest || (latest.revision || 0) !== (target.revision || 0))
          )
            showConflict(target.id, new ProjectConflict(!latest));
        })
        .catch(fail);
    }
  }
});
$("conflict-copy").addEventListener("click", async () => {
  if (embedded) {
    toast("Open the full studio to save a separate copy.");
    return;
  }
  await flushSaves().catch(() => {});
  await busy("Saving your edits as a separate copy…", async () => {
    const copy = structuredClone(project);
    copy.id = crypto.randomUUID();
    copy.title += " (copy)";
    copy.revision = 0;
    copy.created = copy.updated = Date.now();
    copy.thumbnail = await thumbnail(copy.images[0]);
    await putProject(copy);
    saveChain = Promise.resolve();
    await openProject(copy.id);
    await chrome.storage.local.set({
      libraryChanged: { id: copy.id, at: Date.now(), editor: editorId },
    });
    toast("Your edits are safely saved in a separate capture.");
  });
});
$("conflict-reload").addEventListener("click", async () => {
  await flushSaves().catch(() => {});
  const id = project.id;
  saveChain = Promise.resolve();
  void openProject(id).catch(fail);
});
function refreshPartChoices() {
  if (!project) return;
  $("part-select").innerHTML = project.images
    .map(
      (_, i) =>
        `<option value="${i}">${project.mode === "whiteboard" ? "Page" : "Part"} ${i + 1} of ${project.images.length}</option>`,
    )
    .join("");
  $("part-select").value = part;
  $("part-select").hidden = project.images.length <= 1;
  $("scope-field").hidden = project.images.length <= 1;
}
const objectList = el("select", {
    id: "object-list",
    ariaLabel: "Drawing objects",
    onchange: (event) => {
      selectTool("object-select");
      selectedObjectIndex =
        event.target.value === "" ? null : Number(event.target.value);
      drawOverlay();
    },
  }),
  objectPanel = el(
    "div",
    { className: "object-panel" },
    field("Objects", objectList),
    el(
      "div",
      { className: "suite-row" },
      button("Duplicate", () => void duplicateSelectedObject().catch(fail)),
      button("Delete", () => void deleteSelectedObject().catch(fail)),
      button("Edit text", () => {
        if (image()?.annotations[selectedObjectIndex]?.type === "text") {
          selectText(selectedObjectIndex);
          beginText(null, selectedObjectIndex);
        }
      }),
    ),
  );
$("drawing-tools").parentNode.after(objectPanel);
let objectListKey;
function syncObjectControls() {
  if (!image()) return;
  objectPanel.hidden = tool !== "object-select";
  const key = JSON.stringify(
    image().annotations.map((a) =>
      a.type === "text" ? `${a.type}:${a.text}` : a.type,
    ),
  );
  if (key !== objectListKey) {
    objectListKey = key;
    objectList.replaceChildren(
      el("option", { value: "" }, "Select an object…"),
      ...image().annotations.map((a, i) =>
        el(
          "option",
          { value: i },
          `${i + 1}. ${a.type}${a.type === "text" ? ` · ${a.text.slice(0, 40)}` : ""}`,
        ),
      ),
    );
  }
  objectList.value = selectedObjectIndex ?? "";
}
async function duplicateSelectedObject() {
  if ((await finishText()) === false) return;
  if (!image() || selectedObjectIndex === null || working) return;
  const a = image().annotations[selectedObjectIndex];
  if (!a) return;
  pushUndo();
  const copy = moveObject(a, 24, 24);
  copy.id = crypto.randomUUID();
  if (copy.type === "step")
    copy.number =
      Math.max(
        0,
        ...image()
          .annotations.filter((a) => a.type === "step")
          .map((a) => a.number),
      ) + 1;
  image().annotations.push(copy);
  selectedObjectIndex = image().annotations.length - 1;
  void changed().catch(fail);
}
async function deleteSelectedObject() {
  if ((await finishText()) === false) return;
  if (!image() || selectedObjectIndex === null || working) return;
  pushUndo();
  image().annotations.splice(selectedObjectIndex, 1);
  selectedObjectIndex = null;
  void changed().catch(fail);
}
if (!embedded) {
  drawingKeys =
    (await chrome.storage.local.get("drawingKeys")).drawingKeys || {};
  suite = createSuite({
    toast,
    fail,
    project: () => project,
    defaultKeys: Object.fromEntries(
      tools.map((t) => [t[0], t[3].toLowerCase()]),
    ),
    updateKeys: (keys) => {
      drawingKeys = keys;
    },
    leave: async () => {
      if ((await finishText()) === false) return false;
      await flushSaves();
      showHome();
      return true;
    },
    openProject,
    commit: async () => {
      if (pendingMask())
        throw new Error(
          "Finish placing the redaction before exporting or copying.",
        );
      if ((await finishText()) === false)
        throw new Error("Finish composing text first.");
      await flushSaves();
      if (cropPreview) throw new Error("Apply or cancel the crop first.");
    },
    snapshot: async () => {
      const target = project;
      if (pendingMask())
        throw new Error(
          "Finish placing the redaction before exporting or copying.",
        );
      if ((await finishText()) === false)
        throw new Error("Finish composing text first.");
      await flushSaves();
      if (cropPreview) throw new Error("Apply or cancel the crop first.");
      if (!target || project !== target || !image())
        throw new Error(
          "The capture changed. Open the tool again for the current image.",
        );
      if (pendingMask())
        throw new Error(
          "Finish placing the redaction before exporting or copying.",
        );
      return flattenedPNG(structuredClone(image()));
    },
    importImage: async (blob, title) => {
      await importFiles([
        new File([blob], `${title}.png`, { type: blob.type }),
      ]);
    },
    finish: async (options) => {
      await busy("Applying your image finish…", async () => {
        if (!image()) return;
        if (cropPreview) throw new Error("Apply or cancel the crop first.");
        const session = editorSession(),
          next = await finishImage(session.record, options);
        if (!sessionCurrent(session))
          throw new Error("The image changed during this operation.");
        pushUndo();
        project.images[part] = next;
        invalidateExport();
        await Promise.all([persist(project, part === 0), loadPart()]);
      });
    },
    pages: async (action, page) => {
      if ((await finishText()) === false) return;
      await flushSaves();
      if (project?.mode !== "whiteboard") return;
      const target = project;
      if (action === "add") {
        target.images.push(page);
        part = target.images.length - 1;
      }
      if (action === "duplicate") {
        if (target.images.length >= 100)
          throw new Error("Each board supports up to 100 pages.");
        target.images.splice(part + 1, 0, structuredClone(image()));
        part++;
      }
      if (action === "earlier" && part > 0) {
        [target.images[part - 1], target.images[part]] = [
          target.images[part],
          target.images[part - 1],
        ];
        part--;
      }
      if (action === "later" && part < target.images.length - 1) {
        [target.images[part], target.images[part + 1]] = [
          target.images[part + 1],
          target.images[part],
        ];
        part++;
      }
      if (action === "delete") {
        if (target.images.length === 1)
          throw new Error("Keep at least one page in the board.");
        target.images.splice(part, 1);
        part = Math.min(part, target.images.length - 1);
      }
      histories.clear();
      invalidateExport();
      refreshPartChoices();
      await Promise.all([persist(target, true), loadPart()]);
    },
  });
} else {
  document.body.classList.add("embedded-studio");
  $("conflict-copy").hidden = true;
}
await document.fonts.load('500 24px "Capture Inter"');
await document.fonts.load('600 28px "Capture Inter"');
if (embedded) {
  await openProject(embeddedGrant.projectId);
  await chrome.runtime.sendMessage({
    type: "CS_EMBED_READY",
    projectId: embeddedGrant.projectId,
    token: embeddedToken,
  });
} else if (suite?.handles(location.hash.slice(1))) {
  await suite.open(location.hash.slice(1));
} else if (location.hash) {
  try {
    await openProject(location.hash.slice(1));
  } catch (error) {
    fail(error);
    showHome();
  }
} else showHome();

$("stroke-size").addEventListener("change", () => {
  if (tool === "object-select" && selectedObjectIndex !== null) {
    const a = image().annotations[selectedObjectIndex];
    if (a && a.type !== "redact") {
      pushUndo();
      a.size = Number($("stroke-size").value);
      void changed().catch(fail);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    !embedded ||
    sender.id !== chrome.runtime.id ||
    message.type !== "CS_EMBED_FLUSH" ||
    message.projectId !== embeddedGrant.projectId
  )
    return;
  (async () => {
    if ((await finishText()) === false)
      throw new Error("Finish composing text before closing.");
    await flushSaves();
    if (failedSaves.has(project.id))
      throw new Error("Save your changes before closing.");
    return { ok: true };
  })().then(respond, (error) => respond({ ok: false, error: error.message }));
  return true;
});
