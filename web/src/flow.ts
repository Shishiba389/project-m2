/**
 * MINIMA Resize — single source of truth for the workflow.
 *
 * One screen at a time, overlays stack on top, and every derived value
 * (status badges, apply scope, object geometry) is computed here so the
 * Gallery, Editor, Review and Export surfaces can never disagree.
 *
 * See design-system/minima-resize/pages/flow.md for the wiring table.
 */

import { begin } from "@/src/selfcheck";
import {
  fullPageImage, layoutBox, pictureAspect,
  type AlignAxes, type CropRect, type FitMode, type ImageBox, type ImageElement, type PageSize,
} from "@/src/image-geometry";
import { croppedBox, rescaleBox } from "@/src/gestures";
import { bounds, fromBox } from "@/src/mat3";
import type { FrameElement } from "@/src/frame-geometry";
import { isWhole, subjectInBox, type Subject } from "@/src/subject";

export type Screen = "import" | "gallery" | "editor" | "review" | "presets" | "settings" | "batch";
export type Status = "Completed" | "Pending" | "Warning" | "Error";
export type Scope = "current" | "selected" | "all";
export type Fit = "Fit" | "Fill" | "Stretch";
export type Align =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right";
export type DupPolicy = "skip" | "overwrite" | "rename";

export type Preset = {
  id: string;
  label: string;
  category: "Marketplace" | "Social Media" | "Custom";
  width: number;
  height: number;
  /** Safe-area inset as a percentage of the canvas. */
  safeX: number;
  safeY: number;
  background: string;
  align: Align;
  fit: Fit;
};

export const PRESETS: Preset[] = [
  { id: "zalando", label: "Zalando 9:13", category: "Marketplace", width: 1801, height: 2600, safeX: 16.66, safeY: 10, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "amazon", label: "Amazon (1:1)", category: "Marketplace", width: 2000, height: 2000, safeX: 7.5, safeY: 7.5, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "douglas", label: "Douglas (1:1)", category: "Marketplace", width: 1500, height: 1500, safeX: 8, safeY: 8, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "shopee", label: "Shopee (1:1)", category: "Marketplace", width: 1600, height: 1600, safeX: 6, safeY: 6, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "lazada", label: "Lazada (1:1)", category: "Marketplace", width: 1200, height: 1200, safeX: 6, safeY: 6, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "ig-square", label: "Instagram Square (1:1)", category: "Social Media", width: 1080, height: 1080, safeX: 5, safeY: 5, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "ig-portrait", label: "Instagram Portrait (4:5)", category: "Social Media", width: 1080, height: 1350, safeX: 6, safeY: 8, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "ig-story", label: "Instagram Story (9:16)", category: "Social Media", width: 1080, height: 1920, safeX: 8, safeY: 14, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "tiktok", label: "TikTok (9:16)", category: "Social Media", width: 1080, height: 1920, safeX: 8, safeY: 16, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "facebook", label: "Facebook (1:1)", category: "Social Media", width: 1200, height: 1200, safeX: 6, safeY: 6, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "product-master", label: "Product Master", category: "Custom", width: 3000, height: 3000, safeX: 10, safeY: 10, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "boj-catalog", label: "BOJ Catalog", category: "Custom", width: 2048, height: 2048, safeX: 12, safeY: 12, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "my-brand", label: "My Brand Preset", category: "Custom", width: 1801, height: 2600, safeX: 16.66, safeY: 10, background: "#FFFFFF", align: "center", fit: "Fit" },
];

/** Custom presets live in app state, so callers pass their own list. */
export const presetById = (id: string, list: Preset[] = PRESETS) => list.find((preset) => preset.id === id) ?? list[0];

/** A new custom preset seeded from whatever is currently in the inspector. */
export function customPreset(label: string, from: Preset, list: Preset[]): Preset {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "preset";
  let id = base;
  let n = 2;
  while (list.some((preset) => preset.id === id)) id = base + "-" + n++;
  return { ...from, id, label, category: "Custom" };
}

/**
 * Marketplace canvases are rarely exact ratios: 1801x2600 reduces to itself,
 * and "1801 : 2600" is not a ratio anyone reads. Approximate to the nearest
 * ratio with a small denominator, and say so when it is not exact.
 */
