import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, Columns2, Download, Expand, Image as ImageIcon,
  Import, Layers, Layers3, Minus, PanelLeft, PanelRight, Plus, Redo2, Settings, TriangleAlert,
  Undo2, Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CloudDialog, defaultExportOptions, ExportDialog, ExportProgress, PresetDialog, RemoveDialog,
  ReplaceFrameDialog, ShortcutsDialog, type ExportOptions, type ExportWorkflow,
} from "@/src/dialogs";
import {
  downloadZip, EXPORT_ZIP, exportUnits, runExport, specFromDoc,
  type ExportProgress as ExportRunProgress, type ExportUnit,
} from "@/src/exportrun";
import { inspectSources, summarise, toSources, type BatchSource } from "@/src/batch";
import { BatchScreen, ImportForkDialog } from "@/src/batchscreen";
import { Inspector, type Selection } from "@/src/inspector";
import { applyRecipeToAssets, createRecipe } from "@/src/editor-engine";
import {
  AssetImage, ContextualToolbar, defaultGuides, Editor, Gallery, ImportScreen, PresetManager,
  Review, SettingsScreen, type CompareView, type EditorTool, type Guides,
} from "@/src/screens";
import {
  assetIdOf, assetKey, backTarget, countByStatus, customPreset, docFromPreset, docTarget, emptyFilter, filterAssets,
  dropLayout, frameIdOf, frameKey, newPlacement, orderStack, placementIdOf, placementKey, reorderStack,
  megabytes, mergeImport, presetById, PRESETS, ratioLabel, redoTargets, statusOf, undoTargets,
  type Asset, type CanvasLayer, type Doc, type DupPolicy, type GalleryFilter, type Preset, type Scope, type Screen,
} from "@/src/flow";
import { fullPageImage, resetCrop, type CropRect, type ImageBox, type ImageElement } from "@/src/image-geometry";
import { clampZoom, fitViewport, zoomCentred, zoomToRect, type Viewport } from "@/src/viewport";
import { boxBounds } from "@/src/snap";
import { alignSelection, distributeSelection, type Edge as AlignEdge, type Selectable } from "@/src/selection";
import type { LayerRow } from "@/src/layers";
import {
  attachImage, contentPageElement, createFrame, fillFrame, fitFrame, removeFrame, replaceFrame,
  type FrameElement,
} from "@/src/frame-geometry";

const initialDoc = docFromPreset(presetById("zalando"));
const EMPTY_EDITOR_ASSET: Asset = {
  id: 0, name: "Untitled canvas", kind: "shoe", format: "png", src: { w: 1, h: 1 },
  processed: false, overflow: false, fixed: false, corrupt: false, element: fullPageImage(),
};
/** One image's before and after, inside a single undoable action. */
/**
 * One image's before and after, inside a single undoable action.
 *
 * This stack carries only the *subject's* geometry - the asset open in the
 * editor, before anything has placed it on the canvas.  Every placed layer
 * lives in the document, so moving one is a document edit and undoes on that
 * stack instead.
 */
type ElementChange = { assetId: number; before: ImageElement; after: ImageElement };
/**
 * An entry holds a list rather than one image, because a command can touch
 * several at once: aligning a multi-selection moves every member, and it has
 * to undo as the one thing the user did, not as five.
 */
type ElementHistoryEntry = { changes: ElementChange[]; seq: number };
/** Apply a set of changes to the asset list, in whichever direction. */
const applyChanges = (assets: Asset[], changes: ElementChange[], direction: "before" | "after") =>
  assets.map((asset) => {
    const change = changes.find((entry) => entry.assetId === asset.id);
    return change ? { ...asset, element: change[direction] } : asset;
  });
/** Where a file drop landed on the canvas: inside a frame, or free at a point. */
type DropTarget = { frameId?: string; at?: { x: number; y: number } };
const sameElement = (left: ImageElement, right: ImageElement) =>
  left.crop?.left === right.crop?.left && left.crop?.top === right.crop?.top
  && left.crop?.right === right.crop?.right && left.crop?.bottom === right.crop?.bottom
  && (left.crop === null) === (right.crop === null)
  && left.box.x === right.box.x && left.box.y === right.box.y && left.box.w === right.box.w && left.box.h === right.box.h
  && left.box.rotation === right.box.rotation && left.box.flipH === right.box.flipH && left.box.flipV === right.box.flipV
  && left.box.lockedRatio === right.box.lockedRatio;

/**
 * A single clock orders the two undo stacks. Document edits (canvas, frames)
 * and image-element edits are stored separately, so without a shared sequence
 * number Ctrl+Z would drain one stack before touching the other and undo
 * actions out of the order the user performed them.
 */
let historyClock = 0;
export const historyTick = () => (historyClock += 1);

type DocEntry = { doc: Doc; seq: number };

