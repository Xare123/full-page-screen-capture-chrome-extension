import { scaledDimensions } from "./image-layout.js";
export { scaledDimensions } from "./image-layout.js";

// All sizes are in PDF points (72 points per inch).
const mm = (value) => (value * 72) / 25.4;
export const PAPER_SIZES = [
  {
    id: "letter",
    label: "US Letter",
    width: 612,
    height: 792,
    description: "8.5 × 11 in",
  },
  {
    id: "a4",
    label: "A4",
    width: mm(210),
    height: mm(297),
    description: "210 × 297 mm",
  },
  {
    id: "legal",
    label: "US Legal",
    width: 612,
    height: 1008,
    description: "8.5 × 14 in",
  },
  {
    id: "tabloid",
    label: "Tabloid / Ledger",
    width: 792,
    height: 1224,
    description: "11 × 17 in",
  },
  {
    id: "a3",
    label: "A3",
    width: mm(297),
    height: mm(420),
    description: "297 × 420 mm",
  },
  {
    id: "a5",
    label: "A5",
    width: mm(148),
    height: mm(210),
    description: "148 × 210 mm",
  },
  {
    id: "a6",
    label: "A6",
    width: mm(105),
    height: mm(148),
    description: "105 × 148 mm",
  },
  {
    id: "b4",
    label: "B4 (ISO)",
    width: mm(250),
    height: mm(353),
    description: "250 × 353 mm",
  },
  {
    id: "b5",
    label: "B5 (ISO)",
    width: mm(176),
    height: mm(250),
    description: "176 × 250 mm",
  },
  {
    id: "executive",
    label: "Executive",
    width: 522,
    height: 756,
    description: "7.25 × 10.5 in",
  },
  {
    id: "statement",
    label: "Half Letter",
    width: 396,
    height: 612,
    description: "5.5 × 8.5 in",
  },
  {
    id: "photo4x6",
    label: "Photo 4 × 6",
    width: 288,
    height: 432,
    description: "4 × 6 in",
    manualOnly: true,
  },
  {
    id: "photo5x7",
    label: "Photo 5 × 7",
    width: 360,
    height: 504,
    description: "5 × 7 in",
    manualOnly: true,
  },
];
export const PDF_MARGIN = 24;
export const MAX_PDF_PAGES = 500;
function imagePlan(image, page, footer) {
  const contentWidth = page.width - PDF_MARGIN * 2;
  const contentHeight = page.height - PDF_MARGIN * 2 - (footer ? 18 : 0);
  // Even one raster row must fit vertically for very narrow images.
  const drawWidth = Math.min(contentWidth, contentHeight * image.width);
  // Use this exact integer slice height for estimation and export, including fractional paper sizes.
  const sliceHeight = Math.max(
    1,
    Math.floor((contentHeight * image.width) / drawWidth),
  );
  const pages = Math.ceil(image.height / sliceHeight);
  const fill =
    (image.height * drawWidth) / image.width / (pages * contentHeight);
  const dpi = (image.width * 72) / drawWidth;
  return { ...image, page, sliceHeight, drawWidth, pages, fill, dpi };
}
function candidate(paper, orientation, images, footer) {
  const page = {
    id: paper.id,
    label: paper.label,
    orientation,
    width: orientation === "landscape" ? paper.height : paper.width,
    height: orientation === "landscape" ? paper.width : paper.height,
  };
  const plans = images.map((image) => imagePlan(image, page, footer));
  const count = plans.reduce((sum, p) => sum + p.pages, 0);
  // Favor readable width and well-filled pages; avoid needlessly large paper for small images.
  const score =
    plans.reduce(
      (sum, p) =>
        sum +
        (1 - p.fill) * 0.9 +
        Math.max(0, Math.log2(p.dpi / 160)) * 0.75 +
        Math.max(0, Math.log2(72 / p.dpi)) * 0.45 +
        Math.log2(p.pages) * 0.5,
      0,
    ) / plans.length;
  return { page, plans, count, score };
}
export function choosePDFLayout(
  images,
  { pageSize = "auto", orientation = "auto", scale = 1, footer = false } = {},
) {
  if (!images.length) throw new Error("Choose at least one image to export.");
  if (!["auto", "portrait", "landscape"].includes(orientation))
    throw new Error("Invalid page orientation.");
  const sizes = images.map((image) => scaledDimensions(image, scale));
  if (pageSize === "image") {
    const plans = sizes.map((image) => {
      const page = {
        id: "image",
        label: "Image-sized",
        orientation: image.width > image.height ? "landscape" : "portrait",
        width: image.width * 0.75 + PDF_MARGIN * 2,
        height: image.height * 0.75 + PDF_MARGIN * 2 + (footer ? 18 : 0),
      };
      if (page.width > 14400 || page.height > 14400)
        throw new Error(
          "This image is too large for a continuous PDF page. Choose a standard paper size.",
        );
      return { ...image, page, sliceHeight: image.height, pages: 1 };
    });
    return {
      page: plans[0].page,
      plans,
      count: plans.length,
      automatic: false,
      continuous: true,
    };
  }
  const papers =
    pageSize === "auto"
      ? PAPER_SIZES.filter((paper) => !paper.manualOnly)
      : PAPER_SIZES.filter((paper) => paper.id === pageSize);
  if (!papers.length) throw new Error("Choose a supported PDF paper size.");
  const orientations =
    orientation === "auto" ? ["portrait", "landscape"] : [orientation];
  const choices = papers.flatMap((paper) =>
    orientations.map((direction) => candidate(paper, direction, sizes, footer)),
  );
  choices.sort((a, b) => a.score - b.score);
  if (choices[0].count > MAX_PDF_PAGES)
    throw new Error(
      `This export would exceed ${MAX_PDF_PAGES} pages. Choose Image-sized pages or crop a smaller area.`,
    );
  return { ...choices[0], automatic: pageSize === "auto", continuous: false };
}
export function describePDFLayout(layout) {
  const count = `${layout.count} page${layout.count === 1 ? "" : "s"}`;
  if (layout.continuous)
    return `Image-sized · ${count} · one continuous page per capture part`;
  return `${layout.automatic ? "Recommended: " : ""}${layout.page.label} · ${layout.page.orientation} · ${count}`;
}
