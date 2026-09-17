/**
 * Batch convert — its own pipeline, independent of the editor.
 *
 * The editor positions one image at a time on a canvas and keeps the result in
 * app state. Batch takes the files the user dropped, re-encodes every one, and
 * hands back a zip the browser downloads. Nothing here touches the editor's
 * Doc, preset list or selection.
 *
 * There is deliberately no target geometry: the resize rules are being built
 * as their own engine, so batch does the part that needs no geometry —
 * format, naming, folder structure — and each image keeps its own pixel size.
 *
 * Everything above `renderOne` is pure and checked by `demo()`.
 */

import { begin } from "@/src/selfcheck";
import { encodeOutput } from "@/src/output-engine";
import { estimatePeakBytes, resizeRgba, validateDimensions } from "@/src/resize-core";

export type OutFormat = "png" | "jpg" | "webp";

export type BatchOutput = {
  width: number;
  height: number;
  format: OutFormat;
  /** 1-100, ignored for PNG. */
  quality: number;
  suffix: string;
  /** Flatten subfolders into the zip root instead of preserving them. */
  flatten: boolean;
  dpi: number;
  maxBytes: number | null;
  jpegBackground: string;
};

export type BatchSource = {
  id: number;
  /** File name without any folders. */
  name: string;
  /** Folder-relative path from the picker, e.g. "shoes/blue/a.png". */
  path: string;
  bytes: number;
  file: File;
  width?: number;
  height?: number;
  error?: string;
  thumbnail?: Blob;
  /** Almost nothing of this image is visible against a white page. */
  faint?: boolean;
};

// Nothing is resized in this pass, so the default suffix must not claim it was.
export const defaultOutput: BatchOutput = {
  width: 1801, height: 2600, format: "png", quality: 92, suffix: "_resized", flatten: false,
  dpi: 72, maxBytes: null, jpegBackground: "#ffffff",
};

const IMAGE_PATTERN = /\.(png|jpe?g|webp|avif|gif|bmp|tiff?)$/i;

/* ------------------------------------------------------------------ sources */

/** Read a file picker or drop into batch sources, keeping folder structure. */
export function toSources(files: File[], startId = 1): BatchSource[] {
  return files
    .filter((file) => IMAGE_PATTERN.test(file.name))
    .map((file, index) => {
      const raw = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      return {
        id: startId + index,
        name: file.name,
        path: normalisePath(raw),
        bytes: file.size,
        file,
      };
    });
}

/**
 * Whether an image would be invisible on a white page: transparent, white, or
 * near enough to white that its edges cannot be seen. The editor uses this to
 * put a checkerboard behind the layer while it is selected.
 *
 * A product shot on a white background is mostly invisible pixels too, so the
 * bar is high: only an image that is almost entirely invisible counts, which a
 * subject covering any real part of the frame will not reach.
 */
const INVISIBLE_ALPHA = 16;
const INVISIBLE_LUMA = 244;
export function isFaint(pixels: Uint8ClampedArray, threshold = 0.85) {
  const total = Math.floor(pixels.length / 4);
  if (!total) return false;
  let invisible = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    if (pixels[at + 3] < INVISIBLE_ALPHA) { invisible += 1; continue; }
    const luma = 0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2];
    if (luma > INVISIBLE_LUMA) invisible += 1;
  }
  return invisible / total >= threshold;
}

/** Sample the decoded image small; the answer is a statistic, not a picture. */
async function faintnessOf(bitmap: ImageBitmap, edge = 32) {
  const width = Math.max(1, Math.min(edge, bitmap.width));
  const height = Math.max(1, Math.min(edge, bitmap.height));
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement("canvas"), { width, height });
  const context = (canvas as HTMLCanvasElement).getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(bitmap, 0, 0, width, height);
  return isFaint(context.getImageData(0, 0, width, height).data);
}

async function thumbnailOf(bitmap: ImageBitmap, maxEdge = 320) {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
  }
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas is unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("thumbnail encoding failed")), "image/webp", 0.82));
}

