import { el, button } from "./suite-ui.js";
import { makeCanvas, renderImage, drawAnnotations } from "./graphics.js";
export async function presentBoard(project) {
  const pages = structuredClone(project.images);
  let page = 0,
    step = 0,
    generation = 0,
    base;
  const canvas = makeCanvas(1, 1),
    label = el("span", { role: "status" }),
    dialog = el("dialog", { className: "board-presenter" }),
    controls = el("div", { className: "suite-row" });
  const draw = async () => {
    const current = ++generation,
      record = pages[page],
      annotations = (record.annotations || []).filter(
        (a) => a.type !== "redact",
      ),
      masks = (record.annotations || []).filter((a) => a.type === "redact");
    if (base) {
      base.width = base.height = 1;
      base = null;
    }
    const next = await renderImage({ ...record, annotations: masks });
    if (current !== generation) {
      next.width = next.height = 1;
      return;
    }
    base = next;
    canvas.width = base.width;
    canvas.height = base.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(base, 0, 0);
    drawAnnotations(ctx, [...annotations.slice(0, step), ...masks], base);
    label.textContent = `Page ${page + 1} / ${pages.length} · Reveal ${step} / ${annotations.length}`;
  };
  const next = () => {
      const count = pages[page].annotations.filter(
        (a) => a.type !== "redact",
      ).length;
      if (step < count) step++;
      else if (page < pages.length - 1) {
        page++;
        step = 0;
      }
      void draw();
    },
    previous = () => {
      if (step > 0) step--;
      else if (page > 0) {
        page--;
        step = pages[page].annotations.filter(
          (a) => a.type !== "redact",
        ).length;
      }
      void draw();
    };
  controls.append(
    button("Previous", previous),
    label,
    button("Next reveal", next, "primary"),
    button("Show this page", () => {
      step = pages[page].annotations.filter((a) => a.type !== "redact").length;
      void draw();
    }),
    button("Close presentation", () => dialog.close()),
  );
  dialog.append(canvas, controls);
  dialog.addEventListener("keydown", (event) => {
    if (["ArrowRight", " ", "PageDown"].includes(event.key)) {
      event.preventDefault();
      next();
    }
    if (["ArrowLeft", "PageUp"].includes(event.key)) {
      event.preventDefault();
      previous();
    }
  });
  dialog.addEventListener("close", () => {
    generation++;
    if (base) base.width = base.height = 1;
    canvas.width = canvas.height = 1;
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  await draw();
}
