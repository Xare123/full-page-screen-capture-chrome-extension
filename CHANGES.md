# Capture Studio 3.0.0

- Keep live video advancing over static pages, including camera/ink changes. Wait for the first compositor frame, bound startup, permit cancellation and retain only valid recoverable chunks on failure.

- Add local screen/window/tab/region/camera recording with native consent, optional microphone/shared audio/camera bubble, pause/resume, live ink and source-page controls.
- Save recording chunks transactionally, recover committed portions, and clean up devices on cancellation, permission loss, failure or tab closure. Use worker frame composition when the studio is hidden.
- Add local video trim/mute/original restore, frame export, supported native WebM/MP4, and bounded animated GIF export.
- Bundle English, Spanish and Arabic OCR workers, WASM and pinned models; recognize only flattened redacted snapshots, with review, copy, text download and notes.
- Add separate 100-page whiteboards with templates, editable JSON, privacy-safe flattening, page management and progressive presentations; add notes with search/pins/Done/source links and optional browser reminders.
- Add configurable page tools, spotlight, pointer, fading ink, lesson reveal, clock/countdown, snapshot zoom, searchable guide and custom drawing keys.
- Add element capture, optional clean mode, completed-area Stop & edit and a document/project-scoped on-page region editor with tab fallback.
- Transfer on-page annotations into editable screenshot layers. Keep redactions opaque, include active drafts, mask thumbnails, and require studio-applied redaction for full/element captures; preserve visible/region mask layouts with Clean capture off.
- Add callouts, selection/movement/resizing/duplication/deletion for drawing objects, reversible backgrounds/browser frames and explicit sharing actions.
- Retain complete single-file image compression, all PDF sizes and local existing-PDF compression. Preserve existing capture data and permissions; reminders use optional alarms/notifications.

# Capture Studio 2.3.1

- Type and edit text directly on the image, with a native caret, selection, multiline input, paste and typing undo. Remove the text-entry modal.
- Default new text to locally bundled Inter, dark charcoal, and a transparent background. Change its font, size, foreground or background after placement; clear the background again at any time.
- Keep typing and style changes in one cancellable transaction. Commit before export, copy, transforms, or navigation; wait for the final input-method composition without losing clipboard activation.
- Match browser wrapping and full-paragraph Unicode direction during editing and export, including mixed-direction soft wraps and explicit overrides; preserve existing annotation layers and final redactions above active text.
- Retain movement, resizing, post-capture cropping, legacy project rendering, and the existing local-only permissions.

# Capture Studio 2.3.0

- Add adjustable post-capture cropping with preview, resize/move handles, precise bounds, Apply/Cancel and Undo.
- Make placed text selectable, movable, resizable and editable; add font-size, text color, background color, transparency and keyboard controls. Width wraps content and height expands to fit.
- Preserve annotation layers through crop and rotation, including older text and fractional saved-crop scaling. Keep Pan and native image context actions.
- Preserve actual redaction coverage through repeated transforms and bake existing masks before resampling. Block alternate copy/export paths while a crop is pending.
- Keep all runtime code local, with unchanged permissions and no new dependencies.

# Capture Studio 2.2.5

- Always export a single PNG, JPG, WebP or PDF file. Removed image ZIP output and its unused runtime dependency.
- Automatically fit a complete image to the largest safe uniform scale at or below the requested size. Show actual dimensions and effective scale, including internal fits below 1% for extreme pages.
- Preserve valid original tile placement. Edited or legacy parts with unavailable placement form one clearly labeled vertical composition in saved order, using the same scale with transparent or white padding.
- Fix fractional crop metadata being rounded twice in size previews; single-image planning and encoding now resize the original crop bounds once.
- Added systematic image/PDF compression regressions across supported input/output types, every size and quality setting, geometry limits, decoded edges, alpha/redactions, legacy edits, cleanup, navigation and one-file downloads.

## Capture Studio 2.2.4

