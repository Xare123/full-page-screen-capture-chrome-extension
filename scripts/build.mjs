import { build } from "esbuild";
import { mkdir, cp, rm, readFile, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/app.js", "src/popup.js", "src/background.js"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: "chrome147",
  sourcemap: false,
  legalComments: "eof",
  minify: false,
});
await build({
  entryPoints: ["src/content.js"],
  bundle: true,
  outfile: "dist/content.js",
  target: "chrome147",
  format: "iife",
});
for (const name of ["app.html", "popup.html", "styles.css", "popup.css"])
  await cp(`src/${name}`, `dist/${name}`);
for (const name of [
  "manifest.json",
  "LICENSE",
  "README.md",
  "CHANGES.md",
  "icon16.png",
  "icon48.png",
  "icon128.png",
])
  await cp(name, `dist/${name}`);
await cp("docs", "dist/docs", { recursive: true });
await cp("src/fonts", "dist/fonts", { recursive: true });
await cp(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "dist/pdf.worker.min.mjs",
);
for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(`node_modules/pdfjs-dist/${name}`, `dist/${name}`, {
    recursive: true,
  });
const packages = await Promise.all(
  [
    "pdf-lib",
    "pdfjs-dist",
    "@pdf-lib/standard-fonts",
    "@pdf-lib/upng",
    "pako",
    "tslib",
  ].map(async (name) => {
    const pkg = JSON.parse(
      await readFile(`node_modules/${name}/package.json`, "utf8"),
    );
    let license = "";
    for (const file of ["LICENSE", "LICENSE.md", "LICENSE.txt"]) {
      try {
        license = await readFile(`node_modules/${name}/${file}`, "utf8");
        break;
      } catch {}
    }
    return `${name} ${pkg.version} (${pkg.license})\n${license}`;
  }),
);
await writeFile(
  "dist/THIRD_PARTY_LICENSES.txt",
  packages.join("\n\n----------------\n\n") +
    "\n\nInter variable font (https://github.com/rsms/inter)\n" +
    (await readFile("src/fonts/OFL.txt", "utf8")),
);
console.log(
  "Built Capture Studio in dist/ (all runtime code is bundled locally).",
);
