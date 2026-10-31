# Reproducing the screenshots and tutorial

Run from the Capture Studio repository root after `npm ci`, `npm run build`, and `npx playwright install chromium`:

```sh
node store-assets/source/create-media.mjs
python3 store-assets/source/render-tutorial.py --visuals-only
python3 -m venv artifacts/neural-narration/.venv
artifacts/neural-narration/.venv/bin/pip install -r store-assets/source/narration-requirements.txt
python3 store-assets/source/download-voice-model.py
artifacts/neural-narration/.venv/bin/python store-assets/source/render-neural-narration.py
python3 store-assets/source/verify-media.py
```

The recordings script starts its own local fixture server on port 4181. It launches an isolated Chrome for Testing profile with a disposable copy of the real bundled Manifest V3 extension. Only that temporary copy receives automation host permissions. It does not change the release extension, user's profiles, private email, payment systems, or external accounts.

The five publication screenshots are native 1280×800 browser viewport JPEGs at quality 95, RGB without alpha. They show actual saved captures, edits, export controls, and the real measured optimization result for a fictional eight-page example PDF. The library screenshot uses ordinary page scrolling to show complete capture cards. The PDF screenshot uses ordinary inspector scrolling to show sizing controls. No product UI is drawn into the screenshots.

The tutorial uses actual Playwright page videos, with chapter labels, editorial opening/closing cards, captions, and a real extension popup inset over the matching example webpage. Some capture waits are shortened. Publication audio uses the stock American-English `af_heart` neural AI voice from Kokoro-82M v1.0, generated locally with kokoro-onnx 0.6.1. The earlier Flite voice has been replaced. The video remains 1280×800 H.264 with AAC audio and a streaming-friendly MP4 header. Selectable captions are provided as `video/captions.vtt`; narration subtitles are not burned into the MP4; the text transcript and upload metadata are beside the MP4.

`narration-script.json` preserves the original UI shot lengths and the conversational narration. Each sentence has its own generated audio; caption boundaries follow the actual audio sample counts. Chapters grow when needed to fit speech, and the visuals are retimed to exact 24 fps frame boundaries. The generated voice is never sped up afterward to fit a shot. `video-manifest.json` records the resulting durations and voice metadata. `--reuse-voice` reuses cached sentences only when text, voice, speed and model version match.

The model files and Python environment live under ignored `artifacts/`, outside the extension runtime and submission bundle. The downloader checks the recorded SHA256 values. For a different cache location, use `render-neural-narration.py --models /absolute/model/directory`. The source clips must first be generated with `render-tutorial.py --visuals-only`; the historical Flite branch is retained only for old-media reproduction.

Voice/model sources: [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT code), [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache 2.0 model), and the [pinned model release](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0). This uses a stock synthesized voice, not a clone of a specific person. No cloud speech service receives the script or files.

The fieldnotes webpage, Sunday mail demo, vector landscapes, and PDF are fictional examples authored for this project. Names and addresses use example.com. No external images, private mail, or customer records appear in the assets. The extension UI retains its existing brand and license.

`recordings.json` maps each editorial shot to an actual captured page video. `video-manifest.json` records chapter timing and narration. `media-verification.json` records dimensions, codecs, duration, and checksums. Raw recordings and intermediate video files are reproduction intermediates; the website and store need only the five JPEGs and final video files.

The local MP4 is ready for website playback and YouTube upload. Chrome Web Store's global promo video field requires the resulting public YouTube URL; a local MP4 path is not a YouTube URL. These scripts do not upload or publish to YouTube.
