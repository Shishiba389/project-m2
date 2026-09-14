import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, Columns2, Download, Expand, Image as ImageIcon,
  Import, Layers, Layers3, Minus, PanelLeft, PanelRight, Plus, Redo2, Settings, TriangleAlert,
  Undo2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CloudDialog, defaultExportOptions, ExportDialog, ExportProgress, PresetDialog, RemoveDialog,
  ShortcutsDialog, type ExportOptions, type ExportWorkflow,
} from "@/src/dialogs";
import {
  downloadZip, EXPORT_ZIP, runExport, specFromDoc, type ExportProgress as ExportRunProgress,
} from "@/src/exportrun";
import { inspectSources, summarise, toSources, type BatchSource } from "@/src/batch";
import { BatchScreen, ImportForkDialog } from "@/src/batchscreen";
import { Inspector } from "@/src/inspector";
import { applyRecipe, applyRecipeToAssets, createRecipe } from "@/src/editor-engine";
import {
  defaultGuides, Editor, Gallery, ImportScreen, PresetManager,
  Review, SettingsScreen, type CompareView, type Guides, type Theme,
} from "@/src/screens";
import {
  backTarget, countByStatus, customPreset, docFromPreset, docTarget, emptyFilter, filterAssets,
  megabytes, mergeImport, presetById, PRESETS, ratioLabel, statusOf,
  type Asset, type Doc, type DupPolicy, type GalleryFilter, type Preset, type Scope, type Screen,
} from "@/src/flow";

