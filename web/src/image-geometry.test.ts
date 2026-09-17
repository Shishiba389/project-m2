import { begin } from "@/src/selfcheck";
import { fullPageImage, moveImage, resizeImage } from "@/src/image-geometry";
const finish = begin();
const image = fullPageImage();
console.assert(moveImage(image, -12, 7).box.x === -12, "an image can move beyond the page");
console.assert(resizeImage(image, "se", 20, 20).box.w === 120, "corner resize expands the image element");
console.assert(resizeImage(image, "e", 20, 0, true).box.w === 120, "shift resize can stretch one axis");
finish("image-geometry.test.ts");
