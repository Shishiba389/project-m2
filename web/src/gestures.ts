/**
 * The geometry engine for pointer gestures.
 *
 * Three rules from the architecture document shape every function here.
 *
 *   §5   A gesture is computed from the state it started in and the current
 *        pointer — `M(t) = f(M₀, P₀, Pₜ)` — never from the previous frame.
 *        Accumulating `Δ` per frame drifts, and the drift is invisible until
 *        an object has been resized for four seconds and no longer matches its
 *        own numbers.
 *   §40  The UI sends intent; this module computes the transform.  No DOM, no
 *        React, no pixels-from-getBoundingClientRect: callers convert at their
 *        own edge and hand in plain numbers.
 *   §42  The document model stays canonical.  These functions return a new
 *        `ImageBox` and change nothing.
 *
 * ## Why everything converts to page pixels first
 *
 * Geometry is stored as percentages of the page, which is what keeps a layout
 * proportional when the preset changes.  But percent space is anisotropic on a
 * page that is not square: 10% across a 1801px page is 180px, 10% down a
 * 2600px page is 260px.  CSS `rotate()` turns the element in *pixel* space, so
 * doing the maths in percent space would compute a resize that disagrees with
 * what the browser drew — the "distorted resize behaviour" §42 lists.  So each
 * function converts to page pixels, works there, and converts back.
 */
import { applyPoint, applyVector, compose, fromBox, invert, rotation, scaling, type Mat3, type Point } from "@/src/mat3";
import type { ImageBox, ResizeHandle } from "@/src/image-geometry";

export type Size = { width: number; height: number };
/** Everything a gesture needs to remember from the moment the pointer went down. */
export type Gesture = { box: ImageBox; pointer: Point };

/** The smallest an object may be dragged to, in page percent, as before. */
const MIN_PERCENT = 1;

/* ------------------------------------------------------------- conversion */

const toPixels = (box: ImageBox, page: Size) => ({
  ...box,
  x: box.x / 100 * page.width, y: box.y / 100 * page.height,
  w: box.w / 100 * page.width, h: box.h / 100 * page.height,
});
const toPercent = (box: { x: number; y: number; w: number; h: number }, page: Size) => ({
  x: page.width ? box.x / page.width * 100 : 0,
  y: page.height ? box.y / page.height * 100 : 0,
  w: page.width ? box.w / page.width * 100 : 0,
  h: page.height ? box.h / page.height * 100 : 0,
});

/**
 * A page point inside an object's own unit square.  `null` when the object has
 * collapsed and its matrix has no inverse — the caller keeps the box it had
 * rather than dividing by zero.
 */
export function toLocal(box: ImageBox, page: Size, pagePoint: Point): Point | null {
  const back = invert(fromBox(toPixels(box, page)));
  if (!back) return null;
  return applyPoint(back, { x: pagePoint.x / 100 * page.width, y: pagePoint.y / 100 * page.height });
}

/**
 * A point inside a parent's unit square, expressed as a percentage of that
 * parent — the space a frame's content box lives in.  This is what lets an
 * image be dragged inside a frame that is itself rotated or mirrored: the
 * pointer goes through the frame's inverse before it means anything.
 */
export const toParentPercent = (parent: ImageBox, page: Size, pagePoint: Point): Point | null => {
  const local = toLocal(parent, page, pagePoint);
  return local && { x: local.x * 100, y: local.y * 100 };
};

/* -------------------------------------------------------------- handles */

/** Where each handle sits in the unit square.  `se` is (1, 1), `n` is (0.5, 0). */
export const handlePoint = (handle: ResizeHandle): Point => ({
  x: handle.includes("w") ? 0 : handle.includes("e") ? 1 : 0.5,
  y: handle.includes("n") ? 0 : handle.includes("s") ? 1 : 0.5,
});

/** The object's own axes, without its position or size: rotation and mirrors. */
const orientation = (box: ImageBox): Mat3 =>
  compose(rotation(box.rotation), scaling(box.flipH ? -1 : 1, box.flipV ? -1 : 1));

/**
 * Rebuild a box around a local point that must not move.
 *
 * Resizing from `se` pins `nw`; from `e` it pins the west edge and leaves the
 * north-south centre alone.  Expressing that as "this local point keeps its
 * world position" covers all eight handles with one piece of arithmetic, and
 * keeps working when the object is rotated, mirrored, or both — the anchor
 * follows the object's axes because it is defined in the object's own space.
 */
function aroundAnchor(box: ImageBox, page: Size, anchor: Point, width: number, height: number): ImageBox {
  const pixels = toPixels(box, page);
  const matrix = fromBox(pixels);
  const pinned = applyPoint(matrix, anchor);
  const offset = applyVector(orientation(box), {
    x: (anchor.x - 0.5) * width, y: (anchor.y - 0.5) * height,
  });
  const centre = { x: pinned.x - offset.x, y: pinned.y - offset.y };
  // Rotation and the two mirrors are carried over untouched rather than
  // decomposed back out of the matrix: the result is identical geometrically,
  // and a decomposition would silently renormalise "flip vertical" into
  // "flip horizontal plus 180 degrees" in the inspector after every drag.
  return {
    ...box,
    ...toPercent({ x: centre.x - width / 2, y: centre.y - height / 2, w: width, h: height }, page),
  };
}

