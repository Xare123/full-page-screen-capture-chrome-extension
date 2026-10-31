import {
  MAX_CAPTURE_PIXELS,
  MAX_DIMENSION,
  MAX_TILE_PIXELS,
  rasterRect,
} from "./core.js";

export function scaledDimensions(image, scale = 1) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1)
    throw new Error("Choose a positive image scale up to 100%.");
  const source = image.crop || image;
  if (
    ![source.width, source.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error("Invalid image dimensions.");
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

export function fitsImage({ width, height }) {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_DIMENSION &&
    height <= MAX_DIMENSION &&
    width * height <= MAX_TILE_PIXELS
  );
}

export function validatedDimensions(image) {
  if (!fitsImage(image))
    throw new Error("This image exceeds the safe editing size.");
  const crop = image.crop;
  if (
    crop &&
    (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
      crop.x < 0 ||
      crop.y < 0 ||
      crop.width <= 0 ||
      crop.height <= 0 ||
      crop.x + crop.width > image.width ||
      crop.y + crop.height > image.height)
  )
    throw new Error("The crop is outside this image.");
  return scaledDimensions(image);
}

export function captureLayout(images) {
  if (!images.length) return { reason: "missing" };
  if (images.some((image) => image.layoutChanged || image.crop))
    return { reason: "edited" };
  const tiles = images.map(({ x, y, width, height }, index) => ({
    x,
    y,
    width,
    height,
    index,
  }));
  if (
    tiles.some(
      (tile) =>
        ![tile.x, tile.y].every(
          (value) => Number.isSafeInteger(value) && value >= 0,
        ) || !fitsImage(tile),
    )
  )
    return { reason: "missing" };
  const width = Math.max(...tiles.map((tile) => tile.x + tile.width)),
    height = Math.max(...tiles.map((tile) => tile.y + tile.height));
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width * height > MAX_CAPTURE_PIXELS ||
    tiles.reduce((area, tile) => area + tile.width * tile.height, 0) !==
      width * height
  )
    return { reason: "layout" };
  const ordered = [...tiles].sort((a, b) => a.x - b.x);
  for (let i = 0; i < ordered.length; i++) {
    const a = ordered[i];
    for (let j = i + 1; j < ordered.length; j++) {
      const b = ordered[j];
      if (b.x >= a.x + a.width) break;
      if (a.y < b.y + b.height && b.y < a.y + a.height)
        return { reason: "layout" };
    }
  }
  return { width, height, tiles };
}

export function planImageExport(images, { scale = 1 } = {}) {
  if (!images.length) throw new Error("Choose at least one image to export.");
  const sizes = images.map(validatedDimensions);
  if (
    images.reduce((area, image) => area + image.width * image.height, 0) >
    MAX_CAPTURE_PIXELS
  )
    throw new Error("These images exceed the safe total source size.");
  // Validate even when a fit is needed; the requested scale must never be increased.
  scaledDimensions(sizes[0], scale);
  // A single legacy crop is resized directly from its fractional bounds.
  // Stacks instead use the rounded scale-1 raster each part actually renders.
  const singleSize = images[0].crop || sizes[0];
  let layout =
    images.length === 1
      ? {
          width: singleSize.width,
          height: singleSize.height,
          tiles: [
            {
              width: singleSize.width,
              height: singleSize.height,
              x: 0,
              y: 0,
              index: 0,
            },
          ],
        }
      : captureLayout(images);
  const reason = layout.reason;
  let layoutMode = images.length === 1 ? "single" : "original";
  if (!layout.tiles) {
    layoutMode = "stack";
    const width = Math.max(...sizes.map((size) => size.width));
    let height = 0;
    const tiles = sizes.map((size, index) => {
      const tile = {
        ...size,
        index,
        x: Math.floor((width - size.width) / 2),
        y: height,
      };
      height += size.height;
      return tile;
    });
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      !Number.isSafeInteger(width * height)
    )
      throw new Error("Invalid combined image dimensions.");
    layout = { width, height, tiles };
  }
  let effectiveScale = scale;
  if (!fitsImage(scaledDimensions(layout, scale))) {
    let lower = 0,
      upper = scale;
    // Fit against actual rounded dimensions, including one-pixel thin axes.
    for (let i = 0; i < 60; i++) {
      const middle = (lower + upper) / 2;
      if (fitsImage(scaledDimensions(layout, middle))) lower = middle;
      else upper = middle;
    }
    effectiveScale = lower;
  }
  const size = scaledDimensions(layout, effectiveScale);
  if (!fitsImage(size))
    throw new Error("The browser could not fit this image safely.");
  const tiles = layout.tiles.map((tile) => ({
    index: tile.index,
    ...rasterRect(tile, size.width / layout.width, size.height / layout.height),
  }));
  return {
    ...size,
    tiles,
    kind: "image",
    joined: images.length > 1,
    layoutMode,
    reason,
    requestedScale: scale,
    effectiveScale,
    fitted: effectiveScale < scale,
    sourceWidth: layout.width,
    sourceHeight: layout.height,
  };
}
