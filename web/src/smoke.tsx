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
import { attachImage, createFrame } from "@/src/frame-geometry";
import { BatchScreen, ImportForkDialog } from "@/src/batchscreen";
import { Inspector } from "@/src/inspector";
import {
  defaultGuides, Editor, Gallery, ImportScreen, PresetManager, Review, SettingsScreen,
} from "@/src/screens";
import {
  countByStatus, docFromPreset, docTarget, emptyFilter, outputName, presetById, PRESETS,
  type Asset,
} from "@/src/flow";
import { fullPageImage } from "@/src/image-geometry";

const assets: Asset[] = [
  { id: 1, name: "a.png", kind: "shoe", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: false, fixed: false, corrupt: false, element: fullPageImage() },
  { id: 2, name: "b.jpg", kind: "beauty", format: "jpg", src: { w: 1600, h: 1600 }, processed: true, overflow: false, fixed: false, corrupt: false, element: fullPageImage() },
  { id: 3, name: "c.png", kind: "bottle", format: "png", src: { w: 1801, h: 2600 }, processed: true, overflow: true, fixed: false, corrupt: false, element: fullPageImage() },
  { id: 4, name: "d.webp", kind: "fashion", format: "webp", src: { w: 900, h: 900 }, processed: true, overflow: false, fixed: false, corrupt: true, element: fullPageImage() },
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
  return html;
}

const between = (html: string, from: string, to: string) => {
  const start = html.indexOf(from);
  const end = html.indexOf(to, start);
  return start < 0 || end < 0 ? "" : html.slice(start, end);
};

/** How many times a fragment appears, for assertions about drawing something once. */
const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

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

const editorHtml = check("editor", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} />,
  "canvas-scene", "page-render-clip", "selection-overlay", "image-layer", "rotation-handle", "editor-toolbar", "Rotate left", "Rotate right", "More", "Resize image from nw", "Edit image", "Crop", "filmstrip", "canvas-grid",
  // The page is an artboard inside a workspace now: a viewport hosts the
  // scene, a scrim marks what falls outside the page, and the scene carries
  // the counter-scale every piece of chrome divides back out.
  "viewport", "workspace-scrim", "workspace-page-shadow", "--zi", "Hold Space and drag to pan",
  // Rulers are pane chrome: they mount even before the pane has been measured.
  "ruler ruler-h", "ruler ruler-v", "ruler-corner",
  // The label undoes its parent's orientation, so a mirrored object is not
  // labelled in mirror writing.
  "--fx", "--fy");

/* Scene and interaction are separate layers (§3).
   The selection overlay used to carry a second copy of the selected image so
   that it could sit above the scrim; the scene draws it already, and two
   copies composite wrongly on anything with alpha - 50% over 50% reads as
   75%, so the editor showed artwork more opaque than the file it exported.
   Counting the whole document would also count the filmstrip's thumbnails, so
   each region is sliced out by the markers that bound it. */
if (editorHtml) {
  const scene = between(editorHtml, "page-render-clip", "workspace-scrim");
  const chrome = between(editorHtml, "selection-overlay", "filmstrip");
  console.assert(scene !== "" && chrome !== "", "the editor renders both a scene layer and an interaction layer");
  console.assert(occurrences(scene, "product-placeholder") === 1, "the scene draws the one layer on the canvas, once");
  console.assert(occurrences(chrome, "product-placeholder") === 0, "and the interaction layer draws no picture at all");
  console.assert(chrome.includes("Resize image from nw"), "but it does carry the handles");
}

/* A multi-selection replaces the single-object chrome with one group
   rectangle and swaps the contextual toolbar for align and distribute (§18,
   §25). Two objects are selected here, so neither Crop nor Replace has a
   subject any more and neither should be on screen. */
const multiHtml = check("editor multi-select", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc}
  viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  multi={{
    selection: ["asset-1", "asset-2"],
    items: [
      { key: "asset-1", box: { ...assets[0].element.box, x: 10, y: 10, w: 30, h: 20 } },
      { key: "asset-2", box: { ...assets[0].element.box, x: 50, y: 40, w: 30, h: 20 } },
    ],
    onSelect: noop, onGestureStart: noop, onWrite: noop, onGestureEnd: noop, onAlign: noop, onDistribute: noop,
  }}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} />,
  "multi-selection", "2 selected", "Align left", "Distribute horizontally", "Resize selection from nw");
if (multiHtml) {
  console.assert(!multiHtml.includes("Resize image from nw"), "a group hides the single-image handles");
  console.assert(!multiHtml.includes("Edit image"), "and the contextual toolbar gives way to align and distribute");
  console.assert(multiHtml.includes("Distribute horizontally"), "which is what a two-object selection can actually do");
}

/* One asset, placed twice (§22). The scene draws two pictures from one
   source file, each with its own geometry and its own key - which is the
   whole point of separating a reusable asset from a scene instance. */
const twiceHtml = check("editor two copies", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc}
  viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  canvasLayers={[
    { key: "place-a", assetId: assets[0].id, placementId: "a", element: { ...assets[0].element, box: { ...assets[0].element.box, x: 5, y: 5, w: 40, h: 40 } } },
    { key: "place-b", assetId: assets[0].id, placementId: "b", element: { ...assets[0].element, box: { ...assets[0].element.box, x: 55, y: 55, w: 40, h: 40 } } },
  ]}
  activeLayer={{ key: "place-a", assetId: assets[0].id, placementId: "a", element: { ...assets[0].element, box: { ...assets[0].element.box, x: 5, y: 5, w: 40, h: 40 } } }}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} />,
  "canvas-scene");