- Export every original capture part as one complete image when the selected size fits safely. Whole-capture dimensions and shared rounded edges preserve proportions and the final row/column at fractional scales.
- Add a fit-to-one-image control that chooses the largest safe scale, from 1–100%. Larger exports retain all parts in a ZIP, with an explicit separate-parts option.
- Label the current editing part, complete export dimensions, ZIP fallback, and current/first-part copy actions. Opening another capture resets export scope to the complete capture.
- Preserve independently cropped or rotated parts as separate images; undo restores the original joining layout. PDF includes every selected part and uses the same resize dimensions down to 1%.
- Flatten edits before resizing, preserve PNG/WebP transparency, keep JPEG backgrounds white, and process one bounded source tile at a time with cleanup after failures. Export snapshots prevent navigation from changing a pending file or its filename/cache.

## Capture Studio 2.2.3

- Keep image context menus open after right-click release in Chrome 147, with explicit outside-click dismissal, keyboard navigation and focus restoration.
- Keep newly inserted fixed navigation at the correct page edge even when a website replaces the original node while capture is scrolling. Existing page content keeps its original document position.
- Exclude external top-layer dialogs, popovers and their independent backdrops from pane captures while preserving their open state and pane-owned surfaces.
- Track temporary style ownership across cloned DOM nodes, including delayed insertion, so replacement elements can recover their original styles and retain page-authored changes.
- Added broad fictional email, web-page, policy, image and PDF matrices, plus actual Chromium/Firefox/WebKit content-layout checks. Full extension testing uses real Chrome for Testing 147, Chrome Stable and Playwright Chromium executables; this does not introduce Firefox or Safari extension support.
- Added reproducible browser inventory/results, native screenshot scale/pixel oracles, failure captures and expanded CI verification. Test fixtures clean up browser profiles even when setup fails.

## Capture Studio 2.2.2

- Fixed horizontal lines at email capture joins caused by toolbar shadows and scroll-edge decorations spilling into the reading pane. Pane captures suppress surrounding overlay paint while retaining actual message borders, shadows, and generated content.
- Added paint-order checks for transparent panes so partial and nested backgrounds remain visible, even when a background child has a larger z-index inside a lower stacking context.
- Re-evaluate live computed styles, pane opacity, and pseudo-elements during scrolling. Toolbar replacement, updated classes/stylesheets, and opaque-to-transparent theme changes are handled during capture; page-authored opacity/shadow changes survive cleanup.
- Added native screenshot pixel comparisons, long-message boundary checks, fractional-scale capture, transparent/background controls, CSS replacement/theme changes, and exact restoration after success, cancellation, and failure. Two independent Astra reviews verified the corrections.

## Capture Studio 2.2.1

- Coalesced rapid autosaves, retained the latest redacted thumbnail through renames and part changes, and made failed writes retryable without false version conflicts. Conflict copies regenerate their flattened thumbnail.
- Removed hidden-library rebuilding during edits, reused the full-size render canvas, and exported unchanged full-size PNGs without decoding or re-encoding.
- Batched fixed-element layout operations, refreshed preparation timeouts for document captures, and normalized wide document scrolling for root/body RTL overrides.
- Validate document geometry and actual scroll positions around every screenshot, release capture canvases on failure, and honor cancellation or source-tab changes during final saving/checks.
- Locked PDF compression settings during work, added early cancellation checks, and bounded excessive PDF pagination while keeping tiny-width slices inside page margins.
- Added large-library/rapid-edit benchmarks, 24-megapixel imports, malformed and oversized files, PDF cancellation/recovery, RTL document pixel checks, fixed-heavy layouts, storage failure retries, and capture cancellation boundary regressions. Two independent Astra reviews verified the fixes.

## Capture Studio 2.2.0

- Added automatic detection of dominant scrolling reading panes for long emails and app layouts, while preserving ordinary document capture.
- Added **Full-page target** options: Auto, Main page only, and an accessible scrolling-area picker with pointer and keyboard controls.
- Stitch only the pane’s client area, with border/scrollbar exclusion, rounded screenshot edges, actual screenshot scaling, horizontal and RTL scrolling, and full-content export.
- Scoped sticky/fixed-bar handling to captured content, suppressed overlapping app overlays, preserved virtualized rendering, and primed lazy images without expanding the pane.
- Restore pane/ancestor/page scroll and exact inline declarations on success, cancellation, and failure. Validate target visibility, connectivity, geometry, clipping, content dimensions, and screenshot scale throughout capture.
- Added real-browser Gmail-style, virtualized, nested, RTL, lazy-image, high-DPI, restoration, selection, and failure regressions; two Astra implementation reviews and final reproduction checks.

