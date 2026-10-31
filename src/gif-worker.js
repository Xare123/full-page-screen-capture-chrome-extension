import { GIFEncoder, quantize, applyPalette } from "gifenc";
let gif;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "start") gif = GIFEncoder();
    else if (data.type === "frame") {
      const pixels = new Uint8Array(data.pixels),
        palette = quantize(pixels, 256),
        indexed = applyPalette(pixels, palette);
      gif.writeFrame(indexed, data.width, data.height, {
        palette,
        delay: data.delay,
        repeat: 0,
      });
      self.postMessage({ type: "frame" });
    } else if (data.type === "finish") {
      gif.finish();
      const bytes = gif.bytes();
      self.postMessage({ type: "done", bytes }, [bytes.buffer]);
      gif = null;
    }
  } catch (error) {
    self.postMessage({ type: "error", error: error.message });
  }
};