export function ratioLabel(width: number, height: number) {
  const divisor = gcd(width, height);
  const w = width / divisor;
  const h = height / divisor;
  if (w <= 40 && h <= 40) return `${w} : ${h}`;

  const exact = width / height;
  let best = { w: 1, h: 1, error: Infinity };
  for (let d = 1; d <= 32; d += 1) {
    const n = Math.round(exact * d);
    if (n < 1) continue;
    const error = Math.abs(n / d - exact);
    if (error < best.error - 1e-12) best = { w: n, h: d, error };
  }
  return `${best.error / exact < 0.001 ? "" : "≈ "}${best.w} : ${best.h}`;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/* ------------------------------------------------------------------ assets */

export type Format = "png" | "jpg" | "webp" | "tiff";
export type Resolution = "large" | "medium" | "small";
/**
 * Why an image is flagged: it is enlarged past its own pixels, or part of it
 * falls off the page. Both are measured on the layout the export will use.
 */
export type WarningReason = "upscale" | "clipping";
/** Manual image position inside a crop frame, in percent of the output canvas. */
export type Asset = {
  id: number;
  name: string;
  kind: "shoe" | "beauty" | "fashion" | "bottle";
  format: Format;
  /** The dropped file, when there is one. */
  file?: File;
  /** Object URL for the file. Owned by the app, revoked when the asset goes. */
  url?: string;
  /** Small generated preview; Gallery and filmstrip never decode the original. */
  thumbnailUrl?: string;
  /** Source pixel dimensions: the picture's aspect, and how far it can be enlarged. */
  src: { w: number; h: number };
  /** Set once the image has been edited or had an edit applied to it. */
  processed: boolean;
  /** Unreadable file; never resolvable by re-running the preset. */
  corrupt: boolean;
  /**
   * Measured at import: almost every pixel is transparent or white, so the
   * layer is invisible against the page and needs a locator when selected.
   */
  faint?: boolean;
  /**
   * Where the product is in the picture, found at import (§20-21). Null when
   * the background is not plain enough to tell - the whole picture is then
   * measured, and nothing claims to know where the product is. Undefined for
   * an image that was never decoded.
   */
  subject?: Subject | null;
  /**
   * The image's canonical editable geometry. The output page never owns this:
   * an element can sit wholly or partly outside the page.
   *
   * Null means "laid out by the page": the image has never been placed by
   * hand, so its box is derived from the page's size, fit and alignment every
   * time it is read (`elementOf`). That is what keeps fifty untouched imports
   * correct when the preset changes underneath them - a stored box would be a
   * stale copy of a layout nobody chose. The first hand edit writes a real box.
   */
  element: ImageElement | null;
  /**
   * Set when this image is a free layer on the shared canvas rather than just
   * the batch item the Gallery lists. The active asset always renders; these
   * render alongside it.
   */
};

/** Ratio drift above this reads as a real mismatch rather than rounding. */
const MISMATCH_TOLERANCE = 0.02;

export function statusOf(asset: Asset, preset: Preset): Status {
  if (asset.corrupt) return "Error";
  if (!asset.processed) return "Pending";
  return warningReason(asset, preset) ? "Warning" : "Completed";
}

/**
 * Why an asset is warned, so Review can explain it and fix it. Measured live
 * on the layout the export will draw - there is no stored verdict to go stale
 * when the image or the page changes.
 */
export function warningReason(asset: Asset, preset: Preset): WarningReason | null {
  if (asset.corrupt || !asset.processed) return null;
  const warnings = validateElement(elementOf(asset, preset), asset.src, preset, asset.subject);
  if (warnings.some((warning) => warning.code === "CLIPPING")) return "clipping";
  if (warnings.some((warning) => warning.code === "UPSCALE")) return "upscale";
  return null;
}

export function resolutionOf(asset: Asset): Resolution {
  const longest = Math.max(asset.src.w, asset.src.h);
  if (longest >= 2400) return "large";
  if (longest >= 1200) return "medium";
  return "small";
}

export function mismatch(asset: Asset, preset: Preset) {
  const source = asset.src.w / asset.src.h;
  const target = preset.width / preset.height;
  return Math.abs(source - target) / target > MISMATCH_TOLERANCE;
}

export function countByStatus(assets: Asset[], preset: Preset) {
  const counts = { All: assets.length, Completed: 0, Pending: 0, Warning: 0, Error: 0 };
  for (const asset of assets) counts[statusOf(asset, preset)] += 1;
  return counts;
}

/* ------------------------------------------------------------------- filter */

export type GalleryFilter = {
  status: "All" | Status;
  query: string;
  formats: Format[];
  resolutions: Resolution[];
  errorTypes: (WarningReason | "corrupt")[];
  sort: "name" | "date" | "size";
};

export const emptyFilter: GalleryFilter = { status: "All", query: "", formats: [], resolutions: [], errorTypes: [], sort: "name" };

/** Empty facet arrays mean "no restriction", which is what an unticked menu means. */
export function filterAssets(assets: Asset[], preset: Preset, filter: GalleryFilter) {
  const needle = filter.query.trim().toLowerCase();
  const rows = assets.filter((asset) => {
    if (filter.status !== "All" && statusOf(asset, preset) !== filter.status) return false;
    if (needle && !asset.name.toLowerCase().includes(needle)) return false;
    if (filter.formats.length && !filter.formats.includes(asset.format)) return false;
    if (filter.resolutions.length && !filter.resolutions.includes(resolutionOf(asset))) return false;
    if (filter.errorTypes.length) {
      const reason = asset.corrupt ? "corrupt" : warningReason(asset, preset);
      if (!reason || !filter.errorTypes.includes(reason)) return false;
    }
    return true;
  });
  const order = filter.sort === "name"
    ? (a: Asset, b: Asset) => a.name.localeCompare(b.name, undefined, { numeric: true })
    : filter.sort === "date" ? (a: Asset, b: Asset) => b.id - a.id
    : (a: Asset, b: Asset) => sourceBytes(b) - sourceBytes(a);
  return rows.sort(order);
}

export const sourceBytes = (asset: Asset) => asset.src.w * asset.src.h * 3;

/** Filename an export would write, given the naming options. */
export function outputName(asset: Asset, format: Format, suffix: string, keepName: boolean) {
  const dot = asset.name.lastIndexOf(".");
  const stem = keepName && dot > 0 ? asset.name.slice(0, dot) : `image_${asset.id}`;
  return `${stem}${suffix}.${format}`;
}

/* ------------------------------------------------------------------- import */

/**
 * Apply the "handling existing files" policy from the import dialog.
 * Returns the assets to keep (existing, possibly overwritten) plus the new
 * ones, and how many incoming files were skipped.
 */
export function mergeImport(
  existing: Asset[],
  incoming: { name: string; src?: { w: number; h: number }; file?: File; url?: string; thumbnailUrl?: string; corrupt?: boolean; faint?: boolean; subject?: Subject | null }[],
  policy: DupPolicy,
): { assets: Asset[]; added: number; skipped: number; renamed: number } {
  const assets = [...existing];
  const taken = new Set(assets.map((asset) => asset.name));
  const kinds: Asset["kind"][] = ["shoe", "beauty", "fashion", "bottle"];
  let added = 0;
  let skipped = 0;
  let renamed = 0;

  incoming.forEach((file, index) => {
    const fresh: Asset = {
      id: Date.now() + index,
      name: file.name,
      kind: kinds[index % kinds.length],
      format: formatOf(file.name),
      file: file.file,
      url: file.url,
      thumbnailUrl: file.thumbnailUrl,
      src: file.src ?? { w: 1801, h: 2600 },
      processed: false,
      corrupt: Boolean(file.corrupt),
      faint: file.faint,
      subject: file.subject,
      element: null,
    };
    const clash = taken.has(file.name);

    if (clash && policy === "skip") {
      skipped += 1;
      return;
    }
    if (clash && policy === "overwrite") {
      const at = assets.findIndex((asset) => asset.name === file.name);
      assets[at] = { ...fresh, id: assets[at].id };
      added += 1;
      return;
    }
    if (clash) {
      fresh.name = nextFreeName(file.name, taken);
      renamed += 1;
    }
    taken.add(fresh.name);
    assets.unshift(fresh);
    added += 1;
  });

  return { assets, added, skipped, renamed };
}

function formatOf(name: string): Format {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "jpg";
  if (ext === "webp") return "webp";
  if (ext === "tif" || ext === "tiff") return "tiff";
  return "png";
}

function nextFreeName(name: string, taken: Set<string>) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  while (taken.has(`${stem} (${n})${ext}`)) n += 1;
  return `${stem} (${n})${ext}`;
}

/* ----------------------------------------------------------------- geometry */

/** Object box in percent of the canvas, so it survives any zoom level. */
export type Box = { x: number; y: number; w: number; h: number };

