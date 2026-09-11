import { begin } from "@/src/selfcheck";
import { buildAreaAxisMap, buildBicubicAxisMap, cubicKernel, estimatePeakBytes, resizeRgba, srgbToLinear, validateDimensions } from "@/src/resize-core";
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
console.assert(estimatePeakBytes(100, 100, 50, 50) === 100 * 100 * 36 + Math.max(100 * 100 + 100 * 100, 50 * 100) * 32 + 50 * 50 * 4, "memory formula is exact");
let invalid = false; try { validateDimensions(20_000, 20_000); } catch { invalid = true; }
console.assert(invalid, "100 MP destination cap is enforced");

const png = new Uint8Array(33); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); png.set([0x49, 0x48, 0x44, 0x52], 12);
const pngDpi = writePngDpi(png, 300, 300);
console.assert(pngDpi.length === 54 && String.fromCharCode(...pngDpi.slice(37, 41)) === "pHYs", "PNG pHYs metadata is inserted");
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const jpegDpi = writeJpegDpi(jpeg, 300, 300);
console.assert(jpegDpi[2] === 0xff && jpegDpi[3] === 0xe0 && jpegDpi[13] === 1, "JPEG JFIF density is inserted");

finish("resize-core.test.ts");
