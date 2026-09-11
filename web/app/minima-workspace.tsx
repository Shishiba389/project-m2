"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter, AlignEndHorizontal, AlignEndVertical, AlignHorizontalJustifyCenter,
  AlignStartHorizontal, AlignStartVertical, ArrowLeft, Check, ChevronLeft,
  ChevronRight, CircleHelp, Columns2, Download, Expand, FileImage, FolderOpen,
  Grid2X2, Image as ImageIcon, Import, Layers3, Maximize2, Minus, Package,
  PanelRightClose, Plus, Redo2, RotateCcw, Search, Settings, Sparkles,
  TriangleAlert, Undo2, Upload, X, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type Section = "import" | "images" | "presets" | "export" | "settings";
type View = "gallery" | "editor" | "compare" | "review";
type Status = "Completed" | "Pending" | "Warning" | "Error";
type Asset = { id: number; name: string; kind: "shoe" | "beauty" | "fashion" | "bottle"; status: Status };

declare global {
  interface Document {
    modelContext?: {
      registerTool: (tool: {
        name: string;
        title: string;
        description: string;
        inputSchema: Record<string, unknown>;
        annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
        execute: (input: unknown) => unknown;
      }, options?: { signal?: AbortSignal }) => void | Promise<void>;
    };
  }
}

const initialAssets: Asset[] = [
  { id: 1, name: "8809968136217_1.png", kind: "shoe", status: "Completed" },
  { id: 2, name: "8809968136217_2.png", kind: "shoe", status: "Completed" },
  { id: 3, name: "8809968136217_3.png", kind: "shoe", status: "Warning" },
  { id: 4, name: "8809968136217_4.png", kind: "shoe", status: "Completed" },
  { id: 5, name: "8809968136217_5.png", kind: "fashion", status: "Completed" },
  { id: 6, name: "8809968136217_6.png", kind: "fashion", status: "Pending" },
  { id: 7, name: "8809968136217_7.png", kind: "beauty", status: "Pending" },
  { id: 8, name: "8809968136217_8.png", kind: "beauty", status: "Pending" },
  { id: 9, name: "8809968136217_9.png", kind: "bottle", status: "Warning" },
  { id: 10, name: "8809968136217_10.png", kind: "beauty", status: "Completed" },
  { id: 11, name: "8809968136217_11.png", kind: "fashion", status: "Pending" },
  { id: 12, name: "8809968136217_12.png", kind: "shoe", status: "Error" },
];

const navItems: { id: Section; label: string; icon: typeof Import }[] = [
  { id: "import", label: "Import", icon: Import }, { id: "images", label: "Images", icon: ImageIcon },
  { id: "presets", label: "Presets", icon: Layers3 }, { id: "export", label: "Export", icon: Upload },
];
const alignmentIcons = [AlignStartVertical, AlignHorizontalJustifyCenter, AlignEndVertical, AlignStartHorizontal, AlignCenter, AlignEndHorizontal];

function ProductPlaceholder({ kind, large = false }: { kind: Asset["kind"]; large?: boolean }) {
  return <div className={`product-placeholder product-${kind} ${large ? "product-large" : ""}`} aria-label="Product image placeholder"><Package aria-hidden="true" strokeWidth={1.25} /><span>{kind === "shoe" ? "FOOTWEAR" : kind === "beauty" ? "BEAUTY" : kind === "fashion" ? "APPAREL" : "FRAGRANCE"}</span></div>;
}

function StatusBadge({ status }: { status: Status }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status === "Completed" && <Check size={12} />}{status === "Warning" && <TriangleAlert size={12} />}{status === "Error" && <X size={12} />}{status === "Pending" && <span className="status-dot" />}{status}</span>;
}

