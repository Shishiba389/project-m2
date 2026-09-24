import { begin } from "@/src/selfcheck";
import { fullPageImage, type ImageBox } from "@/src/image-geometry";
import { centreOf, dragTo, handlePagePoint, handlePoint, resizeTo, rotateTo, scaleBy, toLocal, toParentPercent } from "@/src/gestures";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-6) => Math.abs(left - right) < tolerance;
const nearBox = (box: ImageBox, x: number, y: number, w: number, h: number, tolerance = 1e-6) =>
  near(box.x, x, tolerance) && near(box.y, y, tolerance) && near(box.w, w, tolerance) && near(box.h, h, tolerance);

/** A deliberately non-square page: percent space is anisotropic and must not leak. */
const page = { width: 1800, height: 2600 };
const square = { width: 1000, height: 1000 };
const box = (patch: Partial<ImageBox> = {}): ImageBox =>
  ({ ...fullPageImage().box, x: 20, y: 30, w: 40, h: 20, lockedRatio: false, ...patch });

/* ------------------------------------------------------------- local space */

const upright = box();
const corner = toLocal(upright, page, { x: 20, y: 30 })!;
console.assert(near(corner.x, 0) && near(corner.y, 0), "the box's own origin is the origin of its unit square");
const far = toLocal(upright, page, { x: 60, y: 50 })!;
console.assert(near(far.x, 1) && near(far.y, 1), "and its far corner is (1, 1)");
console.assert(toLocal(box({ w: 0, h: 0 }), page, { x: 0, y: 0 }) === null, "a collapsed box has no inverse, and says so");

// Rotating by a quarter turn maps the north edge onto the east edge. This is
// the assertion that would fail if the maths were done in percent space on a
// page that is not square.
const turned = box({ x: 30, y: 30, w: 20, h: 20, rotation: 90 });
// CSS rotates clockwise with y pointing down, so a quarter turn carries the
// object's west edge up to where the screen's top edge is.
const north = toLocal(turned, square, { x: 40, y: 30 })!;
console.assert(near(north.x, 0) && near(north.y, 0.5), "the point at the top of the screen is on the object's west edge");
const swung = toLocal(turned, square, { x: 50, y: 40 })!;
console.assert(near(swung.x, 0.5) && near(swung.y, 0), "and the object's north edge has swung round to the right");

/* ----------------------------------------------------------------- drag */

const dragged = dragTo({ box: upright, pointer: { x: 10, y: 10 } }, { x: 17, y: 4 });
console.assert(nearBox(dragged, 27, 24, 40, 20), "dragging moves the box by the pointer's travel");
console.assert(dragged.rotation === upright.rotation, "and changes nothing else");

/* --------------------------------------------------------------- resize */

// Every handle pins the opposite one. Dragging `se` to a point leaves `nw`
// exactly where it was.
const se = resizeTo({ box: upright, handle: "se", pointer: { x: 60, y: 50 } }, { x: 70, y: 60 }, page);
console.assert(nearBox(se, 20, 30, 50, 30), "se resizes towards the pointer and pins nw");
const nw = resizeTo({ box: upright, handle: "nw", pointer: { x: 20, y: 30 } }, { x: 10, y: 20 }, page);
console.assert(nearBox(nw, 10, 20, 50, 30), "nw resizes the other way and pins se");
// An edge handle touches one axis and leaves the other alone.
const east = resizeTo({ box: upright, handle: "e", pointer: { x: 60, y: 50 } }, { x: 80, y: 99 }, page);
console.assert(nearBox(east, 20, 30, 60, 20), "an edge handle ignores movement across its own axis");

// §5: the result depends only on where the gesture started and where the
// pointer is now. Ten small steps and one big one must agree exactly.
const start = { box: upright, handle: "se" as const, pointer: { x: 60, y: 50 } };
let stepped = upright;
for (let i = 1; i <= 10; i += 1) stepped = resizeTo(start, { x: 60 + i, y: 50 + i }, page);
const once = resizeTo(start, { x: 70, y: 60 }, page);
console.assert(nearBox(stepped, once.x, once.y, once.w, once.h), "a resize replayed in steps lands where one jump lands");

const floored = resizeTo(start, { x: -500, y: -500 }, page);
console.assert(floored.w >= 1 && floored.h >= 1, "a box cannot be dragged through its own anchor");

/* ------------------------------------------------- rotation and mirrors */

// The anchor lives in the object's own space, so on a box turned 180 degrees
// the `se` handle is physically at the top left and must resize that way.
const half = box({ rotation: 180 });
const flipped = resizeTo({ box: half, handle: "se", pointer: { x: 20, y: 30 } }, { x: 10, y: 25 }, page);
console.assert(near(flipped.w, 50) && near(flipped.h, 25), "a half-turned box resizes along its own axes");
console.assert(near(flipped.x + flipped.w, 60) && near(flipped.y + flipped.h, 50),
  "and pins the corner that is now at the bottom right of the screen");
console.assert(flipped.rotation === 180, "rotation survives a resize unchanged");

