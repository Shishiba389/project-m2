import { useState } from "react";
import { Expand, FlipHorizontal, FlipVertical, Link, Link2Off, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { ImageBox } from "@/src/image-geometry";
import { LayersPanel, type LayerRow } from "@/src/layers";
import type { Guides } from "@/src/screens";
import { ratioLabel, type Align, type Asset, type Doc, type Fit, type Preset, type Scope } from "@/src/flow";
import { defaultApplyOptions, type ApplyOptions } from "@/src/editor-engine";

const ALIGNMENTS: Align[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

/** What the transform panel is pointed at: the free image, or a frame. */
export type Selection = {
  label: string; box: ImageBox;
  /**
   * What the editor knows about where the product is in this picture: the
   * sentence, and whether a product was found - which decides whether the
   * line carries the dashed swatch the canvas outline is drawn with.
   */
  product?: { text: string; found: boolean };
};

/**
 * Input props for a number the user types rather than drags.
 *
 * The field holds a draft while it has focus, so typing "1200" does not pass
 * through 1, 12 and 120 as three committed edits, three undo steps and - for
 * the canvas dimensions - three full reflows of the page.  Escape drops the
 * draft, Enter and blur commit it, and with no draft the field tracks the
 * document live, so dragging an object on the canvas updates the numbers.
 *
 * This is section 26 for anything typed: one continuous act of editing
 * produces one history entry.  Sliders get there the other way, through
 * `onValueCommit`.
 */
function useTypedNumber(value: number, onCommit: (value: number) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    setDraft(null);
    if (Number.isFinite(parsed) && draft.trim() !== "") onCommit(parsed);
  };
  return {
    value: draft ?? String(Math.round(value * 10) / 10),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    onBlur: commit,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); }
      if (event.key === "Escape") { event.preventDefault(); setDraft(null); }
    },
  };
}