export function MinimaWorkspace() {
  const [section, setSection] = useState<Section>("images");
  const [view, setView] = useState<View>("gallery");
  const [assets, setAssets] = useState(initialAssets);
  const [selected, setSelected] = useState<number[]>([2, 3, 4]);
  const [activeId, setActiveId] = useState(2);
  const [filter, setFilter] = useState<"All" | Status>("All");
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState(1801); const [height, setHeight] = useState(2600);
  const [lockRatio, setLockRatio] = useState(true); const [fitMode, setFitMode] = useState<"Fit" | "Fill">("Fit");
  const [safeTop, setSafeTop] = useState([10]); const [safeLeft, setSafeLeft] = useState([16.66]);
  const [focus, setFocus] = useState(false); const [processing, setProcessing] = useState(false); const [progress, setProgress] = useState(0);
  const [exportOpen, setExportOpen] = useState(false); const fileInput = useRef<HTMLInputElement>(null);
  const active = assets.find((asset) => asset.id === activeId) ?? assets[0];
  const visibleAssets = useMemo(() => assets.filter((asset) => (filter === "All" || asset.status === filter) && asset.name.toLowerCase().includes(query.toLowerCase())), [assets, filter, query]);
  const counts = useMemo(() => ({ All: assets.length, Completed: assets.filter((a) => a.status === "Completed").length, Pending: assets.filter((a) => a.status === "Pending").length, Warning: assets.filter((a) => a.status === "Warning").length, Error: assets.filter((a) => a.status === "Error").length }), [assets]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); setFocus((value) => !value); }
      if (event.key === "Escape") setFocus(false);
      if (event.code === "Space" && view === "editor") { event.preventDefault(); setView("compare"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "apply_resize_preset",
      title: "Apply resize preset",
      description: "Apply the current MINIMA resize preset to the selected placeholder images and update their visible batch status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => {
        setAssets((current) => current.map((asset) => selected.includes(asset.id) && asset.status !== "Error" ? { ...asset, status: "Completed" } : asset));
        return { applied: selected.length, preset: "Zalando 9:13", target: { width, height } };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [height, selected, width]);

  const chooseAsset = (asset: Asset, multi = false) => { setActiveId(asset.id); setSelected((current) => multi ? current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id] : [asset.id]); };
  const applyPreset = () => {
    if (processing) return; setProcessing(true); setProgress(12);
    const timer = window.setInterval(() => setProgress((value) => {
      if (value >= 100) { window.clearInterval(timer); setProcessing(false); setAssets((current) => current.map((asset) => selected.includes(asset.id) && asset.status !== "Error" ? { ...asset, status: "Completed" } : asset)); return 100; }
      return Math.min(100, value + 11);
    }), 120);
  };

  if (focus) return <main className="focus-workspace"><button className="focus-exit" onClick={() => setFocus(false)}>Press Ctrl+Shift+F to exit Focus Mode</button><button className="canvas-arrow left" aria-label="Previous image"><ChevronLeft /></button><ProductPlaceholder kind={active.kind} large /><button className="canvas-arrow right" aria-label="Next image"><ChevronRight /></button><div className="focus-zoom"><Minus size={16} /><span>100%</span><Plus size={16} /><Expand size={16} /></div></main>;

  return <main className="minima-app">
    <header className="topbar"><div className="topbar-left"><Button variant="ghost" size="icon" aria-label="Back"><ArrowLeft /></Button><span className="brand-mark"><Sparkles size={15} fill="currentColor" /> MINIMA</span></div><div className="document-name">{view === "editor" || view === "compare" ? active.name : section === "settings" ? "App Settings" : "MINIMA Resize"}</div><div className="topbar-actions"><Button variant="ghost" size="icon" aria-label="Undo"><Undo2 /></Button><Button variant="ghost" size="icon" aria-label="Redo"><Redo2 /></Button><span className="zoom-control"><Minus size={14} /> 100% <Plus size={14} /></span><Button variant="ghost" size="icon" aria-label="Help"><CircleHelp /></Button></div></header>
    <aside className="rail" aria-label="Main navigation"><div className="rail-main">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? "active" : ""} onClick={() => { setSection(id); if (id === "images") setView("gallery"); }}><Icon /><span>{label}</span></button>)}</div><button className={section === "settings" ? "active" : ""} onClick={() => setSection("settings")}><Settings /><span>Settings</span></button></aside>
    <section className="workspace">
      {section === "import" && <ImportScreen onBrowse={() => fileInput.current?.click()} />}
      {section === "presets" && <PresetManager onApply={() => { setSection("images"); setView("editor"); }} />}
      {section === "settings" && <SettingsScreen />}
      {(section === "images" || section === "export") && <>{view === "gallery" && <Gallery assets={visibleAssets} selected={selected} counts={counts} filter={filter} query={query} onFilter={setFilter} onQuery={setQuery} onChoose={chooseAsset} onOpen={(asset) => { chooseAsset(asset); setView("editor"); }} />}{view === "editor" && <Editor asset={active} assets={assets} selected={selected} onChoose={chooseAsset} />}{view === "compare" && <Compare asset={active} assets={assets} />}{view === "review" && <Review assets={assets.filter((asset) => asset.status === "Warning" || asset.status === "Error")} />}<Inspector width={width} height={height} lockRatio={lockRatio} fitMode={fitMode} safeTop={safeTop} safeLeft={safeLeft} selectedCount={selected.length} processing={processing} progress={progress} onWidth={(value) => { setWidth(value); if (lockRatio) setHeight(Math.round(value / (1801 / 2600))); }} onHeight={(value) => { setHeight(value); if (lockRatio) setWidth(Math.round(value * (1801 / 2600))); }} onLock={setLockRatio} onFit={setFitMode} onSafeTop={setSafeTop} onSafeLeft={setSafeLeft} onApply={applyPreset} onFocus={() => setFocus(true)} /></>}
    </section>
    {(section === "images" || section === "export") && <footer className="statusbar"><span>{selected.length} selected</span><div className="status-actions"><Button variant="ghost" size="sm" onClick={() => setView("compare")}><Columns2 /> Compare</Button><Button variant="ghost" size="sm" onClick={() => setView("review")}><TriangleAlert /> Review</Button><div className="view-switch" role="group" aria-label="Workspace view"><button className={view === "gallery" ? "active" : ""} onClick={() => setView("gallery")}><Grid2X2 /> Gallery</button><button className={view === "editor" ? "active" : ""} onClick={() => setView("editor")}><Maximize2 /> Editor</button></div><ExportDialog open={exportOpen} onOpenChange={setExportOpen} assets={assets} /></div><span>1801 × 2600 px · RGB · PNG · 2.4 MB</span></footer>}
    <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" />
  </main>;
}

