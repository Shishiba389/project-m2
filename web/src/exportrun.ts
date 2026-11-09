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
  assetKey, docFromPreset, elementOf, frameKey, orderStack, outputName, placementKey, presetById,
  type Asset, type Doc, type Format,
} from "@/src/flow";
import { fitInto, fullPageImage, type ImageElement } from "@/src/image-geometry";
import { applyPoint, fromBox, identity, invert } from "@/src/mat3";
import { attachImage, contentPageElement, createFrame } from "@/src/frame-geometry";
import {
  boxPx, compositeOver, elementTransform, renderPage, templateKey, visibleWindow,
  type FrameSpec, type Layer, type LayerCache, type Rect,
} from "@/src/page-render";
import type { ExportReply, ExportRequest } from "@/src/export-worker";

/** The renderer moved to page-render.ts, which a worker can load; re-exported for existing callers. */
export { boxPx, elementTransform, visibleWindow, templateKey, type FrameSpec, type Layer, type Rect };

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
      ? [{ key: frameKey(frame.id), assetId: asset.id, layer: { assetId: asset.id, element: contentPageElement(frame), file: asset.file, clip: frame.box } }]
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
    // Never placed by hand: the page lays it out, the same way the editor does.
    units.push({ key: assetKey(asset.id), asset, element: elementOf(asset, doc), layers: [] });
  }
  // Each file has its own layer list, because each hides a different copy.
  return units.map((unit) => ({ ...unit, layers: pageLayers(doc, assets, unit.key) }));
}

export const specFromDoc = (doc: Doc, assets: Asset[] = []): FrameSpec => ({
  width: doc.width,
  height: doc.height,
  background: doc.background,
  element: fullPageImage(),
  layers: pageLayers(doc, assets),
});

/** An image element's destination box in output pixels. */
export function framePx(spec: FrameSpec): Rect {
  return boxPx(spec.element.box, spec);
}

/** Moved to image-geometry with the rest of the layout maths; re-exported for existing callers. */
export { fitInto };

/** An export's file extension, which TIFF cannot be: canvas cannot encode it. */
export const encodableFormat = (format: Format): OutFormat =>
  (format === "tiff" ? "png" : format);

export type ExportProgress = {
  done: number;
  total: number;
  current: string;
  failed: { name: string; reason: string }[];
};

export const EXPORT_ZIP = "minima-export.zip";

/**
 * Where the pages are rendered: a worker when the platform can draw off
 * screen in one, so the editor keeps responding while a batch exports - a
 * large page used to hold the main thread for most of a second per file -
 * and the main thread otherwise, with the same code and the same pixels.
 */
type Renderer = { render: (request: Omit<ExportRequest, "id">) => Promise<Uint8Array>; close: () => void };

/** The worker itself cannot run here, as opposed to one file failing in it. */
class WorkerUnavailable extends Error {}

function mainThreadRenderer(): Renderer {
  const templates: LayerCache = new Map();
  return {
    render: ({ file, spec, format, quality, metadata }) => renderPage(file, spec, format, quality, metadata, templates),
    close: () => templates.clear(),
  };
}

function workerRenderer(): Renderer {
  const worker = new Worker(new URL("./export-worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();
  let next = 0;
  let broken: Error | null = null;
  const fail = (error: Error) => { for (const job of pending.values()) job.reject(error); pending.clear(); };
  worker.onmessage = (event: MessageEvent<ExportReply>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    const { bytes, error } = event.data;
    if (error === undefined) job.resolve(new Uint8Array(bytes!));
    else job.reject(error.startsWith("CANVAS_UNAVAILABLE") ? new WorkerUnavailable(error) : new Error(error));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    broken = new WorkerUnavailable(event.message || "the export worker could not start");
    fail(broken);
  };
  return {
    render: (request) => new Promise((resolve, reject) => {
      if (broken) { reject(broken); return; }
      const id = next++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ ...request, id } satisfies ExportRequest);
    }),
    close: () => { worker.terminate(); fail(new Error("stopped")); },
  };
}

const STOPPED = Symbol("stopped");
/** `work`, or STOPPED as soon as `shouldStop` says so - checked ten times a second while the worker renders. */
function untilStopped<T>(work: Promise<T>, shouldStop: () => boolean): Promise<T | typeof STOPPED> {
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = new Promise<typeof STOPPED>((resolve) => { timer = setInterval(() => { if (shouldStop()) resolve(STOPPED); }, 100); });
  // Stopping terminates the worker, which rejects `work` after the race is
  // over: that rejection is expected, not an error to report.
  work.catch(() => undefined);
  return Promise.race([work, stop]).finally(() => clearInterval(timer));
}

