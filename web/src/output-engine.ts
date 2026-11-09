import { crc32, encodePng, readChunk } from "@/src/png";
import { srgbToDisplayP3, type RgbaBuffer } from "@/src/resize-core";

export type EncodableFormat = "png" | "jpg" | "webp";
export type Profile = "srgb" | "display-p3" | "rec709";
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type OutputEncoding = {
  format: EncodableFormat;
  quality: number;
  dpi?: { x: number; y: number };
  maxBytes?: number;
};

const mime = (format: EncodableFormat) => format === "jpg" ? "image/jpeg" : `image/${format}`;

async function canvasBlob(canvas: HTMLCanvasElement | OffscreenCanvas, format: EncodableFormat, quality: number) {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: mime(format), quality: quality / 100 });
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error(`${format.toUpperCase()} encoding failed`)),
    mime(format), format === "png" ? undefined : quality / 100,
  ));
}

/**
 * A canvas that works on the main thread and in a worker: an OffscreenCanvas
 * where the platform can draw on one, a document canvas otherwise.
 */
export function createCanvas(width: number, height: number, settings?: CanvasRenderingContext2DSettings): {
  canvas: OffscreenCanvas | HTMLCanvasElement; context: Canvas2D;
} {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", settings);
    if (context) return { canvas, context };
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", settings);
    if (context) return { canvas, context };
  }
  throw new Error("CANVAS_UNAVAILABLE: this browser cannot draw off screen");
}

/**
 * 8-bit RGBA on a canvas. Lossless only where alpha is 255: a canvas stores
 * colour premultiplied, so anything partly transparent is rounded on the way in.
 */
export function rgbaCanvas(image: RgbaBuffer, settings?: CanvasRenderingContext2DSettings) {
  const target = createCanvas(image.width, image.height, settings);
  const pixels = target.context.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  target.context.putImageData(pixels, 0, 0);
  return target;
}

const pngLimit = (size: number, limit: number) => new Error(
  // Reachable only from a saved workflow written before the dialog stopped
  // offering the pair. Say which of the two settings has to give.
  `FILE_SIZE_LIMIT_UNREACHABLE: PNG is lossless, so ${size} bytes cannot be reduced to `
  + `${limit}. Export as JPG or WebP, or clear the size limit.`);

/** Insert a standards-compliant PNG pHYs chunk immediately after IHDR. */
export function writePngDpi(input: Uint8Array, xDpi: number, yDpi: number) {
  if (input.length < 33 || input[0] !== 0x89 || String.fromCharCode(...input.slice(12, 16)) !== "IHDR") return input;
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  view.setUint32(8, Math.round(xDpi / 0.0254));
  view.setUint32(12, Math.round(yDpi / 0.0254));
  chunk[16] = 1;
  view.setUint32(17, crc32(chunk.slice(4, 17)));
  const output = new Uint8Array(input.length + chunk.length);
  output.set(input.slice(0, 33)); output.set(chunk, 33); output.set(input.slice(33), 54);
  return output;
}

/** Set JPEG JFIF density, inserting a JFIF APP0 segment when the encoder omitted one. */
export function writeJpegDpi(input: Uint8Array, xDpi: number, yDpi: number) {
  if (input[0] !== 0xff || input[1] !== 0xd8) return input;
  const x = Math.max(1, Math.min(65535, Math.round(xDpi)));
  const y = Math.max(1, Math.min(65535, Math.round(yDpi)));
  for (let at = 2; at + 16 < Math.min(input.length, 65536);) {
    if (input[at] !== 0xff) break;
    const marker = input[at + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const size = (input[at + 2] << 8) | input[at + 3];
    if (marker === 0xe0 && String.fromCharCode(...input.slice(at + 4, at + 9)) === "JFIF\0") {
      const output = input.slice();
      output[at + 11] = 1; output[at + 12] = x >> 8; output[at + 13] = x & 255;
      output[at + 14] = y >> 8; output[at + 15] = y & 255;
      return output;
    }
    if (size < 2) break;
    at += 2 + size;
  }
  const app0 = Uint8Array.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, x >> 8, x & 255, y >> 8, y & 255, 0, 0]);
  const output = new Uint8Array(input.length + app0.length);
  output.set(input.slice(0, 2)); output.set(app0, 2); output.set(input.slice(2), 2 + app0.length);
  return output;
}

