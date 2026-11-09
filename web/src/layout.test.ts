/**
 * The element box is the picture (Phase A).
 *
 * Fit, Fill and Stretch choose an image's box against the whole page instead
 * of fitting the picture inside a page-sized box; cropping moves the box with
 * the window so nothing on the page shifts; and a page that changes size
 * carries every stored box along without distorting it.
 */
import { begin } from "@/src/selfcheck";
import { layoutBox, pictureAspect, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { croppedBox, recrop, rescaleBox, scaleBy, uncroppedBox } from "@/src/gestures";
import { applyPoint, fromBox } from "@/src/mat3";
import {
  alignOf, alignOnPage, docFromPreset, elementOf, layoutMatch, pageLayout, presetById, relayout, rescaleDoc,
  type Asset,
} from "@/src/flow";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-9) => Math.abs(left - right) < tolerance;
const zalando = docFromPreset(presetById("zalando")); // 1801 × 2600, Fit, centre
const page = { width: zalando.width, height: zalando.height };
const pixelAspect = (box: ImageBox) => (box.w / 100 * page.width) / (box.h / 100 * page.height);
const wide = { w: 1600, h: 1000 };
const tall = { w: 900, h: 1300 };

/* ------------------------------------------------- the box is the picture */

const fit = pageLayout(wide, zalando).box;
console.assert(near(pixelAspect(fit), 1.6), "a fitted image's box has the picture's own aspect");
console.assert(near(fit.x, 0) && near(fit.w, 100), "a wide picture fitted to a tall page spans its width");
console.assert(near(fit.y + fit.h / 2, 50), "and is centred vertically");
const fill = pageLayout(wide, zalando, null, "Fill").box;
console.assert(fill.x <= 0 && fill.y <= 1e-9 && fill.x + fill.w >= 100 && fill.y + fill.h >= 100 - 1e-9, "Fill covers the whole page");
console.assert(near(pixelAspect(fill), 1.6), "without distorting the picture");
const stretch = pageLayout(wide, zalando, null, "Stretch").box;
console.assert(stretch.x === 0 && stretch.y === 0 && stretch.w === 100 && stretch.h === 100 && !stretch.lockedRatio,
  "Stretch is exactly the page, with the ratio unlocked");
const topLeft = pageLayout(tall, { ...zalando, fit: "Fit", align: "top-left" }).box;
console.assert(near(topLeft.x, 0) && near(topLeft.y, 0), "alignment places the fitted picture at its anchor");
console.assert(near(pictureAspect(wide, { left: 0, top: 0, right: 0.5, bottom: 1 }), 0.8), "a crop that halves the width halves the aspect");
console.assert(Number.isFinite(layoutBox(pictureAspect({ w: 0, h: 0 }, null), page, "contain").w), "a degenerate source stays finite");

/* ------------------------- the user's case: shrunk into a corner, then Fit */

// Shrink the picture and push it into the bottom-left corner, as a hand edit.
const shrunk: ImageElement = { crop: null, box: { ...fit, x: 0, y: 70, w: 30, h: 30 / 1.6 * page.width / page.height } };
console.assert(layoutMatch(shrunk, wide, zalando) === null, "a hand-sized image is in no page layout");
const backToStretch = relayout(shrunk, wide, zalando, "Stretch").box;
console.assert(backToStretch.x === 0 && backToStretch.y === 0 && backToStretch.w === 100 && backToStretch.h === 100,
  "Stretch brings it out to exactly the white canvas");
const backToFit = relayout(shrunk, wide, zalando, "Fit");
console.assert(near(backToFit.box.w, 100) && near(backToFit.box.y + backToFit.box.h / 2, 50), "Fit brings it back, whole and centred");
console.assert(layoutMatch(backToFit, wide, zalando) === "Fit", "and the toolbar can tell it is in the Fit layout again");
const backToFill = relayout(shrunk, wide, zalando, "Fill").box;
console.assert(backToFill.x <= 0 && backToFill.x + backToFill.w >= 100 && near(backToFill.h, 100), "Fill brings it back covering the page");
const mirroredTurned: ImageElement = { crop: { left: 0.1, top: 0, right: 0.9, bottom: 1 }, box: { ...shrunk.box, rotation: 30, flipH: true } };
const relaid = relayout(mirroredTurned, wide, zalando, "Fit");
console.assert(relaid.box.flipH && relaid.box.rotation === 0 && relaid.crop?.left === 0.1,
  "the mirror and the crop survive a re-layout; the angle resets to line up with the page");

/* ------------------------------------------------ untouched images follow */

const untouched = { element: null, src: wide } as Pick<Asset, "element" | "src">;
console.assert(near(elementOf(untouched, zalando).box.w, 100), "an untouched image is laid out by the page");
const amazon = docFromPreset(presetById("amazon"));
console.assert(near(elementOf(untouched, amazon).box.h, 62.5), "and follows the page when the preset changes");
console.assert(elementOf({ element: shrunk, src: wide }, amazon) === shrunk, "a hand-placed image keeps its own box");

