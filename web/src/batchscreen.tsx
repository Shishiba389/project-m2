import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Download, FolderTree, Images, Layers, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  defaultOutput, downloadZip, estimateBytes, formatBytes, makeZip, planNames, runBatch, summarise,
  type BatchOutput, type BatchProgress, type BatchSource, type OutFormat,
} from "@/src/batch";

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
          <strong>Batch convert</strong>
          <span>Resize every image to one exact target and download a zip. Format, naming and subfolders in one pass.</span>
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
  const [output, setOutput] = useState<BatchOutput>(defaultOutput);
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const stop = useRef(false);
  const lastZip = useRef<Uint8Array | null>(null);

  const summary = useMemo(() => summarise(sources), [sources]);
  const names = useMemo(() => planNames(sources, output), [sources, output]);
  const estimate = estimateBytes(sources, output);

  // Previews are object URLs, so they have to be released when the set changes.
  const previews = useMemo(() => sources.slice(0, 6).map((source) => ({
    id: source.id, name: source.name, url: URL.createObjectURL(source.file),
  })), [sources]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const start = async () => {
    if (!sources.length) return;
    stop.current = false;
    setPhase({ kind: "running", progress: { done: 0, total: sources.length, current: "", failed: [] } });
    const result = await runBatch(sources, output,
      (progress) => setPhase({ kind: "running", progress }),
      () => stop.current);
    lastZip.current = result.zip;
    setPhase({ kind: "done", progress: result.progress, bytes: result.zip.byteLength, stopped: result.stopped });
    if (result.progress.done > result.progress.failed.length) downloadZip(result.zip, ZIP_NAME);
  };

  if (!sources.length) return <div className="batch-pane">
    <div className="batch-empty">
      <FolderTree aria-hidden="true" />
      <h1>No source files</h1>
      <p>Batch works on the files you drop in, so there is nothing to re-encode yet.</p>
      <Button onClick={onLeave}>Import images</Button>
    </div>
  </div>;

  return <div className="batch-pane">
    <div className="batch-sheet">
      <header className="batch-head">
        <div>
          <h1>Batch convert</h1>
          <p>Every file resized by MINIMA's linear-light Catmull–Rom pipeline, then downloaded
            as a zip. Nothing is uploaded.</p>
        </div>
        <dl className="batch-source">
          <div><dt>Images</dt><dd>{summary.images}</dd></div>
          <div><dt>Folders</dt><dd>{summary.folders || "—"}</dd></div>
          <div><dt>Source</dt><dd>{formatBytes(summary.bytes)}</dd></div>
        </dl>
      </header>

      {phase.kind === "setup" && <>
        <section className="batch-step">
          <h2><span>01</span> Source</h2>
          <div className="source-strip">
            {previews.map((preview) => <figure key={preview.id}>
              <img src={preview.url} alt="" />
              <figcaption>{preview.name}</figcaption>
            </figure>)}
            {sources.length > previews.length && <span className="source-more">+{sources.length - previews.length}</span>}
          </div>
          <div className="dimension-row">
            <input aria-label="Target width" type="number" min={1} max={20000} value={output.width}
              onChange={(event) => setOutput((current) => ({ ...current, width: Number(event.target.value) }))} />
            <span>×</span>
            <input aria-label="Target height" type="number" min={1} max={20000} value={output.height}
              onChange={(event) => setOutput((current) => ({ ...current, height: Number(event.target.value) }))} />
            <span>px</span>
          </div>
          <p className="batch-hint">Every source is transformed to this exact pixel size. Batch mode does not crop or position subjects.</p>
        </section>

        <section className="batch-step">
          <h2><span>02</span> Output</h2>
          <div className="format-chips" role="group" aria-label="Output format">
            {FORMATS.map((format) => <button key={format} className={output.format === format ? "active" : ""}
              onClick={() => setOutput((current) => ({ ...current, format }))}>{format.toUpperCase()}</button>)}
          </div>
          {output.format !== "png" && <>
            <div className="slider-label"><span>Quality</span><strong>{output.quality}</strong></div>
            <Slider value={[output.quality]} min={40} max={100} step={1}
              onValueChange={([value]) => setOutput((current) => ({ ...current, quality: value }))} />
          </>}
          <label className="batch-field"><span className="field-label">DPI metadata</span>
            <input className="export-input" type="number" min={1} max={2400} value={output.dpi}
              onChange={(event) => setOutput((current) => ({ ...current, dpi: Number(event.target.value) }))} />
          </label>
          <label className="batch-field"><span className="field-label">Maximum file size (KB, optional)</span>
            <input className="export-input" type="number" min={1} placeholder="No limit"
              value={output.maxBytes ? Math.round(output.maxBytes / 1024) : ""}
              onChange={(event) => setOutput((current) => ({ ...current, maxBytes: event.target.value ? Number(event.target.value) * 1024 : null }))} />
          </label>
          {output.format === "jpg" && <label className="batch-field"><span className="field-label">JPEG background</span>
            <input className="export-input" type="color" value={output.jpegBackground}
              onChange={(event) => setOutput((current) => ({ ...current, jpegBackground: event.target.value }))} />
          </label>}
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
          <Button onClick={start}><Download /> Convert and download</Button>
        </footer>
      </>}

      {phase.kind === "running" && <section className="batch-progress">
        <h2>Converting</h2>
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
        <p>{phase.progress.done - phase.progress.failed.length} of {phase.progress.total} converted
          {" · "}{formatBytes(phase.bytes)} zip</p>
        {phase.progress.failed.length > 0 && <div className="error-log">
          {phase.progress.failed.map((failure) => <span key={failure.name}>{failure.name}: {failure.reason}</span>)}
        </div>}
        <div className="batch-done-actions">
          <Button variant="outline" onClick={() => setPhase({ kind: "setup" })}>Change the output</Button>
          <Button variant="outline"
            onClick={() => lastZip.current && downloadZip(lastZip.current, ZIP_NAME)}>Download again</Button>
          <Button onClick={onLeave}>Back to the gallery</Button>
        </div>
      </section>}
    </div>
  </div>;
}

const ZIP_NAME = "minima-batch.zip";

/** Re-exported so the smoke check can build a zip without importing batch.ts too. */
export { makeZip };
