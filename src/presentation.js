import { drawAnnotations } from "./graphics.js";
import {
  hitObject,
  objectBounds,
  objectHandles,
  moveObject,
  resizeObject,
} from "./objects.js";
import { setTextMeasurementRoot } from "./native-text-layout.js";

(async () => {
  if (globalThis.__captureStudioPresentation) {
    globalThis.__captureStudioPresentation.toggle();
    return;
  }
  const host = document.createElement("div");
  host.dataset.captureStudioPresentation = "";
  host.style.cssText =
    "all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;display:block!important";
  const shadow = host.attachShadow({ mode: "closed" });
  setTextMeasurementRoot(shadow);
  const make = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props))
      if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    node.append(...children);
    return node;
  };
  const css = make(
    "style",
    {},
    `:host{all:initial}*{box-sizing:border-box}button,input,select{font:13px system-ui}button{cursor:pointer;background:#fff;border:1px solid #d9d0e6;border-radius:8px;padding:8px 10px;color:#332740;white-space:nowrap}button:hover,button[aria-pressed=true]{background:#ede5ff;border-color:#a68ae2}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid #a78bfa;outline-offset:2px}.bar{position:fixed;left:24px;top:24px;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px;background:#faf8ffed;border:1px solid #c8b9dc;border-radius:12px;box-shadow:0 5px 30px #23103c24;pointer-events:auto;max-width:calc(100vw - 24px);touch-action:none;font:13px system-ui}.bar.vertical{flex-direction:column;align-items:stretch;max-height:calc(100vh - 24px);overflow:auto}.bar.small button{padding:5px 7px;font-size:11px}.bar.large button{padding:11px 13px;font-size:15px}.bar.icons button span{display:none}.launcher{position:fixed;left:20px;top:20px;pointer-events:auto;background:#7853d9;color:#fff;border:0;border-radius:50%;width:48px;height:48px}.panel{position:fixed;right:20px;top:80px;width:300px;max-width:calc(100vw - 24px);max-height:80vh;overflow:auto;padding:16px;border:1px solid #d9cce8;border-radius:12px;background:#fff;box-shadow:0 10px 35px #24103533;pointer-events:auto;color:#332740;font:13px/1.5 system-ui}.panel input,.panel select{max-width:100%;padding:8px;border:1px solid #d9cce8;border-radius:6px}.panel label{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0}.commands{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.clock{position:fixed;bottom:20px;right:20px;background:#171322ed;color:#fff;border-radius:10px;padding:12px 18px;font:600 24px system-ui;pointer-events:none}.pointer{position:fixed;width:22px;height:22px;border:3px solid #f43f5e;border-radius:50%;box-shadow:0 0 0 7px #f43f5e33;pointer-events:none}.spot{position:fixed;inset:0;pointer-events:none}.ink,.zoom{position:fixed;inset:0;width:100%;height:100%;touch-action:none}.typing{position:fixed;min-width:100px;width:280px;min-height:70px;resize:both;background:#fff0;border:2px solid #8b5cf6;border-radius:5px;padding:8px;font:500 24px/1.4 system-ui;color:#1f2937;pointer-events:auto}.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:80vw;background:#21162ee8;color:#fff;padding:12px 18px;border-radius:10px;font:13px/1.5 system-ui;pointer-events:none}[hidden]{display:none!important}`,
  );
  const canvas = make("canvas", { className: "ink" }),
    zoomCanvas = make("canvas", { className: "zoom", hidden: true }),
    spot = make("div", { className: "spot", hidden: true }),
    pointer = make("div", { className: "pointer", hidden: true }),
    clock = make("div", { className: "clock", hidden: true }),
    bar = make("div", {
      className: "bar",
      role: "toolbar",
      "aria-label": "Capture Studio page tools",
    }),
    panel = make("div", { className: "panel", hidden: true }),
    launcher = make(
      "button",
      {
        className: "launcher",
        hidden: true,
        title: "Show Capture Studio tools",
        onclick: () => minimize(false),
      },
      "CS",
    ),
    notice = make("div", { className: "toast", hidden: true, role: "status" });
  shadow.append(
    css,
    spot,
    canvas,
    pointer,
    clock,
    zoomCanvas,
    bar,
    panel,
    launcher,
    notice,
  );
  document.documentElement.append(host);
  let annotations = [],
    undo = [],
    redo = [],
    draft,
    gesture,
    selected = null,
    mode = "interact",
    color = "#7955e8",
    size = 5,
    visible = true,
    settings = {
      orientation: "horizontal",
      size: "medium",
      labels: true,
      dock: "float",
    },
    effects = {
      spotlight: false,
      pointer: false,
      fading: false,
      clock: false,
      reveal: false,
    },
    fades = [],
    masks = [],
    revealed = 0,
    mouse = { x: innerWidth / 2, y: innerHeight / 2 },
    keys = {},
    clockMode = "clock",
    deadline = 0,
    zoomImage,
    zoomScale = 2,
    toastTimer,
    ticker,
    fadeFrame;
  const ctx = canvas.getContext("2d"),
    buttons = new Map();
  const tools = [
    ["interact", "↖", "Interact"],
    ["object-select", "☷", "Select"],
    ["pen", "✎", "Draw"],
    ["arrow", "↗", "Arrow"],
    ["rectangle", "□", "Rectangle"],
    ["ellipse", "○", "Ellipse"],
    ["highlight", "▰", "Highlight"],
    ["text", "T", "Text"],
    ["redact", "▧", "Redact"],
    ["step", "①", "Step"],
    ["reveal-mask", "▣", "Reveal mask"],
  ];
  const notify = (text) => {
    clearTimeout(toastTimer);
    notice.textContent = text;
    notice.hidden = false;
    toastTimer = setTimeout(() => (notice.hidden = true), 4500);
  };
  const button = (name, glyph, action) =>
    make(
      "button",
      { type: "button", title: name, ariaLabel: name, onclick: action },
      make("b", {}, glyph),
      make("span", {}, ` ${name}`),
    );
  for (const [id, glyph, name] of tools) {
    const b = button(name, glyph, () => select(id));
    bar.append(b);
    buttons.set(id, b);
  }
  const colorInput = make("input", {
      type: "color",
      value: color,
      ariaLabel: "Drawing color",
      oninput: (e) => {
        color = e.target.value;
        if (selected !== null && annotations[selected]?.type !== "redact") {
          saveUndo();
          annotations[selected].color = color;
          draw();
        }
      },
    }),
    sizeInput = make(
      "select",
      {
        ariaLabel: "Stroke width",
        onchange: (e) => (size = Number(e.target.value)),
      },
      ...[3, 5, 10, 16].map((value) =>
        make("option", { value, selected: value === 5 }, String(value)),
      ),
    );
  bar.append(
    colorInput,
    sizeInput,
    button("Undo", "↶", () => {
      if (undo.length) {
        redo.push(structuredClone(annotations));
        annotations = undo.pop();
        selected = null;
        draw();
      }
    }),
    button("Redo", "↷", () => {
      if (redo.length) {
        undo.push(structuredClone(annotations));
        annotations = redo.pop();
        draw();
      }
    }),
    button("More", "•••", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderPanel();
    }),
    button("Minimize", "−", () => minimize(true)),
  );
  function saveUndo() {
    undo.push(structuredClone(annotations));
    if (undo.length > 35) undo.shift();
    redo = [];
  }
  function select(next) {
    commitText();
    mode = next;
    selected = null;
    for (const [id, b] of buttons)
      b.setAttribute("aria-pressed", String(id === mode));
    canvas.style.pointerEvents = mode === "interact" ? "none" : "auto";
    canvas.style.cursor =
      mode === "text"
        ? "text"
        : mode === "object-select"
          ? "default"
          : "crosshair";
    draw();
  }
  function fit() {
    const scale = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * scale);
    canvas.height = Math.round(innerHeight * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
    endZoom();
  }
  function point(event) {
    return { x: event.clientX + scrollX, y: event.clientY + scrollY };
  }
  function draw() {
    const ratio = canvas.width / innerWidth;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.save();
    ctx.translate(-scrollX, -scrollY);
    drawAnnotations(ctx, [...annotations, ...(draft ? [draft] : [])], canvas);
    if (selected !== null && annotations[selected]) {
      const r = objectBounds(ctx, annotations[selected]);
      ctx.strokeStyle = "#8b5cf6";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.setLineDash([]);
      for (const h of objectHandles(ctx, annotations[selected])) {
        ctx.fillStyle = "#fff";
        ctx.strokeRect(h.x - 4, h.y - 4, 8, 8);
        ctx.fillRect(h.x - 3, h.y - 3, 6, 6);
      }
    }
    const now = performance.now();
    fades = fades.filter((stroke) => now - stroke.at < 1500);
    for (const stroke of fades) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - (now - stroke.at) / 1500);
      drawAnnotations(ctx, [stroke.annotation], canvas);
      ctx.restore();
    }
    if (effects.reveal) {
      ctx.fillStyle = "#f7f5fc";
      for (const r of masks.slice(revealed))
        ctx.fillRect(r.x, r.y, r.width, r.height);
    }
    drawAnnotations(
      ctx,
      [...annotations, ...(draft ? [draft] : [])].filter(
        (a) => a.type === "redact",
      ),
      canvas,
    );
    ctx.restore();
    if (fades.length && !fadeFrame)
      fadeFrame = requestAnimationFrame(() => {
        fadeFrame = 0;
        draw();
      });
  }
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    commitText();
    const p = point(event);
    if (mode === "text") {
      beginText(p);
      return;
    }
    if (mode === "step") {
      saveUndo();
      annotations.push({
        type: "step",
        x: p.x,
        y: p.y,
        size,
        color,
        number:
          Math.max(
            0,
            ...annotations
              .filter((a) => a.type === "step")
              .map((a) => a.number),
          ) + 1,
      });
      draw();
      return;
    }
    if (mode === "object-select") {
      const a = annotations[selected],
        handle = a
          ? objectHandles(ctx, a).find(
              (h) => Math.hypot(p.x - h.x, p.y - h.y) < 10,
            )
          : null;
      selected = handle ? selected : hitObject(ctx, annotations, p);
      if (selected !== null)
        gesture = {
          kind: "object",
          point: p,
          index: selected,
          original: structuredClone(annotations[selected]),
          handle: handle?.name,
        };
      draw();
    } else {
      gesture = { kind: "draw", point: p };
      draft = {
        type: mode === "reveal-mask" ? "rectangle" : mode,
        color,
        size,
        points: [p, p],
        rect: { x: p.x, y: p.y, width: 0, height: 0 },
      };
    }
    if (gesture) {
      gesture.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!gesture) return;
    const p = point(event);
    if (gesture.kind === "object") {
      draft = null;
      annotations[gesture.index] = gesture.handle
        ? resizeObject(ctx, gesture.original, gesture.handle, gesture.point, p)
        : moveObject(
            gesture.original,
            p.x - gesture.point.x,
            p.y - gesture.point.y,
          );
    } else {
      if (mode === "pen") draft.points.push(p);
      else draft.points[1] = p;
      draft.rect = {
        x: Math.min(p.x, gesture.point.x),
        y: Math.min(p.y, gesture.point.y),
        width: Math.abs(p.x - gesture.point.x),
        height: Math.abs(p.y - gesture.point.y),
      };
    }
    draw();
  });
  function finishGesture(cancel = false) {
    if (!gesture) return;
    const pointerId = gesture.pointerId;
    if (gesture.kind === "object") {
      const next = annotations[gesture.index];
      annotations[gesture.index] = gesture.original;
      if (
        !cancel &&
        JSON.stringify(next) !== JSON.stringify(gesture.original)
      ) {
        saveUndo();
        annotations[gesture.index] = next;
      }
    } else if (draft && !cancel) {
      if (mode === "reveal-mask") {
        if (draft.rect.width > 2 && draft.rect.height > 2) {
          masks.push(draft.rect);
          effects.reveal = true;
        }
      } else if (effects.fading && draft.type !== "redact")
        fades.push({ at: performance.now(), annotation: draft });
      else {
        saveUndo();
        annotations.push(draft);
      }
    }
    gesture = null;
    draft = null;
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId))
      canvas.releasePointerCapture(pointerId);
    draw();
  }
  canvas.addEventListener("pointerup", () => finishGesture());
  canvas.addEventListener("pointercancel", () => finishGesture(true));
  canvas.addEventListener("lostpointercapture", () => finishGesture(true));
  let typing, typingPoint;
  function beginText(p) {
    typingPoint = p;
    typing = make("textarea", {
      className: "typing",
      ariaLabel: "Page annotation text",
      onkeydown: (event) => {
        if (
          event.key === "Escape" ||
          (event.key === "Enter" && (event.ctrlKey || event.metaKey))
        ) {
          event.preventDefault();
          commitText();
        }
      },
    });
    typing.style.left = `${p.x - scrollX}px`;
    typing.style.top = `${p.y - scrollY}px`;
    typing.style.color = color;
    typing.addEventListener("blur", () => commitText(), { once: true });
    shadow.append(typing);
    typing.focus({ preventScroll: true });
  }
  function commitText() {
    if (!typing) return;
    const node = typing;
    typing = null;
    const text = node.value,
      rect = node.getBoundingClientRect();
    node.remove();
    if (text.trim()) {
      saveUndo();
      annotations.push({
        type: "text",
        text,
        x: typingPoint.x,
        y: typingPoint.y,
        fontSize: 24,
        fontFamily: "system",
        fontWeight: 500,
        layoutVersion: 2,
        boxWidth: Math.max(60, rect.width),
        boxHeight: Math.max(70, rect.height),
        background: "transparent",
        color,
      });
      draw();
    }
  }
  function minimize(value) {
    bar.hidden = value;
    launcher.hidden = !value;
    panel.hidden = true;
    select("interact");
  }
  function applySettings() {
    bar.className = `bar ${settings.orientation === "vertical" ? "vertical" : ""} ${settings.size} ${settings.labels ? "" : "icons"}`;
    if (settings.dock !== "float") {
      bar.style.top = "12px";
      bar.style.left = settings.dock === "left" ? "12px" : "auto";
      bar.style.right = settings.dock === "right" ? "12px" : "auto";
    } else {
      bar.style.right = "auto";
      bar.style.left = `${Math.min(parseFloat(bar.style.left) || 24, innerWidth - 100)}px`;
    }
    void chrome.storage.local.set({ pageToolbar: settings });
  }
  let barDrag;
  bar.addEventListener("pointerdown", (event) => {
    if (event.target !== bar) return;
    barDrag = {
      x: event.clientX,
      y: event.clientY,
      left: bar.getBoundingClientRect().left,
      top: bar.getBoundingClientRect().top,
    };
    bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener("pointermove", (event) => {
    if (!barDrag) return;
    settings.dock = "float";
    bar.style.right = "auto";
    bar.style.left = `${Math.max(0, Math.min(innerWidth - 70, barDrag.left + event.clientX - barDrag.x))}px`;
    bar.style.top = `${Math.max(0, Math.min(innerHeight - 40, barDrag.top + event.clientY - barDrag.y))}px`;
  });
  bar.addEventListener("pointerup", () => (barDrag = null));
  bar.addEventListener("pointercancel", () => (barDrag = null));
  function toggleEffect(key) {
    effects[key] = !effects[key];
    updateEffects();
  }
  function updateEffects() {
    spot.hidden = !effects.spotlight;
    pointer.hidden = !effects.pointer;
    clock.hidden = !effects.clock;
    if (!effects.reveal) revealed = 0;
    moveEffects();
    draw();
  }
  function moveEffects() {
    spot.style.background = `radial-gradient(circle 100px at ${mouse.x}px ${mouse.y}px,transparent 75%,#111827bb 100%)`;
    pointer.style.left = `${mouse.x - 11}px`;
    pointer.style.top = `${mouse.y - 11}px`;
  }
  const commands = [
    ...tools.map(([id, , name]) => [name, () => select(id)]),
    ["Spotlight", () => toggleEffect("spotlight")],
    ["Presenter pointer", () => toggleEffect("pointer")],
    ["Fading ink", () => toggleEffect("fading")],
    [
      "Clock / countdown",
      async () => {
        toggleEffect("clock");
        const { tipClock } = await chrome.storage.local.get("tipClock");
        if (!tipClock) {
          notify(
            "Clock tip: set countdown minutes in More. Reset effects keeps your drawings.",
          );
          await chrome.storage.local.set({ tipClock: true });
        }
      },
    ],
    [
      "Next lesson reveal",
      () => {
        effects.reveal = true;
        revealed = Math.min(masks.length, revealed + 1);
        updateEffects();
      },
    ],
    [
      "Reset lesson reveal",
      () => {
        revealed = 0;
        effects.reveal = true;
        draw();
      },
    ],
    [
      "Snapshot zoom",
      () => void beginZoom().catch((error) => notify(error.message)),
    ],
    ["End zoom", endZoom],
    [
      "Save annotated view",
      () => void saveView().catch((error) => notify(error.message)),
    ],
    [
      "Duplicate selected",
      () => {
        if (selected === null) return;
        saveUndo();
        annotations.push(moveObject(annotations[selected], 24, 24));
        selected = annotations.length - 1;
        draw();
      },
    ],
    [
      "Delete selected",
      () => {
        if (selected === null) return;
        saveUndo();
        annotations.splice(selected, 1);
        selected = null;
        draw();
      },
    ],
    [
      "Reset effects (keep drawings)",
      () => {
        for (const key of Object.keys(effects)) effects[key] = false;
        fades = [];
        endZoom();
        updateEffects();
      },
    ],
    [
      "Clear drawings",
      () => {
        saveUndo();
        annotations = [];
        selected = null;
        draw();
      },
    ],
    ["Pause / resume recording", () => void recordControl("pause")],
    ["Stop recording", () => void recordControl("stop")],
    [
      "Guide & keyboard settings",
      () => void chrome.runtime.sendMessage({ type: "CS_OPEN_GUIDE" }),
    ],
  ];
  function renderPanel() {
    panel.replaceChildren(make("strong", {}, "More tools"));
    const search = make("input", {
        type: "search",
        placeholder: "Find a command…",
        ariaLabel: "Search page tools",
      }),
      matches = make("div", { className: "commands" });
    const render = () =>
      matches.replaceChildren(
        ...commands
          .filter(([name]) =>
            name.toLowerCase().includes(search.value.toLowerCase()),
          )
          .map(([name, action]) =>
            button(name, "", () => {
              action();
              panel.hidden = true;
            }),
          ),
      );
    search.addEventListener("input", render);
    panel.append(search, matches, make("h3", {}, "Active tools"));
    for (const [key, value] of Object.entries(effects)) {
      const input = make("input", {
        type: "checkbox",
        checked: value,
        onchange: () => toggleEffect(key),
      });
      panel.append(make("label", {}, key, input));
    }
    panel.append(make("h3", {}, "Toolbar"));
    for (const [key, values] of [
      ["orientation", ["horizontal", "vertical"]],
      ["size", ["small", "medium", "large"]],
      ["dock", ["float", "left", "right"]],
    ]) {
      const select = make(
        "select",
        {
          value: settings[key],
          ariaLabel: `Toolbar ${key}`,
          onchange: (event) => {
            settings[key] = event.target.value;
            applySettings();
          },
        },
        ...values.map((value) =>
          make("option", { value, selected: settings[key] === value }, value),
        ),
      );
      panel.append(make("label", {}, key, select));
    }
    panel.append(
      make(
        "label",
        {},
        "Show names",
        make("input", {
          type: "checkbox",
          checked: settings.labels,
          onchange: (event) => {
            settings.labels = event.target.checked;
            applySettings();
          },
        }),
      ),
    );
    const minutes = make("input", {
      type: "number",
      min: 1,
      max: 1440,
      value: 5,
      ariaLabel: "Countdown minutes",
    });
    panel.append(
      make("label", {}, "Countdown minutes", minutes),
      button("Start countdown", "▶", () => {
        deadline =
          Date.now() +
          Math.min(1440, Math.max(1, Number(minutes.value) || 5)) * 60000;
        clockMode = "countdown";
        effects.clock = true;
        updateEffects();
      }),
      button("Show current clock", "◷", () => {
        clockMode = "clock";
        effects.clock = true;
        updateEffects();
      }),
      make(
        "p",
        {},
        "Escape or double-click blank space to interact with the page. Drawings stay until you clear them or reload.",
      ),
    );
    render();
    search.focus();
  }
  async function snapshot() {
    commitText();
    panel.hidden = true;
    const hidden = [bar, launcher, clock, spot, pointer, notice];
    const state = hidden.map((n) => n.hidden);
    hidden.forEach((n) => (n.hidden = true));
    try {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      const response = await chrome.runtime.sendMessage({
        type: "CS_PRESENT_SNAPSHOT",
      });
      if (!response?.ok)
        throw new Error(response?.error || "Could not capture this viewport.");
      return response.data;
    } finally {
      hidden.forEach((n, i) => (n.hidden = state[i]));
    }
  }
  async function saveView() {
    const data = await snapshot(),
      a = make("a", {
        href: data,
        download: "capture-studio-annotated-view.png",
      });
    shadow.append(a);
    a.click();
    a.remove();
    notify("Annotated view downloaded as PNG.");
  }
  async function beginZoom() {
    const data = await snapshot(),
      image = new Image();
    image.src = data;
    await image.decode();
    zoomImage = image;
    zoomCanvas.width = Math.min(image.width, innerWidth * 2);
    zoomCanvas.height = Math.round(
      (zoomCanvas.width * innerHeight) / innerWidth,
    );
    zoomCanvas.hidden = false;
    zoomCanvas.style.pointerEvents = "auto";
    panel.hidden = true;
    drawZoom();
    notify(
      "Move to magnify. Wheel adjusts zoom. Scroll, resize or Escape ends zoom.",
    );
  }
  function drawZoom() {
    if (!zoomImage) return;
    const z = zoomCanvas.getContext("2d"),
      sw = zoomImage.width / zoomScale,
      sh = zoomImage.height / zoomScale,
      x = Math.max(
        0,
        Math.min(
          zoomImage.width - sw,
          (mouse.x / innerWidth) * zoomImage.width - sw / 2,
        ),
      ),
      y = Math.max(
        0,
        Math.min(
          zoomImage.height - sh,
          (mouse.y / innerHeight) * zoomImage.height - sh / 2,
        ),
      );
    z.drawImage(
      zoomImage,
      x,
      y,
      sw,
      sh,
      0,
      0,
      zoomCanvas.width,
      zoomCanvas.height,
    );
  }
  function endZoom() {
    zoomImage = null;
    zoomCanvas.hidden = true;
    zoomCanvas.width = zoomCanvas.height = 1;
  }
  zoomCanvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomScale = Math.max(
        1,
        Math.min(8, zoomScale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)),
      );
      drawZoom();
    },
    { passive: false },
  );
  async function recordControl(action) {
    const response = await chrome.runtime.sendMessage({
      type: "CS_PRESENT_RECORD_CONTROL",
      action,
    });
    if (!response?.ok) notify(response?.error || "No active recording.");
  }
  const move = (event) => {
    mouse = { x: event.clientX, y: event.clientY };
    if (effects.pointer || effects.spotlight) moveEffects();
    if (zoomImage) drawZoom();
  };
  window.addEventListener("pointermove", move, { passive: true });
  const scroll = (event) => {
    // Editing or scrolling our own UI must not commit text or end a page effect.
    if (event.composedPath().includes(host)) return;
    commitText();
    draw();
    endZoom();
  };
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("resize", fit);
  const key = (event) => {
    if (
      !visible ||
      typing ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(shadow.activeElement?.tagName) ||
      shadow.activeElement?.isContentEditable ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event
        .composedPath()
        .some(
          (node) =>
            /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) ||
            node.isContentEditable,
        )
    )
      return;
    if (event.key === "Escape") {
      finishGesture(true);
      endZoom();
      select("interact");
      panel.hidden = true;
      return;
    }
    if (
      ["Delete", "Backspace"].includes(event.key) &&
      mode === "object-select" &&
      selected !== null
    ) {
      event.preventDefault();
      commands.find(([name]) => name === "Delete selected")[1]();
      return;
    }
    const defaults = {
        interact: "v",
        "object-select": "q",
        pen: "p",
        arrow: "a",
        rectangle: "r",
        ellipse: "o",
        highlight: "h",
        text: "t",
        redact: "x",
        step: "n",
      },
      entry = Object.entries(defaults).find(
        ([id, key]) =>
          (keys[id] || key).toLowerCase() === event.key.toLowerCase(),
      );
    if (entry) {
      event.preventDefault();
      select(entry[0]);
    }
  };
  window.addEventListener("keydown", key, true);
  canvas.addEventListener("dblclick", (event) => {
    if (hitObject(ctx, annotations, point(event)) === null) {
      select("interact");
      panel.hidden = true;
    }
  });
  ticker = setInterval(() => {
    if (effects.clock) {
      if (clockMode === "countdown") {
        const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        clock.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
        if (seconds === 0 && deadline) {
          deadline = 0;
          notify("Countdown finished.");
        }
      } else clock.textContent = new Date().toLocaleTimeString();
    }
  }, 1000);
  let captureHidden = false;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (
      sender.id !== chrome.runtime.id ||
      message.type !== "CS_PRESENT_CAPTURE"
    )
      return;
    if (message.action === "hide") {
      finishGesture(false);
      commitText();
      captureHidden = true;
      host.style.setProperty("visibility", "hidden", "important");
      respond({
        ok: true,
        annotations: visible ? structuredClone(annotations) : [],
      });
    } else if (message.action === "restore") {
      if (captureHidden) {
        captureHidden = false;
        host.style.removeProperty("visibility");
      }
      respond({ ok: true });
    }
  });
  globalThis.__captureStudioPresentation = {
    toggle: () => {
      visible = !visible;
      host.style.setProperty(
        "display",
        visible ? "block" : "none",
        "important",
      );
      if (!visible) {
        select("interact");
        endZoom();
      }
    },
  };
  // Initialize interaction synchronously. Restoring preferences can finish after
  // the first click; it must not reset the user's chosen tool or active text.
  fit();
  select("interact");
  const loaded = await chrome.storage.local.get(["pageToolbar", "drawingKeys"]);
  if (loaded.pageToolbar) {
    const next = loaded.pageToolbar;
    if (["horizontal", "vertical"].includes(next.orientation))
      settings.orientation = next.orientation;
    if (["small", "medium", "large"].includes(next.size))
      settings.size = next.size;
    if (["float", "left", "right"].includes(next.dock))
      settings.dock = next.dock;
    settings.labels = next.labels !== false;
  }
  keys = loaded.drawingKeys || {};
  applySettings();
  window.addEventListener(
    "pagehide",
    (event) => {
      if (captureHidden) {
        captureHidden = false;
        host.style.removeProperty("visibility");
      }
      if (event.persisted) return;
      clearInterval(ticker);
      cancelAnimationFrame(fadeFrame);
      clearTimeout(toastTimer);
      host.remove();
    },
    { once: true },
  );
})();