/** Read dimensions and make small previews with bounded decode concurrency. */
export async function inspectSources(sources: BatchSource[], concurrency = Math.min(4, Math.max(2,
  Math.floor((typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4) / 2))),
  onProgress: (done: number, total: number) => void = () => {}): Promise<BatchSource[]> {
  const results = new Array<BatchSource>(sources.length);
  let cursor = 0;
  let done = 0;
  const inspect = async () => {
    while (true) {
      const index = cursor++; if (index >= sources.length) return;
      const source = sources[index];
    try {
      const bitmap = await createImageBitmap(source.file, { imageOrientation: "from-image" });
      try {
        let thumbnail: Blob | undefined;
        try { thumbnail = await thumbnailOf(bitmap); } catch { /* Preview failure must not invalidate a decodable source. */ }
        let faint = false;
        try { faint = await faintnessOf(bitmap); } catch { /* The locator is a hint; failing to sample is not an import error. */ }
        results[index] = { ...source, width: bitmap.width, height: bitmap.height, thumbnail, faint };
      } finally { bitmap.close?.(); }
    } catch (error) { results[index] = { ...source, error: (error as Error).message || "could not decode image" }; }
      onProgress(++done, sources.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, inspect));
  return results;
}

function normalisePath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/");
}

/** What the fork dialog reports, so the user knows what they just dropped. */
export function summarise(sources: BatchSource[]) {
  const folders = new Set<string>();
  for (const source of sources) {
    const at = source.path.lastIndexOf("/");
    if (at > 0) folders.add(source.path.slice(0, at));
  }
  return {
    images: sources.length,
    folders: folders.size,
    nested: [...folders].some((folder) => folder.includes("/")),
    bytes: sources.reduce((total, source) => total + source.bytes, 0),
  };
}

/* -------------------------------------------------------------------- naming */

/** The path each source is written to inside the zip. */
export function planNames(sources: BatchSource[], output: BatchOutput): Map<number, string> {
  const extension = output.format === "jpg" ? "jpg" : output.format;
  const taken = new Set<string>();
  const plan = new Map<number, string>();

  for (const source of sources) {
    const folder = output.flatten ? "" : source.path.slice(0, Math.max(0, source.path.lastIndexOf("/") + 1));
    const dot = source.name.lastIndexOf(".");
    const stem = dot > 0 ? source.name.slice(0, dot) : source.name;
    let candidate = `${folder}${stem}${output.suffix}.${extension}`;
    // Flattening can collide two same-named files from different folders.
    let n = 2;
    while (taken.has(candidate.toLowerCase())) {
      candidate = `${folder}${stem}${output.suffix} (${n++}).${extension}`;
    }
    taken.add(candidate.toLowerCase());
    plan.set(source.id, candidate);
  }
  return plan;
}

export const mimeFor = (format: OutFormat) =>
  format === "png" ? "image/png" : format === "jpg" ? "image/jpeg" : "image/webp";

/**
 * Rough output size, for the estimate shown before a run. Each image keeps its
 * own dimensions, so the estimate follows the sources rather than one target.
 */
export function estimateBytes(sources: BatchSource[], output: BatchOutput) {
  return sources.reduce((total, source) => {
    // A source byte count is the best proxy available before decoding.
    const ratio = output.format === "png" ? 1.15 : (0.12 + (output.quality / 100) * 0.5);
    return total + source.bytes * ratio;
  }, 0);
}

export function planConcurrency(sources: BatchSource[], output: BatchOutput, memoryBudget = 512 * 1024 * 1024, logical = 4) {
  validateDimensions(output.width, output.height);
  const largest = Math.max(1, ...sources.map((source) => estimatePeakBytes(
    source.width ?? output.width, source.height ?? output.height, output.width, output.height)));
  return Math.max(1, Math.min(4, Math.floor(logical / 2) || 1, Math.floor(memoryBudget / largest) || 1));
}

function renderInWorker(source: BatchSource, output: BatchOutput): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./batch-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ bytes?: ArrayBuffer; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(new Uint8Array(event.data.bytes!));
    };
    worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "worker failed")); };
    worker.postMessage({ id: source.id, file: source.file, output });
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/* ----------------------------------------------------------------------- zip */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; data: Uint8Array };

