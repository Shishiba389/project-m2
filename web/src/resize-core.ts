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

export function estimatePeakBytes(sw: number, sh: number, dw: number, dh: number) {
  const pre = prefilterDimensions(sw, sh, dw, dh);
  return sw * sh * 36 + Math.max(pre.width * sh + pre.width * pre.height, dw * pre.height) * 32 + dw * dh * 4;
}

export const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
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

function filter(source: Float64Array, sw: number, sh: number, dw: number, dh: number, xMap: AxisMap[], yMap: AxisMap[]) {
  const horizontal = new Float64Array(dw * sh * 4);
  for (let y = 0; y < sh; y += 1) for (let x = 0; x < dw; x += 1) {
    const map = xMap[x]; const out = (y * dw + x) * 4;
    for (let i = 0; i < map.indices.length; i += 1) {
      const at = (y * sw + map.indices[i]) * 4; const weight = map.weights[i];
      horizontal[out] += source[at] * weight; horizontal[out + 1] += source[at + 1] * weight;
      horizontal[out + 2] += source[at + 2] * weight; horizontal[out + 3] += source[at + 3] * weight;
    }
  }
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

function toLinear(input: RgbaBuffer) {
  const output = new Float64Array(input.width * input.height * 4);
  for (let i = 0; i < input.data.length; i += 4) {
    const alpha = input.data[i + 3] / 255;
    output[i] = srgbToLinear(input.data[i] / 255) * alpha;
    output[i + 1] = srgbToLinear(input.data[i + 1] / 255) * alpha;
    output[i + 2] = srgbToLinear(input.data[i + 2] / 255) * alpha;
    output[i + 3] = alpha;
  }
  return output;
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
  let pixels = toLinear(source); let width = source.width; let height = source.height;
  const pre = prefilterDimensions(width, height, destinationWidth, destinationHeight);
  if (pre.width !== width || pre.height !== height) {
    pixels = filter(pixels, width, height, pre.width, pre.height, buildAreaAxisMap(width, pre.width), buildAreaAxisMap(height, pre.height));
    width = pre.width; height = pre.height;
  }
  const resized = filter(pixels, width, height, destinationWidth, destinationHeight,
    buildBicubicAxisMap(width, destinationWidth), buildBicubicAxisMap(height, destinationHeight));
  return toRgba(resized, destinationWidth, destinationHeight);
}
