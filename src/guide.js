import { el, button, field } from "./suite-ui.js";
export const GUIDE = [
  [
    "Capture",
    "Open New capture for full pages, the visible area, a selected rectangle or a page element. Automatic detection finds scrolling email and app panes. Choose a pane explicitly when a page has several. Stop & edit keeps the completed rectangle; Cancel discards the attempt. Protected browser pages and unloaded virtual content cannot be captured.",
  ],
  [
    "Edit objects",
    "Use Select objects to move or resize drawings, text, callouts and numbered steps. The object list also selects small marks. Duplicate and Delete act on the selected object. Text can be edited directly on the image. Undo and Redo keep changes reversible.",
  ],
  [
    "Text and privacy",
    "Text starts with a transparent background and a locally bundled Inter font. Change text color, font and background after placement. Solid redactions draw last in every export. Pixelation is a visual effect; use solid redaction for private content.",
  ],
  [
    "Compression and PDF",
    "PNG, JPG and WebP exports always contain the complete image with one uniform scale. Very long captures fit safely within browser limits. PDFs offer automatic paper selection, 13 common sizes and continuous image-sized pages. Image compression downloads the actual file.",
  ],
  [
    "Recording",
    "Choose a screen/window, tab, tab region or camera. The browser asks for permission. Microphone, shared audio and camera bubble are optional. Use Pause, Resume and Stop. Chunks are saved locally during recording; interrupted sessions can recover their saved portion. Closing the studio ends recording. Browser and OS controls may differ.",
  ],
  [
    "Video editing",
    "Select a saved or imported recording. Set trim start/end, remove audio, restore the original, or save a current frame. Trim export plays the selected clip in real time. WebM and MP4 availability depends on the browser encoder. GIF exports use an explicit shorter clip and smaller size.",
  ],
  [
    "Extract text",
    "OCR runs locally using bundled English, Spanish or Arabic models. Apply or cancel a pending crop first. Only the visible, flattened, redacted image is recognized. Review the text, edit it, copy it, download .txt or keep it as a note. Recognition may need corrections.",
  ],
  [
    "Whiteboards",
    "Create reusable boards with up to 100 pages. Choose blank, grid, lined or planning templates; add direct text and drawings. Add, duplicate, reorder or delete pages in the editor. Export images/PDF or an editable board JSON. Pages with redactions are flattened in JSON so hidden content is excluded.",
  ],
  [
    "Notes and reminders",
    "Notes support search, pinning, Done and source links. Reminders request browser notifications only when you choose Set reminder. They are device-local; a closed or sleeping browser can delay them. Notes are separate from whiteboards.",
  ],
  [
    "Present on a page",
    "Open Page tools from the extension popup. Draw, add steps, highlight, use a spotlight, pointer, fading ink or lesson reveal. A clock/countdown is optional. Search More for commands. Active tools turns individual effects off; Reset effects retains drawings. Escape or double-click blank space restores page interaction.",
  ],
  [
    "Zoom and toolbar",
    "Snapshot zoom works on a captured viewport, including canvas charts. Scroll or resize ends zoom. Choose horizontal/vertical layout, three sizes, names/icons, floating or docked position. Drag empty toolbar space, or minimize it to a launcher.",
  ],
  [
    "Share",
    "Download or copy your work, use the browser's native file sharing when available, or open an email/WhatsApp draft. You choose recipients and attach the file. Nothing is sent automatically. A Google Drive OAuth integration is not configured.",
  ],
  [
    "Keyboard shortcuts",
    "The studio drawing keys are configurable below. Browser action shortcuts are configured at chrome://extensions/shortcuts. Inputs and text composition retain normal typing. Full screen is available in the top bar.",
  ],
  [
    "Local files and recovery",
    "No account, telemetry, cloud OCR or paid tier is required. Captures, notes, boards and recordings remain in this browser profile. Export important work before uninstalling or clearing browser data. Saved recording chunks recover completed data, not an ongoing stream after a crash.",
  ],
];
export async function mountGuide(
  root,
  { fail, toast, defaultKeys, updateKeys },
) {
  const search = el("input", {
      type: "search",
      placeholder: "Search tools, shortcuts, troubleshooting…",
    }),
    list = el("div", { className: "guide-list" });
  const render = () => {
    const query = search.value.toLocaleLowerCase();
    list.replaceChildren(
      ...GUIDE.filter((pair) =>
        pair.join(" ").toLocaleLowerCase().includes(query),
      ).map(([title, text]) =>
        el("article", {}, el("h2", {}, title), el("p", {}, text)),
      ),
    );
  };
  search.addEventListener("input", render);
  const settings = el(
      "details",
      {},
      el("summary", {}, "Customize drawing keys"),
    ),
    saved = (await chrome.storage.local.get("drawingKeys")).drawingKeys || {},
    inputs = {};
  for (const [tool, key] of Object.entries(defaultKeys)) {
    inputs[tool] = el("input", {
      value: saved[tool] || key,
      maxLength: 1,
      ariaLabel: `Shortcut for ${tool}`,
    });
    settings.append(field(tool, inputs[tool]));
  }
  settings.append(
    button("Save keys", async () => {
      try {
        const keys = Object.fromEntries(
          Object.entries(inputs).map(([tool, input]) => [
            tool,
            input.value.toLowerCase(),
          ]),
        );
        if (
          Object.values(keys).some((key) => !/^[a-z0-9]$/.test(key)) ||
          new Set(Object.values(keys)).size !== Object.keys(keys).length
        )
          throw new Error(
            "Use a different single letter or digit for each tool.",
          );
        await chrome.storage.local.set({ drawingKeys: keys });
        updateKeys(keys);
        toast("Drawing shortcuts saved.");
      } catch (error) {
        fail(error);
      }
    }),
    button("Reset keys", async () => {
      await chrome.storage.local.remove("drawingKeys");
      updateKeys({});
      for (const [tool, key] of Object.entries(defaultKeys))
        inputs[tool].value = key;
      toast("Default shortcuts restored.");
    }),
  );
  root.replaceChildren(
    el(
      "div",
      { className: "suite-heading" },
      el(
        "div",
        {},
        el("h1", {}, "Your studio guide"),
        el("p", {}, "Every tool, no subscriptions. Search for what you need."),
      ),
      button("Replay tips", async () => {
        await chrome.storage.local.remove(["tipWhiteboard", "tipClock"]);
        toast("Tips will appear when you next open a whiteboard or clock.");
      }),
    ),
    search,
    list,
    settings,
  );
  render();
}
