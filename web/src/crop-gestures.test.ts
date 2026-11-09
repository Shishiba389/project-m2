/**
 * Canva-style direct manipulation (Phase B): edges crop, Alt resizes about the
 * centre, and inside crop mode the picture slides and scales under a window
 * that stays put.
 */
import { begin } from "@/src/selfcheck";
import { fullPageImage, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { cropEdgeTo, croppedBox, cropFromWindow, resizeTo, scaleUnderWindow, slideUnderWindow, uncroppedBox } from "@/src/gestures";
import { applyPoint, fromBox } from "@/src/mat3";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-9) => Math.abs(left - right) < tolerance;
const page = { width: 1800, height: 2600 };
const box = (patch: Partial<ImageBox> = {}): ImageBox => ({ ...fullPageImage().box, x: 20, y: 30, w: 40, h: 20, ...patch });
/** Where a point of the *source* (u, v in the whole source) is on the page, in pixels. */
const onPage = (element: ImageElement, u: number, v: number) => {
  const source = uncroppedBox(element.box, element.crop, page);
  return applyPoint(fromBox({ ...source, x: source.x / 100 * page.width, y: source.y / 100 * page.height, w: source.w / 100 * page.width, h: source.h / 100 * page.height }), { x: u, y: v });
};
/** A point of the source, in page percent - where a pointer would be to grab it. */
const pointerAt = (element: ImageElement, u: number, v: number) => {
  const pixel = onPage(element, u, v);
  return { x: pixel.x / page.width * 100, y: pixel.y / page.height * 100 };
};
const samePlace = (a: { x: number; y: number }, b: { x: number; y: number }) => near(a.x, b.x, 1e-6) && near(a.y, b.y, 1e-6);

/* ---------------------------------------------------------- edges crop */

for (const rotation of [0, 30, 215]) for (const flipH of [false, true]) {
  const element: ImageElement = { box: box({ rotation, flipH }), crop: null };
  const cut = cropEdgeTo({ element, handle: "e" }, pointerAt(element, 0.6, 0.5), page);
  console.assert(near(cut.crop!.right, 0.6, 1e-9) && cut.crop!.left === 0 && cut.crop!.top === 0 && cut.crop!.bottom === 1,
    `the east edge crops the right side to where it was dragged (rotation ${rotation}, flip ${flipH})`);
  console.assert(samePlace(onPage(element, 0.3, 0.4), onPage(cut, 0.3, 0.4)), "and the content does not move");
  console.assert(near(cut.box.w, element.box.w * 0.6, 1e-9) && near(cut.box.h, element.box.h, 1e-9), "the box shrinks with the window");
  const top = cropEdgeTo({ element: cut, handle: "n" }, pointerAt(cut, 0.5, 0.25), page);
  console.assert(near(top.crop!.top, 0.25) && near(top.crop!.right, 0.6), "a second edge crops on top of the first");
  console.assert(samePlace(onPage(element, 0.3, 0.4), onPage(top, 0.3, 0.4)), "still without moving the content");
}
const plain: ImageElement = { box: box(), crop: null };
const pastEdge = cropEdgeTo({ element: plain, handle: "e" }, pointerAt(plain, 1.4, 0.5), page);
console.assert(pastEdge.crop === null && near(pastEdge.box.w, plain.box.w), "an edge cannot be dragged past the source: there is nothing there");
const throughItself = cropEdgeTo({ element: plain, handle: "e" }, pointerAt(plain, -0.5, 0.5), page);
console.assert(near(throughItself.crop!.right, 0.05) && throughItself.box.w > 0, "and cannot cross the opposite side");
const leftCut = cropEdgeTo({ element: plain, handle: "w" }, pointerAt(plain, 0.3, 0.5), page);
const opened = cropEdgeTo({ element: leftCut, handle: "w" }, pointerAt(leftCut, -0.2, 0.5), page);
console.assert(opened.crop === null, "dragging a cropped edge back out restores the whole picture");

/* ------------------------------------------------------- Alt from centre */

const locked = box({ lockedRatio: true });
const centre = { x: locked.x + locked.w / 2, y: locked.y + locked.h / 2 };
const grown = resizeTo({ box: locked, handle: "se", pointer: { x: 60, y: 50 } }, { x: 70, y: 55 }, page, false, true);
console.assert(near(grown.x + grown.w / 2, centre.x) && near(grown.y + grown.h / 2, centre.y), "Alt keeps the centre where it is");
console.assert(grown.w > locked.w && near(grown.w / grown.h, locked.w / locked.h), "and still keeps the ratio");

/* ------------------------------------- crop mode: the picture moves, the window stays */

const cropped: ImageElement = { box: croppedBox(box({ rotation: 30, flipV: true }), { left: 0.2, top: 0.1, right: 0.6, bottom: 0.7 }, page), crop: { left: 0.2, top: 0.1, right: 0.6, bottom: 0.7 } };
const grab = pointerAt(cropped, 0.4, 0.4);
const slid = slideUnderWindow({ element: cropped, pointer: grab }, pointerAt(cropped, 0.5, 0.45), page);
console.assert(slid.box === cropped.box, "sliding never moves the window");
console.assert(near(slid.crop!.left, 0.1) && near(slid.crop!.top, 0.05) && near(slid.crop!.right - slid.crop!.left, 0.4),
  "the picture follows the pointer, so the window crosses it the other way");
const toTheWall = slideUnderWindow({ element: cropped, pointer: grab }, pointerAt(cropped, 2, 2), page);
console.assert(toTheWall.crop!.left === 0 && toTheWall.crop!.top === 0, "and stops at the picture's edge rather than exposing nothing");

const window = cropped.box;
const bigger = scaleUnderWindow({ element: cropped, handle: "se", pointer: pointerAt(cropped, 1, 1) }, pointerAt(cropped, 1.5, 1.5), page);
console.assert(bigger.box === window, "scaling the picture does not move the window");
console.assert(bigger.crop!.right - bigger.crop!.left < 0.4 - 1e-6, "a bigger picture shows a smaller fraction of itself");
const back = cropFromWindow(bigger.box, uncroppedBox(bigger.box, bigger.crop, page), page)!;
console.assert(near(back.left, bigger.crop!.left, 1e-9) && near(back.bottom, bigger.crop!.bottom, 1e-9), "the window and the crop agree");
const tiny = scaleUnderWindow({ element: cropped, handle: "se", pointer: pointerAt(cropped, 1, 1) }, pointerAt(cropped, 0, 0), page);
console.assert(tiny.crop!.left >= -1e-9 && tiny.crop!.right <= 1 + 1e-9 && tiny.crop!.top >= -1e-9 && tiny.crop!.bottom <= 1 + 1e-9,
  "shrinking the picture stops before the window would hang off it");
console.assert(near(tiny.crop!.right, 1, 1e-6) || near(tiny.crop!.bottom, 1, 1e-6), "it stops exactly at the edge, not short of it");

finish("crop-gestures.test.ts");
