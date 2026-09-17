/**
 * Frames: a container box on the page that clips one image.
 *
 * Two coordinate spaces meet here and must never be confused:
 *   - `frame.box`      is a percentage of the output page, exactly like a free
 *                      image element, so zoom never changes editing results.
 *   - `frame.content`  is an ImageElement whose box is a percentage of THE
 *                      FRAME. Reusing ImageElement means every existing
 *                      move/resize/rotate/crop function works on frame content
 *                      unchanged; only the conversions below know the frames.
 */
import { fullPageImage, type ImageBox, type ImageElement } from "@/src/image-geometry";

export type FrameElement = {
  id: string;
  box: ImageBox;
  /** Asset id of the image inside, or null for an empty frame. */
  imageId: number | null;
  /** Transform of that image within the frame. Null exactly when imageId is null. */
  content: ImageElement | null;
};

export type PageSize = { width: number; height: number };
export type SourceSize = { w: number; h: number };
export type FillMode = "fill" | "fit";

let nextFrameId = 0;
export const frameId = () => `frame-${(nextFrameId += 1)}-${Math.random().toString(36).slice(2, 7)}`;

export const createFrame = (box: Pick<ImageBox, "x" | "y" | "w" | "h">): FrameElement => ({
  id: frameId(),
  box: { ...box, rotation: 0, flipH: false, flipV: false, lockedRatio: false },
  imageId: null, content: null,
});

/** A frame dragged out on the canvas: any two corners, normalised. */
export const frameFromDrag = (x1: number, y1: number, x2: number, y2: number) =>
  createFrame({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(1, Math.abs(x2 - x1)), h: Math.max(1, Math.abs(y2 - y1)) });

/** The frame's aspect ratio in real output pixels, not in percentage units. */
export const frameAspect = (frame: FrameElement, page: PageSize) =>
  (frame.box.w * page.width) / (frame.box.h * page.height);

/**
 * Content geometry that covers (fill) or is contained by (fit) the frame while
 * keeping the source undistorted. The result is centred; the caller is free to
 * move it afterwards.
 */
export function contentFor(frame: FrameElement, src: SourceSize, page: PageSize, mode: FillMode = "fill", crop: ImageElement["crop"] = null): ImageElement {
  const aspect = frameAspect(frame, page);
  const source = src.h > 0 ? src.w / src.h : 1;
  const wider = mode === "fill" ? source > aspect : source < aspect;
  const w = wider ? 100 * source / aspect : 100;
  const h = wider ? 100 : 100 * aspect / source;
  return { box: { ...fullPageImage().box, x: (100 - w) / 2, y: (100 - h) / 2, w, h }, crop };
}

export const fillFrame = (frame: FrameElement, src: SourceSize, page: PageSize) =>
  ({ ...frame, content: contentFor(frame, src, page, "fill", frame.content?.crop ?? null) });
export const fitFrame = (frame: FrameElement, src: SourceSize, page: PageSize) =>
  ({ ...frame, content: contentFor(frame, src, page, "fit", frame.content?.crop ?? null) });

/** Put an image into a frame. Default Fill, never distorted, replacing whatever was there. */
export const attachImage = (frame: FrameElement, imageId: number, src: SourceSize, page: PageSize, mode: FillMode = "fill"): FrameElement =>
  ({ ...frame, imageId, content: contentFor(frame, src, page, mode) });

export const clearFrame = (frame: FrameElement): FrameElement => ({ ...frame, imageId: null, content: null });

/**
 * Where the frame's content sits on the page — used to detach an image back to
 * a free element, and by the exporter.
 *
 * The content is placed in the frame's own unrotated space first, then carried
 * through the frame's transform. A CSS `rotate(θ) scale(f)` is the matrix R·S,
 * so the frame applied to the content is R(θf)·S(f)·R(θc)·S(c). Conjugating
 * gives S(f)·R(θc) = R(det(f)·θc)·S(f), which collapses the product to a single
 * rotation R(θf + det(f)·θc) and the product of the two flips: the result is
 * still a plain box, provided its centre is carried through the same transform.
 */
export function contentPageElement(frame: FrameElement): ImageElement {
  const content = frame.content ?? fullPageImage();
  const { box } = frame;
  const w = content.box.w / 100 * box.w;
  const h = content.box.h / 100 * box.h;
  const centre = {
    x: box.x + (content.box.x + content.box.w / 2) / 100 * box.w,
    y: box.y + (content.box.y + content.box.h / 2) / 100 * box.h,
  };
  const frameCentre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  // S first, then R: the flip mirrors the offset across the frame's own axes,
  // and the rotation then swings it around the frame's centre.
  const dx = (centre.x - frameCentre.x) * (box.flipH ? -1 : 1);
  const dy = (centre.y - frameCentre.y) * (box.flipV ? -1 : 1);
  const radians = box.rotation * Math.PI / 180;
  const x = frameCentre.x + dx * Math.cos(radians) - dy * Math.sin(radians);
  const y = frameCentre.y + dx * Math.sin(radians) + dy * Math.cos(radians);
  // A single mirror reverses the sense of any rotation inside it.
  const mirrored = box.flipH !== box.flipV;
  return {
    crop: content.crop,
    box: {
      ...content.box,
      x: x - w / 2, y: y - h / 2, w, h,
      rotation: ((box.rotation + (mirrored ? -content.box.rotation : content.box.rotation)) % 360 + 360) % 360,
      flipH: box.flipH !== content.box.flipH,
      flipV: box.flipV !== content.box.flipV,
    },
  };
}

/** Topmost frame under a point given in page percentages; frames render in array order. */
export function frameAt(frames: FrameElement[], x: number, y: number): FrameElement | null {
  for (let at = frames.length - 1; at >= 0; at -= 1) {
    const { box } = frames[at];
    const cx = box.x + box.w / 2; const cy = box.y + box.h / 2;
    const radians = -box.rotation * Math.PI / 180;
    const local = {
      x: cx + (x - cx) * Math.cos(radians) - (y - cy) * Math.sin(radians),
      y: cy + (x - cx) * Math.sin(radians) + (y - cy) * Math.cos(radians),
    };
    if (local.x >= box.x && local.x <= box.x + box.w && local.y >= box.y && local.y <= box.y + box.h) return frames[at];
  }
  return null;
}

export const replaceFrame = (frames: FrameElement[], next: FrameElement) => frames.map((frame) => frame.id === next.id ? next : frame);
export const removeFrame = (frames: FrameElement[], id: string) => frames.filter((frame) => frame.id !== id);
