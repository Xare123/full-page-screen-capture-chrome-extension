# Implementation review

## Legacy code audit

Reviewed the original manifest.json, api.js, page.js, popup.js, popup.html, archive script, documentation, license, and issue template. Original baseline: d1b6bbb.

The 2016 extension used Manifest V2, chrome.tabs.executeScript, and deprecated temporary filesystem URLs. Capture depended on popup lifetime, listeners accumulated between runs, screenshot errors could leave callbacks unresolved, and timeouts could restore a page while capture continued. URL rejection did not terminate execution. Incognito output escaped into a regular window. Canvas allocation was only partially bounded. There was no editor, library, compression, PDF support, automated validation, or accessible full-screen workspace.

The replacement retains the MIT license and attribution, replaces the obsolete runtime, and implements its own local workflows. It includes no proprietary premium source or payment bypasses.

## Architecture

- **Manifest V3 service worker:** explicit capture lock, per-window screenshots, active-tab checks before and after capture, rate limiting, actual screenshot scale measurement, bounded tile allocation, local persistence, progress/error state, cancellation, and cleanup.
- **Temporary content script:** region selection in an isolated shadow tree; bounded lazy-content pass; animation/smooth-scroll preparation; normal-flow sticky content; document-anchored fixed bars or optional hiding; restoration and watchdog cleanup. Session checks prevent continuation after cancellation.
- **Scroll targets:** automatic dominant-pane detection on app-style pages and a shadow-tree picker, with document capture preserved for normally scrolling pages. Browser viewport dimensions remain separate from capture viewport dimensions. Every pane frame reports actual normalized scroll offsets and a validated client-box source crop; background rounds source/destination edges and stitches only that crop. Target and ancestor scroll positions restore on every exit.
- **IndexedDB:** full projects and compact summary records in atomic transactions. Browsing the library does not decode every full-resolution capture.
- **Studio:** canvas layers, full-resolution native image preview in Pan mode, flattened clipboard/context actions, solid redaction after all other annotations, blob-backed undo/redo, immediately queued autosave, guarded async image loading, keyboard shortcuts, and inert controls during raster/export operations.
- **Compression:** local browser encoders for PNG/JPEG/WebP; locally bundled PDF-lib and PDF.js for paginated or image-sized export, structural PDF optimization, and optional rasterization. A shared PDF layout planner drives paper/orientation recommendations, live page estimates, and exported dimensions. Actual before/after sizes; original PDF fallback if encoding grows it.
- **Packaging:** reproducible npm lockfile, esbuild bundles, local PDF assets, MIT attribution, and dependency license notices. Release manifest has no host access, external scripts, or network service configuration.

## Astra review 1

Astra completed a read-only review of every implementation source file, manifest, build scripts, and package configuration. It identified:

| Finding                                                                     | Resolution                                                                                                                              |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation before thumbnail work registered a save could discard edits.     | Queue the complete save operation synchronously, capturing the project snapshot before thumbnail work. Navigation waits for that queue. |
| Async part decoding could display a previous image after navigation.        | Capture image identity and reject stale completions with a generation counter.                                                          |
| Standard PDF.js 6 needs newer browser APIs than the original minimum.       | Require Chrome 147+, including Math.sumPrecise and Map insertion APIs.                                                                  |
| Hiding all sticky elements removed uncaptured content.                      | Preserve sticky elements in normal document flow and restore their original inline position declarations.                               |
| Cancellation during final preparation delay could scroll after restoration. | Verify the exact live preparation session after awaits and before further scrolling.                                                    |
| Concurrent start requests could pass the capture lock.                      | Reserve the job synchronously before the first awaited tab query.                                                                       |
| Busy overlays allowed underlying keyboard navigation.                       | Make the main workspace and sidebar inert during exclusive operations.                                                                  |
| Helper text was too small and low contrast.                                 | Increase functional text sizes and darken helper, status, export, and redaction labels.                                                 |

## Astra review 2

Astra performed a second independent code review, then verified the fixes below. The follow-up verification found no additional release blocker in these changes, conditional on the final test suite passing.

