/**
 * The editor's export, for real.
 *
 * The dialog used to show an "Output folder" of C:\Products\MINIMA_Output and
 * run a timer that invented progress and invented failures. A browser cannot
 * write to a local path, so the only honest output is a download: every queued
 * image is rendered into its own Canva-style element box, then clipped by the
 * output page and zipped.
 *
 * This is the editor's geometry, which the user set by hand — not the batch
 * target framing, which is being built as its own engine.
 */
import { begin } from "@/src/selfcheck";
import { downloadZip, makeZip, type OutFormat, type ZipEntry } from "@/src/batch";
import {
  assetKey, docFromPreset, frameKey, orderStack, outputName, placementKey, presetById,
  type Asset, type Doc, type Format,
} from "@/src/flow";
import { fullCrop, fullPageImage, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { compose, identity, rotation, scaling, translation, type Mat3 } from "@/src/mat3";
import { attachImage, contentPageElement, createFrame } from "@/src/frame-geometry";
import { estimatePeakBytes, resizeRgba, validateDimensions } from "@/src/resize-core";
import { encodeOutput } from "@/src/output-engine";

export type Rect = { x: number; y: number; w: number; h: number };

/** Everything a render needs, taken from the document. */
export type FrameSpec = {
  width: number;
  height: number;
  background: string;
  fit: "contain" | "cover" | "fill";
  align: { horizontal: "left" | "center" | "right"; vertical: "top" | "center" | "bottom" };
  element: ImageElement;
  /** The page's layer stack, bottom to top, including the queued image. */
  layers: Layer[];
  /** The asset being exported, so its layer is drawn from the open bitmap. */
  queuedAssetId?: number;
  /**
   * False when the queued image already appears in `layers`. It is only drawn
   * from `element` when it is not a page layer at all — the batch case, where
   * the image is the page's subject rather than one of several layers.
   */
  drawElement?: boolean;
};

/** One layer of the page: a free image, or a frame's content clipped by it. */
export type Layer = {
  /** Which asset this layer draws, so the queued one can reuse its bitmap. */
  assetId: number;
  element: ImageElement;
  file: File;
  clip?: ImageBox;
  /**
   * How the source maps into the element box. Frame content is always "fill":
   * `contentFor` already sized the box to the source's ratio, which is what the
   * preview draws. Free images follow the page's own fit setting.
   */
  fit?: FrameSpec["fit"];
};

/**
 * The page's layer stack in the order the editor draws it: free images in
 * their own order, then frames. Every layer says which asset it draws, so the
 * exporter never has to guess where the image it is exporting belongs in the
 * stack — it is simply one of these.
 */
/**
 * Every layer the canvas would draw, bottom to top.
 *
 * `subject` names the one instance this file is about.  When it is given,
 * *other* instances of the same asset are left out: an image placed three
 * times produces three files, and each shows its own copy in place and the
 * other two hidden, so the three files are three layouts rather than three
 * identical pictures.  Instances of every *other* asset stay, because they
 * are the template the subject is being placed into.
 */
export function pageLayers(doc: Doc, assets: Asset[], subject?: string): Layer[] {
  const frames = doc.frames ?? [];
  const framed = new Set(frames.map((frame) => frame.imageId).filter((id): id is number => id !== null));
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const free = (doc.placements ?? []).flatMap((placement) => {
    const asset = byId.get(placement.assetId);
    return asset?.file && !asset.corrupt && !framed.has(asset.id)
      ? [{ key: placementKey(placement.id), assetId: asset.id, layer: { assetId: asset.id, element: placement.element, file: asset.file } }]
      : [];
  });
  const inFrames = frames.flatMap((frame) => {
    const asset = byId.get(frame.imageId ?? -1);
    return asset?.file && !asset.corrupt && frame.content
      ? [{ key: frameKey(frame.id), assetId: asset.id, layer: { assetId: asset.id, element: contentPageElement(frame), file: asset.file, clip: frame.box, fit: "fill" as const } }]
      : [];
  });
  const all = [...free, ...inFrames];
  const subjectAsset = subject === undefined ? null : all.find((entry) => entry.key === subject)?.assetId ?? null;
  const drawn = subjectAsset === null ? all
    : all.filter((entry) => entry.assetId !== subjectAsset || entry.key === subject);
  // Painted in the order the canvas shows. Without an arranged stack that is
  // "every free image, then every frame", which is the order these two lists
  // are built in, so an untouched document exports the way it always did.
  const byKey = new Map(drawn.map((entry) => [entry.key, entry.layer]));
  return orderStack(doc.stack, drawn.map((entry) => entry.key))
    .flatMap((key) => { const layer = byKey.get(key); return layer ? [layer] : []; });
}

/**
 * One entry per output file.
 *
 * The unit of export is an *instance*, not a source: three placements of one
 * image are three files.  An asset with no instance at all is still exported -
 * the canvas is a template and the asset is run through it - which is what
 * makes a batch of fifty untouched imports work exactly as it did before
 * anything could be placed twice.
 */
export type ExportUnit = {
  key: string; asset: Asset; element: ImageElement;
  /** The page as this file draws it, with the subject's other copies hidden. */
  layers: Layer[];
};
export function exportUnits(doc: Doc, assets: Asset[]): ExportUnit[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const usable = (asset: Asset | undefined): asset is Asset => Boolean(asset?.file) && !asset!.corrupt;
  const units: ExportUnit[] = [];
  const placed = new Set<number>();
  for (const placement of doc.placements ?? []) {
    const asset = byId.get(placement.assetId);
    if (!usable(asset)) continue;
    placed.add(asset.id);
    units.push({ key: placementKey(placement.id), asset, element: placement.element, layers: [] });
  }
  for (const frame of doc.frames ?? []) {
    const asset = byId.get(frame.imageId ?? -1);
    if (!usable(asset) || !frame.content) continue;
    placed.add(asset.id);
    units.push({ key: frameKey(frame.id), asset, element: contentPageElement(frame), layers: [] });
  }
  for (const asset of assets) {
    if (!usable(asset) || placed.has(asset.id)) continue;
    units.push({ key: assetKey(asset.id), asset, element: asset.element, layers: [] });
  }
  // Each file has its own layer list, because each hides a different copy.
  return units.map((unit) => ({ ...unit, layers: pageLayers(doc, assets, unit.key) }));
}

export const specFromDoc = (doc: Doc, assets: Asset[] = []): FrameSpec => ({
  width: doc.width,
  height: doc.height,
  background: doc.background,
  fit: doc.fit === "Fit" ? "contain" : doc.fit === "Fill" ? "cover" : "fill",
  align: {
    horizontal: doc.align?.includes("left") ? "left" : doc.align?.includes("right") ? "right" : "center",
    vertical: doc.align?.includes("top") ? "top" : doc.align?.includes("bottom") ? "bottom" : "center",
  },
  element: fullPageImage(),
  layers: pageLayers(doc, assets),
});

/** A box in percentages of the page, as output pixels. */
export const boxPx = (box: Pick<ImageBox, "x" | "y" | "w" | "h">, page: { width: number; height: number }): Rect => ({
  x: (box.x / 100) * page.width, y: (box.y / 100) * page.height,
  w: (box.w / 100) * page.width, h: (box.h / 100) * page.height,
});

/** An image element's destination box in output pixels. */
export function framePx(spec: FrameSpec): Rect {
  return boxPx(spec.element.box, spec);
}

/**
 * The rotation and mirror an element carries, about its own centre.
 *
 * This is returned as a matrix rather than pushed straight into the canvas so
 * it can be asserted on, because one property of it is load-bearing: an
 * axis-aligned element must produce the identity. The MINIMA resampler is
 * separable and cannot express a rotation, so the certified path is
 * `resizeRgba` drawing through an identity transform; rotation is a rigid
 * transform layered on top of an already-resampled bitmap. If this function
 * ever returned something other than the identity for an unrotated box, every
 * ordinary batch export would silently start going through canvas filtering
 * instead of through the bicubic pipeline.
 */
export function elementTransform(box: ImageBox, page: { width: number; height: number }): Mat3 {
  if (!box.flipH && !box.flipV && !box.rotation) return identity();
  const cx = (box.x + box.w / 2) / 100 * page.width;
  const cy = (box.y + box.h / 2) / 100 * page.height;
  return compose(
    translation(cx, cy),
    scaling(box.flipH ? -1 : 1, box.flipV ? -1 : 1),
    rotation(box.rotation),
    translation(-cx, -cy),
  );
}

/** Rotation and flip about a box's centre, shared by images and frames. */
function transformAboutCentre(context: CanvasRenderingContext2D, box: ImageBox, page: { width: number; height: number }) {
  const matrix = elementTransform(box, page);
  context.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty);
}

