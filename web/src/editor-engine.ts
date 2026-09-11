import type { Align, Asset, Box, Doc, Fit } from "@/src/flow";

export type EditRecipe = {
  version: 1;
  canvas: { width: number; height: number; aspectRatio: [number, number] };
  fitMode: "fit" | "fill" | "manual";
  alignment: { horizontal: "left" | "center" | "right"; vertical: "top" | "center" | "bottom" };
  relativeOffset: { xPercent: number; yPercent: number };
  safeArea: { unit: "percent"; top: number; right: number; bottom: number; left: number };
  frame: Box;
  background: string;
};

export type ProcessingWarning = { code: "CLIPPING" | "SAFE_AREA" | "LOW_RESOLUTION" | "UPSCALE"; message: string };
export type LayoutResult = {
  frame: Box;
  rendered: { x: number; y: number; width: number; height: number; scaleX: number; scaleY: number };
  status: "completed" | "warning" | "needs_review" | "error";
  warnings: ProcessingWarning[];
  recipeVersion: 1;
  manual: boolean;
};

const splitAlign = (align: Align): EditRecipe["alignment"] => ({
  horizontal: align.includes("left") ? "left" : align.includes("right") ? "right" : "center",
  vertical: align.includes("top") ? "top" : align.includes("bottom") ? "bottom" : "center",
});

const fitMode = (fit: Fit): EditRecipe["fitMode"] => fit === "Fit" ? "fit" : fit === "Fill" ? "fill" : "manual";

export function createRecipe(doc: Doc): EditRecipe {
  return {
    version: 1,
    canvas: { width: doc.width, height: doc.height, aspectRatio: [doc.width, doc.height] },
    fitMode: fitMode(doc.fit), alignment: splitAlign(doc.align), relativeOffset: { xPercent: 0, yPercent: 0 },
    safeArea: { unit: "percent", top: doc.safeY, right: doc.safeX, bottom: doc.safeY, left: doc.safeX },
    frame: { ...doc.box }, background: doc.background,
  };
}

function aligned(origin: number, room: number, size: number, mode: "left" | "center" | "right" | "top" | "bottom") {
  return mode === "left" || mode === "top" ? origin : mode === "right" || mode === "bottom" ? origin + room - size : origin + (room - size) / 2;
}

/** Level-0 subject geometry: the oriented full-image bounds, exactly as the specification permits. */
export function applyRecipe(asset: Pick<Asset, "src">, recipe: EditRecipe, frameOverride?: Box): LayoutResult {
  const frame = frameOverride ? { ...frameOverride } : { ...recipe.frame };
  const area = {
    x: frame.x / 100 * recipe.canvas.width, y: frame.y / 100 * recipe.canvas.height,
    width: frame.w / 100 * recipe.canvas.width, height: frame.h / 100 * recipe.canvas.height,
  };
  const sx = area.width / asset.src.w; const sy = area.height / asset.src.h;
  const scale = recipe.fitMode === "fill" ? Math.max(sx, sy) : recipe.fitMode === "fit" ? Math.min(sx, sy) : 1;
  const width = recipe.fitMode === "manual" ? area.width : asset.src.w * scale;
  const height = recipe.fitMode === "manual" ? area.height : asset.src.h * scale;
  const x = aligned(area.x, area.width, width, recipe.alignment.horizontal) + recipe.relativeOffset.xPercent / 100 * recipe.canvas.width;
  const y = aligned(area.y, area.height, height, recipe.alignment.vertical) + recipe.relativeOffset.yPercent / 100 * recipe.canvas.height;
  const warnings: ProcessingWarning[] = [];
  if (x < area.x - 0.01 || y < area.y - 0.01 || x + width > area.x + area.width + 0.01 || y + height > area.y + area.height + 0.01)
    warnings.push({ code: "CLIPPING", message: "Image content extends beyond the recipe frame." });
  const scaleX = width / asset.src.w; const scaleY = height / asset.src.h;
  if (Math.max(scaleX, scaleY) > 1) warnings.push({ code: "UPSCALE", message: `Source is enlarged ${Math.max(scaleX, scaleY).toFixed(2)}×.` });
  if (asset.src.w < 1 || asset.src.h < 1) warnings.push({ code: "LOW_RESOLUTION", message: "Source dimensions are invalid." });
  return {
    frame, rendered: { x, y, width, height, scaleX, scaleY },
    status: warnings.length ? "needs_review" : "completed", warnings, recipeVersion: 1, manual: Boolean(frameOverride),
  };
}

export function applyRecipeToAssets(assets: Asset[], recipe: EditRecipe) {
  return assets.map((asset) => {
    const layout = applyRecipe(asset, recipe);
    return { ...asset, processed: !asset.corrupt, fixed: false,
      overflow: layout.warnings.some((warning) => warning.code === "CLIPPING"), layout };
  });
}