| Finding                                                                                                          | Resolution                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Concurrent editor tabs could overwrite newer edits or recreate a deleted capture.                                | Added atomic IndexedDB revision checks; updates reject missing records. A persistent conflict state blocks retries and offers explicit recovery as a new capture with a new UUID. Deletion is broadcast to other studio tabs. |
| Previous pixels remained interactive while another project or part decoded.                                      | Disable the editor, clear active gestures, hide the old stage, and release only the matching loading generation.                                                                                                              |
| Default spanning incognito semantics could persist private captures in regular storage and fail to open results. | Explicitly disable incognito in the manifest and document regular-profile support.                                                                                                                                            |

Regression coverage includes two studio tabs, stale saves, deletion, explicit copy recovery, silent revision/deletion changes without broadcast (exercising transactional checks directly), deferred image decoding, and tab-close protection for failed saves.

Astra’s final verification sign-off: all three P2 findings are resolved; no material release blockers remain.

## Version 2.0 validation

- `npm run verify`: **10 unit tests and 12 real Chromium browser scenarios passed**. Browser suite: 43 seconds.
- WCAG A/AA automated checks passed for the workspace, editor, and PDF dialog.
- Browser scenarios verify full-page stitching against actual pixels, preservation/restoration of sticky content and scrolling, visible/region capture, cancellation, capture locking, actual oversized capture splitting and ZIP output, emulated device-pixel ratio against native screenshot dimensions, redaction flattening, crop/rotate/undo/redo, autosave/reload, multi-tab conflicts and recovery, deferred decoding, clipboard, fullscreen, PNG/JPEG/WebP/PDF output, real PDF size reduction and page counts, responsive layouts, local deletion, and absence of external studio requests.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- Release permissions checked independently: Manifest V3, Chrome 147+, no host permissions, no external messaging entrypoint, local-only network policy, and incognito explicitly disabled.
- Ready-to-load extension ZIP includes all runtime assets, installation documentation, original MIT attribution, and bundled dependency licenses.

## Version 2.1 follow-up reviews

Two further Astra reviews covered the sticky/fixed-bar corrections, native preview/context actions, and new PDF layouts. The first found dynamically pinned headers missed after preparation, transformed widgets using already-scaled dimensions, lost margin declarations, and preview invalidation after rotation/undo. The implementation now detects newly fixed elements on each capture scroll, retains original flow slots, sizes transformed elements from their untransformed border boxes, restores original declarations, and refreshes the guarded native preview after edits.

The second independent review reproduced three more capture cases: fixed bars clipped after conversion to absolute positioning, CSS-variable shorthands lost on restoration, and closed offscreen drawers expanding the capture. Fixes keep viewport-fixed positioning with document-anchored scroll compensation, preserve serialized shorthand declarations and unrelated page changes, and temporarily hide fully offscreen fixed elements. A final scaled-ancestor reproduction led to including individual CSS scale/rotate/translate properties in fixed-containing-block detection, alongside transforms, filters, containment, and content visibility.

Astra re-ran isolated Chromium reproductions and verified every finding, including scaled ancestors and concurrent unrelated inline-style changes. Final judgment: all reported findings resolved, no remaining release blockers, conditional on the full suite passing. No additional actionable PDF, clipboard, preview, or restoration issues remained.

The follow-up regressions check actual captured pixels for top/bottom bars, full-height sidebars, overflow-clipped wrappers, dynamically pinned headers, end-of-document scroll clamping, scaled widgets and ancestors, sticky children, and offscreen drawers. They also verify exact CSS restoration with variable shorthands and quoted semicolons, full-resolution flattened preview/clipboard/context exports after edits and undo, standard PDF media boxes and orientations, continuous image-sized pages, and page-count estimates.

## Version 2.1 final validation

- `npm run verify`: **15 unit tests and 18 real Chromium browser scenarios passed**, including all earlier lifecycle, accessibility, capture, and compression regressions. Browser suite: approximately one minute.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- Prettier checks and `git diff --check` passed.
- Release 2.1 preserves the original permissions and local-only policy. The ZIP includes installation/update instructions, this review, changelog, license, and all runtime assets.

## Version 2.2 scroll-pane reviews

Astra first reviewed the design for long-email capture, then two independent implementation reviews examined target selection, cropping, scroll/stylesheet restoration, fixed and sticky descendants, visibility, clipping, cancellation, horizontal/RTL geometry, and lazy/virtualized content. The implementation keeps the browser viewport separate from the captured pane viewport and preserves normal scrolling/rendering rather than expanding email content into the document.

