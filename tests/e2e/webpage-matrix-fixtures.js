const feature = '<div id="feature" class="feature"></div>';
const paragraphs =
  "<p>A fictional public article with a long local document, links and readable sections.</p>".repeat(
    12,
  );
const cards = Array.from(
  { length: 12 },
  (_, i) =>
    `<section class="card"><h3>Example item ${i + 1}</h3><p>Fictional product details.</p>${i === 8 ? feature : ""}</section>`,
).join("");

export const webpageCases = [
  {
    name: "magazine article with floated figure",
    css: ".copy{max-width:900px;margin:auto}.figure{float:right;width:250px;height:200px;background:#dce8f3}",
    body: `<article class="copy"><h1>Example field notes</h1><div class="figure">${feature}</div>${paragraphs}</article>`,
  },
  {
    name: "storefront with responsive product grid",
    css: ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.card{height:250px;padding:30px;background:#e4ecf2}",
    body: `<main class="grid">${cards}</main>`,
  },
  {
    name: "analytics dashboard with flex cards",
    css: ".grid{display:flex;flex-wrap:wrap;gap:20px}.card{height:260px;width:29%;background:#f0e7d8;padding:20px}",
    body: `<main class="grid">${cards}</main>`,
  },
  {
    name: "documentation with sticky navigation sidebar",
    css: ".docs{display:grid;grid-template-columns:180px 1fr;gap:25px}.toc{position:sticky;top:20px;align-self:start;height:220px;background:#e0eadc}.copy{padding-top:340px}",
    body: `<div class="docs"><aside class="toc">Contents</aside><article class="copy">${feature}${paragraphs}</article></div>`,
  },
  {
    name: "application form with filled controls and validation hints",
    css: "form{padding:300px 80px;display:grid;gap:30px;max-width:700px}input,select,textarea{padding:15px}",
    body: `<form><label>Contact <input id="form-input" value="Fictional person"></label><select id="form-select"><option>A</option><option selected>B</option></select><textarea id="form-area">A fictional note</textarea><input id="form-check" type="checkbox" checked>${feature}<p role="status">Saved form draft</p></form>`,
  },
  {
    name: "wide comparison table with sticky first column",
    width: 2240,
    css: "table{border-collapse:collapse;width:2100px;margin:180px 50px}td{width:400px;height:160px;border:1px solid #aab;padding:20px}td:first-child{position:sticky;left:0;background:#e4edf6}",
    body: `<table>${Array.from({ length: 10 }, (_, i) => `<tr><td>Plan ${i}</td><td>Details</td><td>${i === 7 ? feature : "Example data"}</td><td>Options</td></tr>`).join("")}</table>`,
  },
  {
    name: "RTL wide financial table",
    width: 2240,
    rtl: true,
    css: "table{width:2100px;margin:180px 50px;border-collapse:collapse}td{height:150px;width:500px;border:1px solid #bba;padding:20px}",
    body: `<table dir="rtl">${Array.from({ length: 10 }, (_, i) => `<tr><td>مثال ${i}</td><td>${i === 7 ? feature : "بيانات تجريبية"}</td><td>12345</td></tr>`).join("")}</table>`,
  },
  {
    name: "article inside visible-overflow wrappers",
    css: ".outer{margin:180px 70px;overflow:visible;height:100px}.inner{position:relative;overflow:visible;height:1600px;padding-top:950px}",
    body: `<div class="outer"><div class="inner">${feature}${paragraphs}</div></div>`,
  },
  {
    name: "fixed widget anchored in a translated section",
    css: ".local{position:absolute;left:250px;top:950px;width:400px;height:400px;transform:translateZ(0);background:#eff4f7}.local .feature{position:fixed;left:70px;top:100px}",
    body: `<section class="local">${feature}</section>`,
  },
  {
    name: "fixed widget inside individually scaled ancestor",
    css: ".local{position:absolute;left:250px;top:800px;width:600px;height:600px;scale:.75;transform-origin:top left;background:#eff4f7}.local .feature{position:fixed;left:110px;top:200px}",
    body: `<section class="local">${feature}</section>`,
  },
  {
    name: "paint-contained illustration section",
    css: ".local{position:absolute;left:180px;top:900px;width:700px;height:500px;contain:paint;background:#ecf1e6;padding:190px}",
    body: `<section class="local">${feature}</section>`,
  },
  {
    name: "fixed widget inside filter containing block",
    css: ".local{position:absolute;left:180px;top:950px;width:700px;height:500px;filter:drop-shadow(0 5px 8px #5555);background:#ecf1e6}.local .feature{position:fixed;left:190px;top:190px}",
    body: `<section class="local">${feature}</section>`,
  },
  {
    name: "dark article with native color scheme controls",
    dark: true,
    css: ".copy{padding:400px 100px;color:#eee}input{color-scheme:dark}",
    body: `<article class="copy"><input value="Dark theme example">${feature}${paragraphs}</article>`,
  },
  {
    name: "blog over gradient background",
    css: "#track{background:linear-gradient(120deg,#efefcf,#cfe7ef)}.copy{padding:500px 100px}",
    body: `<article class="copy">${feature}${paragraphs}</article>`,
  },
  {
    name: "landing page with viewport-fixed background",
    css: "#track{background:linear-gradient(#e9f4ff,#f8e9d0);background-attachment:fixed}.copy{padding:550px 100px}",
    body: `<article class="copy">${feature}${paragraphs}</article>`,
  },
  {
    name: "expanded accordion with real disclosure state",
    css: "details{margin:200px 60px;padding:20px;background:#eaf1f4}.detail-body{padding-top:500px}",
    body: `<details id="accordion" open><summary>Expanded details</summary><div class="detail-body">${feature}${paragraphs}</div></details>`,
  },
  {
    name: "normal-flow shadow DOM component",
    css: "#shadow-host{position:absolute;left:220px;top:1200px;width:500px;height:300px}",
    body: '<div id="shadow-host"></div>',
    script: `const shadow=document.querySelector('#shadow-host').attachShadow({mode:'open'});shadow.innerHTML='<style>.feature{width:48px;height:48px;background:rgb(92,47,151);margin:60px}</style><div id="feature" class="feature"></div>';window.matrixFeature=shadow.querySelector('#feature');`,
  },
  {
    name: "embedded non-scrolling frame content",
    css: "iframe{position:absolute;left:220px;top:1200px;width:500px;height:300px;border:0}",
    body: '<iframe id="feature" style="background:rgb(92,47,151)" srcdoc="<style>html,body{margin:0;height:100%;background:rgb(92,47,151)}</style><p>Fictional embedded content</p>"></iframe>',
  },
  {
    name: "canvas chart inside long report",
    css: "#feature{position:absolute;left:220px;top:1200px;width:500px;height:300px}",
    body: '<canvas id="feature" width="500" height="300"></canvas>',
    script: `const c=document.querySelector('#feature'),ctx=c.getContext('2d');ctx.fillStyle='rgb(92,47,151)';ctx.fillRect(0,0,500,300);`,
  },
  {
    name: "SVG diagram inside long report",
    body: '<svg style="position:absolute;left:220px;top:1200px" width="500" height="300"><rect id="feature" x="50" y="50" width="200" height="150" fill="rgb(92,47,151)"/></svg>',
  },
  {
    name: "checkout page with fixed bottom action bar",
    footer: true,
    css: ".copy{padding:500px 100px}",
    body: `<article class="copy">${feature}${paragraphs}</article>`,
  },
  {
    name: "chapter navigation with sticky heading and child",
    css: ".chapter{position:absolute;left:100px;top:700px;width:900px;height:1500px}.chapter h2{position:sticky;top:0;background:#cedeee;height:70px;margin:0}.chapter .feature{margin-top:500px}",
    body: `<section class="chapter"><h2>Chapter navigation</h2>${feature}${paragraphs}</section>`,
  },
  {
    name: "navigation stylesheet replaced during capture",
    header: true,
    dynamic: true,
    css: ".copy{padding:500px 100px}",
    body: `<article class="copy">${feature}${paragraphs}</article>`,
    script: `let replaced=false;addEventListener('scroll',()=>{if(scrollY>500&&!replaced){replaced=true;const css=document.createElement('style');css.textContent='.new-navigation{position:fixed;top:0;left:0;right:0;height:44px;background:rgb(18,59,124);z-index:1000;box-shadow:0 4px 8px #3338}';document.head.append(css);const replacement=document.createElement('header');replacement.id='top-bar';replacement.className='new-navigation';document.querySelector('#top-bar').replaceWith(replacement)}});`,
  },
  {
    name: "closed offscreen drawer does not widen document",
    css: "#drawer{position:fixed;left:100%;top:0;width:400px;height:100vh;background:red}.copy{padding:500px 100px}",
    body: `<aside id="drawer"></aside><article class="copy">${feature}${paragraphs}</article>`,
  },
  {
    name: "long unbroken URLs wrap within article",
    css: ".copy{max-width:700px;padding-top:300px;margin:auto;overflow-wrap:anywhere}",
    body: `<article class="copy"><p>https://example.invalid/${"sample-path".repeat(130)}</p>${feature}${paragraphs}</article>`,
  },
  {
    name: "tablet storefront changes grid columns",
    viewport: { width: 820, height: 900 },
    css: ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.card{height:250px;padding:20px;background:#dfeaf2}@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}}",
    body: `<main class="grid">${cards}</main>`,
  },
  {
    name: "new bottom action bar stays at the final document edge",
    footer: true,
    lateFooter: true,
    lateIDs: ["bottom-bar"],
    css: ".copy{padding:500px 100px}",
    body: `<article class="copy">${feature}${paragraphs}</article>`,
    script: `let inserted=false;addEventListener('scroll',()=>{if(scrollY>500&&!inserted){inserted=true;const bar=document.createElement('footer');bar.id='bottom-bar';document.body.append(bar)}});`,
  },
  {
    name: "new full-height sidebar spans the whole document from its top edge",
    sidebar: true,
    lateIDs: ["late-sidebar"],
    css: ".copy{padding:500px 100px}#late-sidebar{position:fixed;left:0;top:0;bottom:0;width:30px;background:rgb(36,53,42);z-index:1000}",
    body: `<article class="copy">${feature}${paragraphs}</article>`,
    script: `let inserted=false;addEventListener('scroll',()=>{if(scrollY>500&&!inserted){inserted=true;const bar=document.createElement('aside');bar.id='late-sidebar';document.body.append(bar)}});`,
  },
  {
    name: "existing absolute content keeps its document anchor when it becomes fixed",
    css: "#feature{position:absolute;left:300px;top:1300px}.pin-content #feature{position:fixed;left:300px;top:30px}",
    body: feature,
    script: `addEventListener('scroll',()=>document.body.classList.toggle('pin-content',scrollY>500));`,
  },
];

export function webpageHTML(spec) {
  const rails = Array.from(
    { length: 25 },
    (_, i) =>
      `<div class="rail" style="top:${i * 100}px;background:rgb(${railColors[i % railColors.length]})"></div>`,
  ).join("");
  return `<!doctype html><html dir="${spec.rtl ? "rtl" : "ltr"}"><meta charset="utf-8"><style>
  *{box-sizing:border-box}html,body{margin:0;font:16px Arial;background:${spec.dark ? "#171c24" : "white"};color-scheme:${spec.dark ? "dark" : "light"}}
  #track{position:relative;display:flow-root;width:${spec.width ? spec.width + "px" : "100%"};height:2500px;background:${spec.dark ? "#171c24" : "white"};isolation:isolate}
  .rail{position:absolute;left:${spec.sidebar ? 48 : 8}px;width:10px;height:100px;z-index:900;pointer-events:none}
  .feature{width:48px;height:48px;background:rgb(92,47,151)}
  #right-edge{position:absolute;right:40px;top:1800px;width:40px;height:40px;background:rgb(210,81,53);z-index:910}
  #top-bar{position:fixed;top:0;left:0;right:0;height:44px;background:rgb(18,59,124);z-index:1000;box-shadow:0 4px 8px #3338}
  #bottom-bar{position:fixed;bottom:0;left:0;right:0;height:44px;background:rgb(214,73,140);z-index:1000}
  ${spec.css || ""}
  </style><body>${spec.header ? '<header id="top-bar"></header>' : ""}<div id="track">${spec.body}${rails}<div id="right-edge"></div></div>${spec.footer && !spec.lateFooter ? '<footer id="bottom-bar"></footer>' : ""}<script>${spec.script || ""}</script></body></html>`;
}

export const railColors = [
  [40, 100, 160],
  [60, 150, 110],
  [190, 160, 70],
  [100, 130, 190],
  [176, 84, 66],
];
