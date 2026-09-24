/**
 * Multi-selection: what is selected, and what a command does to all of it.
 *
 * The architecture document asks for two things this module exists to provide.
 *
 *   §18  A multi-selection is a *temporary* transform over objects that keep
 *        their own identity. Nothing is reparented, nothing is grouped; a
 *        gesture computes each object's new box from the selection's bounds
 *        before and after, and the result is baked straight back into each
 *        object. That is why these functions take boxes and return boxes and
 *        hold no state at all.
 *   §19  Marquee selection is decided in world coordinates, not on screen, so
 *        the same drag selects the same objects at 25% as at 400%.
 *
 * Objects are addressed by an opaque key because a canvas holds two kinds of
 * thing - free images, which belong to assets, and frames, which belong to the
 * document - and a selection has to be able to span both.
 */
import type { ImageBox } from "@/src/image-geometry";
import { boxBounds, type Rect } from "@/src/snap";

/** One selectable object: its key, and the box that is its geometry. */
export type Selectable = { key: string; box: ImageBox };
export type Edge = "left" | "centre-x" | "right" | "top" | "centre-y" | "bottom";
export type Axis = "x" | "y";

/**
 * The selection's own rectangle: the union of every member's axis-aligned
 * bounds, so a rotated object is framed by what it actually covers.
 */
export function selectionBounds(items: Selectable[]): Rect | null {
  if (!items.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const item of items) {
    const rect = boxBounds(item.box);
    left = Math.min(left, rect.x); top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.w); bottom = Math.max(bottom, rect.y + rect.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * Which objects a marquee catches.
 *
 * `contain` takes only objects wholly inside the rectangle and `touch` takes
 * anything it crosses. Dragging left-to-right means contain and right-to-left
 * means touch, the convention every CAD and vector tool shares: a deliberate
 * sweep across a crowded canvas picks up everything it passes, while a
 * left-to-right box around a cluster takes the cluster and not its neighbours.
 */
export const marqueeHits = (items: Selectable[], area: Rect, mode: "contain" | "touch"): string[] =>
  items.filter((item) => {
    const rect = boxBounds(item.box);
    return mode === "contain" ? contains(area, rect) : overlaps(area, rect);
  }).map((item) => item.key);

/** A drag between two corners, as a rectangle plus the mode its direction implies. */
export function marqueeFrom(start: { x: number; y: number }, end: { x: number; y: number }) {
  return {
    area: {
      x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
      w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y),
    },
    mode: (end.x >= start.x ? "contain" : "touch") as "contain" | "touch",
  };
}

/* ---------------------------------------------------------------- commands */

/** Translate every member by the same amount: the whole of a multi-drag. */
export const moveSelection = (items: Selectable[], dx: number, dy: number): Selectable[] =>
  items.map((item) => ({ ...item, box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } }));

/**
 * Scale the selection from one rectangle to another.
 *
 * Each member keeps its position *within* the selection, so the group behaves
 * like one object without ever becoming one. The scale is uniform on purpose:
 * a non-uniform scale applied to a rotated child is a shear, which this
 * document model has no way to represent - `toBox` refuses it - so it would
 * have to be silently dropped or silently wrong. Uniform keeps the promise
 * that nothing is ever distorted.
 */
export function scaleSelection(items: Selectable[], from: Rect, to: Rect): Selectable[] {
  if (from.w <= 0 || from.h <= 0) return items;
  const factor = Math.min(to.w / from.w, to.h / from.h);
  if (!Number.isFinite(factor) || factor <= 0) return items;
  return items.map((item) => ({
    ...item,
    box: {
      ...item.box,
      x: to.x + (item.box.x - from.x) * factor,
      y: to.y + (item.box.y - from.y) * factor,
      w: item.box.w * factor,
      h: item.box.h * factor,
    },
  }));
}

/**
 * Align every member to one edge of the selection.
 *
 * Alignment is measured on each object's bounds, not on its box, so a rotated
 * object lines up by the edge a reader can see rather than by a corner that is
 * no longer where it looks.
 */
export function alignSelection(items: Selectable[], edge: Edge): Selectable[] {
  const area = selectionBounds(items);
  if (!area || items.length < 2) return items;
  return items.map((item) => {
    const rect = boxBounds(item.box);
    let dx = 0, dy = 0;
    if (edge === "left") dx = area.x - rect.x;
    if (edge === "right") dx = area.x + area.w - (rect.x + rect.w);
    if (edge === "centre-x") dx = area.x + area.w / 2 - (rect.x + rect.w / 2);
    if (edge === "top") dy = area.y - rect.y;
    if (edge === "bottom") dy = area.y + area.h - (rect.y + rect.h);
    if (edge === "centre-y") dy = area.y + area.h / 2 - (rect.y + rect.h / 2);
    return { ...item, box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } };
  });
}

/**
 * Even out the gaps along one axis.
 *
 * The two outermost objects stay put - they define the span - and everything
 * between them is placed so the *gaps* are equal, not the centres. Equal
 * centres looks wrong the moment two objects are different sizes, which on a
 * page of product shots is most of the time.
 */
export function distributeSelection(items: Selectable[], axis: Axis): Selectable[] {
  if (items.length < 3) return items;
  const measured = items.map((item) => ({ item, rect: boxBounds(item.box) }));
  const size = (rect: Rect) => axis === "x" ? rect.w : rect.h;
  const start = (rect: Rect) => axis === "x" ? rect.x : rect.y;
  const ordered = [...measured].sort((left, right) => start(left.rect) - start(right.rect));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const span = start(last.rect) + size(last.rect) - start(first.rect);
  const filled = ordered.reduce((total, entry) => total + size(entry.rect), 0);
  const gap = (span - filled) / (ordered.length - 1);
  const moved = new Map<string, number>();
  let cursor = start(first.rect);
  for (const entry of ordered) {
    moved.set(entry.item.key, cursor - start(entry.rect));
    cursor += size(entry.rect) + gap;
  }
  return items.map((item) => {
    const delta = moved.get(item.key) ?? 0;
    return {
      ...item,
      box: axis === "x" ? { ...item.box, x: item.box.x + delta } : { ...item.box, y: item.box.y + delta },
    };
  });
}

/**
 * Resize a selection by dragging one corner of its rectangle.
 *
 * The opposite corner is pinned, exactly as it is for a single object, and the
 * factor is the smaller of the two axes so the group never distorts. Only
 * corners are offered: an edge handle would have to stretch one axis, and
 * stretching a group of rotated children is the shear this model cannot hold.
 */
export function resizeSelectionTo(
  items: Selectable[], from: Rect, handle: "nw" | "ne" | "se" | "sw",
  pointer: { x: number; y: number }, minimum = 1,
): Selectable[] {
  if (from.w <= 0 || from.h <= 0) return items;
  const west = handle.includes("w");
  const north = handle.includes("n");
  const anchor = { x: west ? from.x + from.w : from.x, y: north ? from.y + from.h : from.y };
  const reach = Math.min(Math.abs(pointer.x - anchor.x) / from.w, Math.abs(pointer.y - anchor.y) / from.h);
  // A floor on the whole selection, not on each member: clamping members one
  // by one would pull the group apart at small sizes.
  const factor = Math.max(minimum / Math.max(from.w, from.h), reach);
  const width = from.w * factor;
  const height = from.h * factor;
  return scaleSelection(items, from, {
    x: west ? anchor.x - width : anchor.x,
    y: north ? anchor.y - height : anchor.y,
    w: width, h: height,
  });
}