The first implementation review reproduced false clipping rejection for viewport-fixed panes inside short overflow ancestors, acceptance of hidden panes, and cancellation gaps before selection/preparation. The fixes account for out-of-flow containing blocks when applying overflow clips, check actual visibility on detection and every frame, and check the active capture immediately before each selection/preparation call. A real isolated-world Chromium reproduction found pending CSSOM serialization recreating an originally absent style attribute; flushing that serialization before removal now restores the exact original attribute.

The second review reproduced blank bands from paint containment that did not set an overflow clip. The pane geometry now intersects paint/strict/content containment and content-visibility paint bounds. It rejects incomplete clipping and unsupported custom masks clearly, while preserving original scroll and inline declarations. Final screenshot bitmap dimensions are also checked against the measured capture scale.

Both reviewers re-ran their isolated Chromium cases and verified the fixes, including ordinary and transformed containing blocks, variable-based border radii, pane and ancestor scrolling, missing style attributes, invisible content, paint containment, and picker click-through prevention. Both final judgments found no remaining release blocker, conditional on the final full suite passing. A final popup lifecycle review confirmed that errors remain visible and the popup closes when selection is ready, while reopening it preserves cancellation controls.

The new browser scenarios use a local Gmail-style shell with a longer scrolling navigation list and a dominant 36-section message pane. They check every message section and the final row, scoped sticky/fixed bars, full client-box cropping, exact style/scroll restoration, manual selection of a smaller pane, comparable-pane keyboard selection, horizontal/RTL edges, virtualized rows, nested reading areas, lazy-image decoding, fractional/high-DPI crops, cancellation, hidden/growing targets, and explicit clipped/scaled/masked failures. No private email account was accessed.

Auto excludes known navigation/menu/aside panes while the manual picker retains them. A short-email regression verifies that a scrolling folder list alone preserves full-document capture. The sticky-bar fixture records normal-flow geometry before its scroll handler pins a header, so its pixel assertions do not depend on event timing.

## Version 2.2 final validation

- `npm run verify`: **16 unit tests and 32 real Chromium browser scenarios passed**, including 14 pane-capture scenarios and all earlier regressions. Browser suite: 2.4 minutes.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- Prettier checks and `git diff --check` passed.
- Both Astra implementation reviews and follow-up Chromium reproductions found no remaining release blockers.
- Release 2.2 keeps the existing permissions and local-only policy. Packaging compares bundled runtime hashes with the tested build and validates ZIP integrity, complete assets, versions, and bundled documentation.

## Version 2.2.1 stress and performance review

Two independent Astra reviews examined capture preparation, complex layouts, cancellation and source-tab changes, autosave ordering, large libraries, image rendering, and PDF export/compression. Both reviewers reproduced the relevant failures before changes and verified the corrections afterward. Neither found a remaining release blocker in the reviewed scope, conditional on the full regression suite passing.

The final stress work addressed:

- **Save ordering and redaction:** queued saves coalesce to the latest complete snapshot. First-part thumbnail generations stay associated with their rendered edits through renames and edits in other parts. The project revision advances only after the IndexedDB transaction commits. A failed write can be retried, while transactional checks still protect edits from another tab. Recovery copies regenerate a flattened thumbnail.
- **Rendering and library work:** unchanged full-size PNG exports reuse the stored PNG bytes; identity renders reuse their first canvas, avoiding a second full-resolution buffer. Own-save notifications no longer rebuild the library, and hidden library cards/object URLs are released. The library is refreshed on navigation.
- **Capture robustness:** full-document capture now validates dimensions and actual normalized scroll offsets before and after screenshot acquisition, as pane capture already did. Document scrolling follows the body's effective viewport direction, including root/body RTL overrides. Fixed-element writes, rectangle reads, and correction writes are batched. Both prewarm paths refresh the restoration watchdog. All allocated capture canvases are released after success or failure.
- **Final cancellation boundaries:** cancellation and source-tab state are checked after committing a capture, after asynchronous tab queries, and immediately before opening the editor. A fully committed capture remains in the library if cancellation arrives during saving; it does not open an unwanted editor.
- **PDF limits and consistency:** compression settings stay locked during work; aborts are checked before decoding and after encoding. Standard-paper exports exceeding 500 pages stop before image rendering, with guidance to use image-sized pages or crop. Even a one-pixel-wide raster row fits within the page's printable height.

### Measured workloads

