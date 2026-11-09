import { begin } from "@/src/selfcheck";
import {
  buildAreaAxisMap, buildBicubicAxisMap, cubicKernel, estimatePeakBytes, resizeRgba, SRGB_TO_DISPLAY_P3, srgbToDisplayP3,
  srgbToLinear, transformRgba, validateDimensions,
} from "@/src/resize-core";
import { writeJpegDpi, writePngDpi } from "@/src/output-engine";

const finish = begin();
const close = (a: number, b: number, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

console.assert(srgbToLinear(0) === 0 && srgbToLinear(1) === 1, "sRGB transfer endpoints");
console.assert(cubicKernel(0) === 1 && cubicKernel(1) === 0 && cubicKernel(2) === 0, "Catmull-Rom integer taps");
for (const map of buildBicubicAxisMap(7, 11)) console.assert(close([...map.weights].reduce((a, b) => a + b, 0), 1), "bicubic taps normalize");
for (const map of buildAreaAxisMap(9, 3)) console.assert(close([...map.weights].reduce((a, b) => a + b, 0), 1), "area taps normalize");

const identity = new Uint8ClampedArray([10, 20, 30, 255, 200, 100, 50, 128, 9, 8, 7, 0, 255, 255, 255, 255]);
const same = resizeRgba({ width: 2, height: 2, data: identity }, 2, 2).data;
console.assert(same[0] === 10 && same[4] === 200 && same[7] === 128, "same-size opaque/translucent pixels round-trip");
console.assert(same[8] === 0 && same[9] === 0 && same[10] === 0 && same[11] === 0, "fully transparent RGB is removed by premultiplication");

const flat = resizeRgba({ width: 1, height: 1, data: new Uint8ClampedArray([42, 99, 201, 77]) }, 5, 3).data;
for (let i = 0; i < flat.length; i += 4) console.assert(flat[i] === 42 && flat[i + 1] === 99 && flat[i + 2] === 201 && flat[i + 3] === 77, "flat color survives resize");

const checker = new Uint8ClampedArray(4 * 4 * 4);
for (let i = 0; i < 16; i += 1) { const value = i % 2 ? 255 : 0; checker.set([value, value, value, 255], i * 4); }
const averaged = resizeRgba({ width: 4, height: 4, data: checker }, 1, 1).data[0];
console.assert(averaged === 188, "strong downscale averages in linear light, not gamma space");

const alphaEdge = resizeRgba({ width: 2, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]) }, 1, 1).data;
console.assert(alphaEdge[0] === 255 && alphaEdge[1] === 0, "premultiplied alpha prevents hidden-green fringe");
// The resize streams: what stays alive is the 8-bit source, the 8-bit output
// and a few filtered rows - never a whole image in Float64.
console.assert(estimatePeakBytes(4000, 3000, 6000, 4500) < (4000 * 3000 + 6000 * 4500) * 4 * 1.05,
  "a 12 MP enlargement costs its source and output bytes and little else");
console.assert(estimatePeakBytes(4000, 3000, 6000, 4500) < 6000 * 3000 * 32,
  "not the whole-width Float64 intermediate it used to (576 MB here)");
// The property that matters on a large photograph: shrinking it further must
// not cost more memory than shrinking it a little.
console.assert(estimatePeakBytes(4000, 3000, 400, 300) < estimatePeakBytes(4000, 3000, 2000, 1500),
  "a big source shrunk hard costs less than the same source shrunk gently");
console.assert(estimatePeakBytes(4000, 3000, 40_000, 30_000, { x: 0, y: 0, width: 1800, height: 2600 }) < estimatePeakBytes(4000, 3000, 6000, 4500),
  "a window of a huge enlargement costs the window, not the enlargement");
// The conversion is a table, so it holds exactly the values the function
// returns - that is what lets it be read once per tap instead of once per pixel.
for (const value of [0, 1, 10, 128, 254, 255]) {
  console.assert(srgbToLinear(value / 255) === Float64Array.from({ length: 256 }, (_, v) => srgbToLinear(v / 255))[value],
    `the linear table holds exactly srgbToLinear(${value}/255)`);
}

// Windows: any rectangle of the output, computed alone, is exactly those
// pixels of the full resize - with and without the prefilter, in both modes.
let state = 99;
const noise = (width: number, height: number) => ({ width, height,
  data: Uint8ClampedArray.from({ length: width * height * 4 }, () => { state = (state * 1103515245 + 12345) >>> 0; return state >>> 24; }) });
