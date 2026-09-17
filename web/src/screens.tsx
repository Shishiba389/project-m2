import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronLeft, ChevronRight, Cloud, Copy, FileImage, FolderOpen, Grid2X2, Layers3,
  ListFilter, Package, Pencil, Plus, Search, Share2, Trash2, TriangleAlert, Upload, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  HANDLES, megabytes, presetById, ratioLabel, resolutionOf,
  statusOf, warningReason,
  type Asset, type Doc, type DupPolicy, type Format, type GalleryFilter, type Handle,
  type Preset, type Resolution, type Status, type WarningReason,
} from "@/src/flow";
import { cropImage, fullCrop, fullPageImage, localResizeDelta, moveCrop, moveImage, nudgeImage, resizeCrop, resizeImage, rotateImage, type CropRect, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { frameAt, frameFromDrag, type FrameElement } from "@/src/frame-geometry";

export type Guides = { grid: boolean; rulers: boolean; snapGrid: boolean; snapSafe: boolean };
export const defaultGuides: Guides = { grid: true, rulers: true, snapGrid: true, snapSafe: true };

export type CompareView = "split" | "before" | "after";
export type EditorTool = "image" | "crop" | "canvas" | "frame";
export type FrameSelection = { id: string; editing: boolean };

/** Document-space box to CSS. Percentages are of the nearest positioned layer. */
export const boxStyle = (box: ImageBox): React.CSSProperties => ({
  left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
  transform: `rotate(${box.rotation}deg) scale(${box.flipH ? -1 : 1}, ${box.flipV ? -1 : 1})`,
});
/** Frame boxes reuse the image geometry functions, which take an ImageElement. */
const asElement = (frame: FrameElement): ImageElement => ({ box: frame.box, crop: null });
/** Frames resize freely; holding Shift locks the ratio for the duration. */
const ratioLocked = (frame: FrameElement, locked: boolean): ImageElement =>
  ({ box: { ...frame.box, lockedRatio: locked }, crop: null });
/**
 * A white or fully transparent image is invisible against a white page, so the
 * selected layer gets a checkerboard behind it. The flag is measured from the
 * decoded pixels at import, not guessed from the file's format.
 */
const needsLocator = (asset: Asset) => asset.faint === true;

export type Theme = "light" | "dark" | "system";

const STATUS_FILTERS: ("All" | Status)[] = ["All", "Completed", "Pending", "Warning", "Error"];
const FORMATS: Format[] = ["png", "jpg", "webp", "tiff"];
const RESOLUTIONS: Resolution[] = ["large", "medium", "small"];
const ERROR_TYPES: [WarningReason | "corrupt", string][] = [["aspect", "Aspect ratio"], ["safe", "Safe area"], ["corrupt", "Corrupted"]];

export function ProductPlaceholder({ kind, large = false }: { kind: Asset["kind"]; large?: boolean }) {
  const label = kind === "shoe" ? "FOOTWEAR" : kind === "beauty" ? "BEAUTY" : kind === "fashion" ? "APPAREL" : "FRAGRANCE";
  return <div className={`product-placeholder product-${kind} ${large ? "product-large" : ""}`} aria-label="Product image placeholder"><Package aria-hidden="true" strokeWidth={1.25} /><span>{label}</span></div>;
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>
    {status === "Completed" && <Check size={12} />}
    {status === "Warning" && <TriangleAlert size={12} />}
    {status === "Error" && <span aria-hidden="true">✕</span>}
    {status === "Pending" && <span className="status-dot" />}
    {status}
  </span>;
}

const metaLine = (asset: Asset) => `${asset.src.w} × ${asset.src.h} px · ${megabytes(asset).toFixed(1)} MB`;

/**
 * The real image wherever there is a file behind the asset. Imports carry one;
 * anything else falls back to the stand-in rather than rendering a broken img.
 */
export function AssetImage({ asset, fit, large, style }: { asset: Asset; fit?: "contain" | "cover" | "fill"; large?: boolean; style?: React.CSSProperties }) {
  const source = large ? asset.url : asset.thumbnailUrl ?? asset.url;
  if (!source) return <ProductPlaceholder kind={asset.kind} large={large} />;
  return <img className="asset-image" src={source} alt="" draggable={false}
    loading={large ? "eager" : "lazy"} decoding="async"
    style={{ ...(fit ? { objectFit: fit } : {}), ...style }} />;
}

const objectPositionFor = (align: Doc["align"]) => `${align.includes("left") ? "left" : align.includes("right") ? "right" : "center"} ${align.includes("top") ? "top" : align.includes("bottom") ? "bottom" : "center"}`;

function CroppedAssetImage({ asset, fit, crop, align, large }: { asset: Asset; fit: "contain" | "cover" | "fill"; crop: CropRect | null; align: Doc["align"]; large?: boolean }) {
  const rect = crop ?? fullCrop();
  const width = rect.right - rect.left; const height = rect.bottom - rect.top;
  return <div className="crop-viewport"><AssetImage asset={asset} fit={fit} large={large} style={{
    position: "absolute", width: `${100 / width}%`, height: `${100 / height}%`, maxWidth: "none",
    left: `${-rect.left / width * 100}%`, top: `${-rect.top / height * 100}%`,
    objectPosition: objectPositionFor(align),
  }} /></div>;
}

const objectFitFor = (fit: Doc["fit"]) => (fit === "Fit" ? "contain" : fit === "Fill" ? "cover" : "fill");

/* -------------------------------------------------------------------- import */

export function ImportScreen({ policy, onPolicy, onFiles, onFolders, onCloud, onDrop }: {
  policy: DupPolicy; onPolicy: (value: DupPolicy) => void;
  onFiles: () => void; onFolders: () => void; onCloud: () => void; onDrop: (files: FileList) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return <div className="import-pane"
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); onDrop(event.dataTransfer.files); }}>
    <div className="import-card">
      <header className="import-intro">
        <h1>Start a resize batch</h1>
        <p>Drop a folder of product shots in. Everything lands in the Gallery, where a
          preset applies one set of rules to the whole batch.</p>
      </header>

      <button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={onFiles}>
        <span className="drop-icon"><FolderOpen aria-hidden="true" /><Upload aria-hidden="true" /></span>
        <strong>Drop images here</strong>
        <span>or browse your computer</span>
        <span className="drop-formats">PNG · JPG · WEBP · TIFF</span>
      </button>

      <div className="import-actions">
        <Button onClick={onFiles}><Upload /> Add files…</Button>
        <Button variant="secondary" onClick={onFolders}><FolderOpen /> Add folders…</Button>
        <Button variant="secondary" onClick={onCloud}><Cloud /> Import from cloud…</Button>
      </div>

      <label className="policy-row">
        <span>If a filename already exists</span>
        <Select value={policy} onValueChange={(value) => onPolicy(value as DupPolicy)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="skip">Skip (default)</SelectItem>
            <SelectItem value="overwrite">Overwrite</SelectItem>
            <SelectItem value="rename">Rename</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <ol className="import-steps">
        {[["Select", "in the Gallery"], ["Resize", "with a preset"], ["Review", "what needs attention"], ["Export", "the batch"]]
          .map(([step, hint], index) => <li key={step}><span>{index + 1}</span><strong>{step}</strong><em>{hint}</em></li>)}
      </ol>
    </div>
  </div>;
}