/**
 * Render the queue and return the zip. `onProgress` fires per file. Cancel
 * stops the file in progress: the worker rendering it is terminated.
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
  const metadata = { dpi: naming.dpi, maxBytes, profile: naming.profile };
  let renderer = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" ? workerRenderer() : mainThreadRenderer();

  try {
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
        const request = { file: asset.file, spec: assetSpec, format, quality: naming.quality, metadata };
        let data: Uint8Array | typeof STOPPED;
        try {
          data = await untilStopped(renderer.render(request), shouldStop);
        } catch (error) {
          if (!(error instanceof WorkerUnavailable)) throw error;
          // No worker here after all: render on this thread from now on.
          renderer.close();
          renderer = mainThreadRenderer();
          data = await renderer.render(request);
        }
        if (data === STOPPED) return { zip: makeZip(entries), progress, stopped: true };
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
      // On the main thread, this is the browser's chance to paint progress and
      // receive Cancel. The pixel work remains deterministic and sequential.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    renderer.close();
  }
  return { zip: makeZip(entries), progress, stopped: false };
}

export { downloadZip };

/* --------------------------------------------------------------------- demo */

export function demo() {
  const finish = begin();
  const spec: FrameSpec = {
    width: 1000, height: 2000, background: "#fff",
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
  // Every layer fills its box - frame content was sized to its source by
  // contentFor, and a free image's box is its picture - so a Fit page cannot
  // letterbox the content a second time.
  console.assert(withFile.length === 1 && boxPx(withFile[0].element.box, framedPage).w === 500,
    "frame content exports at the size of its own box, whatever the page fit is");

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
  // Mirrored *and* turned: the file has to turn the way the screen does. The
  // screen is `fromBox` (CSS rotate() scale()), which mirrors first and then
  // rotates; a corner of the element must land on the same page pixel both ways.
  const both = { ...flat, flipH: true, rotation: 30 };
  const square1000 = { width: 1000, height: 1000 };
  const unrotated = boxPx(both, square1000);
  // The source's top-right corner: (1, 0) in the element's unit square on
  // screen, and the drawn bitmap's top-right pixel in the file.
  const screen = applyPoint(fromBox({ ...both, ...unrotated }), { x: 1, y: 0 });
  const file = applyPoint(elementTransform(both, square1000), { x: unrotated.x + unrotated.w, y: unrotated.y });
  console.assert(Math.abs(screen.x - file.x) < 1e-9 && Math.abs(screen.y - file.y) < 1e-9,
    "a mirrored, rotated element exports turned the same way the editor shows it");

  /* ------------------------------------------- only what reaches the page

     A picture zoomed far past the page is resampled only where the page can
     show it. The resampler guarantees the window's pixels are the whole
     picture's (resize-core.test.ts); this is which window. */
  const page = { width: 1000, height: 2000 };
  const inside = { x: 100, y: 200, w: 500, h: 400 };
  console.assert(JSON.stringify(visibleWindow(inside, identity(), page)) === JSON.stringify({ x: 0, y: 0, width: 500, height: 400 }),
    "a picture on the page is rendered whole");
  const zoomed = { x: -5000, y: -3000, w: 20_000, h: 15_000 };
  console.assert(JSON.stringify(visibleWindow(zoomed, identity(), page)) === JSON.stringify({ x: 5000, y: 3000, width: 1000, height: 2000 }),
    "a 300-megapixel zoom renders only the page it covers - exactly, with no margin");
  console.assert(visibleWindow({ x: 1200, y: 0, w: 300, h: 300 }, identity(), page) === null, "a picture off the page is not rendered at all");
  const half = visibleWindow({ x: -250, y: 1900, w: 500, h: 500 }, identity(), page)!;
  console.assert(half.x === 250 && half.y === 0 && half.width === 250 && half.height === 100, "a picture half off a corner keeps the corner");
  // Turned 45 degrees about its centre, the page's corners sweep a larger
  // square of the picture, and the canvas filter needs a pixel either side.
  const turnedBox = { ...fullPageImage().box, x: -150, y: -100, w: 400, h: 300, rotation: 45 };
  const turnedRender = boxPx(turnedBox, page);
  const turnedWindow = visibleWindow({ x: turnedRender.x, y: turnedRender.y, w: turnedRender.w, h: turnedRender.h },
    elementTransform(turnedBox, page), page)!;
  for (const corner of [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 2000 }, { x: 1000, y: 2000 }]) {
    const local = applyPoint(invert(elementTransform(turnedBox, page))!, corner);
    console.assert(local.x - turnedRender.x >= turnedWindow.x + 1 && local.x - turnedRender.x <= turnedWindow.x + turnedWindow.width - 1
      && local.y - turnedRender.y >= turnedWindow.y + 1 && local.y - turnedRender.y <= turnedWindow.y + turnedWindow.height - 1,
      "a turned picture keeps every pixel the page's corners reach, with a margin for the filter");
  }
  console.assert(turnedWindow.width * turnedWindow.height < turnedRender.w * turnedRender.h, "and still far less than all of it");

  // A template layer is resampled once per run, so its key must name every
  // input of its pixels - and nothing else, or nothing would ever be reused.
  const logo = { assetId: 7, element: { ...fullPageImage(), box: { ...fullPageImage().box, x: 5, w: 20, h: 10 } } };
  const pageSpec = { width: 1000, height: 2000 };
  console.assert(templateKey(logo, pageSpec) === templateKey({ ...logo, element: structuredClone(logo.element) }, pageSpec),
    "the same template layer on the next file is a cache hit");
  console.assert(templateKey(logo, pageSpec) === templateKey(logo, { ...pageSpec, resampling: "classic" }), "classic is the default resampler");
  console.assert(new Set([
    templateKey(logo, pageSpec),
    templateKey({ ...logo, assetId: 8 }, pageSpec),
    templateKey({ ...logo, element: { ...logo.element, box: { ...logo.element.box, x: 6 } } }, pageSpec),
    templateKey(logo, { width: 1000, height: 2001 }),
    templateKey(logo, { ...pageSpec, resampling: "high" }),
  ]).size === 5, "a different source, place, page or resampler is a different layer");

  /* ------------------------------------------- the page, composited exactly

     A canvas premultiplies and rounds every partly transparent pixel. The
     page is composited here instead, so what the resampler wrote is what
     the file holds. */
  const rgba = (width: number, height: number, pixels: number[]) => ({ width, height, data: Uint8ClampedArray.from(pixels) });
  const blank = () => rgba(3, 2, new Array(24).fill(0));
  const faint = rgba(2, 1, [200, 100, 50, 1, 7, 9, 250, 3]);
  const onClear = blank();
  compositeOver(onClear, faint, 1, 1);
  console.assert([...onClear.data.slice(16, 24)].join() === "200,100,50,1,7,9,250,3",
    "on a transparent page every byte lands as it is - even at alpha 1, where a canvas keeps no colour at all");
  console.assert(onClear.data.slice(0, 16).every((value) => value === 0), "and nothing lands outside the picture");
  const red = rgba(1, 1, [255, 0, 0, 128]);
  const blue = rgba(1, 1, [0, 0, 255, 255]);
  compositeOver(blue, red, 0, 0);
  console.assert([...blue.data].join() === "128,0,127,255", "over an opaque pixel it is ordinary source-over");
  // A canvas clip is hard-edged: a pixel is in when its centre is (measured
  // in Chrome: a rect from 10.5 to 26 keeps pixels 10 to 25). So is this one.
  const strip = rgba(4, 1, new Array(16).fill(0));
  compositeOver(strip, rgba(4, 1, new Array(16).fill(200)), 0, 0, { x: 0.5, y: 0.25, w: 1.9, h: 0.5 });
  console.assert([...strip.data].filter((_, i) => i % 4 === 3).join() === "200,200,0,0",
    "a clip edge through a pixel keeps it whole when it holds the centre, and drops it otherwise");
  const off = blank();
  compositeOver(off, rgba(2, 2, new Array(16).fill(255)), -1, -1);
  console.assert(off.data[3] === 255 && off.data[7] === 0 && off.data[15] === 0, "a picture hanging off the page is cut at its edge");

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

  // An image nobody has placed by hand is laid out by the page, so it follows
  // the page when the page changes - the export reads the same layout.
  const untouched = { ...spare, element: null, src: { w: 1600, h: 1000 } } as Asset;
  const onAmazon = exportUnits({ ...fitPage, placements: [], frames: [] }, [untouched])[0].element.box;
  console.assert(Math.abs(onAmazon.w - 100) < 1e-9 && Math.abs(onAmazon.h - 62.5) < 1e-9 && Math.abs(onAmazon.y - 18.75) < 1e-9,
    "an untouched wide image is fitted to the page and centred");

  finish("exportrun.ts");
}

if (typeof process !== "undefined" && process.argv?.[1]?.includes("exportrun")) demo();