const sameWindow = (source: ReturnType<typeof noise>, dw: number, dh: number, window: { x: number; y: number; width: number; height: number }, quality: "classic" | "high") => {
  const full = resizeRgba(source, dw, dh, { quality }).data;
  const part = resizeRgba(source, dw, dh, { quality, window }).data;
  for (let y = 0; y < window.height; y += 1) for (let x = 0; x < window.width * 4; x += 1)
    if (part[y * window.width * 4 + x] !== full[((window.y + y) * dw + window.x) * 4 + x]) return false;
  return part.length === window.width * window.height * 4;
};
for (const quality of ["classic", "high"] as const) {
  console.assert(sameWindow(noise(90, 70), 20, 15, { x: 3, y: 4, width: 9, height: 7 }, quality), `${quality}: a window of a prefiltered reduction is the full resize's pixels`);
  console.assert(sameWindow(noise(30, 20), 75, 50, { x: 40, y: 0, width: 35, height: 13 }, quality), `${quality}: a window of an enlargement is the full resize's pixels`);
}
let outside = false; try { resizeRgba(noise(4, 4), 8, 8, { window: { x: 4, y: 4, width: 5, height: 1 } }); } catch { outside = true; }
console.assert(outside, "a window must lie inside the output");
// Only the window is bounded by the output caps: the picture around it may be
// far larger than any image that could be allocated whole.
console.assert(resizeRgba(noise(8, 8), 30_000, 30_000, { window: { x: 15_000, y: 15_000, width: 4, height: 4 } }).data.length === 64,
  "a window of a 900-megapixel virtual picture renders");

// High quality, the opt-in mode.
const grey = (width: number, height: number, value: (x: number) => number) => ({ width, height,
  data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : value(Math.floor(i / 4) % width)) });
const greys = (data: Uint8ClampedArray) => [...data].filter((_, i) => i % 4 === 0);
const flatHigh = resizeRgba({ width: 1, height: 1, data: new Uint8ClampedArray([42, 99, 201, 77]) }, 5, 3, { quality: "high" }).data;
for (let i = 0; i < flatHigh.length; i += 4) console.assert(flatHigh[i] === 42 && flatHigh[i + 1] === 99 && flatHigh[i + 2] === 201 && flatHigh[i + 3] === 77, "high: flat colour survives resize");
// An edge enlarged 4x: classic's negative lobes overshoot it; high stays
// between the two levels.
const step = grey(20, 4, (x) => x < 10 ? 64 : 192);
const classicStep = greys(resizeRgba(step, 80, 16).data);
const highStep = greys(resizeRgba(step, 80, 16, { quality: "high" }).data);
console.assert(Math.min(...classicStep) < 50 && Math.max(...classicStep) > 195, "classic rings around an enlarged edge (the reason high exists)");
console.assert(Math.min(...highStep) === 64 && Math.max(...highStep) === 192, "high: an enlarged edge has no halo");
// An edge reduced 3x: no dark halo either, and no softer for it.
const edge = grey(300, 4, (x) => x < 151 ? 20 : 235);
const highEdge = greys(resizeRgba(edge, 100, 4, { quality: "high" }).data);
console.assert(Math.min(...highEdge) === 20 && Math.max(...highEdge) === 235, "high: a reduced edge has no halo");
console.assert(highEdge.filter((value) => value > 20 && value < 235).length <= 4, "high: and it is still one pixel wide (four rows)");
// Detail finer than the new resolution should average away: a pattern three
// source pixels to a cycle, reduced 5x. Classic leaves a beat in it.
const fine = grey(600, 4, (x) => Math.round(127 + 100 * Math.sin((2 * Math.PI * x) / 3)));
const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
console.assert(spread(greys(resizeRgba(fine, 120, 4, { quality: "high" }).data)) * 2 < spread(greys(resizeRgba(fine, 120, 4).data)),
  "high: fine detail past the new resolution leaves under half the moire of classic");
// Classic is the default, and asking for it by name changes nothing.
const sample = noise(23, 17);
const byName = resizeRgba(sample, 9, 31, { quality: "classic" }).data;
console.assert(resizeRgba(sample, 9, 31).data.every((value, i) => value === byName[i]), "classic is the default");
let invalid = false; try { validateDimensions(20_000, 20_000); } catch { invalid = true; }
console.assert(invalid, "100 MP destination cap is enforced");

const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); png.set([0x49, 0x48, 0x44, 0x52], 12);
const pngDpi = writePngDpi(png, 300, 300);
console.assert(pngDpi.length === 54 && String.fromCharCode(...pngDpi.slice(37, 41)) === "pHYs", "PNG pHYs metadata is inserted");
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const jpegDpi = writeJpegDpi(jpeg, 300, 300);
console.assert(jpegDpi[2] === 0xff && jpegDpi[3] === 0xe0 && jpegDpi[13] === 1, "JPEG JFIF density is inserted");

