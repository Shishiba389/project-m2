export type EncodableFormat = "png" | "jpg" | "webp";

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

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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
    if (byteLimit !== undefined && bytes.length > byteLimit) {
      // Reachable only from a saved workflow written before the dialog stopped
      // offering the pair. Say which of the two settings has to give.
      throw new Error(`FILE_SIZE_LIMIT_UNREACHABLE: PNG is lossless, so ${bytes.length} bytes cannot be reduced to `
        + `${options.maxBytes}. Export as JPG or WebP, or clear the size limit.`);
    }
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
