/**
 * 2D affine transforms — the canonical geometry of the editor.
 *
 * The convention is the one CSS and canvas already use, so a matrix reaches
 * the screen without translation:
 *
 *     | a  c  tx |        transform: matrix(a, b, c, d, tx, ty)
 *     | b  d  ty |        context.setTransform(a, b, c, d, tx, ty)
 *     | 0  0  1  |
 *
 * Every element's local space is the **unit square** [0,1]², so its corners
 * are always (0,0) (1,0) (1,1) (0,1) and the matrix carries size as scale.
 * That keeps one source of truth: a resize changes the matrix, never a
 * separate width/height that would then compete with it.
 *
 * World space here is the output page measured in percent, the same unit the
 * document already uses, so changing preset rescales a layout proportionally
 * and the exporter's percent-to-pixel step is unchanged.
 */

export type Mat3 = { a: number; b: number; c: number; d: number; tx: number; ty: number };
export type Point = { x: number; y: number };

/** Below this, a matrix is treated as singular and refused rather than inverted. */
export const EPSILON = 1e-12;

export const identity = (): Mat3 => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
export const translation = (tx: number, ty: number): Mat3 => ({ a: 1, b: 0, c: 0, d: 1, tx, ty });
export const scaling = (sx: number, sy: number = sx): Mat3 => ({ a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 });
export function rotation(degrees: number): Mat3 {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians); const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}
/** Shear, as CSS skew: x' = x + tan(kx)·y. */
export function shear(kxDegrees: number, kyDegrees: number = 0): Mat3 {
  return { a: 1, b: Math.tan(kyDegrees * Math.PI / 180), c: Math.tan(kxDegrees * Math.PI / 180), d: 1, tx: 0, ty: 0 };
}

/** left · right, applied right to left: `multiply(R, S)` scales, then rotates. */
export function multiply(left: Mat3, right: Mat3): Mat3 {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    tx: left.a * right.tx + left.c * right.ty + left.tx,
    ty: left.b * right.tx + left.d * right.ty + left.ty,
  };
}

export const compose = (...matrices: Mat3[]): Mat3 => matrices.reduce(multiply, identity());

export const determinant = (matrix: Mat3) => matrix.a * matrix.d - matrix.b * matrix.c;

/**
 * The inverse, or null when the matrix collapses a dimension. Callers must
 * handle null rather than dividing by a near-zero determinant: an interaction
 * that inverts a degenerate transform produces infinities on screen.
 */
export function invert(matrix: Mat3): Mat3 | null {
  const det = determinant(matrix);
  if (!Number.isFinite(det) || Math.abs(det) < EPSILON) return null;
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
    tx: (matrix.c * matrix.ty - matrix.d * matrix.tx) / det,
    ty: (matrix.b * matrix.tx - matrix.a * matrix.ty) / det,
  };
}

/** A position: translation applies. */
export const applyPoint = (matrix: Mat3, point: Point): Point => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.tx,
  y: matrix.b * point.x + matrix.d * point.y + matrix.ty,
});

/** A direction (homogeneous w = 0): translation must not apply. */
export const applyVector = (matrix: Mat3, vector: Point): Point => ({
  x: matrix.a * vector.x + matrix.c * vector.y,
  y: matrix.b * vector.x + matrix.d * vector.y,
});