const initialDoc = docFromPreset(presetById("zalando"));
const EMPTY_EDITOR_ASSET: Asset = {
  id: 0, name: "Untitled canvas", kind: "shoe", format: "png", src: { w: 1, h: 1 },
  processed: false, overflow: false, fixed: false, corrupt: false,
};

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
  const [assets, setAssets] = useState<Asset[]>([]);
  const assetsRef = useRef<Asset[]>([]);
  const [presets, setPresets] = useState<Preset[]>(PRESETS);
  const [screen, setScreen] = useState<Screen>("import");
  const [imageScreen, setImageScreen] = useState<"gallery" | "editor">("gallery");
  const [selected, setSelected] = useState<number[]>([]);
  const [activeId, setActiveId] = useState(0);
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
  const [exportWorkflows, setExportWorkflows] = useState<ExportWorkflow[]>(() => {
    try { return JSON.parse(localStorage.getItem("minima-export-workflows") || "[]") as ExportWorkflow[]; } catch { return []; }
  });
  const [exportOpen, setExportOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [removeIntent, setRemoveIntent] = useState<{ keepSelected: boolean; count: number } | null>(null);
  const [presetDraft, setPresetDraft] = useState<{ preset: Preset; mode: "create" | "edit" } | null>(null);
  const [run, setRun] = useState<ExportRunProgress | null>(null);
  const [runDone, setRunDone] = useState(false);
  const [runBytes, setRunBytes] = useState(0);
  const cancelExport = useRef(false);
  const exportZip = useRef<Uint8Array | null>(null);
  const [notice, setNotice] = useState("");
  const [sources, setSources] = useState<BatchSource[]>([]);
  const [fork, setFork] = useState<ReturnType<typeof summarise> | null>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem("minima-export-workflows", JSON.stringify(exportWorkflows)); }, [exportWorkflows]);

  const { doc, setDoc, undo, redo, canUndo, canRedo } = useHistory(initialDoc);
  const active = assets.find((asset) => asset.id === activeId) ?? assets[0];
  const editorAsset = active ?? EMPTY_EDITOR_ASSET;
  const hasActive = Boolean(active);
  const target = useMemo(() => docTarget(doc, presets), [doc, presets]);

  const counts = useMemo(() => countByStatus(assets, target), [assets, target]);
  const needsAttention = counts.Warning + counts.Error;
  // Export renders the current document directly; an image does not need a
  // prior Apply step to be exportable. Only corrupt/missing sources are omitted.
  const exportQueue = useMemo(() => assets.filter((asset) => Boolean(asset.file) && !asset.corrupt), [assets]);
  const selectedExportQueue = useMemo(() => exportOptions.selectedIds !== null
    ? exportQueue.filter((asset) => exportOptions.selectedIds!.includes(asset.id))
    : exportQueue, [exportOptions.selectedIds, exportQueue]);
  const visible = useMemo(() => filterAssets(assets, target, filter), [assets, target, filter]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const scoped = useMemo(() => scope === "all" ? assets : scope === "selected" ? assets.filter((asset) => selectedSet.has(asset.id)) : assets.filter((asset) => asset.id === activeId), [assets, scope, selectedSet, activeId]);
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

  /**
   * The placeholder frame belongs to the batch, not to one image: every file in
   * the queue is laid out in the same frame, so switching images leaves it be.
   */
  const openEditor = useCallback((asset: Asset) => {
    setActiveId(asset.id);
    goto("editor");
  }, [goto]);

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
    setDoc(docFromPreset(presetById(id, presets)));
    touch(`Preset ${presetById(id, presets).label} loaded`);
  }, [presets, setDoc, touch]);

  /** Build a versioned recipe and calculate an independent layout per image. */
  const runApply = useCallback(() => {
    if (processing || !scoped.length) return;
    setProcessing(true);
    setProgress(25);
    const ids = new Set(scoped.map((asset) => asset.id));
    const recipe = createRecipe(doc);
    setAssets((current) => {
      const calculated = applyRecipeToAssets(current.filter((asset) => ids.has(asset.id)), recipe);
      const byId = new Map(calculated.map((asset) => [asset.id, asset]));
      return current.map((asset) => byId.get(asset.id) ?? asset);
    });
    setProgress(100); setProcessing(false);
    touch(`Recipe v${recipe.version} applied to ${ids.size} image${ids.size === 1 ? "" : "s"}`);
  }, [doc, processing, scoped, touch]);

  const setActiveBox = useCallback((box: Doc["box"]) => {
    if (doc.templateLocked) return;
    setDoc((current) => ({ ...current, box }));
    if (!active) return;
    const recipe = createRecipe({ ...doc, box });
    setAssets((current) => current.map((asset) => asset.id === active.id
      ? { ...asset, processed: true, fixed: false, layout: applyRecipe(asset, recipe, box) }
      : asset));
  }, [active, doc, setDoc]);

  const fixAssets = useCallback((ids: number[]) => {
    const idSet = new Set(ids);
    setAssets((current) => current.map((asset) => idSet.has(asset.id) && !asset.corrupt ? { ...asset, fixed: true } : asset));
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
  const importFiles = useCallback(async (incoming: FileList | null, quick = false) => {
    const allCandidates = toSources(Array.from(incoming ?? []), Date.now());
    let preSkipped = 0;
    const knownNames = new Set(assets.map((asset) => asset.name));
    const candidates = policy === "skip" ? allCandidates.filter((source) => {
      if (knownNames.has(source.name)) { preSkipped += 1; return false; }
      knownNames.add(source.name); return true;
    }) : allCandidates;
    if (!candidates.length) {
      if (preSkipped) touch(`Skipped ${preSkipped} duplicate image${preSkipped === 1 ? "" : "s"}`);
      return;
    }
    setNotice(`Preparing 0 / ${candidates.length} images…`);
    const picked = await inspectSources(candidates, undefined,
      (done, total) => setNotice(`Preparing ${done} / ${total} images…`));
    if (!picked.length) return;
    setSources(picked);
    const incomingAssets = picked.map((source) => ({
      name: source.name, file: source.file, url: source.error ? undefined : URL.createObjectURL(source.file),
      thumbnailUrl: source.thumbnail ? URL.createObjectURL(source.thumbnail) : undefined,
      src: source.width && source.height ? { w: source.width, h: source.height } : undefined,
      corrupt: Boolean(source.error),
    }));
    const merged = mergeImport(assets, incomingAssets, policy);
    const retainedUrls = new Set(merged.assets.flatMap((asset) => [asset.url, asset.thumbnailUrl].filter(Boolean)));
    for (const asset of [...assets, ...incomingAssets]) {
      if (asset.url && !retainedUrls.has(asset.url)) URL.revokeObjectURL(asset.url);
      if (asset.thumbnailUrl && !retainedUrls.has(asset.thumbnailUrl)) URL.revokeObjectURL(asset.thumbnailUrl);
    }
    setAssets(merged.assets);
    const importedUrls = new Set(incomingAssets.map((asset) => asset.url));
    setSelected(merged.assets.filter((asset) => asset.url && importedUrls.has(asset.url)).map((asset) => asset.id));
    setActiveId(merged.assets[0]?.id ?? 0);
    setFork(summarise(picked));
    const skipped = merged.skipped + preSkipped;
    touch(`Imported ${merged.added}${skipped ? `, skipped ${skipped}` : ""}${merged.renamed ? `, renamed ${merged.renamed}` : ""}`);
    if (quick) { setFork(null); setFocus(false); goto("editor"); }
  }, [assets, goto, policy, touch]);

  const confirmRemoval = useCallback(() => {
    if (!removeIntent) return;
    const doomed = removeIntent.keepSelected
      ? assets.filter((asset) => !selectedSet.has(asset.id))
      : assets.filter((asset) => selectedSet.has(asset.id));
    const ids = new Set(doomed.map((asset) => asset.id));
    const left = assets.filter((asset) => !ids.has(asset.id));
    // Object URLs pin the file in memory until they are revoked.
    for (const asset of doomed) {
      if (asset.url) URL.revokeObjectURL(asset.url);
      if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl);
    }
    setAssets(left);
    setSelected([]);
    setRemoveIntent(null);
    if (left.length) setActiveId(left[0].id);
    touch(`Removed ${ids.size} image${ids.size === 1 ? "" : "s"}`);
  }, [assets, removeIntent, selectedSet, touch]);

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
    if (doc.presetId === preset.id) setDoc(docFromPreset(PRESETS[0]));
    touch(`Deleted ${preset.label}`);
  }, [doc.presetId, setDoc, touch]);

  /**
   * The export renders for real: each queued image is drawn at the document's
   * canvas size into the placeholder frame, then the batch is zipped and
   * downloaded. A browser cannot write to a local folder, so a download is the
   * only honest output.
   */
  const startExport = useCallback(async () => {
    if (!selectedExportQueue.length) return;
    cancelExport.current = false;
    setExportOpen(false);
    setRunDone(false);
    setRun({ done: 0, total: selectedExportQueue.length, current: "", failed: [] });
    const result = await runExport(selectedExportQueue, specFromDoc(doc), exportOptions,
      (progress) => setRun(progress),
      () => cancelExport.current);
    exportZip.current = result.zip;
    setRun(result.progress);
    setRunBytes(result.zip.byteLength);
    setRunDone(true);
    if (result.progress.done > result.progress.failed.length) downloadZip(result.zip, EXPORT_ZIP);
    touch(`Exported ${result.progress.done - result.progress.failed.length} image(s)`);
  }, [doc, exportOptions, selectedExportQueue, touch]);

  useEffect(() => {
    if (!assets.length && !["batch", "editor", "presets", "settings"].includes(screen)) goto("import");
  }, [assets.length, goto, screen]);

  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => () => {
    for (const asset of assetsRef.current) {
      if (asset.url) URL.revokeObjectURL(asset.url);
      if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl);
    }
  }, []);

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
      if (event.key === "Enter" && screen === "gallery" && active) { event.preventDefault(); openEditor(active); return; }
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

  if (focus && hasActive) return <main className="focus-workspace">
    <header className="focus-toolbar" aria-label="Focus mode toolbar">
      <Button variant="ghost" size="sm" onClick={() => setFocus(false)}><ArrowLeft /> Exit focus</Button>
      <div className="focus-title"><strong>{active.name}</strong><span>Editor focus mode</span></div>
      <div className="focus-toolbar-group" role="group" aria-label="Image navigation">
        <Button variant="ghost" size="icon" aria-label="Previous image" onClick={() => step(-1)}><ChevronLeft /></Button>
        <span>{assets.findIndex((asset) => asset.id === active.id) + 1} / {assets.length}</span>
        <Button variant="ghost" size="icon" aria-label="Next image" onClick={() => step(1)}><ChevronRight /></Button>
      </div>
      <div className="focus-tools" role="group" aria-label="Focus editing tools">
        {(["Fit", "Fill", "Stretch"] as const).map((fit) => <button key={fit} className={doc.fit === fit ? "active" : ""}
          data-tip={`${fit} image in frame`} title={`${fit} image in frame`} aria-label={`${fit} image in frame`}
          aria-pressed={doc.fit === fit} onClick={() => setDoc((current) => ({ ...current, fit }))}>{fit}</button>)}
        <button className="focus-tool" data-tip="Toggle guides" title="Toggle guides" aria-label="Toggle guides"
          aria-pressed={guides.grid} onClick={() => setGuides((current) => ({ ...current, grid: !current.grid }))}>Grid</button>
        <button className="focus-tool" data-tip="Reset frame to canvas" title="Reset frame to canvas" aria-label="Reset frame to canvas"
          onClick={() => setDoc((current) => ({ ...current, box: { x: 0, y: 0, w: 100, h: 100 } }))}>Reset</button>
      </div>
      <Button variant="secondary" size="sm" onClick={() => { setFocus(false); filesInput.current?.click(); }}><Upload /> Import</Button>
      <Button variant="ghost" size="icon" aria-label="Close focus mode" onClick={() => setFocus(false)}>×</Button>
    </header>
    <div className="focus-editor-host">
      <Editor asset={active} assets={assets} selected={selected} doc={doc} zoom={zoom} compare={false}
        compareView="split" splitAt={splitAt} overlay={overlay} guides={guides} target={target}
        onBox={setActiveBox} onSplit={setSplitAt} onChoose={openEditor} onImport={() => filesInput.current?.click()}
        onDrop={(files) => importFiles(files, true)} onFit={(fit) => setDoc((current) => ({ ...current, fit }))}
        onToggleGrid={() => setGuides((current) => ({ ...current, grid: !current.grid }))} onStep={step} focusMode />
    </div>
    <button className="canvas-arrow right" aria-label="Next image" onClick={() => step(1)}><ChevronRight /></button>
    <button className="canvas-arrow left" aria-label="Previous image" onClick={() => step(-1)}><ChevronLeft /></button>
    <div className="focus-zoom">
      <button aria-label="Zoom out" onClick={() => setZoom(Math.max(25, zoom - 25))}><Minus size={16} /></button>
      <span>{zoom}%</span>
      <button aria-label="Zoom in" onClick={() => setZoom(Math.min(400, zoom + 25))}><Plus size={16} /></button>
      <button aria-label="Reset zoom" onClick={() => setZoom(100)}><Expand size={16} /></button>
    </div>
  </main>;

  const back = backTarget(screen, assets.length > 0);
  const onImages = ["gallery", "editor", "review"].includes(screen);
  const showImageChrome = onImages;
  const zoomEnabled = screen === "editor" || screen === "gallery";
  const title = screen === "editor" && hasActive ? active.name
    : screen === "settings" ? "Settings"
    : screen === "presets" ? "Presets Manager"
    : screen === "review" ? "Error Diagnostics"
    : screen === "batch" ? "Batch convert"
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
        {showImageChrome && <>
          <div className="zoom-control" role="group" aria-label={screen === "editor" ? "Canvas zoom" : "Thumbnail size"}>
            <button aria-label="Zoom out" disabled={!zoomEnabled} onClick={() => setZoom((value) => Math.max(25, value - 25))}><Minus size={14} /></button>
            <span>{zoom}%</span>
            <button aria-label="Zoom in" disabled={!zoomEnabled} onClick={() => setZoom((value) => Math.min(400, value + 25))}><Plus size={14} /></button>
          </div>
          <Button variant="ghost" size="icon" aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((value) => !value)}><PanelRight /></Button>
          <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><CircleHelp /></Button>
        </>}
      </div>
    </header>

    <aside className="rail" aria-label="Main navigation">
      <div className="rail-main">
        <RailButton icon={Import} label="Import" active={screen === "import"} onClick={() => goto("import")} />
        <RailButton icon={ImageIcon} label="Images" active={["gallery", "editor", "review"].includes(screen)} onClick={() => goto(assets.length ? imageScreen : "editor")} />
        <RailButton icon={Layers} label="Batch" active={screen === "batch"} disabled={!sources.length} onClick={() => goto("batch")} />
        <RailButton icon={Layers3} label="Presets" active={screen === "presets"} onClick={() => goto("presets")} />
        <RailButton icon={Upload} label="Export" active={exportOpen} disabled={!exportQueue.length} onClick={() => setExportOpen(true)} />
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
      {screen === "editor" && <Editor asset={editorAsset} assets={assets} selected={selected} doc={doc} zoom={zoom}
        compare={compare} compareView={compareView} splitAt={splitAt} overlay={overlay} guides={guides} target={target}
        onBox={setActiveBox} onSplit={setSplitAt} onChoose={openEditor} onImport={() => filesInput.current?.click()}
        onDrop={(files) => importFiles(files, true)}
        onFit={(fit) => setDoc((current) => ({ ...current, fit }))}
        onToggleGrid={() => setGuides((current) => ({ ...current, grid: !current.grid }))} onStep={step} />}
      {screen === "review" && <Review assets={flagged} target={target} onOpen={openEditor}
        onFix={(id) => fixAssets([id])} onFixAll={() => fixAssets(flagged.map((asset) => asset.id))} onRetry={runApply} />}

      {inspectorOpen && (screen === "editor" || (hasActive && !["import", "presets", "settings", "batch"].includes(screen))) && (
        <Inspector doc={doc} target={target} asset={editorAsset} presets={presets} guides={guides} scope={scope}
            scopeCount={scoped.length} selectedCount={selected.length} totalCount={assets.length}
            compare={compare} overlay={overlay} processing={processing} progress={progress}
            onPreset={applyPreset} onDoc={setDoc} onGuides={setGuides} onScope={setScope} onOverlay={setOverlay}
            onApply={runApply} onFocus={() => { if (hasActive) { goto("editor"); setFocus(true); } else touch("Import an image to enter focus mode"); }} onClose={() => setInspectorOpen(false)}
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
        <Button className="export-cta" size="sm" disabled={!exportQueue.length} onClick={() => setExportOpen(true)}><Download /> Export</Button>
      </div>}
      <span>{onImages && hasActive
        ? `${active.src.w} × ${active.src.h} px · ${ratioLabel(doc.width, doc.height)} · ${active.format.toUpperCase()} · ${megabytes(active).toFixed(1)} MB`
        : ""}</span>
    </footer>

    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} queue={exportQueue} options={exportOptions}
      canvas={`${doc.width} × ${doc.height} px`} onOptions={setExportOptions} onStart={startExport}
      workflows={exportWorkflows}
      onSaveWorkflow={(name) => { const workflow: ExportWorkflow = { id: `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, options: exportOptions }; setExportWorkflows((current) => [...current.filter((item) => item.name !== name), workflow]); touch(`Saved workflow ${name}`); }}
      onApplyWorkflow={(workflow) => { setExportOptions({ ...workflow.options, selectedIds: null, customNames: {} }); touch(`Loaded workflow ${workflow.name}`); }} />
    <ExportProgress run={run} done={runDone} bytes={runBytes} queue={selectedExportQueue} options={exportOptions}
      onCancel={() => { cancelExport.current = true; }}
      onAgain={() => exportZip.current && downloadZip(exportZip.current, EXPORT_ZIP)}
      onClose={() => { cancelExport.current = true; setRun(null); }} />
    <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    <RemoveDialog intent={removeIntent} onCancel={() => setRemoveIntent(null)} onConfirm={confirmRemoval} />
    <PresetDialog draft={presetDraft} presets={presets} onCancel={() => setPresetDraft(null)} onSave={savePreset} />
    <ImportForkDialog summary={fork}
      onBatch={() => { setFork(null); goto("batch"); }}
      onEditor={() => { setFork(null); if (assets[0]) openEditor(assets[0]); else goto("gallery"); }} />
    <CloudDialog open={cloudOpen} onOpenChange={setCloudOpen} onImport={(names) => { setCloudOpen(false); importNames(names); }} />

    <input ref={filesInput} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => importFiles(event.target.files)} />
    <input ref={folderInput} type="file" accept="image/*" multiple className="sr-only" onChange={(event) => importFiles(event.target.files)}
      // @ts-expect-error non-standard folder picker, supported in Chromium and WebKit
      webkitdirectory="" />
  </main>;
}

function RailButton({ icon: Icon, label, active, disabled, onClick }: { icon: typeof Import; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button className={`${active ? "active " : ""}${label === "Export" ? "export-rail " : ""}`} aria-current={active ? "page" : undefined} disabled={disabled} onClick={onClick}>
    <Icon aria-hidden="true" /><span>{label}</span>
  </button>;
}