function NumberField({ label, value, unit, step = 1, disabled = false, onCommit }: {
  label: string; value: number; unit?: string; step?: number; disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  return <label className="transform-field">
    <span>{label}</span>
    <input type="number" step={step} disabled={disabled}
      aria-label={unit ? `${label} in ${unit}` : label} {...useTypedNumber(value, onCommit)} />
    {unit && <em>{unit}</em>}
  </label>;
}

/**
 * Position, size, rotation and flip for whatever is selected.
 *
 * The document stores geometry as percentages of the page, which is what keeps
 * a layout proportional across preset changes - but nobody thinks in percent
 * of a 1801x2600 page, so every length is shown and typed in output pixels and
 * converted at the edge.  The matrix stays canonical; these are derived views
 * of it, which is the whole of section 7.
 */
function TransformPanel({ selection, page, onBox }: {
  selection: Selection; page: { width: number; height: number };
  onBox: (box: ImageBox) => void;
}) {
  const box = selection.box;
  const toPx = (percent: number, length: number) => percent / 100 * length;
  const toPercent = (px: number, length: number) => length > 0 ? px / length * 100 : 0;
  // Ratio is locked in what the user sees - output pixels - not in percentages
  // of a page that is rarely square.
  const pixelRatio = box.h > 0 ? toPx(box.w, page.width) / toPx(box.h, page.height) : 1;
  const setSize = (edge: "w" | "h", px: number) => {
    const value = Math.max(1, px);
    if (edge === "w") {
      const w = toPercent(value, page.width);
      return onBox({ ...box, w, h: box.lockedRatio && pixelRatio > 0 ? toPercent(value / pixelRatio, page.height) : box.h });
    }
    const h = toPercent(value, page.height);
    return onBox({ ...box, h, w: box.lockedRatio ? toPercent(value * pixelRatio, page.width) : box.w });
  };
  return <section className="transform-panel" aria-label={`Transform: ${selection.label}`}>
    <div className="field-label transform-heading">
      <span>Transform</span><strong title={selection.label}>{selection.label}</strong>
    </div>
    {selection.product && <p className={`product-note ${selection.product.found ? "found" : ""}`}>
      {/* The swatch is the canvas outline itself, scaled down, so the line explains the mark. */}
      {selection.product.found && <span className="product-swatch" aria-hidden="true" />}
      <span>{selection.product.text}</span>
    </p>}
    <div className="transform-grid">
      <NumberField label="X" unit="px" value={toPx(box.x, page.width)} onCommit={(value) => onBox({ ...box, x: toPercent(value, page.width) })} />
      <NumberField label="Y" unit="px" value={toPx(box.y, page.height)} onCommit={(value) => onBox({ ...box, y: toPercent(value, page.height) })} />
      <NumberField label="W" unit="px" value={toPx(box.w, page.width)} onCommit={(value) => setSize("w", value)} />
      <NumberField label="H" unit="px" value={toPx(box.h, page.height)} onCommit={(value) => setSize("h", value)} />
      <NumberField label="Angle" unit="degrees" value={box.rotation} onCommit={(value) => onBox({ ...box, rotation: ((value % 360) + 360) % 360 })} />
      <div className="transform-toggles">
        <button type="button" aria-pressed={box.lockedRatio} title={box.lockedRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
          aria-label={box.lockedRatio ? "Unlock aspect ratio" : "Lock aspect ratio"}
          onClick={() => onBox({ ...box, lockedRatio: !box.lockedRatio })}>{box.lockedRatio ? <Link /> : <Link2Off />}</button>
        <button type="button" aria-pressed={box.flipH} title="Flip horizontally" aria-label="Flip horizontally"
          onClick={() => onBox({ ...box, flipH: !box.flipH })}><FlipHorizontal /></button>
        <button type="button" aria-pressed={box.flipV} title="Flip vertically" aria-label="Flip vertically"
          onClick={() => onBox({ ...box, flipV: !box.flipV })}><FlipVertical /></button>
      </div>
    </div>
  </section>;
}

export function Inspector({
  doc, target, asset, presets, guides, scope, scopeCount, selectedCount, totalCount,
  compare, overlay, processing, progress, selection = null,
  layers, layerSelection = [], onLayerSelect, onLayerReorder,
  onPreset, onDoc, onGuides, onScope, onOverlay, onApply, onFocus, onClose, onResetGuides, onSelectionBox,
  onGestureStart = () => {}, onGestureEnd = () => {},
  activeFit, activeAlign, onFit, onAlign,
  applyOptions = defaultApplyOptions, onApplyOptions = () => {}, applyCount, keptCount = 0, referenceName = "", measuredOnProduct = false,
}: {
  /** What an apply carries over from the reference image, and to how many images. */
  applyOptions?: ApplyOptions;
  /** Takes an updater, so two quick ticks in a row both land instead of the second undoing the first. */
  onApplyOptions?: (update: (current: ApplyOptions) => ApplyOptions) => void;
  applyCount?: number; keptCount?: number; referenceName?: string;
  /** True when sizes are measured on the reference's product rather than its whole picture. */
  measuredOnProduct?: boolean;
  /**
   * The page layout and anchor of the selected image, to light the buttons.
   * Null once the image has been sized or moved by hand, so nothing claims a
   * layout the image is no longer in.
   */
  activeFit?: Fit | null; activeAlign?: Align | null;
  /** Lay the selected image out against the whole page, and make that the page's rule. */
  onFit?: (fit: Fit) => void;
  onAlign?: (align: Align) => void;
  /** Open and close a document transaction, so one drag is one undo step. */
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  doc: Doc; target: Preset; asset: Asset; presets: Preset[]; guides: Guides;
  /** Null away from the editor, where there is nothing on a canvas to transform. */
  selection?: Selection | null;
  onSelectionBox?: (box: ImageBox) => void;
  /** The canvas stack, topmost first, and the keys currently selected. */
  layers?: LayerRow[];
  layerSelection?: string[];
  onLayerSelect?: (key: string, additive: boolean) => void;
  onLayerReorder?: (key: string, to: number) => void;
  scope: Scope; scopeCount: number; selectedCount: number; totalCount: number;
  compare: boolean; overlay: number; processing: boolean; progress: number;
  onPreset: (id: string) => void;
  onDoc: (next: (current: Doc) => Doc) => void;
  onGuides: (next: Guides) => void;
  onScope: (value: Scope) => void;
  onOverlay: (value: number) => void;
  onApply: () => void; onFocus: () => void; onClose: () => void; onResetGuides: () => void;
}) {
  /** Canvas rules stay independent from each image's editable geometry. */
  const patchDoc = (patch: Partial<Doc>) => onDoc((current) => ({ ...current, ...patch }));
  const fitNow = !(selection && onSelectionBox) || activeFit === undefined ? doc.fit : activeFit;
  const alignNow = !(selection && onSelectionBox) || activeAlign === undefined ? doc.align : activeAlign;
  const chooseFit = onFit ?? ((fit: Fit) => patchDoc({ fit }));
  const chooseAlign = onAlign ?? ((align: Align) => patchDoc({ align }));
  const reframe = (patch: Partial<Doc>) => onDoc((current) => ({ ...current, ...patch }));
  /** On the canvas the fit and alignment act on the selected image; elsewhere they are the page's rule. */
  const editingImage = Boolean(selection && onSelectionBox);
  const fitAndAlign = (fitTitle: string, alignTitle: string) => <section className="inspector-section fit-section" aria-label={fitTitle}>
    <div className="section-title" id="fit-title">{fitTitle}</div>
    <div className="segmented" role="group" aria-labelledby="fit-title">{(["Fit", "Fill", "Stretch"] as const).map((mode) =>
      <button key={mode} className={fitNow === mode ? "active" : ""} aria-pressed={fitNow === mode}
        title={mode === "Fit" ? "Fit the whole image inside the page" : mode === "Fill" ? "Cover the whole page" : "Stretch to exactly the page"}
        onClick={() => editingImage ? chooseFit(mode) : patchDoc({ fit: mode })}>{mode}</button>)}
    </div>
    <div className="section-title" id="align-title">{alignTitle}</div>
    <div className="alignment-grid" role="group" aria-labelledby="align-title">{ALIGNMENTS.map((position) =>
      <button key={position} className={position === alignNow ? "active" : ""} aria-pressed={position === alignNow}
        aria-label={`Align ${position.replace("-", " ")}`} title={`Align ${position.replace("-", " ")}`}
        disabled={Boolean(doc.templateLocked)} onClick={() => editingImage ? chooseAlign(position) : patchDoc({ align: position })}><span /></button>)}
    </div>
  </section>;
  /** The options as words, for the folded summary: what the button will carry over. */
  const applied = [
    applyOptions.size && "Size & position", applyOptions.rotation && "Rotation & flip", applyOptions.crop && "Crop",
  ].filter(Boolean).concat(applyOptions.overwriteManual ? ["incl. hand-adjusted"] : []) as string[];
  const setDimension = (edge: "width" | "height", value: number) => onDoc((current) => {
    if (!Number.isFinite(value) || value <= 0) return current;
    return edge === "width"
      ? { ...current, width: value, height: current.lock ? Math.round(value / current.ratio) : current.height }
      : { ...current, height: value, width: current.lock ? Math.round(value * current.ratio) : current.width };
  });
  return <aside className="inspector" aria-label="Resize inspector">
    <div className="inspector-heading">
      <strong>Resize Inspector</strong>
      <div className="inspector-heading-actions">
        <Button variant="ghost" size="icon" aria-label="Reset guides and position" onClick={onResetGuides}><RotateCcw /></Button>
        <Button variant="ghost" size="icon" aria-label="Close inspector" onClick={onClose}><X /></Button>
      </div>
    </div>
    <div className="inspector-body">
      {selection && onSelectionBox && <TransformPanel selection={selection} page={{ width: doc.width, height: doc.height }} onBox={onSelectionBox} />}

      {editingImage && fitAndAlign("Fit to page", "Align on page")}

      {/* The scene graph, as a list (§23). */}
      {layers && onLayerSelect && onLayerReorder && <section className="layers-panel" aria-label="Layers">
        <div className="field-label layers-heading">
          <span>Layers</span><strong>{layers.length}</strong>
        </div>
        <LayersPanel rows={layers} selection={layerSelection} onSelect={onLayerSelect} onReorder={onLayerReorder} />
      </section>}

      {/* The page every image is laid out on: set once for the batch. */}
      <section className="inspector-section page-section" aria-label="Page">
        <div className="section-title">Page</div>
        {/* Away from the canvas these set the rule for every image nobody has placed by hand. */}
        {!editingImage && fitAndAlign("Fit images to the page", "Align images on the page")}
        <label className="field-label" htmlFor="preset">Preset</label>
        <Select value={doc.presetId} onValueChange={onPreset}>
          <SelectTrigger id="preset" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>)}</SelectContent>
        </Select>

        <label className="field-label">Size</label>
        <div className="dimension-row">
          <input aria-label="Canvas width" type="number" min={1} {...useTypedNumber(doc.width, (value) => setDimension("width", value))} />
          <span>×</span>
          <input aria-label="Canvas height" type="number" min={1} {...useTypedNumber(doc.height, (value) => setDimension("height", value))} />
          <span>px</span>
        </div>
        <label className="check-row">
          <Checkbox checked={doc.lock} onCheckedChange={(value) => onDoc((current) => ({ ...current, lock: Boolean(value), ratio: current.width / current.height }))} />
          Keep ratio · {ratioLabel(doc.width, doc.height)}
        </label>
        <label className="check-row template-lock-row">
          <Checkbox checked={Boolean(doc.templateLocked)} onCheckedChange={(value) => onDoc((current) => ({ ...current, templateLocked: Boolean(value) }))} />
          Lock page settings
        </label>
        {doc.templateLocked && <p className="inspector-note">Page settings are locked. Image editing, import and export remain available.</p>}

        <div className="slider-label"><span>Safe area · top and bottom</span><strong>{doc.safeY.toFixed(1)}%</strong></div>
        <Slider value={[doc.safeY]} max={30} step={0.5} aria-label="Safe area, top and bottom"
          onValueChange={([value]) => { onGestureStart(); reframe({ safeY: value }); }} onValueCommit={onGestureEnd} />
        <div className="slider-label"><span>Safe area · left and right</span><strong>{doc.safeX.toFixed(1)}%</strong></div>
        <Slider value={[doc.safeX]} max={30} step={0.01} aria-label="Safe area, left and right"
          onValueChange={([value]) => { onGestureStart(); reframe({ safeX: value }); }} onValueCommit={onGestureEnd} />

        {/* Panel 9: the split view's overlay strength. */}
        {compare && <>
          <div className="slider-label"><span>Overlay opacity</span><strong>{overlay}%</strong></div>
          <Slider value={[overlay]} onValueChange={([value]) => onOverlay(value)} max={100} step={1} aria-label="Overlay opacity" />
        </>}

        {/* Guides and background are set once for a batch, not per image, so they
            collapse out of the way. <details> needs no state and no library. */}
        <details className="inspector-fold">
          <summary>Guides &amp; background</summary>
          <div className="guide-grid">
            {([["grid", "Grid"], ["rulers", "Rulers"], ["snapGrid", "Snap grid"], ["snapSafe", "Snap safe"]] as [keyof Guides, string][])
              .map(([key, label]) => <label key={key} className="setting-line compact"><span>{label}</span>
                <Switch checked={guides[key]} onCheckedChange={(value) => onGuides({ ...guides, [key]: value })} />
              </label>)}
          </div>
          <label className="field-label" htmlFor="canvas-bg">Page background</label>
          <div className="color-row">
            <input id="canvas-bg" type="color" value={doc.background} onChange={(event) => onDoc((current) => ({ ...current, background: event.target.value }))} />
            <input className="export-input" value={doc.background} aria-label="Background hex"
              onChange={(event) => onDoc((current) => ({ ...current, background: event.target.value }))} />
          </div>
          <Button variant="outline" size="sm" onClick={onResetGuides}>Reset guides</Button>
        </details>
      </section>

      <button className="focus-mode-button" onClick={onFocus}><Expand /> Focus mode <kbd>Ctrl ⇧ F</kbd></button>
      <div className="engine-note"><Sparkles aria-hidden="true" /><div><strong>MINIMA Engine</strong><span>Scale-aware bicubic · linear light</span></div></div>
    </div>
    {/* Edit one, apply to all (§22-29). The image open in the editor is the
        reference; what it carries over is a choice, and images the user has
        adjusted by hand are left alone unless they say otherwise (§38). */}
    <div className="inspector-footer">
      <div className="apply-heading" id="apply-title">
        Apply {referenceName ? <strong title={referenceName}>{referenceName}</strong> : "this image"}'s edit to
      </div>
      <div className="segmented apply-scope" role="radiogroup" aria-labelledby="apply-title">
        {([["selected", `Selected · ${selectedCount}`], ["all", `All · ${totalCount}`]] as [Scope, string][]).map(([value, label]) =>
          <button key={value} role="radio" aria-checked={scope === value} className={scope === value ? "active" : ""} onClick={() => onScope(value)}>{label}</button>)}
      </div>
      {/* What travels is a choice, but one made rarely: it folds behind a
          summary of itself, so the panel keeps the inspector's room for the
          image and still says exactly what the button will do. */}
      <details className="apply-options">
        <summary>
          <span className="apply-summary">{applied.length ? applied.join(" · ") : "Nothing chosen"}</span>
          <span className="apply-change">Change</span>
        </summary>
        <div className="apply-option-list" role="group" aria-label="What to apply">
          {([["size", "Size & position"], ["rotation", "Rotation & flip"], ["crop", "Crop (same fractions)"]] as [keyof ApplyOptions, string][]).map(([key, label]) =>
            <label key={key} className="check-row">
              <Checkbox checked={applyOptions[key]} onCheckedChange={(value) => onApplyOptions((current) => ({ ...current, [key]: Boolean(value) }))} />{label}
            </label>)}
          <label className="check-row">
            <Checkbox checked={applyOptions.overwriteManual} onCheckedChange={(value) => onApplyOptions((current) => ({ ...current, overwriteManual: Boolean(value) }))} />
            Also change images adjusted by hand{keptCount > 0 && !applyOptions.overwriteManual ? ` (${keptCount})` : ""}
          </label>
          {applyOptions.size && <p className="inspector-note">{measuredOnProduct
            ? "Sizes are measured on each product, so different white margins do not change how big it looks."
            : "Sizes are measured on the whole picture: no plain background to find the product on."}</p>}
        </div>
      </details>
      {processing && <div className="processing"><Progress value={progress} /><span>Processing {progress}%</span></div>}
      {(() => {
        const count = applyCount ?? scopeCount;
        return <Button onClick={onApply} disabled={processing || !count || !applied.length} className="apply-button"
          title={measuredOnProduct ? "Measured on each image's product" : undefined}>
          {!applied.length ? "Choose what to apply"
            : count > 0 ? `Apply to ${count} image${count === 1 ? "" : "s"}`
            // An empty target list is otherwise a dead end: a disabled
            // button reading "Apply to 0 images".
            : keptCount > 0 ? "Only images adjusted by hand left" : "Select images to apply to"}
        </Button>;
      })()}
    </div>
  </aside>;
}