| Workload                                             | Original 2.2.0                                                                  | Hardened implementation                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 20 quick edits, 7.2MP image, 501 stored projects     | 4,509ms; 20 bitmap decodes and thumbnail encodes; 10,020 hidden cards inserted  | 130–137ms; one decode, thumbnail encode, and project write; zero hidden cards inserted         |
| 1,500 viewport-fixed elements in a 22,503px document | Preparation cancelled itself after about 15.9 seconds                           | Preparation completed in 3.4–3.5 seconds; all original style attributes and scrolling restored |
| Scroll in the same fixed-heavy document              | 2,249ms in a prototype that only prevented the timeout/skipped identical writes | 277–298ms with batched layout work                                                             |
| Unedited PNG export at original size                 | Full bitmap decode, render, and PNG encode                                      | Zero decodes/encodes; SHA-256 identical to the stored PNG                                      |

These are bounded local Chromium measurements, not universal speed guarantees. The fixed-heavy prototype timing is explicitly distinct from the original build, which could not complete preparation. Automated assertions use operation counts and correct output rather than tight timing thresholds. Raw results are emitted to `artifacts/stress-performance.json` and `artifacts/fixed-layout-performance.json` by the stress suite.

Permanent regressions additionally cover a delayed redaction thumbnail followed by rename/part changes, transient storage failure and retry, changed document size during screenshot acquisition, cancellation/navigation/tab closure during saving, cancellation during the final tab query/status write, every root/body RTL override, repeated PDF start/cancel with no surviving PDF workers, malformed PDFs, maximum 24MP editing/export, malformed images, overwide images, 100MB file rejection, and oversized import batches. Independent Astra checks also verified delayed-save navigation, competing-tab conflict copies with redactions, and 1,092 PDF layout combinations.

Final `npm run verify`: **21 unit tests and 43 real Chromium browser scenarios passed**. The browser suite completed in 2.9 minutes, including all earlier accessibility, capture, lifecycle, pane, preview, and export cases. Version 2.2.1 preserves the release permissions, IndexedDB schema, and local-only workflow.

## Version 2.2.2 pane-paint and live-style review

User-supplied Gmail captures showed a thin line crossing the message at successive viewport boundaries and the final overlapping frame. Two independent Astra investigations reproduced the same mechanism in Chromium: toolbar shadows can spill beyond their elements' border boxes into a reading pane. The earlier overlay check missed that paint, so each screenshot could stamp it into the email. Ancestor edge pseudo-elements, pane inset shadows, and viewport-anchored generated decorations also reproduced the line.

The correction derives its behavior from the current DOM, computed styles, containing blocks, and stacking order. It contains no Gmail/Outlook class names, stored site stylesheet, or per-provider capture template. Before each paint pass it releases earlier suppression and reclassifies the live page. Temporary snapshots exist for cleanup, and page-authored opacity/shadow changes during capture survive restoration.

- Opaque panes composite-hide external sibling branches without changing layout. This excludes shadow/filter/pseudo paint and children that override inherited visibility.
- Transparent panes retain partial backgrounds and entire stacking contexts behind the pane. A child with `z-index:999` cannot escape a lower parent context. Foreground toolbar paint is removed independently.
- Thin ancestor edge decorations and pane inset shadows are suppressed. Sticky generated content returns to its normal flow. Empty thin fixed/absolute pseudo-elements are suppressed only when anchored outside the captured scrolling content; genuine dividers and generated message text remain.
- Original styles and existing marker attributes restore after success, cancellation, and geometry errors. Scoped pseudo rules are refreshed when CSS changes, and page-updated styles remain intact.

Both Astra reviewers independently verified the final code. Their reproductions included toolbar replacement, new stylesheets/classes, opaque-to-transparent themes, generated content changing from an overlay into normal-flow text/background, page-authored opacity and shadow updates, nested background stacking contexts, and containing blocks moving inside the pane during capture. No remaining release blocker was found in the reviewed scope.

The permanent pane-paint regressions compare exported pixels directly with native browser screenshot strips, verify every boundary in longer messages, preserve actual card shadows/borders/dividers, exercise fractional pane edges at 1.25× screenshot scaling, and check cleanup after cancellation/failure. The fixtures use fictional content. The available tools did not expose the user's local browser-control connection, so authenticated Gmail and Outlook tabs were not inspected; the correction is verified against reproduced layouts rather than those live accounts.

