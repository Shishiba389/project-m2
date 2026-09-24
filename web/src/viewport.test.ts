import { begin } from "@/src/selfcheck";
import {
  clampPan, clampZoom, fitViewport, fitZoom, MAX_ZOOM, MIN_ZOOM, matrix, pageRect, pageToScreen,
  pan, rulerTicks, screenToPage, tickStep, zoomAt, zoomCentred, zoomToRect, type Viewport,
} from "@/src/viewport";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-6) => Math.abs(left - right) < tolerance;

// A marketplace page in a typical pane.
const page = { width: 1801, height: 2600 };
const view = { width: 900, height: 700 };

/* ------------------------------------------------------------------- fit */

const fitted = fitViewport(page, view);
console.assert(near(fitted.zoom, fitZoom(page, view)), "fitting uses the fit zoom");
console.assert(fitted.zoom < 1, "a 2600px page does not fit a 700px pane at 1:1");
console.assert(near(page.height * fitted.zoom, view.height - 64), "the tall axis is the one that binds, margin included");
console.assert(near(fitted.panX + page.width * fitted.zoom / 2, view.width / 2), "and the page is centred horizontally");
console.assert(near(fitted.panY + page.height * fitted.zoom / 2, view.height / 2), "and vertically");
console.assert(fitZoom({ width: 0, height: 0 }, view) === 1, "a degenerate page does not divide by zero");
console.assert(clampZoom(500) === MAX_ZOOM && clampZoom(0) === MIN_ZOOM, "zoom stays within its limits");

/* ------------------------------------------------------ screen and world */

const round = screenToPage(fitted, page, pageToScreen(fitted, page, { x: 37, y: 62 }))!;
console.assert(near(round.x, 37) && near(round.y, 62), "a page percentage survives the round trip through the screen");
const origin = pageToScreen(fitted, page, { x: 0, y: 0 });
console.assert(near(origin.x, fitted.panX) && near(origin.y, fitted.panY), "the page origin lands on the pan offset");
const rect = pageRect(fitted, page);
console.assert(near(rect.w, page.width * fitted.zoom) && near(rect.h, page.height * fitted.zoom), "the page rectangle scales with zoom");
console.assert(matrix(fitted).b === 0 && matrix(fitted).c === 0, "the viewport never rotates or shears");
console.assert(screenToPage({ zoom: 0, panX: 0, panY: 0 }, page, { x: 1, y: 1 }) === null, "a collapsed viewport has no inverse, and says so");

/* --------------------------------------------- zoom anchored at a point */

// The whole point: whatever sits under the cursor must not move.
const anchor = { x: 640, y: 210 };
const before = screenToPage(fitted, page, anchor)!;
const zoomedIn = zoomAt(fitted, fitted.zoom * 2.5, anchor, page, view);
const after = screenToPage(zoomedIn, page, anchor)!;
console.assert(near(after.x, before.x, 1e-6) && near(after.y, before.y, 1e-6), "the point under the cursor stays under the cursor");
console.assert(zoomedIn.zoom > fitted.zoom, "and the view actually zoomed in");
const zoomedOut = zoomAt(zoomedIn, fitted.zoom, anchor, page, view);
console.assert(near(screenToPage(zoomedOut, page, anchor)!.x, before.x, 1e-6), "zooming back out holds the same point");
// Centred zoom is the same operation with the middle of the pane as anchor.
const middle = { x: view.width / 2, y: view.height / 2 };
const centredBefore = screenToPage(fitted, page, middle)!;
const centred = zoomCentred(fitted, fitted.zoom * 2, page, view);
console.assert(near(screenToPage(centred, page, middle)!.x, centredBefore.x, 1e-6), "the +/- buttons hold the centre of the pane");

/* -------------------------------------------------------------- panning */