/** Place a sized box at one of the nine anchors inside the safe rect. */
export function anchor(align: Align, box: Box, safeX: number, safeY: number): Box {
  const [vertical, horizontal] = splitAlign(align);
  const x =
    horizontal === "left" ? safeX : horizontal === "right" ? 100 - safeX - box.w : (100 - box.w) / 2;
  const y =
    vertical === "top" ? safeY : vertical === "bottom" ? 100 - safeY - box.h : (100 - box.h) / 2;
  return { ...box, x, y };
}

function splitAlign(align: Align): ["top" | "middle" | "bottom", "left" | "center" | "right"] {
  if (align === "center") return ["middle", "center"];
  if (align === "top" || align === "bottom") return [align, "center"];
  if (align === "left" || align === "right") return ["middle", align];
  const [vertical, horizontal] = align.split("-") as ["top" | "bottom", "left" | "right"];
  return [vertical, horizontal];
}

/**
 * The eight handles of a diagnostic rectangle: four corners and four edges.
 * Corner handles move two edges, edge handles move one.
 */
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Nothing smaller than this, in percent of the canvas, stays grabbable. */
const MIN_SIDE = 4;

/**
 * Resize the frame by dragging one handle. Deltas are in percent of the
 * canvas. Each edge is clamped so the frame cannot invert or shrink below
 * MIN_SIDE, and `ratio` (w/h) keeps the frame proportional when the aspect
 * lock is on.
 */
export function resizeBox(box: Box, handle: Handle, dx: number, dy: number, ratio?: number): Box {
  const right = box.x + box.w;
  const bottom = box.y + box.h;
  let { x, y, w, h } = box;

  if (handle.includes("w")) {
    x = Math.min(box.x + dx, right - MIN_SIDE);
    w = right - x;
  }
  if (handle.includes("e")) {
    w = Math.max(MIN_SIDE, box.w + dx);
  }
  if (handle.includes("n")) {
    y = Math.min(box.y + dy, bottom - MIN_SIDE);
    h = bottom - y;
  }
  if (handle.includes("s")) {
    h = Math.max(MIN_SIDE, box.h + dy);
  }

  if (ratio && ratio > 0) {
    // An edge handle drives the other axis; a corner follows the wider drag.
    const vertical = handle === "n" || handle === "s";
    const horizontal = handle === "e" || handle === "w";
    if (vertical || (!horizontal && Math.abs(dy) > Math.abs(dx))) {
      w = Math.max(MIN_SIDE, h * ratio);
      if (handle.includes("w")) x = right - w;
    } else {
      h = Math.max(MIN_SIDE, w / ratio);
      if (handle.includes("n")) y = bottom - h;
    }
  }
  return { x, y, w, h };
}

/**
 * The frame expressed as margins from each canvas edge, which is how a print
 * spec is written. Reading and writing the same rect from either side keeps
 * the numeric fields and the handles in agreement.
 */
export type Margins = { top: number; right: number; bottom: number; left: number };

export function marginsOf(box: Box): Margins {
  return {
    top: box.y,
    left: box.x,
    right: 100 - box.x - box.w,
    bottom: 100 - box.y - box.h,
  };
}

export function boxFromMargins(margins: Margins): Box {
  const left = clampMargin(margins.left);
  const top = clampMargin(margins.top);
  const right = clampMargin(margins.right);
  const bottom = clampMargin(margins.bottom);
  return {
    x: left,
    y: top,
    w: Math.max(MIN_SIDE, 100 - left - right),
    h: Math.max(MIN_SIDE, 100 - top - bottom),
  };
}

const clampMargin = (value: number) =>
  Number.isFinite(value) ? Math.min(100 - MIN_SIDE, Math.max(0, value)) : 0;

/** Keep a frame inside the canvas after a move. */
export function clampBox(box: Box): Box {
  const w = Math.min(100, Math.max(MIN_SIDE, box.w));
  const h = Math.min(100, Math.max(MIN_SIDE, box.h));
  return {
    w, h,
    x: Math.min(100 - w, Math.max(0, box.x)),
    y: Math.min(100 - h, Math.max(0, box.y)),
  };
}

/** The frame spanning the whole canvas, for "fill the canvas". */
export const fullBox = (): Box => ({ x: 0, y: 0, w: 100, h: 100 });

export type Snapping = { safe: boolean; grid: boolean };

/** Thirds grid, matching the 3×3 overlay drawn on the canvas. */
const GRID_LINES = [0, 100 / 3, 200 / 3, 100];

/**
 * Snap a dragged box to whichever guides are switched on: the safe-area edges
 * and canvas centre lines, and the thirds grid. With both off the box is free.
 */
export function snapBox(box: Box, safeX: number, safeY: number, snapping: Snapping = { safe: true, grid: false }, tolerance = 1.2): Box {
  const targets = (inset: number, extent: number) => {
    const list: number[] = [];
    if (snapping.safe) list.push(inset, (100 - extent) / 2, 100 - inset - extent);
    if (snapping.grid) list.push(...GRID_LINES, ...GRID_LINES.map((line) => line - extent));
    return list;
  };
  const pull = (value: number, list: number[]) => {
    let best = value;
    let distance = tolerance;
    for (const target of list) {
      const gap = Math.abs(value - target);
      if (gap <= distance) { best = target; distance = gap; }
    }
    return best;
  };
  return { ...box, x: pull(box.x, targets(safeX, box.w)), y: pull(box.y, targets(safeY, box.h)) };
}

/* ---------------------------------------------------------------- document */

/** Everything the resize step owns. Undo/redo snapshots exactly this. */
export type Doc = {
  presetId: string;
  width: number;
  height: number;
  lock: boolean;
  /** Ratio captured when the aspect lock engaged, so typing stays predictable. */
  ratio: number;
  fit: Fit;
  align: Align;
  safeX: number;
  safeY: number;
  background: string;
  /** Locks page settings while keeping image import and export available. */
  templateLocked?: boolean;
  /** Frame containers on the canvas, bottom to top. Empty for a plain batch page. */
  frames: FrameElement[];
  /**
   * Every free image on the canvas, as instances rather than as assets.
   *
   * An asset is a reusable source; a placement is one appearance of it (§22).
   * The same file can be laid out three times, and each placement carries its
   * own geometry, its own crop and its own identity in the undo history. An
   * asset with no placement is not absent from the export: the canvas is a
   * template, and such an asset is run through it using its own `element`.
   */
  placements: Placement[];
  /**
   * The canvas stack, bottom to top, by layer key.
   *
   * Optional because it did not always exist: before there was a layers panel
   * the order was implicit - every free image below every frame, each in the
   * order its list happened to be in - and a document written then must still
   * open looking the way it did.  `orderStack` is what reconciles the two.
   */
  stack?: string[];
};