export async function encodeOutput(canvas: HTMLCanvasElement | OffscreenCanvas, options: OutputEncoding) {
  const encode = async (quality: number) => new Uint8Array(await (await canvasBlob(canvas, options.format, quality)).arrayBuffer());
  const metadataOverhead = options.dpi ? (options.format === "png" ? 21 : options.format === "jpg" ? 18 : 0) : 0;
  const byteLimit = options.maxBytes ? Math.max(0, options.maxBytes - metadataOverhead) : undefined;
  let bytes: Uint8Array;
  if (byteLimit === undefined || options.format === "png") {
    bytes = await encode(options.quality);
    if (byteLimit !== undefined && bytes.length > byteLimit) throw pngLimit(bytes.length, options.maxBytes!);
  } else {
    bytes = await encode(options.quality);
    if (bytes.length > byteLimit) {
      let low = 1; let high = Math.max(1, options.quality); let best: Uint8Array | null = null;
      for (let pass = 0; pass < 8; pass += 1) {
        const quality = Math.floor((low + high) / 2);
        const candidate = await encode(quality);
        if (candidate.length <= byteLimit) { best = candidate; low = quality + 1; }
        else high = quality - 1;
      }
      if (!best) {
        throw new Error(`FILE_SIZE_LIMIT_UNREACHABLE: even at the lowest quality this is larger than `
          + `${options.maxBytes} bytes. Raise the limit or export at smaller dimensions.`);
      }
      bytes = best;
    }
  }
  if (options.dpi && options.format === "png") return writePngDpi(bytes, options.dpi.x, options.dpi.y);
  if (options.dpi && options.format === "jpg") return writeJpegDpi(bytes, options.dpi.x, options.dpi.y);
  return bytes;
}

let displayP3: Promise<Uint8Array | null> | null = null;
/**
 * The browser's own Display P3 profile, as an iCCP chunk body: read once out
 * of the PNG a one-pixel P3 canvas writes, so a P3 file carries exactly the
 * profile the browser itself would have given it.
 */
function displayP3Profile() {
  displayP3 ??= (async () => {
    const { canvas } = createCanvas(1, 1, { colorSpace: "display-p3" });
    return readChunk(new Uint8Array(await (await canvasBlob(canvas, "png", 100)).arrayBuffer()), "iCCP");
  })().catch(() => null);
  return displayP3;
}

/**
 * Encode finished 8-bit sRGB RGBA pixels.
 *
 * PNG is written by `encodePng`, straight from the bytes: a canvas would
 * premultiply every partly transparent pixel and round its colour away (see
 * png.ts). A Display P3 PNG is converted in software (`srgbToDisplayP3`) and
 * tagged with the browser's P3 profile. JPG and WebP have only the platform's
 * encoders, so they still go through a canvas - losslessly for JPG, which is
 * always flattened onto an opaque background first - and a P3 canvas converts
 * and tags those.
 */
export async function encodeRgba(image: RgbaBuffer, options: OutputEncoding & { profile?: Profile }) {
  const p3 = options.profile === "display-p3";
  if (options.format === "png") {
    const iccProfile = p3 ? await displayP3Profile() : null;
    // Without the profile a P3 file could not say it is P3: let the canvas write it.
    if (!p3 || iccProfile) {
      const bytes = await encodePng(p3 ? srgbToDisplayP3(image) : image, { dpi: options.dpi, iccProfile: iccProfile ?? undefined });
      if (options.maxBytes && bytes.length > options.maxBytes) throw pngLimit(bytes.length, options.maxBytes);
      return bytes;
    }
  }
  let { canvas } = rgbaCanvas(image);
  if (p3) {
    const p3 = createCanvas(image.width, image.height, { colorSpace: "display-p3" });
    p3.context.drawImage(canvas, 0, 0);
    canvas = p3.canvas;
  }
  return encodeOutput(canvas, options);
}
