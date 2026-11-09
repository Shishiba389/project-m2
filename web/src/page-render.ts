/**
 * Rendering one exported page, on the main thread or in a worker.
 *
 * Nothing here touches `document` unless the platform has no OffscreenCanvas,
 * so the same code runs in `export-worker.ts` and `batch-worker.ts`, where it
 * cannot freeze the editor, and on the main thread where workers are missing.
 *
 * The page is composited in software, in unpremultiplied 8-bit RGBA, rather
 * than on a canvas. A canvas premultiplies by alpha and rounds to a byte, so
 * every partly transparent pixel lost colour on the way in and again on the
 * way out (png.ts says how much). Here an axis-aligned picture on a
 * transparent page keeps exactly the bytes the resampler computed, and a PNG
 * is written from those bytes. A turned or mirrored picture is drawn by
 * `transformRgba`, in linear light like the resampler, where a canvas
 * darkened fine detail by filtering it in gamma-encoded sRGB.
 */
import { fullCrop, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { applyPoint, compose, identity, invert, rotation, scaling, translation, type Mat3 } from "@/src/mat3";
import {
  estimatePeakBytes, resizeRgba, transformRgba, validateDimensions, type RgbaBuffer, type Resampling, type ResizeWindow,
} from "@/src/resize-core";
import { createCanvas, encodeRgba, type EncodableFormat, type Profile } from "@/src/output-engine";
import { decodePng, isPng, needsExactDecode } from "@/src/png";

export type Rect = { x: number; y: number; w: number; h: number };

/** Everything a render needs, taken from the document. */
export type FrameSpec = {
  width: number;
  height: number;
  background: string;
  /**
   * The subject's own geometry. Its box is the picture: every image is drawn
   * to fill its box, because Fit, Fill and Stretch now decide the box rather
   * than how the picture sits inside one.
   */
  element: ImageElement;
  /** The page's layer stack, bottom to top, including the queued image. */
  layers: Layer[];
  /** The asset being exported, so its layer is drawn from the source already decoded. */
  queuedAssetId?: number;
  /**
   * False when the queued image already appears in `layers`. It is only drawn
   * from `element` when it is not a page layer at all — the batch case, where
   * the image is the page's subject rather than one of several layers.
   */
  drawElement?: boolean;
  /** "classic" (the default) is the certified MINIMA resampler; "high" is the opt-in quality mode. */
  resampling?: Resampling;
};

/** One layer of the page: a free image, or a frame's content clipped by it. */
export type Layer = {
  /** Which asset this layer draws, so the queued one can reuse its pixels. */
  assetId: number;
  element: ImageElement;
  file: File;
  clip?: ImageBox;
};

export type RenderMetadata = { dpi?: number; maxBytes?: number | null; profile?: Profile };

/** A box in percentages of the page, as output pixels. */
export const boxPx = (box: Pick<ImageBox, "x" | "y" | "w" | "h">, page: { width: number; height: number }): Rect => ({
  x: (box.x / 100) * page.width, y: (box.y / 100) * page.height,
  w: (box.w / 100) * page.width, h: (box.h / 100) * page.height,
});

/**
 * The rotation and mirror an element carries, about its own centre.
 *
 * This is returned as a matrix rather than pushed straight into the canvas so
 * it can be asserted on, because one property of it is load-bearing: an
 * axis-aligned element must produce the identity. The MINIMA resampler is
 * separable and cannot express a rotation, so the certified path is
 * `resizeRgba` with nothing after it; rotation is a rigid transform layered on
 * top of an already-resampled bitmap. If this function ever returned something
 * other than the identity for an unrotated box, every ordinary export would
 * silently be filtered a second time by `transformRgba`.
 */
export function elementTransform(box: ImageBox, page: { width: number; height: number }): Mat3 {
  if (!box.flipH && !box.flipV && !box.rotation) return identity();
  const cx = (box.x + box.w / 2) / 100 * page.width;
  const cy = (box.y + box.h / 2) / 100 * page.height;
  // Read right to left: mirror first, then rotate - the order CSS
  // `rotate() scale()` and `fromBox` use. The other order turns a mirrored
  // image the opposite way in the file from the way it turns on screen.
  return compose(
    translation(cx, cy),
    rotation(box.rotation),
    scaling(box.flipH ? -1 : 1, box.flipV ? -1 : 1),
    translation(-cx, -cy),
  );
}

const isIdentity = (matrix: Mat3) =>
  matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1 && matrix.tx === 0 && matrix.ty === 0;

/**
 * The part of an element's rendered picture that can reach the page, in the
 * picture's own pixels - or null when none of it can.
 *
 * `render` is where the resampled picture is drawn before the element's
 * rotation and mirror, `transform` is that rotation and mirror. The page is
 * mapped back through it, so a turned picture keeps every pixel its corners
 * sweep over. A turned picture is filtered by `transformRgba`, which reads a
 * pixel or two either side: those keep a margin. An axis-aligned one is
 * copied pixel for pixel, so its window is exact.
 *
 * A picture zoomed far past the page is mostly off it. Resampling all of it
 * only to clip it away cost time and memory, and past 20,000 px a side the
 * export refused it outright.
 */
export function visibleWindow(render: Rect, transform: Mat3, page: { width: number; height: number }): ResizeWindow | null {
  const back = invert(transform) ?? identity();
  const corners = [[0, 0], [page.width, 0], [0, page.height], [page.width, page.height]]
    .map(([x, y]) => applyPoint(back, { x, y }));
  const aligned = transform.a === 1 && transform.b === 0 && transform.c === 0 && transform.d === 1;
  const margin = aligned ? 0 : 2;
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x)) - render.x) - margin);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y)) - render.y) - margin);
  const x1 = Math.min(render.w, Math.ceil(Math.max(...corners.map((point) => point.x)) - render.x) + margin);
  const y1 = Math.min(render.h, Math.ceil(Math.max(...corners.map((point) => point.y)) - render.y) + margin);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/**
 * How much working memory one render may use: refuse a render before
 * allocating it instead of freezing the browser tab.
 *
 * Measured, not guessed: half the heap limit the browser reports. The
 * resampler streams, so a render costs about its 8-bit source and output -
 * this cap is for the truly enormous, not for ordinary product shots.
 *
 * Only Chromium reports the limit, and a privacy setting or a worker can hide
 * it. Assuming a single gigabyte when it is missing refuses photographs that a
 * laptop handles without noticing, so the blind case assumes an ordinary
 * desktop instead of the smallest machine imaginable.
 */
