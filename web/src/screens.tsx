import { useRef, useState } from "react";
import {
  Check, ChevronRight, Copy, FileImage, FolderOpen, Layers3, ListFilter, Package, Pencil,
  Plus, Search, Share2, Sparkles, Trash2, TriangleAlert, Upload, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SHORTCUTS } from "@/src/dialogs";
import {
  megabytes, presetById, ratioLabel, resolutionOf, snapBox, statusOf, warningReason,
  type Asset, type Box, type Doc, type DupPolicy, type Format, type GalleryFilter,
  type Preset, type Resolution, type Status, type WarningReason,
} from "@/src/flow";

export type Guides = { grid: boolean; rulers: boolean; snapGrid: boolean; snapSafe: boolean };
export const defaultGuides: Guides = { grid: true, rulers: true, snapGrid: true, snapSafe: true };

export type CompareView = "split" | "before" | "after";

export type AppSettings = {
  defaultPresetId: string;
  autoCrop: boolean;
  theme: "light" | "dark" | "system";
  hardware: boolean;
  gpuPriority: "primary" | "high" | "low";
  threads: number;
  ram: number;
};
export const defaultSettings: AppSettings = {
  defaultPresetId: "zalando", autoCrop: false, theme: "dark", hardware: true, gpuPriority: "primary", threads: 16, ram: 32,
};

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

/* -------------------------------------------------------------------- import */

export function ImportScreen({ policy, onPolicy, onFiles, onFolders, onCloud, onDrop }: {
  policy: DupPolicy; onPolicy: (value: DupPolicy) => void;
  onFiles: () => void; onFolders: () => void; onCloud: () => void; onDrop: (files: FileList) => void;
}) {
  const [dragging, setDragging] = useState(false);
  return <div className="empty-workspace"
    onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={(event) => { event.preventDefault(); setDragging(false); onDrop(event.dataTransfer.files); }}>
    <button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={onFiles}>
      <span className="drop-icon"><FolderOpen aria-hidden="true" /><Upload aria-hidden="true" /></span>
      <span>Drop images here&nbsp; or</span>
      <strong>Browse (PNG, JPG, WEBP, TIFF)</strong>
    </button>
    <div className="import-actions">
      <Button size="sm" onClick={onFiles}>Add files…</Button>
      <Button size="sm" onClick={onFolders}>Add folders…</Button>
      <Button size="sm" onClick={onCloud}>Import from cloud…</Button>
    </div>
    <label className="policy-row">
      <span>Handling existing files</span>
      <Select value={policy} onValueChange={(value) => onPolicy(value as DupPolicy)}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="skip">Skip (default)</SelectItem>
          <SelectItem value="overwrite">Overwrite</SelectItem>
          <SelectItem value="rename">Rename</SelectItem>
        </SelectContent>
      </Select>
    </label>
  </div>;
}

