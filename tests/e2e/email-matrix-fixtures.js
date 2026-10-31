export const readerShells = [
  {
    name: "roomy webmail",
    viewport: { width: 1440, height: 960 },
    left: 260,
    top: 115,
    width: 1060,
    height: 725,
    toolbar: "fixed",
  },
  {
    name: "split reading view",
    viewport: { width: 1280, height: 900 },
    left: 300,
    top: 150,
    width: 920,
    height: 650,
    toolbar: "absolute",
  },
  {
    name: "compact changing toolbar",
    viewport: { width: 1100, height: 800 },
    left: 195,
    top: 100,
    width: 850,
    height: 580,
    toolbar: "fixed",
    dynamic: true,
  },
];

const paragraphs = Array.from(
  { length: 7 },
  (_, i) =>
    `<p>Fictional update ${i + 1}. This example message has complete content above and below the visible reading area. The details belong to a local test fixture.</p>`,
).join("");
const coloredImage =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><path fill="#2882aa" d="M0 0h300v180H0z"/></svg>',
  );

export const rowColors = [
  [40, 100, 160],
  [60, 150, 110],
  [190, 160, 70],
  [100, 130, 190],
  [155, 90, 140],
  [80, 124, 82],
  [211, 124, 64],
  [90, 154, 176],
  [125, 97, 167],
  [183, 96, 100],
  [88, 166, 155],
  [157, 139, 84],
];

export const emailFamilies = [
  {
    name: "purchase receipt",
    html: `<h1>Your example order</h1><p>Order EXAMPLE-1042 · Paid</p><table><tr><th>Item</th><th>Amount</th></tr><tr><td>Notebook</td><td>$12.00</td></tr><tr><td>Delivery</td><td>$3.00</td></tr><tr><th>Total</th><th>$15.00</th></tr></table>${paragraphs}`,
  },
  {
    name: "newsletter with a deferred image",
    html: `<h1>The fictional monthly journal</h1><p>A responsive newsletter with an inline image loaded when its reading pane scrolls.</p><img id="email-media" width="300" height="180" alt="Fictional newsletter artwork" data-deferred="true">${paragraphs}`,
    deferredImage: true,
  },
  {
    name: "account statement table",
    html: `<h1>Example monthly statement</h1><table>${Array.from({ length: 18 }, (_, i) => `<tr><td>Entry ${i + 1}</td><td>Example merchant</td><td>$${i + 1}.00</td></tr>`).join("")}</table><p>Statement complete.</p>`,
  },
  {
    name: "expanded conversation",
    html: Array.from(
      { length: 4 },
      (_, i) =>
        `<section class="reply"><h2 style="background:${["#b5d5e8", "#c8bfe1", "#eed5a7", "#b7dcbf"][i]}">Example reply ${i + 1}</h2><p>Sender ${i + 1} · to Example Recipient</p><p>This expanded reply is included as ordinary message content.</p></section>`,
    ).join(""),
    stickyReplies: true,
  },
  {
    name: "right-to-left receipt",
    html: `<h1>إيصال طلب تجريبي</h1><p>هذه رسالة اختبار خيالية لا تحتوي على معلومات شخصية.</p><table><tr><th>المنتج</th><th>المبلغ</th></tr><tr><td>دفتر</td><td>١٢٫٠٠</td></tr></table>${paragraphs}`,
    rtl: true,
  },
  {
    name: "mixed-direction itinerary",
    html: `<h1>Example trip · رحلة تجريبية</h1><p dir="rtl">الحجز <bdi>EXAMPLE-2026</bdi> مؤكد</p><p>Departure: 08:30 · المغادرة</p><p dir="rtl">المرجع <bdi>ABC-123</bdi> والبوابة <bdi>G12</bdi></p>${paragraphs}`,
  },
  {
    name: "dark-mode notification",
    html: `<h1>Your example subscription update</h1><p>This dark-themed email includes real card borders and a real content divider.</p>${paragraphs}`,
    dark: true,
  },
  {
    name: "transparent branded email",
    html: `<h1>Fictional member update</h1><p>This reading pane is transparent over a horizontal branded background. The background must remain visible between message cards.</p>${paragraphs}`,
    transparent: true,
  },
  {
    name: "inline attachment preview",
    html: `<h1>Example attachments</h1><p>Two fictional attachment cards and an inline image.</p><div class="attachment">Example statement.pdf · 24 KB</div><div class="attachment">Example notes.txt · 1 KB</div><img id="email-media" width="300" height="180" alt="Fictional attachment preview" src="${coloredImage}">${paragraphs}`,
    image: true,
  },
  {
    name: "plain text with long links",
    html: `<h1>Example plain-text digest</h1><pre>From: sender@example.invalid\nTo: recipient@example.invalid\nSubject: Fictional technical notes\n\n${"A long line with whitespace and ordinary punctuation. ".repeat(5)}\n\nhttps://example.invalid/${"a-long-but-fictional-link-segment/".repeat(8)}\n\n${"The complete text should remain within the email card.\n".repeat(12)}</pre>`,
  },
  {
    name: "quoted reply chain",
    html: `<h1>Re: Example discussion</h1><p>Current reply.</p><blockquote><p>Example earlier reply.</p><blockquote><p>Example quoted original.</p>${paragraphs}</blockquote></blockquote>`,
  },
  {
    name: "inner reader in a scrolling wrapper",
    html: `<h1>Example long inner message</h1><p>The message scrolls independently of a wrapper that can also scroll a few pixels.</p>${paragraphs}`,
    nested: true,
  },
];

