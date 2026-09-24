import { begin } from "@/src/selfcheck";
import { boxBounds, noSnap, pageTargets, snapMove, tolerance, type SnapOptions, type SnapState } from "@/src/snap";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-9) => Math.abs(left - right) < tolerance;

/** A generous, symmetric window so each test states its own distances. */
const window = (enter: number, exit: number) => ({ enter: { x: enter, y: enter }, exit: { x: exit, y: exit } });
const base = (extra: Partial<SnapOptions> = {}): SnapOptions =>
  ({ targets: pageTargets(), grid: null, ...window(3, 6), ...extra });

/* ------------------------------------------------------------ page edges */

// A 40×20 box nudged just past the left edge is pulled flush with it.
const flush = snapMove({ x: 1.2, y: 20, w: 40, h: 20 }, base(), noSnap);
console.assert(near(flush.dx, -1.2), "a box near the left edge snaps flush to it");
console.assert(flush.dy === 0, "and the other axis is left alone when nothing is near");
console.assert(flush.guides.length === 1 && flush.guides[0].axis === "x" && flush.guides[0].at === 0,
  "the guide is the result of the solved constraint, at the line it snapped to");
console.assert(flush.guides[0].kind === "page", "and it knows the page produced it");

const centred = snapMove({ x: 28.5, y: 41, w: 40, h: 20 }, base(), noSnap);
console.assert(near(centred.dx, 1.5) && near(centred.dy, -1), "centring on the page catches both axes");
console.assert(centred.guides.length === 2, "and draws one guide per axis");

const far = snapMove({ x: 20, y: 20, w: 10, h: 10 }, base(), noSnap);
console.assert(far.dx === 0 && far.dy === 0 && far.guides.length === 0, "nothing within reach snaps nothing");
console.assert(far.state.x === null && far.state.y === null, "and holds no constraint");

/* ------------------------------------------------------------ hysteresis */

// §17: engage inside `enter`, hold out to `exit`. The gap between the two is
// the whole point — inside it, behaviour depends on what came before.
const options = base();
// A 30-wide box at these positions has nothing but the left edge in reach,
// so the axis is measuring hysteresis and not some second constraint.
const engaged = snapMove({ x: 2, y: 20, w: 30, h: 20 }, options, noSnap);
console.assert(engaged.state.x !== null, "2% from the edge is inside the 3% enter threshold");
const held: SnapState = engaged.state;
const stillHeld = snapMove({ x: 5, y: 20, w: 30, h: 20 }, options, held);
console.assert(stillHeld.state.x === held.x,
  "5% is past enter but inside exit, so the held constraint keeps it");
console.assert(near(stillHeld.dx, -5), "and still pulls the box flush");
const released = snapMove({ x: 7, y: 20, w: 30, h: 20 }, options, held);
console.assert(released.state.x === null && released.dx === 0, "past exit the constraint lets go");
// Without memory the same position would never have engaged at all.
const cold = snapMove({ x: 5, y: 20, w: 30, h: 20 }, options, noSnap);
console.assert(cold.dx === 0, "the same 5% from a cold start does not snap: that asymmetry is the magnet");

/* ------------------------------------------------- objects and safe area */

const neighbour = [{ id: "a", rect: { x: 10, y: 10, w: 20, h: 20 }, kind: "object" as const }];
const aligned = snapMove({ x: 10.5, y: 60, w: 20, h: 20 }, base({ targets: neighbour }), noSnap);
console.assert(near(aligned.dx, -0.5), "a box lines up with its neighbour");
const guide = aligned.guides[0];
console.assert(guide.from === 10 && guide.to === 80, "and the guide spans both boxes, not the whole page");

const safe = snapMove({ x: 5.4, y: 40, w: 30, h: 20 }, base({ targets: pageTargets(5, 8) }), noSnap);
console.assert(near(safe.dx, -0.4) && safe.guides[0].kind === "safe", "the safe area attracts like any other line");

const grid = snapMove({ x: 9.2, y: 40, w: 30, h: 20 }, base({ targets: [], grid: 5 }), noSnap);
console.assert(near(grid.dx, 0.8) && grid.guides[0].kind === "grid", "the grid attracts to its nearest step");
console.assert(grid.guides[0].at === 10, "at the grid line itself");

/* ------------------------------------------------------------ tie-break */

// A 20-wide box at x=40 is centred on the page and its left edge sits on a
// 40% grid line: both are exactly 0 away. Centre wins, deliberately.
const tie = snapMove({ x: 40, y: 40, w: 20, h: 20 }, base({ grid: 40 }), noSnap);
console.assert(tie.guides[0].kind === "page" && tie.guides[0].at === 50,
  "an exact tie resolves to the centre constraint, not to iteration order");

/* ---------------------------------------------------------------- units */

// Thresholds are a feel in screen pixels, so they must shrink as zoom grows.
const page = { width: 1801, height: 2600 };
const close = tolerance(page, 1);
const zoomed = tolerance(page, 4);
console.assert(near(zoomed.enter.x, close.enter.x / 4), "zooming in 4x makes the snap window 4x smaller in page units");
console.assert(close.enter.x > close.enter.y, "a wider page needs a wider window per percent than a taller one");
console.assert(close.exit.x > close.enter.x, "exit is always looser than enter, or there is no hysteresis");
console.assert(tolerance(page, 0).enter.x === 0, "a collapsed viewport does not divide by zero");

/* -------------------------------------------------- rotation uses bounds */

const upright = boxBounds({ x: 40, y: 40, w: 20, h: 10, rotation: 0, flipH: false, flipV: false });
console.assert(near(upright.w, 20) && near(upright.h, 10), "an unrotated box is its own bounding box");
const turned = boxBounds({ x: 40, y: 40, w: 20, h: 10, rotation: 90, flipH: false, flipV: false });
console.assert(near(turned.w, 10) && near(turned.h, 20), "a quarter turn swaps the bounds");
console.assert(near(turned.x + turned.w / 2, 50) && near(turned.y + turned.h / 2, 45),
  "and rotation happens about the box centre, so the centre does not move");

finish("snap.test.ts");