export const srcRatio = (asset: Asset) => asset.src.w / asset.src.h;
export const megabytes = (asset: Asset) => sourceBytes(asset) / 1_048_576;

export function docFromPreset(preset: Preset): Doc {
  return {
    presetId: preset.id, width: preset.width, height: preset.height, lock: true,
    ratio: preset.width / preset.height,
    fit: preset.fit, align: preset.align, safeX: preset.safeX, safeY: preset.safeY,
    background: preset.background, frames: [], placements: [],
  };
}

/** The frame a preset implies: its safe area. */
export const safeBox = (safeX: number, safeY: number): Box =>
  ({ x: safeX, y: safeY, w: 100 - 2 * safeX, h: 100 - 2 * safeY });

/** The live resize target: the preset row with the inspector's edits layered on. */
export function docTarget(doc: Doc, presets: Preset[]): Preset {
  return { ...presetById(doc.presetId, presets), width: doc.width, height: doc.height, safeX: doc.safeX, safeY: doc.safeY, align: doc.align, fit: doc.fit, background: doc.background };
}

/* ------------------------------------------------------------- page layout

   Fit, Fill and Stretch used to be CSS object-fit applied *inside* a box the
   size of the page. Now they choose the box itself, measured against the whole
   page - the white canvas - so the box an image is selected by is the picture
   the user sees, and pressing Fit on an image that was shrunk into a corner
   brings it back out to the page. */

type PageRules = Pick<Doc, "width" | "height" | "fit" | "align">;

export const alignAxes = (align: Align): AlignAxes => ({
  horizontal: align.includes("left") ? "left" : align.includes("right") ? "right" : "center",
  vertical: align.includes("top") ? "top" : align.includes("bottom") ? "bottom" : "center",
});
const alignFrom = (horizontal: AlignAxes["horizontal"], vertical: AlignAxes["vertical"]): Align => {
  if (vertical === "center") return horizontal === "center" ? "center" : horizontal;
  return horizontal === "center" ? vertical : `${vertical}-${horizontal}`;
};
export const fitModeOf = (fit: Fit): FitMode => fit === "Fit" ? "contain" : fit === "Fill" ? "cover" : "fill";

/** The element the page gives a picture: fitted, filled or stretched to it, at its alignment. */
export function pageLayout(src: { w: number; h: number }, doc: PageRules, crop: CropRect | null = null,
  fit: Fit = doc.fit, align: Align = doc.align): ImageElement {
  return { box: layoutBox(pictureAspect(src, crop), doc, fitModeOf(fit), alignAxes(align)), crop };
}

/** An asset's geometry: its own once placed by hand, the page's until then. */
export const elementOf = (asset: Pick<Asset, "element" | "src">, doc: PageRules): ImageElement =>
  asset.element ?? pageLayout(asset.src, doc);

/**
 * Lay an element out against the whole page again - the toolbar's Fit, Fill
 * and Stretch. Whatever size and place it had is replaced. The crop and the
 * mirrors are the user's and stay; rotation resets, so the result lines up
 * with the page edges instead of sticking out of them at an angle.
 */
export function relayout(element: ImageElement, src: { w: number; h: number }, doc: PageRules, fit: Fit, align: Align = doc.align): ImageElement {
  const laid = pageLayout(src, doc, element.crop, fit, align);
  return { crop: element.crop, box: { ...laid.box, flipH: element.box.flipH, flipV: element.box.flipV } };
}

const close = (left: number, right: number) => Math.abs(left - right) < 1e-6;

/** Which page layout an element is in right now, if any, so the toolbar can light that button. */
export function layoutMatch(element: ImageElement, src: { w: number; h: number }, doc: PageRules): Fit | null {
  if (element.box.rotation % 360 !== 0) return null;
  for (const fit of ["Fit", "Fill", "Stretch"] as const) {
    const box = pageLayout(src, doc, element.crop, fit).box;
    if (close(box.x, element.box.x) && close(box.y, element.box.y) && close(box.w, element.box.w) && close(box.h, element.box.h)) return fit;
  }
  return null;
}

/** Move a box so what is visible of it sits at one of nine places on the page. Its size does not change. */
export function alignOnPage(box: ImageBox, align: Align): ImageBox {
  const seen = bounds(fromBox(box));
  const axes = alignAxes(align);
  const x = axes.horizontal === "left" ? 0 : axes.horizontal === "right" ? 100 - seen.w : (100 - seen.w) / 2;
  const y = axes.vertical === "top" ? 0 : axes.vertical === "bottom" ? 100 - seen.h : (100 - seen.h) / 2;
  return { ...box, x: box.x + x - seen.x, y: box.y + y - seen.y };
}

/** Which of the nine places a box sits at, if it sits at one exactly. */
export function alignOf(box: ImageBox): Align | null {
  const seen = bounds(fromBox(box));
  const horizontal = close(seen.x, 0) ? "left" : close(seen.x + seen.w, 100) ? "right" : close(seen.x + seen.w / 2, 50) ? "center" : null;
  const vertical = close(seen.y, 0) ? "top" : close(seen.y + seen.h, 100) ? "bottom" : close(seen.y + seen.h / 2, 50) ? "center" : null;
  return horizontal && vertical ? alignFrom(horizontal, vertical) : null;
}

/**
 * Carry the document's stored boxes - placements and frames - onto its new
 * page size. Untouched assets need nothing: their layout is derived from the
 * page every time it is read.
 */
export function rescaleDoc(doc: Doc, from: PageSize): Doc {
  const to = { width: doc.width, height: doc.height };
  if (from.width === to.width && from.height === to.height) return doc;
  return {
    ...doc,
    placements: doc.placements.map((placement) => ({ ...placement, element: { ...placement.element, box: rescaleBox(placement.element.box, from, to) } })),
    frames: doc.frames.map((frame) => ({ ...frame, box: rescaleBox(frame.box, from, to) })),
  };
}
export const rescaleElement = (element: ImageElement | null, from: PageSize, to: PageSize): ImageElement | null =>
  element && { ...element, box: rescaleBox(element.box, from, to) };

/* -------------------------------------------------------------- validation */

/** One finding about a layout (§30). `review` means a person should look before export. */
export type ProcessingWarning = { code: "UPSCALE" | "CLIPPING"; severity: "warning" | "review"; message: string };

