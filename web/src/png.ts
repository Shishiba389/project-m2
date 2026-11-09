/**
 * PNG, read and written without a canvas.
 *
 * A 2D canvas keeps its pixels premultiplied by alpha, in 8 bits. Every trip
 * through one - reading a source with getImageData, writing a result with
 * putImageData before toBlob - rounds colour times alpha to a byte and divides
 * it back out. The less opaque a pixel, the less of its colour survives: at
 * alpha 1/255 a colour comes back as 0 or 255, at alpha 10 in steps of about
 * 25 levels. Product cut-outs are soft-edged and often carry a soft shadow,
 * and those are exactly the pixels it damages.
 *
 * MINIMA's resampler works unpremultiplied, in floating point. These let its
 * input and output skip the canvas when the file is a PNG, so a transparent
 * pixel keeps every byte the resampler computed for it.
 *
 * Deflate is the platform's own (`CompressionStream`), so this is filtering,
 * chunking and checksums - no compression code of its own.
 */
import type { RgbaBuffer } from "@/src/resize-core";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The PNG (and zip) CRC-32 of `bytes`. */
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Run `bytes` through the platform's zlib stream. */
async function stream(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const piped = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

const ascii = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

export const isPng = (bytes: Uint8Array) => bytes.length >= 8 && SIGNATURE.every((value, i) => bytes[i] === value);

/* ------------------------------------------------------------------ writing */

function chunk(type: string, body: Uint8Array) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** The predictor PNG's filter type 4 uses. */
function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** A filtered byte's distance from zero, read as signed: the usual measure of how well a row will compress. */
const cost = (value: number) => { const byte = value & 0xff; return byte < 128 ? byte : 256 - byte; };

/**
 * Pick the row's filter the way libpng does - the one whose output is
 * smallest as signed bytes - and write it after its type byte at `into[at]`.
 */
function filterRow(row: Uint8Array, prior: Uint8Array, bpp: number, into: Uint8Array, at: number) {
  let none = 0; let sub = 0; let up = 0; let average = 0; let predicted = 0;
  for (let i = 0; i < row.length; i += 1) {
    const x = row[i]; const a = i >= bpp ? row[i - bpp] : 0; const b = prior[i]; const c = i >= bpp ? prior[i - bpp] : 0;
    none += cost(x); sub += cost(x - a); up += cost(x - b); average += cost(x - ((a + b) >> 1)); predicted += cost(x - paeth(a, b, c));
  }
  const best = Math.min(none, sub, up, average, predicted);
  const type = best === none ? 0 : best === sub ? 1 : best === up ? 2 : best === average ? 3 : 4;
  into[at] = type;
  for (let i = 0; i < row.length; i += 1) {
    const x = row[i]; const a = i >= bpp ? row[i - bpp] : 0; const b = prior[i]; const c = i >= bpp ? prior[i - bpp] : 0;
    into[at + 1 + i] = type === 0 ? x : type === 1 ? x - a : type === 2 ? x - b : type === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, c);
  }
}

/**
 * Encode 8-bit RGBA as a PNG: RGB when every pixel is opaque, RGBA otherwise,
 * with the print density when given. The pixels are tagged sRGB, or with
 * `iccProfile` - the body of an iCCP chunk - when they are in another space.
 */
export async function encodePng(image: RgbaBuffer, options: { dpi?: { x: number; y: number }; iccProfile?: Uint8Array } = {}): Promise<Uint8Array> {
  const { width, height, data } = image;
  let opaque = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaque = false; break; }
  const channels = opaque ? 3 : 4;
  const stride = width * channels;
  const filtered = new Uint8Array(height * (stride + 1));
  let prior = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const base = y * width * 4;
    if (opaque) for (let x = 0, o = 0; x < width; x += 1, o += 3) {
      row[o] = data[base + x * 4]; row[o + 1] = data[base + x * 4 + 1]; row[o + 2] = data[base + x * 4 + 2];
    } else row.set(data.subarray(base, base + stride));
    filterRow(row, prior, channels, filtered, y * (stride + 1));
    [prior, row] = [row, prior];
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header[8] = 8; header[9] = opaque ? 2 : 6; // bit depth, colour type; compression, filter and interlace stay 0
  const parts = [Uint8Array.from(SIGNATURE), chunk("IHDR", header),
    options.iccProfile ? chunk("iCCP", options.iccProfile) : chunk("sRGB", Uint8Array.of(0))];
  if (options.dpi) {
    const density = new Uint8Array(9);
    const densityView = new DataView(density.buffer);
    densityView.setUint32(0, Math.round(options.dpi.x / 0.0254));
    densityView.setUint32(4, Math.round(options.dpi.y / 0.0254));
    density[8] = 1; // pixels per metre
    parts.push(chunk("pHYs", density));
  }
  parts.push(chunk("IDAT", await stream(filtered, new CompressionStream("deflate"))), chunk("IEND", new Uint8Array(0)));
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