export function IdleInspector() {
  return <aside className="idle-inspector" aria-label="Resize inspector"><Sparkles aria-hidden="true" fill="currentColor" /></aside>;
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
  // The top-bar zoom drives grid density here (Engine spec §24).
  const columnWidth = Math.round(112 * (zoom / 100));
  const facets = filter.formats.length + filter.resolutions.length + filter.errorTypes.length;
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
      {assets.map((asset) => {
        const status = statusOf(asset, target);
        const isSelected = selected.includes(asset.id);
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
              <ProductPlaceholder kind={asset.kind} />
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
  </div>;
}

/* -------------------------------------------------------------------- editor */

export function Editor({ asset, assets, selected, doc, zoom, compare, compareView, splitAt, overlay, guides, target, onBox, onSplit, onChoose, onToggleGrid }: {
  asset: Asset; assets: Asset[]; selected: number[]; doc: Doc; zoom: number;
  compare: boolean; compareView: CompareView; splitAt: number; overlay: number; guides: Guides; target: Preset;
  onBox: (box: Box) => void; onSplit: (value: number) => void; onChoose: (asset: Asset) => void; onToggleGrid: () => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null);

  const place = (box: Box) => onBox(snapBox(box, doc.safeX, doc.safeY, { safe: guides.snapSafe, grid: guides.snapGrid }));
  const nudge = (dx: number, dy: number) => place({ ...doc.box, x: doc.box.x + dx, y: doc.box.y + dy });

  const canvasStyle = { aspectRatio: `${doc.width} / ${doc.height}`, background: doc.background, transform: `scale(${zoom / 100})` };
  const objectStyle = {
    left: `${doc.box.x}%`, top: `${doc.box.y}%`, width: `${doc.box.w}%`, height: `${doc.box.h}%`,
    transform: `scale(${doc.flipH ? -1 : 1}, ${doc.flipV ? -1 : 1})`,
  };

  const resized = <div ref={canvasRef} className="canvas" style={canvasStyle}>
    {guides.grid && <div className="canvas-grid" aria-hidden="true" />}
    <div className="safe-area" style={{ inset: `${doc.safeY}% ${doc.safeX}%` }} />
    <div className="editable-object" tabIndex={0} style={objectStyle}
      aria-label={`${asset.name}. Drag or use arrow keys to reposition inside the safe area.`}
      onKeyDown={(event) => {
        const amount = event.shiftKey ? 5 : 0.5;
        if (event.key === "ArrowLeft") { event.preventDefault(); nudge(-amount, 0); }
        if (event.key === "ArrowRight") { event.preventDefault(); nudge(amount, 0); }
        if (event.key === "ArrowUp") { event.preventDefault(); nudge(0, -amount); }
        if (event.key === "ArrowDown") { event.preventDefault(); nudge(0, amount); }
      }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, box: doc.box }; }}
      onPointerMove={(event) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!drag.current || !rect) return;
        place({
          ...drag.current.box,
          x: drag.current.box.x + ((event.clientX - drag.current.x) / rect.width) * 100,
          y: drag.current.box.y + ((event.clientY - drag.current.y) / rect.height) * 100,
        });
      }}
      onPointerUp={() => { drag.current = null; }}>
      <div className="selection-bounds"><i /><i /><i /><i /></div>
      <ProductPlaceholder kind={asset.kind} large />
    </div>
  </div>;

  const original = <div className="canvas original-canvas" style={{ ...canvasStyle, background: "#f5f5f3" }}>
    <div className="original-object" style={{ opacity: overlay / 100 }}><ProductPlaceholder kind={asset.kind} large /></div>
  </div>;

  return <div className="content-pane editor-pane">
    <div className="editor-stage">
      {/* Panel 10: rulers and the grid toggle sit on the canvas chrome. */}
      {guides.rulers && !compare && <>
        <div className="ruler ruler-top" aria-hidden="true" />
        <div className="ruler ruler-left" aria-hidden="true" />
        <button className={`grid-toggle ${guides.grid ? "active" : ""}`} aria-pressed={guides.grid} aria-label="Toggle grid and guides" onClick={onToggleGrid}>#</button>
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
    <div className="filmstrip">{assets.map((item) => <button key={item.id} className={item.id === asset.id ? "active" : ""} onClick={() => onChoose(item)}>
      <ProductPlaceholder kind={item.kind} />
      <span>{item.name.replace(/\.[^.]+$/, "")}</span>
      <StatusBadge status={statusOf(item, target)} />
      {selected.includes(item.id) && <Check className="film-check" />}
    </button>)}</div>
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
            <ProductPlaceholder kind={asset.kind} />
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

type SettingsSection = "gpu" | "shortcuts" | "paths";

/** Panel 12: General on the left, a section list in the middle, its detail on the right. */
export function SettingsScreen({ presets, settings, onSettings }: {
  presets: Preset[]; settings: AppSettings; onSettings: (next: AppSettings) => void;
}) {
  const [section, setSection] = useState<SettingsSection>("gpu");
  const sections: [SettingsSection, string][] = [["gpu", "GPU acceleration & performance"], ["shortcuts", "Keyboard shortcuts"], ["paths", "Default export paths"]];

  return <div className="full-pane settings-pane">
    <section>
      <h1>App Settings</h1>
      <h2>General</h2>
      <label className="setting-line"><span>Default preset</span>
        <Select value={settings.defaultPresetId} onValueChange={(value) => onSettings({ ...settings, defaultPresetId: value })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="setting-line"><span>Auto-crop new images</span>
        <Switch checked={settings.autoCrop} onCheckedChange={(value) => onSettings({ ...settings, autoCrop: value })} />
      </label>
      <div className="setting-line"><span>App theme</span>
        <div className="segmented">{(["light", "dark", "system"] as const).map((theme) =>
          <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => onSettings({ ...settings, theme })}>
            {theme[0].toUpperCase() + theme.slice(1)}
          </button>)}
        </div>
      </div>
    </section>
    <section>
      <h2>Settings</h2>
      {sections.map(([value, label]) => <button key={value} className={`settings-card ${section === value ? "active" : ""}`} aria-current={section === value} onClick={() => setSection(value)}>
        {label} <ChevronRight />
      </button>)}
    </section>
    <section>
      <h2>Settings Details</h2>
      {section === "gpu" && <>
        <label className="setting-line"><span>Hardware acceleration</span>
          <Switch checked={settings.hardware} onCheckedChange={(value) => onSettings({ ...settings, hardware: value })} />
        </label>
        <label className="field-label">Advanced GPU priority</label>
        <Select value={settings.gpuPriority} disabled={!settings.hardware} onValueChange={(value) => onSettings({ ...settings, gpuPriority: value as AppSettings["gpuPriority"] })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="primary">Primary</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
        </Select>
        <div className="slider-label"><span>Thread count</span><strong>{settings.threads}</strong></div>
        <Slider value={[settings.threads]} min={1} max={16} step={1} onValueChange={([value]) => onSettings({ ...settings, threads: value })} />
        <div className="slider-label"><span>RAM allocation</span><strong>{settings.ram} GB</strong></div>
        <Slider value={[settings.ram]} min={4} max={64} step={4} onValueChange={([value]) => onSettings({ ...settings, ram: value })} />
        <p className="inspector-note">Higher allocation keeps large batches resident in memory instead of paging tiles to disk.</p>
      </>}
      {section === "shortcuts" && SHORTCUTS.map(([keys, label]) => <div key={keys} className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>)}
      {section === "paths" && <>
        <p className="inspector-note">Export writes here unless the export dialog overrides it for a single run.</p>
        <label className="field-label">Default output folder</label>
        <div className="output-folder"><input value="C:\\Products\\MINIMA_Output" readOnly aria-label="Default output folder" /><FolderOpen /></div>
      </>}
    </section>
  </div>;
}

