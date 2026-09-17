/**
 * Pure document-space geometry for the Canva-style image element.  All values
 * are percentages of the output page, so zoom never changes editing results.
 */
export type ImageBox = { x: number; y: number; w: number; h: number; rotation: number; flipH: boolean; flipV: boolean; lockedRatio: boolean };
export type CropRect = { left: number; top: number; right: number; bottom: number };
export type ImageElement = { box: ImageBox; crop: CropRect | null };
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const fullPageImage = (): ImageElement => ({ box: { x: 0, y: 0, w: 100, h: 100, rotation: 0, flipH: false, flipV: false, lockedRatio: true }, crop: null });
export const fullCrop = (): CropRect => ({ left: 0, top: 0, right: 1, bottom: 1 });
export const moveImage = (image: ImageElement, dx: number, dy: number): ImageElement => ({ ...image, box: { ...image.box, x: image.box.x + dx, y: image.box.y + dy } });
export const nudgeImage = (image: ImageElement, direction: "left" | "right" | "up" | "down", amount = 1): ImageElement =>
  moveImage(image, direction === "left" ? -amount : direction === "right" ? amount : 0, direction === "up" ? -amount : direction === "down" ? amount : 0);

const MIN_SIZE = 1;
const clampSize = (value: number) => Math.max(MIN_SIZE, value);

/** Pointer movement in page axes transformed into the element's local axes. */
export function localResizeDelta(image: ImageElement, dx: number, dy: number): { dx: number; dy: number } {
  const radians = -image.box.rotation * Math.PI / 180;
  return { dx: dx * Math.cos(radians) - dy * Math.sin(radians), dy: dx * Math.sin(radians) + dy * Math.cos(radians) };
}

/** Resize from one of the eight selection handles, keeping the opposite edge anchored. */
export function resizeImage(image: ImageElement, handle: ResizeHandle, dx: number, dy: number, stretch = false): ImageElement {
  const original = image.box;
  const west = handle.includes("w"); const east = handle.includes("e");
  const north = handle.includes("n"); const south = handle.includes("s");
  const right = original.x + original.w; const bottom = original.y + original.h;
  let w = original.w + (east ? dx : west ? -dx : 0);
  let h = original.h + (south ? dy : north ? -dy : 0);

  if (original.lockedRatio && !stretch) {
    const hasHorizontal = west || east;
    const hasVertical = north || south;
    const scaleX = hasHorizontal ? w / original.w : 1;
    const scaleY = hasVertical ? h / original.h : 1;
    // Corners use the movement that changed scale the most; an edge uses its
    // own axis and expands the other axis symmetrically around its centre.
    const scale = hasHorizontal && hasVertical
      ? (Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY)
      : hasHorizontal ? scaleX : scaleY;
    w = clampSize(original.w * scale);
    h = clampSize(original.h * scale);
  } else {
    w = clampSize(w); h = clampSize(h);
  }

  let x = original.x; let y = original.y;
  if (west) x = right - w;
  else if (!east && w !== original.w) x = original.x - (w - original.w) / 2;
  if (north) y = bottom - h;
  else if (!south && h !== original.h) y = original.y - (h - original.h) / 2;
  return { ...image, box: { ...original, x, y, w, h } };
}

export const rotateImage = (image: ImageElement, rotation: number): ImageElement => ({ ...image, box: { ...image.box, rotation: ((rotation % 360) + 360) % 360 } });
export const resetCrop = (image: ImageElement): ImageElement => ({ ...image, crop: null });
const MIN_CROP_SPAN = 0.05;
export const cropImage = (image: ImageElement, crop: CropRect): ImageElement => {
  const left = Math.max(0, Math.min(1 - MIN_CROP_SPAN, crop.left));
  const top = Math.max(0, Math.min(1 - MIN_CROP_SPAN, crop.top));
  const right = Math.max(left + MIN_CROP_SPAN, Math.min(1, crop.right));
  const bottom = Math.max(top + MIN_CROP_SPAN, Math.min(1, crop.bottom));
  return { ...image, crop: { left, top, right, bottom } };
};
export const moveCrop = (crop: CropRect, dx: number, dy: number): CropRect => {
  const width = crop.right - crop.left; const height = crop.bottom - crop.top;
  const left = Math.max(0, Math.min(1 - width, crop.left + dx));
  const top = Math.max(0, Math.min(1 - height, crop.top + dy));
  return { left, top, right: left + width, bottom: top + height };
};
export function resizeCrop(crop: CropRect, handle: ResizeHandle, dx: number, dy: number): CropRect {
  let { left, top, right, bottom } = crop;
  if (handle.includes("w")) left += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) top += dy;
  if (handle.includes("s")) bottom += dy;
  return cropImage({ ...fullPageImage(), crop: null }, { left, top, right, bottom }).crop!;
}