/**
 * Store-only zip. PNG, JPG and WEBP are already compressed, so deflating them
 * again buys almost nothing and would mean pulling in a compression library.
 */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts = entries.map((entry) => ({
    name: encoder.encode(entry.name),
    data: entry.data,
    crc: crc32(entry.data),
  }));

  const localSize = parts.reduce((total, part) => total + 30 + part.name.length + part.data.length, 0);
  const centralSize = parts.reduce((total, part) => total + 46 + part.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const offsets: number[] = [];

  for (const part of parts) {
    offsets.push(at);
    view.setUint32(at, 0x04034b50, true);
    view.setUint16(at + 4, 20, true);      // version needed
    view.setUint16(at + 6, 0x0800, true);  // UTF-8 names
    view.setUint16(at + 8, 0, true);       // stored
    view.setUint16(at + 10, 0, true);      // time
    view.setUint16(at + 12, 0, true);      // date
    view.setUint32(at + 14, part.crc, true);
    view.setUint32(at + 18, part.data.length, true);
    view.setUint32(at + 22, part.data.length, true);
    view.setUint16(at + 26, part.name.length, true);
    view.setUint16(at + 28, 0, true);      // extra
    at += 30;
    out.set(part.name, at); at += part.name.length;
    out.set(part.data, at); at += part.data.length;
  }

  const centralStart = at;
  parts.forEach((part, index) => {
    view.setUint32(at, 0x02014b50, true);
    view.setUint16(at + 4, 20, true);      // version made by
    view.setUint16(at + 6, 20, true);      // version needed
    view.setUint16(at + 8, 0x0800, true);
    view.setUint16(at + 10, 0, true);
    view.setUint16(at + 12, 0, true);
    view.setUint16(at + 14, 0, true);
    view.setUint32(at + 16, part.crc, true);
    view.setUint32(at + 20, part.data.length, true);
    view.setUint32(at + 24, part.data.length, true);
    view.setUint16(at + 28, part.name.length, true);
    view.setUint16(at + 30, 0, true);      // extra
    view.setUint16(at + 32, 0, true);      // comment
    view.setUint16(at + 34, 0, true);      // disk
    view.setUint16(at + 36, 0, true);      // internal attrs
    view.setUint32(at + 38, 0, true);      // external attrs
    view.setUint32(at + 42, offsets[index], true);
    at += 46;
    out.set(part.name, at); at += part.name.length;
  });

  view.setUint32(at, 0x06054b50, true);
  view.setUint16(at + 4, 0, true);
  view.setUint16(at + 6, 0, true);
  view.setUint16(at + 8, parts.length, true);
  view.setUint16(at + 10, parts.length, true);
  view.setUint32(at + 12, centralSize, true);
  view.setUint32(at + 16, centralStart, true);
  view.setUint16(at + 20, 0, true);
  return out;
}

/* ------------------------------------------------------------------ browser */

/** Decode, EXIF-orient and resize one source with MINIMA's exact pixel core. */
export async function renderOne(source: BatchSource, output: BatchOutput): Promise<Uint8Array> {
  validateDimensions(output.width, output.height);
  const bitmap = await createImageBitmap(source.file, { imageOrientation: "from-image" });
  try {
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = bitmap.width; sourceCanvas.height = bitmap.height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext) throw new Error("2D canvas is unavailable");
    sourceContext.drawImage(bitmap, 0, 0);
    const sourcePixels = sourceContext.getImageData(0, 0, bitmap.width, bitmap.height);
    const resized = resizeRgba({ width: bitmap.width, height: bitmap.height, data: sourcePixels.data }, output.width, output.height);
    const canvas = document.createElement("canvas");
    canvas.width = output.width; canvas.height = output.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable");
    const imageData = context.createImageData(output.width, output.height); imageData.data.set(resized.data);
    if (output.format === "jpg") {
      const rgba = document.createElement("canvas"); rgba.width = output.width; rgba.height = output.height;
      rgba.getContext("2d")!.putImageData(imageData, 0, 0);
      context.fillStyle = output.jpegBackground; context.fillRect(0, 0, output.width, output.height);
      context.drawImage(rgba, 0, 0);
    } else context.putImageData(imageData, 0, 0);
    return encodeOutput(canvas, {
      format: output.format, quality: output.quality,
      dpi: { x: output.dpi, y: output.dpi }, maxBytes: output.maxBytes ?? undefined,
    });
  } finally {
    bitmap.close?.();
  }
}

export type BatchProgress = {
  done: number;
  total: number;
  current: string;
  failed: { name: string; reason: string }[];
};

/**
 * Resize every source and return a deterministic zip. Parallelism follows the
 * MINIMA memory estimate and is capped at four jobs.
 */
