import { listProjects, getProject, putProject } from "./db.js";
import { makeCanvas, canvasBlob, renderImage, readImage } from "./graphics.js";
import { el, button, field, downloadBlob } from "./suite-ui.js";

export const BOARD_LIMIT = 100;
export async function boardPage(
  template = "blank",
  width = 1600,
  height = 1000,
) {
  const canvas = makeCanvas(width, height),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  if (["grid", "lined"].includes(template)) {
    for (let y = 40; y < height; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }
    if (template === "grid")
      for (let x = 40; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
  }
  const annotations = [];
  if (template === "plan") {
    for (let i = 0; i < 3; i++) {
      const x = 60 + (i * (width - 120)) / 3;
      ctx.fillStyle = ["#f4efff", "#ecf8f1", "#fff3e8"][i];
      ctx.fillRect(x, 60, (width - 180) / 3, height - 120);
      annotations.push({
        type: "text",
        text: ["Ideas", "Next steps", "Done"][i],
        x: x + 24,
        y: 88,
        width: 300,
        height: 100,
        layoutVersion: 2,
        boxWidth: Math.max(60, (width - 180) / 3 - 48),
        boxHeight: 100,
        fontSize: 32,
        fontFamily: "inter",
        fontWeight: 600,
        color: "#1f2937",
        background: "transparent",
      });
    }
  }
  const blob = await canvasBlob(canvas);
  canvas.width = canvas.height = 1;
  return { blob, width, height, annotations };
}
export async function mountWhiteboards(root, { openProject, toast, fail }) {
  const grid = el("div", { className: "suite-grid" }),
    search = el("input", {
      type: "search",
      placeholder: "Search whiteboards…",
    });
  const template = el(
    "select",
    {},
    ...[
      ["blank", "Blank"],
      ["grid", "Grid"],
      ["lined", "Lined"],
      ["plan", "Planning columns"],
    ].map(([value, text]) => el("option", { value }, text)),
  );
  const refresh = async () => {
    const query = search.value.toLocaleLowerCase(),
      items = (await listProjects()).filter(
        (p) =>
          p.mode === "whiteboard" &&
          p.title.toLocaleLowerCase().includes(query),
      );
    grid.replaceChildren(
      ...items.map((p) =>
        el(
          "article",
          { className: "suite-card" },
          el("h2", {}, p.title),
          el(
            "p",
            {},
            `${p.parts} page${p.parts === 1 ? "" : "s"} · ${new Date(p.updated).toLocaleDateString()}`,
          ),
          button("Open board", () => void openProject(p.id).catch(fail)),
        ),
      ),
    );
    if (!items.length)
      grid.append(el("p", {}, "No boards yet. Create your first page."));
  };
  const create = async () => {
    const image = await boardPage(template.value),
      id = crypto.randomUUID();
    await putProject({
      id,
      title: "Untitled whiteboard",
      source: "",
      mode: "whiteboard",
      created: Date.now(),
      updated: Date.now(),
      images: [image],
      thumbnail: image.blob,
    });
    await openProject(id);
    const state = await chrome.storage.local.get("tipWhiteboard");
    if (!state.tipWhiteboard) {
      toast(
        "Whiteboard tip: use Text to type directly, Select objects to rearrange, and Page actions to grow your board.",
      );
      await chrome.storage.local.set({ tipWhiteboard: true });
    }
  };
  const input = el("input", {
    type: "file",
    accept: ".json,application/json",
    hidden: true,
    onchange: async () => {
      const file = input.files[0];
      input.value = "";
      if (!file) return;
      try {
        const project = await importBoard(file);
        await putProject(project);
        await openProject(project.id);
        toast("Whiteboard imported locally.");
      } catch (error) {
        fail(error);
      }
    },
  });
  root.replaceChildren(
    el(
      "div",
      { className: "suite-heading" },
      el(
        "div",
        {},
        el("h1", {}, "Whiteboards"),
        el(
          "p",
          {},
          "Room for ideas, explanations and plans. Up to 100 pages per board.",
        ),
      ),
      button("Import board JSON", () => input.click()),
    ),
    el(
      "div",
      { className: "suite-row" },
      search,
      field("First page", template),
      button("Create whiteboard", () => void create().catch(fail), "primary"),
    ),
    grid,
    input,
  );
  search.addEventListener("input", () => void refresh().catch(fail));
  await refresh();
}
function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
export async function exportBoard(project) {
  const pages = [];
  for (const record of project.images) {
    const privatePage = record.annotations?.some((a) => a.type === "redact");
    let blob = record.blob,
      annotations = record.annotations || [];
    if (privatePage) {
      const canvas = await renderImage(record);
      blob = await canvasBlob(canvas);
      canvas.width = canvas.height = 1;
      annotations = [];
    }
    pages.push({
      image: await base64(blob),
      width: record.width,
      height: record.height,
      annotations: privatePage ? [] : validateAnnotations(annotations),
      flattenedForPrivacy: privatePage,
    });
  }
  downloadBlob(
    new Blob(
      [
        JSON.stringify({
          format: "capture-studio-board",
          version: 1,
          title: project.title,
          pages,
        }),
      ],
      { type: "application/json" },
    ),
    `${project.title}.board.json`,
  );
}
export function validateAnnotations(input) {
  if (!Array.isArray(input) || input.length > 5000)
    throw new Error("A board page has too many objects.");
  let points = 0;
  return input.map((a) => {
    if (
      !a ||
      typeof a !== "object" ||
      ![
        "arrow",
        "rectangle",
        "ellipse",
        "highlight",
        "pen",
        "text",
        "step",
        "redact",
        "blur",
      ].includes(a.type)
    )
      throw new Error("Unsupported board object.");
    const out = { type: a.type },
      num = (value) => {
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          Math.abs(value) > 1e7
        )
          throw new Error("Invalid board coordinates.");
        return value;
      },
      color = (value) => {
        if (
          typeof value !== "string" ||
          !/^(#[0-9a-f]{3,8}|transparent)$/i.test(value)
        )
          throw new Error("Invalid board color.");
        return value;
      };
    for (const key of [
      "x",
      "y",
      "width",
      "height",
      "size",
      "fontSize",
      "fontWeight",
      "number",
      "padding",
      "lineHeight",
      "boxWidth",
      "boxHeight",
      "layoutVersion",
      "rotation",
    ])
      if (a[key] !== undefined) out[key] = num(a[key]);
    for (const key of ["color", "background"])
      if (a[key] !== undefined) out[key] = color(a[key]);
    for (const key of ["rect", "coverage", "clip"])
      if (a[key]) {
        out[key] = {};
        for (const name of ["x", "y", "width", "height"])
          out[key][name] = num(a[key][name]);
        if (out[key].width < 0 || out[key].height < 0)
          throw new Error("Invalid object bounds.");
      }
    if (a.points) {
      if (!Array.isArray(a.points) || (points += a.points.length) > 100000)
        throw new Error("Too many drawing points.");
      out.points = a.points.map((p) => ({ x: num(p.x), y: num(p.y) }));
    }
    if (a.transform) {
      if (!Array.isArray(a.transform) || a.transform.length !== 6)
        throw new Error("Invalid object transform.");
      out.transform = a.transform.map(num);
      if (
        Math.abs(
          out.transform[0] * out.transform[3] -
            out.transform[1] * out.transform[2],
        ) < 1e-10
      )
        throw new Error("Invalid object transform.");
    }
    if (a.type === "text") {
      if (typeof a.text !== "string" || a.text.length > 20000)
        throw new Error("Invalid board text.");
      out.text = a.text;
      if (typeof a.id === "string") out.id = a.id.slice(0, 100);
      if (typeof a.legacyBaseline === "boolean")
        out.legacyBaseline = a.legacyBaseline;
      if (typeof a.legacyBox === "boolean") out.legacyBox = a.legacyBox;
      if (a.fontFamily !== undefined) {
        if (!["inter", "system", "mono"].includes(a.fontFamily))
          throw new Error("Unsupported board font.");
        out.fontFamily = a.fontFamily;
      }
      for (const key of ["bold", "italic"])
        if (typeof a[key] === "boolean") out[key] = a[key];
      if (["left", "center", "right"].includes(a.align)) out.align = a.align;
      if (["ltr", "rtl", "auto"].includes(a.direction))
        out.direction = a.direction;
      out.boxShape = a.boxShape === "callout" ? "callout" : undefined;
    }
    if (
      (a.type === "arrow" && out.points?.length !== 2) ||
      (a.type === "pen" && !out.points?.length)
    )
      throw new Error("Drawing points are missing.");
    if (
      ["rectangle", "ellipse", "highlight", "redact", "blur"].includes(
        a.type,
      ) &&
      !out.rect
    )
      throw new Error("Object bounds are missing.");
    if (
      ["text", "step"].includes(a.type) &&
      (out.x === undefined || out.y === undefined)
    )
      throw new Error("Object coordinates are missing.");
    for (const key of ["size", "fontSize", "boxWidth", "boxHeight"])
      if (out[key] !== undefined && (out[key] < 0 || out[key] > 100000))
        throw new Error("Invalid object size.");
    return out;
  });
}
export async function importBoard(file) {
  if (file.size > 100 * 1024 * 1024)
    throw new Error("Choose a board JSON below 100 MB.");
  const data = JSON.parse(await file.text());
  if (
    data.format !== "capture-studio-board" ||
    data.version !== 1 ||
    typeof data.title !== "string" ||
    !Array.isArray(data.pages) ||
    !data.pages.length ||
    data.pages.length > BOARD_LIMIT
  )
    throw new Error("Choose a Capture Studio board with 1–100 pages.");
  const images = [];
  let pixels = 0;
  for (const page of data.pages) {
    if (
      !Number.isInteger(page.width) ||
      !Number.isInteger(page.height) ||
      page.width < 1 ||
      page.height < 1 ||
      page.width > 16000 ||
      page.height > 16000 ||
      page.width * page.height > 24000000 ||
      (pixels += page.width * page.height) > 240000000
    )
      throw new Error("Board images exceed the safe size limit.");
    if (
      typeof page.image !== "string" ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(page.image)
    )
      throw new Error("Board images must be embedded PNG, JPG or WebP files.");
    const [header, encoded] = page.image.split(","),
      bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      record = await readImage(
        new Blob([bytes], { type: header.slice(5, header.indexOf(";")) }),
      );
    if (record.width !== page.width || record.height !== page.height)
      throw new Error("Board image dimensions do not match.");
    record.annotations = validateAnnotations(page.annotations || []);
    images.push(record);
  }
  return {
    id: crypto.randomUUID(),
    title: data.title.slice(0, 150) || "Imported whiteboard",
    mode: "whiteboard",
    source: "",
    created: Date.now(),
    updated: Date.now(),
    images,
    thumbnail: await safeThumbnail(images[0]),
  };
}
async function safeThumbnail(record) {
  const canvas = await renderImage(record),
    blob = await canvasBlob(canvas);
  canvas.width = canvas.height = 1;
  return blob;
}