function ImportScreen({ onBrowse }: { onBrowse: () => void }) {
  const [dragging, setDragging] = useState(false);
  return <div className="empty-workspace" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); }}><button className={`drop-zone ${dragging ? "dragging" : ""}`} onClick={onBrowse}><span className="drop-icon"><FolderOpen /><Upload /></span><strong>Drop images here</strong><span>or Browse your files</span><small>PNG, JPG, WEBP, TIFF · folders and multi-select supported</small></button></div>;
}

function Gallery({ assets, selected, counts, filter, query, onFilter, onQuery, onChoose, onOpen }: { assets: Asset[]; selected: number[]; counts: Record<string, number>; filter: string; query: string; onFilter: (value: "All" | Status) => void; onQuery: (value: string) => void; onChoose: (asset: Asset, multi?: boolean) => void; onOpen: (asset: Asset) => void }) {
  const filters: ("All" | Status)[] = ["All", "Completed", "Pending", "Warning", "Error"];
  return <div className="content-pane gallery-pane"><div className="gallery-toolbar"><div className="filter-tabs">{filters.map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => onFilter(item)}>{item}<span>{counts[item]}</span></button>)}</div><label className="search-box"><Search /><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search files…" /></label></div><p className="gallery-summary">{counts.All} images · {counts.Completed} completed · {counts.Pending} pending · {counts.Warning + counts.Error} need attention</p><div className="asset-grid">{assets.map((asset) => <article key={asset.id} className={`asset-card ${selected.includes(asset.id) ? "selected" : ""}`} onClick={(e) => onChoose(asset, e.ctrlKey || e.metaKey)} onDoubleClick={() => onOpen(asset)} tabIndex={0}><ProductPlaceholder kind={asset.kind} /><div className="asset-card-footer"><span className="asset-name">{asset.name}</span><StatusBadge status={asset.status} /></div>{selected.includes(asset.id) && <span className="selection-check"><Check /></span>}</article>)}</div></div>;
}

function Editor({ asset, assets, selected, onChoose }: { asset: Asset; assets: Asset[]; selected: number[]; onChoose: (asset: Asset) => void }) {
  return <div className="content-pane editor-pane"><div className="editor-stage"><div className="canvas portrait-canvas"><div className="safe-area" /><div className="selection-bounds"><i /><i /><i /><i /></div><ProductPlaceholder kind={asset.kind} large /></div></div><div className="filmstrip">{assets.slice(0, 8).map((item) => <button key={item.id} className={item.id === asset.id ? "active" : ""} onClick={() => onChoose(item)}><ProductPlaceholder kind={item.kind} /><span>{item.name.replace(".png", "")}</span><StatusBadge status={item.status} />{selected.includes(item.id) && <Check className="film-check" />}</button>)}</div></div>;
}