## Capture Studio 2.1.0

- Fixed smart placement of viewport-fixed headers, bottom toolbars, and full-height sidebars. Sticky elements retain their flow and child positioning. Added a **Hide fixed bars** preference.
- Preserved fixed elements inside clipping ancestors, scaled widgets, closed offscreen drawers, scroll-triggered headers, and original inline CSS declarations during restoration.
- Restored native right-click image actions in Pan previews, plus full-resolution copy/save actions in the editor and library. Preview actions include flattened edits and redactions, including after rotate/undo/redo.
- Added automatic PDF paper/orientation recommendations and a live page estimate, 13 common paper formats, explicit orientation, and continuous image-sized pages.
- Added capture-pixel, CSS restoration, preview/clipboard, PDF media-box, and layout regressions; two further Astra reviews and verification.

## Capture Studio 2.0.0

- Rebuilt the extension for Manifest V3 with a full-screen local capture and editing studio.
- Added full-page, visible-area, and region capture with progress, delay, cancellation, restoration, and safe image splitting.
- Added a searchable local library, import, autosave, version conflict recovery, annotations, redaction, crop, rotation, undo, and redo.
- Added PNG/JPEG/WebP export and compression, multi-part ZIP export, paginated PDF export, and local PDF optimization/raster compression.
- Bundled all runtime dependencies locally. No accounts, payments, watermarks, telemetry, or cloud uploads.
- Added unit, browser, accessibility, and lifecycle regression checks; two Astra reviews and follow-up verification.
- Requires Chrome 147+. Incognito support is explicitly disabled.

## Original extension history

Screen capture your current page in entirety and reliably!

The simplest way to take a full page screenshot of your current browser window. Click on the extension in your browser bar (or press Alt+Shift+P), watch the extension catpure each part of the page, and be transported to a new tab of your image that you can right-click to save-as or just drag to your desktop. No bloat, just a simple way to turn a full web page into an image.

The only way to screenshot the entire page is to scroll to each visible part, so please be patient as it quickly assembles all the pieces. For the rare scenario where your page is too large for Chrome to store it in one image, it will let you know and split it up into just enough images in separate tabs.

This is an open source project. Visit the Full Page Screen Capture Github page for more information, bug reports, or to contribute:

https://github.com/mrcoles/full-page-screen-capture-chrome-extension

Change Log:

```
1.0.1 — 2016-05-14 — fix incognito mode "File not found" bug and better tab handling
1.0.0 — 2016-05-09 — this is a major release: introduces keyboard shortcut, splitting of images for pages that are too long, better handling of zoomed/emulator pages, more subtle gray icon, SVG support, and stability fixes (thank you @bluememory14, @BSierakowski, @denilsonsa, and all submitters of bug reports)
0.0.15 — 2015-04-05 — add timestamp to images so they are unique paths (via @HetIsNiels) and popup display fix
0.0.14 — 2015-02-14 — more “retina” fixes
0.0.13 — 2015-01-02 — remove scale feature to hopefully fix bugs experienced on “retina” displays
0.0.12 — 2014-08-24 — change permissions to more restrictive “activeTab”
0.0.11 — 2014-04-19 — backwards compatible permissions update
0.0.10 — 2014-04-17 — fixed permissions issue that prevents screen capture in Chrome 34
0.0.9 — 2013-12-08 — fixed bugs when the image is pieced together on retina screens
0.0.8 — 2013-11-17 — improved calculation of page width and height on non-standard pages
0.0.7 — 2013-10-10 — 10x speed improvement in capture time and restore to original scroll positions after capture (via @terrycojones)
0.0.6 — 2013-01-26 — Fixed scenario when captured image can load as a broken icon (caused by loading image before it has been written to the file system)
0.0.5 — 2013–01–21 — Fixed small bug in 0.0.4
0.0.4 — 2013–01–21 — Replaced deprecated BlobBuilder with Blob (via @gleitz)
0.0.3 — 2012-11-25 — Removed need to reload pages that were open before the extension is installed.
0.0.2 — 2012-11-21 — Better messaging for pages that can't be screen captured (e.g., content scripts cannot run on the chrome webstore), and the generated image now incorporates the URL into its name.
0.0.1 — 2012-11-06 — Initial release.
```