Final `npm run verify`: **21 unit tests and 60 real Chromium browser scenarios passed**, including **17 pane-paint regressions**. The browser suite completed in 4.3 minutes. Prettier checks and `git diff --check` passed; the production dependency audit reported **0 vulnerabilities**. Both independent Astra approvals apply to the final runtime source. Version 2.2.2 preserves the release permissions and local-only workflow.

## Version 2.2.3 expanded matrix and ownership review

The expanded suites exercise fictional receipts, newsletters, statements, conversation threads, RTL and mixed-direction messages, dark themes, gradients, attachments, nested readers, articles, stores, dashboards, documentation, forms and wide tables. Workflow cases cover five image formats, alpha/quality/scaling, all 13 included paper formats, continuous pages, redaction, malformed inputs and compression. Policy cases run real nonce CSP, style-attribute restrictions and Trusted Types in an MV3 isolated world.

Four confirmed failures were corrected:

- External modal dialogs and popovers escape ordinary ancestor stacking/opacity suppression, and their independent backdrops can darken an otherwise clean pane. Each external top-layer surface and backdrop is temporarily suppressed without closing it; pane-owned or containing surfaces remain intact.
- A replacement fixed navigation node first observed while prewarming was anchored at the current scroll offset, stamping a bar/shadow near a later viewport join. New fixed nodes now use first-viewport coordinates; known normal-flow and absolute page content keeps its measured document anchor.
- A site cloning temporarily styled nodes could inherit capture placement and paint markers as its apparent original state. Session-scoped ownership revisions now restore in-session shallow/deep/delayed clones from their exact earlier baseline, preserve author changes across subsequent placement, and drain pending insertions on cancellation/restoration.
- Chrome 147 immediately dismissed an auto-popover menu on the same right-button release that opened it. The image menu now uses manual dismissal, explicit outside-pointer handling, Escape/Tab closure and opener focus restoration. Menus close during image/PDF imports, busy operations and navigation, and clipboard work checks the busy lock before starting.

Two independent Astra reviewers investigated and approved final content-source SHA-256 `36cf780e5f349b8c1295931633f613e5b50c69a0f9af701df7539202b4477c39`. Both reviewed the live top-layer behavior, new fixed anchors, property/shorthand restoration, historical clone snapshots, authored changes and marker cleanup. Novel independent probes also ran in Chromium, Firefox and WebKit. Their release signoffs were conditional on the centralized final matrix passing.

Both reviewers separately approved final app-source SHA-256 `bf71277c6128159c5288c809dc37f5b0b6b421477be9ad67506634486f000caf` and HTML SHA-256 `47414ce9c110421f0ab84cd4c35f15ea7755cb2810b498b3cfe4c9ee49bb76a7`. Independent Chrome 147 and Chromium probes verified menu release persistence, native Pan context actions, arrow/Home/End navigation, Escape/Tab/Shift+Tab, hotkey isolation, keyboard Save and library Open. All 18 focused regression checks across the three Chrome versions passed, including held image decode and PDF file drops. The shared existing behavior of returning focus to the document body after a busy keyboard Save remains a nonblocking observation.

Capture uses the current DOM, scroll geometry, computed styles and paint order. It does not depend on Gmail/Outlook class names or stored website CSS templates. Style snapshots are temporary restoration metadata for the active session; live author changes are rebased rather than blindly overwritten.

The ownership observer exists only during capture. A detached clone held by site JavaScript and first inserted after the session ends cannot be cleaned without retaining permanent page hooks. This boundary is distinct from delayed insertion during an active capture, which is covered by regressions.

Pixel assertions use native browser screenshot scale and gradient palettes, preserve real shadows/borders/dividers, inspect intermediate/final content and every join, and save failed exports. Persistent browser contexts launch at each selected viewport size. Page-only emulation was corrected after it disagreed with native tab capture. WebKit's inaccessible left overflow in one root/body direction override is checked against its independently measured native scroll range rather than assuming Chromium's range.

## Version 2.2.3 final validation

