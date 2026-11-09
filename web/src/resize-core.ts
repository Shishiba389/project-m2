/**
 * Pixel-faithful TypeScript port of MINIMA ScaleAwareBicubicResizer.cs, now
 * computed one row at a time.
 *
 * "classic" is the certified pipeline - sRGB to linear light, premultiplied
 * alpha, the exact-area prefilter past 2x, separable Catmull-Rom - and its
 * output is bit-for-bit what it always was (`resize-parity.test.ts` locks it).
 * What changed is how it is computed:
 *
 *   - Streaming. The vertical pass needs only the few horizontally filtered
 *     rows its taps reach, so those are kept in a small cache and dropped once
 *     passed, instead of materialising whole-image Float64 intermediates. A
 *     12-megapixel photo went from 330-600 MB of working memory to the 8-bit
 *     source, the 8-bit output and a few rows.
 *   - Windows. Any rectangle of the output can be computed on its own, with
 *     exactly the pixels the full resize would have put there. The editor's
 *     export uses it to render only the part of a zoomed-in image that falls
 *     on the page, instead of failing on the whole enlarged picture.
 *
 * "high" is an opt-in quality mode that does change pixels, so it is never the
 * default (MINIMA_V2_BATCH_MODE_ENGINE §4 keeps the desktop behaviour as the
 * default). It widens the Catmull-Rom kernel by the reduction factor instead
 * of box-prefiltering to 2x and then filtering at a fixed width, and holds each
 * pass inside the range of the samples it covers. Measured on a zone plate:
 * 3x (at a 3x reduction) to 4x (at 5x) less moire from detail finer than the
 * new resolution, at the same sharpness, and no dark or light halo along edges
 * - enlarging or reducing - where classic overshoots by up to 30 levels.
 */
export type RgbaBuffer = { width: number; height: number; data: Uint8ClampedArray };
export type AxisMap = { indices: Int32Array; weights: Float64Array };
export type Resampling = "classic" | "high";
/** A rectangle of the output, in output pixels. */
export type ResizeWindow = { x: number; y: number; width: number; height: number };
export type ResizeOptions = { window?: ResizeWindow; quality?: Resampling };

export const MAX_DIMENSION = 20_000;
export const MAX_DESTINATION_PIXELS = 100_000_000;
/**
 * How large the *whole* output may be when only a window of it is computed:
 * an image zoomed far past the page is a large virtual picture of which only
 * the page-sized part is ever rendered, and only that part is ever built.
 * Past this the request is a mistake, not a zoom.
 */
export const MAX_VIRTUAL_DIMENSION = 400_000;
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
 * Peak working memory for one resize (or one window of it), in bytes.
 *
 * Streaming leaves three things alive together: the 8-bit source the caller
 * hands in, the 8-bit output being written, and a handful of filtered rows -
 * as many as the vertical taps reach, at 32 bytes a pixel (four Float64
 * channels). The rows are a rounding error next to the source: a 12-megapixel
 * photo is 46 MB of source, against the 330-600 MB the whole-image
 * intermediates used to cost.
 */
