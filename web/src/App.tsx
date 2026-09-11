import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, Columns2, Download, Expand, Image as ImageIcon,
  Import, Layers, Layers3, Minus, PanelLeft, PanelRight, Plus, Redo2, Settings, TriangleAlert,
  Undo2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CloudDialog, defaultExportOptions, ExportDialog, ExportProgress, PresetDialog, RemoveDialog,
  ShortcutsDialog, type ExportOptions, type ExportRun,
} from "@/src/dialogs";
import { summarise, toSources, type BatchSource } from "@/src/batch";
import { BatchScreen, ImportForkDialog } from "@/src/batchscreen";
import { Inspector } from "@/src/inspector";
import {
  defaultGuides, Editor, Gallery, ImportScreen, PresetManager,
  ProductPlaceholder, Review, SettingsScreen, type CompareView, type Guides, type Theme,
} from "@/src/screens";
import {
  backTarget, countByStatus, customPreset, docFromPreset, docTarget, emptyFilter, filterAssets,
  fitBox, megabytes, mergeImport, presetById, PRESETS, ratioLabel, srcRatio, statusOf,
  type Asset, type Doc, type DupPolicy, type GalleryFilter, type Preset, type Scope, type Screen,
} from "@/src/flow";

const seedAssets: Asset[] = [
  { id: 1, name: "8809968136217_1.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 2, name: "8809968136217_2.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 3, name: "8809968136217_3.jpg", kind: "shoe", format: "jpg", src: { w: 1600, h: 1600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 4, name: "8809968136217_4.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 5, name: "8809968136217_5.png", kind: "fashion", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 6, name: "8809968136217_6.png", kind: "fashion", format: "png", src: { w: 1801, h: 2600 }, processed: false, overflow: false, fixed: false, corrupt: false },
  { id: 7, name: "8809968136217_7.webp", kind: "beauty", format: "webp", src: { w: 2000, h: 2000 }, processed: false, overflow: false, fixed: false, corrupt: false },
  { id: 8, name: "8809968136217_8.png", kind: "beauty", format: "png", src: { w: 1801, h: 2600 }, processed: false, overflow: false, fixed: false, corrupt: false },
  { id: 9, name: "8809968136217_9.jpg", kind: "bottle", format: "jpg", src: { w: 1200, h: 1600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 10, name: "8809968136217_10.png", kind: "beauty", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: true, fixed: false, corrupt: false },
  { id: 11, name: "8809968136217_11.png", kind: "fashion", format: "png", src: { w: 1801, h: 2600 }, processed: false, overflow: false, fixed: false, corrupt: false },
  { id: 12, name: "8809968136217_12.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: true },
];

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

export function MinimaWorkspace() {
  const [assets, setAssets] = useState(seedAssets);
  const [presets, setPresets] = useState<Preset[]>(PRESETS);
  const [screen, setScreen] = useState<Screen>("gallery");
  const [imageScreen, setImageScreen] = useState<"gallery" | "editor">("gallery");
  const [selected, setSelected] = useState<number[]>([2, 3, 4]);
  const [activeId, setActiveId] = useState(2);
  const [filter, setFilter] = useState<GalleryFilter>(emptyFilter);
  const [scope, setScope] = useState<Scope>("selected");
  const [policy, setPolicy] = useState<DupPolicy>("skip");
  const [guides, setGuides] = useState<Guides>(defaultGuides);
  const [theme, setTheme] = useState<Theme>("dark");
  const [compare, setCompare] = useState(false);
  const [compareView, setCompareView] = useState<CompareView>("split");
  const [splitAt, setSplitAt] = useState(50);
  const [overlay, setOverlay] = useState(100);
  const [focus, setFocus] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(defaultExportOptions);
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [removeIntent, setRemoveIntent] = useState<{ keepSelected: boolean; count: number } | null>(null);
  const [presetDraft, setPresetDraft] = useState<{ preset: Preset; mode: "create" | "edit" } | null>(null);
  const [run, setRun] = useState<ExportRun | null>(null);
  const [notice, setNotice] = useState("");
  const [sources, setSources] = useState<BatchSource[]>([]);
  const [fork, setFork] = useState<ReturnType<typeof summarise> | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const { doc, setDoc, undo, redo, canUndo, canRedo } = useHistory(initialDoc);
  const active = assets.find((asset) => asset.id === activeId) ?? assets[0];
  const target = useMemo(() => docTarget(doc, presets), [doc, presets]);

  const counts = useMemo(() => countByStatus(assets, target), [assets, target]);
  const needsAttention = counts.Warning + counts.Error;
  const exportQueue = useMemo(() => assets.filter((asset) => statusOf(asset, target) !== "Pending"), [assets, target]);
  const visible = useMemo(() => filterAssets(assets, target, filter), [assets, target, filter]);
  const scoped = useMemo(() => scope === "all" ? assets : scope === "selected" ? assets.filter((asset) => selected.includes(asset.id)) : assets.filter((asset) => asset.id === activeId), [assets, scope, selected, activeId]);
  const flagged = useMemo(() => assets.filter((asset) => ["Warning", "Error"].includes(statusOf(asset, target))), [assets, target]);

  /** The only screen navigator. Modifiers that need the canvas force the editor. */
  const goto = useCallback((next: Screen) => {
    setScreen(next);
    if (next === "gallery" || next === "editor") setImageScreen(next);
    if (next !== "editor") setCompare(false);
  }, []);

  const touch = useCallback((message = "") => {
    setSaving(true);
    if (message) setNotice(message);
    window.setTimeout(() => setSaving(false), 700);
  }, []);

  const openEditor = useCallback((asset: Asset) => {
    setActiveId(asset.id);
    setDoc((current) => ({ ...current, box: fitBox(current.fit, srcRatio(asset), current.width / current.height, current.safeX, current.safeY) }));
    goto("editor");
  }, [goto, setDoc]);

  const chooseAsset = useCallback((asset: Asset, multi = false, range = false) => {
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
  }, [visible]);

  const applyPreset = useCallback((id: string) => {
    setDoc(docFromPreset(presetById(id, presets), active));
    touch(`Preset ${presetById(id, presets).label} loaded`);
  }, [active, presets, setDoc, touch]);

  /** The resize step commits: scoped assets become processed, statuses recompute. */
  const runApply = useCallback(() => {
    if (processing || !scoped.length) return;
    setProcessing(true);
    setProgress(8);
    const ids = scoped.map((asset) => asset.id);
    const overflow = doc.fit !== "Fit";
    const timer = window.setInterval(() => setProgress((value) => {
      if (value < 100) return Math.min(100, value + 12);
      window.clearInterval(timer);
      setProcessing(false);
      setAssets((current) => current.map((asset) => ids.includes(asset.id)
        ? { ...asset, processed: true, overflow, fixed: false }
        : asset));
      touch(`Applied to ${ids.length} image${ids.length === 1 ? "" : "s"}`);
      return 100;
    }), 110);
  }, [doc.fit, processing, scoped, touch]);

  const fixAssets = useCallback((ids: number[]) => {
    setAssets((current) => current.map((asset) => ids.includes(asset.id) && !asset.corrupt ? { ...asset, fixed: true } : asset));
    touch(`Auto-fixed ${ids.length} image${ids.length === 1 ? "" : "s"}`);
  }, [touch]);

  const importNames = useCallback((names: string[]) => {
    if (!names.length) return;
    const merged = mergeImport(assets, names.map((name) => ({ name })), policy);
    setAssets(merged.assets);
    setSelected([]);
    goto("gallery");
    touch(`Imported ${merged.added}${merged.skipped ? `, skipped ${merged.skipped}` : ""}${merged.renamed ? `, renamed ${merged.renamed}` : ""}`);
  }, [assets, goto, policy, touch]);

  /**
   * Keeps the File handles: batch re-encodes them for real, so names alone are
   * not enough. toSources also filters by extension, which a directory picker
   * needs — it reports an empty MIME type for plenty of images.
   */
  const importFiles = useCallback((incoming: FileList | null) => {
    const picked = toSources(Array.from(incoming ?? []), Date.now());
    if (!picked.length) return;
    setSources(picked);
    const merged = mergeImport(assets, picked.map((source) => ({ name: source.name })), policy);
    setAssets(merged.assets);
    setSelected([]);
    setFork(summarise(picked));
    touch(`Imported ${merged.added}${merged.skipped ? `, skipped ${merged.skipped}` : ""}${merged.renamed ? `, renamed ${merged.renamed}` : ""}`);
  }, [assets, policy, touch]);

  const confirmRemoval = useCallback(() => {
    if (!removeIntent) return;
    const doomed = removeIntent.keepSelected
      ? assets.filter((asset) => !selected.includes(asset.id))
      : assets.filter((asset) => selected.includes(asset.id));
    const ids = new Set(doomed.map((asset) => asset.id));
    const left = assets.filter((asset) => !ids.has(asset.id));
    setAssets(left);
    setSelected([]);
    setRemoveIntent(null);
    if (left.length) setActiveId(left[0].id);
    touch(`Removed ${ids.size} image${ids.size === 1 ? "" : "s"}`);
  }, [assets, removeIntent, selected, touch]);

  const askRemoval = useCallback((keepSelected: boolean) => {
    const count = keepSelected ? assets.length - selected.length : selected.length;
    if (count > 0) setRemoveIntent({ keepSelected, count });
  }, [assets.length, selected.length]);

  const savePreset = useCallback((preset: Preset) => {
    setPresets((current) => current.some((row) => row.id === preset.id)
      ? current.map((row) => row.id === preset.id ? preset : row)
      : [...current, preset]);
    setPresetDraft(null);
    touch(`Saved ${preset.label}`);
  }, [touch]);

  const deletePreset = useCallback((preset: Preset) => {
    setPresets((current) => current.filter((row) => row.id !== preset.id));
    if (doc.presetId === preset.id) setDoc(docFromPreset(PRESETS[0], active));
    touch(`Deleted ${preset.label}`);
  }, [active, doc.presetId, setDoc, touch]);

  /* The export run steps one file at a time so Pause actually holds. */
  useEffect(() => {
    if (!run || run.paused || run.done >= exportQueue.length) return;
    const timer = window.setTimeout(() => setRun((current) => {
      if (!current) return current;
      const file = exportQueue[current.done];
      return {
        ...current,
        done: current.done + 1,
        failed: file?.corrupt ? [...current.failed, `${file.name}: Access denied`] : current.failed,
      };
    }), 110);
    return () => window.clearTimeout(timer);
  }, [run, exportQueue]);

  useEffect(() => { if (!assets.length && screen !== "batch") goto("import"); }, [assets.length, goto, screen]);

  /* The theme choice has to reach the document, or the segmented control is a lie. */
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLElement && (["INPUT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); if (screen !== "editor") goto("editor"); setFocus((value) => !value); return; }
      if (mod && event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); redo(); return; }
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return; }
      if (event.key === "Escape") { setFocus(false); return; }
      if (typing) return;
      if (mod && event.key.toLowerCase() === "a" && screen === "gallery") { event.preventDefault(); setSelected(visible.map((asset) => asset.id)); return; }
      if (mod && event.key === "Backspace") { event.preventDefault(); askRemoval(false); return; }
      if (event.key === "Enter" && screen === "gallery") { event.preventDefault(); openEditor(active); return; }
      if (event.code === "Space") { event.preventDefault(); if (screen !== "editor") goto("editor"); setCompare(true); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setCompare(false); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [active, askRemoval, goto, openEditor, redo, screen, undo, visible]);

  const step = useCallback((delta: number) => {
    setActiveId((current) => {
      const at = assets.findIndex((asset) => asset.id === current);
      return assets[(at + delta + assets.length) % assets.length]?.id ?? current;
    });
  }, [assets]);

  if (focus) return <main className="focus-workspace">
    <button className="focus-exit" onClick={() => setFocus(false)}>Press Ctrl+Shift+F to exit Focus Mode</button>
    <button className="canvas-arrow left" aria-label="Previous image" onClick={() => step(-1)}><ChevronLeft /></button>
    <div className="focus-canvas" style={{ transform: `scale(${zoom / 100})` }}><ProductPlaceholder kind={active.kind} large /></div>
    <button className="canvas-arrow right" aria-label="Next image" onClick={() => step(1)}><ChevronRight /></button>
    <div className="focus-zoom">
      <button aria-label="Zoom out" onClick={() => setZoom(Math.max(25, zoom - 25))}><Minus size={16} /></button>
      <span>{zoom}%</span>
      <button aria-label="Zoom in" onClick={() => setZoom(Math.min(400, zoom + 25))}><Plus size={16} /></button>
      <button aria-label="Reset zoom" onClick={() => setZoom(100)}><Expand size={16} /></button>
    </div>
  </main>;

  const back = backTarget(screen, assets.length > 0);
  const onImages = ["gallery", "editor", "review"].includes(screen);
  const zoomEnabled = screen === "editor" || screen === "gallery";
  const title = screen === "editor" ? active.name
    : screen === "settings" ? "Settings"
    : screen === "presets" ? "Presets Manager"
    : screen === "review" ? "Error Diagnostics"
    : screen === "batch" ? "Batch resize"
    : screen === "import" ? "Drag & Drop"
    : "MINIMA Resize";

  return <main className={`minima-app ${railOpen ? "" : "rail-collapsed"} ${inspectorOpen ? "" : "inspector-collapsed"}`}>
    <header className="topbar">
      <div className="topbar-left">
        <Button variant="ghost" size="icon" aria-label="Toggle navigation rail" aria-pressed={railOpen} onClick={() => setRailOpen((value) => !value)}><PanelLeft /></Button>
        {back && <Button variant="ghost" size="sm" className="back-button" onClick={() => goto(back)}><ArrowLeft /> Back</Button>}
        {screen === "editor" && <>
          <Button variant="ghost" size="icon" aria-label="Undo" disabled={!canUndo} onClick={undo}><Undo2 /></Button>
          <Button variant="ghost" size="icon" aria-label="Redo" disabled={!canRedo} onClick={redo}><Redo2 /></Button>
        </>}
      </div>
      <div className="document-name">{title}</div>
      <div className="topbar-actions">
        {/* Panel 9: the Before/After toggle lives with the comparison. */}
        {compare && <div className="view-switch compare-toggle" role="group" aria-label="Comparison view">
          {(["before", "split", "after"] as CompareView[]).map((view) =>
            <button key={view} className={compareView === view ? "active" : ""} onClick={() => setCompareView(view)}>
              {view === "split" ? "Split" : view[0].toUpperCase() + view.slice(1)}
            </button>)}
        </div>}
        <div className="zoom-control" role="group" aria-label={screen === "editor" ? "Canvas zoom" : "Thumbnail size"}>
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
        <RailButton icon={ImageIcon} label="Images" active={["gallery", "editor", "review"].includes(screen)} disabled={!assets.length} onClick={() => goto(imageScreen)} />
        <RailButton icon={Layers} label="Batch" active={screen === "batch"} disabled={!sources.length} onClick={() => goto("batch")} />
        <RailButton icon={Layers3} label="Presets" active={screen === "presets"} onClick={() => goto("presets")} />
        <RailButton icon={Upload} label="Export" disabled={!exportQueue.length} onClick={() => setExportOpen(true)} />
      </div>
      <div className="rail-bottom">
        <RailButton icon={Settings} label="Settings" active={screen === "settings"} onClick={() => goto("settings")} />
      </div>
    </aside>

    <section className={`workspace ${inspectorOpen && ["gallery", "editor", "review"].includes(screen) ? "" : "no-inspector"}`}>
      {screen === "import" && <ImportScreen policy={policy} onPolicy={setPolicy} onFiles={() => filesInput.current?.click()}
        onFolders={() => folderInput.current?.click()} onCloud={() => setCloudOpen(true)} onDrop={importFiles} />}
      {screen === "presets" && <PresetManager presets={presets} activeId={doc.presetId}
        onApply={(id) => { applyPreset(id); goto(assets.length ? imageScreen : "import"); }}
        onCreate={() => setPresetDraft({ preset: customPreset("Custom preset", target, presets), mode: "create" })}
        onEdit={(preset) => setPresetDraft({ preset, mode: "edit" })}
        onDuplicate={(preset) => setPresetDraft({ preset: customPreset(`${preset.label} copy`, preset, presets), mode: "create" })}
        onDelete={deletePreset}
        onShare={(preset) => touch(`${preset.label} rules copied for sharing`)} />}
      {screen === "settings" && <SettingsScreen theme={theme} onTheme={setTheme} />}
      {screen === "batch" && <BatchScreen sources={sources} onLeave={() => goto(assets.length ? "gallery" : "import")} />}

      {screen === "gallery" && <Gallery assets={visible} total={assets.length} selected={selected} counts={counts} filter={filter} zoom={zoom}
        needsAttention={needsAttention} target={target} onFilter={setFilter} onChoose={chooseAsset} onOpen={openEditor}
        onReview={() => goto("review")} onRemove={askRemoval} />}
      {screen === "editor" && <Editor asset={active} assets={assets} selected={selected} doc={doc} zoom={zoom}
        compare={compare} compareView={compareView} splitAt={splitAt} overlay={overlay} guides={guides} target={target}
        onBox={(box) => setDoc((current) => ({ ...current, box }))} onSplit={setSplitAt} onChoose={openEditor}
        onToggleGrid={() => setGuides((current) => ({ ...current, grid: !current.grid }))} onStep={step} />}
      {screen === "review" && <Review assets={flagged} target={target} onOpen={openEditor}
        onFix={(id) => fixAssets([id])} onFixAll={() => fixAssets(flagged.map((asset) => asset.id))} onRetry={runApply} />}

      {inspectorOpen && !["import", "presets", "settings", "batch"].includes(screen) && (
        <Inspector doc={doc} target={target} asset={active} presets={presets} guides={guides} scope={scope}
            scopeCount={scoped.length} selectedCount={selected.length} totalCount={assets.length}
            compare={compare} overlay={overlay} processing={processing} progress={progress}
            onPreset={applyPreset} onDoc={setDoc} onGuides={setGuides} onScope={setScope} onOverlay={setOverlay}
            onApply={runApply} onFocus={() => { goto("editor"); setFocus(true); }} onClose={() => setInspectorOpen(false)}
            onResetGuides={() => { setGuides(defaultGuides); applyPreset(doc.presetId); }} />)}

    </section>

    <footer className="statusbar">
      <span>{notice || (saving ? "Saving…" : "All changes saved")}
        {onImages && assets.length ? ` · ${selected.length} of ${assets.length} selected` : ""}
        {!assets.length ? " · no images" : ""}</span>
      {screen !== "batch" && <div className="status-actions">
        {needsAttention > 0 && screen !== "review" && <Button variant="ghost" size="sm" onClick={() => goto("review")}><TriangleAlert /> {needsAttention} need attention</Button>}
        <Button variant="ghost" size="sm" aria-pressed={compare} disabled={!assets.length} onClick={() => { goto("editor"); setCompare((value) => !value); }}><Columns2 /> Compare</Button>
        <div className="view-switch" role="group" aria-label="Workspace view">
          <button className={screen === "gallery" ? "active" : ""} disabled={!assets.length} onClick={() => goto("gallery")}>Gallery</button>
          <button className={screen === "editor" ? "active" : ""} disabled={!assets.length} onClick={() => goto("editor")}>Editor</button>
        </div>
        <Button variant="secondary" size="sm" disabled={processing || !scoped.length} onClick={runApply}>Apply preset</Button>
        <Button size="sm" disabled={!exportQueue.length} onClick={() => setExportOpen(true)}><Download /> Export</Button>
      </div>}
      <span>{onImages && assets.length
        ? `${active.src.w} × ${active.src.h} px · ${ratioLabel(doc.width, doc.height)} · ${active.format.toUpperCase()} · ${megabytes(active).toFixed(1)} MB`
        : ""}</span>
    </footer>

    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} queue={exportQueue} options={exportOptions}
      onOptions={setExportOptions} onStart={() => { setExportOpen(false); setRun({ done: 0, failed: [], paused: false }); }} />
    <ExportProgress run={run} queue={exportQueue} options={exportOptions}
      onPause={() => setRun((current) => current && { ...current, paused: !current.paused })} onClose={() => setRun(null)} />
    <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <RemoveDialog intent={removeIntent} onCancel={() => setRemoveIntent(null)} onConfirm={confirmRemoval} />
    <PresetDialog draft={presetDraft} presets={presets} onCancel={() => setPresetDraft(null)} onSave={savePreset} />
    <ImportForkDialog summary={fork}
      onBatch={() => { setFork(null); goto("batch"); }}
      onEditor={() => { setFork(null); goto("gallery"); }} />
    <CloudDialog open={cloudOpen} onOpenChange={setCloudOpen} onImport={(names) => { setCloudOpen(false); importNames(names); }} />

    <input ref={filesInput} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => importFiles(event.target.files)} />
    <input ref={folderInput} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => importFiles(event.target.files)}
      // @ts-expect-error non-standard folder picker, supported in Chromium and WebKit
      webkitdirectory="" />
  </main>;
}

function RailButton({ icon: Icon, label, active, disabled, onClick }: { icon: typeof Import; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} disabled={disabled} onClick={onClick}>
    <Icon aria-hidden="true" /><span>{label}</span>
  </button>;
}