export function emailFixture(shell, family, short = false) {
  const height = short ? 200 : 1440;
  const background = family.dark ? "#20252f" : "white";
  const wrapperTop = shell.top - (family.nested ? 8 : 0);
  const wrapperHeight = shell.height + (family.nested ? 16 : 0);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:16px Arial;background:#eef2f8}
    #site-shell{position:fixed;inset:0;isolation:isolate}
    #folders{position:absolute;left:20px;top:90px;width:150px;height:${shell.height}px;overflow:auto;background:#e5ebf4}
    .folder{height:70px;padding:12px;border-bottom:1px solid #ccd5e1}
    #reader-backdrop{position:absolute;left:${shell.left}px;top:${shell.top}px;width:${shell.width}px;height:${shell.height}px;background:linear-gradient(90deg,#cde1f5,#ebf5ff);z-index:0}
    #top-toolbar{position:${shell.toolbar};left:${shell.left}px;top:${shell.top - 48}px;width:${shell.width}px;height:48px;background:white;z-index:20;box-shadow:0 6px 7px #0005;padding:12px}
    #reader-wrapper{position:absolute;left:${shell.left}px;top:${wrapperTop}px;width:${shell.width}px;height:${wrapperHeight}px;overflow:${family.nested ? "auto" : "visible"};z-index:1}
    #wrapper-spacer{height:${family.nested ? wrapperHeight + 16 : wrapperHeight}px}
    #reading-pane{position:absolute;left:0;top:${family.nested ? 8 : 0}px;width:100%;height:${shell.height}px;overflow:auto;background:${family.transparent ? "transparent" : background};direction:${family.rtl ? "rtl" : "ltr"}}
    #message-content{position:relative;width:100%;height:${height}px;direction:${family.rtl ? "rtl" : "ltr"}}
    #first-content,#last-content{position:absolute;left:0;right:0;height:20px;z-index:4}#first-content{top:0;background:#7633bc}#last-content{bottom:0;background:#e67748}
    #message-card{position:absolute;left:50px;right:50px;top:60px;height:${short ? 110 : 1300}px;border:2px solid #41556e;background:${family.dark ? "#2b3240" : "#f7f8fa"};box-shadow:0 5px 12px #0005;color:${family.dark ? "#f6f7fa" : "#25324a"};overflow:${family.stickyReplies ? "visible" : "hidden"};padding:28px}
    h1{font-size:27px;margin:0 0 20px}h2{font-size:19px}p{font-size:16px;line-height:1.5}table{border-collapse:collapse;width:100%;font-size:15px}td,th{border-bottom:1px solid #abb8ca;padding:9px;text-align:start}.reply{margin-bottom:28px;padding:10px;border:1px solid #9baac0}.reply h2{margin:0;background:${family.dark ? "#2b3240" : "#f7f8fa"}}
    ${family.stickyReplies ? ".reply h2{position:sticky;top:0}" : ""}
    blockquote{border-inline-start:3px solid #6487ab;margin-inline-start:15px;padding-inline-start:18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;font-size:14px}.attachment{border:1px solid #9baac0;border-radius:6px;margin:10px 0;padding:10px}
    #email-media{position:absolute;left:38px;top:400px;width:300px;height:180px;z-index:3}
    #real-divider{position:absolute;left:28px;right:28px;top:780px;height:2px;background:#197d55;z-index:6}
    .row-proof{position:absolute;right:8px;width:12px;height:40px;z-index:5}
  </style></head><body><div id="site-shell" data-capture-studio-paint="existing site marker">
    <aside id="folders" aria-label="Folders"><div role="navigation">${Array.from({ length: 60 }, (_, i) => `<div class="folder">Folder ${i + 1}</div>`).join("")}</div></aside>
    ${family.transparent ? '<div id="reader-backdrop"></div>' : ""}
    <div id="top-toolbar" class="message-actions" style="opacity:var(--toolbar-opacity,1)">Fictional message actions</div>
    <div id="reader-wrapper"><div id="wrapper-spacer"></div><main id="reading-pane" aria-label="Message reading area"><article id="message-content"><div id="first-content"></div><section id="message-card">${short ? family.html : family.html + '<div id="real-divider"></div>'}</section>${short ? "" : Array.from({ length: 12 }, (_, i) => `<div class="row-proof" id="row-${i}" style="top:${80 + i * 110}px;background:rgb(${rowColors[i].join(",")})"></div>`).join("")}<div id="last-content"></div></article></main></div>
  </div><script>
    const pane=document.getElementById('reading-pane');
    let revised=false;
    pane.addEventListener('scroll',()=>{
      const media=document.querySelector('[data-deferred]');
      if(media&&pane.scrollTop>300&&!media.src)media.src=${JSON.stringify(coloredImage)};
      if(${Boolean(shell.dynamic)}&&pane.scrollTop>350&&!revised){
        revised=true;
        document.getElementById('site-shell').classList.add('reader-v2');
        const sheet=document.createElement('style');
        sheet.textContent='#site-shell.reader-v2 #top-toolbar{filter:drop-shadow(0 7px 7px #888)}#site-shell.reader-v2 #top-toolbar::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:2px;background:#999}';
        document.head.append(sheet);
      }
    });
  </script></body></html>`;
}