if (twiceHtml) {
  const scene = between(twiceHtml, "page-render-clip", "workspace-scrim");
  console.assert(occurrences(scene, "product-placeholder") === 2, "one asset placed twice is drawn twice");
  const chrome = between(twiceHtml, "selection-overlay", "filmstrip");
  console.assert(occurrences(chrome, "layer-hit") === 1, "the copy that is not being edited is a click target");
  console.assert(chrome.includes("Resize image from nw"), "and the one being edited has the handles");
}

check("editor comparing", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare
  compareView="split" splitAt={50} overlay={80} guides={defaultGuides} target={target}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} />,
  "Original", "Resized preview", "split-handle");

check("editor crop", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop} focusMode editMode="crop" />,
  "crop-overlay", "crop-window", "Resize crop from nw");

// Frames: an empty one advertises itself, a filled one clips its image, and
// edit-content dims the page instead of clipping.
const emptyFrame = createFrame({ x: 10, y: 10, w: 40, h: 40 });
const filledFrame = attachImage(createFrame({ x: 50, y: 50, w: 40, h: 40 }), assets[0].id, assets[0].src, { width: doc.width, height: doc.height });
const framedDoc = { ...doc, frames: [emptyFrame, filledFrame] };
check("editor frames", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={framedDoc} viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop}
  frameSelection={{ id: emptyFrame.id, editing: false }} />,
  "frame-layer", "frame-placeholder", "Drop image here", "frame-selection", "Empty frame", "Resize frame from nw", "Delete frame", "Add frame");

check("editor frame content", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={framedDoc} viewport={{ zoom: 0.2, panX: 40, panY: 20 }} onViewport={noop} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  onElement={noop} onElementAction={noop} onElementStart={noop} onElementEnd={noop} onCropStart={noop} onCropDone={noop} onCropCancel={noop} onCropReset={noop} onSplit={noop} onChoose={noop} onImport={noop} onDrop={noop} onFit={noop} onToggleGrid={noop} onStep={noop}
  frameSelection={{ id: filledFrame.id, editing: true }} />,
  "content-edit", "content-edit-mask", "Frame content", "Scale content from nw", "Done", "Cancel", "Fill", "Fit");

check("review", <Review assets={assets.slice(2)} target={target} onOpen={noop} onFix={noop} onFixAll={noop} onRetry={noop} />,
  "Error Review", "Auto-fix scaling", "Re-run preset");

check("presets", <PresetManager presets={PRESETS} activeId="zalando" onApply={noop} onCreate={noop}
  onEdit={noop} onDuplicate={noop} onDelete={noop} onShare={noop} />,
  "Presets Manager", "Preset Details", "Add new custom preset", "Marketplace");

check("settings", <SettingsScreen />,
  "Settings", "Keyboard shortcuts", "Presets screen");

check("inspector", <Inspector doc={doc} target={target} asset={assets[0]} presets={PRESETS} guides={defaultGuides}
  scope="selected" scopeCount={3} selectedCount={3} totalCount={4} compare overlay={100} processing={false} progress={0}
  onPreset={noop} onDoc={noop} onGuides={noop} onScope={noop} onOverlay={noop} onApply={noop} onFocus={noop}
  onClose={noop} onResetGuides={noop}
  layers={[
    { key: "frame-a", name: "bottle.png", frame: true, empty: false },
    { key: "asset-2", name: "hero.png", frame: false, empty: false },
    { key: "asset-1", name: "Untitled canvas", frame: false, empty: false, pinned: true },
  ]}
  layerSelection={["asset-2"]} onLayerSelect={noop} onLayerReorder={noop}
  selection={{ label: "Hero shot", box: { x: 12, y: 8, w: 60, h: 45, rotation: 15, flipH: true, flipV: false, lockedRatio: true } }}
  onSelectionBox={noop} />,
  "Resize Inspector", "Image fit alignment", "Guides", "Snap safe", "Canvas background",
  "Overlay opacity", "Apply resize to", "Apply to 3 images",
  "Lock canvas settings",
  // The transform panel renders its derived pixel values, not raw percentages.
  "Transform", "Hero shot", "Angle", "Flip horizontally", "Unlock aspect ratio",
  // The layers panel is the scene graph, topmost first, with the selected
  // row marked for assistive technology as well as visually.
  "Layers", "layers-list", "bottle.png", "hero.png", "aria-selected=\"true\"",
  // The page's own image is labelled and pinned, not silently undraggable.
  "Page image");

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
// The editor's export uses each image element's geometry and clips it to the
// document page, so the geometry the dialog promises is the geometry it writes.
{
  const spec = specFromDoc(doc);
  const frame = framePx(spec);
  console.assert(spec.width === doc.width && spec.height === doc.height, "the export canvas is the document canvas");
  console.assert(frame.w === doc.width, "the default image element spans the output page");
  console.assert(fitInto(4000, 1000, frame, "contain").w <= frame.w + 0.001, "contain stays inside the frame");
  console.assert(encodableFormat("tiff") === "png", "TIFF degrades rather than writing an empty blob");
}

if (!process.exitCode) console.log("\nsmoke: every screen and overlay rendered");
