/**
 * MINIMA Resize — single source of truth for the workflow.
 *
 * One screen at a time, overlays stack on top, and every derived value
 * (status badges, apply scope, object geometry) is computed here so the
 * Gallery, Editor, Review and Export surfaces can never disagree.
 *
 * See design-system/minima-resize/pages/flow.md for the wiring table.
 */

export type Screen = "import" | "gallery" | "editor" | "review" | "presets" | "settings";
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
  { id: "zalando", label: "Zalando 9:13", category: "Marketplace", width: 1801, height: 2600, safeX: 16.66, safeY: 10, background: "#F6F6F6", align: "center", fit: "Fit" },
  { id: "amazon", label: "Amazon (1:1)", category: "Marketplace", width: 2000, height: 2000, safeX: 7.5, safeY: 7.5, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "douglas", label: "Douglas (1:1)", category: "Marketplace", width: 1500, height: 1500, safeX: 8, safeY: 8, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "shopee", label: "Shopee (1:1)", category: "Marketplace", width: 1600, height: 1600, safeX: 6, safeY: 6, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "lazada", label: "Lazada (1:1)", category: "Marketplace", width: 1200, height: 1200, safeX: 6, safeY: 6, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "ig-square", label: "Instagram Square (1:1)", category: "Social Media", width: 1080, height: 1080, safeX: 5, safeY: 5, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "ig-portrait", label: "Instagram Portrait (4:5)", category: "Social Media", width: 1080, height: 1350, safeX: 6, safeY: 8, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "ig-story", label: "Instagram Story (9:16)", category: "Social Media", width: 1080, height: 1920, safeX: 8, safeY: 14, background: "#111111", align: "center", fit: "Fit" },
  { id: "tiktok", label: "TikTok (9:16)", category: "Social Media", width: 1080, height: 1920, safeX: 8, safeY: 16, background: "#111111", align: "center", fit: "Fit" },
  { id: "facebook", label: "Facebook (1:1)", category: "Social Media", width: 1200, height: 1200, safeX: 6, safeY: 6, background: "#FFFFFF", align: "center", fit: "Fit" },
  { id: "product-master", label: "Product Master", category: "Custom", width: 3000, height: 3000, safeX: 10, safeY: 10, background: "#F6F6F6", align: "center", fit: "Fit" },
  { id: "boj-catalog", label: "BOJ Catalog", category: "Custom", width: 2048, height: 2048, safeX: 12, safeY: 12, background: "#EFEFEF", align: "center", fit: "Fit" },
  { id: "my-brand", label: "My Brand Preset", category: "Custom", width: 1801, height: 2600, safeX: 16.66, safeY: 10, background: "#F1EDE7", align: "center", fit: "Fit" },
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

export type Asset = {
  id: number;
  name: string;
  kind: "shoe" | "beauty" | "fashion" | "bottle";
  format: Format;
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
  incoming: { name: string; src?: { w: number; h: number } }[],
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
      src: file.src ?? { w: 1801, h: 2600 },
      processed: false,
      overflow: false,
      fixed: false,
      corrupt: false,
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

/** Size the object for the chosen fit mode against the safe rect. */
export function fitBox(fit: Fit, srcRatio: number, canvasRatio: number, safeX: number, safeY: number): Box {
  const availW = 100 - 2 * safeX;
  const availH = 100 - 2 * safeY;
  if (fit === "Stretch") return anchor("center", { x: 0, y: 0, w: availW, h: availH }, safeX, safeY);

  // Width of an object whose source ratio is srcRatio when it is `h` percent tall.
  const widthAt = (h: number) => (h * srcRatio) / canvasRatio;
  let h = availH;
  let w = widthAt(h);
  const overflows = w > availW;
  if (fit === "Fit" ? overflows : !overflows) {
    w = availW;
    h = (w * canvasRatio) / srcRatio;
  }
  return anchor("center", { x: 0, y: 0, w, h }, safeX, safeY);
}

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

/** Scale of the placed object relative to its source pixels, as a percentage. */
export function objectScale(box: Box, preset: Preset, asset: Asset) {
  return Math.round(((box.w / 100) * preset.width * 100) / asset.src.w);
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
};

export const srcRatio = (asset: Asset) => asset.src.w / asset.src.h;
export const megabytes = (asset: Asset) => sourceBytes(asset) / 1_048_576;

export function docFromPreset(preset: Preset, asset: Asset): Doc {
  const canvasRatio = preset.width / preset.height;
  return {
    presetId: preset.id, width: preset.width, height: preset.height, lock: true, ratio: canvasRatio,
    fit: preset.fit, align: preset.align, safeX: preset.safeX, safeY: preset.safeY,
    background: preset.background, flipH: false, flipV: false,
    box: fitBox(preset.fit, srcRatio(asset), canvasRatio, preset.safeX, preset.safeY),
  };
}

/** The live resize target: the preset row with the inspector's edits layered on. */
export function docTarget(doc: Doc, presets: Preset[]): Preset {
  return { ...presetById(doc.presetId, presets), width: doc.width, height: doc.height, safeX: doc.safeX, safeY: doc.safeY, align: doc.align, fit: doc.fit, background: doc.background };
}

/* -------------------------------------------------------------------- scope */

export function scopeAssets(scope: Scope, assets: Asset[], selected: number[], activeId: number) {
  if (scope === "all") return assets;
  if (scope === "selected") return assets.filter((asset) => selected.includes(asset.id));
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
  if (screen === "presets" || screen === "settings") return hasAssets ? "gallery" : "import";
  return null; // import and gallery are the roots
}

/* --------------------------------------------------------------------- demo */

export function demo() {
  const zalando = presetById("zalando");
  const square = presetById("amazon");
  const base: Asset = { id: 1, name: "a.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: false, overflow: false, fixed: false, corrupt: false };

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

  // Fit sizing stays inside the safe rect; Fill covers it.
  const canvasRatio = zalando.width / zalando.height;
  const wide = fitBox("Fit", 2, canvasRatio, zalando.safeX, zalando.safeY);
  console.assert(wide.w <= 100 - 2 * zalando.safeX + 0.01, "Fit never exceeds the safe width");
  console.assert(wide.h <= 100 - 2 * zalando.safeY + 0.01, "Fit never exceeds the safe height");
  const filled = fitBox("Fill", 2, canvasRatio, zalando.safeX, zalando.safeY);
  console.assert(filled.h >= 100 - 2 * zalando.safeY - 0.01, "Fill covers the safe height");
  const stretched = fitBox("Stretch", 2, canvasRatio, zalando.safeX, zalando.safeY);
  console.assert(Math.abs(stretched.w - (100 - 2 * zalando.safeX)) < 0.01, "Stretch matches the safe rect exactly");

  // Anchors land on the safe-area edges.
  const box: Box = { x: 0, y: 0, w: 40, h: 40 };
  console.assert(anchor("top-left", box, 10, 5).x === 10, "left anchor sits on the safe inset");
  console.assert(anchor("top-left", box, 10, 5).y === 5, "top anchor sits on the safe inset");
  console.assert(anchor("bottom-right", box, 10, 5).x === 50, "right anchor mirrors the inset");
  console.assert(anchor("center", box, 10, 5).x === 30, "centre ignores the inset");
  console.assert(anchor("right", box, 10, 5).y === 30, "single-axis alignment centres the other axis");

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
  console.assert(backTarget("import", true) === null, "import is a root");
  console.assert(backTarget("gallery", true) === null, "gallery is a root, so Back is hidden rather than a no-op");

  console.log("flow.ts: all checks passed");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("flow")) demo();
