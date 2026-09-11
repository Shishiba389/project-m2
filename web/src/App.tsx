import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, CircleHelp, Columns2, Download, Expand,
  FileImage, FolderOpen, Image as ImageIcon, Import, Layers3, Minus, Package, PanelLeft,
  PanelRight, Plus, Redo2, RotateCcw, Search, Settings, Sparkles, Trash2, TriangleAlert,
  Undo2, Upload, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  anchor, backTarget, countByStatus, fitBox, mergeImport, objectScale, presetById, PRESETS,
  ratioLabel, scopeAssets, snapBox, statusOf,
  type Align, type Asset, type Box, type DupPolicy, type Fit, type Preset, type Screen,
  type Scope, type Status,
} from "@/src/flow";

const seedAssets: Asset[] = [
  { id: 1, name: "8809968136217_1.png", kind: "shoe", src: { w: 1801, h: 2600 }, processed: true, fixed: false, corrupt: false },
  { id: 2, name: "8809968136217_2.png", kind: "shoe", src: { w: 1801, h: 2600 }, processed: true, fixed: false, corrupt: false },
  { id: 3, name: "8809968136217_3.png", kind: "shoe", src: { w: 1600, h: 1600 }, processed: true, fixed: false, corrupt: false },
  { id: 4, name: "8809968136217_4.png", kind: "shoe", src: { w: 1801, h: 2600 }, processed: true, fixed: false, corrupt: false },
  { id: 5, name: "8809968136217_5.png", kind: "fashion", src: { w: 1801, h: 2600 }, processed: true, fixed: false, corrupt: false },
  { id: 6, name: "8809968136217_6.png", kind: "fashion", src: { w: 1801, h: 2600 }, processed: false, fixed: false, corrupt: false },
  { id: 7, name: "8809968136217_7.png", kind: "beauty", src: { w: 2000, h: 2000 }, processed: false, fixed: false, corrupt: false },
  { id: 8, name: "8809968136217_8.png", kind: "beauty", src: { w: 1801, h: 2600 }, processed: false, fixed: false, corrupt: false },
  { id: 9, name: "8809968136217_9.png", kind: "bottle", src: { w: 1200, h: 1600 }, processed: true, fixed: false, corrupt: false },
  { id: 10, name: "8809968136217_10.png", kind: "beauty", src: { w: 1801, h: 2600 }, processed: true, fixed: false, corrupt: false },
  { id: 11, name: "8809968136217_11.png", kind: "fashion", src: { w: 1801, h: 2600 }, processed: false, fixed: false, corrupt: false },
  { id: 12, name: "8809968136217_12.png", kind: "shoe", src: { w: 1801, h: 2600 }, processed: true, fixed: false, corrupt: true },
];

type Doc = {
  presetId: string;
  width: number;
  height: number;
  lock: boolean;
  /** Ratio captured when the aspect lock engaged, so typing stays predictable. */
  ratio: number;
  fit: Fit;
  align: Align;
  safeX: number;
  safeY: number;
  background: string;
  box: Box;
};

const ALIGNMENTS: Align[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
const FILTERS: ("All" | Status)[] = ["All", "Completed", "Pending", "Warning", "Error"];
const SHORTCUTS: [string, string][] = [
  ["Ctrl + A", "Select all"], ["Ctrl + Backspace", "Remove images"], ["Enter", "Open in Editor"],
  ["Ctrl + Z", "Undo"], ["Ctrl + Shift + Z", "Redo"], ["Space", "Compare original"],
  ["Ctrl + Shift + F", "Focus mode"], ["Esc", "Exit focus mode"], ["Arrows", "Nudge object"],
  ["Shift + Arrows", "Nudge ×10"],
];

const srcRatio = (asset: Asset) => asset.src.w / asset.src.h;
const megabytes = (asset: Asset) => (asset.src.w * asset.src.h * 3) / 1_048_576;

function docFromPreset(preset: Preset, asset: Asset): Doc {
  const canvasRatio = preset.width / preset.height;
  return {
    presetId: preset.id, width: preset.width, height: preset.height, lock: true, ratio: canvasRatio,
    fit: preset.fit, align: preset.align, safeX: preset.safeX, safeY: preset.safeY,
    background: preset.background,
    box: fitBox(preset.fit, srcRatio(asset), canvasRatio, preset.safeX, preset.safeY),
  };
}

const initialDoc = docFromPreset(presetById("zalando"), seedAssets[1]);

/** Undo/redo over the document snapshot only — navigation is never undoable. */
function useHistory(initial: Doc) {
  const [stack, setStack] = useState({ past: [] as Doc[], present: initial, future: [] as Doc[] });
  const setDoc = useCallback((next: Doc | ((current: Doc) => Doc)) => {
    setStack((state) => {
      const present = typeof next === "function" ? next(state.present) : next;
      if (present === state.present) return state;
      return { past: [...state.past, state.present].slice(-60), present, future: [] };
    });
  }, []);
  const undo = useCallback(() => setStack((state) => state.past.length
    ? { past: state.past.slice(0, -1), present: state.past[state.past.length - 1], future: [state.present, ...state.future] }
    : state), []);
  const redo = useCallback(() => setStack((state) => state.future.length
    ? { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) }
    : state), []);
  return { doc: stack.present, setDoc, undo, redo, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}

function ProductPlaceholder({ kind, large = false }: { kind: Asset["kind"]; large?: boolean }) {
  const label = kind === "shoe" ? "FOOTWEAR" : kind === "beauty" ? "BEAUTY" : kind === "fashion" ? "APPAREL" : "FRAGRANCE";
  return <div className={`product-placeholder product-${kind} ${large ? "product-large" : ""}`} aria-label="Product image placeholder"><Package aria-hidden="true" strokeWidth={1.25} /><span>{label}</span></div>;
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status === "Completed" && <Check size={12} />}{status === "Warning" && <TriangleAlert size={12} />}{status === "Error" && <X size={12} />}{status === "Pending" && <span className="status-dot" />}{status}</span>;
}