/**
 * Where the image lands inside the frame. This mirrors object-fit, which is
 * what the editor canvas previews it with, so the file matches the screen:
 * contain fits it whole, cover fills and overflows (the frame clips it), fill
 * distorts it to the frame.
 */
export function fitInto(srcW: number, srcH: number, frame: Rect, fit: FrameSpec["fit"], align: FrameSpec["align"] = { horizontal: "center", vertical: "center" }): Rect {
  if (fit === "fill" || srcW <= 0 || srcH <= 0) return { ...frame };
  const scale = fit === "cover"
    ? Math.max(frame.w / srcW, frame.h / srcH)
    : Math.min(frame.w / srcW, frame.h / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  const x = align.horizontal === "left" ? frame.x : align.horizontal === "right" ? frame.x + frame.w - w : frame.x + (frame.w - w) / 2;
  const y = align.vertical === "top" ? frame.y : align.vertical === "bottom" ? frame.y + frame.h - h : frame.y + (frame.h - h) / 2;
  return { x, y, w, h };
}

/** An export's file extension, which TIFF cannot be: canvas cannot encode it. */
export const encodableFormat = (format: Format): OutFormat =>
  (format === "tiff" ? "png" : format);

// The scaler keeps several linear-light buffers in memory. Refuse a render
// before allocating them instead of freezing the browser tab.
/**
 * How much working memory one render may use.
 *
 * Measured, not guessed. The batch path already asks the browser for its own
 * heap limit and allows a render half of it; the exporter hard-coded 512 MB
 * instead, and 512 MB is not enough to export anything.
 *
 * The linear-light pipeline needs 36 bytes for every *source* pixel before it
 * has done any work - the 8-bit source and its `Float64Array` copy are alive
 * together - so a photograph the same size as the page it is being fitted
 * into already costs 464 MB. Every export of an ordinary product shot failed
 * with IMAGE_TOO_LARGE, which is what this cap was meant to prevent, not to
 * cause.
 *
 * Only Chromium reports the limit, and a privacy setting can hide it there
 * too. Assuming a single gigabyte when it is missing refuses photographs that
 * a laptop handles without noticing, so the blind case assumes an ordinary
 * desktop instead of the smallest machine imaginable.
 */
function renderBudget() {
  const perf = performance as Performance & { memory?: { jsHeapSizeLimit: number } };
  const measured = perf.memory?.jsHeapSizeLimit;
  return measured ? Math.max(512 * 1024 * 1024, Math.floor(measured / 2)) : 1536 * 1024 * 1024;
}

/* ------------------------------------------------------------------ browser */

export async function renderFramed(file: File, spec: FrameSpec, format: OutFormat, quality: number,
  metadata: { dpi?: number; maxBytes?: number | null; profile?: "srgb" | "display-p3" | "rec709" } = {}): Promise<Uint8Array> {
  validateDimensions(spec.width, spec.height);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width;
    sourceCanvas.height = bitmap.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("2D canvas is unavailable");
    sourceContext.drawImage(bitmap, 0, 0);

    const canvas = document.createElement("canvas");
    canvas.width = spec.width;
    canvas.height = spec.height;
    const context = canvas.getContext("2d", { colorSpace: metadata.profile === "display-p3" ? "display-p3" : "srgb" } as CanvasRenderingContext2DSettings);
    if (!context) throw new Error("2D canvas is unavailable");

    if (spec.background !== "transparent" || format === "jpg") {
      context.fillStyle = spec.background === "transparent" ? "#ffffff" : spec.background;
      context.fillRect(0, 0, spec.width, spec.height);
    }

    context.save();
    // The output page is the crop boundary. An element may freely sit outside
    // it, just as it does in the editor.
    context.beginPath();
    context.rect(0, 0, spec.width, spec.height);
    context.clip();
    // Only the batch case draws from `element`: there the image is the page's
    // subject, underneath whatever else the page holds.
    if (spec.drawElement !== false) drawLayer(context, bitmap, sourceContext, spec, spec.element);
    for (const layer of spec.layers) {
      // The queued image is already decoded; every other layer needs its own.
      const queued = layer.assetId === spec.queuedAssetId;
      const source = queued ? bitmap : await createImageBitmap(layer.file, { imageOrientation: "from-image" });
      try {
        let layerContext = sourceContext;
        if (!queued) {
          const layerCanvas = document.createElement("canvas");
          layerCanvas.width = source.width; layerCanvas.height = source.height;
          const context2d = layerCanvas.getContext("2d", { willReadFrequently: true });
          if (!context2d) throw new Error("2D canvas is unavailable");
          context2d.drawImage(source, 0, 0);
          layerContext = context2d;
        }
        context.save();
        if (layer.clip) {
          // Clip in the frame's own rotated space, then draw the content back
          // in page space: a canvas clip is fixed once set.
          transformAboutCentre(context, layer.clip, spec);
          const rect = boxPx(layer.clip, spec);
          context.beginPath();
          context.rect(rect.x, rect.y, rect.w, rect.h);
          context.clip();
          context.setTransform(1, 0, 0, 1, 0, 0);
        }
        drawLayer(context, source, layerContext, spec, layer.element, layer.fit);
        context.restore();
      } finally {
        if (!queued) source.close?.();
      }
    }
    context.restore();

    return encodeOutput(canvas, {
      format, quality, dpi: metadata.dpi ? { x: metadata.dpi, y: metadata.dpi } : undefined,
      maxBytes: metadata.maxBytes ?? undefined,
    });
  } finally {
    bitmap.close?.();
  }
}