/* ------------------------------------------------- crop keeps content still */

for (const box of [
  { x: 20, y: 25, w: 40, h: 30, rotation: 0, flipH: false, flipV: false, lockedRatio: true },
  { x: 20, y: 25, w: 40, h: 30, rotation: 30, flipH: true, flipV: false, lockedRatio: true },
  { x: 5, y: 60, w: 70, h: 12, rotation: 215, flipH: false, flipV: true, lockedRatio: true },
]) {
  const element: ImageElement = { box, crop: null };
  const source = uncroppedBox(box, null, page);
  console.assert(near(source.x, box.x) && near(source.w, box.w), "an uncropped box is its own source");
  const window = { left: 0.2, top: 0.1, right: 0.7, bottom: 0.85 };
  const cropped = recrop(element, window, page);
  // A point of the source inside the window lands on the same page pixel
  // before and after the crop: the box moved, the picture did not.
  const sourcePoint = { u: 0.45, v: 0.6 };
  const pagePixel = (b: ImageBox, u: number, v: number) => applyPoint(fromBox({
    ...b, x: b.x / 100 * page.width, y: b.y / 100 * page.height, w: b.w / 100 * page.width, h: b.h / 100 * page.height,
  }), { x: u, y: v });
  const before = pagePixel(box, sourcePoint.u, sourcePoint.v);
  const after = pagePixel(cropped.box, (sourcePoint.u - window.left) / (window.right - window.left), (sourcePoint.v - window.top) / (window.bottom - window.top));
  console.assert(near(before.x, after.x, 1e-6) && near(before.y, after.y, 1e-6), `a crop leaves the picture where it was (rotation ${box.rotation})`);
  console.assert(near(pixelAspect(cropped.box), pixelAspect(box) * 0.5 / 0.75, 1e-9), "and the box takes the window's proportions");
  const back = recrop(cropped, null, page);
  console.assert(near(back.box.x, box.x, 1e-9) && near(back.box.y, box.y, 1e-9) && near(back.box.w, box.w, 1e-9) && back.crop === null,
    "removing the crop restores the box exactly");
  const round = croppedBox(uncroppedBox(cropped.box, cropped.crop, page), cropped.crop, page);
  console.assert(near(round.x, cropped.box.x, 1e-9) && near(round.h, cropped.box.h, 1e-9), "source and window round-trip");
}

/* ----------------------------------------------- the page changes size */

const corner = { x: 0, y: 70, w: 30, h: 20, rotation: 0, flipH: false, flipV: false, lockedRatio: true };
const onSquare = rescaleBox(corner, page, { width: 2000, height: 2000 });
const aspectOn = (b: ImageBox, p: { width: number; height: number }) => (b.w / 100 * p.width) / (b.h / 100 * p.height);
console.assert(near(aspectOn(onSquare, { width: 2000, height: 2000 }), aspectOn(corner, page)), "a new page size keeps each picture's proportions");
console.assert(near(onSquare.x + onSquare.w / 2, corner.x + corner.w / 2) && near(onSquare.y + onSquare.h / 2, corner.y + corner.h / 2),
  "and keeps its centre where it was on the page");
const full = rescaleBox({ ...corner, x: 0, y: 0, w: 100, h: 100 }, page, { width: 2000, height: 2000 });
console.assert(full.x >= -1e-9 && full.x + full.w <= 100 + 1e-9 && full.y >= -1e-9 && full.y + full.h <= 100 + 1e-9,
  "what fitted the old page fits the new one");
const moved = rescaleDoc({ ...amazon, placements: [{ id: "a", assetId: 1, element: { box: corner, crop: null } }] }, page);
console.assert(near(moved.placements[0].element.box.w, onSquare.w), "placements are carried onto the new page");

/* ---------------------------------------------------- alignment and scale */

const anchored = alignOnPage(corner, "top-right");
console.assert(near(anchored.x + anchored.w, 100) && near(anchored.y, 0) && anchored.w === corner.w, "aligning keeps the size and moves to the anchor");
console.assert(alignOf(anchored) === "top-right" && alignOf(alignOnPage(corner, "center")) === "center", "and the anchor can be read back");
console.assert(alignOf({ ...corner, x: 13, y: 41 }) === null, "a box between anchors has none");
let thin: ImageBox = { ...corner, w: 40, h: 2 };
for (let i = 0; i < 30; i += 1) thin = scaleBy(thin, 1 / 1.12);
console.assert(near(thin.w / thin.h, 20, 1e-9), "scaling down a thin image keeps its proportions at the floor");

finish("layout.test.ts");