/** How far the picture is enlarged past its own pixels: 1 is one source pixel per output pixel. */
export function enlargement(element: ImageElement, src: { w: number; h: number }, doc: Pick<Doc, "width" | "height">) {
  const sourceW = src.w * (element.crop ? element.crop.right - element.crop.left : 1);
  const sourceH = src.h * (element.crop ? element.crop.bottom - element.crop.top : 1);
  const scale = Math.max(element.box.w / 100 * doc.width / sourceW, element.box.h / 100 * doc.height / sourceH);
  return Number.isFinite(scale) ? scale : 1;
}

/**
 * What the export will do to this picture, checked on the layout itself:
 * enlarged past its own pixels (§34: over 110% is a warning, over 150% needs
 * review), or cut off by the page.
 *
 * Cut off means the *product*, when it is known: a white margin running off
 * the page loses nothing, and a Fill that slices the product does. Without a
 * known product the whole picture is checked, and Fill is let off, since it
 * overflows the page on purpose.
 */
export function validateElement(element: ImageElement, src: { w: number; h: number }, doc: PageRules,
  subject?: Subject | null): ProcessingWarning[] {
  const warnings: ProcessingWarning[] = [];
  const scale = enlargement(element, src, doc);
  if (scale > 1.1) {
    warnings.push({ code: "UPSCALE", severity: scale > 1.5 ? "review" : "warning",
      message: `Enlarged to ${Math.round(scale * 100)}% of its source pixels.` });
  }
  const known = Boolean(subject) && !isWhole(subject!.rect);
  const share = subjectInBox(subject?.rect, element.crop);
  if (!share) {
    warnings.push({ code: "CLIPPING", severity: "warning", message: "The crop leaves none of the product showing." });
    return warnings;
  }
  const seen = bounds(fromBox(croppedBox(element.box, share, doc)));
  const slack = 0.05;
  const off = seen.x < -slack || seen.y < -slack || seen.x + seen.w > 100 + slack || seen.y + seen.h > 100 + slack;
  if (off && (known || layoutMatch(element, src, doc) !== "Fill")) {
    warnings.push({ code: "CLIPPING", severity: "warning",
      message: known ? "Part of the product is outside the page and will be cut off." : "Part of the image is outside the page and will be cut off." });
  }
  return warnings;
}

/** Placed by hand - the user's own edit, which an apply-all leaves alone unless asked (§38). */
export const isManual = (asset: Pick<Asset, "element">) => asset.element !== null && asset.element.origin !== "recipe";

/* -------------------------------------------------------------------- scope */

export function scopeAssets(scope: Scope, assets: Asset[], selected: number[], activeId: number) {
  if (scope === "all") return assets;
  if (scope === "selected") {
    const selectedSet = new Set(selected);
    return assets.filter((asset) => selectedSet.has(asset.id));
  }
  return assets.filter((asset) => asset.id === activeId);
}

/* ---------------------------------------------------------------- back rule */

/**
 * One rule for the top-bar Back button: go up one level, and show nothing when
 * there is no level above. Import and Gallery are both top-level destinations
 * reached from the rail, so Back is hidden on them — pointing Gallery's Back at
 * Gallery is what made the button look broken.
 */
export function backTarget(screen: Screen, hasAssets: boolean): Screen | null {
  if (screen === "editor" || screen === "review") return "gallery";
  if (screen === "presets" || screen === "settings" || screen === "batch") {
    return hasAssets ? "gallery" : "import";
  }
  return null; // import and gallery are the roots
}

/* --------------------------------------------------------------------- demo */

/* ----------------------------------------------------------------- history */

/**
 * Undo and redo run over two stacks — the document (canvas, frames) and the
 * image elements — ordered by a shared sequence number. One step moves the
 * stack holding the newer action, and both stacks when an action wrote to each
 * of them (deleting a frame removes the frame and frees the image it held).
 *
 * `elementSeq` is null when the element stack is empty; `docSeq` is -1 for an
 * empty document stack on undo, and Infinity on redo, so a missing stack never
 * wins the comparison.
 */
export const undoTargets = (elementSeq: number | null, docSeq: number) => ({
  document: elementSeq === null || elementSeq <= docSeq,
  element: elementSeq !== null && elementSeq >= docSeq,
});
export const redoTargets = (elementSeq: number | null, docSeq: number) => ({
  document: elementSeq === null || elementSeq >= docSeq,
  element: elementSeq !== null && elementSeq <= docSeq,
});