/** Draw one image element onto the page with the editor's own geometry. */
function drawLayer(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  sourceContext: CanvasRenderingContext2D,
  spec: FrameSpec,
  element: ImageElement,
  fit: FrameSpec["fit"] = spec.fit,
) {
  context.save();
  transformAboutCentre(context, element.box, spec);
  const crop = element.crop ?? fullCrop();
  const sourceWidth = Math.max(1, Math.ceil((crop.right - crop.left) * bitmap.width));
  const sourceHeight = Math.max(1, Math.ceil((crop.bottom - crop.top) * bitmap.height));
  // This is the same object-fit calculation as the preview: fit the cropped
  // source into the element box, then let the page or frame clip the result.
  const dest = fitInto(sourceWidth, sourceHeight, boxPx(element.box, spec), fit, spec.align);
  const renderWidth = Math.max(1, Math.round(dest.w));
  const renderHeight = Math.max(1, Math.round(dest.h));
  validateDimensions(renderWidth, renderHeight);
  const peakBytes = estimatePeakBytes(sourceWidth, sourceHeight, renderWidth, renderHeight);
  const budget = renderBudget();
  if (peakBytes > budget) {
    throw new Error(`IMAGE_TOO_LARGE: this edit needs about ${Math.ceil(peakBytes / 1_048_576)} MB of working memory, `
      + `and this browser allows ${Math.floor(budget / 1_048_576)} MB. Resize the source down first, or export it on its own.`);
  }
  const sourceX = Math.floor(crop.left * bitmap.width);
  const sourceY = Math.floor(crop.top * bitmap.height);
  const sourcePixels = sourceContext.getImageData(sourceX, sourceY, sourceWidth, sourceHeight);
  const resized = resizeRgba({ width: sourceWidth, height: sourceHeight, data: sourcePixels.data }, renderWidth, renderHeight);
  const resizedCanvas = document.createElement("canvas");
  resizedCanvas.width = renderWidth;
  resizedCanvas.height = renderHeight;
  const imageData = resizedCanvas.getContext("2d")!.createImageData(renderWidth, renderHeight);
  imageData.data.set(resized.data);
  resizedCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
  context.drawImage(resizedCanvas, Math.round(dest.x), Math.round(dest.y));
  context.restore();
}