export async function runBatch(
  sources: BatchSource[],
  output: BatchOutput,
  onProgress: (progress: BatchProgress) => void,
  shouldStop: () => boolean = () => false,
): Promise<{ zip: Uint8Array; progress: BatchProgress; stopped: boolean }> {
  validateDimensions(output.width, output.height);
  const names = planNames(sources, output);
  const completed = new Map<number, ZipEntry>();
  const progress: BatchProgress = { done: 0, total: sources.length, current: "", failed: [] };
  const perf = performance as Performance & { memory?: { jsHeapSizeLimit: number } };
  const budget = Math.floor((perf.memory?.jsHeapSizeLimit ?? 1024 * 1024 * 1024) / 2);
  const concurrency = planConcurrency(sources, output, budget, navigator.hardwareConcurrency || 4);
  const renderer = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" ? renderInWorker : renderOne;
  let cursor = 0;
  const execute = async () => {
    while (!shouldStop()) {
      const index = cursor++; if (index >= sources.length) return;
      const source = sources[index]; progress.current = source.path;
      onProgress({ ...progress, failed: [...progress.failed] });
      try {
        const peak = estimatePeakBytes(source.width ?? output.width, source.height ?? output.height, output.width, output.height);
        if (peak > budget) throw new Error(`LOW_MEMORY_PATH_UNAVAILABLE: estimated peak ${formatBytes(peak)} exceeds browser budget ${formatBytes(budget)}`);
        completed.set(index, { name: names.get(source.id)!, data: await renderer(source, output) });
      }
      catch (error) { progress.failed.push({ name: source.path, reason: (error as Error).message || "could not be read" }); }
      progress.done += 1; onProgress({ ...progress, failed: [...progress.failed] });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, execute));
  const entries = [...completed.entries()].sort((a, b) => a[0] - b[0]).map((row) => row[1]);
  return { zip: makeZip(entries), progress, stopped: shouldStop() && progress.done < progress.total };
}