/* ------------------------------------------------------------------- gallery */

export function Gallery({ assets, total, selected, counts, filter, zoom, needsAttention, target, onFilter, onChoose, onOpen, onReview, onRemove }: {
  assets: Asset[]; total: number; selected: number[]; counts: Record<string, number>; filter: GalleryFilter; zoom: number;
  needsAttention: number; target: Preset;
  onFilter: (next: GalleryFilter) => void;
  onChoose: (asset: Asset, multi?: boolean, range?: boolean) => void;
  onOpen: (asset: Asset) => void; onReview: () => void;
  onRemove: (keepSelected: boolean) => void;
}) {
  // The top-bar zoom drives grid density here (Engine spec §24). The 112px base
  // came from a downscaled reference screenshot and truncated every filename.
  const columnWidth = Math.round(168 * (zoom / 100));
  const facets = filter.formats.length + filter.resolutions.length + filter.errorTypes.length;
  const [visibleLimit, setVisibleLimit] = useState(120);
  useEffect(() => setVisibleLimit(120), [filter, assets.length]);
  const shownAssets = assets.slice(0, visibleLimit);
  const selectedSet = new Set(selected);
  const toggle = <T,>(list: T[], value: T) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  return <div className="content-pane gallery-pane">
    <div className="gallery-toolbar">
      <div className="filter-tabs">{STATUS_FILTERS.map((item) =>
        <button key={item} className={filter.status === item ? "active" : ""} onClick={() => onFilter({ ...filter, status: item })}>{item}<span>{counts[item]}</span></button>)}
      </div>
      <div className="toolbar-tools">
        {/* Panel 8: one funnel menu for every facet plus the sort order. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant={facets ? "secondary" : "ghost"} aria-label="Filter and sort"><ListFilter />{facets > 0 && <span className="facet-count">{facets}</span>}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="funnel-menu">
            <DropdownMenuLabel>Format</DropdownMenuLabel>
            {FORMATS.map((format) => <DropdownMenuCheckboxItem key={format} checked={filter.formats.includes(format)}
              onCheckedChange={() => onFilter({ ...filter, formats: toggle(filter.formats, format) })}>{format.toUpperCase()}</DropdownMenuCheckboxItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Resolution</DropdownMenuLabel>
            {RESOLUTIONS.map((resolution) => <DropdownMenuCheckboxItem key={resolution} checked={filter.resolutions.includes(resolution)}
              onCheckedChange={() => onFilter({ ...filter, resolutions: toggle(filter.resolutions, resolution) })}>
              {resolution[0].toUpperCase() + resolution.slice(1)}
            </DropdownMenuCheckboxItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Error type</DropdownMenuLabel>
            {ERROR_TYPES.map(([value, label]) => <DropdownMenuCheckboxItem key={value} checked={filter.errorTypes.includes(value)}
              onCheckedChange={() => onFilter({ ...filter, errorTypes: toggle(filter.errorTypes, value) })}>{label}</DropdownMenuCheckboxItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={filter.sort} onValueChange={(value) => onFilter({ ...filter, sort: value as GalleryFilter["sort"] })}>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {facets > 0 && <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onFilter({ ...filter, formats: [], resolutions: [], errorTypes: [] })}>Clear {facets} filter{facets === 1 ? "" : "s"}</DropdownMenuItem>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="search-box">
          <Search aria-hidden="true" />
          <span className="sr-only">Search images</span>
          <input value={filter.query} onChange={(event) => onFilter({ ...filter, query: event.target.value })} placeholder="Search files…" />
        </label>
        {needsAttention > 0 && <Button size="sm" variant="secondary" onClick={onReview}><TriangleAlert /> Review {needsAttention}</Button>}
      </div>
    </div>
    <p className="gallery-summary">
      {counts.All} images · {counts.Completed} completed · {counts.Pending} pending · {needsAttention} need attention · preset {target.label}
    </p>
    <div className="asset-grid" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${columnWidth}px,1fr))` }}>
      {shownAssets.map((asset) => {
        const status = statusOf(asset, target);
        const isSelected = selectedSet.has(asset.id);
        return <ContextMenu key={asset.id}>
          <ContextMenuTrigger asChild>
            <article role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`${asset.name}, ${status}`}
              className={`asset-card ${isSelected ? "selected" : ""}`}
              onClick={(event) => onChoose(asset, event.ctrlKey || event.metaKey, event.shiftKey)}
              onDoubleClick={() => onOpen(asset)}
              onContextMenu={() => { if (!isSelected) onChoose(asset); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); onOpen(asset); }
                if (event.key === " ") { event.preventDefault(); onChoose(asset, event.ctrlKey || event.metaKey, event.shiftKey); }
              }}>
              <AssetImage asset={asset} fit="cover" />
              <div className="asset-card-footer">
                <span className="asset-name">{asset.name}</span>
                <span className="asset-meta">{metaLine(asset)}</span>
                <StatusBadge status={status} />
              </div>
              {isSelected && <span className="selection-check"><Check /></span>}
            </article>
          </ContextMenuTrigger>
          {/* Panel 1: bulk removal lives on the thumbnail menu. */}
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onOpen(asset)}>Open in editor</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => onRemove(false)}>Remove selected ({selected.length})</ContextMenuItem>
            <ContextMenuItem onSelect={() => onRemove(true)}>Remove unselected ({total - selected.length})</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onRemove(false)}><Trash2 /> Remove (move to Trash)</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>;
      })}
      {!assets.length && <p className="gallery-empty">No images match this filter.</p>}
    </div>
    {shownAssets.length < assets.length && <div className="gallery-more">
      <Button variant="secondary" onClick={() => setVisibleLimit((value) => value + 120)}>
        Load 120 more <span>{shownAssets.length} / {assets.length}</span>
      </Button>
    </div>}
  </div>;
}

/* -------------------------------------------------------------------- editor */

