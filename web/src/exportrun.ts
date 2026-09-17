/**
 * The editor's export, for real.
 *
 * The dialog used to show an "Output folder" of C:\Products\MINIMA_Output and
 * run a timer that invented progress and invented failures. A browser cannot
 * write to a local path, so the only honest output is a download: every queued
 * image is rendered at the document's canvas size, into the document's
 * placeholder frame, then zipped.
 *
 * This is the editor's geometry, which the user set by hand — not the batch
 * target framing, which is being built as its own engine.
 */
import { begin } from "@/src/selfcheck";
import { downloadZip, makeZip, type OutFormat, type ZipEntry } from "@/src/batch";
import { outputName, type Asset, type Doc, type Format, type ImagePlacement } from "@/src/flow";
import { resizeRgba } from "@/src/resize-core";
import { encodeOutput } from "@/src/output-engine";

export type Rect = { x: number; y: number; w: number; h: number };

/** Everything a render needs, taken from the document. */
export type FrameSpec = {
  width: number;
  height: number;
  background: string;
  /** The placeholder frame, in percent of the canvas. */
  box: Rect;
  fit: "contain" | "cover" | "fill";
  align: { horizontal: "left" | "center" | "right"; vertical: "top" | "center" | "bottom" };
  flipH: boolean;
  flipV: boolean;
  placement?: ImagePlacement;
};

export const specFromDoc = (doc: Doc): FrameSpec => ({
  width: doc.width,
  height: doc.height,
  background: doc.background,
  box: doc.box,
  fit: doc.fit === "Fit" ? "contain" : doc.fit === "Fill" ? "cover" : "fill",
  align: {
    horizontal: doc.align?.includes("left") ? "left" : doc.align?.includes("right") ? "right" : "center",
    vertical: doc.align?.includes("top") ? "top" : doc.align?.includes("bottom") ? "bottom" : "center",
  },
  flipH: doc.flipH,
  flipV: doc.flipV,
});

/** The placeholder frame in canvas pixels. */
export function framePx(spec: FrameSpec): Rect {
  return {
    x: (spec.box.x / 100) * spec.width,
    y: (spec.box.y / 100) * spec.height,
    w: (spec.box.w / 100) * spec.width,
    h: (spec.box.h / 100) * spec.height,
  };
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

/* ------------------------------------------------------------------ browser */

export async function renderFramed(file: File, spec: FrameSpec, format: OutFormat, quality: number,
  metadata: { dpi?: number; maxBytes?: number | null; profile?: "srgb" | "display-p3" | "rec709" } = {}): Promise<Uint8Array> {
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

    const frame = framePx(spec);
    context.save();
    // The frame is a crop window, so anything Cover pushes past it is clipped.
    context.beginPath();
    context.rect(frame.x, frame.y, frame.w, frame.h);
    context.clip();
    if (spec.flipH || spec.flipV) {
      const cx = frame.x + frame.w / 2;
      const cy = frame.y + frame.h / 2;
      context.translate(cx, cy);
      context.scale(spec.flipH ? -1 : 1, spec.flipV ? -1 : 1);
      context.translate(-cx, -cy);
    }
    const baseDest = fitInto(bitmap.width, bitmap.height, frame, spec.fit, spec.align);
    const placement = spec.placement ?? { x: 0, y: 0, scale: 1 };
    const dest = {
      w: baseDest.w * placement.scale, h: baseDest.h * placement.scale,
      x: baseDest.x + (baseDest.w - baseDest.w * placement.scale) / 2 + placement.x / 100 * spec.width,
      y: baseDest.y + (baseDest.h - baseDest.h * placement.scale) / 2 + placement.y / 100 * spec.height,
    };
    const renderWidth = Math.max(1, Math.round(dest.w));
    const renderHeight = Math.max(1, Math.round(dest.h));
    const sourcePixels = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
    const resized = resizeRgba({ width: bitmap.width, height: bitmap.height, data: sourcePixels.data }, renderWidth, renderHeight);
    const resizedCanvas = document.createElement("canvas");
    resizedCanvas.width = renderWidth;
    resizedCanvas.height = renderHeight;
    const imageData = resizedCanvas.getContext("2d")!.createImageData(renderWidth, renderHeight);
    imageData.data.set(resized.data);
    resizedCanvas.getContext("2d")!.putImageData(imageData, 0, 0);
    context.drawImage(resizedCanvas, Math.round(dest.x), Math.round(dest.y));
    context.restore();

    return encodeOutput(canvas, {
      format, quality, dpi: metadata.dpi ? { x: metadata.dpi, y: metadata.dpi } : undefined,
      maxBytes: metadata.maxBytes ?? undefined,
    });
  } finally {
    bitmap.close?.();
  }
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
  queue: Asset[],
  spec: FrameSpec,
  naming: { format: Format; quality: number; suffix: string; keepName: boolean; customNames?: Record<number, string>; dpi?: number; maxBytes?: number | null; profile?: "srgb" | "display-p3" | "rec709" },
  onProgress: (progress: ExportProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<{ zip: Uint8Array; progress: ExportProgress; stopped: boolean }> {
  const format = encodableFormat(naming.format);
  const entries: ZipEntry[] = [];
  const progress: ExportProgress = { done: 0, total: queue.length, current: "", failed: [] };
  const taken = new Set<string>();

  for (const asset of queue) {
    if (shouldStop()) return { zip: makeZip(entries), progress, stopped: true };
    progress.current = asset.name;
    onProgress({ ...progress, failed: [...progress.failed] });
    try {
      if (!asset.file) throw new Error("no source file");
      const assetSpec = { ...spec, ...(asset.layout ? { box: asset.layout.frame } : {}), placement: asset.placement };
      const data = await renderFramed(asset.file, assetSpec, format, naming.quality, naming);
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
  }
  return { zip: makeZip(entries), progress, stopped: false };
}

export { downloadZip };

/* --------------------------------------------------------------------- demo */

export function demo() {
  const finish = begin();
  const spec: FrameSpec = {
    width: 1000, height: 2000, background: "#fff",
    box: { x: 10, y: 20, w: 80, h: 60 }, fit: "contain",
    align: { horizontal: "center", vertical: "center" }, flipH: false, flipV: false,
  };

  const frame = framePx(spec);
  console.assert(frame.x === 100 && frame.y === 400, "the frame origin is percent of each axis");
  console.assert(frame.w === 800 && frame.h === 1200, "and so is its size");
  console.assert(framePx({ ...spec, box: { x: 0, y: 0, w: 100, h: 100 } }).w === 1000, "a full frame is the whole canvas");

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

  console.assert(specFromDoc({ fit: "Fill" } as Doc).fit === "cover", "Fill maps to cover");
  console.assert(specFromDoc({ fit: "Fit" } as Doc).fit === "contain", "Fit maps to contain");
  console.assert(specFromDoc({ fit: "Stretch" } as Doc).fit === "fill", "Stretch maps to fill");

  finish("exportrun.ts");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("exportrun")) demo();
