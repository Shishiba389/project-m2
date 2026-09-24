import { begin } from "@/src/selfcheck";
import { fullPageImage, type ImageBox } from "@/src/image-geometry";
import {
  alignSelection, distributeSelection, marqueeFrom, marqueeHits, moveSelection,
  resizeSelectionTo, scaleSelection, selectionBounds, type Selectable,
} from "@/src/selection";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-6) => Math.abs(left - right) < tolerance;
const box = (patch: Partial<ImageBox>): ImageBox => ({ ...fullPageImage().box, lockedRatio: false, ...patch });
const item = (key: string, patch: Partial<ImageBox>): Selectable => ({ key, box: box(patch) });
const find = (items: Selectable[], key: string) => items.find((entry) => entry.key === key)!.box;

const three: Selectable[] = [
  item("a", { x: 10, y: 10, w: 20, h: 10 }),
  item("b", { x: 40, y: 30, w: 10, h: 20 }),
  item("c", { x: 70, y: 15, w: 20, h: 20 }),
];

/* ---------------------------------------------------------------- bounds */

const area = selectionBounds(three)!;
console.assert(near(area.x, 10) && near(area.y, 10), "the selection starts at the topmost, leftmost edge");
console.assert(near(area.w, 80) && near(area.h, 40), "and spans to the far edge of the last member");
console.assert(selectionBounds([]) === null, "an empty selection has no rectangle");

// A rotated object is framed by what it covers, not by its unrotated corners:
// a 20x10 box turned 90 degrees occupies 10 across and 20 down.
const turned = selectionBounds([item("t", { x: 10, y: 10, w: 20, h: 10, rotation: 90 })])!;
console.assert(near(turned.w, 10) && near(turned.h, 20), "bounds follow the rotation");
console.assert(near(turned.x + turned.w / 2, 20) && near(turned.y + turned.h / 2, 15),
  "and stay centred on the object, which rotation does not move");

/* --------------------------------------------------------------- marquee */

// Left to right contains; right to left touches. Same two corners, opposite
// directions, deliberately different results.
const rightwards = marqueeFrom({ x: 5, y: 5 }, { x: 55, y: 55 });
console.assert(rightwards.mode === "contain", "dragging right means contain");
console.assert(near(rightwards.area.w, 50) && near(rightwards.area.x, 5), "and the rectangle is normalised");
const leftwards = marqueeFrom({ x: 55, y: 55 }, { x: 5, y: 5 });
console.assert(leftwards.mode === "touch", "dragging left means touch");
console.assert(near(leftwards.area.x, 5) && near(leftwards.area.w, 50), "from the same two corners");

console.assert(marqueeHits(three, rightwards.area, "contain").join() === "a,b",
  "contain takes the two objects wholly inside");
console.assert(marqueeHits(three, { x: 25, y: 5, w: 30, h: 50 }, "touch").join() === "a,b",
  "touch takes anything the rectangle crosses");
console.assert(marqueeHits(three, { x: 25, y: 5, w: 30, h: 50 }, "contain").join() === "b",
  "where contain takes only the one it swallows whole");
console.assert(marqueeHits(three, { x: 0, y: 0, w: 1, h: 1 }, "touch").length === 0, "an empty sweep selects nothing");
// Touching edges do not count as crossing: a marquee flush against an edge
// would otherwise grab a neighbour the user was deliberately avoiding.
console.assert(marqueeHits(three, { x: 0, y: 0, w: 10, h: 100 }, "touch").length === 0, "an edge that only grazes is not a hit");

/* -------------------------------------------------------------- commands */

const moved = moveSelection(three, 5, -3);
console.assert(near(find(moved, "a").x, 15) && near(find(moved, "c").y, 12), "a multi-drag moves every member equally");
console.assert(near(selectionBounds(moved)!.w, area.w), "and changes nothing about the selection's size");

/* ------------------------------------------------------------------ scale */

const doubled = scaleSelection(three, area, { x: area.x, y: area.y, w: area.w * 2, h: area.h * 2 });
const scaledArea = selectionBounds(doubled)!;
console.assert(near(scaledArea.w, area.w * 2) && near(scaledArea.h, area.h * 2), "scaling the selection scales its bounds");
console.assert(near(find(doubled, "a").w, 40), "and every member with it");
// Each member keeps its place inside the group: a is at the corner before and
// after, so the group behaves like one object without becoming one.
console.assert(near(find(doubled, "a").x, area.x) && near(find(doubled, "a").y, area.y), "the corner member stays in the corner");
const ratios = (items: Selectable[], key: string) => {
  const rect = selectionBounds(items)!;
  const member = find(items, key);
  return { x: (member.x - rect.x) / rect.w, y: (member.y - rect.y) / rect.h };
};
console.assert(near(ratios(doubled, "b").x, ratios(three, "b").x, 1e-9), "and every member keeps its relative position");

