/**
 * Edit one, apply to all (Phase C): the reference's edit is read back as
 * rules, and every other image gets its own layout from them.
 */
import { begin } from "@/src/selfcheck";
import { applyRecipe, defaultApplyOptions, recipeFromElement } from "@/src/editor-engine";
import { docFromPreset, presetById, validateElement, type Asset } from "@/src/flow";
import { fullPageImage, pictureAspect, type ImageElement } from "@/src/image-geometry";

const finish = begin();
const near = (left: number, right: number, tolerance = 1e-9) => Math.abs(left - right) < tolerance;
const doc = docFromPreset(presetById("zalando")); // 1801 × 2600, safe 16.66% × 10%
const safe = { x: doc.safeX / 100 * doc.width, y: doc.safeY / 100 * doc.height, w: doc.width * (1 - 2 * doc.safeX / 100), h: doc.height * (1 - 2 * doc.safeY / 100) };
const px = (element: ImageElement) => ({
  x: element.box.x / 100 * doc.width, y: element.box.y / 100 * doc.height,
  w: element.box.w / 100 * doc.width, h: element.box.h / 100 * doc.height,
});
const occupancy = (element: ImageElement) => Math.max(px(element).w / safe.w, px(element).h / safe.h);
const tall = { src: { w: 900 * 3, h: 1300 * 3 } };
const wide = { src: { w: 1600 * 3, h: 1000 * 3 } };
const square = { src: { w: 1200 * 3, h: 1200 * 3 } };

/** A reference the user shrank to 70% of the safe area and set on its bottom edge, nudged right. */
function bottomAligned(source: { w: number; h: number }, share: number, nudge: number): ImageElement {
  const aspect = pictureAspect(source, null);
  const contained = aspect > safe.w / safe.h ? { w: safe.w, h: safe.w / aspect } : { w: safe.h * aspect, h: safe.h };
  const w = contained.w * share; const h = contained.h * share;
  const x = safe.x + (safe.w - w) / 2 + nudge; const y = safe.y + safe.h - h;
  return { crop: null, box: { ...fullPageImage().box, x: x / doc.width * 100, y: y / doc.height * 100, w: w / doc.width * 100, h: h / doc.height * 100 } };
}

const reference: Pick<Asset, "element" | "src"> = { ...tall, element: bottomAligned(tall.src, 0.7, 12) };
const recipe = recipeFromElement(reference, doc);
console.assert(recipe.version === 2 && recipe.sizing.mode === "occupancy", "a hand-sized reference becomes a relative size, not a box");
console.assert(recipe.sizing.mode === "occupancy" && near(recipe.sizing.value, 0.7), "70% of the safe area is read back as 0.7");
console.assert(recipe.alignment.vertical === "bottom" && recipe.alignment.horizontal === "center", "the bottom edge it sits on is the rule");
console.assert(recipe.keepInside === "safe", "and staying inside the safe area is a hard limit for the others");

// Round trip: the recipe applied to the reference itself is the reference.
const self = applyRecipe(reference, recipe, doc).element!;
console.assert(near(self.box.x, reference.element!.box.x) && near(self.box.y, reference.element!.box.y)
  && near(self.box.w, reference.element!.box.w) && near(self.box.h, reference.element!.box.h),
"the reference reproduces itself exactly");

// Every other shape gets its own layout from the same rules.
for (const [label, other] of [["wide", wide], ["square", square], ["tall", tall]] as const) {
  const result = applyRecipe({ ...other, element: null }, recipe, doc);
  const placed = px(result.element!);
  console.assert(near(occupancy(result.element!), 0.7, 1e-9), `${label}: the same 70% of the safe area`);
  console.assert(near(placed.y + placed.h, safe.y + safe.h, 1e-6), `${label}: sitting on the same bottom edge`);
  console.assert(placed.x >= safe.x - 1e-6 && placed.x + placed.w <= safe.x + safe.w + 1e-6 && placed.y >= safe.y - 1e-6,
    `${label}: never pushed out of the safe area`);
  console.assert(near(placed.w / placed.h, other.src.w / other.src.h, 1e-9), `${label}: never distorted`);
  console.assert(result.element!.origin === "recipe", `${label}: marked as placed by the recipe, not by hand`);
}

