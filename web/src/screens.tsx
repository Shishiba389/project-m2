import { useEffect, useRef, useState } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignHorizontalSpaceAround, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceAround,
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
  assetKey, frameKey, HANDLES, megabytes, orderStack, presetById, ratioLabel, resolutionOf,
  statusOf, warningReason,
  type Asset, type CanvasLayer, type Doc, type DupPolicy, type Format, type GalleryFilter, type Handle,
  type Preset, type Resolution, type Status, type WarningReason,
} from "@/src/flow";
import { cropImage, fullCrop, fullPageImage, handleCursor, moveCrop, nudgeImage, resizeCrop, type CropRect, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { dragTo, handlePagePoint, handlePoint, resizeTo, rotateTo, scaleBy, toLocal, toParentPercent } from "@/src/gestures";
import { frameAt, frameFromDrag, type FrameElement } from "@/src/frame-geometry";
import { toCss } from "@/src/mat3";
import {
  boxBounds, noSnap, pageTargets, snapMove, tolerance,
  type Rect, type SnapGuide, type SnapOptions, type SnapState, type SnapTarget,
} from "@/src/snap";
import {
  clampZoom, fitViewport, matrix as viewportMatrix, pageRect, pageToScreen, pan as panViewport,
  rulerTicks, screenToPage, zoomAt, type Viewport,
} from "@/src/viewport";
import {
  marqueeFrom, marqueeHits, moveSelection, resizeSelectionTo, selectionBounds,
  type Edge as AlignEdge, type Selectable,
} from "@/src/selection";

/**
 * `rulers` once controlled nothing but whether the canvas's own Grid button
 * was rendered - a switch labelled "Rulers" that showed and hid a different
 * control. It is back because there are now rulers for it to switch.
 */
export type Guides = { grid: boolean; rulers: boolean; snapGrid: boolean; snapSafe: boolean };
export const defaultGuides: Guides = { grid: true, rulers: true, snapGrid: true, snapSafe: true };

/**
 * Where the ruler band begins.
 *
 * In the ordinary editor a toolbar floats over the top of the viewport, so a
 * ruler at the very top would be half-covered by it; the band starts below it
 * instead. Reserving the space in the layout would reflow the whole canvas
 * every time the toggle moved, which costs more than the strip is worth.
 *
 * Focus mode has its own toolbar *outside* the editor, so its viewport starts
 * clear and the same offset would push the ruler down over the artwork - which
 * is exactly what it did.
 */
const RULER_TOP = 74;
const FOCUS_RULER_TOP = 8;
/**
 * Let a gesture write at most once per frame.
 *
 * A pointer reports far faster than the screen redraws - a 1000Hz mouse fires
 * sixteen times between two frames - and every one of those reports used to
 * write state and re-render the scene, the inspector and the layers panel.
 * Fifteen of those sixteen renders were thrown away before anything was
 * painted; all they cost was the frame budget of the one that was not.
 *
 * Only the newest position survives, which is what the user is pointing at
 * anyway. `flush` runs a pending write immediately, and every gesture that
 * ends calls it first: the last movement before the pointer came up has to be
 * in the document before the transaction is committed, or the commit records a
 * position the object never reached.
 */
function useFrameWrites() {
  const pending = useRef<(() => void) | null>(null);
  const frame = useRef<number | null>(null);
  const run = () => {
    frame.current = null;
    const work = pending.current;
    pending.current = null;
    work?.();
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  return {
    schedule(work: () => void) {
      pending.current = work;
      if (frame.current === null) frame.current = requestAnimationFrame(run);
    },
    flush() {
      if (frame.current !== null) { cancelAnimationFrame(frame.current); run(); }
    },
  };
}

/** The grid the canvas draws, in page percent, so snapping and drawing agree. */
const GRID_STEP = 100 / 3;
/** A stable empty array: clearing guides must not re-render on every pointer move. */
const NO_GUIDES: SnapGuide[] = [];
const sameGuides = (left: SnapGuide[], right: SnapGuide[]) =>
  left.length === right.length && left.every((guide, index) =>
    guide.axis === right[index].axis && guide.at === right[index].at && guide.kind === right[index].kind);

/** Everything the editor needs to show and change a multi-object selection. */
export type MultiSelection = {
  selection: string[];
  items: Selectable[];
  onSelect: (keys: string[]) => void;
  onGestureStart: () => void;
  onWrite: (next: Selectable[]) => void;
  onGestureEnd: () => void;
  onAlign: (edge: AlignEdge) => void;
  onDistribute: (axis: "x" | "y") => void;
};
const NO_MULTI: MultiSelection = {
  selection: [], items: [],
  onSelect: () => {}, onGestureStart: () => {}, onWrite: () => {}, onGestureEnd: () => {},
  onAlign: () => {}, onDistribute: () => {},
};
/** The four corners a group can be resized from; edges would mean a shear. */
const GROUP_HANDLES = ["nw", "ne", "se", "sw"] as const;

/**
 * What the toolbar becomes when more than one object is selected (§25).
 *
 * The contextual toolbar derives from `selection.count` before it derives from
 * anything else: with two objects picked, "Crop" and "Replace" have no single
 * subject, and align and distribute suddenly do.
 */
function SelectionToolbar({ count, canDistribute, onAlign, onDistribute }: {
  count: number; canDistribute: boolean;
  onAlign: (edge: AlignEdge) => void; onDistribute: (axis: "x" | "y") => void;
}) {
  const aligns: [AlignEdge, string, React.ReactNode][] = [
    ["left", "Align left", <AlignStartVertical key="l" />],
    ["centre-x", "Align centres horizontally", <AlignCenterVertical key="c" />],
    ["right", "Align right", <AlignEndVertical key="r" />],
    ["top", "Align top", <AlignStartHorizontal key="t" />],
    ["centre-y", "Align centres vertically", <AlignCenterHorizontal key="m" />],
    ["bottom", "Align bottom", <AlignEndHorizontal key="b" />],
  ];
  return <>
    <span className="selection-count">{count} selected</span>
    <div className="toolbar-segment" role="group" aria-label="Align selection">
      {aligns.map(([edge, label, icon]) =>
        <button key={edge} aria-label={label} title={label} onClick={() => onAlign(edge)}>{icon}</button>)}
    </div>
    <div className="toolbar-segment" role="group" aria-label="Distribute selection">
      <button aria-label="Distribute horizontally" title="Distribute horizontally" disabled={!canDistribute}
        onClick={() => onDistribute("x")}><AlignHorizontalSpaceAround /></button>
      <button aria-label="Distribute vertically" title="Distribute vertically" disabled={!canDistribute}
        onClick={() => onDistribute("y")}><AlignVerticalSpaceAround /></button>
    </div>
  </>;
}

export type CompareView = "split" | "before" | "after";
export type EditorTool = "image" | "crop" | "canvas" | "frame";
export type FrameSelection = { id: string; editing: boolean };

/**
 * Document-space box to CSS. Percentages are of the nearest positioned layer.
 *
 * The orientation is also published as three custom properties, so chrome
 * drawn inside the box can undo it. A label is text: it has to stay upright
 * and the right way round whatever the object is doing, or selecting a
 * mirrored image shows its name written backwards. The inverse of
 * `rotate(r) scale(f)` is `scale(f) rotate(-r)`, since a mirror is its own
 * inverse - which is exactly what `.layer-label` applies.
 */
export const boxStyle = (box: ImageBox): React.CSSProperties => ({
  left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
  transform: `rotate(${box.rotation}deg) scale(${box.flipH ? -1 : 1}, ${box.flipV ? -1 : 1})`,
  ["--r" as string]: box.rotation,
  ["--fx" as string]: box.flipH ? -1 : 1,
  ["--fy" as string]: box.flipV ? -1 : 1,
});
/** How the image inside a frame ends up oriented on screen, for its cursors. */
const contentOrientation = (frame: FrameElement) => {
  const mirrored = frame.box.flipH !== frame.box.flipV;
  const content = frame.content?.box;
  return {
    rotation: frame.box.rotation + (content ? (mirrored ? -content.rotation : content.rotation) : 0),
    flipH: frame.box.flipH !== Boolean(content?.flipH),
    flipV: frame.box.flipV !== Boolean(content?.flipV),
  };
};
/**
 * A white or fully transparent image is invisible against a white page, so the
 * selected layer gets a checkerboard behind it. The flag is measured from the
 * decoded pixels at import, not guessed from the file's format.
 */
const needsLocator = (asset: Asset) => asset.faint === true;

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
      <button aria-label="Scale image down" title="Scale down" onClick={() => onElement({ ...element, box: scaleBy(element.box, 1 / 1.12) })}>−</button><button aria-label="Scale image up" title="Scale up" onClick={() => onElement({ ...element, box: scaleBy(element.box, 1.12) })}>+</button>
      <button onClick={() => onElement({ ...element, box: rotateTo(element.box, element.box.rotation - 15) })}>Rotate left</button><button onClick={() => onElement({ ...element, box: rotateTo(element.box, element.box.rotation + 15) })}>Rotate right</button>
      <button aria-expanded={showMore} onClick={() => setShowMore((value) => !value)}>More</button>
    </div>{showMore && <div className="toolbar-segment" role="group" aria-label="Advanced image actions">
      <button aria-pressed={element.box.flipH} onClick={() => onElement({ ...element, box: { ...element.box, flipH: !element.box.flipH } })}>Flip H</button><button aria-pressed={element.box.flipV} onClick={() => onElement({ ...element, box: { ...element.box, flipV: !element.box.flipV } })}>Flip V</button>
      <button aria-pressed={element.box.lockedRatio} onClick={() => onElement({ ...element, box: { ...element.box, lockedRatio: !element.box.lockedRatio } })}>Lock ratio</button><button onClick={() => onElement(fullPageImage())}>Reset</button>
    </div>}</>}
    {mode === "crop" && <div className="toolbar-segment" role="group" aria-label="Crop actions"><button onClick={onCropReset}>Reset crop</button><button onClick={() => { onCropCancel(); onMode("image"); }}>Cancel</button><button onClick={() => { onCropDone(); onMode("image"); }}>Done</button></div>}
    {mode === "canvas" && <div className="toolbar-segment" role="group" aria-label="Canvas actions"><button aria-pressed={grid} onClick={onToggleGrid}>Grid</button></div>}
  </div>;
}