function renderBudget() {
  const perf = performance as Performance & { memory?: { jsHeapSizeLimit: number } };
  const measured = perf.memory?.jsHeapSizeLimit;
  return measured ? Math.max(512 * 1024 * 1024, Math.floor(measured / 2)) : 1536 * 1024 * 1024;
}

/* ------------------------------------------------------------ decoding */

/**
 * A file as 8-bit unpremultiplied RGBA, the way the editor shows it.
 *
 * A PNG with transparency is read by png.ts, which keeps every byte; anything
 * else - or a PNG carrying a colour profile, gamma or orientation that only
 * the browser applies - is decoded by the browser and read off a canvas,
 * which is exact wherever the image is opaque.
 */
export async function decodeImage(file: Blob): Promise<RgbaBuffer> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (isPng(head)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (needsExactDecode(bytes)) {
      try {
        return await decodePng(bytes);
      } catch {
        // Something the reader does not handle: the browser has the last word.
      }
    }
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const { context } = createCanvas(bitmap.width, bitmap.height, { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close?.();
  }
}

/**
 * A rectangle of `image`, as its own buffer. Pixels outside the image are
 * transparent, which is what reading past a canvas's edge gave.
 */
function cropRgba(image: RgbaBuffer, x: number, y: number, width: number, height: number): RgbaBuffer {
  if (x === 0 && y === 0 && width === image.width && height === image.height) return image;
  const data = new Uint8ClampedArray(width * height * 4);
  const from = Math.max(0, x); const to = Math.min(image.width, x + width);
  if (to > from) for (let row = 0; row < height; row += 1) {
    const sourceY = y + row;
    if (sourceY < 0 || sourceY >= image.height) continue;
    data.set(image.data.subarray((sourceY * image.width + from) * 4, (sourceY * image.width + to) * 4), (row * width + from - x) * 4);
  }
  return { width, height, data };
}

/* ------------------------------------------------------------ compositing */

/** Any CSS colour as RGBA bytes, the way a canvas reads it. */
export function cssColor(css: string): [number, number, number, number] {
  const { context } = createCanvas(1, 1, { willReadFrequently: true });
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  return [r, g, b, a];
}

/** A page of one colour. */
export function solidPage(width: number, height: number, rgba: readonly [number, number, number, number]): RgbaBuffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3]; }
  return { width, height, data };
}