// An offset that would push a wide picture out of the safe area is clamped,
// because the reference stayed inside it.
const pushed = recipeFromElement({ ...square, element: bottomAligned(square.src, 0.5, safe.w * 0.24) }, doc);
const wideResult = px(applyRecipe({ ...wide, element: null }, { ...pushed, sizing: { mode: "occupancy", value: 0.95 } }, doc).element!);
console.assert(wideResult.x + wideResult.w <= safe.x + safe.w + 1e-6, "a hard limit wins over the offset");

// Rotation, mirrors and crop travel only when asked.
const turned: Pick<Asset, "element" | "src"> = { ...tall, element: { ...reference.element!, box: { ...reference.element!.box, rotation: 12, flipH: true }, crop: { left: 0.1, top: 0, right: 0.9, bottom: 1 } } };
const withAll = applyRecipe({ ...wide, element: null }, recipeFromElement(turned, doc, { ...defaultApplyOptions, crop: true }), doc).element!;
console.assert(withAll.box.rotation === 12 && withAll.box.flipH && withAll.crop?.left === 0.1, "rotation, mirror and crop are carried over when ticked");
const sizeOnly = applyRecipe({ ...wide, element: null }, recipeFromElement(turned, doc, { ...defaultApplyOptions, rotation: false }), doc).element!;
console.assert(sizeOnly.box.rotation === 0 && !sizeOnly.box.flipH && sizeOnly.crop === null, "and left alone when not");

// A reference that simply follows the page passes that on: the others follow
// the page too, so they keep following it when the preset changes.
const follower = applyRecipe({ ...wide, element: bottomAligned(wide.src, 0.3, 0) }, recipeFromElement({ ...tall, element: null }, doc), doc);
console.assert(follower.element === null, "following the page is passed on as following the page");
const filled = recipeFromElement({ ...tall, element: { crop: null, box: { ...fullPageImage().box, x: 0, y: 0, w: 100, h: 100, lockedRatio: false } } }, doc);
console.assert(filled.sizing.mode === "page" && filled.sizing.fit === "Stretch", "a page layout chosen by hand is passed on by name");

// Validation (§30, §34): enlargement is measured, not guessed.
const tiny = applyRecipe({ src: { w: 300, h: 300 }, element: null }, recipe, doc);
console.assert(tiny.status === "needs_review" && tiny.warnings[0].code === "UPSCALE", "a source blown up past 150% needs review");
console.assert(applyRecipe({ ...wide, element: null }, recipe, doc).status === "completed", "a large enough source passes");
console.assert(validateElement({ crop: null, box: { ...fullPageImage().box, x: 80, w: 50, h: 20 } }, wide.src, doc).some((w) => w.code === "CLIPPING"),
  "a picture hanging off the page is flagged");

/* --------------------------------------- measured on the product (§20-21) */

// Two shots with very different white margins: one product is a small part
// of its picture, the other nearly fills it.
const loose: Pick<Asset, "src" | "subject"> = { src: { w: 3000, h: 3000 }, subject: { method: "background", rect: { left: 0.35, top: 0.25, right: 0.65, bottom: 0.75 } } };
const snug: Pick<Asset, "src" | "subject"> = { src: { w: 2000, h: 3000 }, subject: { method: "background", rect: { left: 0.05, top: 0.05, right: 0.95, bottom: 0.95 } } };
const productOf = (asset: Pick<Asset, "subject">, element: ImageElement) => {
  const box = px(element); const rect = asset.subject!.rect;
  return { x: box.x + rect.left * box.w, y: box.y + rect.top * box.h, w: (rect.right - rect.left) * box.w, h: (rect.bottom - rect.top) * box.h };
};
const productShare = (product: { w: number; h: number }) => Math.max(product.w / safe.w, product.h / safe.h);