export function Editor({ asset, assets, selected, doc, viewport, onViewport, onViewSize = () => {}, multi = NO_MULTI, spacePan = false, compare, compareView, splitAt, overlay, guides, target, onElement, onElementAction, onElementStart, onElementEnd, onCropStart, onCropDone, onCropCancel, onCropReset, onSplit, onChoose, onImport, onDrop, onFit, onToggleGrid, onStep, focusMode = false, editMode = "image", cropActive = false,
  canvasLayers, activeLayer = null, frameSelection = null, onFrameAdd = () => {}, onFrameWrite = () => {}, onFrameGestureStart = () => {},
  onFrameGestureEnd = () => {}, onFrameSelect = () => {}, onFrameContentEdit = () => {}, onFrameContentDone = () => {},
  onFrameContentCancel = () => {}, onFrameDelete = () => {}, onFrameRefit = () => {}, onFrameReset = () => {}, onFrameDetach = () => {},
  onFrameAttach = () => {} }: {
  asset: Asset; assets: Asset[]; selected: number[]; doc: Doc;
  /** Pan and zoom of the workspace. Never an element's own transform. */
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
  /** The measured pane, so the zoom controls outside the canvas can use it. */
  onViewSize?: (size: { width: number; height: number }) => void;
  /**
   * The canvas selection and the commands that act on it. Optional because
   * every other surface that renders an Editor - focus mode, the smoke test -
   * has nothing to multi-select.
   */
  multi?: MultiSelection;
  /** Space is held, so a drag anywhere pans instead of selecting. */
  spacePan?: boolean;
  compare: boolean; compareView: CompareView; splitAt: number; overlay: number; guides: Guides; target: Preset;
  onElement: (element: ImageElement) => void; onElementAction: (element: ImageElement) => void; onElementStart: () => void; onElementEnd: () => void; onCropStart: () => void; onCropDone: () => void; onCropCancel: () => void; onCropReset: () => void; onSplit: (value: number) => void; onChoose: (asset: Asset) => void;
  onImport: () => void; onDrop: (files: FileList, drop?: { frameId?: string; at?: { x: number; y: number } }) => void; onFit: (fit: Doc["fit"]) => void;
  onToggleGrid: () => void; onStep: (delta: number) => void;
  focusMode?: boolean;
  editMode?: EditorTool;
  cropActive?: boolean;
  /**
   * Free images on the page, as instances.
   *
   * One asset can appear several times, so a layer is addressed by its own key
   * rather than by the id of the file behind it. Defaults to the active image
   * alone, which is the shape every surface outside the editor needs.
   */
  canvasLayers?: CanvasLayer[];
  /** The layer the single-object chrome edits, when there is exactly one. */
  activeLayer?: CanvasLayer | null;
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
}) {
  const [normalMode, setNormalMode] = useState<EditorTool>("image");
  const activeMode = focusMode ? editMode : normalMode;
  const rulerTop = focusMode ? FOCUS_RULER_TOP : RULER_TOP;
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const panGesture = useRef<{ x: number; y: number; viewport: Viewport } | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const page = { width: doc.width, height: doc.height };

  // The pane's size drives fit, clamping and pointer-anchored zoom, so it has
  // to be measured rather than assumed.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setViewSize({ width: box.width, height: box.height });
      onViewSize({ width: box.width, height: box.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onViewSize]);
  /**
   * Fitting the page follows the pane until the user takes control of the
   * view. Fitting only on the first measurement leaves the page mis-framed
   * whenever that measurement was not the final layout — a filmstrip that
   * loads late, an inspector that opens, a window that is resized.
   */
  const pageKey = `${doc.width}x${doc.height}`;
  const placedFor = useRef("");
  const lastFit = useRef<Viewport | null>(null);
  useEffect(() => {
    if (!viewSize.width || !viewSize.height) return;
    const same = (left: Viewport, right: Viewport) =>
      Math.abs(left.zoom - right.zoom) < 1e-9 && Math.abs(left.panX - right.panX) < .5 && Math.abs(left.panY - right.panY) < .5;
    const placed = viewport.zoom > 0 && placedFor.current === pageKey;
    // The view is still ours as long as it is exactly where we last put it.
    if (placed && lastFit.current && !same(viewport, lastFit.current)) return;
    const next = fitViewport({ width: doc.width, height: doc.height }, viewSize);
    if (placed && same(viewport, next)) return;
    placedFor.current = pageKey;
    lastFit.current = next;
    onViewport(next);
  }, [viewSize, pageKey, viewport, doc.width, doc.height, onViewport]);

  // The wheel listener is attached once, so it reads the live viewport here
  // rather than closing over a stale one.
  const viewportState = useRef(viewport);
  viewportState.current = viewport;
  // A wheel listener has to be non-passive to be able to stop the page from
  // scrolling, which React's synthetic handler cannot promise.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = node.getBoundingClientRect();
      const size = { width: box.width, height: box.height };
      const current = viewportState.current;
      if (event.ctrlKey || event.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel; both zoom about the pointer.
        const factor = Math.exp(-event.deltaY / 400);
        onViewport(zoomAt(current, clampZoom(current.zoom * factor),
          { x: event.clientX - box.left, y: event.clientY - box.top }, { width: doc.width, height: doc.height }, size));
        return;
      }
      const [dx, dy] = event.shiftKey && !event.deltaX ? [-event.deltaY, 0] : [-event.deltaX, -event.deltaY];
      onViewport(panViewport(current, dx, dy, { width: doc.width, height: doc.height }, size));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [doc.width, doc.height, onViewport]);
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
  /** Which constraint each axis currently holds - the memory hysteresis needs. */
  const snapState = useRef<SnapState>(noSnap);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>(NO_GUIDES);
  /* Multi-selection (§18, §19). A marquee is resolved in page percentages, so
     the same sweep catches the same objects at any zoom. */
  const marquee = useRef<{ from: { x: number; y: number }; base: string[] } | null>(null);
  const [marqueeArea, setMarqueeArea] = useState<{ x: number; y: number; w: number; h: number; mode: string } | null>(null);
  const groupDrag = useRef<{ from: { x: number; y: number }; items: Selectable[] } | null>(null);
  const groupResize = useRef<{ bounds: Rect; handle: typeof GROUP_HANDLES[number]; items: Selectable[] } | null>(null);

  // The geometry being edited belongs to the selected layer, which may be a
  // second copy of the same file; the crop source still comes from the asset.
  const element = activeLayer?.element ?? asset.element;
  const crop = element.crop ?? fullCrop();
  const frameWrites = useFrameWrites();
  const placeElement = (next: ImageElement) => frameWrites.schedule(() => onElement(next));
  /** A live write during a gesture; the committed ones go straight through. */
  const writeFrameLive = (next: FrameElement) => frameWrites.schedule(() => onFrameWrite(next, true));
  const handleImageResize = (event: React.PointerEvent) => {
    const state = imageResize.current;
    const span = state && gestureSpan(event, state);
    if (!state || !span) return;
    const target = snapHandle(span.now, state.handle, { layer: activeLayer?.key ?? assetKey(asset.id) });
    placeElement({ ...state.element, box: resizeTo(
      { box: state.element.box, handle: state.handle, pointer: span.start }, target, page, event.shiftKey) });
  };
  /** Arrow keys resize through the same function, from the handle's own point. */
  const keyResize = (element: ImageElement, handle: Handle, dx: number, dy: number, stretch: boolean) => {
    const from = handlePagePoint(element.box, page, handle);
    return { ...element, box: resizeTo({ box: element.box, handle, pointer: from }, { x: from.x + dx, y: from.y + dy }, page, stretch) };
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
      const state = cropGesture.current;
      const span = state && gestureSpan(event, state);
      if (!state || !span) return;
      // The crop window is drawn inside the element, so both ends of the drag
      // go through the element's inverse: the crop then tracks the pointer on a
      // rotated or mirrored image instead of sliding off at an angle.
      const from = toLocal(element.box, page, span.start);
      const to = toLocal(element.box, page, span.now);
      if (!from || !to) return;
      const dx = to.x - from.x; const dy = to.y - from.y;
      const next = state.mode === "move" ? moveCrop(state.crop, dx, dy) : resizeCrop(state.crop, state.mode, dx, dy);
      placeElement(cropImage(element, next));
    },
    onPointerUp: () => { frameWrites.flush(); cropGesture.current = null; }, onPointerCancel: () => { frameWrites.flush(); cropGesture.current = null; },
  });

  // One pre-transform pixel is one output pixel, so zoom is a true scale: at 1
  // the page is shown at the size it will be exported.
  const sceneStyle = {
    width: `${doc.width}px`, height: `${doc.height}px`,
    transform: toCss(viewportMatrix(viewport)), transformOrigin: "0 0",
    // Chrome inside the scene divides this scale back out, so handles and
    // outlines measure the same on screen at every zoom.
    ["--z" as string]: viewport.zoom,
    ["--zi" as string]: viewport.zoom > 0 ? 1 / viewport.zoom : 1,
  };
  const projected = pageRect(viewport, page);
  const scrimStyle = { left: `${projected.x}px`, top: `${projected.y}px`, width: `${projected.w}px`, height: `${projected.h}px` };

  const imageStyle = boxStyle(element.box);

  /* ---------------------------------------------------------------- frames */

  const frames = doc.frames;
  const layers: CanvasLayer[] = canvasLayers
    ?? [{ key: assetKey(asset.id), assetId: asset.id, element: asset.element, placementId: null }];
  const assetOf = (layer: CanvasLayer) => assets.find((item) => item.id === layer.assetId) ?? asset;
  const framedAsset = (frame: FrameElement) => assets.find((item) => item.id === frame.imageId) ?? null;
  const selectedFrame = frames.find((frame) => frame.id === frameSelection?.id) ?? null;
  /**
   * The canvas stack, bottom to top.
   *
   * The scene, the click targets and the exported file all read this one
   * order.  Before the layers panel it was implicit - every free image, then
   * every frame - and `orderStack` still produces exactly that for a document
   * that has never been rearranged.
   */
  const layerByKey = new Map(layers.map((layer) => [layer.key, layer]));
  const frameByKey = new Map(frames.map((frame) => [frameKey(frame.id), frame]));
  const sceneKeys = orderStack(doc.stack, [
    ...layers.map((layer) => layer.key),
    ...frames.map((frame) => frameKey(frame.id)),
  ]);
  const editingContent = Boolean(selectedFrame && frameSelection?.editing && selectedFrame.content);
  // A frame owns the selection while it is active, so the free-image overlay steps aside.
  /* -------------------------------------------------------- multi-selection */

  const selectedItems = multi.items.filter((item) => multi.selection.includes(item.key));
  const groupBounds = selectedItems.length > 1 ? selectionBounds(selectedItems) : null;
  /** A group owns the overlay while it has more than one member. */
  const grouped = groupBounds !== null;
  /**
   * Clicking an object selects it; holding Shift or Ctrl adds or removes it.
   * Returns true when the click was a selection change and nothing else should
   * act on it, which is how a modifier-click avoids also starting a drag.
   */
  const pickObject = (event: React.PointerEvent, key: string) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!additive) {
      if (multi.selection.length > 1 && multi.selection.includes(key)) return false;
      multi.onSelect([key]);
      return false;
    }
    multi.onSelect(multi.selection.includes(key)
      ? multi.selection.filter((entry) => entry !== key)
      : [...multi.selection, key]);
    return true;
  };

  const imageActive = activeMode === "image" && !selectedFrame && !grouped;

  /** Pointer travel since a gesture started, in percentages of the page. */
  const pageDelta = (event: React.PointerEvent, from: { x: number; y: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { dx: (event.clientX - from.x) / rect.width * 100, dy: (event.clientY - from.y) / rect.height * 100 };
  };
  /**
   * A client point as a percentage of the page - the one unit the geometry
   * engine speaks. Gestures record where they started in client coordinates
   * and convert both ends here, so a pan or a zoom mid-drag cannot shift the
   * frame of reference underneath a gesture that is already running.
   */
  const pageAt = (client: { x: number; y: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (client.x - rect.left) / rect.width * 100, y: (client.y - rect.top) / rect.height * 100 };
  };
  const pagePoint = (event: React.PointerEvent) => pageAt({ x: event.clientX, y: event.clientY });
  /** Both ends of a gesture, or null if either could not be resolved. */
  const gestureSpan = (event: React.PointerEvent, from: { x: number; y: number }) => {
    const start = pageAt(from); const now = pagePoint(event);
    return start && now ? { start, now } : null;
  };
  /**
   * Everything a dragged object can line up against. The page and its safe
   * area are lines in their own right; every other layer and frame offers its
   * two edges and its centre. The object being dragged is excluded, or it
   * would snap to itself and never move.
   */
  const snapOptions = (exclude: { layer?: string; frame?: string }): SnapOptions => ({
    targets: [
      ...pageTargets(guides.snapSafe ? doc.safeX : 0, guides.snapSafe ? doc.safeY : 0),
      ...layers.filter((layer) => layer.key !== exclude.layer)
        .map((layer): SnapTarget => ({ id: layer.key, rect: boxBounds(layer.element.box), kind: "object" })),
      ...frames.filter((frame) => frame.id !== exclude.frame)
        .map((frame): SnapTarget => ({ id: `frame-${frame.id}`, rect: boxBounds(frame.box), kind: "object" })),
    ],
    grid: guides.snapGrid ? GRID_STEP : null,
    ...tolerance(page, viewport.zoom),
  });
  /**
   * Correct a dragged box, and show the constraints that held. The guides are
   * the solver's output, never the thing that decided the position.
   */
  const applySnap = (box: ImageBox, exclude: { layer?: string; frame?: string }): ImageBox => {
    const result = snapMove(boxBounds(box), snapOptions(exclude), snapState.current);
    snapState.current = result.state;
    setSnapGuides((current) => sameGuides(current, result.guides) ? current : result.guides);
    return result.dx || result.dy ? { ...box, x: box.x + result.dx, y: box.y + result.dy } : box;
  };
  /**
   * Snapping for a resize, which moves one handle rather than the whole box.
   *
   * The constraint is solved on the handle's own position - a degenerate rect,
   * so its three anchors collapse onto the point - and the correction is fed
   * back in as a corrected pointer.  Going through the pointer rather than
   * through the resulting box matters: nudging the box afterwards would drag
   * the fixed anchor along with it, and a resize would quietly turn into a
   * move.  An axis the handle does not control is ignored, so dragging `e`
   * never snaps vertically.
   */
  const snapHandle = (point: { x: number; y: number }, handle: Handle, exclude: { layer?: string; frame?: string }) => {
    const result = snapMove({ x: point.x, y: point.y, w: 0, h: 0 }, snapOptions(exclude), snapState.current);
    const local = handlePoint(handle);
    const free = { x: local.x !== 0.5, y: local.y !== 0.5 };
    const shown = result.guides.filter((guide) => free[guide.axis]);
    snapState.current = { x: free.x ? result.state.x : null, y: free.y ? result.state.y : null };
    setSnapGuides((current) => sameGuides(current, shown) ? current : shown);
    return { x: point.x + (free.x ? result.dx : 0), y: point.y + (free.y ? result.dy : 0) };
  };

  /** Both group gestures close the same way: one entry, whatever they moved. */
  const endGroupGesture = () => {
    frameWrites.flush();
    if (!groupDrag.current && !groupResize.current) return;
    groupDrag.current = null; groupResize.current = null;
    multi.onGestureEnd();
  };

  /** A gesture that ends takes its guides and its hysteresis with it. */
  const clearSnap = () => {
    snapState.current = noSnap;
    setSnapGuides((current) => current.length ? NO_GUIDES : current);
  };

  /**
   * Moving, resizing or rotating the frame itself is one document transaction
   * per gesture, so releasing the pointer commits it.
   */
  const endFrameGesture = () => {
    frameWrites.flush();
    frameDrag.current = null; frameResize.current = null; frameRotate.current = null;
    clearSnap();
    onFrameGestureEnd();
  };
  /**
   * Dragging the image inside a frame is part of the open content session, not
   * a transaction of its own: committing here would consume the session's
   * snapshot and leave Esc with nothing to discard.
   */
  const endContentGesture = (event: React.PointerEvent) => {
    frameWrites.flush();
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
      const span = gestureSpan(event, drag);
      if (span) writeFrameLive({ ...drag.frame, box: applySnap(
        dragTo({ box: drag.frame.box, pointer: span.start }, span.now), { frame: drag.frame.id }) });
      return;
    }
    const resize = frameResize.current;
    if (resize) {
      const span = gestureSpan(event, resize);
      if (!span) return;
      // Resizing a frame re-clips it; the image inside keeps its own transform.
      // A frame resizes freely, and Shift constrains it to its current ratio,
      // which is a property of the gesture rather than of the frame.
      const target = snapHandle(span.now, resize.handle, { frame: resize.frame.id });
      const box = resizeTo({ box: { ...resize.frame.box, lockedRatio: event.shiftKey }, handle: resize.handle, pointer: span.start }, target, page);
      writeFrameLive({ ...resize.frame, box: { ...box, lockedRatio: resize.frame.box.lockedRatio } });
      return;
    }
    const rotate = frameRotate.current;
    if (rotate) {
      const next = rotate.rotation + angleToBoxCentre(event, rotate.frame.box) - rotate.angle;
      writeFrameLive({ ...rotate.frame, box: rotateTo(rotate.frame.box, next, event.shiftKey ? 15 : 0) });
      return;
    }
    const content = contentDrag.current;
    if (content && content.frame.content) {
      const span = gestureSpan(event, content);
      if (!span) return;
      // The content box is a percentage of its frame, so the pointer passes
      // through the frame's inverse first. Without that, dragging an image
      // inside a rotated frame moves it sideways.
      const from = toParentPercent(content.frame.box, page, span.start);
      const to = toParentPercent(content.frame.box, page, span.now);
      if (!from || !to) return;
      writeFrameLive({ ...content.frame, content: { ...content.frame.content, box: dragTo({ box: content.frame.content.box, pointer: from }, to) } });
      setDetachArmed(!frameAt([content.frame], span.now.x, span.now.y));
      return;
    }
    const scale = contentResize.current;
    if (scale && scale.frame.content) {
      const span = gestureSpan(event, scale);
      if (!span) return;
      const from = toParentPercent(scale.frame.box, page, span.start);
      const to = toParentPercent(scale.frame.box, page, span.now);
      if (!from || !to) return;
      writeFrameLive({ ...scale.frame, content: { ...scale.frame.content, box: resizeTo(
        { box: scale.frame.content.box, handle: scale.handle, pointer: from }, to, framePixels(scale.frame.box), event.shiftKey) } });
    }
  };
  /** A frame's own size in output pixels: the page its content is measured in. */
  const framePixels = (box: ImageBox) => ({ width: box.w / 100 * doc.width, height: box.h / 100 * doc.height });
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
  /**
   * The context bar is anchored to the pane, not to the scene: panning must
   * never carry it out of reach. It lifts to the top when the selection sits
   * against the bottom edge, so it cannot cover a focused handle there.
   */
  const actionsBottom = selectedFrame
    ? pageToScreen(viewport, page, { x: 0, y: selectedFrame.box.y + selectedFrame.box.h }).y : 0;
  const actionsRaised = viewSize.height > 0 && actionsBottom > viewSize.height - 96;
  const frameActions = selectedFrame && <div className={`frame-actions ${actionsRaised ? "raised" : ""}`}>
    {!editingContent && <div role="group" aria-label="Frame actions">
        {selectedFrame.imageId === null
          ? <><Button size="sm" variant="secondary" onClick={onImport}><Upload /> Add image</Button>
              {asset.id !== 0 && <Button size="sm" variant="secondary" onClick={() => onFrameAttach(selectedFrame.id, asset.id)}>Place {asset.name}</Button>}</>
          : <><Button size="sm" variant="secondary" onClick={() => onFrameContentEdit(selectedFrame.id)}>Edit content</Button>
              <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fill")}>Fill</Button>
              <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fit")}>Fit</Button>
              <Button size="sm" variant="secondary" onClick={() => onFrameDetach(selectedFrame.id)}>Detach</Button></>}
        <Button size="sm" variant="secondary" onClick={() => onFrameDelete(selectedFrame.id)}><Trash2 /> Delete frame</Button>
      </div>}
    {editingContent && <div role="group" aria-label="Frame content actions">
        <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fill")}>Fill</Button>
        <Button size="sm" variant="secondary" onClick={() => onFrameRefit(selectedFrame.id, "fit")}>Fit</Button>
        <Button size="sm" variant="secondary" onClick={onFrameReset}>Reset</Button>
        <Button size="sm" variant="secondary" onClick={onFrameContentCancel}>Cancel</Button>
        <Button size="sm" onClick={onFrameContentDone}><Check /> Done</Button>
      </div>}
  </div>;

  const resized = <div ref={canvasRef} className="canvas-scene" style={sceneStyle}>
    {/* Not `.canvas`: that class exists only for the pre-workspace layout, where
        the page was the element that filled the stage, and it still carries
        rules that size whatever wears it. Everything it offered here is either
        overridden below or meaningless - the children are all absolute, so its
        flex centring does nothing, and the background is set inline. */}
    <div className="page-canvas" style={{ background: doc.background }}>
      {guides.grid && <div className="canvas-grid" aria-hidden="true" />}
      <div className="safe-area" style={{ inset: `${doc.safeY}% ${doc.safeX}%` }} />
      {/* Artwork is no longer clipped to the page: the workspace shows it in
          full and the scrim marks what will not be exported. */}
      {/* The scene layer: every object drawn once, and nothing else. The
          selection overlay used to draw the selected image a second time on
          top of this one, which is invisible on opaque artwork and wrong on
          anything with alpha - two 50% layers composite to 75%, so the editor
          showed a product shot more opaque than the file it exported. */}
      <div className="page-render-clip" aria-hidden="true">
        {sceneKeys.map((key) => {
          const layer = layerByKey.get(key);
          if (layer) return <div key={key}
            className={`page-render-image ${layer.key === activeLayer?.key && imageActive && needsLocator(assetOf(layer)) ? "needs-locator" : ""}`}
            style={boxStyle(layer.element.box)}>
            <CroppedAssetImage asset={assetOf(layer)} fit={objectFitFor(doc.fit)} crop={layer.element.crop} align={doc.align} large />
          </div>;
          const frame = frameByKey.get(key);
          return frame ? frameLayer(frame) : null;
        })}
      </div>
    </div>
    {/* Everything outside the page is dimmed rather than cut off: it stays
        visible and selectable, and reads as "this will not be exported". */}
    <div className="workspace-scrim" aria-hidden="true" />
    {/* The visible half of the constraint solver: one line per axis that held. */}
    {snapGuides.length > 0 && <div className="snap-guides" aria-hidden="true">
      {snapGuides.map((guide) => <div key={`${guide.axis}-${guide.kind}-${guide.at}`} className={`snap-guide axis-${guide.axis} ${guide.kind}`}
        style={guide.axis === "x"
          ? { left: `${guide.at}%`, top: `${guide.from}%`, height: `${guide.to - guide.from}%` }
          : { top: `${guide.at}%`, left: `${guide.from}%`, width: `${guide.to - guide.from}%` }} />)}
    </div>}
    {marqueeArea && <div className={`marquee ${marqueeArea.mode}`} aria-hidden="true"
      style={{ left: `${marqueeArea.x}%`, top: `${marqueeArea.y}%`, width: `${marqueeArea.w}%`, height: `${marqueeArea.h}%` }} />}
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
      {/* A multi-selection is one rectangle over objects that keep their own
          identity (§18): dragging or scaling it writes each member's own box
          back, and nothing is ever grouped or reparented. */}
      {groupBounds && <div className="multi-selection" role="group" aria-label={`${selectedItems.length} objects selected`}
        style={{ left: `${groupBounds.x}%`, top: `${groupBounds.y}%`, width: `${groupBounds.w}%`, height: `${groupBounds.h}%` }}
        onPointerDown={(event) => {
          event.stopPropagation();
          const at = pagePoint(event);
          if (!at) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          multi.onGestureStart();
          groupDrag.current = { from: at, items: selectedItems };
        }}
        onPointerMove={(event) => {
          const state = groupDrag.current;
          if (!state) return;
          const at = pagePoint(event);
          if (at) frameWrites.schedule(() => multi.onWrite(moveSelection(state.items, at.x - state.from.x, at.y - state.from.y)));
        }}
        onPointerUp={endGroupGesture} onPointerCancel={endGroupGesture}>
        <div className="frame-outline" aria-hidden="true" />
        <span className="layer-label">{selectedItems.length} selected</span>
        {GROUP_HANDLES.map((handle) => <button key={handle} type="button" className={`frame-handle handle-${handle}`}
          aria-label={`Resize selection from ${handle}`} title={`Resize selection from ${handle}`}
          onPointerDown={(event) => {
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            multi.onGestureStart();
            groupResize.current = { bounds: groupBounds, handle, items: selectedItems };
          }}
          onPointerMove={(event) => {
            const state = groupResize.current;
            if (!state) return;
            const at = pagePoint(event);
            if (at) frameWrites.schedule(() => multi.onWrite(resizeSelectionTo(state.items, state.bounds, state.handle, at)));
          }}
          onPointerUp={endGroupGesture} onPointerCancel={endGroupGesture} />)}
      </div>}
      {/* Unselected layers are click targets only; the selected one gets handles. */}
      {/* Click targets follow the same order as the scene, so the object a
          click lands on is the one drawn on top of the pile (§33). */}
      {sceneKeys.map((key) => {
        const layer = layerByKey.get(key);
        if (layer) return layer.key === activeLayer?.key ? null : <button key={key} type="button" className="layer-hit"
          style={boxStyle(layer.element.box)} aria-label={`Select image ${assetOf(layer).name}`} title={assetOf(layer).name}
          onPointerDown={(event) => { event.stopPropagation(); pickObject(event, layer.key); }} />;
        const frame = frameByKey.get(key);
        if (!frame || frame.id === frameSelection?.id) return null;
        return <button key={key} type="button"
          className={`layer-hit frame-hit ${frame.imageId === null ? "empty" : ""}`} style={boxStyle(frame.box)}
          aria-label={frame.imageId === null ? "Select empty frame" : `Select frame containing ${framedAsset(frame)?.name ?? "an image"}`}
          onPointerDown={(event) => { event.stopPropagation(); if (pickObject(event, frameKey(frame.id))) return; if (editingContent) onFrameContentDone(); onFrameSelect(frame.id); }}
          onDoubleClick={() => frame.imageId !== null && onFrameContentEdit(frame.id)} />;
      })}
      {selectedFrame && !editingContent && !grouped && <div className="frame-selection" style={boxStyle(selectedFrame.box)} tabIndex={0}
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
          style={{ cursor: handleCursor(handle, selectedFrame.box) }}
          aria-label={`Resize frame from ${handle}`} title={`Resize frame from ${handle}`}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onFrameGestureStart(); frameResize.current = { handle, x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
          onPointerMove={moveFrameGesture} onPointerUp={endFrameGesture} onPointerCancel={endFrameGesture}
          onKeyDown={(event) => {
            const amount = event.shiftKey ? 5 : 1;
            const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
            const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
            if (!dx && !dy) return;
            event.preventDefault();
            const from = handlePagePoint(selectedFrame.box, page, handle);
            const sized = resizeTo({ box: { ...selectedFrame.box, lockedRatio: event.shiftKey }, handle, pointer: from }, { x: from.x + dx, y: from.y + dy }, page);
            onFrameWrite({ ...selectedFrame, box: { ...sized, lockedRatio: selectedFrame.box.lockedRatio } });
          }} />)}
        <button type="button" className="rotation-handle" aria-label={`Rotate frame, ${Math.round(selectedFrame.box.rotation)} degrees`} title="Rotate frame"
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onFrameGestureStart(); frameRotate.current = { angle: angleToBoxCentre(event, selectedFrame.box), rotation: selectedFrame.box.rotation, frame: selectedFrame }; }}
          onPointerMove={moveFrameGesture} onPointerUp={endFrameGesture} onPointerCancel={endFrameGesture} />
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
            const inner = selectedFrame.content!;
            onFrameWrite({ ...selectedFrame, content: { ...inner, box: { ...inner.box, x: inner.box.x + dx, y: inner.box.y + dy } } }, true);
          }}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); contentDrag.current = { x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
          onPointerMove={moveFrameGesture} onPointerUp={endContentGesture} onPointerCancel={endContentGesture}>
          {framedAsset(selectedFrame) && <CroppedAssetImage asset={framedAsset(selectedFrame)!} fit="fill" crop={selectedFrame.content.crop} align={doc.align} large />}
          {HANDLES.map((handle) => <button key={handle} type="button" className={`frame-handle handle-${handle}`}
            style={{ cursor: handleCursor(handle, contentOrientation(selectedFrame)) }}
            aria-label={`Scale content from ${handle}`} title={`Scale content from ${handle}`}
            onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); contentResize.current = { handle, x: event.clientX, y: event.clientY, frame: selectedFrame }; }}
            onPointerMove={moveFrameGesture} onPointerUp={endContentGesture} onPointerCancel={endContentGesture} />)}
        </div>
        <div className="content-edit-mask" aria-hidden="true" />
        <span className={`layer-label ${detachArmed ? "detach-armed" : ""}`}>{detachArmed ? "Release to detach" : "Frame content"}</span>
      </div>}
      <p className="sr-only" id={`image-instructions-${asset.id}`}>Use arrow keys to move the selected image. Use the resize and rotation buttons for keyboard adjustments.</p>
      <div className={`image-layer ${imageActive ? "image-editing" : ""}`} style={imageStyle} tabIndex={imageActive ? 0 : -1}
        role="group" aria-roledescription="movable image" aria-describedby={`image-instructions-${asset.id}`} aria-label={`Image ${asset.name}`}
        onKeyDown={(event) => { if (!imageActive) return; const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const; const direction = directions[event.key as keyof typeof directions]; if (direction) { event.preventDefault(); onElementStart(); placeElement(nudgeImage(element, direction, event.shiftKey ? 5 : 1)); onElementEnd(); } }}
        onPointerDown={(event) => { if (!imageActive) return; event.stopPropagation(); if (pickObject(event, activeLayer?.key ?? assetKey(asset.id))) return; event.currentTarget.setPointerCapture(event.pointerId); onElementStart(); imageDrag.current = { x: event.clientX, y: event.clientY, element }; }}
        onPointerMove={(event) => {
          const state = imageDrag.current;
          if (!state || activeMode !== "image") return;
          const span = gestureSpan(event, state);
          if (!span) return;
          const moved = dragTo({ box: state.element.box, pointer: span.start }, span.now);
          placeElement({ ...state.element, box: applySnap(moved, { layer: activeLayer?.key ?? assetKey(asset.id) }) });
        }}
        onPointerUp={(event) => {
          frameWrites.flush();
          const dragged = Boolean(imageDrag.current);
          imageDrag.current = null; clearSnap(); onElementEnd();
          if (!dragged) return;
          // Released over a frame: the image goes into that frame instead of
          // staying loose on the page.
          const point = pagePoint(event);
          const hit = point ? frameAt(frames, point.x, point.y) : null;
          if (hit) onFrameAttach(hit.id, asset.id);
        }} onPointerCancel={() => { frameWrites.flush(); imageDrag.current = null; clearSnap(); onElementEnd(); }}
        >
        <span className="layer-label">Image</span>
        {imageActive && HANDLES.map((handle) => <button key={handle} type="button"
          aria-label={`Resize image from ${handle}`} title={`Resize image from ${handle}`} className={`frame-handle image-handle handle-${handle}`}
          style={{ cursor: handleCursor(handle, element.box) }}
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onElementStart(); imageResize.current = { handle, x: event.clientX, y: event.clientY, element }; }}
          onPointerMove={handleImageResize} onPointerUp={() => { frameWrites.flush(); imageResize.current = null; clearSnap(); onElementEnd(); }} onPointerCancel={() => { frameWrites.flush(); imageResize.current = null; clearSnap(); onElementEnd(); }}
          onKeyDown={(event) => { const amount = event.shiftKey ? 5 : 1; const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0; const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0; if (dx || dy) { event.preventDefault(); onElementStart(); placeElement(keyResize(element, handle, dx, dy, event.shiftKey)); onElementEnd(); } }} />)}
        <button type="button" aria-label={`Rotate image, ${Math.round(element.box.rotation)} degrees`} title="Rotate image" className="rotation-handle"
          onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onElementStart(); imageRotate.current = { angle: angleToElementCentre(event, element), rotation: element.box.rotation, element }; }}
          onPointerMove={(event) => { const state = imageRotate.current; if (!state) return; const next = state.rotation + angleToElementCentre(event, state.element) - state.angle; placeElement({ ...state.element, box: rotateTo(state.element.box, next, event.shiftKey ? 15 : 0) }); }}
          onPointerUp={() => { frameWrites.flush(); imageRotate.current = null; onElementEnd(); }} onPointerCancel={() => { frameWrites.flush(); imageRotate.current = null; onElementEnd(); }}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onElementStart(); placeElement({ ...element, box: rotateTo(element.box, element.box.rotation + (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1)) }); onElementEnd(); } }} />
      </div>
      {activeMode === "crop" && <div className="crop-overlay" style={imageStyle}>
        <div className="crop-shade" aria-hidden="true" style={{ clipPath: `polygon(0% 0%, 0% 100%, ${crop.left * 100}% 100%, ${crop.left * 100}% ${crop.top * 100}%, ${crop.right * 100}% ${crop.top * 100}%, ${crop.right * 100}% ${crop.bottom * 100}%, ${crop.left * 100}% ${crop.bottom * 100}%, ${crop.left * 100}% 100%, 100% 100%, 100% 0%)` }} />
        <div className="crop-window" tabIndex={0} style={{ left: `${crop.left * 100}%`, top: `${crop.top * 100}%`, width: `${(crop.right - crop.left) * 100}%`, height: `${(crop.bottom - crop.top) * 100}%` }}
          aria-label="Crop image. Drag to position the source crop; use handles to resize."
          onKeyDown={(event) => { const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const; const direction = directions[event.key as keyof typeof directions]; if (direction) { event.preventDefault(); const amount = event.shiftKey ? .05 : .01; placeElement(cropImage(element, moveCrop(crop, direction === "left" ? -amount : direction === "right" ? amount : 0, direction === "up" ? -amount : direction === "down" ? amount : 0))); } }}
          {...cropProps("move")}>
          <div className="frame-outline" aria-hidden="true" />
          {HANDLES.map((handle) => <button key={handle} type="button" aria-label={`Resize crop from ${handle}`} title={`Resize crop from ${handle}`}
            className={`frame-handle handle-${handle}`} style={{ cursor: handleCursor(handle, element.box) }} {...cropProps(handle)} />)}
        </div>
      </div>}
    </div>
  </div>;

  /**
   * Comparison is one layer over the page rectangle, wiped or faded — not a
   * second copy of the scene. A wipe is a clip in screen space, which survives
   * any pan and zoom the viewport is in.
   */
  const comparison = compare && compareView !== "after" && <>
    <div className="compare-layer" style={{
      ...scrimStyle,
      opacity: compareView === "split" ? 1 : overlay / 100,
      clipPath: compareView === "split" ? `inset(0 ${100 - splitAt}% 0 0)` : undefined,
    }}><AssetImage asset={asset} fit="contain" large /></div>
    {compareView === "split" && <div ref={splitRef} className="compare-divider"
      style={{ ...scrimStyle, ["--split" as string]: `${splitAt}%` }}>
      <div className="compare-labels"><span>Original</span><span>Resized preview</span></div>
      <div role="separator" aria-label="Comparison split position" aria-valuenow={Math.round(splitAt)} tabIndex={0} className="split-handle"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); onSplit(Math.max(0, splitAt - 2)); }
          if (event.key === "ArrowRight") { event.preventDefault(); onSplit(Math.min(100, splitAt + 2)); }
        }}
        onPointerDown={(event) => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = splitRef.current?.getBoundingClientRect();
          if (rect) onSplit(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
        }}><span /></div>
    </div>}
  </>;

  return <div className={`content-pane editor-pane ${focusMode ? "focus-editor-pane" : ""}`}>
    <div className="editor-stage"
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
        {grouped
          ? <SelectionToolbar count={selectedItems.length} canDistribute={selectedItems.length > 2}
              onAlign={multi.onAlign} onDistribute={multi.onDistribute} />
          : assets.length > 0 && <ContextualToolbar mode={normalMode} onMode={setNormalMode} element={element} fit={doc.fit} onFit={onFit} onReplace={onImport} onElement={onElementAction}
              onCropStart={onCropStart} onCropDone={onCropDone} onCropCancel={onCropCancel} onCropReset={onCropReset} onToggleGrid={onToggleGrid} grid={guides.grid} />}
        <Button size="sm" variant="secondary" onClick={onImport}><Upload /> Import images</Button>
        <span className="editor-toolbar-note">{assets.length ? `${assets.length} image${assets.length === 1 ? "" : "s"}` : "Empty canvas — import when ready"}</span>
      </div>}
      {dropActive && <div className="editor-drop-overlay" role="status"><Upload /><strong>Drop images onto the canvas</strong><span>They will be placed as editable image layers</span></div>}
      {/* Rulers described the old fixed canvas and cannot describe a panned
          workspace. They stay behind their flag until they read the viewport. */}
      {!compare && <button className={`grid-toggle ${guides.grid ? "active" : ""}`}
        aria-pressed={guides.grid} aria-label="Toggle grid and guides" onClick={onToggleGrid}><Grid2X2 /></button>}

      <div ref={viewportRef} className={`viewport ${spacePan ? "panning" : ""}`} tabIndex={0}
        aria-label="Editor workspace. Hold Space and drag to pan, Ctrl and scroll to zoom."
        onPointerDown={(event) => {
          // Space or the middle button pans; anything else belongs to the
          // objects, which handle their own pointer events above this one.
          if (!spacePan && event.button !== 1) {
            // Bare workspace: the page used to fill this area, so clearing the
            // selection has to be handled out here now.
            if (event.target !== event.currentTarget) return;
            if (selectedFrame) {
              if (editingContent) onFrameContentDone();
              onFrameSelect(null);
            }
            // A sweep across the workspace selects (§19). It is resolved in page
            // percentages, so the same drag catches the same objects at 25% as
            // at 400%; holding a modifier adds to what is already selected.
            const box = event.currentTarget.getBoundingClientRect();
            const at = screenToPage(viewport, page, { x: event.clientX - box.left, y: event.clientY - box.top });
            if (!at) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            marquee.current = { from: at, base: event.shiftKey || event.ctrlKey || event.metaKey ? multi.selection : [] };
            setMarqueeArea(null);
            return;
          }
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          panGesture.current = { x: event.clientX, y: event.clientY, viewport };
        }}
        onPointerMove={(event) => {
          const sweep = marquee.current;
          if (sweep) {
            const box = event.currentTarget.getBoundingClientRect();
            const at = screenToPage(viewport, page, { x: event.clientX - box.left, y: event.clientY - box.top });
            if (!at) return;
            const { area, mode } = marqueeFrom(sweep.from, at);
            setMarqueeArea({ ...area, mode });
            multi.onSelect([...new Set([...sweep.base, ...marqueeHits(multi.items, area, mode)])]);
            return;
          }
          const state = panGesture.current;
          if (!state) return;
          const [x, y] = [event.clientX, event.clientY];
          frameWrites.schedule(() => onViewport(panViewport(state.viewport, x - state.x, y - state.y, page, viewSize)));
        }}
        onPointerUp={() => {
          frameWrites.flush();
          const sweep = marquee.current;
          if (sweep) {
            // A click with no sweep behind it is a click on empty space, which
            // clears the selection rather than selecting nothing at all.
            if (!marqueeArea || (marqueeArea.w < 0.4 && marqueeArea.h < 0.4)) multi.onSelect(sweep.base);
            marquee.current = null;
            setMarqueeArea(null);
          }
          panGesture.current = null;
        }}
        onPointerCancel={() => { marquee.current = null; setMarqueeArea(null); panGesture.current = null; }}
        onKeyDown={(event) => {
          // WCAG 2.2 asks for a single-pointer alternative to every drag, so
          // the arrows pan whenever an object has not claimed them first.
          if (event.defaultPrevented) return;
          const step = event.shiftKey ? 120 : 40;
          const dx = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
          const dy = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
          if (!dx && !dy) return;
          event.preventDefault();
          onViewport(panViewport(viewport, dx, dy, page, viewSize));
        }}>
        <div className="workspace-page-shadow" style={scrimStyle} aria-hidden="true" />
        {/* Rulers live in the pane, not in the scene: they measure the page in
            output pixels, with zero at the artboard's own corner, so a reading
            is the number that will appear in the exported file. Negative
            readings are the workspace outside the page. */}
        {guides.rulers && !compare && <div className="rulers" aria-hidden="true" style={{ top: `${rulerTop}px` }}>
          <div className="ruler ruler-h">
            {rulerTicks(viewport, page, "x", viewSize.width).map((tick) =>
              <span key={tick.value} className={tick.inside ? "tick" : "tick outside"} style={{ left: `${tick.at}px` }}>{tick.value}</span>)}
          </div>
          <div className="ruler ruler-v">
            {rulerTicks(viewport, page, "y", viewSize.height).map((tick) =>
              // The strip starts below the toolbar, so pane coordinates are
              // shifted by the same amount to keep a tick beside what it measures.
              <span key={tick.value} className={tick.inside ? "tick" : "tick outside"} style={{ top: `${tick.at - rulerTop}px` }}>{tick.value}</span>)}
          </div>
          <div className="ruler-corner" />
        </div>}
        {resized}
        {frameActions}
        {comparison}
      </div>
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
 * nobody read.  The appearance picker went the same way when dark mode was
 * removed, leaving this screen as a signpost to where the real settings live
 * rather than a panel of its own.
 */
export function SettingsScreen() {
  return <div className="full-pane settings-pane">
    <div className="settings-card-wrap">
      <header className="settings-intro">
        <h1>Settings</h1>
        <p>Keyboard shortcuts live under the <strong>?</strong> button in the top bar.
          Presets are managed on the Presets screen, and canvas guides in the inspector.</p>
      </header>
    </div>
  </div>;
}
