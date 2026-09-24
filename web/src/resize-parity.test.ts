/**
 * Pixel parity lock for the MINIMA resampler.
 *
 * `MINIMA_IMAGE_PROCESSING_ALGORITHM.md` documents the certified pipeline:
 * sRGB-to-linear, premultiplied alpha, conditional exact-area prefilter,
 * separable Catmull–Rom bicubic, unpremultiply, linear-to-sRGB. Everything the
 * editor gained since — crop, rotation, frames, layer stacks — is geometry
 * layered on top, and none of it is allowed to disturb those pixels.
 *
 * The checksums below were taken from the implementation as it stands and are
 * a regression lock, not a derivation: if a change to the geometry engine moves
 * them, the resampler was touched when it should not have been. A deliberate
 * change to the algorithm itself updates them in the same commit that explains
 * why.
 */
import { begin } from "@/src/selfcheck";
import { prefilterDimensions, resizeRgba, type RgbaBuffer } from "@/src/resize-core";

const finish = begin();

/** FNV-1a over the output bytes: order-sensitive, and enough to catch a drift of one least-significant bit. */
function checksum(bytes: Uint8ClampedArray) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A deterministic source with structure on every channel: two gradients that
 * disagree, a hard edge that ringing would show up on, and an alpha ramp so the
 * premultiply and unpremultiply steps are both exercised.
 */
function synthetic(width: number, height: number): RgbaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const at = (y * width + x) * 4;
    const edge = x > width * 0.6 ? 255 : 0;
    data[at] = Math.round(x / Math.max(1, width - 1) * 255);
    data[at + 1] = Math.round(y / Math.max(1, height - 1) * 255);
    data[at + 2] = edge;
    data[at + 3] = Math.round(40 + (x + y) / Math.max(1, width + height - 2) * 215);
  }
  return { width, height, data };
}

const cases = [
  // Downscale past 2× on one axis only, so the area prefilter runs on height
  // and not on width — the conditional branch, not just the common path.
  { label: "partial prefilter", source: [64, 64], target: [37, 23], expected: "30c7c1f6" },
  // Hard downscale: prefilter on both axes, then bicubic.
  { label: "prefiltered downscale", source: [200, 200], target: [50, 50], expected: "e1f1f168" },
  // Upscale: no prefilter, pure Catmull–Rom, where ringing would show.
  { label: "upscale", source: [8, 8], target: [32, 32], expected: "1a906f02" },
  // A marketplace-shaped resize: portrait source into a square page.
  { label: "portrait to square", source: [180, 260], target: [96, 96], expected: "0818e0e1" },
] as const;

console.assert(prefilterDimensions(64, 64, 37, 23).width === 64, "a modest downscale skips the prefilter on that axis");
console.assert(prefilterDimensions(64, 64, 37, 23).height === 46, "and takes it on the axis that shrinks past 2x");
console.assert(prefilterDimensions(8, 8, 32, 32).width === 8, "an upscale never prefilters");

for (const item of cases) {
  const output = resizeRgba(synthetic(item.source[0], item.source[1]), item.target[0], item.target[1]);
  console.assert(output.width === item.target[0] && output.height === item.target[1], `${item.label}: output is the requested size`);
  const actual = checksum(output.data);
  console.assert(actual === item.expected,
    `${item.label}: pixels match the certified resampler (expected ${item.expected}, got ${actual})`);
}

// The resampler is a pure function: the same input twice is the same output.
// Without this, a checksum drift could be noise rather than a real change.
const twice = [resizeRgba(synthetic(64, 64), 37, 23), resizeRgba(synthetic(64, 64), 37, 23)];
console.assert(checksum(twice[0].data) === checksum(twice[1].data), "resampling is deterministic");

finish("resize-parity.test.ts");
