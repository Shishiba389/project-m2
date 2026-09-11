import { begin } from "@/src/selfcheck";
import { applyRecipe, createRecipe } from "@/src/editor-engine";
import { docFromPreset, presetById, type Asset } from "@/src/flow";

const finish = begin();
const asset = { src: { w: 2000, h: 1000 } } as Asset;
const doc = docFromPreset(presetById("amazon"));
const recipe = createRecipe(doc);
const fit = applyRecipe(asset, recipe);
console.assert(recipe.version === 1 && recipe.canvas.width === 2000, "recipe is versioned and carries canvas intent");
console.assert(fit.rendered.width === 1700 && fit.rendered.height === 850, "fit preserves ratio inside the safe frame");
console.assert(fit.rendered.x === 150 && fit.rendered.y === 575, "center alignment is calculated per source ratio");
console.assert(fit.status === "completed", "contained layout validates cleanly");

const fill = applyRecipe(asset, { ...recipe, fitMode: "fill" });
console.assert(fill.rendered.height === 1700 && fill.rendered.width === 3400, "fill covers the frame without distortion");
console.assert(fill.warnings.some((warning) => warning.code === "CLIPPING"), "fill clipping enters review");

const left = applyRecipe(asset, { ...recipe, alignment: { horizontal: "left", vertical: "top" } });
console.assert(left.rendered.x === 150 && left.rendered.y === 150, "alignment is an explicit reusable rule");
const manual = applyRecipe(asset, recipe, { x: 20, y: 20, w: 60, h: 60 });
console.assert(manual.manual && manual.frame.x === 20, "manual correction is stored per image");

finish("editor-engine.test.ts");