export function ContextualToolbar({ mode, onMode, element, fit, onFit, onReplace, onElement, onCropStart, onCropDone, onCropCancel, onCropReset, onToggleGrid, grid, className = "" }: {
  mode: EditorTool; onMode: (mode: EditorTool) => void; element: ImageElement; fit: Doc["fit"];
  onFit: (fit: Doc["fit"]) => void; onReplace: () => void; onElement: (element: ImageElement) => void;
  onCropStart: () => void; onCropDone: () => void; onCropCancel: () => void; onCropReset: () => void;
  onToggleGrid: () => void; grid: boolean; className?: string;
}) {
  const [showMore, setShowMore] = useState(false);
  const enterCrop = () => { onCropStart(); onMode("crop"); };
  const selectMode = (next: EditorTool) => {
    // Leaving Crop through a mode switch is an explicit commit. Cancel remains
    // the only route that discards the session baseline.
    if (mode === "crop" && next !== "crop") onCropDone();
    onMode(next);
  };
  return <div className={`contextual-toolbar ${className}`} role="toolbar" aria-label="Selected image actions">
    <div className="toolbar-segment" role="group" aria-label="Edit mode">
      <button className={mode === "image" ? "active" : ""} aria-pressed={mode === "image"} onClick={() => selectMode("image")}>Edit image</button>
      <button onClick={onReplace}>Replace</button>
      <button className={mode === "crop" ? "active" : ""} aria-pressed={mode === "crop"} onClick={enterCrop}>Crop</button>
      <button className={mode === "frame" ? "active" : ""} aria-pressed={mode === "frame"} title="Drag on the canvas to draw a frame" onClick={() => onMode(mode === "frame" ? "image" : "frame")}>Add frame</button>
      <button className={mode === "canvas" ? "active" : ""} aria-pressed={mode === "canvas"} onClick={() => selectMode("canvas")}>Canvas</button>
    </div>
    {mode === "image" && <><div className="toolbar-segment" role="group" aria-label="Image fill mode">
      {(["Fit", "Fill", "Stretch"] as const).map((next) => <button key={next} className={fit === next ? "active" : ""} aria-pressed={fit === next} onClick={() => onFit(next)}>{next}</button>)}
    </div><div className="toolbar-segment" role="group" aria-label="Transform image">
      <button aria-label="Scale image down" title="Scale down" onClick={() => onElement(resizeImage(element, "se", -8, -8))}>−</button><button aria-label="Scale image up" title="Scale up" onClick={() => onElement(resizeImage(element, "se", 8, 8))}>+</button>
      <button onClick={() => onElement(rotateImage(element, element.box.rotation - 15))}>Rotate left</button><button onClick={() => onElement(rotateImage(element, element.box.rotation + 15))}>Rotate right</button>
      <button aria-expanded={showMore} onClick={() => setShowMore((value) => !value)}>More</button>
    </div>{showMore && <div className="toolbar-segment" role="group" aria-label="Advanced image actions">
      <button aria-pressed={element.box.flipH} onClick={() => onElement({ ...element, box: { ...element.box, flipH: !element.box.flipH } })}>Flip H</button><button aria-pressed={element.box.flipV} onClick={() => onElement({ ...element, box: { ...element.box, flipV: !element.box.flipV } })}>Flip V</button>
      <button aria-pressed={element.box.lockedRatio} onClick={() => onElement({ ...element, box: { ...element.box, lockedRatio: !element.box.lockedRatio } })}>Lock ratio</button><button onClick={() => onElement(fullPageImage())}>Reset</button>
    </div>}</>}
    {mode === "crop" && <div className="toolbar-segment" role="group" aria-label="Crop actions"><button onClick={onCropReset}>Reset crop</button><button onClick={() => { onCropCancel(); onMode("image"); }}>Cancel</button><button onClick={() => { onCropDone(); onMode("image"); }}>Done</button></div>}
    {mode === "canvas" && <div className="toolbar-segment" role="group" aria-label="Canvas actions"><button aria-pressed={grid} onClick={onToggleGrid}>Grid</button></div>}
  </div>;
}

