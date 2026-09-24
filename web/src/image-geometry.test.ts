import { begin } from "@/src/selfcheck";
import { cropImage, fullCrop, fullPageImage, handleCursor, moveCrop, moveImage, nudgeImage, resizeCrop } from "@/src/image-geometry";
const finish = begin();
const image = fullPageImage();
console.assert(moveImage(image, -12, 7).box.x === -12, "an image can move beyond the page");
// Resize, rotation and local-axis conversion are gestures.test.ts now:
// they are computed from a gesture's starting matrix, not from a delta.
const cropped = cropImage(image, { left: .1, top: .2, right: .8, bottom: .9 });
console.assert(cropped.crop?.left === .1 && cropped.crop?.bottom === .9, "crop belongs to the image element");
const clampedCrop = moveCrop(cropped.crop!, 2, -2);
console.assert(Math.abs(clampedCrop.left - .3) < .000001 && clampedCrop.top === 0, "crop movement remains inside its source image");
console.assert(resizeCrop(fullCrop(), "nw", .2, .2).left === .2, "crop handles edit the source crop rather than the page frame");

/* ------------------------------------------------- handle cursors (§6) */

const upright = { rotation: 0, flipH: false, flipV: false };
console.assert(handleCursor("se", upright) === "nwse-resize", "an upright corner keeps its diagonal cursor");
console.assert(handleCursor("e", upright) === "ew-resize" && handleCursor("n", upright) === "ns-resize",
  "and the edge handles are the two straight ones");
// A quarter turn moves every handle one family along: this is the bug that a
// hard-coded CSS cursor cannot see.
console.assert(handleCursor("e", { ...upright, rotation: 90 }) === "ns-resize", "rotating 90 degrees turns east into south");
console.assert(handleCursor("se", { ...upright, rotation: 90 }) === "nesw-resize", "and swaps the two diagonals");
console.assert(handleCursor("se", { ...upright, rotation: 180 }) === "nwse-resize", "a half turn is the same line again");
console.assert(handleCursor("e", { ...upright, rotation: 44 }) === "nwse-resize" && handleCursor("e", { ...upright, rotation: 46 }) === "nwse-resize",
  "angles round to the nearest of the four families");
// Mirroring reverses one axis, so the diagonals swap without any rotation.
console.assert(handleCursor("se", { ...upright, flipH: true }) === "nesw-resize", "a horizontal mirror swaps the diagonals");
console.assert(handleCursor("se", { ...upright, flipH: true, flipV: true }) === "nwse-resize", "mirroring both axes is a half turn, which changes nothing");
console.assert(handleCursor("e", { ...upright, flipV: true }) === "ew-resize", "a mirror never turns a straight cursor into a diagonal");

finish("image-geometry.test.ts");