export function MinimaWorkspace() {
  const [assets, setAssets] = useState(seedAssets);
  const [screen, setScreen] = useState<Screen>("gallery");
  const [imageScreen, setImageScreen] = useState<"gallery" | "editor">("gallery");
  const [selected, setSelected] = useState<number[]>([2, 3, 4]);
  const [activeId, setActiveId] = useState(2);
  const [filter, setFilter] = useState<"All" | Status>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "date" | "size">("name");
  const [scope, setScope] = useState<Scope>("selected");
  const [policy, setPolicy] = useState<DupPolicy>("skip");
  const [compare, setCompare] = useState(false);
  const [focus, setFocus] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [exporting, setExporting] = useState<{ done: number; failed: string[]; paused: boolean } | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const active = assets.find((asset) => asset.id === activeId) ?? assets[0];
  const { doc, setDoc, undo, redo, canUndo, canRedo } = useHistory(initialDoc);

  /** The live resize target: the preset row with any inspector edits layered on. */
  const target: Preset = useMemo(() => ({
    ...presetById(doc.presetId), width: doc.width, height: doc.height, safeX: doc.safeX, safeY: doc.safeY, align: doc.align, fit: doc.fit,
  }), [doc]);

  const counts = useMemo(() => countByStatus(assets, target), [assets, target]);
  const needsAttention = counts.Warning + counts.Error;
  const exportQueue = useMemo(() => assets.filter((asset) => statusOf(asset, target) !== "Pending"), [assets, target]);
  const scoped = scopeAssets(scope, assets, selected, activeId);

  const visible = useMemo(() => {
    const rows = assets.filter((asset) =>
      (filter === "All" || statusOf(asset, target) === filter) &&
      asset.name.toLowerCase().includes(query.trim().toLowerCase()));
    const compareBy = sort === "name"
      ? (a: Asset, b: Asset) => a.name.localeCompare(b.name, undefined, { numeric: true })
      : sort === "date" ? (a: Asset, b: Asset) => b.id - a.id
      : (a: Asset, b: Asset) => megabytes(b) - megabytes(a);
    return [...rows].sort(compareBy);
  }, [assets, filter, query, sort, target]);

  /** The only screen navigator. Modifiers that need the canvas force the editor. */
  const goto = useCallback((next: Screen) => {
    setScreen(next);
    if (next === "gallery" || next === "editor") setImageScreen(next);
    if (next !== "editor") setCompare(false);
  }, []);

  const touch = useCallback(() => {
    setSaving(true);
    window.setTimeout(() => setSaving(false), 700);
  }, []);

  const openEditor = useCallback((asset: Asset) => {
    setActiveId(asset.id);
    setDoc((current) => ({ ...current, box: fitBox(current.fit, srcRatio(asset), current.width / current.height, current.safeX, current.safeY) }));
    goto("editor");
  }, [goto, setDoc]);

  const chooseAsset = (asset: Asset, multi = false, range = false) => {
    setActiveId(asset.id);
    setSelected((current) => {
      if (range && current.length) {
        const from = visible.findIndex((item) => item.id === current[current.length - 1]);
        const to = visible.findIndex((item) => item.id === asset.id);
        if (from >= 0 && to >= 0) return visible.slice(Math.min(from, to), Math.max(from, to) + 1).map((item) => item.id);
      }
      if (multi) return current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id];
      return [asset.id];
    });
  };

  const applyPreset = (id: string) => {
    setDoc(docFromPreset(presetById(id), active));
    touch();
  };

  /** The resize step commits: scoped assets become processed, statuses recompute. */
  const runApply = () => {
    if (processing || !scoped.length) return;
    setProcessing(true);
    setProgress(8);
    const ids = scoped.map((asset) => asset.id);
    const timer = window.setInterval(() => setProgress((value) => {
      if (value < 100) return Math.min(100, value + 12);
      window.clearInterval(timer);
      setProcessing(false);
      setAssets((current) => current.map((asset) => ids.includes(asset.id) ? { ...asset, processed: true } : asset));
      touch();
      return 100;
    }), 110);
  };

  const autoFix = () => {
    setAssets((current) => current.map((asset) =>
      !asset.corrupt && statusOf(asset, target) === "Warning" ? { ...asset, fixed: true } : asset));
    touch();
  };

  const importFiles = (incoming: FileList | null) => {
    const files = Array.from(incoming ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const merged = mergeImport(assets, files.map((file) => ({ name: file.name })), policy);
    setAssets(merged.assets);
    setSelected([]);
    goto("gallery");
    touch();
  };

  const removeAssets = (keepSelected: boolean) => {
    const doomed = keepSelected ? assets.filter((asset) => !selected.includes(asset.id)) : assets.filter((asset) => selected.includes(asset.id));
    const ids = doomed.map((asset) => asset.id);
    const left = assets.filter((asset) => !ids.includes(asset.id));
    setAssets(left);
    setSelected([]);
    setRemoveOpen(false);
    if (left.length) setActiveId(left[0].id); else goto("import");
    touch();
  };

  const startExport = () => {
    setExportOpen(false);
    setExporting({ done: 0, failed: [], paused: false });
  };

  useEffect(() => {
    if (!exporting || exporting.paused || exporting.done >= exportQueue.length) return;
    const timer = window.setTimeout(() => setExporting((current) => {
      if (!current) return current;
      const file = exportQueue[current.done];
      return {
        ...current,
        done: current.done + 1,
        failed: file?.corrupt ? [...current.failed, `${file.name}: Access denied`] : current.failed,
      };
    }), 90);
    return () => window.clearTimeout(timer);
  }, [exporting, exportQueue]);

  useEffect(() => {
    if (!assets.length) goto("import");
  }, [assets.length, goto]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName);
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setFocus((value) => !value); if (screen !== "editor") goto("editor"); return; }
      if (mod && event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); redo(); return; }
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return; }
      if (event.key === "Escape") { setFocus(false); return; }
      if (typing) return;
      if (mod && event.key.toLowerCase() === "a" && screen === "gallery") { event.preventDefault(); setSelected(visible.map((asset) => asset.id)); return; }
      if (mod && event.key === "Backspace" && selected.length) { event.preventDefault(); setRemoveOpen(true); return; }
      if (event.key === "Enter" && screen === "gallery") { event.preventDefault(); openEditor(active); return; }
      if (event.code === "Space") { event.preventDefault(); setCompare(true); if (screen !== "editor") goto("editor"); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setCompare(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [active, goto, openEditor, redo, screen, selected.length, undo, visible]);

  const step = (delta: number) => {
    const at = assets.findIndex((asset) => asset.id === activeId);
    const next = assets[(at + delta + assets.length) % assets.length];
    setActiveId(next.id);
  };

  if (focus) return <FocusWorkspace asset={active} zoom={zoom} onZoom={setZoom} onStep={step} onExit={() => setFocus(false)} />;

  const back = backTarget(screen, assets.length > 0);
  const zoomTargetLabel = screen === "editor" ? "canvas zoom" : "thumbnail size";
  const zoomEnabled = screen === "editor" || screen === "gallery";

  return <main className={`minima-app ${railOpen ? "" : "rail-collapsed"} ${inspectorOpen ? "" : "inspector-collapsed"}`}>
    <header className="topbar">
      <div className="topbar-left">
        <span className="window-controls" aria-hidden="true"><i /><i /><i /></span>
        <Button variant="ghost" size="icon" aria-label="Toggle navigation rail" aria-pressed={railOpen} onClick={() => setRailOpen((value) => !value)}><PanelLeft /></Button>
        {back && <Button variant="ghost" size="sm" className="back-button" onClick={() => goto(back)}><ArrowLeft /> Back</Button>}
        <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={undo}><Undo2 /></Button>
        <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={redo}><Redo2 /></Button>
      </div>
      <div className="document-name">{screen === "editor" ? active.name : screen === "settings" ? "App Settings" : screen === "presets" ? "Presets Manager" : screen === "review" ? "Error Review & Diagnostics" : "MINIMA Resize"}</div>
      <div className="topbar-actions">
        <div className="zoom-control" role="group" aria-label={`Zoom — ${zoomTargetLabel}`}>
          <button aria-label="Zoom out" disabled={!zoomEnabled} onClick={() => setZoom((value) => Math.max(25, value - 25))}><Minus size={14} /></button>
          <span>{zoom}%</span>
          <button aria-label="Zoom in" disabled={!zoomEnabled} onClick={() => setZoom((value) => Math.min(400, value + 25))}><Plus size={14} /></button>
        </div>
        <Button variant="ghost" size="icon" aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}><PanelRight /></Button>
        <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><CircleHelp /></Button>
      </div>
    </header>

    <aside className="rail" aria-label="Main navigation">
      <div className="rail-main">
        <RailButton icon={Import} label="Import" active={screen === "import"} onClick={() => goto("import")} />
        <RailButton icon={ImageIcon} label="Images" active={screen === "gallery" || screen === "editor" || screen === "review"} disabled={!assets.length} onClick={() => goto(imageScreen)} />
        <RailButton icon={Layers3} label="Presets" active={screen === "presets"} onClick={() => goto("presets")} />
        <RailButton icon={Upload} label="Export" disabled={!exportQueue.length} onClick={() => setExportOpen(true)} />
      </div>
      <div className="rail-bottom">
        <RailButton icon={Settings} label="Settings" active={screen === "settings"} onClick={() => goto("settings")} />
      </div>
    </aside>

    <section className="workspace">
      {screen === "import" && <ImportScreen policy={policy} onPolicy={setPolicy} onFiles={() => filesInput.current?.click()} onFolders={() => folderInput.current?.click()} onDrop={importFiles} />}
      {screen === "presets" && <PresetManager activeId={doc.presetId} onApply={(id) => { applyPreset(id); goto(assets.length ? imageScreen : "import"); }} />}
      {screen === "settings" && <SettingsScreen />}

      {screen === "gallery" && <Gallery assets={visible} selected={selected} counts={counts} filter={filter} query={query} sort={sort} zoom={zoom} needsAttention={needsAttention} target={target} onFilter={setFilter} onQuery={setQuery} onSort={setSort} onChoose={chooseAsset} onOpen={openEditor} onReview={() => goto("review")} onRemove={() => setRemoveOpen(true)} />}
      {screen === "editor" && <Editor asset={active} assets={assets} selected={selected} doc={doc} zoom={zoom} compare={compare} target={target} onBox={(box) => setDoc((current) => ({ ...current, box }))} onChoose={(asset) => openEditor(asset)} />}
      {screen === "review" && <Review assets={assets.filter((asset) => ["Warning", "Error"].includes(statusOf(asset, target)))} target={target} onOpen={openEditor} onAutoFix={autoFix} onRetry={runApply} />}

      {inspectorOpen && (screen === "import" || screen === "presets" || screen === "settings"
        ? <IdleInspector />
        : <Inspector doc={doc} target={target} asset={active} scope={scope} scopeCount={scoped.length} selectedCount={selected.length} totalCount={assets.length} processing={processing} progress={progress} onPreset={applyPreset} onDoc={setDoc} onScope={setScope} onApply={runApply} onFocus={() => { goto("editor"); setFocus(true); }} />)}
    </section>

    <footer className="statusbar">
      <span>{saving ? "Saving…" : "All changes saved"}{assets.length ? ` · ${selected.length} of ${assets.length} selected` : " · no images"}</span>
      <div className="status-actions">
        {needsAttention > 0 && <Button variant="ghost" size="sm" onClick={() => goto("review")}><TriangleAlert /> {needsAttention} need attention</Button>}
        <Button variant="ghost" size="sm" aria-pressed={compare} disabled={!assets.length} onClick={() => { goto("editor"); setCompare((value) => !value); }}><Columns2 /> Compare</Button>
        <div className="view-switch" role="group" aria-label="Workspace view">
          <button className={screen === "gallery" ? "active" : ""} disabled={!assets.length} onClick={() => goto("gallery")}>Gallery</button>
          <button className={screen === "editor" ? "active" : ""} disabled={!assets.length} onClick={() => goto("editor")}>Editor</button>
        </div>
        <Button size="sm" disabled={!exportQueue.length} onClick={() => setExportOpen(true)}><Download /> Export</Button>
      </div>
      <span>{assets.length ? `${active.src.w} × ${active.src.h} px · ${ratioLabel(doc.width, doc.height)} · RGB · ${megabytes(active).toFixed(1)} MB` : ""}</span>
    </footer>

    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} queue={exportQueue} onStart={startExport} />
    <ExportProgress state={exporting} total={exportQueue.length} onPause={() => setExporting((current) => current && { ...current, paused: !current.paused })} onClose={() => setExporting(null)} />
    <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <RemoveDialog open={removeOpen} onOpenChange={setRemoveOpen} selected={selected.length} total={assets.length} onRemove={removeAssets} />

    <input ref={filesInput} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => importFiles(event.target.files)} />
    <input ref={folderInput} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => importFiles(event.target.files)}
      // @ts-expect-error non-standard folder picker, supported in Chromium and WebKit
      webkitdirectory="" />
  </main>;
}

