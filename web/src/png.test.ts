import { begin } from "@/src/selfcheck";
import { crc32, decodePng, encodePng, isPng, needsExactDecode, readChunk } from "@/src/png";

const finish = begin();
let state = 2024;
const random = () => { state = (state * 1103515245 + 12345) >>> 0; return state >>> 8; };
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((value, i) => value === b[i]);
const typesOf = (bytes: Uint8Array) => {
  const types: string[] = [];
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at);
    types.push(String.fromCharCode(...bytes.subarray(at + 4, at + 8)));
    at += 12 + length;
  }
  return types;
};

console.assert(crc32(new TextEncoder().encode("IEND")) === 0xae426082, "CRC-32 matches the value every PNG ends with");

async function main() {
  // Every byte of a transparent pixel survives, whatever its alpha.
  const rgba = { width: 37, height: 23, data: Uint8ClampedArray.from({ length: 37 * 23 * 4 }, () => random() & 255) };
  const written = await encodePng(rgba, { dpi: { x: 300, y: 300 } });
  console.assert(isPng(written) && written[25] === 6, "a transparent image is written as RGBA");
  console.assert(typesOf(written).join() === "IHDR,sRGB,pHYs,IDAT,IEND", "tagged sRGB, with its print density");
  const read = await decodePng(written);
  console.assert(read.width === 37 && read.height === 23 && same(read.data, rgba.data), "RGBA round-trips byte for byte, alpha 1 included");
  // An opaque image needs no alpha channel.
  const opaque = { width: 19, height: 11, data: Uint8ClampedArray.from({ length: 19 * 11 * 4 }, (_, i) => i % 4 === 3 ? 255 : random() & 255) };
  const opaqueFile = await encodePng(opaque);
  console.assert(opaqueFile[25] === 2 && same((await decodePng(opaqueFile)).data, opaque.data), "an opaque image is written as RGB and round-trips");
  console.assert(!typesOf(opaqueFile).includes("pHYs"), "no density chunk unless asked for");
  // Pixels in another space carry its profile instead of the sRGB tag.
  const profile = Uint8Array.from([...new TextEncoder().encode("Display P3"), 0, 0, 1, 2, 3]);
  const tagged = await encodePng(opaque, { iccProfile: profile });
  console.assert(typesOf(tagged).join() === "IHDR,iCCP,IDAT,IEND" && same(readChunk(tagged, "iCCP")!, profile),
    "a profile replaces the sRGB tag, byte for byte");
  console.assert(readChunk(opaqueFile, "iCCP") === null, "and an sRGB file has none");
  // A smooth image compresses: the adaptive filters are doing their job.
  const smooth = { width: 256, height: 256, data: Uint8ClampedArray.from({ length: 256 * 256 * 4 }, (_, i) => i % 4 === 3 ? 255 : ((i >> 2) % 256 + (i >> 10)) & 255) };
  console.assert((await encodePng(smooth)).length < 256 * 256 * 3 / 20, "a gradient compresses to under 5% of its pixels");

  // When it is worth reading a PNG ourselves.
  console.assert(needsExactDecode(written), "a transparent PNG is read exactly");
  console.assert(!needsExactDecode(opaqueFile), "an opaque one is left to the browser, which reads it exactly already");
  console.assert(!needsExactDecode(new Uint8Array([1, 2, 3])), "and so is anything that is not a PNG");
  const withChunk = (file: Uint8Array, type: string, body: Uint8Array) => {
    const piece = new Uint8Array(12 + body.length); const view = new DataView(piece.buffer);
    view.setUint32(0, body.length); for (let i = 0; i < 4; i += 1) piece[4 + i] = type.charCodeAt(i);
    piece.set(body, 8); view.setUint32(8 + body.length, crc32(piece.subarray(4, 8 + body.length)));
    const out = new Uint8Array(file.length + piece.length); out.set(file.subarray(0, 33)); out.set(piece, 33); out.set(file.subarray(33), 33 + piece.length);
    return out;
  };
  const noSrgb = await encodePng(rgba);
  const stripped = (() => { const at = 33; const length = 13; const out = new Uint8Array(noSrgb.length - length); out.set(noSrgb.subarray(0, at)); out.set(noSrgb.subarray(at + length), at); return out; })();
  console.assert(typesOf(stripped).join() === "IHDR,IDAT,IEND", "(the fixture without its sRGB tag)");
  console.assert(!needsExactDecode(withChunk(written, "iCCP", new Uint8Array(8))), "a colour profile is the browser's to apply");
  console.assert(!needsExactDecode(withChunk(written, "eXIf", new Uint8Array(8))), "so is an orientation");
  console.assert(!needsExactDecode(withChunk(stripped, "gAMA", Uint8Array.of(0, 0, 0xb1, 0x8f))), "and a gamma with no sRGB tag");
  console.assert(needsExactDecode(withChunk(written, "gAMA", Uint8Array.of(0, 0, 0xb1, 0x8f))), "a gamma beside the sRGB tag is overridden by it");
  const corrupt = written.slice(); corrupt[40] ^= 0xff;
  let refused = false; try { await decodePng(corrupt); } catch { refused = true; }
  console.assert(refused, "a damaged file is refused rather than decoded as noise");

  // Every colour type and bit depth, interlaced and not, against a writer
  // built here from the specification - not from the reader.
  const variants: [number, number][] = [[0, 1], [0, 2], [0, 4], [0, 8], [0, 16], [2, 8], [2, 16], [3, 1], [3, 2], [3, 4], [3, 8], [4, 8], [4, 16], [6, 8], [6, 16]];
  for (const [colorType, bitDepth] of variants) for (const interlace of [0, 1]) for (const [width, height] of [[13, 7], [1, 1], [9, 17]]) {
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType]!;
    const max = 2 ** bitDepth - 1;
    const samples = Array.from({ length: width * height }, () => Array.from({ length: channels }, () => random() % (max + 1)));
    const palette = Array.from({ length: (max + 1) * 3 }, () => random() & 255);
    const trns = colorType === 3 ? Array.from({ length: Math.max(1, max >> 1) }, () => random() & 255)
      : colorType === 0 ? [samples[0][0] >> 8, samples[0][0] & 255]
      : colorType === 2 ? samples[0].flatMap((value) => [value >> 8, value & 255]) : null;
    const file = await specPng(width, height, colorType, bitDepth, interlace, samples, colorType === 3 ? palette : null, trns);
    const decoded = await decodePng(file);
    const to8 = (value: number) => bitDepth === 16 ? Math.round(value / 257) : Math.round((value * 255) / max);
    const expected = samples.flatMap((pixel) => {
      if (colorType === 3) return [palette[pixel[0] * 3], palette[pixel[0] * 3 + 1], palette[pixel[0] * 3 + 2], pixel[0] < trns!.length ? trns![pixel[0]] : 255];
      if (colorType === 0) return [to8(pixel[0]), to8(pixel[0]), to8(pixel[0]), pixel[0] === samples[0][0] ? 0 : 255];
      if (colorType === 4) return [to8(pixel[0]), to8(pixel[0]), to8(pixel[0]), to8(pixel[1])];
      if (colorType === 2) return [...pixel.map(to8), pixel.every((value, i) => value === samples[0][i]) ? 0 : 255];
      return pixel.map(to8);
    });
    console.assert(decoded.width === width && decoded.height === height && same(decoded.data, expected),
      `colour type ${colorType} at ${bitDepth} bits, ${interlace ? "interlaced" : "progressive"}, ${width}x${height}`);
  }
  finish("png.test.ts");
}