// Turning and mirroring: what a canvas used to do, in linear light.
const tile = noise(6, 4);
const pixelAt = (image: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)].join();
const unturned = transformRgba(tile, 3, 2, { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, { x: 0, y: 0, width: 12, height: 8 });
console.assert(pixelAt(unturned, 3, 2) === pixelAt(tile, 0, 0) && pixelAt(unturned, 8, 5) === pixelAt(tile, 5, 3) && pixelAt(unturned, 2, 2) === "0,0,0,0",
  "untransformed, a picture is copied to its place byte for byte");
// A quarter turn about the origin: page (x, y) holds picture (y, -x - 1).
const quarter = transformRgba(tile, 0, 0, { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 }, { x: -4, y: 0, width: 4, height: 6 });
console.assert(pixelAt(quarter, 3, 0) === pixelAt(tile, 0, 0) && pixelAt(quarter, 0, 5) === pixelAt(tile, 5, 3),
  "a quarter turn moves whole pixels and filters none");
const mirrored = transformRgba(tile, 0, 0, { a: -1, b: 0, c: 0, d: 1, tx: 6, ty: 0 }, { x: 0, y: 0, width: 6, height: 4 });
console.assert([0, 1, 2, 3, 4, 5].every((x) => pixelAt(mirrored, x, 1) === pixelAt(tile, 5 - x, 1)), "a mirror is an exact mirror");
// Fine black and white stripes turned 30 degrees keep their light; a canvas,
// filtering gamma-encoded values, kept 0.31 of it where the stripes hold 0.5.
const stripes = grey(120, 120, (x) => x % 2 ? 255 : 0);
const turn = (degrees: number, cx: number, cy: number) => {
  const t = (degrees * Math.PI) / 180; const cos = Math.cos(t); const sin = Math.sin(t);
  return { a: cos, b: sin, c: -sin, d: cos, tx: cx - cos * cx + sin * cy, ty: cy - sin * cx - cos * cy };
};
const turnedStripes = transformRgba(stripes, 0, 0, turn(30, 60, 60), { x: 40, y: 40, width: 40, height: 40 });
const light = greys(turnedStripes.data).reduce((total, value) => total + srgbToLinear(value / 255), 0) / 1600;
console.assert(Math.abs(light - 0.5) < 0.01, `turned stripes keep half their light (${light.toFixed(3)}), as linear light must`);
// A turned flat colour stays exactly that colour inside, and a turned edge
// stays between its two sides.
const flatTurned = transformRgba(grey(40, 40, () => 90), 0, 0, turn(17, 20, 20), { x: 15, y: 15, width: 10, height: 10 });
console.assert(greys(flatTurned.data).every((value) => value === 90), "a turned flat colour is that colour");
const edgeTurned = greys(transformRgba(grey(40, 40, (x) => x < 20 ? 64 : 192), 0, 0, turn(23, 20, 20), { x: 8, y: 8, width: 24, height: 24 }).data);
console.assert(Math.min(...edgeTurned) === 64 && Math.max(...edgeTurned) === 192, "a turned edge has no halo");

// Display P3, worked out from the primaries: the published matrix, and the
// published P3 values of sRGB's red and green.
const published = [[0.8224621, 0.177538, 0], [0.0331941, 0.9668058, 0], [0.0170827, 0.0723974, 0.9105199]];
console.assert(SRGB_TO_DISPLAY_P3.every((row, i) => row.every((value, j) => Math.abs(value - published[i][j]) < 1e-6)), "sRGB to Display P3 is the published matrix");
const p3 = srgbToDisplayP3({ width: 5, height: 1, data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255, 77, 77, 77, 128, 200, 30, 90, 1]) }).data;
console.assert([...p3.slice(0, 8)].join() === "234,51,35,255,117,251,76,255", "sRGB red and green land where P3 puts them");
console.assert([...p3.slice(8, 16)].join() === "255,255,255,255,77,77,77,128", "white and greys do not move - both spaces are D65");
const opaqueTwin = srgbToDisplayP3({ width: 1, height: 1, data: Uint8ClampedArray.from([200, 30, 90, 255]) }).data;
console.assert(p3[19] === 1 && [...p3.slice(16, 19)].join() === [...opaqueTwin.slice(0, 3)].join(),
  "and alpha is untouched, so a nearly transparent pixel converts exactly as an opaque one");

finish("resize-core.test.ts");
