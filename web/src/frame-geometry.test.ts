import { begin } from "@/src/selfcheck";
import { attachImage, clearFrame, contentPageElement, createFrame, fitFrame, frameAt, frameFromDrag, removeFrame, replaceFrame } from "@/src/frame-geometry";
import { fullPageImage, moveImage, resizeImage } from "@/src/image-geometry";

const finish = begin();
const page = { width: 1000, height: 1000 };
const frame = createFrame({ x: 10, y: 10, w: 40, h: 20 });
console.assert(frame.imageId === null && frame.content === null, "a new frame is empty");
console.assert(frameFromDrag(60, 80, 20, 30).box.x === 20 && frameFromDrag(60, 80, 20, 30).box.w === 40, "dragging any two corners normalises the frame box");

// Fill: a 1:1 source in a 2:1 frame must overflow vertically, never distort.
const filled = attachImage(frame, 7, { w: 500, h: 500 }, page);
console.assert(filled.imageId === 7 && filled.content!.box.w === 100, "fill covers the frame width");
console.assert(Math.round(filled.content!.box.h) === 200 && Math.round(filled.content!.box.y) === -50, "fill overflows the short axis and stays centred");
const fitted = fitFrame(filled, { w: 500, h: 500 }, page);
console.assert(fitted.content!.box.h === 100 && Math.round(fitted.content!.box.w) === 50, "fit contains the image inside the frame");
console.assert(Math.round(fitted.content!.box.x) === 25, "fit centres the contained image");

// Content moves inside the frame; the frame box must not follow.
const moved = { ...fitted, content: moveImage(fitted.content!, 10, 0) };
console.assert(moved.box.x === frame.box.x && moved.box.w === frame.box.w, "editing content never changes the frame");
const onPage = contentPageElement(moved);
console.assert(Math.abs(onPage.box.x - (10 + 35 / 100 * 40)) < .0001, "content maps back into page percentages");
console.assert(Math.abs(onPage.box.w - 20) < .0001 && Math.abs(onPage.box.h - 20) < .0001, "detached content keeps its rendered size");

// Hit-test picks the topmost frame, and misses outside.
const other = createFrame({ x: 20, y: 12, w: 10, h: 10 });
console.assert(frameAt([frame, other], 25, 15)?.id === other.id, "the topmost frame wins the hit-test");
console.assert(frameAt([frame, other], 15, 15)?.id === frame.id, "a point outside the top frame falls through");
console.assert(frameAt([frame, other], 90, 90) === null, "a point on empty canvas selects no frame");

// A rotated or mirrored frame carries its content around with it, rather than
// leaving it where an unrotated frame would have put it.
const corner = { ...createFrame({ x: 0, y: 0, w: 40, h: 40 }), content: { box: { ...fullPageImage().box, x: 0, y: 0, w: 50, h: 50 }, crop: null } };
const plain = contentPageElement(corner);
console.assert(plain.box.x === 0 && plain.box.y === 0 && plain.box.w === 20, "an unrotated frame places content directly");
// Content centred at (10,10), frame centred at (20,20): a quarter turn sends it to (30,10).
const turned = contentPageElement({ ...corner, box: { ...corner.box, rotation: 90 } });
console.assert(Math.abs(turned.box.x + turned.box.w / 2 - 30) < 1e-9 && Math.abs(turned.box.y + turned.box.h / 2 - 10) < 1e-9,
  "rotating the frame swings its content around the frame centre");
console.assert(turned.box.rotation === 90, "and the content inherits the frame's rotation");
const spun = contentPageElement({ ...corner, box: { ...corner.box, rotation: 90 }, content: { ...corner.content!, box: { ...corner.content!.box, rotation: 30 } } });
console.assert(spun.box.rotation === 120, "rotations add when the frame is not mirrored");
const mirrored = contentPageElement({ ...corner, box: { ...corner.box, flipH: true }, content: { ...corner.content!, box: { ...corner.content!.box, rotation: 30 } } });
console.assert(Math.abs(mirrored.box.x + mirrored.box.w / 2 - 30) < 1e-9, "a mirrored frame mirrors where its content sits");
console.assert(mirrored.box.rotation === 330 && mirrored.box.flipH, "and reverses the sense of the content's own rotation");
const twice = contentPageElement({ ...corner, box: { ...corner.box, flipH: true, flipV: true }, content: { ...corner.content!, box: { ...corner.content!.box, rotation: 30 } } });
console.assert(twice.box.rotation === 30, "two mirrors cancel, so the rotation is unchanged");

console.assert(clearFrame(filled).imageId === null && clearFrame(filled).content === null, "clearing a frame drops its image reference only");
console.assert(replaceFrame([frame, other], { ...other, imageId: 3 }).at(-1)!.imageId === 3, "replace swaps one frame in place");
console.assert(removeFrame([frame, other], frame.id).length === 1, "remove deletes exactly one frame");
// Resizing frame content reuses the free-image geometry, so the handles behave identically.
console.assert(resizeImage(filled.content!, "se", 10, 0).box.w > 100, "frame content resizes with the shared image geometry");
finish("frame-geometry.test.ts");
