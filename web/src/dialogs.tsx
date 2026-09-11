import { useEffect, useState } from "react";
import { FolderOpen, Package, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { megabytes, outputName, type Asset, type Format, type Preset } from "@/src/flow";

export type ExportOptions = {
  format: Format;
  quality: number;
  profile: string;
  keepName: boolean;
  suffix: string;
  folder: string;
};

export const defaultExportOptions: ExportOptions = {
  format: "png", quality: 92, profile: "srgb", keepName: true, suffix: "_resized", folder: "C:\\Products\\MINIMA_Output",
};

/** Progress state for a running export, so a paused run survives a re-render. */
export type ExportRun = { done: number; failed: string[]; paused: boolean };

export const SHORTCUTS: [string, string][] = [
  ["Ctrl + A", "Select all"], ["Ctrl + Backspace", "Remove images"], ["Enter", "Open in Editor"],
  ["Ctrl + Z", "Undo"], ["Ctrl + Shift + Z", "Redo"], ["Space", "Compare original"],
  ["Ctrl + Shift + F", "Focus mode"], ["Esc", "Exit focus mode"], ["Arrows", "Nudge object"],
  ["Shift + Arrows", "Nudge ×10"], ["Right-click", "Image and preset menus"],
];

function Thumb({ kind }: { kind: Asset["kind"] }) {
  return <div className={`product-placeholder product-${kind}`} aria-hidden="true"><Package strokeWidth={1.25} /><span /></div>;
}

export function ExportDialog({ open, onOpenChange, queue, options, onOptions, onStart }: {
  open: boolean; onOpenChange: (value: boolean) => void; queue: Asset[];
  options: ExportOptions; onOptions: (next: ExportOptions) => void; onStart: () => void;
}) {
  const estimate = queue.reduce((total, asset) => total + megabytes(asset), 0) * (options.format === "png" ? 1 : options.quality / 100);
  const failing = queue.filter((asset) => asset.corrupt).length;

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog">
    <DialogHeader>
      <DialogTitle>Export {queue.length} images</DialogTitle>
      <DialogDescription>Applies to every processed image. Pending images are excluded.</DialogDescription>
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
          <SelectContent><SelectItem value="srgb">sRGB (default)</SelectItem><SelectItem value="p3">Display P3</SelectItem><SelectItem value="adobe">Adobe RGB (1998)</SelectItem></SelectContent>
        </Select>
        <label className="check-row">
          <Checkbox checked={options.keepName} onCheckedChange={(value) => onOptions({ ...options, keepName: Boolean(value) })} />
          Keep original filename
        </label>
        <label className="field-label" htmlFor="suffix">Suffix</label>
        <input id="suffix" className="export-input" value={options.suffix} onChange={(event) => onOptions({ ...options, suffix: event.target.value })} />
        <label className="field-label" htmlFor="folder">Output folder</label>
        <div className="output-folder">
          <input id="folder" value={options.folder} onChange={(event) => onOptions({ ...options, folder: event.target.value })} />
          <FolderOpen aria-hidden="true" />
        </div>
      </section>
      <section className="export-list">
        <strong>{queue.length} files · estimated {estimate.toFixed(1)} MB</strong>
        {failing > 0 && <p className="export-warning"><TriangleAlert size={12} /> {failing} corrupted file{failing === 1 ? "" : "s"} will fail</p>}
        {queue.slice(0, 7).map((asset) => <div key={asset.id}><Thumb kind={asset.kind} /><span>{outputName(asset, options.format, options.suffix, options.keepName)}</span></div>)}
        {queue.length > 7 && <span className="export-more">+{queue.length - 7} more</span>}
      </section>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button disabled={!queue.length} onClick={onStart}>Export {queue.length} images</Button>
    </DialogFooter>
  </DialogContent></Dialog>;
}

/** Panel 5: streaming file list, Pause/Cancel, and the error log behind a link. */
export function ExportProgress({ run, queue, options, onPause, onClose }: {
  run: ExportRun | null; queue: Asset[]; options: ExportOptions; onPause: () => void; onClose: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  useEffect(() => { if (!run) setLogOpen(false); }, [run]);
  if (!run) return null;

  const total = queue.length;
  const complete = run.done >= total;
  const percent = total ? Math.round((run.done / total) * 100) : 100;
  const written = queue.slice(0, run.done).slice(-6);

  return <Dialog open onOpenChange={onClose}><DialogContent className="export-dialog progress-dialog">
    <DialogHeader>
      <DialogTitle>{complete ? "Export complete" : "Exporting"}</DialogTitle>
      <DialogDescription>{complete ? `${total - run.failed.length} of ${total} files written` : `Exporting ${run.done} / ${total} (${percent}%)`}</DialogDescription>
    </DialogHeader>
    {!complete && <div className="progress-actions">
      <Button size="sm" variant="outline" onClick={onPause}>{run.paused ? "Resume export" : "Pause export"}</Button>
      <Button size="sm" variant="outline" onClick={onClose}>Cancel export</Button>
    </div>}
    <Progress value={percent} />
    <div className="export-stream">{written.map((asset) => <div key={asset.id}>
      <Thumb kind={asset.kind} />
      <span>{outputName(asset, options.format, options.suffix, options.keepName)}</span>
      {asset.corrupt ? <TriangleAlert size={12} className="stream-fail" /> : null}
    </div>)}</div>
    {run.failed.length > 0 && <button className="log-link" onClick={() => setLogOpen((value) => !value)}>
      {logOpen ? "HIDE ERROR LOG" : `VIEW ERROR LOG (${run.failed.length})`}
    </button>}
    {logOpen && <div className="error-log">{run.failed.map((line) => <span key={line}>{line}</span>)}</div>}
    <DialogFooter><Button onClick={onClose}>{complete ? "Done" : "Close"}</Button></DialogFooter>
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