/* ------------------------------------------------------------------ reading */

type Parsed = {
  width: number; height: number; bitDepth: number; colorType: number; interlace: number;
  palette?: Uint8Array; transparency?: Uint8Array; data: Uint8Array[]; types: Set<string>;
};

function parse(bytes: Uint8Array): Parsed {
  if (!isPng(bytes)) throw new Error("PNG_INVALID: not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types = new Set<string>();
  const data: Uint8Array[] = [];
  let header: Omit<Parsed, "data" | "types" | "palette" | "transparency"> | null = null;
  let palette: Uint8Array | undefined; let transparency: Uint8Array | undefined;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = ascii(bytes, at + 4);
    if (at + 12 + length > bytes.length) throw new Error("PNG_INVALID: truncated");
    if (crc32(bytes.subarray(at + 4, at + 8 + length)) !== view.getUint32(at + 8 + length)) throw new Error(`PNG_INVALID: ${type} checksum`);
    const body = bytes.subarray(at + 8, at + 8 + length);
    types.add(type);
    if (type === "IHDR") header = {
      width: view.getUint32(at + 8), height: view.getUint32(at + 12),
      bitDepth: body[8], colorType: body[9], interlace: body[12],
    };
    else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  if (!header) throw new Error("PNG_INVALID: no header");
  return { ...header, palette, transparency, data, types };
}

/** The body of the first `type` chunk in a PNG, or null. */
export function readChunk(bytes: Uint8Array, type: string): Uint8Array | null {
  if (!isPng(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    if (ascii(bytes, at + 4) === type) return at + 12 + length <= bytes.length ? bytes.slice(at + 8, at + 8 + length) : null;
    at += 12 + length;
  }
  return null;
}

/**
 * Chunks that make a browser change the pixels it decodes - a colour
 * profile, a gamma without the sRGB tag that overrides it, an orientation,
 * an animation. Those files are left to the browser, so they look the way
 * they do everywhere else on the page.
 */
const BROWSER_ONLY = ["iCCP", "eXIf", "acTL", "cICP", "mDCv", "cLLi"];

/**
 * Whether reading this PNG ourselves is better than letting a canvas read it:
 * it has transparency, which the canvas damages, and nothing that only the
 * browser can apply. An opaque PNG comes through a canvas exactly already.
 */
export function needsExactDecode(bytes: Uint8Array) {
  try {
    const { colorType, types } = parse(bytes);
    const alpha = colorType === 4 || colorType === 6 || types.has("tRNS");
    const colour = BROWSER_ONLY.some((type) => types.has(type))
      || (!types.has("sRGB") && (types.has("gAMA") || types.has("cHRM")));
    return alpha && !colour;
  } catch {
    return false;
  }
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const DEPTHS: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];
/** Past this the browser decodes it, or refuses to. */
const MAX_PIXELS = 100_000_000;

function unfilter(type: number, row: Uint8Array, prior: Uint8Array, bpp: number) {
  if (type === 0) return;
  for (let i = 0; i < row.length; i += 1) {
    const a = i >= bpp ? row[i - bpp] : 0; const b = prior[i]; const c = i >= bpp ? prior[i - bpp] : 0;
    if (type === 1) row[i] += a;
    else if (type === 2) row[i] += b;
    else if (type === 3) row[i] += (a + b) >> 1;
    else if (type === 4) row[i] += paeth(a, b, c);
    else throw new Error("PNG_INVALID: filter type");
  }
}

/** Decode any standard PNG to 8-bit unpremultiplied RGBA, exactly as stored. */
export async function decodePng(bytes: Uint8Array): Promise<RgbaBuffer> {
  const png = parse(bytes);
  const { width, height, bitDepth, colorType, interlace } = png;
  const channels = CHANNELS[colorType];
  if (!channels || !DEPTHS[colorType].includes(bitDepth) || interlace > 1) throw new Error("PNG_INVALID: header");
  if (width < 1 || height < 1 || width * height > MAX_PIXELS) throw new Error("PNG_TOO_LARGE");
  if (colorType === 3 && !png.palette) throw new Error("PNG_INVALID: no palette");

  const compressed = new Uint8Array(png.data.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of png.data) { compressed.set(part, offset); offset += part.length; }
  const inflated = await stream(compressed, new DecompressionStream("deflate"));

  const out = new Uint8ClampedArray(width * height * 4);
  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const max = (1 << bitDepth) - 1;
  const transparency = png.transparency;
  const keyed = transparency && (colorType === 0 || colorType === 2) ? Array.from({ length: colorType === 0 ? 1 : 3 },
    (_, i) => (transparency[i * 2] << 8) | transparency[i * 2 + 1]) : null;
  const to8 = (value: number) => bitDepth === 16 ? Math.round(value / 257) : bitDepth === 8 ? value : (value * 255) / max;

  const sample = (row: Uint8Array, index: number) => {
    if (bitDepth === 8) return row[index];
    if (bitDepth === 16) return (row[index * 2] << 8) | row[index * 2 + 1];
    const bit = index * bitDepth;
    return (row[bit >> 3] >> (8 - bitDepth - (bit & 7))) & max;
  };

  let at = 0;
  const pass = (xStart: number, yStart: number, xStep: number, yStep: number) => {
    const passWidth = Math.ceil((width - xStart) / xStep);
    const passHeight = Math.ceil((height - yStart) / yStep);
    if (passWidth < 1 || passHeight < 1) return;
    const rowBytes = Math.ceil((passWidth * bitsPerPixel) / 8);
    let prior = new Uint8Array(rowBytes);
    for (let y = 0; y < passHeight; y += 1) {
      if (at + 1 + rowBytes > inflated.length) throw new Error("PNG_INVALID: image data ends early");
      const row = inflated.slice(at + 1, at + 1 + rowBytes);
      unfilter(inflated[at], row, prior, bpp);
      at += 1 + rowBytes;
      const outRow = (yStart + y * yStep) * width;
      for (let x = 0; x < passWidth; x += 1) {
        const o = (outRow + xStart + x * xStep) * 4;
        const s = x * channels;
        if (colorType === 3) {
          const index = sample(row, x);
          if (index * 3 + 2 >= png.palette!.length) throw new Error("PNG_INVALID: palette index");
          out[o] = png.palette![index * 3]; out[o + 1] = png.palette![index * 3 + 1]; out[o + 2] = png.palette![index * 3 + 2];
          out[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
        } else if (colorType === 0 || colorType === 4) {
          const grey = sample(row, s);
          out[o] = out[o + 1] = out[o + 2] = to8(grey);
          out[o + 3] = colorType === 4 ? to8(sample(row, s + 1)) : keyed && grey === keyed[0] ? 0 : 255;
        } else {
          const r = sample(row, s); const g = sample(row, s + 1); const b = sample(row, s + 2);
          out[o] = to8(r); out[o + 1] = to8(g); out[o + 2] = to8(b);
          out[o + 3] = colorType === 6 ? to8(sample(row, s + 3)) : keyed && r === keyed[0] && g === keyed[1] && b === keyed[2] ? 0 : 255;
        }
      }
      prior = row;
    }
  };
  if (interlace) for (const [xStart, yStart, xStep, yStep] of ADAM7) pass(xStart, yStart, xStep, yStep);
  else pass(0, 0, 1, 1);
  return { width, height, data: out };
}
