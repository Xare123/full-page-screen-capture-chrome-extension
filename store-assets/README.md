# Capture Studio — website and store media

Store media originally prepared for version 2.2.0 on October 18, 2026. Extension and distribution updates are recorded below.

## Ready to use

- Five real 1280×800 RGB JPEG screenshots in `screenshots/`.
- 128×128 store icon, optional size variants, small 440×280 and marquee 1400×560 RGB PNG promos in `branding/`.
- A 95-second narrated H.264/AAC tutorial, selectable English WebVTT captions, transcript, poster and YouTube upload metadata in `video/`.
- Store description, prepared fields and settings handoff in `listing-copy.md`, `listing-fields.json` and `upload-checklist.md`.
- Permission and local-data-handling answers in `permissions-and-privacy.md`.
- Asset dimensions, formats and checksums in `asset-manifest.json`; QA evidence in `verification/`.

The deployed website is [Capture Studio](https://capture-studio-free.xare123.chatgpt.site), with [support](https://capture-studio-free.xare123.chatgpt.site/support/) and [privacy](https://capture-studio-free.xare123.chatgpt.site/privacy/) pages. The owner requested public access on October 26, 2026; Sites confirmed access mode public (revision 2). Source is in `/workspace/sites/capture-studio`, and a portable source ZIP is in `release/capture-studio-website-source.zip`.

## Account-dependent follow-ups

The Stripe account was connected and verified. The donation button uses a separate live [Capture Studio support link](https://donate.stripe.com/00waERaKJ819bVF0vw4Ja02) for one-time customer-chosen USD contributions: $5 suggested, $1 minimum. Every feature remains free. The site and privacy policy describe the optional checkout and recipient. No payment was made during verification. The locally hosted tutorial works; YouTube upload still requires the intended channel account. Neither donations nor a promo video is mandatory for Chrome Web Store submission.

No authenticated Chrome Web Store or Search Console settings were changed. The handoff prepares Mature content = No, recommends Item support = enabled, and records ownership as unverified. Public homepage/support/privacy URLs and required publisher fields must be ready before submission. Search Console verification is needed only if the publisher chooses to claim an official URL.

## Validation and reviews

The extension's existing 2.2.0 validation passed 16 unit tests and 32 Chromium scenarios, including Gmail-style long-email capture. Two Astra implementation reviews signed off the fixes. This media task did not change extension runtime files or the tested release ZIP.

Two further Astra reviews checked website copy, product/privacy claims and marketing assets; neither found a P1/P2 blocker. Minor wording fixes clarify local/session storage, screenshot exports versus existing-PDF optimization, and single-part copying. A follow-up review checked the listing handoff and clarified that donations and promo videos are optional for store submission.

Website QA covered homepage, support and privacy at widths 1440, 768, 390 and 320 in Chromium: no horizontal overflow, broken images, JavaScript errors or automated WCAG A/AA violations. Keyboard tabs, screenshot lightbox/Escape, clipboard copying, FAQ controls, MP4 playback and all caption cues passed. These are browser viewport tests, not physical-device tests. Local asset links resolve, the site's ZIP matches the tested release, and native Sites publication succeeded for the exact pushed source commit recorded in `verification/website-deployment.json`.

Final video has matching 95-second audio/video streams, H.264 yuv420p, AAC 48 kHz, and complete decode verification. Screenshots use actual extension UI and fictional content. Artwork is generated original branding with retained provenance. No private email, customer records or fabricated reviews are used.

Reproduction scripts and fictional example fixtures are in `source/`; raw recordings and encoding intermediates are excluded from the submission bundle. `branding/README.md` records the graphics workflow. See `source/MEDIA.md` for video reproduction.

## Stripe follow-up

Verified the requested account identity and live-payment capability, then created a separate active one-time support link. Stripe line-item verification confirms customer-chosen USD pricing, quantity 1, $1 minimum, $5 preset and no recurring component. Both Astra reviewers found no blocking issues in the donation change. Homepage and privacy checks at 1440, 390 and 320 pixels passed without overflow, JavaScript errors or automated accessibility violations. The button opens the verified Stripe destination in a separate tab with no opener/referrer exposure. The live hosted checkout was also visually verified with its editable $5 amount and Donate button. No payment was submitted. Native private publication succeeded and the audience was rechecked: one allowed user, no groups or external visitors.

## Natural narration update

The original Flite narration was replaced with the stock Kokoro af_heart neural AI voice. The current tutorial is 95 seconds with 29 sentence captions. Speech retains its generated cadence; visuals adapt to it, with explicit sentence anchors for email picking, redaction, PDF export and raster settings. Both Astra reviews verified final timing: 2280 frames at 24 fps with matching 95-second audio. Model provenance, pinned dependencies and source-only reproduction steps are in source/MEDIA.md.


## Extension 2.2.4 update

The current download includes complete long-image export, proportional resizing and the fit-to-one-image control. Updated listing copy and installation guidance accompany the same previously verified fictional store media and neural-voice tutorial. Verification for this release is recorded in `release/capture-studio-test-results-2.2.4.json`; this update does not claim a new video recording or a public store listing.


## Extension 2.2.5 update

The current extension exports one complete PNG, JPG or WebP, with automatic proportional fitting and actual output dimensions. Cropped or legacy parts form one labeled vertical layout; PDF stays one document. Image ZIP output is removed. All 419 top-level checks passed, including 7,835 export-payload configurations and 1,000 actual browser-download configurations across the three Chrome versions. Two independent Astra source reviews and resumed source/release reviews approved the implementation and scoped evidence. Exact settings, coverage limits and hashes are retained in `release/capture-studio-test-results-2.2.5.json`. Existing fictional store media and neural narration are unchanged.

## Public store submission handoff — October 26, 2026

The existing website audience changed to public through Sites; no source or extension runtime changes were required. Direct website links provide the icon, five screenshots, both promo graphics and the tutorial. `listing-fields.json` records the current public audience, and `verification/website-public-access-2026-10-26.json` retains the returned access-policy state. The previous versioned archives remain unchanged as historical release evidence. Chrome Web Store submission, support settings, YouTube publication and Search Console verification remain account actions, not completed claims.

## Extension 2.3.1 update

Direct on-image text entry replaces the annotation modal. New text defaults to locally bundled Inter, dark charcoal and a transparent background; font, foreground/background, movement, resizing and content remain editable. Existing screenshots and the neural tutorial remain historical demonstrations; no new recording is claimed. Current source, tests, build/CI scripts, website source and public media are maintained in the GitHub repository. Final verification is recorded in the versioned release report.

## Extension 3.0.0 update

New native 1280×800 RGB screenshots in `suite-screenshots/` show whiteboards, offline OCR, notes and recording. Reproduce them with `node store-assets/source/create-suite-media.mjs` after building. Examples are fictional; the recording image uses Chromium’s synthetic camera. The original five `screenshots/` remain a core capture/PDF set; the store accepts at most five images, so choose the mix you want. New listing and privacy copy cover optional local reminders and native media consent. The 95-second tutorial continues to demonstrate the core capture workflow. Final validation and limitations are in `docs/RELEASE-3.0.0.json` and the public versioned validation report.