export type ExportProgress = {
  done: number;
  total: number;
  current: string;
  failed: { name: string; reason: string }[];
};

export const EXPORT_ZIP = "minima-export.zip";

/**
 * Render the queue and return the zip. `onProgress` fires per file, and
 * `shouldStop` is polled between files so Cancel takes effect promptly.
 * A file that cannot be decoded is one skipped entry, not an aborted run.
 */
export async function runExport(
  queue: ExportUnit[],
  spec: FrameSpec,
  naming: { format: Format; quality: number; suffix: string; keepName: boolean; customNames?: Record<number, string>; dpi?: number; maxBytes?: number | null; profile?: "srgb" | "display-p3" | "rec709" },
  onProgress: (progress: ExportProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<{ zip: Uint8Array; progress: ExportProgress; stopped: boolean }> {
  const format = encodableFormat(naming.format);
  // A saved workflow can still pair a byte cap with a lossless format, which
  // the dialog no longer offers. Dropping the cap gives the user their files;
  // honouring it gave them an empty zip and one error per image.
  const maxBytes = format === "png" ? undefined : naming.maxBytes ?? undefined;
  const entries: ZipEntry[] = [];
  const progress: ExportProgress = { done: 0, total: queue.length, current: "", failed: [] };
  const taken = new Set<string>();

  for (const unit of queue) {
    const asset = unit.asset;
    if (shouldStop()) return { zip: makeZip(entries), progress, stopped: true };
    progress.current = asset.name;
    onProgress({ ...progress, failed: [...progress.failed] });
    try {
      if (!asset.file) throw new Error("no source file");
      // The subject is drawn exactly once: in its own place in the stack when
      // the document places it there, and from `element` when it does not -
      // the case where the canvas is a template and this image is being run
      // through it.
      const assetSpec = {
        ...spec, layers: unit.layers, element: unit.element, queuedAssetId: asset.id,
        drawElement: !unit.layers.some((layer) => layer.assetId === asset.id),
      };
      const data = await renderFramed(asset.file, assetSpec, format, naming.quality, { ...naming, maxBytes });
      const custom = naming.customNames?.[asset.id]?.trim();
      let name = custom ? `${custom.replace(/\.[^/.]+$/, "")}.${format}` : outputName({ ...asset, format }, format, naming.suffix, naming.keepName);
      let n = 2;
      while (taken.has(name.toLowerCase())) {
        const dot = name.lastIndexOf(".");
        name = `${name.slice(0, dot)} (${n++})${name.slice(dot)}`;
      }
      taken.add(name.toLowerCase());
      entries.push({ name, data });
    } catch (error) {
      progress.failed.push({ name: asset.name, reason: (error as Error).message || "could not be read" });
    }
    progress.done += 1;
    onProgress({ ...progress, failed: [...progress.failed] });
    // Give the browser a chance to paint progress and receive Cancel between
    // expensive files. The pixel work remains deterministic and sequential.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { zip: makeZip(entries), progress, stopped: false };
}

export { downloadZip };

/* --------------------------------------------------------------------- demo */

export function demo() {
  const finish = begin();
  const spec: FrameSpec = {
    width: 1000, height: 2000, background: "#fff",
    fit: "contain", align: { horizontal: "center", vertical: "center" },
    element: { ...fullPageImage(), box: { ...fullPageImage().box, x: 10, y: 20, w: 80, h: 60 } },
    layers: [],
  };

  const frame = framePx(spec);
  console.assert(frame.x === 100 && frame.y === 400, "the frame origin is percent of each axis");
  console.assert(frame.w === 800 && frame.h === 1200, "and so is its size");
  console.assert(framePx({ ...spec, element: fullPageImage() }).w === 1000, "a full image element spans the canvas");

  // contain fits whole, cover overflows, fill distorts — the same three cases
  // object-fit gives the canvas preview, so the file matches the screen.
  const wide = fitInto(2000, 500, frame, "contain");
  console.assert(wide.w === 800 && wide.h === 200, "contain scales the long edge to the frame");
  console.assert(wide.x === frame.x && wide.y === frame.y + 500, "and centres the letterbox");
  const covered = fitInto(2000, 500, frame, "cover");
  console.assert(covered.h === 1200 && covered.w === 4800, "cover fills the frame");
  console.assert(covered.x < frame.x, "and overflows it evenly, for the clip to cut");
  const filled = fitInto(2000, 500, frame, "fill");
  console.assert(filled.w === frame.w && filled.h === frame.h, "fill matches the frame exactly");
  console.assert(fitInto(0, 0, frame, "contain").w === frame.w, "a degenerate source does not divide by zero");
  const square = fitInto(600, 600, { x: 0, y: 0, w: 300, h: 300 }, "contain");
  console.assert(square.w === 300 && square.x === 0, "a matching ratio needs no offset");

  // Canvas cannot encode TIFF, so the dialog's option has to degrade to PNG
  // rather than produce an empty blob.
  console.assert(encodableFormat("tiff") === "png", "TIFF falls back to PNG");
  console.assert(encodableFormat("jpg") === "jpg", "other formats pass through");
  console.assert(encodableFormat("webp") === "webp", "webp passes through");

  // A frame's content exports through the same pixel geometry as the preview:
  // the frame clips, the content keeps its place inside it.
  const framedPage = { width: 1000, height: 1000 };
  const testFrame = attachImage(createFrame({ x: 25, y: 25, w: 50, h: 50 }), 1, { w: 100, h: 100 }, framedPage);
  const clipRect = boxPx(testFrame.box, framedPage);
  console.assert(clipRect.x === 250 && clipRect.w === 500, "a frame clips to its own page rectangle");
  const contentRect = boxPx(contentPageElement(testFrame).box, framedPage);
  console.assert(contentRect.w === 500 && contentRect.h === 500, "a square image fills a square frame exactly");
  const tall = attachImage(createFrame({ x: 0, y: 0, w: 50, h: 25 }), 1, { w: 100, h: 100 }, framedPage);
  const tallRect = boxPx(contentPageElement(tall).box, framedPage);
  console.assert(tallRect.h === 500 && tallRect.w === 500, "fill keeps the source square and overflows the frame");
  console.assert(tallRect.y === -125, "and the overflow is centred, for the frame to clip");
  console.assert(pageLayers({ ...docFromPreset(presetById("amazon")), frames: [testFrame] }, []).length === 0, "a frame without a decodable file exports nothing");
  // The page preset is Fit, but the frame's content box already carries the
  // source ratio: drawing it with anything but fill would letterbox it twice.
  const fitPage = { ...docFromPreset(presetById("amazon")), frames: [testFrame] };
  const withFile = pageLayers(fitPage, [{ id: 1, file: {} as File, element: fullPageImage(), src: { w: 100, h: 100 } } as Asset]);
  console.assert(withFile.length === 1 && withFile[0].fit === "fill", "frame content exports with fill, whatever the page fit is");
  console.assert(fitInto(100, 100, boxPx(contentPageElement(testFrame).box, framedPage), withFile[0].fit!).w === 500,
    "so the content fills its box instead of shrinking inside it");

  // Layer order is the page's order: free images as they are listed, frames on
  // top, and the image being exported is simply one of them. A free image is
  // on the canvas because the document places it there, not because a flag on
  // the asset says so - an asset is a source, a placement is an appearance.
  const freeAsset = { id: 2, file: {} as File, element: fullPageImage(), src: { w: 10, h: 10 } } as Asset;
  const framedAsset = { id: 1, file: {} as File, element: fullPageImage(), src: { w: 100, h: 100 } } as Asset;
  const placedPage = { ...fitPage, placements: [{ id: "free", assetId: 2, element: fullPageImage() }] };
  const stack = pageLayers(placedPage, [freeAsset, framedAsset]);
  console.assert(stack.length === 2 && stack[0].assetId === 2 && stack[1].assetId === 1, "free images draw below frames");
  console.assert(!stack[0].clip && Boolean(stack[1].clip), "and only the framed layer is clipped");
  console.assert(pageLayers(placedPage, [{ ...freeAsset, corrupt: true }, framedAsset]).length === 1, "an unreadable source is not a layer");
  console.assert(pageLayers(fitPage, [freeAsset, framedAsset]).length === 1,
    "and an asset the document never placed is not a layer at all");

  /* ------------------------------------------- the bicubic path stays bicubic

     `resizeRgba` is separable: horizontal then vertical, so it cannot express
     a rotation.  The contract is that it does the scaling - the part that
     decides quality - and the canvas only ever adds a rigid transform on top.
     An unrotated element must therefore reach the canvas untransformed, or an
     ordinary batch resize would be resampled twice, the second time by the
     browser's own filter, and `resize-parity.test.ts` would have nothing to
     guard.  This is the assertion that keeps that true. */
  const flat = { ...fullPageImage().box, x: 10, y: 20, w: 50, h: 30 };
  const plain = elementTransform(flat, framedPage);
  console.assert(plain.a === 1 && plain.b === 0 && plain.c === 0 && plain.d === 1 && plain.tx === 0 && plain.ty === 0,
    "an axis-aligned element draws through the identity, so the resampler owns every pixel");

  // Rotation and mirrors do reach the file: the editor's geometry is not a
  // preview-only decoration.
  const turned = elementTransform({ ...flat, rotation: 90 }, framedPage);
  console.assert(Math.abs(turned.a) < 1e-12 && Math.abs(turned.b - 1) < 1e-12,
    "a quarter turn reaches the canvas as a real rotation");
  const centre = { x: (flat.x + flat.w / 2) / 100 * framedPage.width, y: (flat.y + flat.h / 2) / 100 * framedPage.height };
  const moved = {
    x: turned.a * centre.x + turned.c * centre.y + turned.tx,
    y: turned.b * centre.x + turned.d * centre.y + turned.ty,
  };
  console.assert(Math.abs(moved.x - centre.x) < 1e-9 && Math.abs(moved.y - centre.y) < 1e-9,
    "and turns the element about its own centre, which therefore does not move");
  const mirrored = elementTransform({ ...flat, flipH: true }, framedPage);
  console.assert(mirrored.a === -1 && mirrored.d === 1, "a horizontal mirror reaches the file as one");

  /* ------------------------------------------------ the stack reaches the file

     A layers panel is a lie if the order it shows is not the order that is
     painted.  These cases are the ones that matter: no arranged stack, which
     every fresh document is; a stack that reverses the default, which is the
     whole point of the panel; and a stack naming something that is gone. */
  const place = (id: string, assetId: number, x = 0) =>
    ({ id, assetId, element: { ...fullPageImage(), box: { ...fullPageImage().box, x, w: 20, h: 20 } } });
  const stackable = { ...fitPage, frames: [testFrame], placements: [place("one", 2)] };
  const stackAssets = [freeAsset, framedAsset];
  console.assert(pageLayers(stackable, stackAssets).map((layer) => layer.assetId).join() === "2,1",
    "with no arranged stack the free image is below the frame, as it always was");
  const lifted = pageLayers({ ...stackable, stack: [frameKey(testFrame.id), placementKey("one")] }, stackAssets);
  console.assert(lifted.map((layer) => layer.assetId).join() === "1,2", "an arranged stack reorders the file too");
  console.assert(Boolean(lifted[0].clip) && !lifted[1].clip, "and each layer keeps its own clipping when it moves");
  console.assert(pageLayers({ ...stackable, stack: ["place-gone", placementKey("one")] }, stackAssets).length === 2,
    "a stack entry for something that is gone does not drop a real layer");

  /* --------------------------------------- one instance per file (\u00a722)

     An image placed three times is three files, and each one shows its own
     copy with the other two hidden - otherwise the three would be identical
     and the extra names would be a lie.  Instances of *other* assets stay:
     they are the template the subject is being placed into. */
  const thrice = {
    ...fitPage, frames: [testFrame],
    placements: [place("a", 2, 0), place("b", 2, 30), place("c", 2, 60)],
  };
  console.assert(pageLayers(thrice, stackAssets).length === 4, "the canvas itself shows all three copies and the frame");
  const first = pageLayers(thrice, stackAssets, placementKey("a"));
  console.assert(first.length === 2, "a file keeps one copy of its own image, and drops the other two");
  console.assert(first.some((layer) => Boolean(layer.clip)), "but keeps the other asset's layer, which is the template");
  // The point of three files is that they differ: each keeps its own copy,
  // in its own position.
  const second = pageLayers(thrice, stackAssets, placementKey("b"));
  console.assert(first.find((layer) => !layer.clip)!.element.box.x === 0, "the first file keeps the first copy");
  console.assert(second.find((layer) => !layer.clip)!.element.box.x === 30, "and the second keeps the second, where it sits");
  console.assert(pageLayers(thrice, stackAssets, frameKey(testFrame.id)).length === 4,
    "a frame's own file is unaffected by copies of a different asset");
  console.assert(pageLayers(thrice, stackAssets, "place-nothing").length === 4,
    "an unknown subject hides nothing rather than emptying the page");

  /* ------------------------------------------------------------ the queue */

  const units = exportUnits(thrice, stackAssets);
  console.assert(units.length === 4, "three placements and one framed image are four files");
  console.assert(units.filter((unit) => unit.asset.id === 2).length === 3, "the thrice-placed image is exported three times");
  // An asset nobody has placed is still exported: the canvas is a template.
  const spare = { id: 7, file: {} as File, element: fullPageImage(), src: { w: 10, h: 10 } } as Asset;
  const withSpare = exportUnits(thrice, [...stackAssets, spare]);
  console.assert(withSpare.length === 5 && withSpare.some((unit) => unit.key === assetKey(7)),
    "an asset with no placement is run through the canvas as a template");
  console.assert(exportUnits(thrice, [{ ...spare, corrupt: true } as Asset]).length === 0,
    "an unreadable source is never a file");
  console.assert(new Set(units.map((unit) => unit.key)).size === units.length, "every unit has its own key");

  /* The rule behind a bug worth remembering.  An asset the document places is
     not *also* exported as a template - it is on the canvas already.  So a
     duplicate that replaces the subject instead of joining it leaves exactly
     one instance, the canvas shows one image, and the export writes one file,
     which is precisely what it did. */
  const solo = exportUnits({ ...fitPage, placements: [place("solo", 2)] }, [freeAsset]);
  console.assert(solo.length === 1, "one placement is one file, not one plus a template copy");
  const pair = exportUnits({ ...fitPage, placements: [place("l", 2, 0), place("r", 2, 40)] }, [freeAsset]);
  console.assert(pair.length === 2, "and two placements are two files");
  console.assert(pair[0].layers.length === 1 && pair[1].layers.length === 1,
    "each of the two draws one copy, so the two files differ");

  console.assert(specFromDoc({ fit: "Fill" } as Doc).fit === "cover", "Fill maps to cover");
  console.assert(specFromDoc({ fit: "Fit" } as Doc).fit === "contain", "Fit maps to contain");
  console.assert(specFromDoc({ fit: "Stretch" } as Doc).fit === "fill", "Stretch maps to fill");

  finish("exportrun.ts");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("exportrun")) demo();
