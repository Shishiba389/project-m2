/**
 * Constraint-based snapping for the editor workspace.
 *
 * Two rules from the UI/UX architecture shape this module:
 *
 *   §16  Guides are the *result* of a constraint solver, never the logic. The
 *        pointer proposes a position, the solver picks which constraints hold,
 *        the corrected transform and the guides fall out of the same decision.
 *   §17  Snapping uses hysteresis — a constraint engages inside `enter` and
 *        only releases past `exit` (`enter < exit`). One threshold produces a
 *        line the object rattles across; two produce a magnet.
 *
 * Everything here is page percentages, the unit the document is stored in, so
 * a snap decided at 25% zoom is the same snap at 400%. The *thresholds* are
 * the exception: they are a feel, measured on screen, so the caller converts
 * screen pixels into percentages per axis before calling in.
 */
import { bounds, fromBox, type BoxLike } from "@/src/mat3";

export type Rect = { x: number; y: number; w: number; h: number };
export type Axis = "x" | "y";
/** What produced a line, which decides how the guide is drawn and how it ranks. */
export type GuideKind = "page" | "safe" | "object" | "grid";

export type SnapTarget = { id: string; rect: Rect; kind: GuideKind };
export type SnapGuide = { axis: Axis; at: number; from: number; to: number; kind: GuideKind };
/** The constraint currently held on each axis, or null. This is the hysteresis. */
export type SnapState = { x: string | null; y: string | null };
export const noSnap: SnapState = { x: null, y: null };

export type SnapOptions = {
  targets: SnapTarget[];
  /** Grid step in page percent, or null when the grid does not attract. */
  grid: number | null;
  enter: { x: number; y: number };
  exit: { x: number; y: number };
};

/** The axis-aligned bounds of a possibly rotated, possibly mirrored box. */
export const boxBounds = (box: BoxLike): Rect => bounds(fromBox(box));

/** The page itself, plus its safe area, as snap targets. */
export function pageTargets(safeX = 0, safeY = 0): SnapTarget[] {
  const targets: SnapTarget[] = [{ id: "page", rect: { x: 0, y: 0, w: 100, h: 100 }, kind: "page" }];
  if (safeX > 0 || safeY > 0) {
    targets.push({ id: "safe", rect: { x: safeX, y: safeY, w: 100 - safeX * 2, h: 100 - safeY * 2 }, kind: "safe" });
  }
  return targets;
}

/**
 * The three lines an axis offers: the two edges and the centre. Naming them
 * makes constraint ids readable in a debugger, which matters more than it
 * sounds once two constraints fight over the same axis.
 */
const linesOf = (base: number, size: number): [string, number][] =>
  [["start", base], ["centre", base + size / 2], ["end", base + size]];

const along = (rect: Rect, axis: Axis) => axis === "x"
  ? { base: rect.x, size: rect.w } : { base: rect.y, size: rect.h };

/** Lower sorts first when two constraints are equally close. */
const rank: Record<GuideKind, number> = { page: 0, safe: 1, object: 2, grid: 3 };

type Candidate = { id: string; delta: number; at: number; kind: GuideKind; target: SnapTarget | null; centred: boolean };

function candidatesFor(moving: Rect, axis: Axis, options: SnapOptions): Candidate[] {
  const self = along(moving, axis);
  const anchors = linesOf(self.base, self.size);
  const out: Candidate[] = [];
  for (const target of options.targets) {
    const other = along(target.rect, axis);
    for (const [targetName, value] of linesOf(other.base, other.size)) {
      for (const [anchorName, anchor] of anchors) {
        out.push({
          id: `${axis}:${anchorName}:${target.id}:${targetName}`,
          delta: value - anchor, at: value, kind: target.kind, target,
          centred: anchorName === "centre" && targetName === "centre",
        });
      }
    }
  }
  const step = options.grid;
  if (step && step > 0) {
    for (const [anchorName, anchor] of anchors) {
      const line = Math.round(anchor / step) * step;
      out.push({
        id: `${axis}:${anchorName}:grid`, delta: line - anchor, at: line,
        kind: "grid", target: null, centred: false,
      });
    }
  }
  return out;
}

/**
 * Pick the constraint that holds on one axis.
 *
 * A held constraint keeps priority until the pointer drags it past `exit`,
 * which is what stops the object flickering between two lines a pixel apart.
 */
function solveAxis(moving: Rect, axis: Axis, options: SnapOptions, held: string | null): Candidate | null {
  const candidates = candidatesFor(moving, axis, options);
  const exit = options.exit[axis];
  if (held) {
    const kept = candidates.find((candidate) => candidate.id === held);
    if (kept && Math.abs(kept.delta) <= exit) return kept;
  }
  const enter = options.enter[axis];
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate.delta);
    if (distance > enter) continue;
    if (!best) { best = candidate; continue; }
    const margin = distance - Math.abs(best.delta);
    // Equally close is the common case — an object centred on a page centre is
    // also flush with nothing — so break the tie deliberately rather than by
    // iteration order: centre alignment first, then page over object over grid.
    if (margin < -1e-9) { best = candidate; continue; }
    if (margin > 1e-9) continue;
    if (candidate.centred && !best.centred) { best = candidate; continue; }
    if (!candidate.centred && best.centred) continue;
    if (rank[candidate.kind] < rank[best.kind]) best = candidate;
  }
  return best;
}

/** How far a guide is drawn: across everything it relates, never just the line. */
function guideSpan(moving: Rect, axis: Axis, target: SnapTarget | null): { from: number; to: number } {
  const perpendicular: Axis = axis === "x" ? "y" : "x";
  const self = along(moving, perpendicular);
  if (!target) return { from: Math.min(0, self.base), to: Math.max(100, self.base + self.size) };
  const other = along(target.rect, perpendicular);
  return {
    from: Math.min(self.base, other.base),
    to: Math.max(self.base + self.size, other.base + other.size),
  };
}

/**
 * Correct a proposed position. `moving` is where the pointer would put the
 * object; the returned `dx`/`dy` are added to it, and `state` is carried back
 * into the next call of the same gesture so hysteresis has a memory.
 */
export function snapMove(moving: Rect, options: SnapOptions, state: SnapState = noSnap) {
  const x = solveAxis(moving, "x", options, state.x);
  const y = solveAxis(moving, "y", options, state.y);
  const guides: SnapGuide[] = [];
  if (x) guides.push({ axis: "x", at: x.at, kind: x.kind, ...guideSpan(moving, "x", x.target) });
  if (y) guides.push({ axis: "y", at: y.at, kind: y.kind, ...guideSpan(moving, "y", y.target) });
  return {
    dx: x ? x.delta : 0,
    dy: y ? y.delta : 0,
    guides,
    state: { x: x?.id ?? null, y: y?.id ?? null } as SnapState,
  };
}

/**
 * Thresholds in page percent from a feel in screen pixels. The two axes scale
 * differently whenever the page is not square, which is why this is not one
 * number: 8px across a 1801px page is not 8px down a 2600px one.
 */
export function tolerance(page: { width: number; height: number }, zoom: number, enterPx = 7, exitPx = 12): Pick<SnapOptions, "enter" | "exit"> {
  const scale = (px: number, length: number) =>
    (length > 0 && zoom > 0 ? px / (zoom * length) * 100 : 0);
  return {
    enter: { x: scale(enterPx, page.width), y: scale(enterPx, page.height) },
    exit: { x: scale(exitPx, page.width), y: scale(exitPx, page.height) },
  };
}