/**
 * Draw `image` over `page` at integer offset (`x`, `y`), source-over, in
 * unpremultiplied 8-bit - the same rule a canvas applies, without the
 * premultiplied rounding. Onto a transparent pixel an image pixel lands
 * unchanged.
 *
 * `clip` is in page pixels and may cut through pixels. A canvas clip is not
 * anti-aliased - measured: a pixel is in when its centre is - so neither is
 * this one, and a square frame edges its content exactly as a turned frame,
 * which only a canvas can clip, does.
 */
export function compositeOver(page: RgbaBuffer, image: RgbaBuffer, x: number, y: number, clip?: Rect) {
  const x0 = Math.max(0, x, clip ? Math.ceil(clip.x - 0.5) : 0);
  const y0 = Math.max(0, y, clip ? Math.ceil(clip.y - 0.5) : 0);
  const x1 = Math.min(page.width, x + image.width, clip ? Math.ceil(clip.x + clip.w - 0.5) : page.width);
  const y1 = Math.min(page.height, y + image.height, clip ? Math.ceil(clip.y + clip.h - 0.5) : page.height);
  const out = page.data; const src = image.data;
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const s = ((py - y) * image.width + (px - x)) * 4;
      const d = (py * page.width + px) * 4;
      const sourceAlpha = src[s + 3];
      if (sourceAlpha === 0) continue;
      if (sourceAlpha === 255 || out[d + 3] === 0) {
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = sourceAlpha;
        continue;
      }
      const as = sourceAlpha / 255;
      const ad = (out[d + 3] / 255) * (1 - as);
      const ao = as + ad;
      out[d] = (src[s] * as + out[d] * ad) / ao;
      out[d + 1] = (src[s + 1] * as + out[d + 1] * ad) / ao;
      out[d + 2] = (src[s + 2] * as + out[d + 2] * ad) / ao;
      out[d + 3] = ao * 255;
    }
  }
}

/* ------------------------------------------------------------ resampling */

/** A picture resampled for its place on the page - or null when none of it is on the page. */
type Resampled = { image: RgbaBuffer; x: number; y: number; transform: Mat3 } | null;
/**
 * Template layers, resampled once per export run. Every file of a batch puts
 * its own image into the same template; the frames, backdrops and logos
 * around it are the same pixels in the same place on every page, and decoding
 * and resampling them again for each file was most of a templated batch's time.
 */
export type LayerCache = Map<string, Resampled>;
/** What a template layer's pixels depend on: its source, its geometry, the page and the resampler. */
export const templateKey = (layer: Pick<Layer, "assetId" | "element">, spec: Pick<FrameSpec, "width" | "height" | "resampling">) =>
  `${layer.assetId}|${spec.width}x${spec.height}|${spec.resampling ?? "classic"}|${JSON.stringify(layer.element)}`;

