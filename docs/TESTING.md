# Capture Studio testing

The browser suites use fictional local pages and actual browser rendering. They do not read private mail accounts. No Google Cloud project or external account is needed.

## Normal verification

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run verify
npm run test:engines
```

`verify` builds the extension, runs the unit suite, and runs the complete MV3 extension suite in Chromium. `test:engines` independently exercises content-script layout and cleanup in Chromium, Firefox and WebKit. The latter is a rendering compatibility check; the extension remains a Chrome/Chromium MV3 application, and these checks do not establish Firefox or Safari extension support.

CI runs extension regressions and the full compression sweep in separate jobs, with three workers per job, plus the rendering-engine suite. It retains release files, screenshots, traces and reports. A failed pixel assertion retains its capture for inspection. Existing test fixtures cover capture locking, cancellation, malformed files, persistence, conflicting tabs, redaction, image/PDF export and compression, alongside the expanded email, web-page and policy matrices.

## Three-version extension matrix

Install official Chrome for Testing 147 and the current Stable release from the [Chrome for Testing download metadata](https://googlechromelabs.github.io/chrome-for-testing/). The minimum-version project verifies that its executable actually reports major version 147. The matrix uses real browser executables; changing a user-agent string is not browser-version testing.

```sh
export CS_MINIMUM_CHROME_EXECUTABLE=/path/to/chrome-147/chrome
export CS_CHROME_EXECUTABLE=/path/to/chrome-stable/chrome
npm run build
npm run test:matrix
```

The script also recognizes local extractions at `artifacts/chrome-minimum/chrome-linux64/chrome` and `artifacts/chrome-stable/chrome-linux64/chrome`. The third project uses Playwright's installed Chromium. `CS_MATRIX_WORKERS` selects one to six workers, with three by default. A running local fixture server can be reused by setting `CS_REUSE_TEST_SERVER=1`; otherwise Playwright starts and stops it.

The script saves the actual executable/version inventory to `artifacts/matrix-browser-inventory.json` and the structured result to `artifacts/matrix-e2e-VERSION.json`. Filter a reproduction with `npm run test:matrix -- --grep 'test name'`. Full output and failure traces remain useful evidence; a failed or interrupted attempt is not counted as a pass.

`CS_ENGINE_REPORT` selects a structured JSON output path for `test:engines`. On a restricted Linux host, `CS_WEBKIT_EXECUTABLE` can select a local launcher that supplies missing shared libraries. This changes dependency lookup, not the browser engine or its assertions. Normal CI uses Playwright's standard dependency installation.

## Pixel and restoration oracles

Email coverage spans receipts, newsletters, tables, threads, attachments, plain text, quoted replies, mixed-direction text, dark themes, transparent gradients and nested readers in several layouts. Page fixtures span articles, storefronts, dashboards, documentation, forms, wide tables and dynamic navigation. Policy cases use actual nonce CSP and Trusted Types restrictions, modal dialogs and popovers.

Assertions inspect exported PNG pixels, first/last content, intermediate anchors and every capture join. Real message borders, dividers, shadows and generated content have preservation controls. Native `captureVisibleTab` screenshots supply the scale and background oracle, including gradient dithering. Reported device-pixel ratio alone is not assumed to equal screenshot scale.

Viewport variants launch the entire persistent browser context at the chosen size. Resizing only one emulated page can disagree with the native viewport captured by the extension, so it is unsuitable as a window-resize oracle. Viewport and engine tests do not claim physical-device testing or Chrome Android extension support.

Restoration checks cover original inline declarations, existing temporary-attribute names, scrolling, authored changes during capture, cancellation and failures. The capture suite grants host permission only to a disposable extension copy to emulate a browser-action grant. Release verification separately loads the unmodified ZIP manifest, checks permissions, and imports/exports an image without adding host access.

## Complete single-file exports and compression matrices

Image exports return one PNG, JPG or WebP. Valid capture tiles retain their original layout; edited/legacy parts form a labeled saved-order vertical composition. The same continuous safe-fit plan drives displayed dimensions and output. No ZIP option or image archive code remains.

`tests/unit/image-layout.test.js` sweeps every size from 1–100% over ten ordinary, 2D, wide, tall and extreme shapes, and checks source/crop limits, fractional crop rounding, centered fallback, safe fit and final edges. `tests/e2e/long-export.spec.js` checks actual decoded footer/corner pixels, auto-fit at boundaries, all three output codecs, crops/rotation/undo, alpha/redactions, tiny/sub-1% results, bounded sequential memory, failure cleanup, and navigation during export. `capture.spec.js` captures a real 17,100-pixel page and checks its automatically fitted and reduced-size PNG through the final row.

`tests/e2e/compression-matrix.spec.js` imports real PNG/JPEG/WebP/GIF/AVIF files and exercises PNG/JPEG/WebP/PDF output. The full profile checks all 100 size settings, min/mid/max lossy quality at every size, plus all 66 qualities at 1%,39%,100%. This is systematic boundary coverage, not the full size-by-quality Cartesian product. The full profile captures the exact production download-anchor payload immediately before browser delivery, then independently decodes that payload and checks its filename, MIME type, signature and dimensions. The compatibility profile also saves and reads the actual Chrome download. Both require exactly one emission per click and reject ZIP output. PNG edge colors are checked at 20 pixels or more per axis; lossy image markers require 64 pixels per axis, and PDF markers require every embedded raster to reach that threshold. Smaller results retain strict dimensions, file integrity and MIME checks. PDF exports check every part’s media box, embedded raster dimensions and first/last content. PDF optimization and all nine exposed raster DPI/quality combinations also check page sizes and content. Lossless checks compare decoded content commands and embedded image bytes; raster checks decode each output JPEG’s end markers.

Use `CS_COMPRESSION_MATRIX_PROFILE=compatibility` for a smaller 1%,9%,10%,39%,40%,50%,94%,95%,99%,100% scale sweep with min/mid/max quality on other Chrome versions. Both profiles attach every checked case, delivery mode, emission/download counts and marker threshold to the Playwright report. Lossy image pixel expectations come from an independent decode/resize/encode of the original whole input, so native codec artifacts are modeled without widening tolerances. PDF controls use explicit source rectangles for their first and last parts. The colorful long/wide and grid tests provide additional spatial markers. Real trusted export clicks are required: programmatic DOM clicks do not model user gestures and Chrome can block repeated automatic downloads. PDF fixtures open the compression dialog before choosing its file.

Policy cancellation tests hold the first preparation timeout in the extension isolated world, cancel while that boundary is held, and release in `finally`. Runtime timers and capture content code are unchanged.

Private user uploads remain outside source fixtures and all release/site archives.

## Editable text and post-capture cropping (2.3.0)

`editor-text.spec.js` exercises text dragging, handle resizing/reflow, font and foreground/background changes, transparency, content editing, one-step undo, reload persistence, cancelled gestures, keyboard selection/actions, stale dialogs, crop Apply/Cancel, pending-crop export guards, and actual PNG/JPEG/WebP/PDF pixels. PDF checks independently decode the embedded JPEG.

`editor-compat.spec.js` compares legacy text against an independent previous-renderer reference, verifies fractional saved-crop alignment and previously redacted border pixels, crops a real browser screenshot and compares every resulting pixel, forces an encoding failure to check canvas cleanup/retry, and covers fractional-DPI zoomed layouts and accessibility of the new controls. `editor-geometry.test.js` checks transform inversion, whole-mask coverage, Unicode wrapping and legacy box migration. These are browser/viewport tests, not physical-device tests.

## Inline text editing (2.3.1)

`editor-inline.spec.js` checks direct on-image input, transparent/Inter/charcoal defaults, foreground/background/font controls, one-transaction style changes, native text undo/redo, multiline input, cancellation, blank deletion and legacy no-op edit preservation. Glyph comparisons use real textarea screenshots and independent exported pixels for Unicode graphemes, whitespace, trailing newlines, RTL/mixed-direction text and tabs, allowing one pixel of rasterization proximity. A rotated fractional-zoom control checks the same editing/committed positions and selection preservation.

Synthetic composition events deliberately complete after Export/Copy clicks and across a microtask checkpoint. Clipboard invocation remains inside the originating click while its image promise waits for final text. Cancel abandons a waiting export; deleting during an edit restores the original object with one Undo. These tests do not establish behavior for every native OS input method. Forced-color tests verify that later layers and final redactions still cover active editable text. All fonts load from the extension package, without runtime network access.
