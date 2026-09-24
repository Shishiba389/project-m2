import { begin } from "@/src/selfcheck";
import {
  applyPoint, applyVector, bounds, clean, compose, corners, decompose, determinant, fromBox,
  identity, invert, isAxisAligned, multiply, rotation, scaling, shear, toBox, toCss, translation,
  type Mat3,
} from "@/src/mat3";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-9) => Math.abs(left - right) < tolerance;
const sameMatrix = (left: Mat3, right: Mat3, tolerance = 1e-9) =>
  near(left.a, right.a, tolerance) && near(left.b, right.b, tolerance) && near(left.c, right.c, tolerance)
  && near(left.d, right.d, tolerance) && near(left.tx, right.tx, tolerance) && near(left.ty, right.ty, tolerance);

/* ------------------------------------------------------------ algebra */

console.assert(sameMatrix(multiply(identity(), rotation(37)), rotation(37)), "identity leaves a matrix alone");
const left = compose(translation(3, 5), rotation(25), scaling(2, 3));
const right = compose(rotation(-40), translation(-1, 7));
console.assert(sameMatrix(multiply(multiply(left, right), rotation(11)), multiply(left, multiply(right, rotation(11)))),
  "multiplication is associative");
// Order matters, and it reads right to left: scale first, then rotate.
console.assert(!sameMatrix(multiply(rotation(90), scaling(2, 1)), multiply(scaling(2, 1), rotation(90))),
  "rotate-then-scale is not scale-then-rotate");
console.assert(near(determinant(scaling(3, 4)), 12), "determinant is the area factor");
console.assert(determinant(compose(scaling(-1, 1), rotation(30))) < 0, "a mirror has a negative determinant");

/* ------------------------------------------------------------- inverse */

const gnarly = compose(translation(12, -30), rotation(63), scaling(2.5, 0.4), shear(20));
const back = invert(gnarly)!;
console.assert(back !== null, "a well-formed matrix inverts");
console.assert(sameMatrix(multiply(gnarly, back), identity(), 1e-9), "matrix times its inverse is the identity");
const point = { x: 0.37, y: 0.81 };
const roundTripped = applyPoint(back, applyPoint(gnarly, point));
console.assert(near(roundTripped.x, point.x) && near(roundTripped.y, point.y), "a point survives the round trip");
// A collapsed axis must be refused, not divided by: the interaction code reads
// null and stops instead of putting infinities on screen.
console.assert(invert(scaling(0, 1)) === null, "a singular matrix has no inverse");
console.assert(invert(scaling(1e-14, 1e-14)) === null, "and neither does a near-singular one");
console.assert(invert(scaling(1e-3, 1e-3)) !== null, "but a small, honest scale still inverts");

/* ------------------------------------------------- points versus vectors */

const moved = compose(translation(100, 50), rotation(90));
const asPoint = applyPoint(moved, { x: 1, y: 0 });
console.assert(near(asPoint.x, 100) && near(asPoint.y, 51), "a position picks up the translation");
const asVector = applyVector(moved, { x: 1, y: 0 });
console.assert(near(asVector.x, 0) && near(asVector.y, 1), "a direction does not: w = 0 drops the translation");

/* ------------------------------------------------------- decomposition */

const plain = decompose(compose(translation(7, 9), rotation(42), scaling(3, 5)));
console.assert(near(plain.x, 7) && near(plain.y, 9), "translation comes back");
console.assert(near(plain.rotation, 42, 1e-6), "so does rotation");
console.assert(near(plain.scaleX, 3, 1e-9) && near(plain.scaleY, 5, 1e-9), "and both scales");
console.assert(near(plain.skewX, 0, 1e-9) && !plain.flipped, "with no shear and no mirror");
const skewed = decompose(shear(20));
console.assert(near(skewed.skewX, 20, 1e-6), "shear is recovered as an angle");
console.assert(near(skewed.scaleX, 1, 1e-9) && near(skewed.scaleY, 1, 1e-9), "and does not leak into the scales");
const mirrored = decompose(compose(rotation(30), scaling(-2, 2)));
console.assert(mirrored.flipped, "a mirror is reported as a flip");
console.assert(near(mirrored.scaleX, 2) && near(mirrored.scaleY, 2), "rather than as a negative size");
console.assert(decompose(rotation(-15)).rotation === 345, "angles are normalised to [0, 360)");

/* --------------------------------------------------------- unit square */

const square = fromBox({ x: 10, y: 20, w: 30, h: 40, rotation: 0, flipH: false, flipV: false });
const quad = corners(square);
console.assert(near(quad[0].x, 10) && near(quad[0].y, 20), "the local origin is the box's top-left");
console.assert(near(quad[2].x, 40) && near(quad[2].y, 60), "and (1,1) is its bottom-right");
const turned = fromBox({ x: 0, y: 0, w: 20, h: 10, rotation: 90, flipH: false, flipV: false });
const box = bounds(turned);
// A quarter turn about the centre swaps the extents around that centre.
console.assert(near(box.w, 10) && near(box.h, 20), "world bounds follow the rotation");
console.assert(near(box.x, 5) && near(box.y, -5), "and stay centred on the box");

/* ------------------------------------------------- box interoperability */

const cases = [
  { x: 10, y: 20, w: 30, h: 40, rotation: 0, flipH: false, flipV: false },
  { x: -15, y: 60, w: 80, h: 25, rotation: 37, flipH: false, flipV: false },
  { x: 0, y: 0, w: 100, h: 100, rotation: 0, flipH: true, flipV: false },
  { x: 5, y: 5, w: 40, h: 90, rotation: 30, flipH: true, flipV: false },
];
for (const source of cases) {
  const restored = toBox(fromBox(source))!;
  console.assert(restored !== null, `a plain box round-trips: ${JSON.stringify(source)}`);
  console.assert(near(restored.x, source.x, 1e-6) && near(restored.y, source.y, 1e-6), "position survives fromBox/toBox");
  console.assert(near(restored.w, source.w, 1e-6) && near(restored.h, source.h, 1e-6), "so does size");
  console.assert(sameMatrix(fromBox(restored), fromBox(source), 1e-6), "and the matrix it rebuilds is the same transform");
}
// flipV is the same transform as flipH half a turn away, so the round trip
// normalises to one spelling while staying the same geometry.
const vertical = { x: 0, y: 0, w: 20, h: 10, rotation: 40, flipH: false, flipV: true };
const normalised = toBox(fromBox(vertical))!;
console.assert(normalised.flipH && !normalised.flipV, "toBox settles on the horizontal mirror");
console.assert(sameMatrix(fromBox(normalised), fromBox(vertical), 1e-6), "without changing what is drawn");
// Both flips at once is a half turn, which a box says with no mirror at all.
const both = toBox(fromBox({ x: 0, y: 0, w: 20, h: 10, rotation: 10, flipH: true, flipV: true }))!;
console.assert(!both.flipH && near(both.rotation, 190, 1e-6), "two mirrors read back as a half turn");
console.assert(toBox(compose(fromBox(cases[0]), shear(15))) === null, "a sheared matrix is not a box, and says so");

/* -------------------------------------------------------------- output */

console.assert(isAxisAligned(compose(translation(4, 5), scaling(2, 3))), "translate and scale stay axis-aligned");
console.assert(!isAxisAligned(rotation(1)), "any rotation does not");
console.assert(clean(rotation(90)).a === 0, "floating-point dust is swept before serialising");
console.assert(toCss(translation(4, 5)) === "matrix(1, 0, 0, 1, 4, 5)", "CSS takes the matrix directly");

finish("mat3.test.ts");