function Compare({ asset, assets }: { asset: Asset; assets: Asset[] }) {
  return <div className="content-pane compare-pane"><div className="compare-labels"><span>Original</span><span>Resized Preview</span></div><div className="compare-grid"><div className="compare-canvas original"><ProductPlaceholder kind={asset.kind} large /></div><div className="compare-canvas resized"><div className="safe-area" /><ProductPlaceholder kind={asset.kind} large /></div></div><div className="mini-strip">{assets.slice(4, 10).map((item) => <ProductPlaceholder key={item.id} kind={item.kind} />)}</div></div>;
}

function Review({ assets }: { assets: Asset[] }) {
  return <div className="content-pane review-pane"><div className="review-heading"><div><h1>Error Review & Diagnostics</h1><p>Resolve exceptions before final export.</p></div><Button variant="outline"><RotateCcw /> Retry failed images</Button></div><div className="review-grid">{assets.map((asset) => <article key={asset.id} className="review-card"><ProductPlaceholder kind={asset.kind} /><StatusBadge status={asset.status} /><strong>{asset.name}</strong><span>{asset.status === "Error" ? "Corrupted file" : "Safe area overflow"}</span></article>)}</div><Button className="auto-fix"><Zap /> Auto-fix scaling</Button></div>;
}

function Inspector(props: { width: number; height: number; lockRatio: boolean; fitMode: "Fit" | "Fill"; safeTop: number[]; safeLeft: number[]; selectedCount: number; processing: boolean; progress: number; onWidth: (v: number) => void; onHeight: (v: number) => void; onLock: (v: boolean) => void; onFit: (v: "Fit" | "Fill") => void; onSafeTop: (v: number[]) => void; onSafeLeft: (v: number[]) => void; onApply: () => void; onFocus: () => void }) {
  return <aside className="inspector"><div className="inspector-heading"><strong>Resize Inspector</strong><Button variant="ghost" size="icon" aria-label="Collapse inspector"><PanelRightClose /></Button></div><div className="inspector-body"><label className="field-label">Preset</label><Select defaultValue="zalando"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zalando">Zalando 9:13</SelectItem><SelectItem value="amazon">Amazon 1:1</SelectItem><SelectItem value="instagram">Instagram 4:5</SelectItem></SelectContent></Select><label className="field-label">Canvas dimensions</label><div className="dimension-row"><input aria-label="Canvas width" type="number" value={props.width} onChange={(e) => props.onWidth(Number(e.target.value))} /><span>×</span><input aria-label="Canvas height" type="number" value={props.height} onChange={(e) => props.onHeight(Number(e.target.value))} /><span>px</span></div><label className="check-row"><Checkbox checked={props.lockRatio} onCheckedChange={(v) => props.onLock(Boolean(v))} /> Aspect ratio lock</label><div className="segmented"><button className={props.fitMode === "Fit" ? "active" : ""} onClick={() => props.onFit("Fit")}>Fit</button><button className={props.fitMode === "Fill" ? "active" : ""} onClick={() => props.onFit("Fill")}>Fill</button></div><label className="field-label">Alignment matrix</label><div className="alignment-grid">{alignmentIcons.map((Icon, index) => <button key={index} className={index === 4 ? "active" : ""} aria-label={`Alignment ${index + 1}`}><Icon /></button>)}</div><div className="slider-label"><span>Safe area · Top</span><strong>{props.safeTop[0]}%</strong></div><Slider value={props.safeTop} onValueChange={props.onSafeTop} max={30} step={1} /><div className="slider-label"><span>Safe area · Left</span><strong>{props.safeLeft[0]}%</strong></div><Slider value={props.safeLeft} onValueChange={props.onSafeLeft} max={30} step={0.01} /><button className="focus-mode-button" onClick={props.onFocus}><Maximize2 /> Focus mode <kbd>Ctrl ⇧ F</kbd></button><div className="engine-note"><Sparkles /><div><strong>MINIMA Engine</strong><span>Scale-aware bicubic · linear light</span></div></div></div><div className="inspector-footer">{props.processing && <div className="processing"><Progress value={props.progress} /><span>Processing {props.progress}%</span></div>}<Button onClick={props.onApply} disabled={props.processing} className="apply-button">{props.processing ? "Processing…" : `Apply to ${props.selectedCount || 1} images`}</Button></div></aside>;
}

