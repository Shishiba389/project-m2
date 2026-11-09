import { begin } from "@/src/selfcheck";
import { detectSubject, isWhole, productThreshold, subjectInBox } from "@/src/subject";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-9) => Math.abs(left - right) < tolerance;

/** A picture: a background, and a product painted as a rectangle in fractions of it. */
function picture(width: number, height: number, background: [number, number, number, number],
  product: { left: number; top: number; right: number; bottom: number; rgba: [number, number, number, number] } | null,
  noise = 0, seed = 7) {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed;
  const jitter = () => { state = (state * 1103515245 + 12345) >>> 0; return ((state >>> 16) % (2 * noise + 1)) - noise; };
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const inside = product && x >= product.left * width && x < product.right * width && y >= product.top * height && y < product.bottom * height;
    const rgba = inside ? product!.rgba : background;
    const at = (y * width + x) * 4;
    for (let c = 0; c < 3; c += 1) data[at + c] = rgba[c] + (noise ? jitter() : 0);
    data[at + 3] = rgba[3];
  }
  return data;
}

// Level 2: a product on white, with JPEG-like noise in the background.
const onWhite = detectSubject(picture(400, 300, [250, 250, 250, 255], { left: 0.25, top: 0.1, right: 0.6, bottom: 0.95, rgba: [180, 40, 40, 255] }, 3), 400, 300)!;
console.assert(onWhite?.method === "background", "a product on white is found against the background");
console.assert(near(onWhite.rect.left, 0.25) && near(onWhite.rect.right, 0.6) && near(onWhite.rect.top, 0.1, 1 / 300) && near(onWhite.rect.bottom, 0.95, 1 / 300),
  "and its bounds are the product, not the picture");
console.assert(onWhite.background!.every((channel) => Math.abs(channel - 250) <= 3), "the background colour is read off the border");

// Any plain colour works, not only white.
const onGrey = detectSubject(picture(200, 200, [128, 128, 140, 255], { left: 0.4, top: 0.4, right: 0.5, bottom: 0.9, rgba: [20, 20, 20, 255] }), 200, 200)!;
console.assert(onGrey && near(onGrey.rect.left, 0.4) && near(onGrey.rect.bottom, 0.9), "a grey studio background works the same way");

// The threshold follows the background's own noise: tiny on a clean render,
// up to the old fixed 26 on a noisy photo, never above it.
console.assert(productThreshold(0) === 4 && productThreshold(3) === 10 && productThreshold(40) === 26, "the product threshold follows the noise");

// A white product on a clean white render: its edge is only a few levels off
// white, and on a background with no noise at all that is enough.
const whiteBox = detectSubject(picture(300, 400, [255, 255, 255, 255], { left: 0.2, top: 0.05, right: 0.8, bottom: 0.9, rgba: [248, 248, 247, 255] }), 300, 400)!;
console.assert(whiteBox?.method === "background" && whiteBox.threshold === 4, "a clean render gets the smallest threshold");
console.assert(near(whiteBox.rect.left, 0.2) && near(whiteBox.rect.top, 0.05) && near(whiteBox.rect.right, 0.8) && near(whiteBox.rect.bottom, 0.9),
  "and a white box seven levels off white is found whole");

// On a clean render a visible shadow is part of what is drawn there, and is
// kept - erring towards the whole product rather than cutting into it.
const shadowed = picture(200, 200, [255, 255, 255, 255], { left: 0.3, top: 0.2, right: 0.7, bottom: 0.7, rgba: [30, 90, 200, 255] });
for (let y = 140; y < 160; y += 1) for (let x = 50; x < 150; x += 1) { const at = (y * 200 + x) * 4; shadowed[at] = 238; shadowed[at + 1] = 238; shadowed[at + 2] = 238; }
console.assert(near(detectSubject(shadowed, 200, 200)!.rect.bottom, 0.8), "on a clean render a visible shadow counts with the product");
// On a photographed background the noise raises the bar, and a shadow lighter
// than that bar stays background.
const photo = picture(200, 200, [245, 245, 245, 255], { left: 0.3, top: 0.2, right: 0.7, bottom: 0.7, rgba: [30, 90, 200, 255] }, 6);
for (let y = 140; y < 160; y += 1) for (let x = 50; x < 150; x += 1) { const at = (y * 200 + x) * 4; photo[at] = 235; photo[at + 1] = 235; photo[at + 2] = 235; }
const onPhoto = detectSubject(photo, 200, 200)!;
console.assert(onPhoto.threshold! >= 14 && near(onPhoto.rect.bottom, 0.7), "a light shadow on a noisy photo does not stretch the bounds");

// A speck of dust does not count either.
const dusty = picture(300, 300, [255, 255, 255, 255], { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6, rgba: [0, 0, 0, 255] });
dusty.set([0, 0, 0, 255], (10 * 300 + 10) * 4);
console.assert(near(detectSubject(dusty, 300, 300)!.rect.left, 0.4), "a single dark pixel is not the product");

// Level 1: transparency.
const cutout = detectSubject(picture(300, 200, [0, 0, 0, 0], { left: 0.1, top: 0.3, right: 0.5, bottom: 0.8, rgba: [200, 200, 200, 255] }), 300, 200)!;
console.assert(cutout?.method === "alpha" && near(cutout.rect.left, 0.1) && near(cutout.rect.top, 0.3) && near(cutout.rect.right, 0.5),
  "a cut-out is bounded by what is opaque - even a white product");

// Level 0: no plain background, no claim.
const scene = picture(200, 200, [120, 120, 120, 255], null, 90);
console.assert(detectSubject(scene, 200, 200) === null, "a busy picture reports no subject rather than guessing");
console.assert(detectSubject(picture(100, 100, [255, 255, 255, 255], null), 100, 100) === null, "an empty white picture has no product");
console.assert(detectSubject(new Uint8ClampedArray(8), 2, 1) === null, "a degenerate picture is no subject");
// The product running off two edges still leaves a plain enough border.
const touching = detectSubject(picture(200, 200, [255, 255, 255, 255], { left: 0.5, top: 0, right: 1, bottom: 0.2, rgba: [0, 0, 0, 255] }), 200, 200)!;
console.assert(touching && near(touching.rect.right, 1) && near(touching.rect.top, 0), "a product at the edge of the frame is bounded by the frame");

// Seen through a crop.
console.assert(JSON.stringify(subjectInBox({ left: 0.2, top: 0.2, right: 0.6, bottom: 0.8 }, null)) === JSON.stringify({ left: 0.2, right: 0.6, top: 0.2, bottom: 0.8 }),
  "without a crop the box shows the whole source");
const throughCrop = subjectInBox({ left: 0.2, top: 0.2, right: 0.6, bottom: 0.8 }, { left: 0.4, top: 0, right: 0.8, bottom: 1 })!;
console.assert(near(throughCrop.left, 0) && near(throughCrop.right, 0.5) && near(throughCrop.top, 0.2), "a crop clips the product and re-measures it in the box");
console.assert(subjectInBox({ left: 0.2, top: 0.2, right: 0.3, bottom: 0.3 }, { left: 0.5, top: 0, right: 1, bottom: 1 }) === null, "a crop that hides the product leaves none");
console.assert(isWhole(null) && isWhole({ left: 0, top: 0, right: 1, bottom: 1 }) && !isWhole(onWhite.rect), "a whole-picture subject is recognised");

finish("subject.test.ts");