// Uniform on purpose: a non-uniform scale on a rotated child is a shear, and
// the document model cannot represent one.
const squashed = scaleSelection(three, area, { x: area.x, y: area.y, w: area.w * 3, h: area.h });
console.assert(near(find(squashed, "a").w / find(squashed, "a").h, find(three, "a").w / find(three, "a").h),
  "a lopsided drag still scales uniformly, so nothing is ever distorted");
console.assert(scaleSelection(three, { x: 0, y: 0, w: 0, h: 0 }, area) === three, "a collapsed source rectangle is refused");

/* ------------------------------------------------------------------ align */

const left = alignSelection(three, "left");
console.assert(left.every((entry) => near(entry.box.x, area.x)), "aligning left puts every member on the left edge");
const bottom = alignSelection(three, "bottom");
console.assert(bottom.every((entry) => near(entry.box.y + entry.box.h, area.y + area.h)), "and bottom on the bottom edge");
const middle = alignSelection(three, "centre-y");
console.assert(middle.every((entry) => near(entry.box.y + entry.box.h / 2, area.y + area.h / 2)), "centring stacks the centres");
console.assert(alignSelection([three[0]], "left")[0].box.x === three[0].box.x, "aligning one object to itself is a no-op");
// Alignment reads the bounds, so a rotated object lines up by the edge a
// person can see rather than by a corner that is no longer there.
const tilted = [item("p", { x: 10, y: 10, w: 20, h: 10 }), item("q", { x: 50, y: 10, w: 20, h: 10, rotation: 90 })];
const flushed = alignSelection(tilted, "left");
console.assert(flushed.every((entry) => near(selectionBounds([entry])!.x, selectionBounds(tilted)!.x)),
  "a rotated object aligns by its visible edge");

/* ------------------------------------------------------------- distribute */

const spread = distributeSelection(three, "x");
const rects = spread.map((entry) => selectionBounds([entry])!).sort((l, r) => l.x - r.x);
const gaps = [rects[1].x - (rects[0].x + rects[0].w), rects[2].x - (rects[1].x + rects[1].w)];
console.assert(near(gaps[0], gaps[1]), "distributing evens the gaps, not the centres");
console.assert(near(rects[0].x, area.x) && near(rects[2].x + rects[2].w, area.x + area.w),
  "and the outermost two hold the span they defined");
console.assert(distributeSelection(three.slice(0, 2), "x").length === 2, "fewer than three objects have nothing to distribute");
console.assert(distributeSelection(three.slice(0, 2), "x")[0].box.x === three[0].box.x, "and are left alone");

/* ------------------------------------------------------- resize by corner */

// Dragging `se` pins `nw`, the same promise a single object makes.
const grown = resizeSelectionTo(three, area, "se", { x: area.x + area.w * 2, y: area.y + area.h * 2 });
const grownArea = selectionBounds(grown)!;
console.assert(near(grownArea.x, area.x) && near(grownArea.y, area.y), "dragging se leaves the nw corner where it was");
console.assert(near(grownArea.w, area.w * 2), "and the selection follows the pointer");
// Dragging `nw` pins `se`.
const fromNW = resizeSelectionTo(three, area, "nw", { x: area.x - area.w, y: area.y - area.h });
const nwArea = selectionBounds(fromNW)!;
console.assert(near(nwArea.x + nwArea.w, area.x + area.w, 1e-6) && near(nwArea.y + nwArea.h, area.y + area.h, 1e-6),
  "dragging nw pins the opposite corner instead");
console.assert(nwArea.w > area.w, "and still grows the selection");
// Uniform whatever the pointer does, so a group of rotated children can never
// be asked for a shear the document cannot store.
const lopsided = resizeSelectionTo(three, area, "se", { x: area.x + area.w * 4, y: area.y + area.h });
const lopArea = selectionBounds(lopsided)!;
console.assert(near(lopArea.w / lopArea.h, area.w / area.h), "a lopsided drag stays uniform");
// Dragged back through its own anchor, the selection stops rather than
// inverting: a negative factor would mirror every member at once.
const crushed = resizeSelectionTo(three, area, "se", { x: area.x - 500, y: area.y - 500 });
console.assert(selectionBounds(crushed)!.w > 0, "dragging through the anchor floors the selection instead of inverting it");

finish("selection.test.ts");