// A mirror must not be silently renormalised into a rotation by a round trip
// through matrix decomposition: the inspector's Flip toggles would move on
// their own after an unrelated drag.
const mirrored = box({ flipV: true, rotation: 25 });
const afterResize = resizeTo({ box: mirrored, handle: "se", pointer: { x: 60, y: 50 } }, { x: 62, y: 52 }, page);
console.assert(afterResize.flipV === true && afterResize.flipH === false && afterResize.rotation === 25,
  "a resize leaves the mirror and the angle exactly as they were");

// A rotated resize keeps the anchor fixed in world space, which is the whole
// point of going through the inverse rather than through screen deltas.
const tilted = box({ x: 30, y: 30, w: 20, h: 20, rotation: 45 });
const before = toLocal(tilted, square, { x: 30, y: 30 });
const grown = resizeTo({ box: tilted, handle: "se", pointer: { x: 50, y: 50 } }, { x: 60, y: 60 }, square);
console.assert(grown.w > tilted.w, "dragging away from the anchor grows the box");
console.assert(before !== null, "the starting local point resolved");

/* --------------------------------------------------- ratio lock */

const locked = box({ lockedRatio: true });
const uniform = resizeTo({ box: locked, handle: "se", pointer: { x: 60, y: 50 } }, { x: 80, y: 51 }, page);
console.assert(near(uniform.w / uniform.h, locked.w / locked.h), "a locked corner keeps the ratio");
console.assert(uniform.w > locked.w, "and follows the axis that moved");
const stretched = resizeTo({ box: locked, handle: "se", pointer: { x: 60, y: 50 } }, { x: 80, y: 51 }, page, true);
console.assert(!near(stretched.w / stretched.h, locked.w / locked.h), "Shift overrides the lock");
const lockedEdge = resizeTo({ box: locked, handle: "e", pointer: { x: 60, y: 50 } }, { x: 80, y: 50 }, page);
console.assert(near(lockedEdge.w / lockedEdge.h, locked.w / locked.h), "a locked edge handle scales both axes");
console.assert(near(lockedEdge.y + lockedEdge.h / 2, locked.y + locked.h / 2),
  "and grows the untouched axis about its own centre, so the box does not walk");

/* ----------------------------------------------------- rotate and centre */

console.assert(rotateTo(upright, -30).rotation === 330, "rotation wraps into 0..360");
console.assert(rotateTo(upright, 37, 15).rotation === 30, "a step constrains the angle");
console.assert(rotateTo(upright, 37).rotation === 37, "no step leaves it free");
const middle = centreOf(upright);
console.assert(middle.x === 40 && middle.y === 40, "the centre is the middle of the box");

/* ----------------------------------------------------------- parent space */

// Frame content: a point on the page, expressed as a percentage of a frame
// that is itself rotated. Without the inverse, dragging an image inside a
// turned frame moves it sideways.
const frame = box({ x: 20, y: 20, w: 40, h: 40, rotation: 90 });
const inside = toParentPercent(frame, square, { x: 40, y: 40 })!;
console.assert(near(inside.x, 50) && near(inside.y, 50), "the frame's centre is 50/50 in its own space");
// The frame's own top-left corner is no longer the page's top-left one.
const topLeft = toParentPercent(frame, square, { x: 60, y: 20 })!;
console.assert(near(topLeft.x, 0) && near(topLeft.y, 0), "a quarter turn moves which page corner the frame's origin is");
const bottomRight = toParentPercent(frame, square, { x: 20, y: 60 })!;
console.assert(near(bottomRight.x, 100) && near(bottomRight.y, 100), "and the opposite corner follows it round");

console.assert(handlePoint("nw").x === 0 && handlePoint("nw").y === 0, "nw is the origin of the unit square");
console.assert(handlePoint("s").x === 0.5 && handlePoint("s").y === 1, "an edge handle sits at the middle of its edge");

// Keyboard resizing borrows the handle's own position as its pointer, so both
// input paths go through resizeTo and cannot drift apart.
const sePoint = handlePagePoint(upright, page, "se");
console.assert(near(sePoint.x, 60) && near(sePoint.y, 50), "an upright box's se handle is at its far corner");
const keyed = resizeTo({ box: upright, handle: "se", pointer: sePoint }, { x: sePoint.x + 1, y: sePoint.y + 1 }, page);
console.assert(nearBox(keyed, 20, 30, 41, 21), "nudging from there widens the box by exactly the nudge");
const turnedPoint = handlePagePoint(box({ x: 30, y: 30, w: 20, h: 20, rotation: 90 }), square, "se");
console.assert(near(turnedPoint.x, 30) && near(turnedPoint.y, 50), "and a rotated box reports where its handle really is");

// The toolbar's -/+ is a ratio about the centre, so repeated presses are
// reversible and an object never walks across the page.
const smaller = scaleBy(upright, 0.5);
console.assert(nearBox(smaller, 30, 35, 20, 10), "scaling halves the box about its own centre");
console.assert(nearBox(scaleBy(smaller, 2), upright.x, upright.y, upright.w, upright.h), "and scaling back returns exactly where it started");
console.assert(scaleBy(upright, 0.0001).w >= 1, "a floor stops an object being scaled out of existence");

finish("gestures.test.ts");