function PresetManager({ onApply }: { onApply: () => void }) {
  const presets = ["Zalando 9:13", "Amazon (1:1)", "Shopee", "Lazada", "Instagram Square (1:1)", "Instagram Story", "TikTok", "My Brand Preset", "Product Master"]; const [active, setActive] = useState(presets[0]);
  return <div className="full-pane presets-pane"><div className="preset-categories"><h1>Presets Manager</h1>{["Marketplace", "Social Media", "Custom"].map((item, i) => <button className={i === 0 ? "active" : ""} key={item}><Layers3 />{item}</button>)}</div><div className="preset-list"><span>Preset</span>{presets.map((item) => <button key={item} className={item === active ? "active" : ""} onClick={() => setActive(item)}><FileImage />{item}</button>)}</div><aside className="preset-detail"><h2>Preset Details</h2><div className="preset-preview"><div className="safe-area" /><span>9:13</span></div><dl><div><dt>Canvas dimensions</dt><dd>1801 × 2600 px</dd></div><div><dt>Safe area</dt><dd>16.66% / 10%</dd></div><div><dt>Background</dt><dd>#F6F6F6</dd></div><div><dt>Mode</dt><dd>Fit · Center</dd></div></dl><Button onClick={onApply}>Apply preset</Button></aside></div>;
}

function SettingsScreen() {
  return <div className="full-pane settings-pane"><section><h1>App Settings</h1><h2>General</h2><label className="setting-line"><span>Default preset</span><Select defaultValue="zalando"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zalando">Zalando 9:13</SelectItem><SelectItem value="amazon">Amazon 1:1</SelectItem></SelectContent></Select></label><label className="setting-line"><span>Auto-crop new images</span><Switch /></label><div className="setting-line"><span>App theme</span><div className="segmented"><button>Light</button><button className="active">Dark</button><button>System</button></div></div></section><section><h2>Workspace</h2><button className="settings-card">GPU acceleration & Performance <ChevronRight /></button><button className="settings-card">Keyboard shortcuts <ChevronRight /></button><button className="settings-card">Default export paths <ChevronRight /></button><div className="shortcut-row"><span>Focus mode</span><kbd>Ctrl+Shift+F</kbd></div><div className="shortcut-row"><span>Compare images</span><kbd>Spacebar</kbd></div></section><section><h2>Performance</h2><label className="setting-line"><span>Hardware acceleration</span><Switch defaultChecked /></label><label className="field-label">Thread count</label><Select defaultValue="auto"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Auto (16)</SelectItem><SelectItem value="8">8 threads</SelectItem></SelectContent></Select><div className="slider-label"><span>RAM allocation</span><strong>32 GB</strong></div><Slider defaultValue={[50]} /></section></div>;
}

function ExportDialog({ open, onOpenChange, assets }: { open: boolean; onOpenChange: (v: boolean) => void; assets: Asset[] }) {
  const [format, setFormat] = useState("png"); const [quality, setQuality] = useState([92]); const [keepName, setKeepName] = useState(true);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogTrigger asChild><Button size="sm"><Download /> Export</Button></DialogTrigger><DialogContent className="export-dialog"><DialogHeader><DialogTitle>Export {assets.length} images</DialogTitle><DialogDescription>Final output settings apply to the accepted batch.</DialogDescription></DialogHeader><div className="export-grid"><section><label className="field-label">File format</label><Select value={format} onValueChange={setFormat}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="png">PNG</SelectItem><SelectItem value="jpg">JPG</SelectItem><SelectItem value="webp">WEBP</SelectItem><SelectItem value="tiff">TIFF</SelectItem></SelectContent></Select><div className="slider-label"><span>Quality</span><strong>{quality[0]}%</strong></div><Slider value={quality} onValueChange={setQuality} /><label className="field-label">Color profile</label><Select defaultValue="srgb"><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="srgb">sRGB (Default)</SelectItem><SelectItem value="p3">Display P3</SelectItem><SelectItem value="adobe">Adobe RGB (1998)</SelectItem></SelectContent></Select><label className="check-row"><Checkbox checked={keepName} onCheckedChange={(v) => setKeepName(Boolean(v))} /> Keep original filename</label><label className="field-label">Suffix</label><input className="export-input" defaultValue="_resized" /><label className="field-label">Output folder</label><div className="output-folder">MINIMA_Output <FolderOpen /></div></section><section className="export-list"><strong>Estimated total · 28.8 MB</strong>{assets.slice(0, 6).map((asset) => <div key={asset.id}><ProductPlaceholder kind={asset.kind} /><span>{asset.name}</span></div>)}</section></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => onOpenChange(false)}>Export {assets.length} images</Button></DialogFooter></DialogContent></Dialog>;
}