/** The unit square's corners in world space, in order: nw, ne, se, sw. */
export const corners = (matrix: Mat3): Point[] =>
  [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((point) => applyPoint(matrix, point));

/** Axis-aligned bounds of those corners, for culling and broad-phase tests. */
export function bounds(matrix: Mat3) {
  const points = corners(matrix);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export type Decomposition = {
  /** Translation: where the local origin landed. */
  x: number; y: number;
  /** Degrees, normalised to [0, 360). */
  rotation: number;
  scaleX: number; scaleY: number;
  /** Degrees of shear along x. Zero for everything the editor creates today. */
  skewX: number;
  /** True when the transform mirrors, i.e. the determinant is negative. */
  flipped: boolean;
};

/**
 * QR-style decomposition: normalise the first column to get rotation and
 * scaleX, project the second column onto it to pull out shear, and what is
 * left is scaleY. A negative determinant means one axis is mirrored, which is
 * reported rather than folded into a negative scale, so the UI can show a flip
 * toggle instead of a nonsensical "-100%" size.
 */
export function decompose(matrix: Mat3): Decomposition {
  const { a, b, c, d } = matrix;
  const scaleX = Math.hypot(a, b);
  const flipped = determinant(matrix) < 0;
  if (scaleX < EPSILON) {
    // The first axis collapsed; the second one still carries an orientation.
    return { x: matrix.tx, y: matrix.ty, rotation: 0, scaleX: 0, scaleY: Math.hypot(c, d), skewX: 0, flipped };
  }
  const rotationDegrees = Math.atan2(b, a) * 180 / Math.PI;
  const unit = { x: a / scaleX, y: b / scaleX };
  const projection = unit.x * c + unit.y * d;
  const rest = { x: c - projection * unit.x, y: d - projection * unit.y };
  const scaleY = Math.hypot(rest.x, rest.y) * (flipped ? -1 : 1);
  const skewX = Math.abs(scaleY) < EPSILON ? 0 : Math.atan2(projection, Math.abs(scaleY)) * 180 / Math.PI;
  return {
    x: matrix.tx, y: matrix.ty,
    rotation: ((rotationDegrees % 360) + 360) % 360,
    scaleX, scaleY: Math.abs(scaleY), skewX, flipped,
  };
}

/** True when the matrix is a pure translate and axis-aligned scale. */
export const isAxisAligned = (matrix: Mat3) =>
  Math.abs(matrix.b) < 1e-9 && Math.abs(matrix.c) < 1e-9;

/** Snap values that are zero but for floating-point dust, before serialising. */
export function clean(matrix: Mat3): Mat3 {
  const tidy = (value: number) => Math.abs(value) < 1e-12 ? 0 : value;
  return { a: tidy(matrix.a), b: tidy(matrix.b), c: tidy(matrix.c), d: tidy(matrix.d), tx: tidy(matrix.tx), ty: tidy(matrix.ty) };
}

export const toCss = (matrix: Mat3) =>
  `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${matrix.tx}, ${matrix.ty})`;

/* ------------------------------------------------------- box interoperability */

/**
 * The geometry the document stores today: a box in page percentages, with
 * rotation and flips applied about its own centre. These two functions are the
 * bridge that lets the matrix engine land without a data migration, and they
 * are what the inspector will use to show Position and Size.
 */
export type BoxLike = { x: number; y: number; w: number; h: number; rotation: number; flipH: boolean; flipV: boolean };

export function fromBox(box: BoxLike): Mat3 {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  // Centre, then rotate, then mirror, then size the unit square and move its
  // origin to the centre — read right to left.
  return compose(
    translation(cx, cy),
    rotation(box.rotation),
    scaling(box.flipH ? -1 : 1, box.flipV ? -1 : 1),
    scaling(box.w, box.h),
    translation(-0.5, -0.5),
  );
}

/**
 * Back to a box, or null when the matrix has shear that a box cannot express.
 * Flips are recovered as flags, so a mirrored element round-trips instead of
 * turning into a negative size.
 */
export function toBox(matrix: Mat3): BoxLike | null {
  const parts = decompose(matrix);
  if (Math.abs(parts.skewX) > 1e-6) return null;
  const centre = applyPoint(matrix, { x: 0.5, y: 0.5 });
  const w = parts.scaleX;
  const h = parts.scaleY;
  // A box has two ways to spell the same mirror — flipH at θ is flipV at θ+180
  // — so pick the horizontal one and fold the difference into the angle.
  // Mirroring the first axis turns its direction around, which is why the
  // recovered angle is half a turn from the one fromBox was given.
  const flipH = parts.flipped;
  const degrees = flipH ? (parts.rotation + 180) % 360 : parts.rotation;
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h, rotation: degrees, flipH, flipV: false };
}
