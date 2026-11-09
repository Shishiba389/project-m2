/**
 * "Edit one, apply to all" - the Edit Recipe of MINIMA_V2_EDITOR_MODE_ENGINE
 * §22-29.
 *
 * The user edits one reference image. What they did is read back as rules
 * rather than coordinates (§24): how big the picture is relative to the safe
 * area, which edge it is aligned to, what small offset is left after that,
 * and its rotation, mirror and - only if asked - crop. Every other image then
 * gets its *own* layout from those rules (§28): a wide bag and a tall shoe
 * come out the same relative size, against the same edge, instead of one
 * image's absolute box being pasted onto a picture of another shape.
 */
import { pictureAspect, type AlignAxes, type CropRect, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { croppedBox, uncroppedBox } from "@/src/gestures";
import { isWhole, subjectInBox, WHOLE, type SubjectRect } from "@/src/subject";
import {
  elementOf, layoutMatch, relayout, validateElement,
  type Asset, type Doc, type Fit, type ProcessingWarning,
} from "@/src/flow";

/** Which parts of the reference's edit travel to the other images. */
export type ApplyOptions = {
  /** Size and position. */
  size: boolean;
  /** Rotation and mirrors. */
  rotation: boolean;
  /** The same crop fractions - right for a series shot on one set-up, wrong for anything else. */
  crop: boolean;
  /** Also change images the user has adjusted by hand (§38: off by default). */
  overwriteManual: boolean;
};
export const defaultApplyOptions: ApplyOptions = { size: true, rotation: true, crop: false, overwriteManual: false };

type PageRules = Pick<Doc, "width" | "height" | "fit" | "align" | "safeX" | "safeY">;

export type EditRecipe = {
  version: 2;
  /**
   * How big the picture is. `page` is one of the page's own layouts (Fit,
   * Fill, Stretch); `occupancy` is a share of the safe area - 0.7 means the
   * picture is 70% of the largest size that fits inside it, which is the same
   * statement for a wide picture as for a tall one; `keep` leaves each image's
   * size and place alone.
   */
  sizing: { mode: "page"; fit: Fit; follows: boolean } | { mode: "occupancy"; value: number } | { mode: "keep" };
  alignment: AlignAxes;
  /** What is left after alignment, in percent of the page (§18). */
  relativeOffset: { xPercent: number; yPercent: number };
  /** Null leaves each image's own orientation alone. */
  orientation: { rotation: number; flipH: boolean; flipV: boolean } | null;
  /** Undefined leaves each image's own crop alone. */
  crop?: CropRect | null;
  /**
   * The bounds the reference stayed inside. Whatever the reference respected
   * is a hard limit for every other image (§26): a picture the user kept
   * inside the safe area is never pushed out of it by an offset.
   */
  keepInside: "safe" | "page" | null;
  /**
   * What the size and position were measured on: the product, when the
   * reference's product was found (§20-21), or the whole picture otherwise.
   * Each target is then measured on its own product the same way, so two
   * shots with different white margins come out with products the same size.
   */
  measuredOn: "product" | "picture";
};

export type AutoApplyResult = {
  element: ImageElement | null;
  status: "completed" | "warning" | "needs_review";
  warnings: ProcessingWarning[];
};

type PixelRect = { x: number; y: number; w: number; h: number };
const safeRect = (doc: PageRules): PixelRect => ({
  x: doc.safeX / 100 * doc.width, y: doc.safeY / 100 * doc.height,
  w: doc.width * (1 - 2 * doc.safeX / 100), h: doc.height * (1 - 2 * doc.safeY / 100),
});
const boxPixels = (box: ImageBox, doc: PageRules): PixelRect => ({
  x: box.x / 100 * doc.width, y: box.y / 100 * doc.height, w: box.w / 100 * doc.width, h: box.h / 100 * doc.height,
});
const contains = (outer: PixelRect, inner: PixelRect, slack: number) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack
  && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;

/**
 * The anchor an offset is measured from: whichever of the safe area's start
 * edge, centre or end edge the picture is nearest to. A product nudged a
 * little off centre is "centred, plus a small offset" (§23), not "aligned to
 * the far edge" - which would put a narrower product somewhere else entirely.
 */
function inferAxis(start: number, size: number, areaStart: number, areaSize: number) {
  const before = start - areaStart;
  const after = areaStart + areaSize - (start + size);
  const toCentre = Math.abs(before - after) / 2;
  if (toCentre <= before && toCentre <= after) return "center" as const;
  return before <= after ? "start" as const : "end" as const;
}
const alignedStart = (axis: "start" | "center" | "end", size: number, areaStart: number, areaSize: number) =>
  axis === "start" ? areaStart : axis === "end" ? areaStart + areaSize - size : areaStart + (areaSize - size) / 2;

type Measured = Pick<Asset, "element" | "src" | "subject">;
/** The product's share of an element's box, or the whole box when the product is unknown or cropped away. */
const productShare = (asset: Pick<Asset, "subject">, crop: SubjectRect | null) =>
  subjectInBox(asset.subject?.rect, crop) ?? WHOLE;
/** The product's rectangle on the page, in the box's own (unrotated) frame, in pixels. */
const productPixels = (box: PixelRect, share: SubjectRect): PixelRect => ({
  x: box.x + share.left * box.w, y: box.y + share.top * box.h,
  w: (share.right - share.left) * box.w, h: (share.bottom - share.top) * box.h,
});

/** Read the reference image's edit back as a recipe. */
export function recipeFromElement(reference: Measured, doc: PageRules, options: ApplyOptions = defaultApplyOptions): EditRecipe {
  const element = elementOf(reference, doc);
  // Everything below is measured on the product, which is the picture itself
  // when no product was found.
  const box = productPixels(boxPixels(element.box, doc), productShare(reference, element.crop));
  const safe = safeRect(doc);
  const horizontal = inferAxis(box.x, box.w, safe.x, safe.w);
  const vertical = inferAxis(box.y, box.h, safe.y, safe.h);
  const offsetX = box.x - alignedStart(horizontal, box.w, safe.x, safe.w);
  const offsetY = box.y - alignedStart(vertical, box.h, safe.y, safe.h);
  const page = layoutMatch(element, reference.src, doc);
  const sizing: EditRecipe["sizing"] = !options.size ? { mode: "keep" }
    : reference.element === null ? { mode: "page", fit: doc.fit, follows: true }
    : page ? { mode: "page", fit: page, follows: false }
    : { mode: "occupancy", value: Math.max(box.w / safe.w, box.h / safe.h) };
  const slack = 0.0005 * Math.max(doc.width, doc.height);
  return {
    version: 2,
    sizing,
    alignment: {
      horizontal: horizontal === "start" ? "left" : horizontal === "end" ? "right" : "center",
      vertical: vertical === "start" ? "top" : vertical === "end" ? "bottom" : "center",
    },
    relativeOffset: { xPercent: offsetX / doc.width * 100, yPercent: offsetY / doc.height * 100 },
    orientation: options.rotation ? { rotation: element.box.rotation, flipH: element.box.flipH, flipV: element.box.flipV } : null,
    crop: options.crop ? element.crop : undefined,
    keepInside: contains(safe, box, slack) ? "safe" : contains({ x: 0, y: 0, w: doc.width, h: doc.height }, box, slack) ? "page" : null,
    measuredOn: reference.subject && !isWhole(reference.subject.rect) ? "product" : "picture",
  };
}

const statusOf = (warnings: ProcessingWarning[]): AutoApplyResult["status"] =>
  warnings.some((warning) => warning.severity === "review") ? "needs_review" : warnings.length ? "warning" : "completed";

/** One image's own layout from the recipe, with its validation (§25). */
export function applyRecipe(asset: Measured, recipe: EditRecipe, doc: PageRules): AutoApplyResult {
  const current = elementOf(asset, doc);
  const crop = recipe.crop === undefined ? current.crop : recipe.crop;
  const orientation = recipe.orientation ?? { rotation: current.box.rotation, flipH: current.box.flipH, flipV: current.box.flipV };
  // A page layout the reference simply followed stays "follows the page" for
  // every image that has nothing of its own to keep - so it keeps following
  // when the preset changes later.
  if (recipe.sizing.mode === "page" && recipe.sizing.follows && !crop
    && orientation.rotation === 0 && !orientation.flipH && !orientation.flipV) {
    const warnings = validateElement(elementOf({ element: null, src: asset.src }, doc), asset.src, doc, asset.subject);
    return { element: null, warnings, status: statusOf(warnings) };
  }

  let box: ImageBox;
  if (recipe.sizing.mode === "keep") {
    // Size and place stay the image's own; a new crop still keeps the
    // picture where it is, which is what recrop means.
    box = crop === current.crop ? current.box : croppedBox(uncroppedBox(current.box, current.crop, doc), crop, doc);
  } else if (recipe.sizing.mode === "page") {
    box = relayout({ box: current.box, crop }, asset.src, doc, recipe.sizing.fit).box;
  } else {
    // Lay the *product* out by the rules, then hang the picture around it:
    // the white margin of each shot is its own business.
    const safe = safeRect(doc);
    const share = productShare(asset, crop);
    const shareW = share.right - share.left;
    const shareH = share.bottom - share.top;
    const aspect = pictureAspect(asset.src, crop) * shareW / shareH;
    const contained = aspect > safe.w / safe.h ? { w: safe.w, h: safe.w / aspect } : { w: safe.h * aspect, h: safe.h };
    const w = contained.w * recipe.sizing.value;
    const h = contained.h * recipe.sizing.value;
    const axis = (value: string) => value === "left" || value === "top" ? "start" as const : value === "right" || value === "bottom" ? "end" as const : "center" as const;
    let x = alignedStart(axis(recipe.alignment.horizontal), w, safe.x, safe.w) + recipe.relativeOffset.xPercent / 100 * doc.width;
    let y = alignedStart(axis(recipe.alignment.vertical), h, safe.y, safe.h) + recipe.relativeOffset.yPercent / 100 * doc.height;
    const limit = recipe.keepInside === "safe" ? safe : recipe.keepInside === "page" ? { x: 0, y: 0, w: doc.width, h: doc.height } : null;
    if (limit) {
      if (w <= limit.w) x = Math.min(limit.x + limit.w - w, Math.max(limit.x, x));
      if (h <= limit.h) y = Math.min(limit.y + limit.h - h, Math.max(limit.y, y));
    }
    const pictureW = w / shareW;
    const pictureH = h / shareH;
    box = {
      x: (x - share.left * pictureW) / doc.width * 100, y: (y - share.top * pictureH) / doc.height * 100,
      w: pictureW / doc.width * 100, h: pictureH / doc.height * 100,
      rotation: 0, flipH: false, flipV: false, lockedRatio: true,
    };
  }
  const element: ImageElement = { box: { ...box, ...orientation }, crop, origin: "recipe" };
  const warnings = validateElement(element, asset.src, doc, asset.subject);
  return { element, warnings, status: statusOf(warnings) };
}
