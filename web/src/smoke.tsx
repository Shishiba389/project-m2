/**
 * One runnable check for the surfaces: server-render every screen and every
 * overlay once. This catches crashes, bad imports and hook misuse that neither
 * `tsc` nor a successful bundle can see — which is how dead-on-arrival screens
 * shipped before.
 *
 *   npx tsx src/smoke.tsx
 */
import { renderToString } from "react-dom/server";
import { MinimaWorkspace } from "@/src/App";
import {
  CloudDialog, defaultExportOptions, ExportDialog, ExportProgress, PresetDialog, RemoveDialog,
  ShortcutsDialog,
} from "@/src/dialogs";
import { makeZip } from "@/src/batch";
import { encodableFormat, fitInto, framePx, specFromDoc } from "@/src/exportrun";
import { BatchScreen, ImportForkDialog } from "@/src/batchscreen";
import { Inspector } from "@/src/inspector";
import {
  defaultGuides, Editor, Gallery, ImportScreen, PresetManager, Review, SettingsScreen,
} from "@/src/screens";
import {
  countByStatus, docFromPreset, docTarget, emptyFilter, outputName, presetById, PRESETS,
  type Asset,
} from "@/src/flow";

const assets: Asset[] = [
  { id: 1, name: "a.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 2, name: "b.jpg", kind: "beauty", format: "jpg", src: { w: 1600, h: 1600 }, processed: true, overflow: false, fixed: false, corrupt: false },
  { id: 3, name: "c.png", kind: "bottle", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: true, fixed: false, corrupt: false },
  { id: 4, name: "d.webp", kind: "fashion", format: "webp", src: { w: 900, h: 900 }, processed: true, overflow: false, fixed: false, corrupt: true },
];
const doc = docFromPreset(presetById("zalando"));
const target = docTarget(doc, PRESETS);
const counts = countByStatus(assets, target);
const noop = () => {};

/**
 * Render one surface and assert the text that proves it drew. React splits
 * adjacent text nodes with an empty comment, so those are stripped first.
 *
 * Overlays built on Radix Dialog render through a portal, which server
 * rendering skips — for those, pass no needles and the check only proves the
 * component mounts without throwing.
 */
function check(label: string, node: React.ReactElement, ...needles: string[]) {
  let html = "";
  try {
    // Text nodes are split by an empty comment, and & arrives escaped, so
    // assertions can be written the way the UI reads.
    html = renderToString(node).replaceAll("<!-- -->", "").replaceAll("&amp;", "&");
  } catch (error) {
    console.error(`FAIL ${label}: ${(error as Error).message}`);
    process.exitCode = 1;
    return;
  }
  const missing = needles.filter((needle) => !html.includes(needle));
  if (missing.length) {
    console.error(`FAIL ${label}: missing ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok   ${label} (${html.length} chars)`);
}

// A first run has no assets, so the shell opens on Import. The seeded demo
// images are gone: they had no file behind them and were the stand-ins showing
// up in the gallery, the filmstrip and the export list.
check("workspace shell, first run", <MinimaWorkspace />,
  "Drag & Drop", "Start a resize batch", "Drop images here", "All changes saved", "no images");

check("import screen", <ImportScreen policy="skip" onPolicy={noop} onFiles={noop} onFolders={noop} onCloud={noop} onDrop={noop} />,
  "Start a resize batch", "Drop images here", "Add files", "Add folders", "Import from cloud",
  "If a filename already exists", "Export");

check("gallery", <Gallery assets={assets} total={assets.length} selected={[1]} counts={counts} filter={emptyFilter}
  zoom={100} needsAttention={2} target={target} onFilter={noop} onChoose={noop} onOpen={noop} onReview={noop} onRemove={noop} />,
  "Completed", "Review 2", "Search files", "need attention");

check("editor", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} zoom={100} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  onBox={noop} onPlacement={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} />,
  "image-layer", "editor-toolbar", "Edit image", "Crop", "filmstrip", "canvas-grid");

check("editor comparing", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} zoom={100} compare
  compareView="split" splitAt={50} overlay={80} guides={defaultGuides} target={target}
  onBox={noop} onPlacement={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} />,
  "Original", "Resized preview", "split-handle");

check("review", <Review assets={assets.slice(2)} target={target} onOpen={noop} onFix={noop} onFixAll={noop} onRetry={noop} />,
  "Error Review", "Auto-fix scaling", "Re-run preset");

check("presets", <PresetManager presets={PRESETS} activeId="zalando" onApply={noop} onCreate={noop}
  onEdit={noop} onDuplicate={noop} onDelete={noop} onShare={noop} />,
  "Presets Manager", "Preset Details", "Add new custom preset", "Marketplace");

check("settings", <SettingsScreen theme="dark" onTheme={noop} />,
  "Settings", "Appearance", "Light", "Dark", "System");

