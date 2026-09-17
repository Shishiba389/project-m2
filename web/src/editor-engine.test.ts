import { begin } from "@/src/selfcheck";
import { applyRecipe, createRecipe } from "@/src/editor-engine";
import { docFromPreset, presetById, type Asset } from "@/src/flow";

const finish = begin();
const asset = { src: { w: 2000, h: 1000 } } as Asset;
const doc = docFromPreset(presetById("amazon"));
const recipe = createRecipe(doc);
const fit = applyRecipe(asset, recipe);
console.assert(recipe.version === 1 && recipe.canvas.width === 2000, "recipe is versioned and carries canvas intent");
console.assert(fit.rendered.width === 2000 && fit.rendered.height === 1000, "fit preserves ratio inside the page element");
console.assert(fit.rendered.x === 0 && fit.rendered.y === 500, "center alignment is calculated per source ratio");
console.assert(fit.status === "completed", "contained layout validates cleanly");

const fill = applyRecipe(asset, { ...recipe, fitMode: "fill" });
console.assert(fill.rendered.height === 2000 && fill.rendered.width === 4000, "fill covers the page without distortion");
console.assert(fill.warnings.some((warning) => warning.code === "CLIPPING"), "fill clipping enters review");

const left = applyRecipe(asset, { ...recipe, alignment: { horizontal: "left", vertical: "top" } });
console.assert(left.rendered.x === 0 && left.rendered.y === 0, "alignment is an explicit reusable rule");
const manual = applyRecipe(asset, recipe, { x: 20, y: 20, w: 60, h: 60 });
console.assert(manual.manual && manual.frame.x === 20, "manual correction is stored per image");

finish("editor-engine.test.ts");