export function demo() {
  const finish = begin();
  const zalando = presetById("zalando");
  const square = presetById("amazon");
  const base: Asset = { id: 1, name: "a.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: false, corrupt: false, element: null };

  // Status is derived, never stored.
  console.assert(statusOf(base, zalando) === "Pending", "unprocessed reads Pending");
  console.assert(statusOf({ ...base, processed: true }, zalando) === "Completed", "9:13 source conforms to 9:13 preset");
  // A different ratio is not a fault any more: Fit pads by design. What is
  // flagged is what the export would actually do badly.
  console.assert(statusOf({ ...base, processed: true }, square) === "Completed", "a 9:13 picture fitted to a square page is fine");
  console.assert(statusOf({ ...base, processed: true, corrupt: true }, zalando) === "Error", "corrupt outranks everything");

  // Warning reasons drive both the Review copy and the error-type filter.
  const small = { ...base, processed: true, src: { w: 900, h: 900 } };
  console.assert(warningReason(small, zalando) === "upscale", "a small picture blown up past its pixels is flagged");
  console.assert(validateElement(elementOf(small, zalando), small.src, zalando)[0].severity === "review", "and past 150% it needs review");
  const offPage = { ...base, processed: true, element: { box: { ...fullPageImage().box, x: -30, w: 50, h: 50 }, crop: null } };
  console.assert(warningReason(offPage, zalando) === "clipping", "a picture pushed off the page is flagged");
  const big = { ...base, src: { w: 3602, h: 5200 } };
  const filled = { ...big, processed: true, element: relayout(elementOf(big, square), big.src, square, "Fill") };
  console.assert(warningReason(filled, square) === null, "Fill overflows the page on purpose, so it is not flagged");
  console.assert(warningReason(base, square) === null, "an unprocessed asset is not yet warned");
  console.assert(isManual(offPage) && !isManual(base) && !isManual({ element: { ...offPage.element, origin: "recipe" } }),
    "an image placed by hand is manual; one the page or a recipe placed is not");

  console.assert(resolutionOf(base) === "large", "2600px longest edge is large");
  console.assert(resolutionOf({ ...base, src: { w: 1600, h: 1600 } }) === "medium", "1600px is medium");
  console.assert(resolutionOf({ ...base, src: { w: 800, h: 600 } }) === "small", "800px is small");

  // The funnel menu: empty facets mean no restriction, ticked facets narrow.
  const batch: Asset[] = [
    base,
    { ...base, id: 2, name: "b.jpg", format: "jpg", src: { w: 900, h: 900 }, processed: true },
    { ...base, id: 3, name: "c.webp", format: "webp", processed: true, corrupt: true },
  ];
  console.assert(filterAssets(batch, zalando, emptyFilter).length === 3, "an empty filter hides nothing");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, formats: ["jpg"] }).length === 1, "format facet narrows");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, resolutions: ["small"] })[0].id === 2, "resolution facet narrows");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, errorTypes: ["corrupt"] })[0].id === 3, "error-type facet narrows");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, errorTypes: ["upscale"] })[0].id === 2, "the upscale facet finds the enlarged picture");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, status: "Pending" }).length === 1, "status facet narrows");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, query: "b." }).length === 1, "search narrows");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, formats: ["jpg"], resolutions: ["large"] }).length === 0, "facets combine with AND");
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, sort: "size" })[2].id === 2, "size sort puts the smallest last");

  // Export naming has to match what the dialog promises.
  console.assert(outputName(base, "jpg", "_resized", true) === "a_resized.jpg", "keeps the stem and swaps the extension");
  console.assert(outputName(base, "png", "", true) === "a.png", "an empty suffix is allowed");
  console.assert(outputName(base, "png", "_r", false) === "image_1_r.png", "dropping the name falls back to the id");

  // Import policies.
  const existing = [base];
  console.assert(mergeImport(existing, [{ name: "a.png" }], "skip").skipped === 1, "skip drops the clash");
  console.assert(mergeImport(existing, [{ name: "a.png" }], "skip").assets.length === 1, "skip keeps the original");
  const overwritten = mergeImport(existing, [{ name: "a.png", src: { w: 10, h: 10 } }], "overwrite");
  console.assert(overwritten.assets.length === 1 && overwritten.assets[0].src.w === 10, "overwrite replaces in place");
  console.assert(overwritten.assets[0].id === base.id, "overwrite keeps the original id");
  const renamedOnce = mergeImport(existing, [{ name: "a.png" }], "rename");
  console.assert(renamedOnce.assets.some((asset) => asset.name === "a (2).png"), "rename suffixes before the extension");
  const renamedTwice = mergeImport(renamedOnce.assets, [{ name: "a.png" }], "rename");
  console.assert(renamedTwice.assets.some((asset) => asset.name === "a (3).png"), "rename keeps counting past taken names");
  console.assert(mergeImport(existing, [{ name: "b.jpeg" }], "skip").assets[0].format === "jpg", "format comes from the extension");

  // Custom presets get a unique slug and land in the Custom category.
  const made = customPreset("My Brand Preset", zalando, PRESETS);
  console.assert(made.category === "Custom", "a new preset is custom");
  console.assert(made.id !== "my-brand", "a clashing slug is suffixed");
  console.assert(customPreset("Fresh One", zalando, PRESETS).id === "fresh-one", "a free slug is used as-is");

  // Ratios have to read as ratios, not as the pixel pair again.
  console.assert(ratioLabel(2000, 2000) === "1 : 1", "a square reduces exactly");
  console.assert(ratioLabel(1080, 1350) === "4 : 5", "instagram portrait reduces exactly");
  console.assert(ratioLabel(1080, 1920) === "9 : 16", "story reduces exactly");
  console.assert(ratioLabel(1801, 2600) === "9 : 13", "Zalando's unreducible pair reads as 9:13");
  console.assert(!ratioLabel(1801, 2600).includes("1801"), "and never echoes the pixel count");
  console.assert(ratioLabel(1000, 1731) === "≈ 15 : 26", "a pair that does not land close is marked approximate");
  console.assert(ratioLabel(1200, 1600) === "3 : 4", "a reducible pair stays exact");

  // Anchors land on the safe-area edges.
  const box: Box = { x: 0, y: 0, w: 40, h: 40 };
  console.assert(anchor("top-left", box, 10, 5).x === 10, "left anchor sits on the safe inset");
  console.assert(anchor("top-left", box, 10, 5).y === 5, "top anchor sits on the safe inset");
  console.assert(anchor("bottom-right", box, 10, 5).x === 50, "right anchor mirrors the inset");
  console.assert(anchor("center", box, 10, 5).x === 30, "centre ignores the inset");
  console.assert(anchor("right", box, 10, 5).y === 30, "single-axis alignment centres the other axis");

  // Diagnostic rectangle geometry: eight handles, margins, clamping.
  const frame: Box = { x: 20, y: 20, w: 60, h: 60 };
  console.assert(resizeBox(frame, "e", 10, 0).w === 70, "the east handle widens");
  console.assert(resizeBox(frame, "e", 10, 0).x === 20, "and leaves the left edge alone");
  const west = resizeBox(frame, "w", -10, 0);
  console.assert(west.x === 10 && west.w === 70, "the west handle moves the left edge and keeps the right");
  const north = resizeBox(frame, "n", 0, -10);
  console.assert(north.y === 10 && north.h === 70, "the north handle moves the top edge");
  console.assert(resizeBox(frame, "s", 0, 10).h === 70, "the south handle grows downward");
  const corner = resizeBox(frame, "se", 10, 20);
  console.assert(corner.w === 70 && corner.h === 80, "a corner moves both edges");
  console.assert(resizeBox(frame, "nw", -10, -10).x === 10, "the north-west corner moves both origins");
  console.assert(resizeBox(frame, "e", -200, 0).w === 4, "a frame cannot shrink below the minimum");
  console.assert(resizeBox(frame, "w", 200, 0).w === 4, "and cannot invert when dragged past itself");
  console.assert(resizeBox(frame, "w", 200, 0).x === 76, "the origin stops at the opposite edge");
  // With the aspect lock, the dominant axis drives the other.
  const locked = resizeBox(frame, "se", 20, 0, 1);
  console.assert(Math.abs(locked.w - locked.h) < 0.001, "a locked corner stays square for a 1:1 ratio");
  const lockedEdge = resizeBox(frame, "s", 0, 20, 2);
  console.assert(Math.abs(lockedEdge.w / lockedEdge.h - 2) < 0.001, "a locked edge honours the ratio");

  // Margins are the same rect read from the other side.
  const margins = marginsOf(frame);
  console.assert(margins.top === 20 && margins.left === 20, "margins read from the origin");
  console.assert(margins.right === 20 && margins.bottom === 20, "and from the far edges");
  const roundTrip = boxFromMargins(margins);
  console.assert(roundTrip.x === frame.x && roundTrip.w === frame.w, "margins round-trip back to the frame");
  console.assert(boxFromMargins({ top: 0, right: 0, bottom: 0, left: 0 }).w === 100, "zero margins span the canvas");
  console.assert(boxFromMargins({ top: 60, right: 0, bottom: 60, left: 0 }).h === 4, "opposing margins stop at the minimum");
  console.assert(boxFromMargins({ top: -5, right: 0, bottom: 0, left: 0 }).y === 0, "a negative margin is clamped");

  console.assert(clampBox({ x: -10, y: 0, w: 50, h: 50 }).x === 0, "a frame dragged off the left is pulled back");
  console.assert(clampBox({ x: 80, y: 0, w: 50, h: 50 }).x === 50, "and off the right too");
  console.assert(clampBox({ x: 0, y: 0, w: 200, h: 50 }).w === 100, "a frame cannot exceed the canvas");
  console.assert(fullBox().w === 100 && fullBox().x === 0, "the full frame spans the canvas");
  console.assert(HANDLES.length === 8, "eight handles, not four");
  console.assert(safeBox(10, 5).x === 10 && safeBox(10, 5).w === 80, "a preset frame is its safe area");
  console.assert(!("box" in docFromPreset(zalando)), "a preset owns page settings, not image geometry");

  // Snapping only bites near a target, and only for the guides that are on.
  console.assert(snapBox({ x: 10.5, y: 50, w: 40, h: 40 }, 10, 5).x === 10, "near edge snaps");
  console.assert(snapBox({ x: 20, y: 50, w: 40, h: 40 }, 10, 5).x === 20, "far edge is left alone");
  console.assert(snapBox({ x: 10.5, y: 50, w: 40, h: 40 }, 10, 5, { safe: false, grid: false }).x === 10.5, "with both guides off nothing snaps");
  console.assert(Math.abs(snapBox({ x: 33.6, y: 50, w: 40, h: 40 }, 10, 5, { safe: false, grid: true }).x - 100 / 3) < 0.001, "the grid pulls to a third");
  console.assert(snapBox({ x: 33.6, y: 50, w: 40, h: 40 }, 10, 5, { safe: false, grid: false }).x === 33.6, "the grid is ignored when off");
  console.assert(snapBox({ x: 29.6, y: 50, w: 40, h: 40 }, 10, 5, { safe: true, grid: true }).x === 30, "the nearest target wins when guides overlap");

  // Scope and Back are single rules, used by every button.
  const many: Asset[] = [base, { ...base, id: 2, name: "b.png" }, { ...base, id: 3, name: "c.png" }];
  console.assert(scopeAssets("current", many, [2, 3], 1).length === 1, "current scope is one image");
  console.assert(scopeAssets("selected", many, [2, 3], 1).length === 2, "selected scope follows the selection");
  console.assert(scopeAssets("all", many, [2, 3], 1).length === 3, "all scope is the whole batch");
  console.assert(backTarget("editor", true) === "gallery", "editor backs out to gallery");
  console.assert(backTarget("review", true) === "gallery", "review backs out to gallery");
  console.assert(backTarget("settings", true) === "gallery", "settings backs out to the work");
  console.assert(backTarget("settings", false) === "import", "settings backs out to import with no assets");
  console.assert(backTarget("batch", true) === "gallery", "batch backs out to the gallery");
  console.assert(backTarget("import", true) === null, "import is a root");
  console.assert(backTarget("gallery", true) === null, "gallery is a root, so Back is hidden rather than a no-op");

  // One Ctrl+Z is one action: the newer stack moves, both move when an action
  // wrote to each of them, and an empty stack never wins.
  console.assert(undoTargets(7, 3).element && !undoTargets(7, 3).document, "a newer image edit undoes alone");
  console.assert(undoTargets(3, 7).document && !undoTargets(3, 7).element, "a newer document edit undoes alone");
  const paired = undoTargets(5, 5);
  console.assert(paired.document && paired.element, "one action that wrote to both stacks undoes as one step");
  console.assert(undoTargets(null, 4).document && !undoTargets(null, 4).element, "an empty element stack falls through to the document");
  console.assert(undoTargets(4, -1).element && !undoTargets(4, -1).document, "an empty document stack falls through to the elements");
  console.assert(redoTargets(7, 3).document && !redoTargets(7, 3).element, "redo takes the older entry first");
  console.assert(redoTargets(3, 7).element && !redoTargets(3, 7).document, "and the older entry may be the image one");
  const pairedRedo = redoTargets(5, 5);
  console.assert(pairedRedo.document && pairedRedo.element, "a paired action redoes as one step too");
  console.assert(redoTargets(4, Infinity).element && !redoTargets(4, Infinity).document, "an empty document future never wins redo");

  /* -------------------------------------------------------- dropping files */

  const single = dropLayout(1, { x: 50, y: 50 })[0];
  console.assert(Math.abs(single.x + single.w / 2 - 50) < 1e-9 && Math.abs(single.y + single.h / 2 - 50) < 1e-9,
    "one image lands centred on the point it was dropped at");
  const tiled = dropLayout(9, { x: 50, y: 50 });
  console.assert(tiled.length === 9, "nine images are nine boxes");
  const overlapping = tiled.some((a, i) => tiled.some((b, j) =>
    i !== j && a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9));
  console.assert(!overlapping, "and no two of them overlap, so none is hidden under another");
  console.assert(new Set(tiled.map((box) => `${box.x},${box.y}`)).size === 9, "every one lands somewhere of its own");
  const spread = dropLayout(4, { x: 50, y: 50 });
  const midX = spread.reduce((total, box) => total + box.x + box.w / 2, 0) / 4;
  console.assert(Math.abs(midX - 50) < 1e-9, "the grid is centred on the drop point, not hung off one corner");
  console.assert(dropLayout(16, { x: 50, y: 50 })[0].w < dropLayout(2, { x: 50, y: 50 })[0].w,
    "a bigger drop uses smaller tiles rather than running off the page");

  /* ----------------------------------------------------- the canvas stack */

  const present = ["asset-1", "frame-a", "asset-2"];
  console.assert(orderStack(undefined, present).join() === present.join(),
    "a document with no stack keeps the order it always had");
  console.assert(orderStack(["frame-a", "asset-2", "asset-1"], present).join() === "frame-a,asset-2,asset-1",
    "an arranged stack is obeyed");
  // A newly added object is not in the stack yet and belongs on top, which is
  // the end of a bottom-to-top list.
  console.assert(orderStack(["frame-a"], present).join() === "frame-a,asset-1,asset-2",
    "anything the stack does not mention goes above what it does");
  console.assert(orderStack(["asset-9", "frame-a"], present).join() === "frame-a,asset-1,asset-2",
    "and a key for an object that is gone is dropped rather than left as a hole");

  const stack = ["a", "b", "c", "d"];
  console.assert(reorderStack(stack, "a", 4).join() === "b,c,d,a", "a layer can be sent to the top");
  console.assert(reorderStack(stack, "d", 0).join() === "d,a,b,c", "and to the bottom");
  console.assert(reorderStack(stack, "b", 3).join() === "a,c,b,d", "moving down lands after the gap closes, not before it");
  console.assert(reorderStack(stack, "c", 1).join() === "a,c,b,d", "and moving up lands where the indicator was");
  console.assert(reorderStack(stack, "b", 1).join() === stack.join(), "dropping a layer back where it started changes nothing");
  console.assert(reorderStack(stack, "z", 0).join() === stack.join(), "a layer that is not in the stack cannot be moved");
  console.assert(reorderStack(stack, "a", 99).join() === "b,c,d,a", "an index past the end clamps to the top");

  /* The panel counts slots from the top; the stack counts from the bottom, so
     a slot `i` rows down the panel is `length - i` up the stack.  This is the
     one place an off-by-one would be invisible - the list would look right and
     the exported file would be wrong - so the conversion is asserted from the
     reader's end: what the panel shows after the move. */
  const bottomUp = ["a", "b", "c"];
  const asShown = (order: string[]) => [...order].reverse().join();
  const drop = (key: string, slotFromTop: number) => reorderStack(bottomUp, key, bottomUp.length - slotFromTop);
  console.assert(asShown(bottomUp) === "c,b,a", "the panel shows the topmost layer first");
  console.assert(asShown(drop("a", 0)) === "a,c,b", "dropping the bottom layer above the first row puts it on top");
  console.assert(asShown(drop("c", 3)) === "b,a,c", "and dropping the top layer below the last row puts it at the bottom");
  console.assert(asShown(drop("b", 0)) === "b,c,a", "Alt+Up from the middle row lifts it one place");
  console.assert(asShown(drop("b", 3)) === "c,a,b", "Alt+Down from the middle row drops it one place");
  console.assert(asShown(drop("b", 1)) === "c,b,a", "dropping a layer back in its own gap changes nothing");
  // The panel can show one more row than the stack arranges - the page's own
  // image is pinned below them all - so a drop past the last arrangeable row
  // has to land at the bottom rather than run off the end.
  console.assert(asShown(drop("c", 4)) === "b,a,c", "a slot past the last row clamps to the bottom");
  console.assert(reorderStack(bottomUp, "c", -1).join() === "c,a,b", "and a negative index cannot escape either");

  finish("flow.ts");
}