/** Resample one image element for the page with the editor's own geometry. */
function resampleLayer(source: RgbaBuffer, spec: FrameSpec, element: ImageElement): Resampled {
  const crop = element.crop ?? fullCrop();
  const sourceWidth = Math.max(1, Math.ceil((crop.right - crop.left) * source.width));
  const sourceHeight = Math.max(1, Math.ceil((crop.bottom - crop.top) * source.height));
  // The box is the picture: the cropped source fills it exactly, which is what
  // the preview draws, and the page or frame clips whatever overflows.
  const dest = boxPx(element.box, spec);
  const render = { x: Math.round(dest.x), y: Math.round(dest.y), w: Math.max(1, Math.round(dest.w)), h: Math.max(1, Math.round(dest.h)) };
  const transform = elementTransform(element.box, spec);
  // Only the part of the picture that can land on the page is resampled; the
  // pixels are the ones the whole picture would have had there.
  const window = visibleWindow(render, transform, spec);
  if (!window) return null;
  const peakBytes = estimatePeakBytes(sourceWidth, sourceHeight, render.w, render.h, window);
  const budget = renderBudget();
  if (peakBytes > budget) {
    throw new Error(`IMAGE_TOO_LARGE: this edit needs about ${Math.ceil(peakBytes / 1_048_576)} MB of working memory, `
      + `and this browser allows ${Math.floor(budget / 1_048_576)} MB. Resize the source down first, or export it on its own.`);
  }
  const cropped = cropRgba(source, Math.floor(crop.left * source.width), Math.floor(crop.top * source.height), sourceWidth, sourceHeight);
  const image = resizeRgba(cropped, render.w, render.h, { window, quality: spec.resampling });
  return { image, x: render.x + window.x, y: render.y + window.y, transform };
}

/** Whether a frame is still an upright rectangle on the page: unturned, or turned half way round. */
const upright = (clip: ImageBox) => ((clip.rotation % 180) + 180) % 180 === 0;