export function estimatePeakBytes(sw: number, sh: number, dw: number, dh: number, window?: ResizeWindow) {
  const width = window?.width ?? dw;
  const height = window?.height ?? dh;
  const taps = Math.ceil(4 * Math.max(1, sh / dh)) + 6;
  const rowWidth = Math.max(width, Math.min(sw, 2 * dw));
  return sw * sh * 4 + width * height * 4 + taps * rowWidth * 32 * 2;
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

/**
 * The axis maps build only the output samples in [from, to) - the rest of the
 * array is left empty - so a window of a huge enlargement costs the window.
 */
const mapRange = (length: number, from: number, to: number, build: (destination: number) => AxisMap) => {
  const maps: AxisMap[] = new Array(length);
  for (let destination = from; destination < to; destination += 1) maps[destination] = build(destination);
  return maps;
};

export function buildBicubicAxisMap(sourceLength: number, destinationLength: number, from = 0, to = destinationLength): AxisMap[] {
  const scale = sourceLength / destinationLength;
  return mapRange(destinationLength, from, to, (destination) => {
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

/**
 * The high-quality map: Catmull-Rom stretched by the reduction factor, so a
 * 3x reduction filters over twelve source samples instead of four - a
 * low-pass at the new resolution rather than sampling past it. Enlargements
 * use the kernel at its own width.
 */
export function buildScaledBicubicAxisMap(sourceLength: number, destinationLength: number, from = 0, to = destinationLength): AxisMap[] {
  const scale = sourceLength / destinationLength;
  const stretch = Math.max(1, scale);
  const support = 2 * stretch;
  const clampIndex = (index: number) => Math.min(sourceLength - 1, Math.max(0, index));
  return mapRange(destinationLength, from, to, (destination) => {
    const coordinate = (destination + 0.5) * scale - 0.5;
    const combined = new Map<number, number>();
    for (let source = Math.ceil(coordinate - support); source <= Math.floor(coordinate + support); source += 1) {
      const weight = cubicKernel((source - coordinate) / stretch);
      if (weight === 0) continue;
      const index = clampIndex(source);
      combined.set(index, (combined.get(index) ?? 0) + weight);
    }
    const rows = [...combined.entries()].sort((a, b) => a[0] - b[0]);
    const sum = rows.reduce((total, row) => total + row[1], 0);
    return { indices: Int32Array.from(rows.map((row) => row[0])), weights: Float64Array.from(rows.map((row) => row[1] / sum)) };
  });
}

export function buildAreaAxisMap(sourceLength: number, destinationLength: number, from = 0, to = destinationLength): AxisMap[] {
  const scale = sourceLength / destinationLength;
  return mapRange(destinationLength, from, to, (destination) => {
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

/* ---------------------------------------------------------------- streaming

   Every function below accumulates in exactly the order the whole-image
   passes did - the same products, summed into the same accumulator, tap by
   tap - so a pixel computed here is the identical double it was before. */

/**
 * A filtered image produced one row at a time. The row returned is only good
 * until the next call: the buffer is reused, and every caller consumes it at once.
 */
type Rows = (y: number) => Float64Array;
/** Fill `out` (zeroed, one row long) with filtered source row `index`. */
type RowSource = (index: number, out: Float64Array) => void;

/** The source samples [first, last + 1) that output samples [from, to) read. */
function span(map: AxisMap[], from: number, to: number): [number, number] {
  let low = Infinity; let high = -Infinity;
  for (let at = from; at < to; at += 1) {
    const { indices } = map[at];
    low = Math.min(low, indices[0]);
    high = Math.max(high, indices[indices.length - 1]);
  }
  return [low, high + 1];
}

/*
 * Anti-ringing, in the high-quality mode only: each pass's result is held
 * within the range of the samples under its kernel's positive lobe - the two
 * nearest when enlarging, the ones the output pixel covers when reducing. The
 * negative lobes still sharpen inside that range; they can no longer push an
 * edge past the darkest or lightest sample beside it, which is what draws a
 * halo. Classic never sets the flag, and its arithmetic is untouched by it.
 */

/** One source row, straight from the 8-bit bytes into linear light, filtered across columns [from, to). */
function horizontalFromBytes(source: RgbaBuffer, y: number, map: AxisMap[], from: number, to: number, out: Float64Array, antiRing: boolean) {
  const { width, data } = source;
  const base = y * width;
  for (let x = from; x < to; x += 1) {
    const map_ = map[x]; const o = (x - from) * 4;
    let lowR = Infinity; let lowG = Infinity; let lowB = Infinity; let lowA = Infinity;
    let highR = -Infinity; let highG = -Infinity; let highB = -Infinity; let highA = -Infinity;
    for (let i = 0; i < map_.indices.length; i += 1) {
      const at = (base + map_.indices[i]) * 4; const weight = map_.weights[i];
      const alpha = UNIT_FROM_BYTE[data[at + 3]];
      out[o] += LINEAR_FROM_BYTE[data[at]] * alpha * weight;
      out[o + 1] += LINEAR_FROM_BYTE[data[at + 1]] * alpha * weight;
      out[o + 2] += LINEAR_FROM_BYTE[data[at + 2]] * alpha * weight;
      out[o + 3] += alpha * weight;
      if (antiRing && weight > 0) {
        const r = LINEAR_FROM_BYTE[data[at]] * alpha; const g = LINEAR_FROM_BYTE[data[at + 1]] * alpha; const b = LINEAR_FROM_BYTE[data[at + 2]] * alpha;
        lowR = Math.min(lowR, r); lowG = Math.min(lowG, g); lowB = Math.min(lowB, b); lowA = Math.min(lowA, alpha);
        highR = Math.max(highR, r); highG = Math.max(highG, g); highB = Math.max(highB, b); highA = Math.max(highA, alpha);
      }
    }
    if (antiRing) {
      out[o] = Math.min(highR, Math.max(lowR, out[o])); out[o + 1] = Math.min(highG, Math.max(lowG, out[o + 1]));
      out[o + 2] = Math.min(highB, Math.max(lowB, out[o + 2])); out[o + 3] = Math.min(highA, Math.max(lowA, out[o + 3]));
    }
  }
}

/** One row of an already-linear image, whose first column is `offset`, filtered across [from, to). */
function horizontalFromRow(row: Float64Array, offset: number, map: AxisMap[], from: number, to: number, out: Float64Array) {
  for (let x = from; x < to; x += 1) {
    const map_ = map[x]; const o = (x - from) * 4;
    for (let i = 0; i < map_.indices.length; i += 1) {
      const at = (map_.indices[i] - offset) * 4; const weight = map_.weights[i];
      out[o] += row[at] * weight; out[o + 1] += row[at + 1] * weight;
      out[o + 2] += row[at + 2] * weight; out[o + 3] += row[at + 3] * weight;
    }
  }
}

/**
 * Filter down the columns: each output row from the horizontally filtered rows
 * its taps reach. Those rows are cached and dropped once every later output
 * row starts below them, which the maps guarantee by running forwards.
 */
function vertical(horizontal: RowSource, map: AxisMap[], length: number, antiRing = false): Rows {
  // Rows that fall out of the cache are kept for reuse: a resize allocates a
  // handful of row buffers in all, not one per source row.
  const cache = new Map<number, Float64Array>();
  const spare: Float64Array[] = [];
  const out = new Float64Array(length);
  const low = antiRing ? new Float64Array(length) : null;
  const high = antiRing ? new Float64Array(length) : null;
  const rowAt = (index: number) => {
    let row = cache.get(index);
    if (!row) {
      row = spare.pop()?.fill(0) ?? new Float64Array(length);
      horizontal(index, row); cache.set(index, row);
    }
    return row;
  };
  return (y) => {
    const map_ = map[y];
    const first = map_.indices[0];
    for (const [key, row] of cache) if (key < first) { cache.delete(key); spare.push(row); }
    out.fill(0);
    if (low && high) { low.fill(Infinity); high.fill(-Infinity); }
    for (let i = 0; i < map_.indices.length; i += 1) {
      const row = rowAt(map_.indices[i]); const weight = map_.weights[i];
      for (let j = 0; j < length; j += 1) out[j] += row[j] * weight;
      if (low && high && weight > 0) for (let j = 0; j < length; j += 1) {
        if (row[j] < low[j]) low[j] = row[j];
        if (row[j] > high[j]) high[j] = row[j];
      }
    }
    if (low && high) for (let j = 0; j < length; j += 1) out[j] = Math.min(high[j], Math.max(low[j], out[j]));
    return out;
  };
}

/** Unpremultiply, back to sRGB, to bytes: one output row into its place. */
function writeRow(row: Float64Array, output: Uint8ClampedArray, offset: number) {
  for (let i = 0; i < row.length; i += 4) {
    const alpha = Math.min(1, Math.max(0, row[i + 3]));
    if (alpha < TINY_ALPHA) continue;
    output[offset + i] = Math.round(linearToSrgb(Math.min(1, Math.max(0, row[i] / alpha))) * 255);
    output[offset + i + 1] = Math.round(linearToSrgb(Math.min(1, Math.max(0, row[i + 1] / alpha))) * 255);
    output[offset + i + 2] = Math.round(linearToSrgb(Math.min(1, Math.max(0, row[i + 2] / alpha))) * 255);
    output[offset + i + 3] = Math.round(alpha * 255);
  }
}

/**
 * Resize `source` to `destinationWidth` x `destinationHeight`, or compute only
 * `options.window` of that output. Classic (the default) is the certified
 * MINIMA pipeline, bit-for-bit; "high" is the opt-in quality mode.
 */
export function resizeRgba(source: RgbaBuffer, destinationWidth: number, destinationHeight: number, options: ResizeOptions = {}): RgbaBuffer {
  const window = options.window ?? { x: 0, y: 0, width: destinationWidth, height: destinationHeight };
  if (options.window) {
    if (!Number.isInteger(destinationWidth) || !Number.isInteger(destinationHeight) || destinationWidth < 1 || destinationHeight < 1
      || destinationWidth > MAX_VIRTUAL_DIMENSION || destinationHeight > MAX_VIRTUAL_DIMENSION)
      throw new Error("INVALID_OUTPUT_DIMENSIONS: the picture is too large to render even in part");
    if (!Number.isInteger(window.x) || !Number.isInteger(window.y) || window.x < 0 || window.y < 0
      || window.x + window.width > destinationWidth || window.y + window.height > destinationHeight)
      throw new Error("INVALID_OUTPUT_WINDOW: the window must lie inside the output");
  }
  validateDimensions(window.width, window.height);
  const x0 = window.x; const x1 = window.x + window.width;
  const y0 = window.y; const y1 = window.y + window.height;
  const lengthOf = (from: number, to: number) => (to - from) * 4;

  let rows: Rows;
  if (options.quality === "high") {
    const xMap = buildScaledBicubicAxisMap(source.width, destinationWidth, x0, x1);
    const yMap = buildScaledBicubicAxisMap(source.height, destinationHeight, y0, y1);
    rows = vertical((sy, out) => horizontalFromBytes(source, sy, xMap, x0, x1, out, true), yMap, lengthOf(x0, x1), true);
  } else {
    const pre = prefilterDimensions(source.width, source.height, destinationWidth, destinationHeight);
    if (pre.width !== source.width || pre.height !== source.height) {
      // Past 2x the exact-area prefilter runs first, but only over the
      // prefiltered columns and rows the window's bicubic taps will read.
      const xMap = buildBicubicAxisMap(pre.width, destinationWidth, x0, x1);
      const yMap = buildBicubicAxisMap(pre.height, destinationHeight, y0, y1);
      const [px0, px1] = span(xMap, x0, x1);
      const [py0, py1] = span(yMap, y0, y1);
      const areaX = buildAreaAxisMap(source.width, pre.width, px0, px1);
      const areaY = buildAreaAxisMap(source.height, pre.height, py0, py1);
      const prefiltered = vertical((sy, out) => horizontalFromBytes(source, sy, areaX, px0, px1, out, false), areaY, lengthOf(px0, px1));
      rows = vertical((py, out) => horizontalFromRow(prefiltered(py), px0, xMap, x0, x1, out), yMap, lengthOf(x0, x1));
    } else {
      const xMap = buildBicubicAxisMap(source.width, destinationWidth, x0, x1);
      const yMap = buildBicubicAxisMap(source.height, destinationHeight, y0, y1);
      rows = vertical((sy, out) => horizontalFromBytes(source, sy, xMap, x0, x1, out, false), yMap, lengthOf(x0, x1));
    }
  }

  const data = new Uint8ClampedArray(window.width * window.height * 4);
  for (let y = y0; y < y1; y += 1) writeRow(rows(y), data, (y - y0) * window.width * 4);
  return { width: window.width, height: window.height, data };
}
