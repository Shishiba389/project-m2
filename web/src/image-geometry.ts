/**
 * Pure document-space geometry for the Canva-style image element.  All values
 * are percentages of the output page, so zoom never changes editing results.
 */
export type ImageBox = { x: number; y: number; w: number; h: number; rotation: number; flipH: boolean; flipV: boolean; lockedRatio: boolean };
export type CropRect = { left: number; top: number; right: number; bottom: number };
export type ImageElement = { box: ImageBox; crop: CropRect | null };
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const fullPageImage = (): ImageElement => ({ box: { x: 0, y: 0, w: 100, h: 100, rotation: 0, flipH: false, flipV: false, lockedRatio: true }, crop: null });
export const moveImage = (image: ImageElement, dx: number, dy: number): ImageElement => ({ ...image, box: { ...image.box, x: image.box.x + dx, y: image.box.y + dy } });

/** Resize from one of the eight selection handles, keeping the opposite edge anchored. */
export function resizeImage(image: ImageElement, handle: ResizeHandle, dx: number, dy: number, stretch = false): ImageElement {
  const box = { ...image.box }; const right = box.x + box.w; const bottom = box.y + box.h;
  if (handle.includes("w")) { box.x += dx; box.w -= dx; }
  if (handle.includes("e")) box.w += dx;
  if (handle.includes("n")) { box.y += dy; box.h -= dy; }
  if (handle.includes("s")) box.h += dy;
  const ratio = image.box.w / image.box.h;
  if (box.lockedRatio && !stretch) {
    const scale = Math.max(box.w / image.box.w, box.h / image.box.h);
    box.w = image.box.w * scale; box.h = image.box.h * scale;
    if (handle.includes("w")) box.x = right - box.w;
    if (handle.includes("n")) box.y = bottom - box.h;
  }
  box.w = Math.max(1, box.w); box.h = Math.max(1, box.h);
  return { ...image, box: { ...box, lockedRatio: image.box.lockedRatio || ratio > 0 } };
}

export const rotateImage = (image: ImageElement, rotation: number): ImageElement => ({ ...image, box: { ...image.box, rotation } });
export const resetCrop = (image: ImageElement): ImageElement => ({ ...image, crop: null });
export const cropImage = (image: ImageElement, crop: CropRect): ImageElement => ({ ...image, crop: { left: Math.max(0, crop.left), top: Math.max(0, crop.top), right: Math.min(1, crop.right), bottom: Math.min(1, crop.bottom) } });
