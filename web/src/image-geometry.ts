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

/* Resizing, rotating and the local-axis conversion moved to gestures.ts,
   which computes them from the gesture's own starting matrix. */
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

/* --------------------------------------------------------------- cursors */

/**
 * Which way each handle points in the element's own frame, in degrees
 * clockwise from east. Screen y grows downward, so `se` is +45.
 */
const HANDLE_ANGLE: Record<ResizeHandle, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
export type ResizeCursor = "ew-resize" | "nwse-resize" | "ns-resize" | "nesw-resize";
const CURSORS: ResizeCursor[] = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];

/**
 * The cursor a handle should show once its element is transformed.
 *
 * A static `nwse-resize` on the `se` handle is a lie the moment the element
 * turns: at 90° that handle drags the object south-west. The element is drawn
 * `rotate(r) scale(flip)`, so the handle direction goes through the mirror
 * first and the rotation second, in that order. Only the line matters, not
 * which end of it, so the result folds into a half turn.
 */
export function handleCursor(handle: ResizeHandle, box: { rotation: number; flipH: boolean; flipV: boolean }): ResizeCursor {
  let angle = HANDLE_ANGLE[handle];
  if (box.flipH) angle = 180 - angle;
  if (box.flipV) angle = -angle;
  angle += box.rotation;
  return CURSORS[Math.round((((angle % 180) + 180) % 180) / 45) % 4];
}
