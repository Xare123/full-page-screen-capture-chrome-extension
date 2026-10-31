export const IDENTITY = [1, 0, 0, 1, 0, 0];
export function matrixPoint(matrix = IDENTITY, point) {
  const [a, b, c, d, e, f] = matrix;
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f };
}
export function inversePoint(matrix = IDENTITY, point) {
  const [a, b, c, d, e, f] = matrix,
    determinant = a * d - b * c;
  return {
    x: (d * (point.x - e) - c * (point.y - f)) / determinant,
    y: (-b * (point.x - e) + a * (point.y - f)) / determinant,
  };
}
export function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
export function inverseMatrix(matrix = IDENTITY) {
  const [a, b, c, d, e, f] = matrix,
    det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new Error("Invalid object transform.");
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}
export function affineAnnotations(annotations, matrix) {
  return annotations.map((annotation) => {
    const a = structuredClone(annotation);
    a.transform = multiply(matrix, a.transform || IDENTITY);
    if (a.clip) a.clip = coveredPixels(transformedRect(matrix, a.clip));
    if (a.type === "redact")
      a.coverage = coveredPixels(
        transformedRect(matrix, redactionBounds(annotation)),
      );
    return a;
  });
}
export function transformedRect(matrix, rect) {
  const corners = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ].map(([x, y]) => matrixPoint(matrix, { x, y }));
  const x = Math.min(...corners.map((p) => p.x)),
    y = Math.min(...corners.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...corners.map((p) => p.x)) - x,
    height: Math.max(...corners.map((p) => p.y)) - y,
  };
}
function coveredPixels(rect) {
  const x = Math.floor(rect.x),
    y = Math.floor(rect.y);
  return {
    x,
    y,
    width: Math.ceil(rect.x + rect.width) - x,
    height: Math.ceil(rect.y + rect.height) - y,
  };
}
export function redactionBounds(annotation) {
  if (annotation.coverage) return annotation.coverage;
  const r = annotation.rect;
  return coveredPixels(
    transformedRect(annotation.transform, {
      x: Math.floor(r.x),
      y: Math.floor(r.y),
      width: Math.ceil(r.width) + 1,
      height: Math.ceil(r.height) + 1,
    }),
  );
}
// These internal transforms only compose crop translation/scaling and quarter turns.
export function transformAnnotations(
  annotations,
  { crop, rotate, width, height },
) {
  const sx = crop ? width / crop.width : 1,
    sy = crop ? height / crop.height : 1;
  let transform = [sx, 0, 0, sy, -(crop?.x || 0) * sx, -(crop?.y || 0) * sy];
  if (rotate) transform = multiply([0, 1, -1, 0, height, 0], transform);
  return annotations.map((annotation) => {
    const a = structuredClone(annotation);
    a.transform = multiply(transform, a.transform || IDENTITY);
    if (a.clip) a.clip = coveredPixels(transformedRect(transform, a.clip));
    if (a.type === "redact")
      a.coverage = coveredPixels(
        transformedRect(transform, redactionBounds(annotation)),
      );
    return a;
  });
}
