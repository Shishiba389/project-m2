import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Download, FolderTree, Images, Layers, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  defaultOutput, defaultTarget, downloadZip, estimateBytes, formatBytes, makeZip, planNames,
  runBatch, summarise,
  type BatchOutput, type BatchProgress, type BatchSource, type BatchTarget, type Fit, type OutFormat,
} from "@/src/batch";

/** Ratio chips, kept separate from the editor's marketplace preset table. */
const RATIOS: [string, number, number][] = [
  ["1:1", 1, 1], ["4:5", 4, 5], ["3:4", 3, 4], ["9:16", 9, 16], ["16:9", 16, 9], ["9:13", 9, 13],
];
const FITS: [Fit, string, string][] = [
  ["fit", "Fit", "Whole image inside, margins filled"],
  ["fill", "Fill", "Covers the frame, edges cropped"],
  ["stretch", "Stretch", "Distorts to the exact frame"],
];
const FORMATS: OutFormat[] = ["png", "jpg", "webp"];

/**
 * Panel 0: after an import, the user picks a lane. Batch and the editor are
 * genuinely different jobs, and guessing wrong wastes the most time on the
 * largest drops, so the choice is explicit rather than a default with an undo.
 */
export function ImportForkDialog({ summary, onBatch, onEditor }: {
  summary: ReturnType<typeof summarise> | null;
  onBatch: () => void;
  onEditor: () => void;
}) {
  if (!summary) return null;
  const many = summary.images > 1;
  return <Dialog open onOpenChange={onEditor}>
    <DialogContent className="fork-dialog">
      <DialogHeader>
        <DialogTitle>{summary.images} image{summary.images === 1 ? "" : "s"} ready</DialogTitle>
        <DialogDescription>
          {summary.folders > 0
            ? `From ${summary.folders} folder${summary.folders === 1 ? "" : "s"}${summary.nested ? ", including subfolders" : ""} · ${formatBytes(summary.bytes)}`
            : formatBytes(summary.bytes)}
          . Pick how you want to work.
        </DialogDescription>
      </DialogHeader>
      <div className="fork-options">
        <button className={`fork-option ${many ? "recommended" : ""}`} onClick={onBatch}>
          <Layers aria-hidden="true" />
          <strong>Batch resize</strong>
          <span>One target for every image, resized here in the browser and downloaded as a zip. Subfolders are preserved.</span>
          {many && <em>Suggested for {summary.images}</em>}
        </button>
        <button className={`fork-option ${many ? "" : "recommended"}`} onClick={onEditor}>
          <Images aria-hidden="true" />
          <strong>Open the editor</strong>
          <span>Place each image on its canvas: alignment, safe area, per-image review, then export.</span>
          {!many && <em>Suggested for one image</em>}
        </button>
      </div>
    </DialogContent>
  </Dialog>;
}

type Phase = { kind: "setup" } | { kind: "running"; progress: BatchProgress } | { kind: "done"; progress: BatchProgress; bytes: number; stopped: boolean };