- **678 successful extension scenario/browser pairs:** 226 distinct scenarios in actual Chrome for Testing 147.0.7727.117, Chrome Stable 155.0.8059.84 and Playwright Chromium 156.0.8078.4. The six-worker full run completed 677 passes and one PDF processing assertion deadline in 18.2 minutes, with no skipped cases or automatic retries.
- The remaining assertion asked a 40-page raster recovery job, approximately 54 megapixels at 120 DPI, to finish within the generic ten-second UI wait. Its trace showed continued progress from 85% to 90% through that deadline. Only that assertion now allows 30 seconds, and it additionally downloads and parses the resulting 40-page PDF. All six focused reruns, twice per Chrome version with six workers, passed in 26 seconds and left no workers running. Runtime hashes were unchanged. The raw failed report is retained; successful coverage counts each scenario/browser pair once.
- **75 rendering and cleanup checks passed:** 25 scenarios across Chromium, Firefox 157.0 and WebKit 27.2, in 1.2 minutes. These exercise the content script and do not establish Firefox or Safari extension support.
- **21 unit tests passed**, bringing unique successful automated coverage to **774 checks**. The earlier focused menu reruns and duplicate PDF reruns do not inflate that total.
- **Five public-page smoke captures passed:** Example Domain, IANA's example-domain article, WAI's accessibility introduction, MDN's overflow documentation and the W3C CSS overview. Exported PNGs decoded, full dimensions matched, scroll/styles restored and no extension-page errors occurred. These external smoke checks are separate from the controlled pixel oracles.
- Performance assertions retained one encode, one project write and zero hidden-library rebuilding for a burst of 20 edits with a 7.2-megapixel image and 501 library projects. The 1,500-fixed-element preparation/restoration check passed. Timings depend on host load; the work-count assertions establish the retained optimizations.
- Both independent Astra reviewers approved the final source and the scoped PDF test correction. Formatting and whitespace checks passed; the production dependency audit reported zero vulnerabilities.

Release validation compares the packaged JavaScript, HTML, CSS and manifest hashes with the tested build, verifies ZIP integrity and loads the unmodified release manifest for an exact-pixel import/export check. Machine-readable results and provenance are retained in `release/capture-studio-test-results-2.2.3.json`. The release preserves the existing permissions, free features and local processing.

## Version 2.2.4 complete-image export review

The supplied ZIP contained the end of the newsletter in a second PNG. The old exporter always kept capture tiles separate, even after downscaling made the entire capture fit one image; its output dimensions described only the current editing tile. A previously selected current-part scope could also carry into a different capture.

Complete export now validates the original rectangular tile coverage and joins every part when the selected output fits the 24-megapixel/16,000-pixel-side image limits. Bounds are calculated from the whole capture, and shared rounded edges include the final row/column at fractional scales. The fit control chooses the largest actually safe integer percentage from 1–100%. ZIP fallback retains every part when the complete image remains too large, original placement metadata is unavailable, or independent crop/rotation edits changed the layout. Undo restores original placement eligibility. PDF keeps its per-part pagination and uses the same resize calculations.

Edits are flattened before resizing, with solid redactions last; PNG/WebP keep alpha and JPEG gets a white background. The exporter decodes and releases one bounded tile at a time into the bounded final canvas. Source/output geometry and crop bounds are checked before canvas allocation. Failed draws release temporary canvases and bitmaps. Project, records, title and export options are snapshotted before asynchronous work, and stale results cannot replace another capture’s cache or size summary. Copy/context actions accurately label the current or first part.

Two independent Astra source reviews approved the final implementation and meaningful pixel, geometry-edit, memory/failure and held-navigation regressions after two labeling findings were resolved. Their exact approved source hashes are retained in `release/capture-studio-test-results-2.2.4.json`. Neither reviewer modified files or ran the centralized suite. A separate Astra follow-up approved the deterministic cancellation test correction described below.

The private attachment was joined through the actual new app export path into a 928 × 4,588 PNG; decoded output pixels exactly equal the two supplied images in sequence. This checks the supplied artifact, while synthetic source fixtures test the original 2320 × 11469 geometry at 40%. Private email content is excluded from all extension, source, store-kit and website archives.

### Version 2.2.4 verification

