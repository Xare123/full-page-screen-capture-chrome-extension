import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

const version = JSON.parse(await readFile("package.json", "utf8")).version;
const target = "artifacts/website";
await rm(target, { recursive: true, force: true });
await cp("website", target, { recursive: true });
await rm(join(target, "README.md"));
await mkdir(join(target, "assets"), { recursive: true });
await mkdir(join(target, "downloads"), { recursive: true });
for (const name of [
  "icon16.png",
  "icon48.png",
  "icon128.png",
  "icon512.png",
  "small-promo-440x280.png",
  "marquee-promo-1400x560.png",
])
  await cp(`store-assets/branding/${name}`, `${target}/assets/${name}`);
for (const name of await readdir("store-assets/screenshots"))
  await cp(`store-assets/screenshots/${name}`, `${target}/assets/${name}`);
for (const name of [
  "capture-studio-tutorial.mp4",
  "tutorial-poster.jpg",
  "youtube-thumbnail-1280x720.jpg",
  "captions.vtt",
])
  await cp(`store-assets/video/${name}`, `${target}/assets/${name}`);
await cp(
  "store-assets/video/transcript.md",
  `${target}/assets/tutorial-transcript.txt`,
);
for (const name of ["youtube-title.txt", "youtube-description.txt"])
  await cp(`store-assets/video/${name}`, `${target}/downloads/${name}`);
await cp(
  "store-assets/store-description.txt",
  `${target}/downloads/chrome-web-store-description.txt`,
);
for (const name of [
  `capture-studio-${version}.zip`,
  `capture-studio-source-${version}.zip`,
  `capture-studio-store-assets-${version}.zip`,
  `capture-studio-test-results-${version}.json`,
])
  await cp(
    `release/${name}`,
    `${target}/downloads/${name.replace("test-results", "validation")}`,
  );
console.log(
  `Website prepared in ${target}/; publishing is a separate Sites operation.`,
);