export function BatchScreen({ sources, onLeave }: { sources: BatchSource[]; onLeave: () => void }) {
  const [target, setTarget] = useState<BatchTarget>(defaultTarget);
  const [output, setOutput] = useState<BatchOutput>(defaultOutput);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const stop = useRef(false);
  const lastZip = useRef<Uint8Array | null>(null);

  const summary = useMemo(() => summarise(sources), [sources]);
  const names = useMemo(() => planNames(sources, output), [sources, output]);
  const estimate = estimateBytes(sources, target, output);

  // Previews are object URLs, so they have to be released when the set changes.
  const previews = useMemo(() => sources.slice(0, 3).map((source) => ({
    id: source.id, name: source.name, url: URL.createObjectURL(source.file),
  })), [sources]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const setSize = (patch: Partial<BatchTarget>) => setTarget((current) => ({ ...current, ...patch }));

  const start = async () => {
    if (!sources.length) return;
    stop.current = false;
    setPhase({ kind: "running", progress: { done: 0, total: sources.length, current: "", failed: [] } });
    const result = await runBatch(sources, target, output,
      (progress) => setPhase({ kind: "running", progress }),
      () => stop.current);
    lastZip.current = result.zip;
    setPhase({ kind: "done", progress: result.progress, bytes: result.zip.byteLength, stopped: result.stopped });
    if (result.progress.done > result.progress.failed.length) downloadZip(result.zip, zipName(target));
  };

  if (!sources.length) return <div className="batch-pane">
    <div className="batch-empty">
      <FolderTree aria-hidden="true" />
      <h1>No source files</h1>
      <p>Batch resize works on the files you drop in. The sample images in the
        Gallery have no file behind them, so there is nothing to re-encode.</p>
      <Button onClick={onLeave}>Import images</Button>
    </div>
  </div>;

  return <div className="batch-pane">
    <div className="batch-sheet">
      <header className="batch-head">
        <div>
          <h1>Batch resize</h1>
          <p>One target applied to every file, resized in this browser. Nothing is uploaded.</p>
        </div>
        <dl className="batch-source">
          <div><dt>Images</dt><dd>{summary.images}</dd></div>
          <div><dt>Folders</dt><dd>{summary.folders || "—"}</dd></div>
          <div><dt>Source</dt><dd>{formatBytes(summary.bytes)}</dd></div>
        </dl>
      </header>

      {phase.kind === "setup" && <>
        <section className="batch-step">
          <h2><span>01</span> Target frame</h2>
          <div className="batch-size">
            <label><span className="field-label">Width</span>
              <input type="number" min={1} max={12000} value={target.width}
                onChange={(event) => setSize({ width: clamp(Number(event.target.value)) })} />
            </label>
            <span className="batch-times" aria-hidden="true">×</span>
            <label><span className="field-label">Height</span>
              <input type="number" min={1} max={12000} value={target.height}
                onChange={(event) => setSize({ height: clamp(Number(event.target.value)) })} />
            </label>
            <span className="batch-unit">px</span>
          </div>
          <div className="ratio-chips" role="group" aria-label="Aspect ratio">
            {RATIOS.map(([label, w, h]) => {
              const active = Math.abs(target.width / target.height - w / h) < 0.005;
              const long = Math.max(target.width, target.height);
              return <button key={label} className={active ? "active" : ""}
                onClick={() => setSize(w >= h
                  ? { width: long, height: Math.round((long * h) / w) }
                  : { width: Math.round((long * w) / h), height: long })}>{label}</button>;
            })}
          </div>

          <span className="field-label">How each image meets the frame</span>
          <div className="fit-cards" role="radiogroup" aria-label="Fit mode">
            {FITS.map(([value, label, hint]) => <button key={value} role="radio" aria-checked={target.fit === value}
              className={target.fit === value ? "active" : ""} onClick={() => setSize({ fit: value })}>
              <strong>{label}</strong><span>{hint}</span>
            </button>)}
          </div>

          <label className="batch-bg">
            <span className="field-label">Frame background</span>
            <span className="color-row">
              <input type="color" value={target.background} aria-label="Frame background"
                onChange={(event) => setSize({ background: event.target.value })} />
              <input className="export-input" value={target.background}
                onChange={(event) => setSize({ background: event.target.value })} aria-label="Frame background hex" />
            </span>
          </label>
        </section>

        <section className="batch-step">
          <h2><span>02</span> Preview</h2>
          <p className="batch-hint">Exactly how the first files will be framed. Fit, Fill and Stretch
            map to the same contain, cover and fill behaviour the resize uses.</p>
          <div className="batch-previews">
            {previews.map((preview) => <figure key={preview.id}>
              <div className="preview-frame"
                style={{ aspectRatio: `${target.width} / ${target.height}`, background: target.background }}>
                <img src={preview.url} alt=""
                  style={{ objectFit: target.fit === "fit" ? "contain" : target.fit === "fill" ? "cover" : "fill" }} />
              </div>
              <figcaption>{preview.name}</figcaption>
            </figure>)}
          </div>
        </section>

        <section className="batch-step">
          <h2><span>03</span> Output</h2>
          <div className="format-chips" role="group" aria-label="Output format">
            {FORMATS.map((format) => <button key={format} className={output.format === format ? "active" : ""}
              onClick={() => setOutput((current) => ({ ...current, format }))}>{format.toUpperCase()}</button>)}
          </div>
          {output.format !== "png" && <>
            <div className="slider-label"><span>Quality</span><strong>{output.quality}</strong></div>
            <Slider value={[output.quality]} min={40} max={100} step={1}
              onValueChange={([value]) => setOutput((current) => ({ ...current, quality: value }))} />
          </>}
          <label className="batch-field"><span className="field-label">Filename suffix</span>
            <input className="export-input" value={output.suffix} placeholder="none"
              onChange={(event) => setOutput((current) => ({ ...current, suffix: event.target.value }))} />
          </label>
          {summary.folders > 0 && <label className="batch-toggle">
            <span><strong>Keep subfolders</strong><em>Off writes every file to the zip root</em></span>
            <Switch checked={!output.flatten}
              onCheckedChange={(value) => setOutput((current) => ({ ...current, flatten: !value }))} />
          </label>}
          <p className="batch-hint">First file will be written as
            <code>{names.get(sources[0].id)}</code></p>
        </section>

        <footer className="batch-run">
          <div>
            <strong>{sources.length} file{sources.length === 1 ? "" : "s"}</strong>
            <span>≈ {formatBytes(estimate)} as {output.format.toUpperCase()}</span>
          </div>
          <Button onClick={start}><Download /> Resize and download</Button>
        </footer>
      </>}

      {phase.kind === "running" && <section className="batch-progress">
        <h2>Resizing</h2>
        <Progress value={Math.round((phase.progress.done / phase.progress.total) * 100)} />
        <p className="batch-count">{phase.progress.done} of {phase.progress.total}</p>
        <p className="batch-current">{phase.progress.current}</p>
        {phase.progress.failed.length > 0 && <p className="batch-failed">
          <TriangleAlert size={13} /> {phase.progress.failed.length} could not be read
        </p>}
        <Button variant="outline" onClick={() => { stop.current = true; }}><X /> Cancel</Button>
      </section>}

      {phase.kind === "done" && <section className="batch-done">
        <CircleCheck aria-hidden="true" />
        <h2>{phase.stopped ? "Cancelled" : "Downloaded"}</h2>
        <p>{phase.progress.done - phase.progress.failed.length} of {phase.progress.total} resized
          {" · "}{formatBytes(phase.bytes)} zip</p>
        {phase.progress.failed.length > 0 && <div className="error-log">
          {phase.progress.failed.map((failure) => <span key={failure.name}>{failure.name}: {failure.reason}</span>)}
        </div>}
        <div className="batch-done-actions">
          <Button variant="outline" onClick={() => setPhase({ kind: "setup" })}>Change the target</Button>
          <Button variant="outline"
            onClick={() => lastZip.current && downloadZip(lastZip.current, zipName(target))}>Download again</Button>
          <Button onClick={onLeave}>Back to the gallery</Button>
        </div>
      </section>}
    </div>
  </div>;
}

const clamp = (value: number) => (Number.isFinite(value) && value > 0 ? Math.min(12000, Math.round(value)) : 1);
const zipName = (target: BatchTarget) => `minima-${target.width}x${target.height}.zip`;

/** Re-exported so the smoke check can build a zip without importing batch.ts too. */
export { makeZip };