- **301 unique successful automated checks:** 27 unit tests and 274 scenario/browser pairs. The full 238-scenario Chromium run completed 237 passes and one existing cancellation-test timing race in 8.2 minutes with six workers. The unmodified raw report is retained.
- The timing race sent RESTORE after PREPARE could already finish. The corrected test holds the intended first preparation timeout, verifies cancellation and exact restoration, releases its callback in `finally`, and verifies a successful fresh preparation. All four policy variants passed again in Chromium under concurrent load; all eight variants passed across minimum Chrome and Chrome Stable. No runtime source changed for this correction. The separate Astra review approved the test change.
- All 28 export/capture compatibility checks passed in actual Chrome for Testing 147.0.7727.117 and Chrome Stable 155.0.8059.84. The Chromium suite used 156.0.8078.4. Coverage counts each scenario/browser pair once: 238 Chromium, 18 minimum Chrome and 18 Chrome Stable. Focused duplicate reruns are excluded from the total.
- New regressions cover the original long-page geometry, full end/footer pixels at reduced size and quality, exact rounded grid edges, fit and ZIP choices, scope reset, square rotation/crop/undo, alpha/redactions, 1% image/PDF dimensions, one-source-at-a-time decoding, failure buffer cleanup and navigation during export. The actual 17,100-pixel browser capture also exports at half size with its final footer row intact.
- Source formatting and whitespace checks passed; the production dependency audit reports zero vulnerabilities. Release verification compares all packaged runtime hashes to the frozen tested build, checks every archive file, and loads the unmodified production manifest for exact-pixel import/export. Private attachment pixels are separately verified and excluded from all distributed archives.

## Version 2.2.5 single-file compression review

Every image export now produces one PNG, JPG or WebP. Original capture tiles join through shared rounded edges; oversized results automatically use the largest safe common scale within the 24 MP/16,000-pixel-side browser allocation limits, including scales below 1% when necessary. The panel distinguishes requested size from actual effective size. Crop/rotation edits or missing original coordinates produce one labeled, centered vertical arrangement in saved part order. Each part keeps the same scale; narrow parts receive padding. Whole-pixel quantization remains visible at very small sizes. PDF still produces one document with all selected parts.

Two independent Astra source reviews approved the final layout, graphics, app and PDF sources. One caught fractional crop double-rounding: a 50.6-pixel crop at 50% must render to 25 pixels directly, rather than rounding first to 51 and producing 26. Both approved the corrected runtime. A further Astra test-harness review approved the exact download payload checks and retained real-browser download coverage. Exact approved hashes are recorded with the release evidence.

The format matrix imports PNG, JPEG, WebP, GIF and AVIF, then exports PNG, JPEG, WebP and PDF. It covers every integer size from 1–100%; min/mid/max lossy quality at each size; and every quality from 35–100% at representative 1%, 39%, 100% sizes. This is systematic coverage, not every possible size-by-quality combination. The full profile independently reads the exact production download-anchor file payload before browser delivery; the compatibility profile saves and reads actual Chrome downloads. Both enforce filename/MIME/signature, exact rounded dimensions and exactly one file per click, with ZIP output rejected.

Native low-quality JPEG ringing and tile-rounding behavior required correcting the original pixel oracle. Final lossy expectations are independently encoded from the original whole input; RGB tolerance remains 25. Color markers require at least 64 pixels on each axis (for PDF, on every embedded raster); PNG markers require 20 pixels per axis. Smaller outputs still undergo geometry, integrity and file-type checks. Separate long, wide, 2D-grid, alpha, redaction, crop/rotation and extreme thin-image cases check complete final edges. Existing-PDF compression covers lossless and all nine DPI/quality combinations, preserving page boxes and decoded content markers; lossless also preserves decoded page commands and embedded image bytes. Superseded test-harness reports are retained and excluded from successful counts.

The supplied private capture also went through the actual updated exporter: PNG joining preserved every source pixel at 928 × 4588, and quality 80 WebP produced one 330,186-byte file at the same dimensions, 84% smaller than the 2,022,523-byte joined PNG. Private email content is excluded from all distributed app/source/store/website archives.

The interrupted final sweeps were repeated after the workspace connection recovered, with runtime and assertions unchanged. Recording was disabled for these two high-volume sweeps; failure screenshots, persistent text logs and complete JSON reports were retained. The unchanged successful 259-scenario regression report was reused.

### Version 2.2.5 verification

- **419 successful top-level automated checks:** 30 unit tests and 389 scenario/browser pairs. Coverage is 279 Chromium scenarios and 55 each in actual minimum Chrome 147 and Chrome Stable 155. Failed/interrupted harness probes and duplicate reruns do not inflate this total.
- The format matrix contains **7,835 export-payload configurations** in Chromium and **1,000 actual browser-download configurations** across minimum and Stable Chrome, counted separately from the 419 top-level checks. The stored result lists every checked size and quality plus delivery mode and color-marker threshold.
- The real 17,100-pixel page exports one automatically fitted PNG, and a half-size PNG with its final footer row intact. Maximum-size editing, bounded one-source-at-a-time rendering, failure buffer cleanup/retry, navigation during export, malformed imports, lifecycle cleanup, menu/clipboard and policy restoration regressions pass.
- Formatting and whitespace checks pass; the production dependency audit reports zero vulnerabilities. Removing unused runtime ZIP encoding reduces the app bundle by 19,371 bytes. Release checks compare frozen runtime hashes, inspect every archive entry, and load the unmodified production manifest for exact-pixel import/export.
- Website deployment provenance and existing media verification are supplied separately in the store kit. The neural narration and store media are unchanged; no new recording is claimed.