/* ------------------------------------------------------------ canvas keys

   A canvas selection spans two kinds of object - free images, which belong to
   assets, and frames, which belong to the document - so its members are named
   by an opaque key rather than by an id whose type would say which list to
   look in. */
/** One appearance of an asset on the canvas. */
export type Placement = { id: string; assetId: number; element: ImageElement };
let placementSeq = 0;
export const newPlacement = (assetId: number, element: ImageElement): Placement =>
  ({ id: `p${(placementSeq += 1).toString(36)}${Date.now().toString(36)}`, assetId, element });

/**
 * One free image on the canvas, whichever list it came from.
 *
 * `placementId` is null for the *subject*: the asset currently open in the
 * editor, previewed on the canvas before anything has placed it there. That is
 * the batch case - fifty imports run through one template - and editing it
 * edits the asset's own geometry. Every other layer is a placement, and
 * editing it edits the document.
 */
export type CanvasLayer = {
  key: string; assetId: number; element: ImageElement; placementId: string | null;
};

/**
 * Where several images dropped at once should land.
 *
 * A cascade - each copy nudged a few percent past the last - is what most
 * editors do, and it is wrong here: these are product shots dropped fifty at a
 * time, and a cascade leaves fifty near-identical rectangles in a pile that
 * has to be dragged apart one by one. A grid around the drop point is the same
 * number of objects with none of them hidden.
 */