/** The integer pixel rectangle covering `points`, grown by `margin` and cut to `within`. */
function pixelBounds(points: { x: number; y: number }[], margin: number, within: ResizeWindow): ResizeWindow | null {
  const x0 = Math.max(within.x, Math.floor(Math.min(...points.map((point) => point.x))) - margin);
  const y0 = Math.max(within.y, Math.floor(Math.min(...points.map((point) => point.y))) - margin);
  const x1 = Math.min(within.x + within.width, Math.ceil(Math.max(...points.map((point) => point.x))) + margin);
  const y1 = Math.min(within.y + within.height, Math.ceil(Math.max(...points.map((point) => point.y))) + margin);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

/** A box's corners on the page, after its own rotation and mirror. */
const cornersOf = (rect: Rect, transform: Mat3) => [[0, 0], [1, 0], [0, 1], [1, 1]]
  .map(([u, v]) => applyPoint(transform, { x: rect.x + u * rect.w, y: rect.y + v * rect.h }));

/**
 * Cut a drawn layer (`drawn`, covering `area` of the page) to its frame.
 *
 * An upright frame keeps a pixel when its centre is inside, as a canvas clip
 * does. A turned frame's edge crosses pixels at an angle, where that rule is a
 * staircase - which is what a canvas drew. There each pixel keeps the share of
 * it inside the frame, measured on a 4x4 grid, the way the editor's own view
 * draws a turned frame.
 */
function cutToFrame(drawn: RgbaBuffer, area: ResizeWindow, clip: ImageBox, page: { width: number; height: number }) {
  const rect = boxPx(clip, page);
  const back = invert(elementTransform(clip, page)) ?? identity();
  const turned = !upright(clip);
  // Where a page point falls in the frame's own unturned rectangle.
  const local = (x: number, y: number) => applyPoint(back, { x, y });
  // How far inside the frame's edges that is; negative outside.
  const depth = (point: { x: number; y: number }) =>
    Math.min(point.x - rect.x, rect.x + rect.w - point.x, point.y - rect.y, rect.y + rect.h - point.y);
  for (let row = 0; row < area.height; row += 1) for (let col = 0; col < area.width; col += 1) {
    const o = (row * area.width + col) * 4;
    if (drawn.data[o + 3] === 0) continue;
    const px = area.x + col; const py = area.y + row;
    const point = local(px + 0.5, py + 0.5);
    const centre = depth(point);
    let coverage: number;
    // The canvas rule, as in compositeOver: in from the left and top edge, out at the right and bottom.
    if (!turned) coverage = point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h ? 1 : 0;
    else if (centre >= 0.75) coverage = 1; // further in than a pixel's half-diagonal
    else if (centre <= -0.75) coverage = 0;
    else {
      let inside = 0;
      for (let j = 0; j < 4; j += 1) for (let i = 0; i < 4; i += 1) if (depth(local(px + (i + 0.5) / 4, py + (j + 0.5) / 4)) > 0) inside += 1;
      coverage = inside / 16;
    }
    if (coverage < 1) drawn.data[o + 3] = Math.round(drawn.data[o + 3] * coverage);
  }
}

/**
 * Lay one resampled picture onto the page. An axis-aligned picture under an
 * upright frame is composited byte for byte. A turned or mirrored one - or one
 * under a turned frame - is drawn by `transformRgba` into the part of the page
 * it can reach, cut to its frame, and composited the same way. No canvas.
 */
function layDown(page: RgbaBuffer, resampled: Resampled, spec: FrameSpec, clip?: ImageBox) {
  if (!resampled) return;
  const { image, x, y, transform } = resampled;
  if (isIdentity(transform) && (!clip || upright(clip))) {
    compositeOver(page, image, x, y, clip ? boxPx(clip, spec) : undefined);
    return;
  }
  const whole = { x: 0, y: 0, width: page.width, height: page.height };
  let area = pixelBounds(cornersOf({ x, y, w: image.width, h: image.height }, transform), 2, whole);
  if (area && clip) area = pixelBounds(cornersOf(boxPx(clip, spec), elementTransform(clip, spec)), 1, area);
  if (!area) return;
  const drawn = transformRgba(image, x, y, transform, area);
  if (clip) cutToFrame(drawn, area, clip, spec);
  compositeOver(page, drawn, area.x, area.y);
}

/* ------------------------------------------------------------ the page */

/**
 * Render one exported page and encode it. `templates` carries the template
 * layers between the files of one run.
 */
export async function renderPage(file: File, spec: FrameSpec, format: EncodableFormat, quality: number,
  metadata: RenderMetadata = {}, templates: LayerCache = new Map()): Promise<Uint8Array> {
  validateDimensions(spec.width, spec.height);
  const source = await decodeImage(file);
  // A JPG cannot be transparent: a transparent page is flattened onto white.
  const background = spec.background !== "transparent" ? spec.background : format === "jpg" ? "#ffffff" : null;
  const page = background ? solidPage(spec.width, spec.height, cssColor(background)) : solidPage(spec.width, spec.height, [0, 0, 0, 0]);
  // Only the batch case draws from `element`: there the image is the page's
  // subject, underneath whatever else the page holds.
  if (spec.drawElement !== false) layDown(page, resampleLayer(source, spec, spec.element), spec);
  for (const layer of spec.layers) {
    // The queued image is already decoded and is different in every file.
    // Every other layer is the template around it: the same pixels in the
    // same place on every page, decoded and resampled once per run.
    let resampled: Resampled | undefined;
    if (layer.assetId === spec.queuedAssetId) resampled = resampleLayer(source, spec, layer.element);
    else {
      const key = templateKey(layer, spec);
      resampled = templates.get(key);
      if (resampled === undefined) {
        resampled = resampleLayer(await decodeImage(layer.file), spec, layer.element);
        templates.set(key, resampled);
      }
    }
    layDown(page, resampled, spec, layer.clip);
  }
  return encodeRgba(page, {
    format, quality, dpi: metadata.dpi ? { x: metadata.dpi, y: metadata.dpi } : undefined,
    maxBytes: metadata.maxBytes ?? undefined, profile: metadata.profile,
  });
}

/** What batch convert needs to know to write one file. */
export type BatchEncoding = {
  width: number; height: number; format: EncodableFormat; quality: number; dpi: number;
  maxBytes: number | null; jpegBackground: string; resampling?: Resampling;
};

/** Batch convert: decode, resize with MINIMA's exact pixel core, flatten a JPG, encode. */
export async function resizeFile(file: Blob, output: BatchEncoding): Promise<Uint8Array> {
  validateDimensions(output.width, output.height);
  const resized = resizeRgba(await decodeImage(file), output.width, output.height, { quality: output.resampling });
  let page = resized;
  if (output.format === "jpg") {
    page = solidPage(output.width, output.height, cssColor(output.jpegBackground));
    compositeOver(page, resized, 0, 0);
  }
  return encodeRgba(page, {
    format: output.format, quality: output.quality,
    dpi: { x: output.dpi, y: output.dpi }, maxBytes: output.maxBytes ?? undefined,
  });
}