/* ------------------------------------------------------------- gestures */

/** Translation is the one gesture that needs no matrix: page axes, page units. */
export const dragTo = (start: Gesture, pointer: Point): ImageBox => ({
  ...start.box,
  x: start.box.x + (pointer.x - start.pointer.x),
  y: start.box.y + (pointer.y - start.pointer.y),
});

/**
 * Resize from one of the eight handles.
 *
 * The pointer is pushed through `M₀⁻¹` into the unit square, where the scale
 * factor on each axis is just a ratio of distances from the fixed anchor. A
 * handle whose axis does not move — `e` has no vertical component — reports a
 * factor of 1 on that axis and leaves it alone.
 */
export function resizeTo(start: Gesture & { handle: ResizeHandle }, pointer: Point, page: Size, stretch = false): ImageBox {
  const local = toLocal(start.box, page, pointer);
  if (!local) return start.box;
  const handle = handlePoint(start.handle);
  const anchor = { x: 1 - handle.x, y: 1 - handle.y };
  const movesX = handle.x !== anchor.x;
  const movesY = handle.y !== anchor.y;
  let scaleX = movesX ? (local.x - anchor.x) / (handle.x - anchor.x) : 1;
  let scaleY = movesY ? (local.y - anchor.y) / (handle.y - anchor.y) : 1;

  if (start.box.lockedRatio && !stretch) {
    // A corner follows whichever axis the pointer changed more, which is what
    // makes a diagonal drag feel like it tracks the cursor.  An edge handle
    // has only one axis to go on, and the other grows about its own centre —
    // the anchor there is already 0.5, so that falls out for free.
    const uniform = !movesX ? scaleY : !movesY ? scaleX
      : Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    scaleX = uniform; scaleY = uniform;
  }

  const floorX = start.box.w > 0 ? MIN_PERCENT / start.box.w : 1;
  const floorY = start.box.h > 0 ? MIN_PERCENT / start.box.h : 1;
  if (start.box.lockedRatio && !stretch) {
    // Clamping the axes separately would break the ratio the lock exists to
    // keep, so the floor applies to the single factor both axes share.
    const floor = Math.max(floorX, floorY);
    scaleX = Math.max(floor, scaleX); scaleY = scaleX;
  } else {
    scaleX = Math.max(floorX, scaleX);
    scaleY = Math.max(floorY, scaleY);
  }

  const pixels = toPixels(start.box, page);
  return aroundAnchor(start.box, page, anchor, pixels.w * scaleX, pixels.h * scaleY);
}

/**
 * Rotate about the object's centre.
 *
 * Angles are measured by the caller, which is the only place that knows where
 * the pointer is in isotropic screen pixels; this applies the result and the
 * optional Shift-to-15-degrees constraint.  The centre is fixed, so nothing
 * else about the box changes.
 */
export const rotateTo = (box: ImageBox, degrees: number, step = 0): ImageBox => {
  const snapped = step > 0 ? Math.round(degrees / step) * step : degrees;
  return { ...box, rotation: ((snapped % 360) + 360) % 360 };
};

/**
 * Where a handle actually sits on the page, in percent.
 *
 * Keyboard resizing has no pointer, so it borrows one: the handle's own
 * position, nudged by the arrow key. That routes both input methods through
 * the same function instead of leaving the keyboard on a second, subtly
 * different implementation that nobody notices has drifted.
 */
export function handlePagePoint(box: ImageBox, page: Size, handle: ResizeHandle): Point {
  const pixels = applyPoint(fromBox(toPixels(box, page)), handlePoint(handle));
  return {
    x: page.width ? pixels.x / page.width * 100 : 0,
    y: page.height ? pixels.y / page.height * 100 : 0,
  };
}

/** The object's centre in page percent, which rotation is measured about. */
export const centreOf = (box: ImageBox): Point => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });

/**
 * Scale about the object's own centre, for the toolbar's -/+ buttons.
 *
 * Uniform and centred, so it needs no page and no pointer: the ratio is the
 * whole operation. The old toolbar routed this through a fake south-east drag
 * of eight percentage points, which scaled a small object out of existence and
 * barely moved a large one.
 */
export function scaleBy(box: ImageBox, factor: number): ImageBox {
  const width = Math.max(1, box.w * factor);
  const height = Math.max(1, box.h * factor);
  return {
    ...box,
    x: box.x + (box.w - width) / 2,
    y: box.y + (box.h - height) / 2,
    w: width, h: height,
  };
}