const nudged = pan(fitted, -40, 25, page, view);
console.assert(near(nudged.panX, fitted.panX - 40) && near(nudged.panY, fitted.panY + 25), "panning moves the view, not the page");
console.assert(near(nudged.zoom, fitted.zoom), "and never changes zoom");
// Soft clamp: the workspace is large but not endless, so Fit is never the only
// way back. The centre of the view stays within the page grown by one page.
const runaway = pan(fitted, 100000, 100000, page, view);
const centreWorldX = (view.width / 2 - runaway.panX) / runaway.zoom;
const centreWorldY = (view.height / 2 - runaway.panY) / runaway.zoom;
console.assert(centreWorldX >= -page.width - 1 && centreWorldX <= page.width * 2 + 1, "panning far right stops one page out");
console.assert(centreWorldY >= -page.height - 1 && centreWorldY <= page.height * 2 + 1, "and so does panning down");
const backwards = pan(fitted, -100000, -100000, page, view);
console.assert((view.width / 2 - backwards.panX) / backwards.zoom >= -page.width - 1, "the other direction is bounded too");
console.assert(clampPan(fitted, page, view).panX === fitted.panX, "a viewport already inside the bounds is left alone");

/* ------------------------------------------------------ zoom to a target */

const framed = zoomToRect({ x: 40, y: 45, w: 20, h: 10 }, page, view);
const framedCentre = screenToPage(framed, page, middle)!;
console.assert(near(framedCentre.x, 50, 1e-4) && near(framedCentre.y, 50, 1e-4), "zoom to selection centres that selection");
console.assert(framed.zoom > fitted.zoom, "and zooms in on it");
const wide: Viewport = zoomToRect({ x: 0, y: 0, w: 100, h: 100 }, page, view);
console.assert(near(wide.zoom, fitted.zoom), "framing the whole page is the same as fitting it");

/* --------------------------------------------------------------- rulers */

// The ladder: never finer than the minimum spacing, and always one of 1/2/5.
for (const zoom of [0.02, 0.1, 0.33, 1, 2.5, 8]) {
  const step = tickStep(zoom);
  console.assert(step * zoom >= 72, `a tick step at ${zoom} keeps labels from colliding`);
  const mantissa = step / 10 ** Math.floor(Math.log10(step));
  console.assert(Math.abs(mantissa - 1) < 1e-9 || Math.abs(mantissa - 2) < 1e-9 || Math.abs(mantissa - 5) < 1e-9,
    `and ${step} is a round number a reader can divide`);
}
console.assert(tickStep(1) < tickStep(0.1), "zooming out coarsens the ruler");
console.assert(tickStep(0) === 1, "a collapsed viewport does not take the log of zero");

const ticks = rulerTicks(fitted, page, "x", view.width);
console.assert(ticks.length > 1, "a fitted page shows several ticks");
console.assert(ticks.every((tick) => tick.at >= -1 && tick.at <= view.width + 1), "and every one of them is on screen");
const zero = ticks.find((tick) => tick.value === 0);
console.assert(zero !== undefined && Math.abs(zero.at - fitted.panX) < 1e-9, "zero sits on the page's own edge, not the pane's");
console.assert(ticks.some((tick) => !tick.inside), "the workspace outside the page is measured too");
console.assert(ticks.filter((tick) => tick.inside).length > 0, "and so is the page itself");
const spacing = ticks[1].at - ticks[0].at;
console.assert(spacing >= 72, "ticks are at least the minimum apart on screen");
console.assert(rulerTicks({ zoom: 0, panX: 0, panY: 0 }, page, "x", view.width).length === 0, "an unplaced viewport has no ruler");
console.assert(rulerTicks(fitted, page, "y", 0).length === 0, "and neither does a pane with no height");
// Panning slides the ticks by exactly the pan, because the ruler measures the
// page and not the window.
const slid = rulerTicks({ ...fitted, panX: fitted.panX + 37 }, page, "x", view.width);
console.assert(Math.abs(slid.find((tick) => tick.value === 0)!.at - (fitted.panX + 37)) < 1e-9, "the ruler follows the page as it pans");

finish("viewport.test.ts");
