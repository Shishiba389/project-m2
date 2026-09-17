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
import { fullPageImage, type ImageElement } from "@/src/image-geometry";
import type { LayoutResult } from "@/src/editor-engine";

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
export type WarningReason = "aspect" | "safe";
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
  /** Source pixel dimensions — drives the aspect-mismatch warning. */
  src: { w: number; h: number };
  /** Set once a preset has been applied to this asset. */
  processed: boolean;
  /** Content was pushed past the safe area by a Fill/Stretch apply. */
  overflow: boolean;
  /** Auto-fix (crop/pad) accepted, so every warning on this asset is resolved. */
  fixed: boolean;
  /** Unreadable file; never resolvable by re-running the preset. */
  corrupt: boolean;
  /** Independent result produced by EditorModeEngine for this image. */
  layout?: LayoutResult;
  /**
   * The image's canonical editable geometry. The output page never owns this:
   * an element can sit wholly or partly outside the page.
   */
  element: ImageElement;
};

/** Ratio drift above this reads as a real mismatch rather than rounding. */
const MISMATCH_TOLERANCE = 0.02;

export function statusOf(asset: Asset, preset: Preset): Status {
  if (asset.corrupt) return "Error";
  if (!asset.processed) return "Pending";
  return warningReason(asset, preset) ? "Warning" : "Completed";
}

/** Why an asset is warned, so Review can explain it and auto-fix can clear it. */
export function warningReason(asset: Asset, preset: Preset): WarningReason | null {
  if (asset.corrupt || !asset.processed || asset.fixed) return null;
  if (asset.layout) {
    if (!asset.layout.warnings.length) return null;
    return asset.layout.warnings.some((warning) => warning.code === "CLIPPING" || warning.code === "SAFE_AREA") ? "safe" : "aspect";
  }
  if (mismatch(asset, preset)) return "aspect";
  if (asset.overflow) return "safe";
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
  incoming: { name: string; src?: { w: number; h: number }; file?: File; url?: string; thumbnailUrl?: string; corrupt?: boolean }[],
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
      overflow: false,
      fixed: false,
      corrupt: Boolean(file.corrupt),
      element: fullPageImage(),
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
 * The eight handles of the placeholder frame: four corners and four edges.
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
  flipH: boolean;
  flipV: boolean;
  box: Box;
  /** Locks the frame/layout while still allowing image import and export. */
  templateLocked?: boolean;
};

export const srcRatio = (asset: Asset) => asset.src.w / asset.src.h;
export const megabytes = (asset: Asset) => sourceBytes(asset) / 1_048_576;

export function docFromPreset(preset: Preset): Doc {
  return {
    presetId: preset.id, width: preset.width, height: preset.height, lock: true,
    ratio: preset.width / preset.height,
    fit: preset.fit, align: preset.align, safeX: preset.safeX, safeY: preset.safeY,
    background: preset.background, flipH: false, flipV: false,
    // Safe area remains a guide; the default image element fills the page.
    box: fullBox(),
  };
}

/** The frame a preset implies: its safe area. */
export const safeBox = (safeX: number, safeY: number): Box =>
  ({ x: safeX, y: safeY, w: 100 - 2 * safeX, h: 100 - 2 * safeY });

/** The live resize target: the preset row with the inspector's edits layered on. */
export function docTarget(doc: Doc, presets: Preset[]): Preset {
  return { ...presetById(doc.presetId, presets), width: doc.width, height: doc.height, safeX: doc.safeX, safeY: doc.safeY, align: doc.align, fit: doc.fit, background: doc.background };
}

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

export function demo() {
  const finish = begin();
  const zalando = presetById("zalando");
  const square = presetById("amazon");
  const base: Asset = { id: 1, name: "a.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: false, overflow: false, fixed: false, corrupt: false, element: fullPageImage() };

  // Status is derived, never stored.
  console.assert(statusOf(base, zalando) === "Pending", "unprocessed reads Pending");
  console.assert(statusOf({ ...base, processed: true }, zalando) === "Completed", "9:13 source conforms to 9:13 preset");
  console.assert(statusOf({ ...base, processed: true }, square) === "Warning", "9:13 source mismatches 1:1 preset");
  console.assert(statusOf({ ...base, processed: true, fixed: true }, square) === "Completed", "auto-fix clears the mismatch");
  console.assert(statusOf({ ...base, processed: true, corrupt: true }, zalando) === "Error", "corrupt outranks everything");

  // Warning reasons drive both the Review copy and the error-type filter.
  console.assert(warningReason({ ...base, processed: true }, square) === "aspect", "ratio drift reports aspect");
  console.assert(warningReason({ ...base, processed: true, overflow: true }, zalando) === "safe", "overflow reports safe area");
  console.assert(warningReason({ ...base, processed: true, overflow: true }, square) === "aspect", "aspect outranks overflow");
  console.assert(warningReason(base, square) === null, "an unprocessed asset is not yet warned");
  console.assert(statusOf({ ...base, processed: true, overflow: true }, zalando) === "Warning", "overflow alone still warns");

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
  console.assert(filterAssets(batch, zalando, { ...emptyFilter, errorTypes: ["aspect"] })[0].id === 2, "aspect facet finds the mismatch");
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

  // The placeholder frame: eight handles, margins, clamping.
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
  console.assert(docFromPreset(zalando).box.w === 100, "a loaded preset begins with a full-page image element");

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

  finish("flow.ts");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("flow")) demo();
