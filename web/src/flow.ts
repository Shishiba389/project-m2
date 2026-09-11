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

export const presetById = (id: string) => PRESETS.find((preset) => preset.id === id) ?? PRESETS[0];

export function ratioLabel(width: number, height: number) {
  const divisor = gcd(width, height);
  return `${width / divisor} : ${height / divisor}`;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/* ------------------------------------------------------------------ assets */

export type Asset = {
  id: number;
  name: string;
  kind: "shoe" | "beauty" | "fashion" | "bottle";
  /** Source pixel dimensions — drives the aspect-mismatch warning. */
  src: { w: number; h: number };
  /** Set once a preset has been applied to this asset. */
  processed: boolean;
  /** Auto-fix (crop/pad) accepted, so the mismatch warning is resolved. */
  fixed: boolean;
  /** Unreadable file; never resolvable by re-running the preset. */
  corrupt: boolean;
};

/** Ratio drift above this reads as a real mismatch rather than rounding. */
const MISMATCH_TOLERANCE = 0.02;

export function statusOf(asset: Asset, preset: Preset): Status {
  if (asset.corrupt) return "Error";
  if (!asset.processed) return "Pending";
  if (!asset.fixed && mismatch(asset, preset)) return "Warning";
  return "Completed";
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
      src: file.src ?? { w: 1801, h: 2600 },
      processed: false,
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

/** Snap a dragged box to the safe-area edges and to the canvas centre lines. */
export function snapBox(box: Box, safeX: number, safeY: number, tolerance = 1.2): Box {
  const pull = (value: number, targets: number[]) => {
    for (const target of targets) if (Math.abs(value - target) <= tolerance) return target;
    return value;
  };
  const x = pull(box.x, [safeX, (100 - box.w) / 2, 100 - safeX - box.w]);
  const y = pull(box.y, [safeY, (100 - box.h) / 2, 100 - safeY - box.h]);
  return { ...box, x, y };
}

/** Scale of the placed object relative to its source pixels, as a percentage. */
export function objectScale(box: Box, preset: Preset, asset: Asset) {
  return Math.round(((box.w / 100) * preset.width * 100) / asset.src.w);
}

/* -------------------------------------------------------------------- scope */

export function scopeAssets(scope: Scope, assets: Asset[], selected: number[], activeId: number) {
  if (scope === "all") return assets;
  if (scope === "selected") return assets.filter((asset) => selected.includes(asset.id));
  return assets.filter((asset) => asset.id === activeId);
}

/* ---------------------------------------------------------------- back rule */

/** One rule for the top-bar Back button: every screen goes up one level. */
export function backTarget(screen: Screen, hasAssets: boolean): Screen | null {
  if (screen === "gallery" || screen === "presets" || screen === "settings") {
    return hasAssets ? "gallery" : "import";
  }
  if (screen === "editor" || screen === "review") return "gallery";
  return null; // import is the root
}

/* --------------------------------------------------------------------- demo */

export function demo() {
  const zalando = presetById("zalando");
  const square = presetById("amazon");

  // Status is derived, never stored.
  const base: Asset = { id: 1, name: "a.png", kind: "shoe", src: { w: 1801, h: 2600 }, processed: false, fixed: false, corrupt: false };
  console.assert(statusOf(base, zalando) === "Pending", "unprocessed reads Pending");
  console.assert(statusOf({ ...base, processed: true }, zalando) === "Completed", "9:13 source conforms to 9:13 preset");
  console.assert(statusOf({ ...base, processed: true }, square) === "Warning", "9:13 source mismatches 1:1 preset");
  console.assert(statusOf({ ...base, processed: true, fixed: true }, square) === "Completed", "auto-fix clears the mismatch");
  console.assert(statusOf({ ...base, processed: true, corrupt: true }, zalando) === "Error", "corrupt outranks everything");

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
  console.assert(mergeImport(existing, [{ name: "b.png" }], "skip").added === 1, "fresh names always import");

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

  // Snapping only bites near a target.
  console.assert(snapBox({ x: 10.5, y: 50, w: 40, h: 40 }, 10, 5).x === 10, "near edge snaps");
  console.assert(snapBox({ x: 20, y: 50, w: 40, h: 40 }, 10, 5).x === 20, "far edge is left alone");

  // Scope and Back are single rules, used by every button.
  const many: Asset[] = [base, { ...base, id: 2, name: "b.png" }, { ...base, id: 3, name: "c.png" }];
  console.assert(scopeAssets("current", many, [2, 3], 1).length === 1, "current scope is one image");
  console.assert(scopeAssets("selected", many, [2, 3], 1).length === 2, "selected scope follows the selection");
  console.assert(scopeAssets("all", many, [2, 3], 1).length === 3, "all scope is the whole batch");
  console.assert(backTarget("editor", true) === "gallery", "editor backs out to gallery");
  console.assert(backTarget("settings", false) === "import", "settings backs out to import with no assets");
  console.assert(backTarget("import", true) === null, "import is the root");

  console.log("flow.ts: all checks passed");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("flow")) demo();
