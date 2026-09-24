/**
 * The viewport: how the workspace maps onto the screen.
 *
 * Pan and zoom belong here and nowhere else. An object's own transform never
 * changes because the user scrolled or zoomed — that separation is what keeps
 * a drag at 25% and a drag at 400% land in the same place.
 *
 *     screen = V · world          world = V⁻¹ · screen
 *
 * `zoom` is a true scale factor against output pixels: at 1 the page is drawn
 * one CSS pixel per exported pixel, which is what "100%" has to mean once the
 * page is an artboard inside a larger workspace rather than something stretched
 * to fill the pane.
 */
import { applyPoint, invert, type Mat3, type Point } from "@/src/mat3";

export type Viewport = { zoom: number; panX: number; panY: number };
export type Size = { width: number; height: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;
/** Breathing room between the page and the edge of the pane when fitting. */
export const FIT_MARGIN = 32;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The viewport as a matrix: a uniform scale and a translation, nothing else. */
export const matrix = (viewport: Viewport): Mat3 =>
  ({ a: viewport.zoom, b: 0, c: 0, d: viewport.zoom, tx: viewport.panX, ty: viewport.panY });

/** The zoom at which the whole page is visible with a margin around it. */
export function fitZoom(page: Size, view: Size, margin = FIT_MARGIN) {
  if (page.width <= 0 || page.height <= 0 || view.width <= 0 || view.height <= 0) return 1;
  return clampZoom(Math.min(
    Math.max(1, view.width - margin * 2) / page.width,
    Math.max(1, view.height - margin * 2) / page.height,
  ));
}

/** Fit the page and centre it — the state the editor opens in. */
export function fitViewport(page: Size, view: Size, margin = FIT_MARGIN): Viewport {
  const zoom = fitZoom(page, view, margin);
  return {
    zoom,
    panX: (view.width - page.width * zoom) / 2,
    panY: (view.height - page.height * zoom) / 2,
  };
}

/**
 * Pan limits. The object model never clamps an element to the page, but the
 * viewport is clamped so the workspace cannot be scrolled into empty space
 * with nothing to navigate back by: the centre of the view stays within the
 * page grown by one page on every side.
 */
export function clampPan(viewport: Viewport, page: Size, view: Size): Viewport {
  const limit = (pan: number, pageLength: number, viewLength: number) => {
    const span = pageLength * viewport.zoom;
    // Centre of the view, in world units: (viewLength / 2 - pan) / zoom.
    // Keeping that inside [-pageLength, 2 · pageLength] gives these bounds.
    const low = viewLength / 2 - span * 2;
    const high = viewLength / 2 + span;
    return Math.min(high, Math.max(low, pan));
  };
  return {
    zoom: viewport.zoom,
    panX: limit(viewport.panX, page.width, view.width),
    panY: limit(viewport.panY, page.height, view.height),
  };
}

export const pan = (viewport: Viewport, dx: number, dy: number, page: Size, view: Size): Viewport =>
  clampPan({ ...viewport, panX: viewport.panX + dx, panY: viewport.panY + dy }, page, view);

/**
 * Zoom about a fixed point, so whatever is under the cursor stays under it.
 * Solving `anchor = z'·worldPoint + pan'` for the new translation gives
 * `pan' = anchor − z'·worldPoint` (§21).
 */
export function zoomAt(viewport: Viewport, nextZoom: number, anchor: Point, page: Size, view: Size): Viewport {
  const zoom = clampZoom(nextZoom);
  const world = { x: (anchor.x - viewport.panX) / viewport.zoom, y: (anchor.y - viewport.panY) / viewport.zoom };
  return clampPan({ zoom, panX: anchor.x - world.x * zoom, panY: anchor.y - world.y * zoom }, page, view);
}

/** Zoom about the middle of the pane, for the +/− buttons and keyboard. */
export const zoomCentred = (viewport: Viewport, nextZoom: number, page: Size, view: Size) =>
  zoomAt(viewport, nextZoom, { x: view.width / 2, y: view.height / 2 }, page, view);

/** Frame a world-space rectangle, in page percentages, with a margin. */
export function zoomToRect(rect: { x: number; y: number; w: number; h: number }, page: Size, view: Size, margin = FIT_MARGIN): Viewport {
  const width = Math.max(1, rect.w / 100 * page.width);
  const height = Math.max(1, rect.h / 100 * page.height);
  const zoom = clampZoom(Math.min(
    Math.max(1, view.width - margin * 2) / width,
    Math.max(1, view.height - margin * 2) / height,
  ));
  const centre = { x: (rect.x + rect.w / 2) / 100 * page.width, y: (rect.y + rect.h / 2) / 100 * page.height };
  return clampPan({
    zoom,
    panX: view.width / 2 - centre.x * zoom,
    panY: view.height / 2 - centre.y * zoom,
  }, page, view);
}

/* --------------------------------------------------------------- conversion */

/**
 * A point in the pane, in CSS pixels relative to its top-left corner, as a
 * percentage of the page — the unit every element's geometry is stored in.
 */
export function screenToPage(viewport: Viewport, page: Size, local: Point): Point | null {
  const back = invert(matrix(viewport));
  if (!back) return null;
  const scene = applyPoint(back, local);
  return { x: scene.x / page.width * 100, y: scene.y / page.height * 100 };
}

export function pageToScreen(viewport: Viewport, page: Size, percent: Point): Point {
  return applyPoint(matrix(viewport), { x: percent.x / 100 * page.width, y: percent.y / 100 * page.height });
}

/** The page's rectangle on screen, which the outside-page scrim is cut from. */
export function pageRect(viewport: Viewport, page: Size) {
  return {
    x: viewport.panX, y: viewport.panY,
    w: page.width * viewport.zoom, h: page.height * viewport.zoom,
  };
}

/* ------------------------------------------------------------------ rulers */

export type Tick = { value: number; at: number; inside: boolean };

/**
 * The coarsest spacing from the 1-2-5 ladder that still leaves `minPixels`
 * between two ticks on screen.
 *
 * Rulers are only useful if the labels do not collide, and the spacing has to
 * change as the view zooms: 100px apart is right at 100%, absurd at 5% and
 * useless at 800%. The ladder is what every drawing program uses, because a
 * reader can divide by 1, 2 and 5 in their head and not by 3 or 7.
 */
export function tickStep(zoom: number, minPixels = 72): number {
  if (!(zoom > 0)) return 1;
  const target = minPixels / zoom;
  const power = 10 ** Math.floor(Math.log10(Math.max(target, Number.MIN_VALUE)));
  for (const multiple of [1, 2, 5]) {
    if (power * multiple >= target) return power * multiple;
  }
  return power * 10;
}

/**
 * Ticks along one axis, in output pixels, positioned in pane pixels.
 *
 * The origin is the page's own corner rather than the pane's, so a reading of
 * zero means the edge of the artboard and negative numbers mean the workspace
 * outside it — which is the only reading that helps when placing something
 * against a margin.
 */
export function rulerTicks(viewport: Viewport, page: Size, axis: "x" | "y", viewLength: number): Tick[] {
  if (!(viewport.zoom > 0) || viewLength <= 0) return [];
  const pan = axis === "x" ? viewport.panX : viewport.panY;
  const span = axis === "x" ? page.width : page.height;
  const step = tickStep(viewport.zoom);
  const from = (0 - pan) / viewport.zoom;
  const to = (viewLength - pan) / viewport.zoom;
  const ticks: Tick[] = [];
  for (let value = Math.ceil(from / step) * step; value <= to; value += step) {
    // -0 prints as "-0", which reads as a bug to anyone looking at a ruler.
    const reading = value === 0 ? 0 : value;
    ticks.push({ value: reading, at: reading * viewport.zoom + pan, inside: reading >= 0 && reading <= span });
  }
  return ticks;
}