// The reference: the loose shot, its *product* at 70% of the safe area, on the bottom edge.
const productAspect = (3000 * 0.3) / (3000 * 0.5);
const fitted = productAspect > safe.w / safe.h ? { w: safe.w, h: safe.w / productAspect } : { w: safe.h * productAspect, h: safe.h };
const product = { w: fitted.w * 0.7, h: fitted.h * 0.7 };
const pictureSize = { w: product.w / 0.3, h: product.h / 0.5 };
const productX = safe.x + (safe.w - product.w) / 2;
const productY = safe.y + safe.h - product.h;
const looseRef: Pick<Asset, "element" | "src" | "subject"> = { ...loose, element: { crop: null, box: { ...fullPageImage().box,
  x: (productX - 0.35 * pictureSize.w) / doc.width * 100, y: (productY - 0.25 * pictureSize.h) / doc.height * 100,
  w: pictureSize.w / doc.width * 100, h: pictureSize.h / doc.height * 100 } } };
const byProduct = recipeFromElement(looseRef, doc);
console.assert(byProduct.measuredOn === "product", "a reference with a found product is measured on it");
console.assert(byProduct.sizing.mode === "occupancy" && near(byProduct.sizing.value, 0.7), "its product's share of the safe area is the rule");
console.assert(byProduct.alignment.vertical === "bottom", "and the product's own bottom edge is the alignment");
const looseSelf = applyRecipe(looseRef, byProduct, doc).element!;
console.assert(near(looseSelf.box.x, looseRef.element!.box.x) && near(looseSelf.box.h, looseRef.element!.box.h), "the reference still reproduces itself");

const snugResult = applyRecipe({ ...snug, element: null }, byProduct, doc).element!;
const snugProduct = productOf(snug, snugResult);
console.assert(near(productShare(snugProduct), 0.7, 1e-9), "the other shot's product comes out the same share of the safe area");
console.assert(near(snugProduct.y + snugProduct.h, safe.y + safe.h, 1e-6), "standing on the same edge");
console.assert(px(snugResult).h < pictureSize.h, "even though its whole picture is laid out at a very different size");
// Measured on the picture instead, the two products would not match.
const naive = applyRecipe({ src: snug.src, element: null }, { ...byProduct, measuredOn: "picture" }, doc).element!;
console.assert(!near(productShare(productOf(snug, naive)), 0.7, 1e-3), "measuring the whole picture would have got the product size wrong");

// Validation looks at the product: a margin off the page loses nothing,
// a product off the page does - even under Fill.
const marginOff = { crop: null, box: { ...fullPageImage().box, x: -10, y: 20, w: 120, h: 50 } } as ImageElement;
console.assert(!validateElement(marginOff, loose.src, doc, loose.subject).some((w) => w.code === "CLIPPING"), "white margin running off the page is fine");
console.assert(validateElement(marginOff, loose.src, doc, null).some((w) => w.code === "CLIPPING"), "without a known product the whole picture is checked");
const productOff = { crop: null, box: { ...fullPageImage().box, x: -60, y: 20, w: 120, h: 50 } } as ImageElement;
console.assert(validateElement(productOff, loose.src, doc, loose.subject).some((w) => w.code === "CLIPPING"), "the product itself cut off is flagged");
const cropped = { crop: { left: 0, top: 0, right: 0.2, bottom: 1 }, box: { ...fullPageImage().box, x: 10, y: 10, w: 20, h: 50 } } as ImageElement;
console.assert(validateElement(cropped, loose.src, doc, loose.subject)[0]?.code === "CLIPPING", "and so is a crop that hides the product entirely");

finish("editor-engine.test.ts");