function RailButton({ icon: Icon, label, active, disabled, onClick }: { icon: typeof Import; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} disabled={disabled} onClick={onClick}><Icon aria-hidden="true" /><span>{label}</span></button>;
}

function ImportScreen({ policy, onPolicy, onFiles, onFolders, onDrop }: { policy: DupPolicy; onPolicy: (value: DupPolicy) => void; onFiles: () => void; onFolders: () => void; onDrop: (files: FileList) => void }) {
  const [dragging, setDragging] = useState(false);
  return <div className="empty-workspace" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); onDrop(event.dataTransfer.files); }}>
    <button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={onFiles}>
      <span className="drop-icon"><FolderOpen aria-hidden="true" /><Upload aria-hidden="true" /></span>
      <span>Drop images here&nbsp; or</span>
      <strong>Browse (PNG, JPG, WEBP, TIFF)</strong>
    </button>
    <div className="import-actions">
      <Button size="sm" onClick={onFiles}>Add files…</Button>
      <Button size="sm" variant="secondary" onClick={onFolders}>Add folders…</Button>
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
    </div>
  </div>;
}

function IdleInspector() {
  return <aside className="idle-inspector" aria-label="Resize inspector"><Sparkles aria-hidden="true" fill="currentColor" /></aside>;
}

function Gallery({ assets, selected, counts, filter, query, sort, zoom, needsAttention, target, onFilter, onQuery, onSort, onChoose, onOpen, onReview, onRemove }: {
  assets: Asset[]; selected: number[]; counts: Record<string, number>; filter: string; query: string; sort: string; zoom: number; needsAttention: number; target: Preset;
  onFilter: (value: "All" | Status) => void; onQuery: (value: string) => void; onSort: (value: "name" | "date" | "size") => void;
  onChoose: (asset: Asset, multi?: boolean, range?: boolean) => void; onOpen: (asset: Asset) => void; onReview: () => void; onRemove: () => void;
}) {
  // Top-bar zoom drives grid density here (Engine spec §24).
  const columnWidth = Math.round(112 * (zoom / 100));
  return <div className="content-pane gallery-pane">
    <div className="gallery-toolbar">
      <div className="filter-tabs">{FILTERS.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>{item}<span>{counts[item]}</span></button>)}</div>
      <div className="toolbar-tools">
        <label className="search-box"><Search aria-hidden="true" /><span className="sr-only">Search images</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search files…" /></label>
        <Select value={sort} onValueChange={(value) => onSort(value as "name" | "date" | "size")}>
          <SelectTrigger aria-label="Sort images" className="sort-select"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="name">Sort: name</SelectItem><SelectItem value="date">Sort: date</SelectItem><SelectItem value="size">Sort: size</SelectItem></SelectContent>
        </Select>
        {needsAttention > 0 && <Button size="sm" variant="secondary" onClick={onReview}><TriangleAlert /> Review {needsAttention}</Button>}
        <Button size="sm" variant="ghost" disabled={!selected.length} onClick={onRemove}><Trash2 /> Remove</Button>
      </div>
    </div>
    <p className="gallery-summary">{counts.All} images · {counts.Completed} completed · {counts.Pending} pending · {needsAttention} need attention · preset {presetById(target.id).label}</p>
    <div className="asset-grid" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${columnWidth}px,1fr))` }}>
      {assets.map((asset) => {
        const status = statusOf(asset, target);
        const isSelected = selected.includes(asset.id);
        return <article key={asset.id} role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`${asset.name}, ${status}`} className={`asset-card ${isSelected ? "selected" : ""}`}
          onClick={(event) => onChoose(asset, event.ctrlKey || event.metaKey, event.shiftKey)}
          onDoubleClick={() => onOpen(asset)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); onOpen(asset); }
            if (event.key === " ") { event.preventDefault(); onChoose(asset, event.ctrlKey || event.metaKey, event.shiftKey); }
          }}>
          <ProductPlaceholder kind={asset.kind} />
          <div className="asset-card-footer"><span className="asset-name">{asset.name}</span><StatusBadge status={status} /></div>
          {isSelected && <span className="selection-check"><Check /></span>}
        </article>;
      })}
      {!assets.length && <p className="gallery-empty">No images match this filter.</p>}
    </div>
  </div>;
}

function Editor({ asset, assets, selected, doc, zoom, compare, target, onBox, onChoose }: {
  asset: Asset; assets: Asset[]; selected: number[]; doc: Doc; zoom: number; compare: boolean; target: Preset;
  onBox: (box: Box) => void; onChoose: (asset: Asset) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; box: Box } | null>(null);

  const nudge = (dx: number, dy: number) => onBox(snapBox({ ...doc.box, x: doc.box.x + dx, y: doc.box.y + dy }, doc.safeX, doc.safeY));
  const canvasStyle = { aspectRatio: `${doc.width} / ${doc.height}`, background: doc.background, transform: `scale(${zoom / 100})` };
  const safeStyle = { inset: `${doc.safeY}% ${doc.safeX}%` };
  const boxStyle = { left: `${doc.box.x}%`, top: `${doc.box.y}%`, width: `${doc.box.w}%`, height: `${doc.box.h}%` };

  return <div className="content-pane editor-pane">
    <div className="editor-stage">
      {compare && <div className="compare-labels"><span>Original</span><span>Resized preview</span></div>}
      <div className={compare ? "compare-split" : "single-canvas"}>
        {compare && <div className="canvas" style={{ ...canvasStyle, background: "#f5f5f3" }}><div className="original-object"><ProductPlaceholder kind={asset.kind} large /></div></div>}
        <div ref={canvasRef} className="canvas" style={canvasStyle}>
          <div className="safe-area" style={safeStyle} />
          <div className="editable-object" tabIndex={0} style={boxStyle}
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
              onBox(snapBox({
                ...drag.current.box,
                x: drag.current.box.x + ((event.clientX - drag.current.x) / rect.width) * 100,
                y: drag.current.box.y + ((event.clientY - drag.current.y) / rect.height) * 100,
              }, doc.safeX, doc.safeY));
            }}
            onPointerUp={() => { drag.current = null; }}>
            <div className="selection-bounds"><i /><i /><i /><i /></div>
            <ProductPlaceholder kind={asset.kind} large />
          </div>
        </div>
      </div>
    </div>
    <div className="filmstrip">{assets.map((item) => <button key={item.id} className={item.id === asset.id ? "active" : ""} onClick={() => onChoose(item)}>
      <ProductPlaceholder kind={item.kind} />
      <span>{item.name.replace(".png", "")}</span>
      <StatusBadge status={statusOf(item, target)} />
      {selected.includes(item.id) && <Check className="film-check" />}
    </button>)}</div>
  </div>;
}

function Review({ assets, target, onOpen, onAutoFix, onRetry }: { assets: Asset[]; target: Preset; onOpen: (asset: Asset) => void; onAutoFix: () => void; onRetry: () => void }) {
  const fixable = assets.filter((asset) => !asset.corrupt).length;
  return <div className="content-pane review-pane">
    <div className="review-heading">
      <div><h1>Error Review &amp; Diagnostics</h1><p>Resolve exceptions before export. Target {presetById(target.id).label} · {target.width} × {target.height} px.</p></div>
      <div className="review-heading-actions">
        <Button variant="outline" onClick={onRetry}><RotateCcw /> Re-run preset</Button>
        <Button disabled={!fixable} onClick={onAutoFix}><Zap /> Auto-fix {fixable} (crop / pad)</Button>
      </div>
    </div>
    <div className="review-grid">{assets.map((asset) => {
      const status = statusOf(asset, target);
      return <article key={asset.id} className="review-card">
        <ProductPlaceholder kind={asset.kind} />
        <StatusBadge status={status} />
        <strong>{asset.name}</strong>
        <span>{asset.corrupt
          ? "Corrupted file — cannot be exported"
          : `Aspect mismatch · target ${ratioLabel(target.width, target.height)}, current ${ratioLabel(asset.src.w, asset.src.h)}`}</span>
        <Button size="sm" variant="secondary" onClick={() => onOpen(asset)}>Open in editor</Button>
      </article>;
    })}</div>
    {!assets.length && <p className="gallery-empty">Nothing needs attention.</p>}
  </div>;
}

function Inspector({ doc, target, asset, scope, scopeCount, selectedCount, totalCount, processing, progress, onPreset, onDoc, onScope, onApply, onFocus }: {
  doc: Doc; target: Preset; asset: Asset; scope: Scope; scopeCount: number; selectedCount: number; totalCount: number; processing: boolean; progress: number;
  onPreset: (id: string) => void; onDoc: (next: (current: Doc) => Doc) => void; onScope: (value: Scope) => void; onApply: () => void; onFocus: () => void;
}) {
  const resize = (patch: Partial<Doc>) => onDoc((current) => {
    const next = { ...current, ...patch };
    const canvasRatio = next.width / next.height;
    return { ...next, box: fitBox(next.fit, srcRatio(asset), canvasRatio, next.safeX, next.safeY) };
  });
  const setDimension = (edge: "width" | "height", value: number) => onDoc((current) => {
    if (!Number.isFinite(value) || value <= 0) return current;
    const next = edge === "width"
      ? { ...current, width: value, height: current.lock ? Math.round(value / current.ratio) : current.height }
      : { ...current, height: value, width: current.lock ? Math.round(value * current.ratio) : current.width };
    return { ...next, box: fitBox(next.fit, srcRatio(asset), next.width / next.height, next.safeX, next.safeY) };
  });

  return <aside className="inspector" aria-label="Resize inspector">
    <div className="inspector-heading"><strong>Resize Inspector</strong></div>
    <div className="inspector-body">
      <label className="field-label" htmlFor="preset">Preset</label>
      <Select value={doc.presetId} onValueChange={onPreset}>
        <SelectTrigger id="preset" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{PRESETS.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>)}</SelectContent>
      </Select>

      <label className="field-label">Canvas dimensions</label>
      <div className="dimension-row">
        <input aria-label="Canvas width" type="number" min={1} value={doc.width} onChange={(event) => setDimension("width", Number(event.target.value))} />
        <span>×</span>
        <input aria-label="Canvas height" type="number" min={1} value={doc.height} onChange={(event) => setDimension("height", Number(event.target.value))} />
        <span>px</span>
      </div>
      <label className="check-row">
        <Checkbox checked={doc.lock} onCheckedChange={(value) => onDoc((current) => ({ ...current, lock: Boolean(value), ratio: current.width / current.height }))} />
        Aspect ratio lock · {ratioLabel(doc.width, doc.height)}
      </label>

      <div className="segmented">{(["Fit", "Fill", "Stretch"] as const).map((mode) => <button key={mode} className={doc.fit === mode ? "active" : ""} onClick={() => resize({ fit: mode })}>{mode}</button>)}</div>

      <label className="field-label">Alignment matrix</label>
      <div className="alignment-grid">{ALIGNMENTS.map((position) => <button key={position} className={position === doc.align ? "active" : ""} aria-label={`Align ${position.replace("-", " ")}`} title={`Align ${position.replace("-", " ")}`}
        onClick={() => onDoc((current) => ({ ...current, align: position, box: anchor(position, current.box, current.safeX, current.safeY) }))}><span /></button>)}</div>

      <div className="slider-label"><span>Safe area · vertical</span><strong>{doc.safeY.toFixed(2)}%</strong></div>
      <Slider value={[doc.safeY]} onValueChange={([value]) => resize({ safeY: value })} max={30} step={0.5} />
      <div className="slider-label"><span>Safe area · horizontal</span><strong>{doc.safeX.toFixed(2)}%</strong></div>
      <Slider value={[doc.safeX]} onValueChange={([value]) => resize({ safeX: value })} max={30} step={0.01} />

      <div className="slider-label"><span>Object scale</span><strong>{objectScale(doc.box, target, asset)}%</strong></div>
      <p className="inspector-note">Actual image {Math.round((doc.box.w / 100) * doc.width)} × {Math.round((doc.box.h / 100) * doc.height)} px</p>

      <label className="field-label">Apply resize to</label>
      <div className="scope-list" role="radiogroup" aria-label="Apply resize to">
        {([["current", "Current image"], ["selected", `Selected images (${selectedCount})`], ["all", `All images (${totalCount})`]] as [Scope, string][]).map(([value, label]) =>
          <button key={value} role="radio" aria-checked={scope === value} className={scope === value ? "active" : ""} onClick={() => onScope(value)}><span />{label}</button>)}
      </div>

      <button className="focus-mode-button" onClick={onFocus}><Expand /> Focus mode <kbd>Ctrl ⇧ F</kbd></button>
      <div className="engine-note"><Sparkles aria-hidden="true" /><div><strong>MINIMA Engine</strong><span>Scale-aware bicubic · linear light</span></div></div>
    </div>
    <div className="inspector-footer">
      {processing && <div className="processing"><Progress value={progress} /><span>Processing {progress}%</span></div>}
      <Button onClick={onApply} disabled={processing || !scopeCount} className="apply-button">{processing ? "Processing…" : `Apply to ${scopeCount} image${scopeCount === 1 ? "" : "s"}`}</Button>
    </div>
  </aside>;
}

function PresetManager({ activeId, onApply }: { activeId: string; onApply: (id: string) => void }) {
  const categories = ["Marketplace", "Social Media", "Custom"] as const;
  const [category, setCategory] = useState<typeof categories[number]>("Marketplace");
  const rows = PRESETS.filter((preset) => preset.category === category);
  const [picked, setPicked] = useState(rows[0].id);
  const preset = presetById(picked);

  return <div className="full-pane presets-pane">
    <div className="preset-categories">
      <h1>Presets Manager</h1>
      {categories.map((item) => <button key={item} className={item === category ? "active" : ""} onClick={() => { setCategory(item); setPicked(PRESETS.find((row) => row.category === item)!.id); }}><Layers3 />{item}</button>)}
    </div>
    <div className="preset-list">
      <span>Preset</span>
      {rows.map((row) => <button key={row.id} className={row.id === picked ? "active" : ""} onClick={() => setPicked(row.id)}><FileImage />{row.label}{row.id === activeId && <Check className="preset-current" />}</button>)}
    </div>
    <aside className="preset-detail">
      <h2>Preset Details</h2>
      <div className="preset-preview" style={{ background: preset.background }}>
        <div className="safe-area" style={{ inset: `${preset.safeY}% ${preset.safeX}%` }} />
        <span>{ratioLabel(preset.width, preset.height)}</span>
      </div>
      <dl>
        <div><dt>Canvas dimensions</dt><dd>{preset.width} × {preset.height} px</dd></div>
        <div><dt>Safe area</dt><dd>{preset.safeX}% / {preset.safeY}%</dd></div>
        <div><dt>Background</dt><dd>{preset.background}</dd></div>
        <div><dt>Mode</dt><dd>{preset.fit} · {preset.align}</dd></div>
      </dl>
      <Button onClick={() => onApply(preset.id)}>{preset.id === activeId ? "Re-apply preset" : "Apply preset"}</Button>
    </aside>
  </div>;
}

function SettingsScreen() {
  return <div className="full-pane settings-pane">
    <section>
      <h1>App Settings</h1>
      <h2>General</h2>
      <label className="setting-line"><span>Default preset</span>
        <Select defaultValue="zalando"><SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{PRESETS.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label className="setting-line"><span>Auto-crop new images</span><Switch /></label>
      <div className="setting-line"><span>App theme</span><div className="segmented"><button>Light</button><button className="active">Dark</button><button>System</button></div></div>
    </section>
    <section>
      <h2>Keyboard shortcuts</h2>
      {SHORTCUTS.map(([keys, label]) => <div key={keys} className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>)}
    </section>
    <section>
      <h2>Performance</h2>
      <label className="setting-line"><span>Hardware acceleration</span><Switch defaultChecked /></label>
      <label className="field-label">Thread count</label>
      <Select defaultValue="auto"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="auto">Auto (16)</SelectItem><SelectItem value="8">8 threads</SelectItem><SelectItem value="4">4 threads</SelectItem></SelectContent>
      </Select>
      <div className="slider-label"><span>RAM allocation</span><strong>32 GB</strong></div>
      <Slider defaultValue={[50]} />
    </section>
  </div>;
}

function ExportDialog({ open, onOpenChange, queue, onStart }: { open: boolean; onOpenChange: (value: boolean) => void; queue: Asset[]; onStart: () => void }) {
  const [format, setFormat] = useState("png");
  const [quality, setQuality] = useState([92]);
  const [keepName, setKeepName] = useState(true);
  const estimate = queue.reduce((total, asset) => total + megabytes(asset), 0);
  const failing = queue.filter((asset) => asset.corrupt).length;

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog">
    <DialogHeader><DialogTitle>Export {queue.length} images</DialogTitle>
      <DialogDescription>Applies to every processed image. Pending images are excluded.</DialogDescription>
    </DialogHeader>
    <div className="export-grid">
      <section>
        <label className="field-label">File format</label>
        <Select value={format} onValueChange={setFormat}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="png">PNG</SelectItem><SelectItem value="jpg">JPG</SelectItem><SelectItem value="webp">WEBP</SelectItem><SelectItem value="tiff">TIFF</SelectItem></SelectContent>
        </Select>
        <div className="slider-label"><span>Quality</span><strong>{quality[0]}%</strong></div>
        <Slider value={quality} onValueChange={setQuality} disabled={format === "png"} />
        <label className="field-label">Color profile</label>
        <Select defaultValue="srgb"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="srgb">sRGB (default)</SelectItem><SelectItem value="p3">Display P3</SelectItem><SelectItem value="adobe">Adobe RGB (1998)</SelectItem></SelectContent>
        </Select>
        <label className="check-row"><Checkbox checked={keepName} onCheckedChange={(value) => setKeepName(Boolean(value))} /> Keep original filename</label>
        <label className="field-label">Suffix</label>
        <input className="export-input" defaultValue="_resized" aria-label="Filename suffix" />
        <label className="field-label">Output folder</label>
        <div className="output-folder">MINIMA_Output <FolderOpen /></div>
      </section>
      <section className="export-list">
        <strong>Estimated total · {estimate.toFixed(1)} MB</strong>
        {failing > 0 && <p className="export-warning"><TriangleAlert size={12} /> {failing} corrupted file{failing === 1 ? "" : "s"} will fail</p>}
        {queue.slice(0, 7).map((asset) => <div key={asset.id}><ProductPlaceholder kind={asset.kind} /><span>{asset.name}</span></div>)}
      </section>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!queue.length} onClick={onStart}>Export {queue.length} images</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

function ExportProgress({ state, total, onPause, onClose }: { state: { done: number; failed: string[]; paused: boolean } | null; total: number; onPause: () => void; onClose: () => void }) {
  if (!state) return null;
  const done = state.done >= total;
  const percent = total ? Math.round((state.done / total) * 100) : 100;
  return <Dialog open onOpenChange={onClose}><DialogContent className="export-dialog progress-dialog">
    <DialogHeader><DialogTitle>{done ? "Export complete" : "Exporting"}</DialogTitle>
      <DialogDescription>{state.done} / {total} files · {percent}%</DialogDescription>
    </DialogHeader>
    <Progress value={percent} />
    {state.failed.length > 0 && <div className="error-log"><strong>{state.failed.length} failed</strong>{state.failed.map((line) => <span key={line}>{line}</span>)}</div>}
    <DialogFooter>
      {!done && <Button variant="outline" onClick={onPause}>{state.paused ? "Resume" : "Pause"}</Button>}
      <Button variant={done ? "default" : "outline"} onClick={onClose}>{done ? "Done" : "Cancel export"}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Everything in the primary path has a key.</DialogDescription></DialogHeader>
    <div className="shortcut-list">{SHORTCUTS.map(([keys, label]) => <div key={keys} className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>)}</div>
    <DialogFooter><Button onClick={() => onOpenChange(false)}>Dismiss</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function RemoveDialog({ open, onOpenChange, selected, total, onRemove }: { open: boolean; onOpenChange: (value: boolean) => void; selected: number; total: number; onRemove: (keepSelected: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Remove images</DialogTitle>
      <DialogDescription>Removes images from this project only. Source files are untouched.</DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button variant="secondary" disabled={selected >= total} onClick={() => onRemove(true)}>Remove unselected ({total - selected})</Button>
      <Button variant="destructive" disabled={!selected} onClick={() => onRemove(false)}>Remove selected ({selected})</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

function FocusWorkspace({ asset, zoom, onZoom, onStep, onExit }: { asset: Asset; zoom: number; onZoom: (value: number) => void; onStep: (delta: number) => void; onExit: () => void }) {
  return <main className="focus-workspace">
    <button className="focus-exit" onClick={onExit}>Press Ctrl+Shift+F to exit Focus Mode</button>
    <button className="canvas-arrow left" aria-label="Previous image" onClick={() => onStep(-1)}><ChevronLeft /></button>
    <div style={{ transform: `scale(${zoom / 100})`, display: "contents" }}><ProductPlaceholder kind={asset.kind} large /></div>
    <button className="canvas-arrow right" aria-label="Next image" onClick={() => onStep(1)}><ChevronRight /></button>
    <div className="focus-zoom">
      <button aria-label="Zoom out" onClick={() => onZoom(Math.max(25, zoom - 25))}><Minus size={16} /></button>
      <span>{zoom}%</span>
      <button aria-label="Zoom in" onClick={() => onZoom(Math.min(400, zoom + 25))}><Plus size={16} /></button>
      <button aria-label="Fit to screen" onClick={() => onZoom(100)}><Expand size={16} /></button>
    </div>
  </main>;
}