/** A PNG written straight from the specification, with every filter type in turn. */
async function specPng(width: number, height: number, colorType: number, bitDepth: number, interlace: number,
  samples: number[][], palette: number[] | null, trns: number[] | null) {
  const channels = samples[0].length;
  const bpp = Math.max(1, (channels * bitDepth) >> 3);
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const stream: number[] = [];
  let rowNumber = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.ceil((width - x0) / dx); const passHeight = Math.ceil((height - y0) / dy);
    if (passWidth < 1 || passHeight < 1) continue;
    const rowBytes = Math.ceil((passWidth * channels * bitDepth) / 8);
    let prior = new Array(rowBytes).fill(0);
    for (let y = 0; y < passHeight; y += 1) {
      const raw = new Array(rowBytes).fill(0);
      let bit = 0;
      for (let x = 0; x < passWidth; x += 1) for (const value of samples[(y0 + y * dy) * width + x0 + x * dx]) {
        if (bitDepth === 16) { raw[bit >> 3] = value >> 8; raw[(bit >> 3) + 1] = value & 255; }
        else if (bitDepth === 8) raw[bit >> 3] = value;
        else raw[bit >> 3] |= value << (8 - bitDepth - (bit & 7));
        bit += bitDepth;
      }
      const type = rowNumber++ % 5;
      stream.push(type);
      for (let i = 0; i < rowBytes; i += 1) {
        const a = i >= bpp ? raw[i - bpp] : 0; const b = prior[i]; const c = i >= bpp ? prior[i - bpp] : 0;
        const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
        const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][type];
        stream.push((raw[i] - predictor) & 255);
      }
      prior = raw;
    }
  }
  const compressed = new Uint8Array(await new Response(new Blob([Uint8Array.from(stream)]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const chunks: [string, number[] | Uint8Array][] = [
    ["IHDR", [0, 0, width >> 8, width & 255, 0, 0, height >> 8, height & 255, bitDepth, colorType, 0, 0, interlace]],
    ...(palette ? [["PLTE", palette] as [string, number[]]] : []),
    ...(trns ? [["tRNS", trns] as [string, number[]]] : []),
    ["IDAT", compressed], ["IEND", []],
  ];
  const parts = [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]];
  for (const [type, body] of chunks) {
    const piece = [body.length >>> 24, (body.length >> 16) & 255, (body.length >> 8) & 255, body.length & 255, ...[...type].map((ch) => ch.charCodeAt(0)), ...body];
    const crc = crc32(Uint8Array.from(piece.slice(4)));
    parts.push([...piece, crc >>> 24, (crc >> 16) & 255, (crc >> 8) & 255, crc & 255]);
  }
  return Uint8Array.from(parts.flat());
}

void main();