/** Hand the finished zip to the browser's downloader. */
export function downloadZip(zip: Uint8Array, filename = "minima-batch.zip") {
  const url = URL.createObjectURL(new Blob([zip as unknown as BlobPart], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* --------------------------------------------------------------------- demo */

export function demo() {
  const finish = begin();
  const file = (name: string, path = name, bytes = 1000) =>
    ({ id: 0, name, path, bytes, file: null as unknown as File }) as BatchSource;

  // Naming: folders preserved or flattened, collisions resolved, extension swapped.
  const sources = [
    { ...file("a.png", "shoes/a.png"), id: 1 },
    { ...file("a.png", "bags/a.png"), id: 2 },
    { ...file("b.jpg", "b.jpg"), id: 3 },
  ];
  const kept = planNames(sources, { ...defaultOutput, format: "webp" });
  console.assert(kept.get(1) === "shoes/a_resized.webp", "the subfolder is preserved");
  console.assert(kept.get(2) === "bags/a_resized.webp", "a same-named file in another folder keeps its own path");
  console.assert(kept.get(3) === "b_resized.webp", "a root file stays at the root");
  const flat = planNames(sources, { ...defaultOutput, flatten: true });
  console.assert(flat.get(1) === "a_resized.png", "flattening drops the folder");
  console.assert(flat.get(2) === "a_resized (2).png", "and resolves the collision it creates");
  console.assert(planNames(sources, { ...defaultOutput, suffix: "" }).get(3) === "b.png", "an empty suffix is allowed");
  console.assert(planNames(sources, { ...defaultOutput, format: "jpg" }).get(3) === "b_resized.jpg", "jpg maps to a .jpg extension");
  console.assert(planConcurrency([{ ...file("a.png"), width: 100, height: 100 }], { ...defaultOutput, width: 50, height: 50 }, 1e9, 8) === 4, "pool caps at four");

  // Summary: folder count and nesting, for the fork dialog.
  const summary = summarise([
    { ...file("a.png", "shoes/blue/a.png", 10) },
    { ...file("b.png", "shoes/blue/b.png", 20) },
    { ...file("c.png", "bags/c.png", 30) },
    { ...file("d.png", "d.png", 40) },
  ]);
  console.assert(summary.images === 4, "every image is counted");
  console.assert(summary.folders === 2, "folders are counted once each");
  console.assert(summary.nested === true, "nesting is reported");
  console.assert(summary.bytes === 100, "sizes add up");
  console.assert(summarise([file("a.png")]).folders === 0, "a bare file reports no folder");

  // CRC32 against the well-known values, since the zip is unreadable if it is wrong.
  const bytes = (text: string) => new TextEncoder().encode(text);
  console.assert(crc32(bytes("")) === 0, "crc32 of empty is 0");
  console.assert(crc32(bytes("a")) === 0xe8b7be43, "crc32('a')");
  console.assert(crc32(bytes("hello")) === 0x3610a686, "crc32('hello')");
  console.assert(crc32(bytes("123456789")) === 0xcbf43926, "crc32('123456789')");

  // Zip structure: signatures, counts and the central-directory offset.
  const zip = makeZip([{ name: "a.txt", data: bytes("hello") }, { name: "d/b.txt", data: bytes("x") }]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  console.assert(view.getUint32(0, true) === 0x04034b50, "starts with a local file header");
  const eocd = zip.byteLength - 22;
  console.assert(view.getUint32(eocd, true) === 0x06054b50, "ends with the end-of-central-directory record");
  console.assert(view.getUint16(eocd + 10, true) === 2, "both entries are recorded");
  const centralStart = view.getUint32(eocd + 16, true);
  console.assert(view.getUint32(centralStart, true) === 0x02014b50, "the central directory starts where EOCD says");
  console.assert(view.getUint32(eocd + 12, true) === eocd - centralStart, "the recorded central-directory size matches its span");
  console.assert(makeZip([]).byteLength === 22, "an empty zip is just the EOCD");
  // The first entry's stored size must match what we put in.
  console.assert(view.getUint32(18, true) === 5, "the stored size is the payload size");
  console.assert(view.getUint32(14, true) === crc32(bytes("hello")), "the local header carries the payload crc");

  console.assert(formatBytes(512) === "512 B", "bytes stay bytes");
  console.assert(formatBytes(2048) === "2.0 KB", "kilobytes get one decimal");
  console.assert(formatBytes(5 * 1024 * 1024) === "5.0 MB", "megabytes too");
  console.assert(estimateBytes(sources, defaultOutput) > 0, "an estimate is produced");
  console.assert(
    estimateBytes(sources, { ...defaultOutput, format: "jpg", quality: 50 })
    < estimateBytes(sources, defaultOutput),
    "a lossy format estimates smaller than png",
  );
  console.assert(estimateBytes([], defaultOutput) === 0, "no sources estimate nothing");
  console.assert(
    estimateBytes(sources, { ...defaultOutput, format: "jpg", quality: 100 })
    > estimateBytes(sources, { ...defaultOutput, format: "jpg", quality: 40 }),
    "higher quality estimates larger",
  );

  // A transparent or white image needs a locator; a real subject does not.
  const pixels = (count: number, rgba: [number, number, number, number]) =>
    Uint8ClampedArray.from(Array.from({ length: count * 4 }, (_, at) => rgba[at % 4]));
  const join = (...parts: Uint8ClampedArray[]) => {
    const out = new Uint8ClampedArray(parts.reduce((n, part) => n + part.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };
  console.assert(isFaint(pixels(100, [0, 0, 0, 0])), "a fully transparent image is faint");
  console.assert(isFaint(pixels(100, [255, 255, 255, 255])), "so is a white one");
  console.assert(!isFaint(pixels(100, [12, 12, 12, 255])), "a dark image is not");
  console.assert(isFaint(pixels(100, [250, 250, 250, 120])), "a near-white wash is invisible on a white page, whatever its alpha");
  console.assert(!isFaint(pixels(100, [230, 230, 230, 255])), "a light grey still reads against white");
  // 30 % subject on white: the edges are invisible, the image is not.
  console.assert(!isFaint(join(pixels(30, [20, 20, 20, 255]), pixels(70, [255, 255, 255, 255]))), "a product on white keeps its own locator off");
  // 10 % subject: almost nothing to see, so the checkerboard earns its place.
  console.assert(isFaint(join(pixels(10, [20, 20, 20, 255]), pixels(90, [255, 255, 255, 255]))), "an almost empty page is faint");
  console.assert(!isFaint(new Uint8ClampedArray(0)), "an empty sample is never faint");

  finish("batch.ts");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("batch")) demo();
