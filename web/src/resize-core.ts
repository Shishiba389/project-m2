/** Pixel-faithful TypeScript port of MINIMA ScaleAwareBicubicResizer.cs. */
export type RgbaBuffer = { width: number; height: number; data: Uint8ClampedArray };
export type AxisMap = { indices: Int32Array; weights: Float64Array };

export const MAX_DIMENSION = 20_000;
export const MAX_DESTINATION_PIXELS = 100_000_000;
const TINY_ALPHA = 1e-9;

export function validateDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw new Error("INVALID_OUTPUT_DIMENSIONS: width and height must be integers from 1 to 20,000");
  if (width * height > MAX_DESTINATION_PIXELS)
    throw new Error("INVALID_OUTPUT_DIMENSIONS: output exceeds 100,000,000 pixels");
}

export function prefilterDimensions(sw: number, sh: number, dw: number, dh: number) {
  return { width: sw > dw * 2 ? Math.min(sw, dw * 2) : sw, height: sh > dh * 2 ? Math.min(sh, dh * 2) : sh };
}

/**
 * Peak working memory for one resize, in bytes.
 *
 * `resizeRgba` works in linear light in `Float64Array`, which is 32 bytes a
 * pixel, so the estimate is dominated by the source: an ordinary 14-megapixel
 * product photo needs the better part of a gigabyte to pass through.
 *
 * The buffers, in the order they are alive:
 *
 *   - the source bytes, plus their linear copy, held together by `toLinear`;
 *   - *if the area prefilter runs*, its horizontal intermediate and its
 *     result, which becomes the bicubic pass's input;
 *   - the bicubic pass's horizontal intermediate and its result;
 *   - the 8-bit output.
 *
 * The two filter passes do not overlap, so the larger of them is the one that
 * counts.  The previous version of this charged the prefilter's buffers even
 * when no prefilter ran - `pre` equals the source then, so it billed twice the
 * source for nothing - and left out the bicubic result entirely.  That made it
 * over-estimate by half, and images that fit comfortably were refused as too
 * large to render.
 */
export function estimatePeakBytes(sw: number, sh: number, dw: number, dh: number) {
  const pre = prefilterDimensions(sw, sh, dw, dh);
  const output = dw * dh * 4;
  if (pre.width !== sw || pre.height !== sh) {
    // The prefilter reads the 8-bit source, so only 4 bytes a source pixel.
    const prefilterPass = sw * sh * 4 + (pre.width * sh + pre.width * pre.height) * 32;
    const bicubicPass = (pre.width * pre.height + dw * pre.height + dw * dh) * 32;
    return Math.max(prefilterPass, bicubicPass) + output;
  }
  // Without a prefilter the whole resize is one pass, straight off the bytes.
  return sw * sh * 4 + (dw * sh + dw * dh) * 32 + output;
}

export const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

/**
 * Every linear value an 8-bit channel can produce.
 *
 * `srgbToLinear(v / 255)` has 256 possible inputs, and a `**` is not cheap, so
 * the whole function collapses into a table built once. The entries are the
 * identical doubles the call returns, so nothing about the arithmetic changes -
 * it is the same number, fetched instead of recomputed.
 */
const LINEAR_FROM_BYTE = Float64Array.from({ length: 256 }, (_, value) => srgbToLinear(value / 255));
const UNIT_FROM_BYTE = Float64Array.from({ length: 256 }, (_, value) => value / 255);
export const linearToSrgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

export function cubicKernel(value: number) {
  const t = Math.abs(value);
  if (t <= 1) return 1.5 * t ** 3 - 2.5 * t ** 2 + 1;
  if (t <= 2) return -0.5 * t ** 3 + 2.5 * t ** 2 - 4 * t + 2;
  return 0;
}

export function buildBicubicAxisMap(sourceLength: number, destinationLength: number): AxisMap[] {
  const scale = sourceLength / destinationLength;
  return Array.from({ length: destinationLength }, (_, destination) => {
    const coordinate = (destination + 0.5) * scale - 0.5;
    const combined = new Map<number, number>();
    for (let source = Math.ceil(coordinate - 2); source <= Math.floor(coordinate + 2); source += 1) {
      const weight = cubicKernel(source - coordinate);
      if (weight === 0) continue;
      const index = Math.min(sourceLength - 1, Math.max(0, source));
      combined.set(index, (combined.get(index) ?? 0) + weight);
    }
    const rows = [...combined.entries()].sort((a, b) => a[0] - b[0]);
    const sum = rows.reduce((total, row) => total + row[1], 0);
    return { indices: Int32Array.from(rows.map((row) => row[0])), weights: Float64Array.from(rows.map((row) => row[1] / sum)) };
  });
}

export function buildAreaAxisMap(sourceLength: number, destinationLength: number): AxisMap[] {
  const scale = sourceLength / destinationLength;
  return Array.from({ length: destinationLength }, (_, destination) => {
    const left = destination * scale;
    const right = (destination + 1) * scale;
    const indices: number[] = [];
    const weights: number[] = [];
    for (let source = Math.floor(left); source <= Math.ceil(right) - 1; source += 1) {
      const overlap = Math.max(0, Math.min(right, source + 1) - Math.max(left, source));
      if (overlap > 0) { indices.push(Math.min(sourceLength - 1, Math.max(0, source))); weights.push(overlap / scale); }
    }
    return { indices: Int32Array.from(indices), weights: Float64Array.from(weights) };
  });
}