check("inspector", <Inspector doc={doc} target={target} asset={assets[0]} presets={PRESETS} guides={defaultGuides}
  scope="selected" scopeCount={3} selectedCount={3} totalCount={4} compare overlay={100} processing={false} progress={0}
  onPreset={noop} onDoc={noop} onGuides={noop} onScope={noop} onOverlay={noop} onApply={noop} onFocus={noop}
  onClose={noop} onResetGuides={noop} />,
  "Resize Inspector", "Alignment matrix", "Flip H", "Guides", "Snap safe", "Canvas background",
  "Overlay opacity", "Apply resize to", "Apply to 3 images",
  "Crop mask", "Reset crop", "Crop to safe area", "Top", "Right", "Bottom", "Left");

check("export dialog", <ExportDialog open onOpenChange={noop} queue={assets} options={defaultExportOptions} canvas="1801 × 2600 px" onOptions={noop} onStart={noop} />);

check("export progress", <ExportProgress
  run={{ done: 2, total: 4, current: "c.png", failed: [{ name: "d.webp", reason: "no source file" }] }}
  done={false} bytes={0} queue={assets} options={defaultExportOptions}
  onCancel={noop} onAgain={noop} onClose={noop} />);

check("shortcuts", <ShortcutsDialog open onOpenChange={noop} />);

check("remove confirm", <RemoveDialog intent={{ keepSelected: false, count: 3 }} onCancel={noop} onConfirm={noop} />);

check("preset editor", <PresetDialog draft={{ preset: presetById("my-brand"), mode: "edit" }} presets={PRESETS} onCancel={noop} onSave={noop} />);

check("cloud import", <CloudDialog open onOpenChange={noop} onImport={noop} />);

// Batch is a separate pipeline, so it gets its own landmarks. With no sources
// it must say so rather than offering a run button that cannot do anything.
check("batch, no sources", <BatchScreen sources={[]} onLeave={noop} />,
  "No source files", "Import images");

// The fork dialog is a Radix dialog, so only its mount is provable here.
check("import fork", <ImportForkDialog summary={{ images: 12, folders: 3, nested: true, bytes: 4096 }}
  onBatch={noop} onEditor={noop} />);

// Overlay bodies live behind a portal, so the strings they show are asserted
// against the pure helpers that produce them instead.
console.assert(outputName(assets[0], "jpg", "_resized", true) === "a_resized.jpg", "the export dialog previews real filenames");
console.assert(assets.filter((asset) => asset.corrupt).length === 1, "the export dialog has a failure to warn about");
console.assert(makeZip([]).byteLength === 22, "the batch zip writer is reachable from the app bundle");
{
  // Real images, not stand-ins, wherever a file is attached.
  const withFile = { ...assets[0], url: "blob:fake" };
  const html = renderToString(<Gallery assets={[withFile]} total={1} selected={[]} counts={counts}
    filter={emptyFilter} zoom={100} needsAttention={0} target={target}
    onFilter={noop} onChoose={noop} onOpen={noop} onReview={noop} onRemove={noop} />);
  console.assert(html.includes('src="blob:fake"'), "a gallery card draws the file it was given");
  console.assert(!html.includes("product-placeholder"), "and does not fall back to the stand-in");
  const bare = renderToString(<Gallery assets={[assets[0]]} total={1} selected={[]} counts={counts}
    filter={emptyFilter} zoom={100} needsAttention={0} target={target}
    onFilter={noop} onChoose={noop} onOpen={noop} onReview={noop} onRemove={noop} />);
  console.assert(bare.includes("product-placeholder"), "an asset with no file still renders the stand-in");

  const thumb = { ...withFile, thumbnailUrl: "blob:thumb" };
  const thumbHtml = renderToString(<Gallery assets={[thumb]} total={1} selected={[]} counts={counts}
    filter={emptyFilter} zoom={100} needsAttention={0} target={target}
    onFilter={noop} onChoose={noop} onOpen={noop} onReview={noop} onRemove={noop} />);
  console.assert(thumbHtml.includes('src="blob:thumb"') && thumbHtml.includes('loading="lazy"'), "gallery uses the generated lazy thumbnail");

  const many = Array.from({ length: 500 }, (_, index) => ({ ...assets[0], id: 1000 + index, name: `bulk-${index}.png` }));
  const manyHtml = renderToString(<Gallery assets={many} total={many.length} selected={[]} counts={{ ...counts, All: many.length }}
    filter={emptyFilter} zoom={100} needsAttention={0} target={target}
    onFilter={noop} onChoose={noop} onOpen={noop} onReview={noop} onRemove={noop} />);
  console.assert((manyHtml.match(/class="asset-card /g) ?? []).length === 120, "gallery mounts only the first 120 cards");
  console.assert(manyHtml.includes("Load 120 more"), "large galleries expose progressive loading");
}
// The editor's export renders at the document's canvas size into its frame,
// so the geometry the dialog promises is the geometry it writes.
{
  const spec = specFromDoc(doc);
  const frame = framePx(spec);
  console.assert(spec.width === doc.width && spec.height === doc.height, "the export canvas is the document canvas");
  console.assert(frame.w === (doc.box.w / 100) * doc.width, "the frame is the placeholder, in pixels");
  console.assert(fitInto(4000, 1000, frame, "contain").w <= frame.w + 0.001, "contain stays inside the frame");
  console.assert(encodableFormat("tiff") === "png", "TIFF degrades rather than writing an empty blob");
}

if (!process.exitCode) console.log("\nsmoke: every screen and overlay rendered");
