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
import { downloadZip, makeZip, mimeFor, type OutFormat, type ZipEntry } from "@/src/batch";
import { outputName, type Asset, type Doc, type Format } from "@/src/flow";

export type Rect = { x: number; y: number; w: number; h: number };

/** Everything a render needs, taken from the document. */
export type FrameSpec = {
  width: number;
  height: number;
  background: string;
  /** The placeholder frame, in percent of the canvas. */
  box: Rect;
  fit: "contain" | "cover" | "fill";
  flipH: boolean;
  flipV: boolean;
};

export const specFromDoc = (doc: Doc): FrameSpec => ({
  width: doc.width,
  height: doc.height,
  background: doc.background,
  box: doc.box,
  fit: doc.fit === "Fit" ? "contain" : doc.fit === "Fill" ? "cover" : "fill",
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
export function fitInto(srcW: number, srcH: number, frame: Rect, fit: FrameSpec["fit"]): Rect {
  if (fit === "fill" || srcW <= 0 || srcH <= 0) return { ...frame };
  const scale = fit === "cover"
    ? Math.max(frame.w / srcW, frame.h / srcH)
    : Math.min(frame.w / srcW, frame.h / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: frame.x + (frame.w - w) / 2, y: frame.y + (frame.h - h) / 2, w, h };
}

/** An export's file extension, which TIFF cannot be: canvas cannot encode it. */
export const encodableFormat = (format: Format): OutFormat =>
  (format === "tiff" ? "png" : format);

/* ------------------------------------------------------------------ browser */

export async function renderFramed(file: File, spec: FrameSpec, format: OutFormat, quality: number): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = spec.width;
    canvas.height = spec.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable");

    context.fillStyle = spec.background;
    context.fillRect(0, 0, spec.width, spec.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

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
    const dest = fitInto(bitmap.width, bitmap.height, frame, spec.fit);
    context.drawImage(bitmap, dest.x, dest.y, dest.w, dest.h);
    context.restore();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeFor(format), format === "png" ? undefined : quality / 100));
    if (!blob) throw new Error(`${format.toUpperCase()} encoding failed`);
    return new Uint8Array(await blob.arrayBuffer());
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
  naming: { format: Format; quality: number; suffix: string; keepName: boolean },
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
      const data = await renderFramed(asset.file, spec, format, naming.quality);
      let name = outputName({ ...asset, format }, format, naming.suffix, naming.keepName);
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
    box: { x: 10, y: 20, w: 80, h: 60 }, fit: "contain", flipH: false, flipV: false,
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