function horizontalPass(source: Float64Array, sw: number, sh: number, dw: number, xMap: AxisMap[]) {
  const horizontal = new Float64Array(dw * sh * 4);
  for (let y = 0; y < sh; y += 1) for (let x = 0; x < dw; x += 1) {
    const map = xMap[x]; const out = (y * dw + x) * 4;
    for (let i = 0; i < map.indices.length; i += 1) {
      const at = (y * sw + map.indices[i]) * 4; const weight = map.weights[i];
      horizontal[out] += source[at] * weight; horizontal[out + 1] += source[at + 1] * weight;
      horizontal[out + 2] += source[at + 2] * weight; horizontal[out + 3] += source[at + 3] * weight;
    }
  }
  return horizontal;
}

/**
 * The first pass, reading straight from the 8-bit source.
 *
 * Converting to linear light inside this loop, rather than materialising a
 * full-resolution `Float64Array` copy of the whole image first, is the
 * difference between 36 bytes per source pixel and 4. On a large photograph
 * that is the difference between an export that runs and one the browser
 * refuses for want of memory.
 *
 * This reads a pixel once per tap rather than once in total, which is why it
 * was worth doing only for the area prefilter until the conversion became a
 * table lookup. Now it is cheaper than the copy it replaced, on both passes.
 *
 * The arithmetic is untouched: the same `srgbToLinear(v / 255) * alpha` for the
 * same pixel, multiplied by the same weight, summed into the same accumulator
 * in the same order. The output is bit-for-bit what the two-step version
 * produced, and `resize-parity.test.ts` is what proves it.
 */
function horizontalPassFrom8Bit(source: RgbaBuffer, dw: number, xMap: AxisMap[]) {
  const { width: sw, height: sh, data } = source;
  const horizontal = new Float64Array(dw * sh * 4);
  for (let y = 0; y < sh; y += 1) for (let x = 0; x < dw; x += 1) {
    const map = xMap[x]; const out = (y * dw + x) * 4;
    for (let i = 0; i < map.indices.length; i += 1) {
      const at = (y * sw + map.indices[i]) * 4; const weight = map.weights[i];
      const alpha = UNIT_FROM_BYTE[data[at + 3]];
      horizontal[out] += LINEAR_FROM_BYTE[data[at]] * alpha * weight;
      horizontal[out + 1] += LINEAR_FROM_BYTE[data[at + 1]] * alpha * weight;
      horizontal[out + 2] += LINEAR_FROM_BYTE[data[at + 2]] * alpha * weight;
      horizontal[out + 3] += alpha * weight;
    }
  }
  return horizontal;
}

function verticalPass(horizontal: Float64Array, dw: number, dh: number, yMap: AxisMap[]) {
  const result = new Float64Array(dw * dh * 4);
  for (let y = 0; y < dh; y += 1) for (let x = 0; x < dw; x += 1) {
    const map = yMap[y]; const out = (y * dw + x) * 4;
    for (let i = 0; i < map.indices.length; i += 1) {
      const at = (map.indices[i] * dw + x) * 4; const weight = map.weights[i];
      result[out] += horizontal[at] * weight; result[out + 1] += horizontal[at + 1] * weight;
      result[out + 2] += horizontal[at + 2] * weight; result[out + 3] += horizontal[at + 3] * weight;
    }
  }
  return result;
}

function filter(source: Float64Array, sw: number, sh: number, dw: number, dh: number, xMap: AxisMap[], yMap: AxisMap[]) {
  return verticalPass(horizontalPass(source, sw, sh, dw, xMap), dw, dh, yMap);
}

function toRgba(input: Float64Array, width: number, height: number): RgbaBuffer {
  const output = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < output.length; i += 4) {
    const alpha = Math.min(1, Math.max(0, input[i + 3]));
    if (alpha < TINY_ALPHA) continue;
    output[i] = Math.round(linearToSrgb(Math.min(1, Math.max(0, input[i] / alpha))) * 255);
    output[i + 1] = Math.round(linearToSrgb(Math.min(1, Math.max(0, input[i + 1] / alpha))) * 255);
    output[i + 2] = Math.round(linearToSrgb(Math.min(1, Math.max(0, input[i + 2] / alpha))) * 255);
    output[i + 3] = Math.round(alpha * 255);
  }
  return { width, height, data: output };
}

export function resizeRgba(source: RgbaBuffer, destinationWidth: number, destinationHeight: number): RgbaBuffer {
  validateDimensions(destinationWidth, destinationHeight);
  const pre = prefilterDimensions(source.width, source.height, destinationWidth, destinationHeight);
  const prefilters = pre.width !== source.width || pre.height !== source.height;
  // Whichever pass comes first reads the 8-bit source: a source that shrinks
  // past 2x starts with the exact-area prefilter, anything else goes straight
  // to bicubic. Either way the full-resolution linear copy is never allocated,
  // which is where nearly all the memory used to go.
  const first = prefilters
    ? { width: pre.width, height: pre.height,
        x: buildAreaAxisMap(source.width, pre.width), y: buildAreaAxisMap(source.height, pre.height) }
    : { width: destinationWidth, height: destinationHeight,
        x: buildBicubicAxisMap(source.width, destinationWidth), y: buildBicubicAxisMap(source.height, destinationHeight) };
  let pixels = verticalPass(
    horizontalPassFrom8Bit(source, first.width, first.x), first.width, first.height, first.y);
  if (prefilters) {
    pixels = filter(pixels, pre.width, pre.height, destinationWidth, destinationHeight,
      buildBicubicAxisMap(pre.width, destinationWidth), buildBicubicAxisMap(pre.height, destinationHeight));
  }
  return toRgba(pixels, destinationWidth, destinationHeight);
}
