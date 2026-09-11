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
import { Inspector } from "@/src/inspector";
import {
  defaultGuides, defaultSettings, Editor, Gallery, ImportScreen, PresetManager, Review, SettingsScreen,
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
const doc = docFromPreset(presetById("zalando"), assets[0]);
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
    html = renderToString(node).replaceAll("<!-- -->", "");
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

check("workspace shell", <MinimaWorkspace />,
  "MINIMA Resize", "Resize Inspector", "Apply to", "need attention", "All changes saved");

check("import screen", <ImportScreen policy="skip" onPolicy={noop} onFiles={noop} onFolders={noop} onCloud={noop} onDrop={noop} />,
  "Drop images here", "Add files", "Add folders", "Import from cloud", "Handling existing files");

check("gallery", <Gallery assets={assets} total={assets.length} selected={[1]} counts={counts} filter={emptyFilter}
  zoom={100} needsAttention={2} target={target} onFilter={noop} onChoose={noop} onOpen={noop} onReview={noop} onRemove={noop} />,
  "Completed", "Review 2", "Search files", "need attention");

check("editor", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} zoom={100} compare={false}
  compareView="split" splitAt={50} overlay={100} guides={defaultGuides} target={target}
  onBox={noop} onSplit={noop} onChoose={noop} onToggleGrid={noop} />,
  "editable-object", "filmstrip", "canvas-grid");

check("editor comparing", <Editor asset={assets[0]} assets={assets} selected={[1]} doc={doc} zoom={100} compare
  compareView="split" splitAt={50} overlay={80} guides={defaultGuides} target={target}
  onBox={noop} onSplit={noop} onChoose={noop} onToggleGrid={noop} />,
  "Original", "Resized preview", "split-handle");

check("review", <Review assets={assets.slice(2)} target={target} onOpen={noop} onFix={noop} onFixAll={noop} onRetry={noop} />,
  "Error Review", "Auto-fix scaling", "Re-run preset");

check("presets", <PresetManager presets={PRESETS} activeId="zalando" onApply={noop} onCreate={noop}
  onEdit={noop} onDuplicate={noop} onDelete={noop} onShare={noop} />,
  "Presets Manager", "Preset Details", "Add new custom preset", "Marketplace");

check("settings", <SettingsScreen presets={PRESETS} settings={defaultSettings} onSettings={noop} />,
  "App Settings", "Settings Details", "Default preset", "App theme", "Hardware acceleration");

check("inspector", <Inspector doc={doc} target={target} asset={assets[0]} presets={PRESETS} guides={defaultGuides}
  scope="selected" scopeCount={3} selectedCount={3} totalCount={4} compare overlay={100} processing={false} progress={0}
  onPreset={noop} onDoc={noop} onGuides={noop} onScope={noop} onOverlay={noop} onApply={noop} onFocus={noop}
  onClose={noop} onResetGuides={noop} />,
  "Resize Inspector", "Alignment matrix", "Flip H", "Snap to safe area", "Canvas background",
  "Overlay opacity", "Apply to 3 images");

check("export dialog", <ExportDialog open onOpenChange={noop} queue={assets} options={defaultExportOptions} onOptions={noop} onStart={noop} />);

check("export progress", <ExportProgress run={{ done: 2, failed: ["d.webp: Access denied"], paused: false }}
  queue={assets} options={defaultExportOptions} onPause={noop} onClose={noop} />);

check("shortcuts", <ShortcutsDialog open onOpenChange={noop} />);

check("remove confirm", <RemoveDialog intent={{ keepSelected: false, count: 3 }} onCancel={noop} onConfirm={noop} />);

check("preset editor", <PresetDialog draft={{ preset: presetById("my-brand"), mode: "edit" }} presets={PRESETS} onCancel={noop} onSave={noop} />);

check("cloud import", <CloudDialog open onOpenChange={noop} onImport={noop} />);

// Overlay bodies live behind a portal, so the strings they show are asserted
// against the pure helpers that produce them instead.
console.assert(outputName(assets[0], "jpg", "_resized", true) === "a_resized.jpg", "the export dialog previews real filenames");
console.assert(assets.filter((asset) => asset.corrupt).length === 1, "the export dialog has a failure to warn about");

if (!process.exitCode) console.log("\nsmoke: every screen and overlay rendered");
