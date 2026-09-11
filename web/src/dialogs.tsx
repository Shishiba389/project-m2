import { useEffect, useState } from "react";
import { Download, Package, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { EXPORT_ZIP, type ExportProgress } from "@/src/exportrun";
import { megabytes, outputName, type Asset, type Format, type Preset } from "@/src/flow";

export type ExportOptions = {
  format: Format;
  quality: number;
  profile: string;
  keepName: boolean;
  suffix: string;
  dpi: number;
  maxBytes: number | null;
};

export const defaultExportOptions: ExportOptions = {
  format: "png", quality: 92, profile: "srgb", keepName: true, suffix: "_resized", dpi: 72, maxBytes: null,
};

export const SHORTCUTS: [string, string][] = [
  ["Ctrl + A", "Select all"], ["Ctrl + Backspace", "Remove images"], ["Enter", "Open in Editor"],
  ["Ctrl + Z", "Undo"], ["Ctrl + Shift + Z", "Redo"], ["Space", "Compare original"],
  ["Ctrl + Shift + F", "Focus mode"], ["Esc", "Exit focus mode"], ["Arrows", "Nudge object"],
  ["Shift + Arrows", "Nudge ×10"], ["Right-click", "Image and preset menus"],
];

/** The real file where there is one, so the export list shows what ships. */
function Thumb({ asset }: { asset: Asset }) {
  if (asset.thumbnailUrl || asset.url) return <img className="asset-image" src={asset.thumbnailUrl ?? asset.url} alt="" draggable={false}
    loading="lazy" decoding="async" style={{ objectFit: "cover" }} />;
  return <div className={`product-placeholder product-${asset.kind}`} aria-hidden="true"><Package strokeWidth={1.25} /><span /></div>;
}

export function ExportDialog({ open, onOpenChange, queue, options, canvas, onOptions, onStart }: {
  open: boolean; onOpenChange: (value: boolean) => void; queue: Asset[];
  options: ExportOptions; canvas: string; onOptions: (next: ExportOptions) => void; onStart: () => void;
}) {
  const estimate = queue.reduce((total, asset) => total + megabytes(asset), 0) * (options.format === "png" ? 1 : options.quality / 100);
  const missing = queue.filter((asset) => !asset.file).length;

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog">
    <DialogHeader>
      <DialogTitle>Export {queue.length} images</DialogTitle>
      <DialogDescription>
        Every processed image, rendered at {canvas} into the placeholder frame.
        Pending images are excluded.
      </DialogDescription>
    </DialogHeader>
    <div className="export-grid">
      <section>
        <label className="field-label">File format</label>
        <Select value={options.format} onValueChange={(value) => onOptions({ ...options, format: value as Format })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="png">PNG (lossless)</SelectItem><SelectItem value="jpg">JPG</SelectItem><SelectItem value="webp">WEBP</SelectItem><SelectItem value="tiff">TIFF</SelectItem></SelectContent>
        </Select>
        <div className="slider-label"><span>Quality</span><strong>{options.format === "png" ? "lossless" : `${options.quality}%`}</strong></div>
        <Slider value={[options.quality]} onValueChange={([value]) => onOptions({ ...options, quality: value })} disabled={options.format === "png"} />
        <label className="field-label">Color profile</label>
        <Select value={options.profile} onValueChange={(value) => onOptions({ ...options, profile: value })}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="srgb">sRGB (browser output)</SelectItem></SelectContent>
        </Select>
        <label className="field-label" htmlFor="dpi">DPI metadata</label>
        <input id="dpi" className="export-input" type="number" min={1} max={2400} value={options.dpi}
          onChange={(event) => onOptions({ ...options, dpi: Number(event.target.value) })} />
        <label className="field-label" htmlFor="max-size">Maximum file size (KB, optional)</label>
        <input id="max-size" className="export-input" type="number" min={1} placeholder="No limit"
          value={options.maxBytes ? Math.round(options.maxBytes / 1024) : ""}
          onChange={(event) => onOptions({ ...options, maxBytes: event.target.value ? Number(event.target.value) * 1024 : null })} />
        <label className="check-row">
          <Checkbox checked={options.keepName} onCheckedChange={(value) => onOptions({ ...options, keepName: Boolean(value) })} />
          Keep original filename
        </label>
        <label className="field-label" htmlFor="suffix">Suffix</label>
        <input id="suffix" className="export-input" value={options.suffix} onChange={(event) => onOptions({ ...options, suffix: event.target.value })} />
        <p className="export-destination">
          <Download aria-hidden="true" />
          Rendered here and downloaded as <code>{EXPORT_ZIP}</code>. Nothing is uploaded,
          and a browser cannot write to a folder on your machine.
        </p>
      </section>
      <section className="export-list">
        <strong>{queue.length} files · estimated {estimate.toFixed(1)} MB</strong>
        {missing > 0 && <p className="export-warning"><TriangleAlert size={12} /> {missing} without a source file will be skipped</p>}
        {options.format === "tiff" && <p className="export-warning"><TriangleAlert size={12} /> TIFF cannot be encoded in a browser; PNG is written instead</p>}
        {queue.slice(0, 7).map((asset) => <div key={asset.id}><Thumb asset={asset} /><span>{outputName(asset, options.format, options.suffix, options.keepName)}</span></div>)}
        {queue.length > 7 && <span className="export-more">+{queue.length - 7} more</span>}
      </section>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!queue.length} onClick={onStart}><Download /> Export and download</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

/**
 * Real progress for a real render: the counts, the current file and the failures
 * all come from runExport, and the zip is already downloading by the time this
 * says complete.
 */
export function ExportProgress({ run, done, bytes, queue, options, onCancel, onAgain, onClose }: {
  run: ExportProgress | null; done: boolean; bytes: number; queue: Asset[]; options: ExportOptions;
  onCancel: () => void; onAgain: () => void; onClose: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  useEffect(() => { if (!run) setLogOpen(false); }, [run]);
  if (!run) return null;

  const percent = run.total ? Math.round((run.done / run.total) * 100) : 100;
  const written = queue.slice(0, run.done).slice(-6);
  const good = run.done - run.failed.length;

  return <Dialog open onOpenChange={onClose}><DialogContent className="export-dialog progress-dialog">
    <DialogHeader>
      <DialogTitle>{done ? "Export downloaded" : "Exporting"}</DialogTitle>
      <DialogDescription>
        {done
          ? `${good} of ${run.total} rendered · ${(bytes / 1048576).toFixed(1)} MB zip`
          : `Rendering ${run.done} / ${run.total} (${percent}%)`}
      </DialogDescription>
    </DialogHeader>
    {!done && <>
      <div className="progress-actions">
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel export</Button>
      </div>
      <p className="batch-current">{run.current}</p>
    </>}
    <Progress value={percent} />
    <div className="export-stream">{written.map((asset) => <div key={asset.id}>
      <Thumb asset={asset} />
      <span>{outputName(asset, options.format, options.suffix, options.keepName)}</span>
    </div>)}</div>
    {run.failed.length > 0 && <button className="log-link" onClick={() => setLogOpen((value) => !value)}>
      {logOpen ? "HIDE ERROR LOG" : `VIEW ERROR LOG (${run.failed.length})`}
    </button>}
    {logOpen && <div className="error-log">
      {run.failed.map((failure) => <span key={failure.name}>{failure.name}: {failure.reason}</span>)}
    </div>}
    <DialogFooter>
      {done && <Button variant="outline" onClick={onAgain}>Download again</Button>}
      <Button onClick={onClose}>{done ? "Done" : "Close"}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle><DialogDescription>Everything in the primary path has a key.</DialogDescription></DialogHeader>
    <div className="shortcut-list">{SHORTCUTS.map(([keys, label]) => <div key={keys} className="shortcut-row"><span>{label}</span><kbd>{keys}</kbd></div>)}</div>
    <DialogFooter><Button onClick={() => onOpenChange(false)}>Dismiss</Button></DialogFooter>
  </DialogContent></Dialog>;
}

/** Panel 1: the confirmation step behind every bulk removal. */
export function RemoveDialog({ intent, onCancel, onConfirm }: {
  intent: { keepSelected: boolean; count: number } | null; onCancel: () => void; onConfirm: () => void;
}) {
  if (!intent) return null;
  return <Dialog open onOpenChange={onCancel}><DialogContent className="confirm-dialog">
    <DialogHeader>
      <DialogTitle>Confirm removal</DialogTitle>
      <DialogDescription>
        Move {intent.count} image{intent.count === 1 ? "" : "s"} to Trash? They leave this project only — the source files are untouched.
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>Cancel</Button>
      <Button variant="destructive" onClick={onConfirm}>Remove</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

/** Panel 7: Add New Custom Preset, plus Edit behind the row context menu. */
export function PresetDialog({ draft, presets, onCancel, onSave }: {
  draft: { preset: Preset; mode: "create" | "edit" } | null; presets: Preset[];
  onCancel: () => void; onSave: (preset: Preset) => void;
}) {
  const [form, setForm] = useState<Preset | null>(null);
  useEffect(() => setForm(draft?.preset ?? null), [draft]);
  if (!draft || !form) return null;

  const clash = presets.some((preset) => preset.id !== draft.preset.id && preset.label.toLowerCase() === form.label.trim().toLowerCase());
  const valid = form.label.trim().length > 0 && form.width > 0 && form.height > 0 && !clash;

  return <Dialog open onOpenChange={onCancel}><DialogContent className="preset-dialog">
    <DialogHeader>
      <DialogTitle>{draft.mode === "create" ? "New custom preset" : `Edit ${draft.preset.label}`}</DialogTitle>
      <DialogDescription>Saved presets apply their whole rule set in one action.</DialogDescription>
    </DialogHeader>
    <div className="preset-form">
      <label className="field-label" htmlFor="preset-label">Name</label>
      <input id="preset-label" className="export-input" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
      {clash && <p className="form-error">A preset with that name already exists.</p>}
      <label className="field-label">Canvas dimensions</label>
      <div className="dimension-row">
        <input aria-label="Preset width" type="number" min={1} value={form.width} onChange={(event) => setForm({ ...form, width: Number(event.target.value) })} />
        <span>×</span>
        <input aria-label="Preset height" type="number" min={1} value={form.height} onChange={(event) => setForm({ ...form, height: Number(event.target.value) })} />
        <span>px</span>
      </div>
      <div className="slider-label"><span>Safe area · horizontal</span><strong>{form.safeX.toFixed(2)}%</strong></div>
      <Slider value={[form.safeX]} onValueChange={([value]) => setForm({ ...form, safeX: value })} max={30} step={0.01} />
      <div className="slider-label"><span>Safe area · vertical</span><strong>{form.safeY.toFixed(2)}%</strong></div>
      <Slider value={[form.safeY]} onValueChange={([value]) => setForm({ ...form, safeY: value })} max={30} step={0.5} />
      <label className="field-label" htmlFor="preset-bg">Background</label>
      <div className="color-row">
        <input id="preset-bg" type="color" value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} />
        <input className="export-input" value={form.background} onChange={(event) => setForm({ ...form, background: event.target.value })} />
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>Cancel</Button>
      <Button disabled={!valid} onClick={() => onSave({ ...form, label: form.label.trim() })}>{draft.mode === "create" ? "Create preset" : "Save changes"}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

/** Panel 4: Import from Cloud — one URL per line, filenames become the assets. */
export function CloudDialog({ open, onOpenChange, onImport }: {
  open: boolean; onOpenChange: (value: boolean) => void; onImport: (names: string[]) => void;
}) {
  const [text, setText] = useState("");
  const names = text.split("\n").map((line) => line.trim()).filter(Boolean)
    .map((line) => decodeURIComponent(line.split("?")[0].split("/").pop() ?? ""))
    .filter((name) => /\.(png|jpe?g|webp|tiff?)$/i.test(name));

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader>
      <DialogTitle>Import from cloud</DialogTitle>
      <DialogDescription>Paste one image URL per line. The duplicate-handling policy still applies.</DialogDescription>
    </DialogHeader>
    <textarea className="cloud-input" rows={6} value={text} onChange={(event) => setText(event.target.value)}
      placeholder="https://cdn.example.com/8809968136217_1.png" aria-label="Image URLs" />
    <p className="inspector-note">{names.length} usable image URL{names.length === 1 ? "" : "s"} detected.</p>
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!names.length} onClick={() => { onImport(names); setText(""); }}>Import {names.length}</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}