export function dropLayout(count: number, at: { x: number; y: number }) {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  // The grid fills a little over half the page, so a drop is visible at a
  // glance without covering the whole artboard.
  const size = Math.min(50, 60 / columns);
  const gap = size * 1.1;
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      x: at.x + (column - (columns - 1) / 2) * gap - size / 2,
      y: at.y + (row - (rows - 1) / 2) * gap - size / 2,
      w: size, h: size,
    };
  });
}

export const assetKey = (id: number) => `asset-${id}`;
export const placementKey = (id: string) => `place-${id}`;
export const placementIdOf = (key: string) => key.startsWith("place-") ? key.slice(6) : null;
export const frameKey = (id: string) => `frame-${id}`;
const keyIsAsset = (key: string) => key.startsWith("asset-");
export const assetIdOf = (key: string) => keyIsAsset(key) ? Number(key.slice(6)) : null;
export const frameIdOf = (key: string) => key.startsWith("frame-") ? key.slice(6) : null;

/**
 * The canvas stack, bottom to top.
 *
 * `order` is what the user arranged; `present` is what is actually on the
 * canvas right now, in the order the app produced before a stack existed.
 * Keys the order does not mention go on top, in that legacy order - which is
 * both what an old document needs (it has no order, so it keeps its old look)
 * and what a newly added object needs (it lands above everything, where a new
 * object belongs).  Keys the order mentions but that are gone are dropped, so
 * deleting an object cannot leave a hole that later resurfaces.
 */
export function orderStack(order: string[] | undefined, present: string[]): string[] {
  const here = new Set(present);
  const placed = (order ?? []).filter((key) => here.has(key));
  const seen = new Set(placed);
  return [...placed, ...present.filter((key) => !seen.has(key))];
}

/** Move one layer to another position in the stack, closing the gap behind it. */
export function reorderStack(order: string[], key: string, to: number): string[] {
  const from = order.indexOf(key);
  if (from < 0) return order;
  const without = order.filter((entry) => entry !== key);
  const at = Math.max(0, Math.min(without.length, to > from ? to - 1 : to));
  return [...without.slice(0, at), key, ...without.slice(at)];
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("flow")) demo();