export function Editor({ asset, assets, selected, doc, zoom, compare, compareView, splitAt, overlay, guides, target, onElement, onElementAction, onElementStart, onElementEnd, onCropStart, onCropDone, onCropCancel, onCropReset, onSplit, onChoose, onImport, onDrop, onFit, onToggleGrid, onStep, focusMode = false, editMode = "image", cropActive = false,
  canvasAssets, frameSelection = null, onFrameAdd = () => {}, onFrameWrite = () => {}, onFrameGestureStart = () => {},
  onFrameGestureEnd = () => {}, onFrameSelect = () => {}, onFrameContentEdit = () => {}, onFrameContentDone = () => {},
  onFrameContentCancel = () => {}, onFrameDelete = () => {}, onFrameRefit = () => {}, onFrameReset = () => {}, onFrameDetach = () => {},
  onFrameAttach = () => {}, onSelectAsset = () => {} }: {
  asset: Asset; assets: Asset[]; selected: number[]; doc: Doc; zoom: number;
  compare: boolean; compareView: CompareView; splitAt: number; overlay: number; guides: Guides; target: Preset;
  onElement: (element: ImageElement) => void; onElementAction: (element: ImageElement) => void; onElementStart: () => void; onElementEnd: () => void; onCropStart: () => void; onCropDone: () => void; onCropCancel: () => void; onCropReset: () => void; onSplit: (value: number) => void; onChoose: (asset: Asset) => void;
  onImport: () => void; onDrop: (files: FileList, drop?: { frameId?: string; at?: { x: number; y: number } }) => void; onFit: (fit: Doc["fit"]) => void;
  onToggleGrid: () => void; onStep: (delta: number) => void;
  focusMode?: boolean;
  editMode?: EditorTool;
  cropActive?: boolean;
  /** Free image layers on the page. Defaults to the active image alone. */
  canvasAssets?: Asset[];
  frameSelection?: FrameSelection | null;
  onFrameAdd?: (box: { x: number; y: number; w: number; h: number }) => void;
  /** `live` writes without a history entry, for the duration of a gesture. */
  onFrameWrite?: (frame: FrameElement, live?: boolean) => void;
  onFrameGestureStart?: () => void;
  onFrameGestureEnd?: () => void;
  onFrameSelect?: (id: string | null) => void;
  onFrameContentEdit?: (id: string) => void;
  onFrameContentDone?: () => void;
  onFrameContentCancel?: () => void;
  onFrameDelete?: (id: string) => void;
  onFrameRefit?: (id: string, mode: "fill" | "fit") => void;
  /** Restore the content to the state this edit session started from. */
  onFrameReset?: () => void;
  onFrameDetach?: (id: string) => void;
  onFrameAttach?: (frameId: string, assetId: number) => void;
  onSelectAsset?: (asset: Asset) => void;
}) {
  const [normalMode, setNormalMode] = useState<EditorTool>("image");
  const activeMode = focusMode ? editMode : normalMode;
  const canvasRef = useRef<HTMLDivElement>(null);
  const activeThumb = useRef<HTMLButtonElement>(null);
  const activeIndex = assets.findIndex((item) => item.id === asset.id);
  const stripAssets = assets.slice(Math.max(0, activeIndex - 30), Math.min(assets.length, activeIndex + 31));
  const selectedSet = new Set(selected);
  // Paging past the visible thumbs should bring the new one into view.
  useEffect(() => {
    activeThumb.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [asset.id]);
  useEffect(() => {
    if (!cropActive && normalMode === "crop") setNormalMode("image");
  }, [cropActive, normalMode]);
  const splitRef = useRef<HTMLDivElement>(null);
  const imageDrag = useRef<{ x: number; y: number; element: ImageElement } | null>(null);
  const imageResize = useRef<{ handle: Handle; x: number; y: number; element: ImageElement } | null>(null);
  const imageRotate = useRef<{ angle: number; rotation: number; element: ImageElement } | null>(null);
  const cropGesture = useRef<{ mode: "move" | Handle; x: number; y: number; crop: CropRect } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const frameDrag = useRef<{ x: number; y: number; frame: FrameElement } | null>(null);
  const frameResize = useRef<{ handle: Handle; x: number; y: number; frame: FrameElement } | null>(null);
  const frameRotate = useRef<{ angle: number; rotation: number; frame: FrameElement } | null>(null);
  const contentDrag = useRef<{ x: number; y: number; frame: FrameElement } | null>(null);
  const contentResize = useRef<{ handle: Handle; x: number; y: number; frame: FrameElement } | null>(null);
  const [newFrame, setNewFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** True while a content drag is outside its frame: releasing there detaches. */
  const [detachArmed, setDetachArmed] = useState(false);
  const frameCreate = useRef<{ x: number; y: number } | null>(null);

  const element = asset.element;
  const crop = element.crop ?? fullCrop();
  const placeElement = (next: ImageElement) => onElement(next);
  const handleImageResize = (event: React.PointerEvent) => {
    const state = imageResize.current; const rect = canvasRef.current?.getBoundingClientRect();
    if (!state || !rect) return;
    const delta = localResizeDelta(state.element, (event.clientX - state.x) / rect.width * 100, (event.clientY - state.y) / rect.height * 100);
    placeElement(resizeImage(state.element, state.handle, delta.dx, delta.dy, event.shiftKey));
  };
  const angleToElementCentre = (event: React.PointerEvent, image: ImageElement) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = rect.left + (image.box.x + image.box.w / 2) / 100 * rect.width;
    const y = rect.top + (image.box.y + image.box.h / 2) / 100 * rect.height;
    return Math.atan2(event.clientY - y, event.clientX - x) * 180 / Math.PI;
  };
  const cropProps = (mode: "move" | Handle) => ({
    onPointerDown: (event: React.PointerEvent) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); cropGesture.current = { mode, x: event.clientX, y: event.clientY, crop }; },
    onPointerMove: (event: React.PointerEvent) => {
      const state = cropGesture.current; const rect = canvasRef.current?.getBoundingClientRect();
      if (!state || !rect) return;
      const pageDelta = localResizeDelta(element, (event.clientX - state.x) / rect.width * 100, (event.clientY - state.y) / rect.height * 100);
      const dx = pageDelta.dx / element.box.w; const dy = pageDelta.dy / element.box.h;
      const next = state.mode === "move" ? moveCrop(state.crop, dx, dy) : resizeCrop(state.crop, state.mode, dx, dy);
      placeElement(cropImage(element, next));
    },
    onPointerUp: () => { cropGesture.current = null; }, onPointerCancel: () => { cropGesture.current = null; },
  });

  const canvasStyle = { aspectRatio: `${doc.width} / ${doc.height}`, transform: `scale(${zoom / 100})` };

  const imageStyle = boxStyle(element.box);

  /* ---------------------------------------------------------------- frames */

  const frames = doc.frames;
  const layers = canvasAssets ?? [asset];
  const framedAsset = (frame: FrameElement) => assets.find((item) => item.id === frame.imageId) ?? null;
  const selectedFrame = frames.find((frame) => frame.id === frameSelection?.id) ?? null;
  const editingContent = Boolean(selectedFrame && frameSelection?.editing && selectedFrame.content);
  // A frame owns the selection while it is active, so the free-image overlay steps aside.
  const imageActive = activeMode === "image" && !selectedFrame;

  /** Pointer travel since a gesture started, in percentages of the page. */
  const pageDelta = (event: React.PointerEvent, from: { x: number; y: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { dx: (event.clientX - from.x) / rect.width * 100, dy: (event.clientY - from.y) / rect.height * 100 };
  };
  const pagePoint = (event: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 };
  };
  /**
   * Moving, resizing or rotating the frame itself is one document transaction
   * per gesture, so releasing the pointer commits it.
   */
  const endFrameGesture = () => {
    frameDrag.current = null; frameResize.current = null; frameRotate.current = null;
    onFrameGestureEnd();
  };
  /**
   * Dragging the image inside a frame is part of the open content session, not
   * a transaction of its own: committing here would consume the session's
   * snapshot and leave Esc with nothing to discard.
   */
  const endContentGesture = (event: React.PointerEvent) => {
    const dragged = contentDrag.current?.frame;
    contentDrag.current = null; contentResize.current = null;
    if (!dragged || !detachArmed) { setDetachArmed(false); return; }
    setDetachArmed(false);
    // Released outside its frame: the image leaves the frame and stays on the
    // canvas exactly where it was dropped.
    const point = pagePoint(event);
    if (point && !frameAt([dragged], point.x, point.y)) onFrameDetach(dragged.id);
  };
  const moveFrameGesture = (event: React.PointerEvent) => {
    const drag = frameDrag.current;
    if (drag) {
      const delta = pageDelta(event, drag);
      if (delta) onFrameWrite({ ...drag.frame, box: { ...drag.frame.box, x: drag.frame.box.x + delta.dx, y: drag.frame.box.y + delta.dy } }, true);
      return;
    }
    const resize = frameResize.current;
    if (resize) {
      const delta = pageDelta(event, resize);
      if (!delta) return;
      const local = localResizeDelta(asElement(resize.frame), delta.dx, delta.dy);
      // Resizing a frame re-clips it; the image inside keeps its own transform.
      // A frame resizes freely, and Shift constrains it to its current ratio.
      onFrameWrite({ ...resize.frame, box: resizeImage(ratioLocked(resize.frame, event.shiftKey), resize.handle, local.dx, local.dy, false).box }, true);
      return;
    }
    const rotate = frameRotate.current;
    if (rotate) {
      const next = rotate.rotation + angleToBoxCentre(event, rotate.frame.box) - rotate.angle;
      onFrameWrite({ ...rotate.frame, box: rotateImage(asElement(rotate.frame), event.shiftKey ? Math.round(next / 15) * 15 : next).box }, true);
      return;
    }
    const content = contentDrag.current;
    if (content && content.frame.content) {
      const delta = pageDelta(event, content);
      if (!delta) return;
      // Page percentages become frame percentages; the frame box never moves.
      onFrameWrite({ ...content.frame, content: moveImage(content.frame.content, delta.dx / content.frame.box.w * 100, delta.dy / content.frame.box.h * 100) }, true);
      const point = pagePoint(event);
      setDetachArmed(Boolean(point && !frameAt([content.frame], point.x, point.y)));
      return;
    }
    const scale = contentResize.current;
    if (scale && scale.frame.content) {
      const delta = pageDelta(event, scale);
      if (!delta) return;
      const local = localResizeDelta(scale.frame.content, delta.dx / scale.frame.box.w * 100, delta.dy / scale.frame.box.h * 100);
      onFrameWrite({ ...scale.frame, content: resizeImage(scale.frame.content, scale.handle, local.dx, local.dy, event.shiftKey) }, true);
    }
  };
  const angleToBoxCentre = (event: React.PointerEvent, box: ImageBox) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const x = rect.left + (box.x + box.w / 2) / 100 * rect.width;
    const y = rect.top + (box.y + box.h / 2) / 100 * rect.height;
    return Math.atan2(event.clientY - y, event.clientX - x) * 180 / Math.PI;
  };
  const nudgeFrame = (event: React.KeyboardEvent, frame: FrameElement) => {
    const amount = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
    const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
    if (!dx && !dy) return false;
    event.preventDefault();
    onFrameWrite({ ...frame, box: { ...frame.box, x: frame.box.x + dx, y: frame.box.y + dy } });
    return true;
  };

  const frameLayer = (frame: FrameElement) => {
    const inside = framedAsset(frame);
    return <div key={frame.id} className="frame-layer" style={boxStyle(frame.box)}>
      {inside && frame.content
        ? <div className="frame-content" style={boxStyle(frame.content.box)}>
            <CroppedAssetImage asset={inside} fit="fill" crop={frame.content.crop} align={doc.align} large />
          </div>
        : <div className="frame-placeholder"><FileImage aria-hidden="true" /><span>Drop image here</span></div>}
    </div>;
  };
  const resized = <div ref={canvasRef} className="canvas-scene" style={canvasStyle}>
    <div className="canvas page-canvas" style={{ background: doc.background }}>
      {guides.grid && <div className="canvas-grid" aria-hidden="true" />}
      <div className="safe-area" style={{ inset: `${doc.safeY}% ${doc.safeX}%` }} />
      {/* This is the page's visual output boundary. It intentionally clips only
          the page render, never the selectable image above it. */}
      <div className="page-render-clip" aria-hidden="true">
        {layers.map((layer) => <div key={layer.id} className="page-render-image" style={boxStyle(layer.element.box)}>
          <CroppedAssetImage asset={layer} fit={objectFitFor(doc.fit)} crop={layer.element.crop} align={doc.align} large />
        </div>)}
        {frames.map(frameLayer)}
      </div>
    </div>
    <div className={`selection-overlay ${imageActive ? "image-mode" : ""} ${activeMode === "crop" ? "crop-mode" : ""} ${activeMode === "frame" ? "frame-mode" : ""}`} role="group" aria-label={`Selected image ${asset.name}`}
      onPointerDown={(event) => {
        if (activeMode === "frame") {
          const point = pagePoint(event);
          if (!point) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          frameCreate.current = point; setNewFrame({ ...point, w: 0, h: 0 });
          return;
        }
        if (selectedFrame) { if (editingContent) onFrameContentDone(); onFrameSelect(null); }
      }}
      onPointerMove={(event) => {
        const start = frameCreate.current;
        if (!start) return;
        const point = pagePoint(event);
        if (point) setNewFrame(frameFromDrag(start.x, start.y, point.x, point.y).box);
      }}
      onPointerUp={() => {
        const box = newFrame;
        frameCreate.current = null; setNewFrame(null);
        // A click without a drag still gets a usable frame rather than nothing.
        if (box) onFrameAdd(box.w < 2 || box.h < 2 ? { x: box.x, y: box.y, w: 30, h: 30 } : box);
        if (activeMode === "frame") setNormalMode("image");
      }}>
      {selectedFrame && activeMode !== "frame" && <div className="deselect-catcher" aria-hidden="true"
        onPointerDown={() => { if (editingContent) onFrameContentDone(); onFrameSelect(null); }} />}
      {newFrame && <div className="frame-draft" style={boxStyle({ ...newFrame, rotation: 0, flipH: false, flipV: false, lockedRatio: false })} aria-hidden="true" />}
      {/* Unselected layers are click targets only; the selected one gets handles. */}
      {layers.filter((layer) => layer.id !== asset.id).map((layer) => <button key={layer.id} type="button" className="layer-hit"
        style={boxStyle(layer.element.box)} aria-label={`Select image ${layer.name}`} title={layer.name}
        onPointerDown={(event) => { event.stopPropagation(); onSelectAsset(layer); }} />)}
      {frames.filter((frame) => frame.id !== frameSelection?.id).map((frame) => <button key={frame.id} type="button"
        className={`layer-hit frame-hit ${frame.imageId === null ? "empty" : ""}`} style={boxStyle(frame.box)}
        aria-label={frame.imageId === null ? "Select empty frame" : `Select frame containing ${framedAsset(frame)?.name ?? "an image"}`}
        onPointerDown={(event) => { event.stopPropagation(); if (editingContent) onFrameContentDone(); onFrameSelect(frame.id); }}
        onDoubleClick={() => frame.imageId !== null && onFrameContentEdit(frame.id)} />)}
      {selectedFrame && !editingContent && <div className="frame-selection" style={boxStyle(selectedFrame.box)} tabIndex={0}
        role="group" aria-roledescription="frame" aria-label={selectedFrame.imageId === null ? "Empty frame" : `Frame containing ${framedAsset(selectedFrame)?.name ?? "an image"}`}
        onKeyDown={(event) => {
          if (nudgeFrame(event, selectedFrame)) return;
          if (event.key === "Enter" && selectedFrame.imageId !== null) { event.preventDefault(); onFrameContentEdit(selectedFrame.id); }
          if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); onFrameDelete(selectedFrame.id); }
        }}
        onDoubleClick={() => selectedFrame.imageId !== null && onFrameContentEdit(selectedFrame.id)}
        onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onFrameGestureStart(); frameDrag.current = { x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
        onPointerMove={moveFrameGesture} onPointerUp={endFrameGesture} onPointerCancel={endFrameGesture}>
        <div className="frame-outline" aria-hidden="true" />
        <span className="layer-label">{selectedFrame.imageId === null ? "Empty frame" : "Frame"}</span>
        {HANDLES.map((handle) => <button key={handle} type="button" className={`frame-handle handle-${handle}`}
          aria-label={`Resize frame from ${handle}`} title={`Resize frame from ${handle}`}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onFrameGestureStart(); frameResize.current = { handle, x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
          onPointerMove={moveFrameGesture} onPointerUp={endFrameGesture} onPointerCancel={endFrameGesture}
          onKeyDown={(event) => {
            const amount = event.shiftKey ? 5 : 1;
            const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
            const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
            if (!dx && !dy) return;
            event.preventDefault();
            onFrameWrite({ ...selectedFrame, box: resizeImage(ratioLocked(selectedFrame, event.shiftKey), handle, dx, dy, false).box });
          }} />)}
        <button type="button" className="rotation-handle" aria-label={`Rotate frame, ${Math.round(selectedFrame.box.rotation)} degrees`} title="Rotate frame"
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onFrameGestureStart(); frameRotate.current = { angle: angleToBoxCentre(event, selectedFrame.box), rotation: selectedFrame.box.rotation, frame: selectedFrame }; }}
          onPointerMove={moveFrameGesture} onPointerUp={endFrameGesture} onPointerCancel={endFrameGesture} />
      </div>}
      {selectedFrame && !editingContent && <div className="frame-actions" role="group" aria-label="Frame actions">
        {selectedFrame.imageId === null
          ? <><Button size="sm" variant="secondary" onClick={onImport}><Upload /> Add image</Button>
              {asset.id !== 0 && <Button size="sm" variant="secondary" onClick={() => onFrameAttach(selectedFrame.id, asset.id)}>Place {asset.name}</Button>}</>
          : <><Button size="sm" variant="secondary" onClick={() => onFrameContentEdit(selectedFrame.id)}>Edit content</Button>
              <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fill")}>Fill</Button>
              <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fit")}>Fit</Button>
              <Button size="sm" variant="secondary" onClick={() => onFrameDetach(selectedFrame.id)}>Detach</Button></>}
        <Button size="sm" variant="secondary" onClick={() => onFrameDelete(selectedFrame.id)}><Trash2 /> Delete frame</Button>
      </div>}
      {/* Edit content: the frame is frozen, the image shows in full, and
          everything outside the frame is dimmed rather than clipped. */}
      {selectedFrame && editingContent && selectedFrame.content && <div className="content-edit" style={boxStyle(selectedFrame.box)}>
        <div className="content-edit-image" style={boxStyle(selectedFrame.content.box)} tabIndex={0}
          role="group" aria-roledescription="frame content" aria-label={`Position ${framedAsset(selectedFrame)?.name ?? "image"} inside its frame`}
          onKeyDown={(event) => {
            const amount = event.shiftKey ? 5 : 1;
            const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
            const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
            if (!dx && !dy) return;
            event.preventDefault();
            onFrameWrite({ ...selectedFrame, content: moveImage(selectedFrame.content!, dx, dy) }, true);
          }}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); contentDrag.current = { x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
          onPointerMove={moveFrameGesture} onPointerUp={endContentGesture} onPointerCancel={endContentGesture}>
          {framedAsset(selectedFrame) && <CroppedAssetImage asset={framedAsset(selectedFrame)!} fit="fill" crop={selectedFrame.content.crop} align={doc.align} large />}
          {HANDLES.map((handle) => <button key={handle} type="button" className={`frame-handle handle-${handle}`}
            aria-label={`Scale content from ${handle}`} title={`Scale content from ${handle}`}
            onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); contentResize.current = { handle, x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
            onPointerMove={moveFrameGesture} onPointerUp={endContentGesture} onPointerCancel={endContentGesture} />)}
        </div>
        <div className="content-edit-mask" aria-hidden="true" />
        <span className={`layer-label ${detachArmed ? "detach-armed" : ""}`}>{detachArmed ? "Release to detach" : "Frame content"}</span>
      </div>}
      {selectedFrame && editingContent && <div className="frame-actions" role="group" aria-label="Frame content actions">
        <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fill")}>Fill</Button>
        <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fit")}>Fit</Button>
        <Button size="sm" variant="secondary" onClick={onFrameReset}>Reset</Button>
        <Button size="sm" variant="secondary" onClick={onFrameContentCancel}>Cancel</Button>
        <Button size="sm" onClick={onFrameContentDone}><Check /> Done</Button>
      </div>}
      <p className="sr-only" id={`image-instructions-${asset.id}`}>Use arrow keys to move the selected image. Use the resize and rotation buttons for keyboard adjustments.</p>
      <div className={`image-layer ${imageActive ? "image-editing" : ""} ${needsLocator(asset) ? "needs-locator" : ""}`} style={imageStyle} tabIndex={imageActive ? 0 : -1}
        role="group" aria-roledescription="movable image" aria-describedby={`image-instructions-${asset.id}`} aria-label={`Image ${asset.name}`}
        onKeyDown={(event) => { if (!imageActive) return; const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const; const direction = directions[event.key as keyof typeof directions]; if (direction) { event.preventDefault(); onElementStart(); placeElement(nudgeImage(element, direction, event.shiftKey ? 5 : 1)); onElementEnd(); } }}
        onPointerDown={(event) => { if (!imageActive) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onElementStart(); imageDrag.current = { x: event.clientX, y: event.clientY, element }; }}
        onPointerMove={(event) => { const state = imageDrag.current; const rect = canvasRef.current?.getBoundingClientRect(); if (!state || !rect || activeMode !== "image") return; placeElement(moveImage(state.element, (event.clientX - state.x) / rect.width * 100, (event.clientY - state.y) / rect.height * 100)); }}
        onPointerUp={(event) => {
          const dragged = Boolean(imageDrag.current);
          imageDrag.current = null; onElementEnd();
          if (!dragged) return;
          // Released over a frame: the image goes into that frame instead of
          // staying loose on the page.
          const point = pagePoint(event);
          const hit = point ? frameAt(frames, point.x, point.y) : null;
          if (hit) onFrameAttach(hit.id, asset.id);
        }} onPointerCancel={() => { imageDrag.current = null; onElementEnd(); }}
        onWheel={(event) => { if (!imageActive) return; event.preventDefault(); onElementStart(); const delta = event.deltaY < 0 ? 8 : -8; placeElement(resizeImage(element, "se", delta, delta)); onElementEnd(); }}>
        <CroppedAssetImage asset={asset} fit={objectFitFor(doc.fit)} crop={element.crop} align={doc.align} large />
        <span className="layer-label">Image</span>
        {imageActive && HANDLES.map((handle) => <button key={handle} type="button"
          aria-label={`Resize image from ${handle}`} title={`Resize image from ${handle}`} className={`frame-handle image-handle handle-${handle}`}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onElementStart(); imageResize.current = { handle, x: event.clientX, y: event.clientY, element }; }}
          onPointerMove={handleImageResize} onPointerUp={() => { imageResize.current = null; onElementEnd(); }} onPointerCancel={() => { imageResize.current = null; onElementEnd(); }}
          onKeyDown={(event) => { const amount = event.shiftKey ? 5 : 1; const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0; const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0; if (dx || dy) { event.preventDefault(); onElementStart(); placeElement(resizeImage(element, handle, dx, dy, event.shiftKey)); onElementEnd(); } }} />)}
        <button type="button" aria-label={`Rotate image, ${Math.round(element.box.rotation)} degrees`} title="Rotate image" className="rotation-handle"
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onElementStart(); imageRotate.current = { angle: angleToElementCentre(event, element), rotation: element.box.rotation, element }; }}
          onPointerMove={(event) => { const state = imageRotate.current; if (!state) return; const next = state.rotation + angleToElementCentre(event, state.element) - state.angle; placeElement(rotateImage(state.element, event.shiftKey ? Math.round(next / 15) * 15 : next)); }}
          onPointerUp={() => { imageRotate.current = null; onElementEnd(); }} onPointerCancel={() => { imageRotate.current = null; onElementEnd(); }}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onElementStart(); placeElement(rotateImage(element, element.box.rotation + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1))); onElementEnd(); } }} />
      </div>
      {activeMode === "crop" && <div className="crop-overlay" style={imageStyle}>
        <div className="crop-window" tabIndex={0} style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${(crop.right - crop.left) * 100}%`, height: `${(crop.bottom - crop.top) * 100}%` }}
          aria-label="Crop image. Drag to position the source crop; use handles to resize."
          onKeyDown={(event) => { const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const; const direction = directions[event.key as keyof typeof directions]; if (direction) { event.preventDefault(); const amount = event.shiftKey ? .05 : .01; placeElement(cropImage(element, moveCrop(crop, direction === "left" ? -amount : direction === "right" ? amount : 0, direction === "up" ? -amount : direction === "down" ? amount : 0))); } }}
          {...cropProps("move")}>
          <div className="frame-outline" aria-hidden="true" />
          {HANDLES.map((handle) => <button key={handle} type="button" aria-label={`Resize crop from ${handle}`} title={`Resize crop from ${handle}`}
            className={`frame-handle handle-${handle}`} {...cropProps(handle)} />)}
        </div>
      </div>}
    </div>
  </div>;

  const original = <div className="canvas original-canvas" style={{ ...canvasStyle, background: "#f5f5f3" }}>
    <div className="original-object" style={{ opacity: overlay / 100 }}><AssetImage asset={asset} fit="contain" large /></div>
  </div>;

  return <div className={`content-pane editor-pane ${focusMode ? "focus-editor-pane" : ""}`}>
    <div className="editor-stage" style={{ background: doc.background }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropActive(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false); }}
      onDrop={(event) => {
        event.preventDefault(); setDropActive(false);
        if (!event.dataTransfer.files.length) return;
        const rect = canvasRef.current?.getBoundingClientRect();
        const at = rect ? { x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 } : undefined;
        const hit = at ? frameAt(frames, at.x, at.y) : null;
        onDrop(event.dataTransfer.files, { frameId: hit?.id, at });
      }}>
      {!focusMode && <div className="editor-toolbar" aria-label="Selected image toolbar">
        {assets.length > 0 && <ContextualToolbar mode={normalMode} onMode={setNormalMode} element={element} fit={doc.fit} onFit={onFit} onReplace={onImport} onElement={onElementAction}
          onCropStart={onCropStart} onCropDone={onCropDone} onCropCancel={onCropCancel} onCropReset={onCropReset} onToggleGrid={onToggleGrid} grid={guides.grid} />}
        <Button size="sm" variant="secondary" onClick={onImport}><Upload /> Import images</Button>
        <span className="editor-toolbar-note">{assets.length ? `${assets.length} image${assets.length === 1 ? "" : "s"}` : "Empty canvas — import when ready"}</span>
      </div>}
      {dropActive && <div className="editor-drop-overlay" role="status"><Upload /><strong>Drop images onto the canvas</strong><span>They will be placed as editable image layers</span></div>}
      {/* Panel 10: rulers and the grid toggle sit on the canvas chrome. */}
      {guides.rulers && !compare && <>
        <div className="ruler ruler-top" aria-hidden="true" />
        <div className="ruler ruler-left" aria-hidden="true" />
        <button className={`grid-toggle ${guides.grid ? "active" : ""}`} aria-pressed={guides.grid} aria-label="Toggle grid and guides" onClick={onToggleGrid}><Grid2X2 /></button>
      </>}

      {compare
        ? compareView === "split"
          // Panel 9: one canvas, a draggable divider revealing the original.
          ? <div ref={splitRef} className="compare-slider" style={{ ["--split" as string]: `${splitAt}%` }}>
              <div className="compare-labels"><span>Original</span><span>Resized preview</span></div>
              <div className="split-stack">
                <div className="split-before">{original}</div>
                <div className="split-after">{resized}</div>
                <div role="separator" aria-label="Comparison split position" aria-valuenow={Math.round(splitAt)} tabIndex={0} className="split-handle"
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") { event.preventDefault(); onSplit(Math.max(0, splitAt - 2)); }
                    if (event.key === "ArrowRight") { event.preventDefault(); onSplit(Math.min(100, splitAt + 2)); }
                  }}
                  onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                  onPointerMove={(event) => {
                    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                    const rect = splitRef.current?.getBoundingClientRect();
                    if (rect) onSplit(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
                  }}><span /></div>
              </div>
            </div>
          : <div className="single-canvas">{compareView === "before" ? original : resized}</div>
        : <div className="single-canvas">{resized}</div>}
    </div>
    {!focusMode && <div className="filmstrip">
      <div className="strip-nav">
        <button aria-label="Previous image" onClick={() => onStep(-1)}><ChevronLeft /></button>
        <span>{activeIndex + 1} / {assets.length}</span>
        <button aria-label="Next image" onClick={() => onStep(1)}><ChevronRight /></button>
      </div>
      <div className="strip-scroll">{stripAssets.map((item) => {
        const status = statusOf(item, target);
        const active = item.id === asset.id;
        return <button key={item.id} ref={active ? activeThumb : undefined} className={active ? "active" : ""}
          aria-current={active ? "true" : undefined}
          title={`${item.name} — ${status}`} aria-label={`${item.name}, ${status}`}
          onClick={() => onChoose(item)}>
          <AssetImage asset={item} fit="cover" />
          <span className={`strip-dot dot-${status.toLowerCase()}`} aria-hidden="true" />
          {selectedSet.has(item.id) && <Check className="film-check" />}
        </button>;
      })}</div>
    </div>}
  </div>;
}

/* -------------------------------------------------------------------- review */

export function Review({ assets, target, onOpen, onFix, onFixAll, onRetry }: {
  assets: Asset[]; target: Preset;
  onOpen: (asset: Asset) => void; onFix: (id: number) => void; onFixAll: () => void; onRetry: () => void;
}) {
  const fixable = assets.filter((asset) => !asset.corrupt);
  return <div className="content-pane review-pane">
    <div className="review-heading">
      <div>
        <h1>Error Review &amp; Diagnostics</h1>
        <p>Resolve exceptions before export. Target {target.label} · {target.width} × {target.height} px.</p>
      </div>
      <div className="review-heading-actions">
        <Button variant="outline" onClick={onRetry}>Re-run preset</Button>
        <Button disabled={!fixable.length} onClick={onFixAll}><Zap /> Auto-fix scaling ({fixable.length})</Button>
      </div>
    </div>
    <div className="review-grid">{assets.map((asset) => {
      const reason = asset.corrupt ? "corrupt" : warningReason(asset, target);
      return <Popover key={asset.id}>
        <PopoverTrigger asChild>
          <article className="review-card" role="button" tabIndex={0} aria-label={`${asset.name} diagnostics`}>
            <AssetImage asset={asset} fit="cover" />
            <StatusBadge status={statusOf(asset, target)} />
            <strong>{asset.name}</strong>
            <span>{metaLine(asset)}</span>
          </article>
        </PopoverTrigger>
        {/* Panel 2: the diagnostic explains itself and fixes itself. */}
        <PopoverContent className="diagnostic" align="start">
          <strong>{reason === "corrupt" ? "Error: corrupted file" : reason === "safe" ? "Warning: safe-area overflow" : "Warning: aspect ratio mismatch"}</strong>
          {reason === "corrupt"
            ? <p>The file cannot be decoded, so the resize engine never receives pixel data. It stays in the export queue and fails there — remove it or replace the source.</p>
            : reason === "safe"
              ? <p>Fill and Stretch push content past the safe margins this preset requires. Auto-fix pads the canvas so the product sits back inside the safe area.</p>
              : <>
                  <p>The source ratio does not match the target canvas, so the engine has to choose between cropping and padding. Auto-fix pads to the target ratio without scaling the product.</p>
                  <dl className="diagnostic-rows">
                    <div><dt>Target</dt><dd>{ratioLabel(target.width, target.height)}</dd></div>
                    <div><dt>Current</dt><dd>{ratioLabel(asset.src.w, asset.src.h)}</dd></div>
                    <div><dt>Resolution</dt><dd>{resolutionOf(asset)}</dd></div>
                  </dl>
                </>}
          <div className="diagnostic-actions">
            <Button size="sm" variant="outline" onClick={() => onOpen(asset)}>Open in editor</Button>
            <Button size="sm" disabled={asset.corrupt} onClick={() => onFix(asset.id)}><Zap /> Auto-fix (crop / pad)</Button>
          </div>
        </PopoverContent>
      </Popover>;
    })}</div>
    {!assets.length && <p className="gallery-empty">Nothing needs attention.</p>}
  </div>;
}

/* ------------------------------------------------------------------- presets */

export function PresetManager({ presets, activeId, onApply, onCreate, onEdit, onDuplicate, onDelete, onShare }: {
  presets: Preset[]; activeId: string;
  onApply: (id: string) => void; onCreate: () => void; onEdit: (preset: Preset) => void;
  onDuplicate: (preset: Preset) => void; onDelete: (preset: Preset) => void; onShare: (preset: Preset) => void;
}) {
  const categories = ["Marketplace", "Social Media", "Custom"] as const;
  const [category, setCategory] = useState<typeof categories[number]>("Marketplace");
  const rows = presets.filter((preset) => preset.category === category);
  const [pickedId, setPickedId] = useState(rows[0]?.id ?? activeId);
  const picked = presetById(rows.some((row) => row.id === pickedId) ? pickedId : rows[0]?.id ?? activeId, presets);

  return <div className="full-pane presets-pane">
    <div className="preset-categories">
      <h1>Presets Manager</h1>
      {categories.map((item) => <button key={item} className={item === category ? "active" : ""}
        onClick={() => { setCategory(item); setPickedId(presets.find((preset) => preset.category === item)?.id ?? activeId); }}>
        <Layers3 />{item}<span className="category-count">{presets.filter((preset) => preset.category === item).length}</span>
      </button>)}
    </div>
    <div className="preset-list">
      <span>Preset</span>
      {rows.map((row) => <ContextMenu key={row.id}>
        <ContextMenuTrigger asChild>
          <button className={row.id === picked.id ? "active" : ""} onClick={() => setPickedId(row.id)} onDoubleClick={() => onApply(row.id)}>
            <FileImage />{row.label}{row.id === activeId && <Check className="preset-current" />}
          </button>
        </ContextMenuTrigger>
        {/* Panel 7: preset row menu. Built-in rows cannot be edited or deleted. */}
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onApply(row.id)}>Apply preset</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={row.category !== "Custom"} onSelect={() => onEdit(row)}><Pencil /> Edit</ContextMenuItem>
          <ContextMenuItem onSelect={() => onDuplicate(row)}><Copy /> Duplicate</ContextMenuItem>
          <ContextMenuItem onSelect={() => onShare(row)}><Share2 /> Share</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" disabled={row.category !== "Custom"} onSelect={() => onDelete(row)}><Trash2 /> Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>)}
      <Button className="add-preset" onClick={onCreate}><Plus /> Add new custom preset</Button>
    </div>
    <aside className="preset-detail">
      <h2>Preset Details</h2>
      <div className="preset-preview" style={{ background: picked.background }}>
        <div className="safe-area" style={{ inset: `${picked.safeY}% ${picked.safeX}%` }} />
        <span>{ratioLabel(picked.width, picked.height)}</span>
      </div>
      <dl>
        <div><dt>Canvas dimensions</dt><dd>{picked.width} × {picked.height} px</dd></div>
        <div><dt>Safe area</dt><dd>{picked.safeX}% / {picked.safeY}%</dd></div>
        <div><dt>Background</dt><dd>{picked.background}</dd></div>
        <div><dt>Mode</dt><dd>{picked.fit} · {picked.align}</dd></div>
        <div><dt>Category</dt><dd>{picked.category}</dd></div>
      </dl>
      <Button onClick={() => onApply(picked.id)}>{picked.id === activeId ? "Re-apply preset" : "Apply preset"}</Button>
    </aside>
  </div>;
}

/* ------------------------------------------------------------------ settings */

/**
 * This is a web app, so the GPU, thread, RAM and export-path panels the native
 * mockups showed have nothing to control — they were switches wired to state
 * nobody read. Theme is the one preference the browser build actually owns.
 */
export function SettingsScreen({ theme, onTheme }: { theme: Theme; onTheme: (value: Theme) => void }) {
  const options: [Theme, string, string][] = [
    ["light", "Light", "Bright chrome for a lit room"],
    ["dark", "Dark", "Default, keeps focus on the artboard"],
    ["system", "System", "Follows your operating system"],
  ];
  return <div className="full-pane settings-pane">
    <div className="settings-card-wrap">
      <header className="settings-intro">
        <h1>Settings</h1>
        <p>Keyboard shortcuts live under the <strong>?</strong> button in the top bar.
          Presets are managed on the Presets screen.</p>
      </header>
      <fieldset className="theme-picker">
        <legend>Appearance</legend>
        {options.map(([value, label, hint]) => <label key={value} className={theme === value ? "active" : ""}>
          <input type="radio" name="theme" value={value} checked={theme === value} onChange={() => onTheme(value)} />
          <span className={`theme-swatch theme-swatch-${value}`} aria-hidden="true" />
          <span className="theme-copy"><strong>{label}</strong><em>{hint}</em></span>
        </label>)}
      </fieldset>
    </div>
  </div>;
}
