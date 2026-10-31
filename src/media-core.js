export const VIDEO_MIMES = {
  webm: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
  mp4: ["video/mp4;codecs=avc1.42001E,mp4a.40.2", "video/mp4"],
};
export function supportedVideoMime(
  format = "webm",
  supported = (type) => MediaRecorder.isTypeSupported(type),
) {
  return VIDEO_MIMES[format]?.find(supported) || "";
}
export const videoExtension = (mime) =>
  mime?.split(";")[0] === "video/mp4" ? "mp4" : "webm";
export function fitVideo(width, height, maxHeight = 1080) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Invalid video dimensions.");
  const scale = Math.min(
    1,
    maxHeight / height,
    3840 / width,
    Math.sqrt(8294400 / (width * height)),
  );
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}
export function videoRegion(region, width, height) {
  const r = region || { x: 0, y: 0, width: 1, height: 1 };
  if (
    [r.x, r.y, r.width, r.height].some((v) => !Number.isFinite(v)) ||
    r.x < 0 ||
    r.y < 0 ||
    r.width <= 0 ||
    r.height <= 0 ||
    r.x + r.width > 1.000001 ||
    r.y + r.height > 1.000001
  )
    throw new Error("Invalid video region.");
  return {
    x: r.x * width,
    y: r.y * height,
    width: r.width * width,
    height: r.height * height,
  };
}
export function validateTrim(start, end, duration) {
  if (
    ![start, end, duration].every(Number.isFinite) ||
    start < 0 ||
    end <= start ||
    end > duration + 0.05
  )
    throw new Error("Choose a valid start and end within this video.");
  return { start, end: Math.min(end, duration) };
}
// MediaRecorder's WebM header often omits Duration. Patch only the small header,
// retaining the original Blob's encoded chunks rather than copying a long video.
export async function seekableWebM(blob, seconds) {
  if (
    !blob.type.startsWith("video/webm") ||
    !Number.isFinite(seconds) ||
    seconds <= 0
  )
    return blob;
  const bytes = new Uint8Array(await blob.slice(0, 1024 * 1024).arrayBuffer());
  function vint(at, id = false) {
    if (at >= bytes.length || !bytes[at]) return null;
    let length = 1,
      mask = 128;
    while (!(bytes[at] & mask) && length < 8) {
      length++;
      mask >>= 1;
    }
    if (at + length > bytes.length) return null;
    let value = id ? bytes[at] : bytes[at] & (mask - 1),
      unknown = !id && (bytes[at] & (mask - 1)) === mask - 1;
    for (let i = 1; i < length; i++) {
      value = value * 256 + bytes[at + i];
      unknown = unknown && bytes[at + i] === 255;
    }
    return { value, length, unknown };
  }
  function element(at) {
    const id = vint(at, true),
      size = id && vint(at + id.length);
    if (!size) return null;
    return {
      id: id.value,
      at,
      data: at + id.length + size.length,
      end: at + id.length + size.length + size.value,
      size,
    };
  }
  let segment, info;
  for (let at = 0; at < bytes.length;) {
    const e = element(at);
    if (!e) break;
    if (e.id === 0x18538067) {
      segment = e;
      break;
    }
    if (e.end <= at || e.end > bytes.length) break;
    at = e.end;
  }
  if (!segment || !segment.size.unknown) return blob;
  for (let at = segment.data; at < bytes.length;) {
    const e = element(at);
    if (!e) break;
    if (e.id === 0x1549a966) {
      info = e;
      break;
    }
    if (e.end <= at || e.end > bytes.length) break;
    at = e.end;
  }
  if (!info || info.end > bytes.length || info.size.unknown) return blob;
  let scale = 1000000;
  for (let at = info.data; at < info.end;) {
    const e = element(at);
    if (!e || e.end > info.end) return blob;
    if (e.id === 0x4489) return blob;
    if (e.id === 0x2ad7b1) {
      scale = 0;
      for (let i = e.data; i < e.end; i++) scale = scale * 256 + bytes[i];
    }
    at = e.end;
  }
  const duration = new Uint8Array(11);
  duration.set([0x44, 0x89, 0x88]);
  new DataView(duration.buffer).setFloat64(3, (seconds * 1e9) / scale, false);
  const length = info.end - info.data + duration.length,
    n = info.size.length;
  if (length >= 2 ** (7 * n) - 1) return blob;
  const prefix = bytes.slice(0, info.end);
  let value = length;
  for (let i = n - 1; i >= 0; i--) {
    prefix[info.data - n + i] = value % 256;
    value = Math.floor(value / 256);
  }
  prefix[info.data - n] |= 1 << (8 - n);
  return new Blob([prefix, duration, blob.slice(info.end)], {
    type: blob.type,
  });
}
