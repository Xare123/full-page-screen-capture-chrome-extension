const paths = {
  hand: '<path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 5-3 8-7 8h-1c-3 0-5-2-6-4l-3-5a2 2 0 0 1 3-2l2 2Z"/>',
  selection:
    '<rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 3"/><path d="m9 8 7 6-4 1-2 4-1-11Z"/>',
  textSelect: '<path d="M8 3h8M12 3v18m-4 0h8M5 8v8m14-8v8"/>',
  callout: '<path d="M4 3h16v13H9l-5 5V3Z"/><path d="M8 7h8m-8 4h5"/>',
  video:
    '<rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 10 6-4v12l-6-4"/>',
  board:
    '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="m8 22 4-5 4 5M7 8h5m-5 4h9"/>',
  note: '<path d="M5 3h14v13l-5 5H5V3Z"/><path d="M14 21v-5h5M8 7h8m-8 4h6"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4M9 14l6 4"/>',
  capture:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/><rect x="7" y="7" width="10" height="10" rx="2"/>',
  full: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 7h8M8 12h8M8 17h5"/>',
  visible:
    '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/>',
  region:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3"/><path d="M9 9h6v6H9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m5 19 14-14M5 5h14v14"/>',
  upload:
    '<path d="M12 16V3m-5 5 5-5 5 5M3 15v5a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-5"/>',
  download:
    '<path d="M12 3v13m-5-5 5 5 5-5M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  pdf: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6"/>',
  library: '<path d="M4 3v18M9 3v18m5-18 5 18m-9 0h10"/>',
  shield:
    '<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6l8-4Z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  undo: '<path d="M3 10h11a6 6 0 0 1 0 12M3 10l6-6m-6 6 6 6"/>',
  redo: '<path d="M21 10H10a6 6 0 0 0 0 12m11-12-6-6m6 6-6 6"/>',
  cursor: '<path d="m4 2 15 12-8 1-4 7-3-20Z"/>',
  pen: '<path d="m16 3 5 5L8 21H3v-5L16 3Zm-2 2 5 5"/>',
  rectangle: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  text: '<path d="M4 4h16M12 4v16m-4 0h8M4 4v4m16-4v4"/>',
  highlight: '<path d="m10 4 10 10-6 6L4 10l6-6ZM2 22l5-8m-3 4 4 4m9-17 3-3"/>',
  redact:
    '<rect x="3" y="5" width="18" height="14" rx="2" fill="currentColor"/><path d="M7 10h10m-10 4h7" stroke="white"/>',
  blur: '<path d="M4 4h4v4H4zm12 0h4v4h-4zM4 16h4v4H4zm12 0h4v4h-4z"/><path d="M12 3v18M3 12h18" stroke-dasharray="1 3"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  rotate: '<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  search: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
  compress:
    '<path d="M4 3v5h5M20 3v5h-5M4 21v-5h5m11 5v-5h-5M9 8 3 2m12 6 6-6M9 16l-6 6m12-6 6 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  minus: '<path d="M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  step: '<circle cx="12" cy="12" r="9"/><path d="M10 9h2v7m-2 0h4"/>',
};
export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.image}</svg>`;
}
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size) || 20);
  });
}