/** Undo/redo over the document snapshot only — navigation is never undoable. */
function useHistory(initial: Doc) {
  const [stack, setStack] = useState({ past: [] as DocEntry[], present: initial, future: [] as DocEntry[] });
  const setDoc = useCallback((next: Doc | ((current: Doc) => Doc), seq?: number) => {
    setStack((state) => {
      const present = typeof next === "function" ? next(state.present) : next;
      if (present === state.present) return state;
      return { past: [...state.past, { doc: state.present, seq: seq ?? historyTick() }].slice(-60), present, future: [] };
    });
  }, []);
  /** Mid-gesture update: no history entry, so a drag cannot flood the stack. */
  const setDocLive = useCallback((next: Doc | ((current: Doc) => Doc)) => {
    setStack((state) => {
      const present = typeof next === "function" ? next(state.present) : next;
      return present === state.present ? state : { ...state, present };
    });
  }, []);
  /**
   * Close a gesture by pushing the snapshot taken before it started.
   *
   * The sequence number can be supplied so a command that changed both the
   * document and an image element files both entries under one number, and
   * the paired undo puts them back together.
   */
  const commitDoc = useCallback((before: Doc, seq?: number) => {
    setStack((state) => state.present === before ? state
      : { past: [...state.past, { doc: before, seq: seq ?? historyTick() }].slice(-60), present: state.present, future: [] });
  }, []);
  const undo = useCallback(() => setStack((state) => state.past.length
    ? { past: state.past.slice(0, -1), present: state.past[state.past.length - 1].doc, future: [{ doc: state.present, seq: state.past[state.past.length - 1].seq }, ...state.future] }
    : state), []);
  const redo = useCallback(() => setStack((state) => state.future.length
    ? { past: [...state.past, { doc: state.present, seq: state.future[0].seq }], present: state.future[0].doc, future: state.future.slice(1) }
    : state), []);
  return {
    doc: stack.present, setDoc, setDocLive, commitDoc, undo, redo,
    canUndo: stack.past.length > 0, canRedo: stack.future.length > 0,
    lastUndoSeq: stack.past.length ? stack.past[stack.past.length - 1].seq : -1,
    nextRedoSeq: stack.future.length ? stack.future[0].seq : Infinity,
  };
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
  const [compare, setCompare] = useState(false);
  const [compareView, setCompareView] = useState<CompareView>("split");
  const [splitAt, setSplitAt] = useState(50);
  const [overlay, setOverlay] = useState(100);
  // Focus is a small, horizontal review gallery first.  An image only opens
  // into the distraction-free canvas after it is deliberately chosen.
  const [focus, setFocus] = useState<false | "gallery" | "editor">(false);
  const [focusTool, setFocusTool] = useState<EditorTool>("image");
  const [cropSession, setCropSession] = useState<{ assetId: number; crop: CropRect | null } | null>(null);
  /** Which frame is selected, and whether its content is being edited. */
  const [frameSelection, setFrameSelection] = useState<{ id: string; editing: boolean } | null>(null);
  const [replaceIntent, setReplaceIntent] = useState<{ frameId: string; assetId: number; name: string; at?: { x: number; y: number } } | null>(null);
  const [elementHistory, setElementHistory] = useState({ past: [] as ElementHistoryEntry[], future: [] as ElementHistoryEntry[] });
  const elementTransaction = useRef<{ assetId: number; before: ImageElement } | null>(null);
  const commitElementTransactionRef = useRef<() => void>(() => {});
  const [railOpen, setRailOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  /** Gallery thumbnail size. The editor has its own viewport, not a zoom level. */
  const [zoom, setZoom] = useState(100);
  /** Zoom 0 means "not placed yet": the editor fits the page on first measure. */
  const [viewport, setViewport] = useState<Viewport>({ zoom: 0, panX: 0, panY: 0 });
  const [editorView, setEditorView] = useState({ width: 0, height: 0 });
  /** The live viewport and the running glide, for callbacks that must not close over either. */
  const viewportRef = useRef<Viewport>({ zoom: 0, panX: 0, panY: 0 });
  const glide = useRef<number | null>(null);
  /**
   * The two view commands, reached through a ref.
   *
   * The window-level key handler is installed by an effect that runs long
   * before these are defined, and its dependency list does not - and should
   * not - list them: adding two callbacks that change with every resize would
   * tear the listener down and rebuild it constantly.  A ref reassigned each
   * render gives the handler the current pair without that.
   */
  const viewCommands = useRef({ fit: () => {}, zoomToSelection: () => {} });
  /** Same reason as `viewCommands`: the key handler outlives each render's list. */
  const selectablesRef = useRef<Selectable[]>([]);
  /**
   * The canvas selection: the keys of every object a command applies to.
   *
   * This is not the gallery's `selected`, which is a batch concept - which
   * files an export writes.  A canvas selection spans two kinds of object,
   * free images and frames, which is why it holds keys rather than ids.
   */
  const [canvasSelection, setCanvasSelection] = useState<string[]>([]);
  /** Space is held: a drag on the workspace pans instead of selecting. */
  const [spacePan, setSpacePan] = useState(false);
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

  const { doc, setDoc, setDocLive, commitDoc, undo: undoDocument, redo: redoDocument,
    canUndo: canUndoDocument, canRedo: canRedoDocument, lastUndoSeq, nextRedoSeq } = useHistory(initialDoc);
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
  /**
   * The files the run will write.
   *
   * The dialog picks *images*, which is what a person thinks in; the run works
   * in instances, because an image placed three times is three files (§22).
   * The two counts differ only when something has been placed more than once.
   *
   * This is a function and not a memo on purpose. Building it costs one layer
   * list per file - each one hides a different copy - and as a memo over the
   * document that ran on every pointer move of every drag, which is exactly
   * the work that made dragging stutter.
   */
  const exportRunFor = useCallback((): ExportUnit[] => {
    const units = exportUnits(docRef.current, assetsRef.current);
    return exportOptions.selectedIds === null
      ? units : units.filter((unit) => exportOptions.selectedIds!.includes(unit.asset.id));
  }, [exportOptions.selectedIds]);
  /** Only while the dialog is open, where the count is actually read. */
  const exportFileCount = useMemo(
    () => exportOpen ? exportRunFor().length : 0, [exportOpen, exportRunFor, doc, assets]);
  const visible = useMemo(() => filterAssets(assets, target, filter), [assets, target, filter]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const scoped = useMemo(() => scope === "all" ? assets : scope === "selected" ? assets.filter((asset) => selectedSet.has(asset.id)) : assets.filter((asset) => asset.id === activeId), [assets, scope, selectedSet, activeId]);
  const flagged = useMemo(() => assets.filter((asset) => ["Warning", "Error"].includes(statusOf(asset, target))), [assets, target]);

  /**
   * Leaving the current layer closes both open edits: the crop transaction and
   * any frame content session. Both keep their result; only Esc discards.
   */
  const doneContentEditRef = useRef<() => void>(() => {});
  const finishCrop = useCallback(() => {
    commitElementTransactionRef.current();
    doneContentEditRef.current();
    setCropSession(null);
    setFocusTool("image");
  }, []);

  /** The only screen navigator. Modifiers that need the canvas force the editor. */
  const goto = useCallback((next: Screen) => {
    finishCrop();
    setScreen(next);
    if (next === "gallery" || next === "editor") setImageScreen(next);
    if (next !== "editor") setCompare(false);
  }, [finishCrop]);

  const touch = useCallback((message = "") => {
    setSaving(true);
    if (message) setNotice(message);
    window.setTimeout(() => setSaving(false), 700);
  }, []);

  /** Opening another asset commits any current crop before changing selection. */
  const openEditor = useCallback((asset: Asset) => {
    finishCrop();
    setActiveId(asset.id);
    goto("editor");
  }, [finishCrop, goto]);

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
    setDoc((current) => ({ ...docFromPreset(presetById(id, presets)), frames: current.frames }));
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

  const setActiveElement = useCallback((element: ImageElement) => {
    if (!active) return;
    const currentAsset = assetsRef.current.find((asset) => asset.id === active.id) ?? active;
    if (sameElement(element, currentAsset.element)) return;
    const next = assetsRef.current.map((asset) => asset.id === active.id ? { ...asset, element, processed: true, fixed: false } : asset);
    assetsRef.current = next;
    setAssets(next);
  }, [active]);
  const beginElementTransaction = useCallback(() => {
    if (!active || elementTransaction.current) return;
    const current = assetsRef.current.find((asset) => asset.id === active.id) ?? active;
    elementTransaction.current = { assetId: active.id, before: current.element };
  }, [active]);
  const commitElementTransaction = useCallback(() => {
    const transaction = elementTransaction.current;
    if (!transaction) return;
    elementTransaction.current = null;
    const after = assetsRef.current.find((asset) => asset.id === transaction.assetId)?.element;
    if (!after || sameElement(transaction.before, after)) return;
    setElementHistory((history) => ({
      past: [...history.past, { changes: [{ assetId: transaction.assetId, before: transaction.before, after }], seq: historyTick() }].slice(-60), future: [],
    }));
  }, []);
  commitElementTransactionRef.current = commitElementTransaction;
  const discardElementTransaction = useCallback(() => { elementTransaction.current = null; }, []);
  const applyElementAction = useCallback((element: ImageElement) => {
    beginElementTransaction();
    setActiveElement(element);
    commitElementTransaction();
  }, [beginElementTransaction, commitElementTransaction, setActiveElement]);
  const undo = useCallback(() => {
    commitElementTransaction();
    const entry = elementHistory.past[elementHistory.past.length - 1];
    const targets = undoTargets(entry?.seq ?? null, lastUndoSeq);
    if (targets.document) undoDocument();
    if (!entry || !targets.element) return;
    const next = applyChanges(assetsRef.current, entry.changes, "before");
    assetsRef.current = next; setAssets(next);
    setElementHistory((history) => ({ past: history.past.slice(0, -1), future: [entry, ...history.future] }));
  }, [commitElementTransaction, elementHistory.past, lastUndoSeq, undoDocument]);
  const redo = useCallback(() => {
    commitElementTransaction();
    const entry = elementHistory.future[0];
    const targets = redoTargets(entry?.seq ?? null, nextRedoSeq);
    if (targets.document) redoDocument();
    if (!entry || !targets.element) return;
    const next = applyChanges(assetsRef.current, entry.changes, "after");
    assetsRef.current = next; setAssets(next);
    setElementHistory((history) => ({ past: [...history.past, entry].slice(-60), future: history.future.slice(1) }));
  }, [commitElementTransaction, elementHistory.future, nextRedoSeq, redoDocument]);
  const canUndo = elementHistory.past.length > 0 || canUndoDocument;
  const canRedo = elementHistory.future.length > 0 || canRedoDocument;

  /* ---------------------------------------------------------------- frames */

  /**
   * A document gesture - a frame drag or resize, a whole content-edit session,
   * or a slider being dragged in the inspector - snapshots the document once
   * at the start and writes live updates without history, so the gesture
   * leaves exactly one undo entry. Nested gestures keep the outer snapshot:
   * editing content inside an open session stays one action.
   */
  const docGesture = useRef<Doc | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const beginDocGesture = useCallback(() => { if (!docGesture.current) docGesture.current = docRef.current; }, []);
  /** Any inspector control writes live while a gesture is open on it. */
  const writeDoc = useCallback((next: (current: Doc) => Doc) => {
    (docGesture.current ? setDocLive : setDoc)(next);
  }, [setDoc, setDocLive]);
  const commitDocGesture = useCallback(() => {
    const before = docGesture.current;
    docGesture.current = null;
    if (before) commitDoc(before);
  }, [commitDoc]);
  /** Esc: put the document back exactly as it was, leaving no history entry. */
  const cancelDocGesture = useCallback(() => {
    const before = docGesture.current;
    docGesture.current = null;
    if (before) setDocLive(before);
  }, [setDocLive]);
  /**
   * Release a framed image back onto the canvas as a free layer, recording the
   * move under `seq` so it undoes together with the document change that goes
   * with it.
   */
  const releasedPlacement = useCallback((frame: FrameElement) => {
    const asset = assetsRef.current.find((item) => item.id === frame.imageId);
    return asset ? newPlacement(asset.id, contentPageElement(frame)) : null;
  }, []);

  const frames = doc.frames;
  /** An image inside a frame is drawn by that frame, never as a free layer too. */
  const framedIds = useMemo(() => new Set(frames.map((frame) => frame.imageId).filter((id): id is number => id !== null)), [frames]);
  /**
   * Every free image on the canvas.
   *
   * The document's placements are the canvas proper - an asset can appear as
   * many times as it likes, each with its own geometry.  On top of that the
   * asset open in the editor is previewed even when nothing has placed it:
   * that is the batch case, where the canvas is a template and each import is
   * run through it in turn.
   */
  const canvasLayers: CanvasLayer[] = useMemo(() => {
    const placed = doc.placements
      .filter((placement) => !framedIds.has(placement.assetId))
      .map((placement) => ({
        key: placementKey(placement.id), assetId: placement.assetId,
        element: placement.element, placementId: placement.id,
      }));
    const already = new Set(placed.map((layer) => layer.assetId));
    const subject = activeId !== null && !already.has(activeId) && !framedIds.has(activeId)
      ? assets.filter((asset) => asset.id === activeId)
        .map((asset) => ({ key: assetKey(asset.id), assetId: asset.id, element: asset.element, placementId: null }))
      : [];
    return [...placed, ...subject];
  }, [assets, activeId, doc.placements, framedIds]);
  const layerByKey = useMemo(() => new Map(canvasLayers.map((layer) => [layer.key, layer])), [canvasLayers]);

  /** Write one layer's geometry to whichever list owns it. */
  const writeLayer = useCallback((layer: CanvasLayer, element: ImageElement, live = false) => {
    if (layer.placementId === null) { setActiveElement(element); return; }
    const id = layer.placementId;
    (live || docGesture.current ? setDocLive : setDoc)((current) => ({
      ...current,
      placements: current.placements.map((placement) => placement.id === id ? { ...placement, element } : placement),
    }));
  }, [setActiveElement, setDoc, setDocLive]);

  /**
   * The layer the single-object tools act on.
   *
   * One selected object means that object; otherwise it is whatever instance
   * of the active asset is on the canvas, which for a plain batch is the
   * subject preview.
   */
  const activeLayer: CanvasLayer | null = useMemo(() => {
    const picked = canvasSelection.length === 1 ? layerByKey.get(canvasSelection[0]) : undefined;
    return picked ?? canvasLayers.find((layer) => layer.assetId === activeId) ?? null;
  }, [activeId, canvasLayers, canvasSelection, layerByKey]);

  /**
   * Edits go to whichever list owns the layer: a placement is document state
   * and undoes on the document stack, the subject's own geometry is asset
   * state and undoes on the element stack. The editor never has to know which.
   */
  const writeActiveElement = useCallback((element: ImageElement) => {
    if (activeLayer) writeLayer(activeLayer, element);
    else setActiveElement(element);
  }, [activeLayer, setActiveElement, writeLayer]);
  const beginActiveGesture = useCallback(() => {
    if (activeLayer?.placementId) beginDocGesture(); else beginElementTransaction();
  }, [activeLayer, beginDocGesture, beginElementTransaction]);
  const commitActiveGesture = useCallback(() => {
    if (activeLayer?.placementId) commitDocGesture(); else commitElementTransaction();
  }, [activeLayer, commitDocGesture, commitElementTransaction]);
  const applyActiveElement = useCallback((element: ImageElement) => {
    beginActiveGesture(); writeActiveElement(element); commitActiveGesture();
  }, [beginActiveGesture, commitActiveGesture, writeActiveElement]);

  /**
   * Place another copy of the selected layer (§22).
   *
   * An asset is a reusable source, so the copy is a new placement of the same
   * file rather than a second import: the two share one decode, one thumbnail
   * and one entry in the Gallery. It is offset so it does not hide underneath
   * the original.
   */
  const duplicateLayer = useCallback(() => {
    if (!activeLayer) return false;
    const box = activeLayer.element.box;
    // Far enough that the copy is unmistakably a second object. A three
    // percent nudge on a full-page layer is invisible, and the first version
    // of this shipped exactly that.
    const step = Math.max(6, Math.min(box.w, box.h) / 4);
    const copy = newPlacement(activeLayer.assetId, {
      ...activeLayer.element,
      box: { ...box, x: box.x + step, y: box.y + step },
    });
    setDoc((current) => ({
      ...current,
      placements: activeLayer.placementId === null
        // The subject is only *previewed* on the canvas; the document has
        // never been told it is there. Adding a placement for the same asset
        // hides that preview, so duplicating the subject has to write the
        // original down as well - otherwise the copy replaces it and the
        // canvas still shows exactly one image.
        ? [...current.placements, newPlacement(activeLayer.assetId, activeLayer.element), copy]
        : [...current.placements, copy],
    }));
    setCanvasSelection([placementKey(copy.id)]);
    touch("Layer duplicated");
    return true;
  }, [activeLayer, setDoc, touch]);


  /**
   * While a gesture is open every write is live: the snapshot taken when it
   * started is the only history entry, so Fill or Fit pressed mid-session does
   * not split one action into several.
   */
  const writeFrame = useCallback((next: FrameElement, live = false) => {
    (live || docGesture.current ? setDocLive : setDoc)((current) => ({ ...current, frames: replaceFrame(current.frames, next) }));
  }, [setDoc, setDocLive]);

  const addFrame = useCallback((box?: { x: number; y: number; w: number; h: number }) => {
    const frame = createFrame(box ?? { x: 20, y: 20, w: 60, h: 60 });
    setDoc((current) => ({ ...current, frames: [...current.frames, frame] }));
    setFrameSelection({ id: frame.id, editing: false });
    touch("Frame added");
    return frame;
  }, [setDoc, touch]);

  /**
   * Deleting a frame never deletes an image: whatever was inside returns to the
   * canvas as a free image at the place it appeared to occupy.
   */
  const deleteFrame = useCallback((id: string) => {
    const frame = docRef.current.frames.find((item) => item.id === id);
    if (!frame) return;
    commitDocGesture();
    // The frame goes and its image stays, as a free layer exactly where it
    // was. Both halves are one document change, so both undo together.
    const released = frame.imageId === null ? null : releasedPlacement(frame);
    setDoc((current) => ({
      ...current,
      frames: removeFrame(current.frames, id),
      placements: released ? [...current.placements, released] : current.placements,
    }));
    setFrameSelection(null);
    setCanvasSelection(released ? [placementKey(released.id)] : []);
    touch(frame.imageId === null ? "Frame deleted" : "Frame deleted — image kept on the canvas");
  }, [commitDocGesture, releasedPlacement, setDoc, touch]);

  const attachToFrame = useCallback((frameId: string, assetId: number, force = false) => {
    const frame = docRef.current.frames.find((item) => item.id === frameId);
    if (!force && frame && frame.imageId !== null && frame.imageId !== assetId) {
      const incoming = assetsRef.current.find((item) => item.id === assetId);
      if (incoming) { setReplaceIntent({ frameId, assetId, name: incoming.name }); return; }
    }
    const asset = assetsRef.current.find((item) => item.id === assetId);
    if (!frame || !asset) return;
    const page = { width: docRef.current.width, height: docRef.current.height };
    // The image being replaced stays on the page as a free layer instead of
    // disappearing from the canvas with no way back. One document change, so
    // the swap and the release undo together.
    const evicted = frame.imageId !== null && frame.imageId !== assetId ? releasedPlacement(frame) : null;
    setDoc((current) => ({
      ...current,
      frames: replaceFrame(current.frames, attachImage(frame, assetId, asset.src, page)),
      // Taking an image into a frame removes whatever placed it on the canvas:
      // an image is drawn by its frame or as a free layer, never as both.
      placements: [
        ...current.placements.filter((item) => item.assetId !== assetId),
        ...(evicted ? [evicted] : []),
      ],
    }));
    setFrameSelection({ id: frameId, editing: false });
    setActiveId(assetId);
    touch(frame.imageId === null ? `${asset.name} placed in frame` : `${asset.name} replaced the framed image`);
  }, [releasedPlacement, setDoc, touch, writeFrame]);

  /** Pull an image back out of its frame; the frame stays, now empty. */
  const detachFromFrame = useCallback((frameId: string) => {
    const frame = docRef.current.frames.find((item) => item.id === frameId);
    if (!frame || frame.imageId === null) return;
    commitDocGesture();
    const released = releasedPlacement(frame);
    setDoc((current) => ({
      ...current,
      frames: replaceFrame(current.frames, { ...frame, imageId: null, content: null }),
      placements: released ? [...current.placements, released] : current.placements,
    }));
    setFrameSelection({ id: frameId, editing: false });
    if (released) setCanvasSelection([placementKey(released.id)]);
    touch("Image detached from frame");
  }, [commitDocGesture, releasedPlacement, setDoc, touch]);

  const refitFrame = useCallback((frameId: string, mode: "fill" | "fit") => {
    const frame = docRef.current.frames.find((item) => item.id === frameId);
    const asset = frame && frame.imageId !== null ? assetsRef.current.find((item) => item.id === frame.imageId) : null;
    if (!frame || !asset) return;
    const page = { width: docRef.current.width, height: docRef.current.height };
    writeFrame(mode === "fill" ? fillFrame(frame, asset.src, page) : fitFrame(frame, asset.src, page));
  }, [writeFrame]);

  /** Double-click: edit the image inside the frame without touching the frame. */
  const contentBaseline = useRef<{ frameId: string; frame: FrameElement } | null>(null);
  const startContentEdit = useCallback((frameId: string) => {
    const frame = docRef.current.frames.find((item) => item.id === frameId);
    if (!frame || frame.imageId === null) return;
    beginDocGesture();
    contentBaseline.current = { frameId, frame };
    setFrameSelection({ id: frameId, editing: true });
  }, [beginDocGesture]);
  /** Reset means the state this session started from, not a fresh Fill. */
  const resetContentEdit = useCallback(() => {
    const baseline = contentBaseline.current;
    if (baseline) writeFrame(baseline.frame, true);
  }, [writeFrame]);
  const doneContentEdit = useCallback(() => {
    commitDocGesture();
    setFrameSelection((current) => current?.editing ? { ...current, editing: false } : current);
  }, [commitDocGesture]);
  doneContentEditRef.current = doneContentEdit;
  const cancelContentEdit = useCallback(() => {
    cancelDocGesture();
    setFrameSelection((current) => current ? { ...current, editing: false } : current);
  }, [cancelDocGesture]);

  /**
   * Choosing a framed image selects its frame, because that image has no free
   * element on the page. This runs on a change of active image only: watching
   * the selection instead would re-select the frame the user just dismissed.
   */
  const autoSelected = useRef<number | null>(null);
  useEffect(() => {
    if (autoSelected.current === activeId) return;
    autoSelected.current = activeId;
    const holder = frames.find((frame) => frame.imageId === activeId);
    if (holder) setFrameSelection({ id: holder.id, editing: false });
  }, [activeId, frames]);

  /**
   * Remove the selected free image from the page. Only extra layers can go:
   * the batch image is the page's own subject, and the Gallery keeps the file
   * either way.
   */
  const removeLayer = useCallback(() => {
    const selected = canvasSelection.length === 1 ? layerByKey.get(canvasSelection[0]) : null;
    const target = selected ?? canvasLayers.find((layer) => layer.assetId === activeId);
    // The subject is the page's own image, not an extra layer: it has nothing
    // to be removed from, and the Gallery keeps the file either way.
    if (!target?.placementId) return false;
    const id = target.placementId;
    setDoc((current) => ({ ...current, placements: current.placements.filter((item) => item.id !== id) }));
    setCanvasSelection([]);
    touch(`${assetsRef.current.find((item) => item.id === target.assetId)?.name ?? "Layer"} removed from the canvas`);
    return true;
  }, [activeId, canvasLayers, canvasSelection, layerByKey, setDoc, touch]);

  /**
   * What the inspector's transform panel points at.  A selected frame owns the
   * selection while it is active, exactly as the canvas overlay treats it;
   * otherwise it is the free image being edited.  Away from the editor there is
   * no canvas, so there is nothing to transform.
   */
  const selectedFrameObject = frames.find((frame) => frame.id === frameSelection?.id) ?? null;
  const selection: Selection | null = screen !== "editor" ? null
    : selectedFrameObject
      ? { label: selectedFrameObject.imageId === null ? "Empty frame" : "Frame", box: selectedFrameObject.box }
      : activeLayer && active ? { label: active.name, box: activeLayer.element.box } : null;
  /** One typed edit is one history entry, on whichever of the two stacks owns it. */
  const setSelectionBox = (box: ImageBox) => {
    if (selectedFrameObject) { writeFrame({ ...selectedFrameObject, box }); return; }
    if (activeLayer) applyActiveElement({ ...activeLayer.element, box });
  };

  /* ------------------------------------------------- multi-selection commands

     Every member of a selection is an ordinary object that keeps its own
     identity; a command computes new boxes for all of them and writes them
     back in one action (§18).  Nothing is grouped and nothing is reparented,
     so there is no state to unwind if the user changes their mind. */

  const selectables: Selectable[] = useMemo(() => [
    ...canvasLayers.map((layer) => ({ key: layer.key, box: layer.element.box })),
    ...frames.map((item) => ({ key: frameKey(item.id), box: item.box })),
  ], [canvasLayers, frames]);
  const selectedItems = useMemo(
    () => selectables.filter((item) => canvasSelection.includes(item.key)), [selectables, canvasSelection]);

  /** A gesture over a selection: snapshot once, write live, commit once. */
  const selectionGesture = useRef<{ assets: Asset[]; doc: Doc } | null>(null);
  const beginSelectionGesture = useCallback(() => {
    if (!selectionGesture.current) selectionGesture.current = { assets: assetsRef.current, doc: docRef.current };
  }, []);
  /** Write new boxes without history; the gesture owns the one entry. */
  const writeSelection = useCallback((next: Selectable[]) => {
    const boxes = new Map(next.map((item) => [item.key, item.box]));
    const assetsNext = assetsRef.current.map((asset) => {
      const box = boxes.get(assetKey(asset.id));
      return box ? { ...asset, element: { ...asset.element, box } } : asset;
    });
    assetsRef.current = assetsNext; setAssets(assetsNext);
    setDocLive((current) => ({
      ...current,
      placements: current.placements.map((placement) => {
        const box = boxes.get(placementKey(placement.id));
        return box ? { ...placement, element: { ...placement.element, box } } : placement;
      }),
      frames: current.frames.map((frame) => {
        const box = boxes.get(frameKey(frame.id));
        return box ? { ...frame, box } : frame;
      }),
    }));
  }, [setDocLive]);
  /**
   * Close the gesture with one entry on each stack, sharing a sequence number
   * so a command that moved both an image and a frame undoes as one action.
   */
  const commitSelectionGesture = useCallback(() => {
    const snapshot = selectionGesture.current;
    selectionGesture.current = null;
    if (!snapshot) return;
    const seq = historyTick();
    const changes: ElementChange[] = [];
    for (const before of snapshot.assets) {
      const after = assetsRef.current.find((item) => item.id === before.id);
      if (after && !sameElement(before.element, after.element)) {
        changes.push({ assetId: before.id, before: before.element, after: after.element });
      }
    }
    if (changes.length) setElementHistory((history) => ({ past: [...history.past, { changes, seq }].slice(-60), future: [] }));
    commitDoc(snapshot.doc, seq);
  }, [commitDoc]);
  /** A command with no drag behind it is the same thing without the middle. */
  const runSelectionCommand = useCallback((next: Selectable[]) => {
    beginSelectionGesture();
    writeSelection(next);
    commitSelectionGesture();
  }, [beginSelectionGesture, commitSelectionGesture, writeSelection]);

  /**
   * Point the whole editor at a set of keys.
   *
   * The canvas selection and the two older single-object selections - the
   * active asset, which is also the batch's subject, and the frame being
   * edited - have to agree, or the inspector would describe one object while
   * the canvas outlined another.  One key means "this object is selected" in
   * every sense; several means the group owns the canvas and the single-object
   * chrome steps aside; none clears everything.
   */
  const selectKeys = useCallback((keys: string[]) => {
    setCanvasSelection(keys);
    if (keys.length !== 1) {
      if (keys.length === 0) setFrameSelection(null);
      return;
    }
    const frameId = frameIdOf(keys[0]);
    if (frameId) { setFrameSelection({ id: frameId, editing: false }); return; }
    setFrameSelection(null);
    // Selecting a placement makes its source the active asset too, so the
    // inspector and the filmstrip agree with the canvas about what is in hand.
    const layer = layerByKey.get(keys[0]);
    const assetId = layer ? layer.assetId : assetIdOf(keys[0]);
    if (assetId !== null && assetId !== undefined) setActiveId(assetId);
  }, []);

  /**
   * Clear a whole selection off the canvas in one action.
   *
   * It has to be one action rather than a loop over the single-object paths,
   * because each of those files its own pair of history entries and the paired
   * undo pops one pair at a time: deleting six objects would take six presses
   * of Ctrl+Z to put back.  The rules are the ones the single-object commands
   * already follow - a frame releases its image back onto the canvas, and a
   * free image leaves the canvas while its file stays in the gallery.
   */
  const deleteSelected = useCallback(() => {
    if (canvasSelection.length < 2) return false;
    commitDocGesture();
    const frameIds = new Set(canvasSelection.map(frameIdOf).filter((id): id is string => id !== null));
    const placementIds = new Set(canvasSelection.map(placementIdOf).filter((id): id is string => id !== null));
    if (!frameIds.size && !placementIds.size) return false;
    // One document change: frames go, their images stay as free layers where
    // they were, and selected free layers go. Every part undoes together.
    setDoc((current) => {
      const released = current.frames
        .filter((frame) => frameIds.has(frame.id) && frame.imageId !== null)
        .flatMap((frame) => { const placement = releasedPlacement(frame); return placement ? [placement] : []; });
      return {
        ...current,
        frames: current.frames.filter((frame) => !frameIds.has(frame.id)),
        placements: [...current.placements.filter((item) => !placementIds.has(item.id)), ...released],
      };
    });
    setCanvasSelection([]); setFrameSelection(null);
    touch(`Removed ${canvasSelection.length} objects from the canvas`);
    return true;
  }, [canvasSelection, commitDocGesture, releasedPlacement, setDoc, touch]);

  /**
   * The stack as the panel shows it: topmost first.
   *
   * The document stores it bottom-to-top, which is the order a renderer
   * paints in; a reader thinks in the other direction, so the reversal lives
   * here and nowhere else.
   */
  /**
   * The canvas stack, bottom to top.
   *
   * The subject - the asset open in the editor that nothing has placed yet -
   * is pinned to the base and left out of the arranged order. The exporter
   * draws it underneath every layer and has no way to put it anywhere else,
   * so a panel that let it be dragged would be showing an order the file does
   * not have. Placing it (Ctrl+D, or dropping it) turns it into an ordinary
   * layer that moves like any other.
   */
  const subjectKey = canvasLayers.find((layer) => layer.placementId === null)?.key ?? null;
  const arrangeable = useMemo(() => [
    ...canvasLayers.filter((layer) => layer.placementId !== null).map((layer) => layer.key),
    ...frames.map((item) => frameKey(item.id)),
  ], [canvasLayers, frames]);
  const stackKeys = useMemo(
    () => [...(subjectKey ? [subjectKey] : []), ...orderStack(doc.stack, arrangeable)],
    [arrangeable, doc.stack, subjectKey]);
  const reorderRef = useRef({ stack: doc.stack, arrangeable });
  reorderRef.current = { stack: doc.stack, arrangeable };
  /**
   * What the layers panel actually depends on: which objects exist, what they
   * are called, and in what order. Not where any of them is.
   *
   * The arrays below are rebuilt on every frame of every drag, because a box
   * moved - so memoising the rows on those arrays would memoise nothing. This
   * signature changes only when the *list* changes, which is the honest
   * dependency, and it is what lets the panel skip a render it has no news
   * for. Everything the body reads and that can change is in here.
   */
  const structure = [
    stackKeys.join("|"),
    frames.map((frame) => `${frame.id}:${frame.imageId}`).join("|"),
    assets.map((asset) => `${asset.id}:${asset.name}:${asset.thumbnailUrl ?? asset.url ?? ""}`).join("|"),
    subjectKey ?? "",
  ].join("::");
  const layersRef = useRef({ stackKeys, frames, assets, canvasLayers, subjectKey });
  layersRef.current = { stackKeys, frames, assets, canvasLayers, subjectKey };
  const layerRows: LayerRow[] = useMemo(() => {
    const { stackKeys: order, frames: onPage, assets: sources, canvasLayers: layers, subjectKey: pinned } = layersRef.current;
    return [...order].reverse().map((key) => {
      const frame = onPage.find((item) => frameKey(item.id) === key);
      if (frame) {
        const inside = sources.find((item) => item.id === frame.imageId);
        return { key, name: inside?.name ?? "Empty frame", frame: true, empty: frame.imageId === null, asset: inside, pinned: false };
      }
      const layer = layers.find((item) => item.key === key);
      const asset = sources.find((item) => item.id === layer?.assetId);
      return { key, name: asset?.name ?? key, frame: false, empty: false, asset, pinned: key === pinned };
    });
  }, [structure]);

  /**
   * Move a layer. The panel counts slots from the top; the stack counts from
   * the bottom, so a slot `i` rows down the panel is `length - i` up the
   * stack. Doing the arithmetic once, here, is what keeps the panel able to
   * think in nothing but its own order.
   */
  const reorderLayer = useCallback((key: string, to: number) => {
    // The same list the panel is showing, so the slot the user dropped into
    // means the same thing at both ends. Deriving it twice is how a panel and
    // a document drift apart. Read through the ref, so this callback keeps one
    // identity and the memoised panel is not rebuilt for every drag frame.
    const { stack, arrangeable: rows } = reorderRef.current;
    const order = orderStack(stack, rows);
    // The panel counts slots from the top and the stack from the bottom. The
    // pinned subject sits below every arrangeable row, so it shifts no slot -
    // it only adds one past the end, which clamps to the bottom.
    const next = reorderStack(order, key, order.length - to);
    if (next.join() !== order.join()) setDoc((current) => ({ ...current, stack: next }));
  }, [setDoc]);

  /** Stable for the memoised panel; the live selection arrives through a ref. */
  const selectionRef = useRef(canvasSelection);
  selectionRef.current = canvasSelection;
  const pickLayer = useCallback((key: string, additive: boolean) => {
    const current = selectionRef.current;
    selectKeys(additive
      ? (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key])
      : [key]);
  }, [selectKeys]);

  const alignSelected = useCallback((edge: AlignEdge) => {
    if (selectedItems.length > 1) runSelectionCommand(alignSelection(selectedItems, edge));
  }, [runSelectionCommand, selectedItems]);
  const distributeSelected = useCallback((axis: "x" | "y") => {
    if (selectedItems.length > 2) runSelectionCommand(distributeSelection(selectedItems, axis));
  }, [runSelectionCommand, selectedItems]);

  const frameProps = {
    canvasLayers, frameSelection,
    onFrameAdd: addFrame, onFrameWrite: writeFrame,
    onFrameGestureStart: beginDocGesture, onFrameGestureEnd: commitDocGesture,
    onFrameSelect: (id: string | null) => {
      setFrameSelection(id ? { id, editing: false } : null);
      setCanvasSelection(id ? [frameKey(id)] : []);
    },
    onFrameContentEdit: startContentEdit, onFrameContentDone: doneContentEdit, onFrameContentCancel: cancelContentEdit,
    onFrameDelete: deleteFrame, onFrameRefit: refitFrame, onFrameReset: resetContentEdit,
    onFrameDetach: detachFromFrame, onFrameAttach: attachToFrame,
  };
  const startCrop = useCallback(() => {
    if (!active) return;
    beginElementTransaction();
    setCropSession((current) => current?.assetId === active.id ? current : { assetId: active.id, crop: active.element.crop ? { ...active.element.crop } : null });
  }, [active, beginElementTransaction]);
  const resetActiveCrop = useCallback(() => {
    if (!active) return;
    setActiveElement(resetCrop(active.element));
  }, [active, setActiveElement]);
  const cancelCrop = useCallback(() => {
    if (!cropSession) return;
    const next = assetsRef.current.map((asset) => asset.id === cropSession.assetId
      ? { ...asset, element: { ...asset.element, crop: cropSession.crop ? { ...cropSession.crop } : null } }
      : asset);
    assetsRef.current = next; setAssets(next);
    discardElementTransaction();
    setCropSession(null);
    setFocusTool("image");
  }, [cropSession, discardElementTransaction]);

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
  const importFiles = useCallback(async (incoming: FileList | null, quick = false, drop?: DropTarget) => {
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
      faint: source.faint,
    }));
    const merged = mergeImport(assets, incomingAssets, policy);
    const retainedUrls = new Set(merged.assets.flatMap((asset) => [asset.url, asset.thumbnailUrl].filter(Boolean)));
    for (const asset of [...assets, ...incomingAssets]) {
      if (asset.url && !retainedUrls.has(asset.url)) URL.revokeObjectURL(asset.url);
      if (asset.thumbnailUrl && !retainedUrls.has(asset.thumbnailUrl)) URL.revokeObjectURL(asset.thumbnailUrl);
    }
    const importedUrls = new Set(incomingAssets.map((asset) => asset.url));
    const landed = merged.assets.filter((asset) => asset.url && importedUrls.has(asset.url));
    setAssets(merged.assets);
    assetsRef.current = merged.assets;
    // A drop lands where it was dropped: into the frame under the pointer, or
    // as free images centred on that point. Each one becomes a placement - the
    // document decides what is on the canvas, the asset is only the source -
    // and several dropped at once are fanned out so they do not stack up.
    if (drop?.at && !drop.frameId && landed.length) {
      const boxes = dropLayout(landed.length, drop.at);
      const dropped = landed.map((asset, index) => newPlacement(asset.id, {
        ...asset.element,
        box: { ...asset.element.box, ...boxes[index] },
      }));
      setDoc((current) => ({ ...current, placements: [...current.placements, ...dropped] }));
      setCanvasSelection(dropped.map((placement) => placementKey(placement.id)));
    }
    if (drop?.frameId && landed[0]) {
      const frame = docRef.current.frames.find((item) => item.id === drop.frameId);
      if (frame && frame.imageId !== null) setReplaceIntent({ frameId: frame.id, assetId: landed[0].id, name: landed[0].name, at: drop.at });
      else if (frame) {
        writeFrame(attachImage(frame, landed[0].id, landed[0].src, { width: docRef.current.width, height: docRef.current.height }));
        setFrameSelection({ id: frame.id, editing: false });
      }
    }
    setSelected(landed.map((asset) => asset.id));
    setActiveId((drop ? landed[0]?.id : merged.assets[0]?.id) ?? merged.assets[0]?.id ?? 0);
    setFork(summarise(picked));
    const skipped = merged.skipped + preSkipped;
    touch(`Imported ${merged.added}${skipped ? `, skipped ${skipped}` : ""}${merged.renamed ? `, renamed ${merged.renamed}` : ""}`);
    if (quick) { setFork(null); setFocus(false); goto("editor"); }
  }, [assets, goto, policy, touch, writeFrame]);

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
    if (doc.presetId === preset.id) setDoc((current) => ({ ...docFromPreset(PRESETS[0]), frames: current.frames }));
    touch(`Deleted ${preset.label}`);
  }, [doc.presetId, setDoc, touch]);

  /**
   * The export renders for real: each queued image is drawn through its own
   * element geometry onto the document page, then the batch is zipped and
   * downloaded. A browser cannot write to a local folder, so a download is the
   * only honest output.
   */
  const startExport = useCallback(async () => {
    const run = exportRunFor();
    if (!run.length) return;
    cancelExport.current = false;
    setExportOpen(false);
    setRunDone(false);
    setRun({ done: 0, total: run.length, current: "", failed: [] });
    const result = await runExport(run, specFromDoc(doc, assets), exportOptions,
      (progress) => setRun(progress),
      () => cancelExport.current);
    exportZip.current = result.zip;
    setRun(result.progress);
    setRunBytes(result.zip.byteLength);
    setRunDone(true);
    if (result.progress.done > result.progress.failed.length) downloadZip(result.zip, EXPORT_ZIP);
    touch(`Exported ${result.progress.done - result.progress.failed.length} image(s)`);
  }, [assets, doc, exportOptions, exportRunFor, touch]);

  useEffect(() => {
    if (!assets.length && !["batch", "editor", "presets", "settings"].includes(screen)) goto("import");
  }, [assets.length, goto, screen]);

  viewportRef.current = viewport;
  useEffect(() => () => { if (glide.current !== null) cancelAnimationFrame(glide.current); }, []);

  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => () => {
    for (const asset of assetsRef.current) {
      if (asset.url) URL.revokeObjectURL(asset.url);
      if (asset.thumbnailUrl) URL.revokeObjectURL(asset.thumbnailUrl);
    }
  }, []);

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
      if (mod && event.shiftKey && event.key.toLowerCase() === "f") { event.preventDefault(); if (screen !== "editor") goto("editor"); setFocus((value) => value ? false : "gallery"); return; }
      if (mod && event.shiftKey && event.key.toLowerCase() === "z") { event.preventDefault(); redo(); return; }
      if (mod && event.key.toLowerCase() === "z") { event.preventDefault(); undo(); return; }
      // Matched on the physical key, not the character: Shift+1 only produces
      // "!" on layouts that happen to put it there.
      if (!mod && !typing && event.shiftKey && screen === "editor" && event.code === "Digit1") { event.preventDefault(); viewCommands.current.fit(); return; }
      if (!mod && !typing && event.shiftKey && screen === "editor" && event.code === "Digit2") { event.preventDefault(); viewCommands.current.zoomToSelection(); return; }
      if (event.key === "Escape") {
        if (cropSession) { event.preventDefault(); cancelCrop(); return; }
        // Esc discards a content edit before it clears the selection.
        if (screen === "editor" && frameSelection?.editing) { event.preventDefault(); cancelContentEdit(); return; }
        if (screen === "editor" && canvasSelection.length > 1) { event.preventDefault(); selectKeys([]); return; }
        if (screen === "editor" && frameSelection) { event.preventDefault(); setFrameSelection(null); return; }
        setFocus(false); return;
      }
      if (typing) return;
      // Frame shortcuts only bind on the canvas: in the Gallery, Enter opens
      // the editor and Backspace belongs to the image list.
      if (screen === "editor" && (event.key === "Delete" || event.key === "Backspace") && !mod) {
        if (deleteSelected()) { event.preventDefault(); return; }
        if (frameSelection) { event.preventDefault(); deleteFrame(frameSelection.id); return; }
        if (removeLayer()) { event.preventDefault(); return; }
      }
      if (screen === "editor" && event.key === "Enter" && frameSelection && !frameSelection.editing) { event.preventDefault(); startContentEdit(frameSelection.id); return; }
      if (mod && event.key.toLowerCase() === "a" && screen === "gallery") { event.preventDefault(); setSelected(visible.map((asset) => asset.id)); return; }
      // On the canvas the same key selects every object, which is the thing
      // Ctrl+A means there; in the Gallery it still means every file.
      if (mod && event.key.toLowerCase() === "a" && screen === "editor") { event.preventDefault(); selectKeys(selectablesRef.current.map((item) => item.key)); return; }
      if (mod && event.key.toLowerCase() === "d" && screen === "editor") { event.preventDefault(); duplicateLayer(); return; }
      if (mod && event.key === "Backspace") { event.preventDefault(); askRemoval(false); return; }
      if (event.key === "Enter" && screen === "gallery" && active) { event.preventDefault(); openEditor(active); return; }
      // Space pans the workspace, the way every canvas editor binds it, so
      // comparison moves to a key of its own.
      if (event.code === "Space" && screen === "editor") { event.preventDefault(); setSpacePan(true); return; }
      if (event.key === "\\") { event.preventDefault(); if (screen !== "editor") goto("editor"); setCompare(true); }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpacePan(false);
      if (event.key === "\\") setCompare(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [active, askRemoval, cancelContentEdit, cancelCrop, canvasSelection, cropSession, deleteFrame, deleteSelected, duplicateLayer, frameSelection, goto, openEditor, redo, removeLayer, screen, selectKeys, startContentEdit, undo, visible]);

  const pageSize = { width: doc.width, height: doc.height };
  const canZoomViewport = screen === "editor" && editorView.width > 0;
  const zoomLabel = screen === "editor" ? `${Math.round(viewport.zoom * 100)}%` : `${zoom}%`;
  const zoomBy = useCallback((factor: number) => {
    if (screen !== "editor") { setZoom((value) => Math.min(400, Math.max(25, value + (factor > 1 ? 25 : -25)))); return; }
    if (!canZoomViewport) return;
    setViewport((current) => zoomCentred(current, clampZoom(current.zoom * factor), pageSize, editorView));
  }, [canZoomViewport, editorView, pageSize.width, pageSize.height, screen]);

  /**
   * Move the view to a new place over a fifth of a second rather than cutting
   * to it.
   *
   * Fit and zoom-to-selection can change the view completely, and a cut leaves
   * no clue whether the page moved or the objects did. A short glide carries
   * that; it is also the one animation in the editor that has to be skippable,
   * because for a viewer who gets motion sick a moving viewport is the worst
   * case there is. `prefers-reduced-motion` therefore jumps, and so does the
   * first placement, where there is no previous view to glide from.
   */
  const glideTo = useCallback((to: Viewport) => {
    if (glide.current !== null) cancelAnimationFrame(glide.current);
    const from = viewportRef.current;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || from.zoom <= 0) { setViewport(to); return; }
    const began = performance.now();
    const frame = (now: number) => {
      const progress = Math.min(1, (now - began) / 200);
      // Ease out: fastest at the start, so the view feels answered immediately
      // and settles rather than accelerating away.
      const eased = 1 - (1 - progress) ** 3;
      const at = (start: number, end: number) => start + (end - start) * eased;
      setViewport({
        zoom: at(from.zoom, to.zoom), panX: at(from.panX, to.panX), panY: at(from.panY, to.panY),
      });
      glide.current = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    glide.current = requestAnimationFrame(frame);
  }, []);

  const fitPage = useCallback(() => {
    if (screen !== "editor") { setZoom(100); return; }
    if (canZoomViewport) glideTo(fitViewport(pageSize, editorView));
  }, [canZoomViewport, editorView, glideTo, pageSize.width, pageSize.height, screen]);
  /** Frame whatever is selected, using its bounds so a rotated object still fits. */
  const zoomToSelection = useCallback(() => {
    if (screen !== "editor" || !canZoomViewport) return;
    const frame = doc.frames.find((item) => item.id === frameSelection?.id);
    const box = frame?.box ?? assetsRef.current.find((item) => item.id === activeId)?.element.box;
    if (box) glideTo(zoomToRect(boxBounds(box), pageSize, editorView));
  }, [activeId, canZoomViewport, doc.frames, editorView, frameSelection, glideTo, pageSize.width, pageSize.height, screen]);
  viewCommands.current = { fit: fitPage, zoomToSelection };
  selectablesRef.current = selectables;
  const step = useCallback((delta: number) => {
    finishCrop();
    setActiveId((current) => {
      const at = assets.findIndex((asset) => asset.id === current);
      return assets[(at + delta + assets.length) % assets.length]?.id ?? current;
    });
  }, [assets, finishCrop]);

  if (focus === "gallery") return <main className="focus-workspace focus-gallery-workspace">
    <header className="focus-toolbar" aria-label="Focus gallery toolbar">
      <Button variant="ghost" size="sm" onClick={() => { finishCrop(); setFocus(false); }}><ArrowLeft /> Exit focus</Button>
      <div className="focus-title"><strong>Focus gallery</strong><span>Select an image to edit on the canvas</span></div>
      <Button variant="secondary" size="sm" onClick={() => filesInput.current?.click()}><Upload /> Import</Button>
    </header>
    <section className="focus-gallery" aria-label="Focus image gallery">
      <header><span>{assets.length} image{assets.length === 1 ? "" : "s"}</span><strong>Choose an image to open its canvas</strong></header>
      <div className="focus-gallery-strip">{assets.map((item) => <button key={item.id}
        className={item.id === active.id ? "active" : ""} aria-current={item.id === active.id ? "true" : undefined}
        onClick={() => { finishCrop(); setActiveId(item.id); setFocus("editor"); }}>
        <AssetImage asset={item} fit="cover" /><span>{item.name}</span>
      </button>)}</div>
    </section>
  </main>;

  if (focus === "editor" && hasActive) return <main className="focus-workspace">
    <header className="focus-toolbar" aria-label="Focus mode toolbar">
      <Button variant="ghost" size="sm" onClick={() => { finishCrop(); setFocus("gallery"); }}><ArrowLeft /> Gallery</Button>
      <div className="focus-title"><strong>{active.name}</strong><span>Editor focus mode</span></div>
      <div className="focus-toolbar-group" role="group" aria-label="Image navigation">
        <Button variant="ghost" size="icon" aria-label="Previous image" onClick={() => step(-1)}><ChevronLeft /></Button>
        <span>{assets.findIndex((asset) => asset.id === active.id) + 1} / {assets.length}</span>
        <Button variant="ghost" size="icon" aria-label="Next image" onClick={() => step(1)}><ChevronRight /></Button>
      </div>
      <ContextualToolbar className="focus-contextual-toolbar" mode={focusTool} onMode={setFocusTool} element={active.element} fit={doc.fit}
        onFit={(fit) => setDoc((current) => ({ ...current, fit }))} onReplace={() => filesInput.current?.click()} onElement={applyElementAction}
        onCropStart={startCrop} onCropDone={finishCrop} onCropCancel={cancelCrop} onCropReset={resetActiveCrop}
        onToggleGrid={() => setGuides((current) => ({ ...current, grid: !current.grid }))} grid={guides.grid} />
      <Button variant="secondary" size="sm" onClick={() => { finishCrop(); setFocus(false); filesInput.current?.click(); }}><Upload /> Import</Button>
      <Button variant="ghost" size="icon" aria-label="Close focus mode" onClick={() => { finishCrop(); setFocus(false); }}>×</Button>
    </header>
    <div className="focus-editor-host">
      <Editor asset={active} assets={assets} selected={selected} doc={doc} viewport={viewport} onViewport={setViewport} onViewSize={setEditorView} spacePan={spacePan} compare={false}
        compareView="split" splitAt={splitAt} overlay={overlay} guides={guides} target={target}
        onElement={writeActiveElement} onElementAction={applyActiveElement} onElementStart={beginActiveGesture} onElementEnd={commitActiveGesture} onCropStart={startCrop} onCropDone={finishCrop} onCropCancel={cancelCrop} onCropReset={resetActiveCrop} onSplit={setSplitAt} onChoose={openEditor} onImport={() => filesInput.current?.click()}
        onDrop={(files, drop) => importFiles(files, true, drop)} onFit={(fit) => setDoc((current) => ({ ...current, fit }))}
        onToggleGrid={() => setGuides((current) => ({ ...current, grid: !current.grid }))} onStep={step} focusMode editMode={focusTool} cropActive={Boolean(cropSession)} {...frameProps} />
    </div>
    <button className="canvas-arrow right" aria-label="Next image" onClick={() => step(1)}><ChevronRight /></button>
    <button className="canvas-arrow left" aria-label="Previous image" onClick={() => step(-1)}><ChevronLeft /></button>
    <div className="focus-zoom">
      <button aria-label="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Minus size={16} /></button>
      <span>{zoomLabel}</span>
      <button aria-label="Zoom in" onClick={() => zoomBy(1.25)}><Plus size={16} /></button>
      <button aria-label="Fit page in view" onClick={fitPage}><Expand size={16} /></button>
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
            <button aria-label="Zoom out" disabled={!zoomEnabled} onClick={() => zoomBy(1 / 1.25)}><Minus size={14} /></button>
            <span>{zoomLabel}</span>
            <button aria-label="Zoom in" disabled={!zoomEnabled} onClick={() => zoomBy(1.25)}><Plus size={14} /></button>
            <button aria-label={screen === "editor" ? "Fit page in view" : "Reset thumbnail size"} title="Fit" disabled={!zoomEnabled} onClick={fitPage}><Expand size={14} /></button>
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
      {screen === "settings" && <SettingsScreen />}
      {screen === "batch" && <BatchScreen sources={sources} onLeave={() => goto(assets.length ? "gallery" : "import")} />}

      {screen === "gallery" && <Gallery assets={visible} total={assets.length} selected={selected} counts={counts} filter={filter} zoom={zoom}
        needsAttention={needsAttention} target={target} onFilter={setFilter} onChoose={chooseAsset} onOpen={openEditor}
        onReview={() => goto("review")} onRemove={askRemoval} />}
      {screen === "editor" && <Editor asset={editorAsset} assets={assets} selected={selected} doc={doc} viewport={viewport} onViewport={setViewport} onViewSize={setEditorView} spacePan={spacePan}
        activeLayer={activeLayer}
        multi={{
          selection: canvasSelection, items: selectables, onSelect: selectKeys,
          onGestureStart: beginSelectionGesture, onWrite: writeSelection, onGestureEnd: commitSelectionGesture,
          onAlign: alignSelected, onDistribute: distributeSelected,
        }}
        compare={compare} compareView={compareView} splitAt={splitAt} overlay={overlay} guides={guides} target={target}
        onElement={writeActiveElement} onElementAction={applyActiveElement} onElementStart={beginActiveGesture} onElementEnd={commitActiveGesture} onCropStart={startCrop} onCropDone={finishCrop} onCropCancel={cancelCrop} onCropReset={resetActiveCrop} onSplit={setSplitAt} onChoose={openEditor} onImport={() => filesInput.current?.click()}
        onDrop={(files, drop) => importFiles(files, true, drop)}
        onFit={(fit) => setDoc((current) => ({ ...current, fit }))}
        onToggleGrid={() => setGuides((current) => ({ ...current, grid: !current.grid }))} onStep={step} cropActive={Boolean(cropSession)} {...frameProps} />}
      {screen === "review" && <Review assets={flagged} target={target} onOpen={openEditor}
        onFix={(id) => fixAssets([id])} onFixAll={() => fixAssets(flagged.map((asset) => asset.id))} onRetry={runApply} />}

      {inspectorOpen && (screen === "editor" || (hasActive && !["import", "presets", "settings", "batch"].includes(screen))) && (
        <Inspector doc={doc} target={target} asset={editorAsset} presets={presets} guides={guides} scope={scope}
            selection={selection} onSelectionBox={setSelectionBox}
            layers={screen === "editor" ? layerRows : undefined} layerSelection={canvasSelection}
            onLayerSelect={pickLayer}
            onLayerReorder={reorderLayer}
            onGestureStart={beginDocGesture} onGestureEnd={commitDocGesture}
            scopeCount={scoped.length} selectedCount={selected.length} totalCount={assets.length}
            compare={compare} overlay={overlay} processing={processing} progress={progress}
            onPreset={applyPreset} onDoc={writeDoc} onGuides={setGuides} onScope={setScope} onOverlay={setOverlay}
            onApply={runApply} onFocus={() => { if (hasActive) { goto("editor"); setFocus("gallery"); } else touch("Import an image to enter focus mode"); }} onClose={() => setInspectorOpen(false)}
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

    <ExportDialog open={exportOpen} onOpenChange={setExportOpen} queue={exportQueue} files={exportFileCount} options={exportOptions}
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
    <ReplaceFrameDialog intent={replaceIntent} onCancel={() => setReplaceIntent(null)}
      onReplace={() => { if (replaceIntent) attachToFrame(replaceIntent.frameId, replaceIntent.assetId, true); setReplaceIntent(null); }}
      onFree={() => {
        // Declining the replacement leaves the frame untouched and keeps the
        // incoming image on the canvas as its own free layer.
        if (replaceIntent) {
          const at = replaceIntent.at;
          const asset = assetsRef.current.find((item) => item.id === replaceIntent.assetId);
          if (asset) {
            const free = newPlacement(asset.id, at
              ? { ...asset.element, box: { ...asset.element.box, x: at.x - 25, y: at.y - 25, w: 50, h: 50 } }
              : asset.element);
            setDoc((current) => ({ ...current, placements: [...current.placements, free] }));
            setCanvasSelection([placementKey(free.id)]);
          }
          setActiveId(replaceIntent.assetId); setFrameSelection(null);
        }
        setReplaceIntent(null);
      }} />
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
