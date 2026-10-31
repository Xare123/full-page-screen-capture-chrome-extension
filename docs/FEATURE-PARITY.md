# Capture Studio 3 feature review

Reference: the public Chrome Web Store listing for Capture Studio Pro 1.6.2,
item `ilpifjdhjhfboonmdnpfjbbbbflhfhoo`, read on 2026-10-31 UTC.
This is an independent implementation of advertised functions, not a copy of its code or artwork.

## Implementation map

The table is an implementation checklist. A feature is complete only after its
implementation, relevant checks and review are recorded below.

| Advertised function                                                      | Existing foundation                                | Version 3 implementation                                                                      |
| ------------------------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Full, visible, selected area and scrolling panes                         | Implemented and regression tested in 2.3.1         | Element picker, keep completed capture, optional clean capture                                |
| Selected-area editor on the webpage                                      | Full studio editor                                 | Scoped inline studio; protected-page fallback to the studio                                   |
| Arrows, text, callouts, steps, highlights, shapes, solid redaction       | Most drawing tools and direct text editing         | Callouts; select/move/resize/duplicate/delete all drawing objects                             |
| Crop, backgrounds, browser frames, full-resolution PNG/JPG/WebP          | Crop, single-file exports, compression             | Reversible image finishes with preserved annotation coordinates                               |
| Desktop/window, camera, tab and tab-region recording                     | None                                               | Native media chooser, optional microphone/camera/shared audio, quality and camera positioning |
| Pause, resume, stop and live annotation                                  | None                                               | Session controls and recording-safe background compositing                                    |
| Video trim, remove audio, restore original, current frame                | None                                               | Local media editor and browser-supported WebM/MP4                                             |
| Local English OCR and text review/copy/download                          | None                                               | Bundled local OCR; English, Arabic and Spanish models                                         |
| Saved whiteboard pages, optional templates and text cards                | Editor and multipage projects                      | Separate whiteboard workspace, page management, safe editable JSON import/export              |
| Separate searchable/pinned/done notes with source links/reminders        | None                                               | Local notebook; opt-in browser reminders                                                      |
| Horizontal/vertical toolbars; sizes, labels, docking, drag/minimize      | Responsive main studio                             | Configurable on-page presentation toolbar                                                     |
| Search More commands; individually toggle/reset effects                  | None                                               | Command palette and active-effects controls                                                   |
| Clock/countdown, spotlight, presenter pointer, fading ink, lesson reveal | None                                               | Page presentation tools and whiteboard reveal                                                 |
| Chart/webpage snapshot zoom ending on scroll/resize                      | None                                               | User-initiated local viewport zoom                                                            |
| Native sharing and manual email/WhatsApp drafts                          | Local downloads/clipboard                          | Explicit share actions, without automatically sending anything                                |
| Guide, first-use tips, drawing keys and browser shortcut settings        | Keyboard help                                      | Searchable guide, replayable tips and configurable drawing keys                               |
| No account, no personal API key, no analytics/upload                     | Implemented                                        | Preserve; media/reminder permissions requested for chosen actions                             |
| Google Drive                                                             | Reference says unavailable pending publisher OAuth | Do not pretend a publisher OAuth connection exists; native/local sharing remains available    |

## Additional capabilities retained or added

- Existing-PDF compression, 13 common PDF sizes, auto paper/orientation and image-sized pages.
- Complete long-image export with safe uniform fitting and one actual image file.
- Recording chunks saved locally rather than relying on a 256 MB in-memory recording.
- Up to 100 whiteboard pages per reusable board, with optional templates.
- Extra local OCR languages and video-frame/GIF exports.
- Existing editable-text, annotation/redaction geometry, recovery and accessibility regressions.

## Implementation constraints

- Use native consent for screen/camera/microphone capture. Never start media during installation or passive browsing.
- Keep codecs, OCR workers/WASM/models and fonts bundled. No remote executable code or screenshot upload.
- Preserve media/image aspect ratios, including resize, selected regions and video metadata changes.
- Persist recording chunks transactionally and stop all owned media tracks on cancellation/failure.
- Keep redaction masks opaque and last in preview/export; OCR receives a flattened, redacted snapshot. Full/element captures apply redaction in the finished studio image. On-page masks are supported in visible/region capture with Clean off and no layout preparation.
- Editable whiteboard exports flatten pages containing redactions so their original content cannot be recovered from JSON.
- Inline studio frames are scoped to one explicitly captured project and source tab. Unauthenticated embedding never opens the library.
- Keep existing data and the older worktree intact. Build and test this change in `capture-studio-next`.
- Final reporting distinguishes real native media encoding from synthetic source/device tests.

## Verification and review

The verified 3.0.0 runtime passed 42 unit tests, 335 extension scenarios and 75 rendering scenarios in [CI](https://github.com/Xare123/full-page-screen-capture-chrome-extension/actions/runs/41177310317). All 20 compression sweeps passed, covering 7,835 export-payload configurations across five image inputs and four image/PDF outputs. A focused Chrome 147/155 matrix passed all 152 scenarios with no skips or flaky results. These checks overlap; the counts are not combined into a unique-test total. Two independent Astra reviewers approved the final runtime and publication checks.

An additional headed-Chrome test kept the editor hidden for 360 seconds while recording a static browser tab with the unmodified release manifest. The complete 360.24-second video decoded all 10,651 frames, averaged 29.56 fps and had a maximum packet gap of 0.282 seconds. It retained multiple committed chunks at completion. This verifies a static tab under that configuration, without claiming physical-device coverage or measuring intermediate storage commits during the hidden interval. See `RELEASE-3.0.0.json` for source hashes, exact coverage and limits.


## Failure behavior reviewed for version 3

- Live recording retains bounded source/camera frames and updates ink over a static page. The UI waits for first output; failed startup, cancellation and empty payloads cannot become successful complete recordings. Final storage writes have one owner.
- Cancellation and failed recording storage release owned tracks and retain committed chunks for recovery. Playback and video export use isolated sessions.
- OCR uses a flattened committed image and owns its initializing worker. Cancel, model errors and retry do not leave a worker behind.
- Redacted board JSON excludes annotations, hidden originals and image-finish backups. On-page masks require preserved visible/region layout; full/element capture directs masking to the finished studio image.
- Same-URL navigation changes document identity and stops capture. An interrupted screenshot preserves only fully covered rectangular pixels.

Native test camera and microphone feeds are synthetic. Browser-tab captures, encoding, IndexedDB, alarms, GIF decoding and image/PDF outputs are exercised by real browser APIs. Physical devices and every operating-system capture chooser are outside the automated coverage.