## Version 2.3.0 editable text and post-capture cropping

Two independent Astra source reviews examined the new text geometry, annotation transforms, editor state, crop preview and persistence. Text boxes support post-placement content, font-size, foreground/background color, transparency, movement, wrapping and resizing. Keyboard selection and editing coexist with the original Pan/native-image context behavior. Crop uses adjustable bounds with Apply/Cancel and preserves text editability through crop and quarter-turn rotation.

The reviews identified and verified fixes for the actual expanded redaction mask being shifted on rotation, fractional legacy crops requiring raster-scale transforms, legacy text being wrapped or shifted by style-only edits, and keyboard/context-menu paths bypassing pending-crop guards. Redactions are baked into the base before resampling and retained as conservative final masks. Legacy text keeps its original renderer until explicit resizing. Internal matrices only compose crop translation/scaling and quarter turns.

The broad regression suite exposed an additional redo/reload durability gap: saving waited for native preview decoding after the UI dimensions changed. Persistence now queues immediately after each raster/history mutation, before preview work, and both operations are observed together. Two regressions hold preview decoding, independently verify the new dimensions in IndexedDB, and reload while the preview remains held.

Coverage includes actual capture/crop pixel equality, legacy pixel-reference comparisons, fractional-crop geometry, every previously covered redaction-border pixel, editor controls and cancellation, one-gesture undo, reload/navigation ownership, all four exported file formats, simulated encoding failure cleanup/retry, fractional-DPI responsive layouts, and automated WCAG A/AA checks. Export tests inspect output geometry and background/redaction samples; they do not compare every glyph in every codec. Physical devices and private mail accounts were not used. The earlier 7,835-case full compression sweep remains version 2.2.5 evidence and is not counted as a new run.

Final runtime hashes, actual minimum/installed Chrome versions, results, archive integrity and publication evidence are supplied in `release/capture-studio-test-results-2.3.0.json`.

## Version 2.3.1 inline text editing

The text-entry modal is replaced by an on-image native textarea. It owns the project, image record, part, load generation and original annotation reference. Its draft and style changes commit as one undoable transaction before snapshots; a new empty draft is discarded and empty existing text deletes that object. Escape or Cancel rolls back. Native textarea selection, multiline input, paste and typing undo remain independent from editor undo. An unfinished changed draft participates in the unload warning.

New text defaults to dark charcoal, transparent background and locally bundled Inter (SIL Open Font License). Existing projects retain their original renderer until explicitly edited; merely opening and closing an older text object leaves its record unchanged. A clipped, hidden DOM probe measures the same font, line-height, whitespace and wrapping as the textarea; a bounded cache avoids repeated DOM measurement. Probe text uses textContent. The input uses fractional image-space transforms without replacing its value or selection during zoom. Later annotation layers, including all final redactions, render above the native editor.

Astra reviews identified composition completion before snapshots, right-to-left run anchoring, later annotation occlusion and fractional stage dimensions. Dedicated browser regressions exercise these paths, compare native text glyph locations to exported pixels across Unicode/RTL/tab/whitespace cases, and check cancellation, keyboard editing, styles, old projects, forced-color redaction coverage, and export/clipboard ordering. Final test counts and review approvals are recorded with the release evidence; no new physical-device or authenticated-email testing is claimed.

## Validation boundaries

Browser tests run in a real Chrome for Testing process with the MV3 service worker and content script. Host permission is added to a disposable test copy, with browser networking restricted to localhost because test automation does not constitute a user clicking the browser action. Release permissions are checked separately. Desktop/tablet/phone viewport testing does not claim physical-device testing or Chrome Android extension support. Email coverage uses a Gmail-style local fixture rather than a live authenticated Gmail account. Pane detection traverses the top-level DOM; nested scrollers inside frames or shadow roots require their own tab or a visible-area capture. No Google Cloud project or external credentials were required.
