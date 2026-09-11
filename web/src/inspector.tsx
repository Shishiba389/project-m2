import { Expand, FlipHorizontal, FlipVertical, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Guides } from "@/src/screens";
import {
  anchor, fitBox, objectScale, ratioLabel, srcRatio,
  type Align, type Asset, type Doc, type Preset, type Scope,
} from "@/src/flow";

const ALIGNMENTS: Align[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];

export function Inspector({
  doc, target, asset, presets, guides, scope, scopeCount, selectedCount, totalCount,
  compare, overlay, processing, progress,
  onPreset, onDoc, onGuides, onScope, onOverlay, onApply, onFocus, onClose, onResetGuides,
}: {
  doc: Doc; target: Preset; asset: Asset; presets: Preset[]; guides: Guides;
  scope: Scope; scopeCount: number; selectedCount: number; totalCount: number;
  compare: boolean; overlay: number; processing: boolean; progress: number;
  onPreset: (id: string) => void;
  onDoc: (next: (current: Doc) => Doc) => void;
  onGuides: (next: Guides) => void;
  onScope: (value: Scope) => void;
  onOverlay: (value: number) => void;
  onApply: () => void; onFocus: () => void; onClose: () => void; onResetGuides: () => void;
}) {
  /** Any change to the canvas rules re-derives the object box from the same rules. */
  const resize = (patch: Partial<Doc>) => onDoc((current) => {
    const next = { ...current, ...patch };
    return { ...next, box: fitBox(next.fit, srcRatio(asset), next.width / next.height, next.safeX, next.safeY) };
  });
  const setDimension = (edge: "width" | "height", value: number) => onDoc((current) => {
    if (!Number.isFinite(value) || value <= 0) return current;
    const next = edge === "width"
      ? { ...current, width: value, height: current.lock ? Math.round(value / current.ratio) : current.height }
      : { ...current, height: value, width: current.lock ? Math.round(value * current.ratio) : current.width };
    return { ...next, box: fitBox(next.fit, srcRatio(asset), next.width / next.height, next.safeX, next.safeY) };
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
      <label className="field-label" htmlFor="preset">Preset</label>
      <Select value={doc.presetId} onValueChange={onPreset}>
        <SelectTrigger id="preset" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{presets.map((preset) => <SelectItem key={preset.id} value={preset.id}>{preset.label}</SelectItem>)}</SelectContent>
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

      <div className="segmented">{(["Fit", "Fill", "Stretch"] as const).map((mode) =>
        <button key={mode} className={doc.fit === mode ? "active" : ""} onClick={() => resize({ fit: mode })}>{mode}</button>)}
      </div>

      <label className="field-label">Alignment matrix</label>
      <div className="alignment-grid">{ALIGNMENTS.map((position) =>
        <button key={position} className={position === doc.align ? "active" : ""} aria-label={`Align ${position.replace("-", " ")}`} title={`Align ${position.replace("-", " ")}`}
          onClick={() => onDoc((current) => ({ ...current, align: position, box: anchor(position, current.box, current.safeX, current.safeY) }))}><span /></button>)}
      </div>
      {/* Panel 3: flip sits with the alignment matrix. */}
      <div className="flip-row">
        <button className={doc.flipH ? "active" : ""} aria-pressed={doc.flipH} onClick={() => onDoc((current) => ({ ...current, flipH: !current.flipH }))}><FlipHorizontal /> Flip H</button>
        <button className={doc.flipV ? "active" : ""} aria-pressed={doc.flipV} onClick={() => onDoc((current) => ({ ...current, flipV: !current.flipV }))}><FlipVertical /> Flip V</button>
      </div>

      <div className="slider-label"><span>Safe area · vertical</span><strong>{doc.safeY.toFixed(2)}%</strong></div>
      <Slider value={[doc.safeY]} onValueChange={([value]) => resize({ safeY: value })} max={30} step={0.5} />
      <div className="slider-label"><span>Safe area · horizontal</span><strong>{doc.safeX.toFixed(2)}%</strong></div>
      <Slider value={[doc.safeX]} onValueChange={([value]) => resize({ safeX: value })} max={30} step={0.01} />

      {/* Panel 9: the split view's overlay strength. */}
      {compare && <>
        <div className="slider-label"><span>Overlay opacity</span><strong>{overlay}%</strong></div>
        <Slider value={[overlay]} onValueChange={([value]) => onOverlay(value)} max={100} step={1} />
      </>}

      {/* Panel 10: guide toggles and Reset Guides. */}
      <label className="field-label">Guides</label>
      <div className="guide-grid">
        {([["grid", "Grid"], ["rulers", "Rulers"], ["snapGrid", "Snap grid"], ["snapSafe", "Snap safe"]] as [keyof Guides, string][])
          .map(([key, label]) => <label key={key} className="setting-line compact"><span>{label}</span>
            <Switch checked={guides[key]} onCheckedChange={(value) => onGuides({ ...guides, [key]: value })} />
          </label>)}
      </div>
      <Button variant="outline" size="sm" onClick={onResetGuides}>Reset guides</Button>

      {/* Panel 3: canvas background colour picker. */}
      <label className="field-label" htmlFor="canvas-bg">Canvas background</label>
      <div className="color-row">
        <input id="canvas-bg" type="color" value={doc.background} onChange={(event) => onDoc((current) => ({ ...current, background: event.target.value }))} />
        <input className="export-input" value={doc.background} aria-label="Background hex"
          onChange={(event) => onDoc((current) => ({ ...current, background: event.target.value }))} />
      </div>

      <div className="slider-label"><span>Object scale</span><strong>{objectScale(doc.box, target, asset)}%</strong></div>
      <p className="inspector-note">Actual image {Math.round((doc.box.w / 100) * doc.width)} × {Math.round((doc.box.h / 100) * doc.height)} px</p>

      <button className="focus-mode-button" onClick={onFocus}><Expand /> Focus mode <kbd>Ctrl ⇧ F</kbd></button>
      <div className="engine-note"><Sparkles aria-hidden="true" /><div><strong>MINIMA Engine</strong><span>Scale-aware bicubic · linear light</span></div></div>
    </div>
    <div className="inspector-footer">
      <label className="field-label">Apply resize to</label>
      <div className="scope-list" role="radiogroup" aria-label="Apply resize to">
        {([["current", "Current image"], ["selected", `Selected images (${selectedCount})`], ["all", `All images (${totalCount})`]] as [Scope, string][]).map(([value, label]) =>
          <button key={value} role="radio" aria-checked={scope === value} className={scope === value ? "active" : ""} onClick={() => onScope(value)}><span />{label}</button>)}
      </div>
      {processing && <div className="processing"><Progress value={progress} /><span>Processing {progress}%</span></div>}
      <Button onClick={onApply} disabled={processing || !scopeCount} className="apply-button">
        {processing ? "Processing…" : `Apply to ${scopeCount} image${scopeCount === 1 ? "" : "s"}`}
      </Button>
    </div>
  </aside>;
}

