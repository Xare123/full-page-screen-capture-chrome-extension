# Capture Studio

A free, private capture, recording and visual explanation studio for Chrome and Chromium browsers. Every included feature is available without an account, subscription, trial, watermark, or upload.

This is an independent modernization of Peter Coles’s MIT-licensed Full Page Screen Capture repository. The original license and attribution are retained. It does not contain or unlock the proprietary code from the current commercial extension.

## Install

Requires **Chrome 147 or newer** (or a compatible Chromium browser). The bundled PDF engine uses modern browser APIs.

1. Download the [v3.0.0 installation ZIP](https://capture-studio-free.xare123.chatgpt.site/downloads/capture-studio-3.0.0.zip) from the public website, or use the [GitHub releases](https://github.com/Xare123/full-page-screen-capture-chrome-extension/releases). Extract it. Development artifacts also remain in [GitHub Actions](https://github.com/Xare123/full-page-screen-capture-chrome-extension/actions/workflows/verify.yml); those downloads require sign-in. You can build from source below.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json` (or this repository’s `dist/` directory).
4. Pin Capture Studio in the browser toolbar.

To update an unpacked installation, replace the contents of the same installed folder, then click **Reload** at `chrome://extensions`. Keeping that folder preserves the extension identity and its local capture library. Close old studio tabs and reopen the studio after reloading. Refresh any webpages you want to capture to clear scripts from the previous version.

Click the extension icon on a webpage to capture the full page, the visible area, or a selected region. Keep the source tab active until the studio opens. Capture continues if the popup closes.

**Shortcuts:** `Alt+Shift+P` captures the full page; `Alt+Shift+O` opens the studio. On Mac use Option for Alt. Change assignments at `chrome://extensions/shortcuts` if another app has reserved them.

For long emails and app layouts, leave **Full-page target → Auto** selected. Full page captures an ordinary scrolling document, or detects a dominant reading pane when the main document barely scrolls. If several comparable panes exist, it asks you to choose. To select any pane yourself, set **Full-page target → Choose scrolling area**, press **Full page**, then click the highlighted message area. Tab/arrows switch candidates, Enter captures, and Escape cancels. **Main page only** captures the surrounding document instead.

## Included features

- Record a screen/window, browser tab, custom tab region or camera, with optional microphone, shared audio and a positioned camera bubble. Pause/resume, draw while recording and stop from the studio or page tools. Worker-based frame composition keeps running when the studio is hidden.
- Recording chunks save locally during capture. Recover saved portions after interruption; trim video, remove audio, restore original settings, save frames, or create a short GIF. WebM and browser-supported MP4 use native encoders. Original imports keep their file names.
- Extract text offline with bundled English, Spanish and Arabic OCR. Only a committed, flattened image with final solid redactions reaches recognition. Review/edit, copy, download text or save a note.
- Separate whiteboards with up to 100 pages per board, blank/grid/lined/planning templates, reusable text cards, page actions, progressive presentation and editable JSON import/export. JSON flattens every page containing redactions so hidden content is excluded.
- A searchable notebook with pins, Done, source links, plain-text/Markdown exports, conflict recovery and optional browser reminders. Notes and whiteboards remain separate.
- Page presentation tools: movable/dockable toolbar, horizontal/vertical layouts, three sizes, names/icons, searchable commands, effect toggles, clock/countdown, spotlight, pointer, fading ink, reveal masks and snapshot zoom. Escape restores page interaction. Customize drawing keys in Guide & settings.
- Element capture, optional clean capture, and Stop & edit for the completed rectangular area. Selected regions can open the scoped editor on the webpage, with a studio-tab fallback. On-page drawings transfer as editable layers; masks remain opaque and are excluded from fading effects.
- Select, move, resize, duplicate or delete drawing objects and callouts. Reversible backgrounds and browser frames preserve editable annotations. Explicit native file sharing and manual email/WhatsApp drafts supplement downloads; nothing is sent automatically.

- Full-page scrolling capture, horizontal overflow, lazy-content preparation, high-DPI/zoom scaling, bounded memory, and automatic splitting of oversized pages.
- Automatic nested-scroll detection for long emails and other reading panes, plus a manual scrolling-area picker. Captures stitch the selected pane’s full content, including horizontal/RTL scrolling, without repeating the surrounding application. Original pane, ancestor, and page scroll positions restore afterward. Sticky/fixed handling is scoped to the selected pane.
- Visible-area and drag-to-select region capture, an optional 3/5/10-second delay, progress, cancellation, and page restoration after success or failure.
- Smart placement keeps top bars at the top, bottom toolbars at the document bottom, sidebars along the document, and sticky content in its original flow. Choose **Hide fixed bars** in the popup for an unobstructed capture.
- A full-screen workspace with a searchable local library, thumbnails, renaming, import, deletion, autosave, zoom, pan, and keyboard controls.
- Versioned saves prevent two studio tabs from overwriting each other. If a capture changes or is deleted elsewhere, reopen the latest version or save your edits as a separate copy.
- Arrows, rectangles, ellipses, freehand drawing, editable text boxes, highlights, pixelation, solid redaction, numbered steps, adjustable post-capture crop, rotation, undo, and redo.
- Select placed text to move or resize it, edit its words, change font size or text/background colors, or use a transparent background. Width changes wrap text; height grows to fit. Keyboard selection and movement are available. Cropping and rotation preserve editable text and retain annotation layers.
- PNG, JPEG, WebP, and paginated PDF export. Image export always returns one file. All original capture parts join together, and a large image automatically shrinks uniformly to fit safe browser limits. The panel shows the actual output dimensions and effective scale when it differs from the requested size. Edited or legacy parts with changed/missing placement form a clearly labeled vertical layout at a shared scale.
- Import PNG, JPEG, WebP, GIF, or AVIF images. Resize from 1–100% and adjust JPG/WebP quality from 35–100%; quality does not change dimensions. The internal automatic fit can go below 1% for extreme pages. Dimensions round to whole pixels, so very small outputs lose detail. **Check export size** measures the actual encoded file. **Complete capture** includes every part; **Current part only** deliberately saves the selected part.
- Automatic PDF paper and orientation recommendations based on image dimensions, readable sizing, and page count, with a live layout summary. Override with US Letter, Legal, Tabloid/Ledger, A3–A6, ISO B4/B5, Executive, Half Letter, or 4×6/5×7 photo paper. Choose **Image-sized** for one continuous PDF page per capture part; optional source/page footers work with every layout.
- Existing PDF optimization that preserves text and vector content, or raster compression with resolution/quality controls. Results show real byte savings; if a result would grow, the original is kept.
- Batch image import, drag-and-drop, full-resolution clipboard copying, responsive desktop/tablet layouts, reduced-motion support, and keyboard-accessible dialogs. Right-click the preview in **Pan** mode for the browser’s image menu, or right-click an editing canvas/library thumbnail for **Copy image** and **Save full PNG**. These actions include current edits and solid redactions.

Solid **Redact** regions render last, including over later pixelation. Exports contain flattened pixels, without editable annotation layers or hidden source images. Pixelation is a visual effect; use solid redaction for sensitive details. Editable originals remain in the browser library until deleted.

## Crop and edit text after capture

Open a capture from the local library. Choose **Crop** (C), drag an area, then adjust its edges or X/Y/Width/Height fields. Choose **Apply crop** to save it, or **Cancel crop**/Escape to leave the pixels unchanged. Copy/export waits until a pending crop is applied or cancelled. Cropping edits the current capture part; Undo restores the previous pixels during the current session.

Choose **Text** (T), click the image, and type directly on it. New text uses locally bundled Inter, dark charcoal, and a transparent background. **Enter** inserts a new line; **Ctrl/⌘+Enter**, **Done**, or clicking outside finishes the edit. **Escape** or **Cancel** discards that typing session. Text and style changes within a session become one editor Undo entry; typing keeps the browser’s native undo/redo. **Select text** (S), or the text-box selector, selects an existing box. Drag to move it, drag its handles to resize/wrap, and use **Edit text** or double-click to change the words. Font, Color, and Text size control the selected text. Background adds a color, and Transparent clears it again; both remain editable after placement. Width and Height accept precise dimensions, and Center brings a clipped box back into view. With the canvas focused, arrows move selected text (Shift moves 10 pixels), Enter edits it, and Delete removes it. **Pan** (V) retains native image context actions.

## Build and test

Node.js 22+ and Python 3 are required. Dependencies and browser binaries are downloaded during development; the installed extension works offline.

```sh
npm ci
npm run build
npx playwright install chromium
npm run verify
npm run package
```

`npm run package` creates a ready-to-extract ZIP under `release/`. All runtime dependencies, PDF workers, fonts, character maps, decoders, and third-party licenses are bundled in `dist/`. No CDN is required.

The Playwright suite loads the real Manifest V3 extension into Chrome for Testing. Its isolated test copy adds test-only host access (with browser networking restricted to localhost) to simulate the `activeTab` permission normally granted by the user clicking the extension action. The release manifest contains no host permissions. Tests verify real stitched screenshot pixels, Gmail-style long reading panes, nested and virtualized content, horizontal/RTL scrolling, fixed/sticky bar placement and restoration, redaction pixels, native preview and full-image context actions, transforms, navigation/autosave, file signatures and dimensions, PDF page counts and paper dimensions, compression, cancellation, capture locking, region selection, and responsive layouts. These are browser viewport tests, not physical-device tests or a live private Gmail account test.

See [the implementation review](docs/REVIEW.md) for the legacy audit, architecture, review findings, and validation notes.

## Privacy and permissions

Capture, recording, OCR, editing, compression, notes and storage happen in this browser profile. There are no analytics, cloud services, accounts, payment checks, or external runtime requests.

| Permission                          | Purpose                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `activeTab`                         | Capture the tab you explicitly invoke the extension on.                                                      |
| `scripting`                         | Temporarily scroll and prepare that page; restore it afterward.                                              |
| `storage`                           | Capture status and preferences.                                                                              |
| `unlimitedStorage`                  | Store large captures locally in IndexedDB without the normal extension quota. Device capacity still applies. |
| Optional `alarms` / `notifications` | Schedule a local browser reminder only when the user chooses one.                                            |
| `clipboardWrite`                    | Copy a flattened PNG when you press **Copy image**.                                                          |

Your local workspace is not a backup. Export files you want to keep. Clearing extension data, deleting a browser profile, or uninstalling removes locally stored captures. Exported images and PDFs contain flattened pixels, not an editable project backup.

## Practical limits

- Screen, camera and microphone recording uses the browser's native chooser/consent. Shared audio and MP4 depend on browser/platform support; protected media may be blank. This is not a multitrack video editor. Trims export in real time; edited video output is bounded to 512 MB, and GIFs to 20 seconds/240 frames. Original recording chunks remain available.
- A closed, sleeping or permission-revoked browser can delay reminders. They are local notifications, not email or synchronized reminders. Clearing browser data removes recordings, notes and boards too.
- Apply solid redaction after a full-page/element capture in the studio. On-page solid masks are supported for visible-area and selected-region captures with Clean capture off; those captures preserve the current layout. This boundary prevents scrolling or layout preparation from moving content outside a mask. The embedded editor authenticates one source document and capture, and cannot enumerate the library.

- Chrome blocks capture scripting on browser settings, the Web Store, other extensions, and some built-in viewers. For `file://` pages, enable **Allow access to file URLs** in extension settings.
- Incognito mode is explicitly disabled; captures are supported in regular browser profiles only.
- Automatic target detection favors a large reading pane over navigation lists when the root document barely scrolls; it preserves document capture when the main page scrolls normally. Choose a scrolling area explicitly when needed. Detection traverses the top-level DOM; nested scrollers inside frames or shadow roots are not traversed. Open embedded content in its own tab or use visible-area/region capture.
- A scrolling pane must fit within the visible viewport and its clipping ancestors after automatic ancestor scrolling. Partly clipped, scaled, rotated, or custom-masked panes stop with an explanation. Resize/reset the layout or choose visible-area capture. Pane capture also stops if the target disappears, becomes hidden, moves, or changes content size during stitching; it retains no incomplete image.
- Smart bar placement uses layout heuristics; unusual page layouts can use **Hide fixed bars**, visible-area capture, or a region instead.
- Pane capture examines the current DOM, computed styles, and stacking order as it scrolls. It removes surrounding toolbar paint and scroll-edge shadows from the captured content while retaining the message's own decoration. Temporary style snapshots exist only to undo capture changes; there are no stored Gmail/Outlook class names or site CSS templates.
- Lazy content is primed over a bounded pass. Infinite feeds, page navigation, resizing, zoom changes, or switching the active source tab can stop a capture. Use a region for exceptionally dynamic pages.
- Captures are limited to 120 megapixels and 160 viewports; each editable part is at most 24 megapixels and 16,000 pixels per side. Image imports use the same per-part limits. Input files are limited to 100 MB; GIF imports use a single frame.
- Standard-paper PDF exports are limited to 500 pages. For exceptionally narrow or long images, choose **Image-sized** pages or crop a smaller area. A cancelled capture that has already finished saving remains available in the library without opening an editor.
- PDFs with passwords must be unlocked before import. Raster compression supports up to 300 pages and removes searchable text, links, form fields, annotations, and signatures. Content-preserving optimization can invalidate digital signatures, and already optimized files may not shrink. Keep originals when document fidelity or signatures matter.
- Undo/redo history lasts for the current editing session. Crop and rotation preserve editable annotation layers, and saved text can still be selected after reloading. Redactions are also baked into the transformed base to preserve coverage. Export important originals before transforming them.

## Test coverage

See [Testing](docs/TESTING.md) for the email, web-page, image/PDF, policy and browser-version matrices, native pixel checks, and reproducible commands. Browser-engine layout checks are distinct from full extension support.

## License

MIT. Original capture extension © 2012–2013 Peter Coles. See [LICENSE](LICENSE). Bundled dependency notices are generated in `dist/THIRD_PARTY_LICENSES.txt`.
