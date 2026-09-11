# MINIMA Resize — Workflow & Button Wiring

Single source of truth for navigation. Implemented in `src/flow.ts` (logic),
`src/App.tsx` (shell), `src/screens.tsx`, `src/inspector.tsx`, `src/dialogs.tsx`.

Every control listed here does something. Panel numbers refer to the reference
frames in `FLOW/`.

## 1. The one primary path

```
Import → Select → Resize / Position → Apply preset → Review → Export
```

Every screen exists to serve one step of that path. Nothing is reachable by two
different mental models.

## 2. State model

There is exactly **one** navigation state, `screen`. The old dual
`section` + `view` model is gone — it was the source of every dead end.

| `screen` | Step served | Entry | Exit |
|---|---|---|---|
| `import` | Import | rail **Import**; automatic when `assets.length === 0`, which is every first run | an import opens the lane fork |
| `batch` | Resize a whole drop at once | the fork's **Batch resize**; rail **Batch** | Back → `gallery` |
| `gallery` | Select, batch manage | rail **Images**; Back from editor/review; view switch **Gallery** | — (the hub) |
| `editor` | Resize / Position | double-click a card; **Enter**; view switch **Editor** | Back → `gallery` |
| `review` | Review | **Review n** in the gallery toolbar; needs-attention count in the status bar | Back → `gallery` |
| `presets` | Apply preset | rail **Presets** | Back → `gallery` / `import` |
| `settings` | — | rail **Settings** | Back → `gallery` / `import` |

Back is one rule for all screens: `backTarget()`. It goes up one level and is
hidden on `import` (the root).

**Overlays** stack over any screen and never change `screen`: `exportOpen`,
`run` (export progress), `shortcutsOpen`, `removeIntent`, `presetDraft`,
`cloudOpen`. Import's own options are inline on the `import` screen, per panel 4.

**Modifiers** change chrome, not location:

| Modifier | Effect | Toggle |
|---|---|---|
| `compare` | Editor canvas compares original vs resized | hold **Space**, or status-bar **Compare** (sticky) |
| `compareView` | `before` / `split` / `after` | top-bar segmented control, visible only while comparing (panel 9) |
| `focus` | Hides rail, inspector, status bar | **Ctrl+Shift+F**, **Esc** to exit |
| `railOpen` / `inspectorOpen` | Collapses a panel | top-bar toggles; inspector also has its own **✕** |

Entering `compare` or `focus` from a non-editor screen switches to `editor`
first, so a modifier is never active on a screen that cannot show it.

## 3. Button wiring

### Left rail — the only screen navigator
| Button | Target | Disabled when |
|---|---|---|
| Import | `screen = import` | never |
| Images | `screen = lastImageScreen` (`gallery` or `editor`) | no assets |
| Batch | `screen = batch` | nothing imported this session (no `File` handles) |
| Presets | `screen = presets` | never |
| Export | opens the export overlay, screen unchanged | nothing processed yet |
| Settings | `screen = settings` | never |

Export appears once in the rail; the status bar's Export opens the same overlay.

### Top bar
| Control | Wiring |
|---|---|
| Panel toggle | `railOpen` |
| Back | `backTarget(screen)`; hidden on `import` |
| Undo / Redo | history of the *document* snapshot (preset, dimensions, fit, align, safe area, background, flip, object box) — never of navigation. `Ctrl+Z` / `Ctrl+Shift+Z` |
| Document name | active file on `editor`; screen title elsewhere |
| Before / Split / After | `compareView`; only rendered while comparing |
| Zoom − / % / + | `editor`: canvas scale. `gallery`: thumbnail density (§24). Disabled elsewhere |
| Inspector toggle | `inspectorOpen` |
| Help | shortcuts overlay (panel 6) |

### Gallery
| Control | Wiring |
|---|---|
| Filter tabs All/Completed/Pending/Warning/Error | `filter.status`; counts from `countByStatus()` |
| Funnel menu (panel 8) | format, resolution and error type as checkboxes; sort by name/date/size as radios; **Clear n filters**. All of it runs through `filterAssets()`; an unticked facet means no restriction |
| Search | filename substring |
| Review *n* | `screen = review`; hidden when nothing needs attention |
| Card click / Ctrl-click / Shift-click / Ctrl+A | select / toggle / range / all |
| Card double-click, Enter | `screen = editor`, that asset active |
| Card right-click (panel 1) | Open in editor · Remove selected (*n*) · Remove unselected (*n*) · Remove (move to Trash) → confirmation overlay. `Ctrl+Backspace` opens the same confirmation |

Cards show filename, `w × h px · size`, and the derived status badge.

### Real files, everywhere

`Asset` carries the dropped `File` and an object URL, so the gallery card, the
filmstrip, the canvas, the comparison, the review card and the export list all
draw the image itself. `AssetImage` is the single place that decides, and falls
back to a stand-in only when there is no file.

There are no seeded demo assets. They had no file behind them, so every surface
could only draw a stand-in — which is what made the gallery and the export list
look broken. A first run therefore starts on Import, and object URLs are
revoked when an asset is removed.

### The placeholder frame

The editor's canvas holds one frame, and the image fills it. The frame belongs
to the batch, not to one file: every image in the queue is laid out in the same
frame, so switching images leaves it alone. Fit / Fill / Stretch describe how
the image meets the frame, which is `object-fit` contain / cover / fill.

| Control | Wiring |
|---|---|
| Eight handles | `resizeBox()`. Corners move two edges, edges move one; nothing inverts or shrinks below 4% of the canvas. Hold **Shift** on a handle to keep the frame's ratio |
| Drag the frame | `clampBox()` keeps it inside the canvas |
| Margins Top / Right / Bottom / Left | `marginsOf()` and `boxFromMargins()` are the same rect read from the other side, so the numbers and the handles can never disagree |
| **Fill canvas** | `fullBox()` — the frame spans the canvas, and the image fills all of it |
| **Safe area** | `safeBox()` — back to the margins the preset specifies |
| 3×3 alignment | `anchor()` places the frame at one of nine positions inside the safe area |

A frame drawn with Fit leaves margins, and those show the canvas background,
because that is the colour an export paints.

### Editor canvas
| Control | Wiring |
|---|---|
| Drag / arrow keys | moves the frame; Shift = ×10 |
| Snapping | `snapBox()` honours the two snap switches: safe-area edges plus centre lines, and the thirds grid. Both off means free movement |
| Rulers, grid overlay, grid button (panel 10) | `guides.rulers` / `guides.grid` |
| Split handle (panel 9) | drag or arrow keys move `splitAt`; the divider clips the resized canvas over the original |
| Filmstrip | switches the active asset, keeps the selection |

### Inspector — the resize step
| Control | Wiring |
|---|---|
| Preset | applies the whole preset row: dimensions, safe area, fit, align, background |
| Width × Height | free typing; aspect lock re-derives the other from the ratio captured when the lock engaged |
| Fit / Fill / Stretch | how the image fills the frame, as `object-fit` |
| Placeholder frame | Fill canvas / Safe area, plus the four numeric margins |
| 3×3 alignment | places the frame via `anchor()` inside the safe area |
| Flip H / Flip V (panel 3) | `doc.flipH` / `doc.flipV`, applied as a canvas transform |
| Safe area sliders | live overlay, and reframes the placeholder to match |
| Overlay opacity (panel 9) | strength of the original in the split view; only shown while comparing |
| Show grid / rulers, Snap to grid / safe area, Reset guides (panel 10) | `guides`; Reset restores the defaults and re-applies the preset |
| Canvas background (panel 3) | colour picker plus hex field, both writing `doc.background` |
| Object scale | read-out from `objectScale()`, with the resulting pixel size |
| Scope: Current / Selected *n* / All *n* | which assets Apply writes to (§13) |
| **Apply to *n* images** | marks the scope processed, records safe-area overflow for Fill/Stretch → statuses recompute → Export unlocks |
| ↺ / ✕ in the heading | Reset guides · close the inspector |

The Apply label always names its scope. There is no bare "Apply".

### Review (panel 2)
Derived view of everything `statusOf()` reports as Warning or Error. Each card
opens a diagnostic popover that names the reason from `warningReason()` —
aspect mismatch, with target vs current ratio, or safe-area overflow — and
carries its own **Auto-fix (crop / pad)** plus **Open in editor**. The heading
has **Re-run preset** and a batch **Auto-fix scaling (*n*)**.

Corrupt files stay Error; auto-fix cannot reach them. They stay in the export
queue and fail there, which is what fills the export error log — so Review is
the cheap place to deal with them first.

### Presets manager (panel 7)
The category list filters the preset rows. Row right-click gives Apply · Edit ·
Duplicate · Share · Delete; Edit and Delete are disabled for built-in rows.
**Add new custom preset** and Duplicate both open the preset editor (name,
dimensions, safe area, background), which writes into app state — so a new
preset appears immediately in the inspector dropdown and in Settings.

### Export
Rail or status-bar Export → options overlay (format, quality — disabled for
PNG, colour profile, keep-filename, suffix, output folder). The file list
previews the real output names via `outputName()`, and the size estimate
follows the chosen format and quality.

**Export *n* images** → progress overlay (panel 5): **Pause export** /
**Cancel export**, a streaming list of written files, and the failures behind
**VIEW ERROR LOG**.

### Settings (panel 12)
Three panes: General · section list · section detail. General's default preset,
auto-crop and theme are real state; **theme** writes `data-theme` on the
document root, and the stylesheet's chrome tokens carry both palettes, so Light
and Dark actually re-skin the app. The detail pane renders the selected
section — GPU acceleration (hardware switch, GPU priority, thread count, RAM
allocation), keyboard shortcuts, or default export paths.

## 3a. The lane fork

An import does not pick a lane. `ImportForkDialog` reports what arrived —
image count, folder count, whether there are subfolders, total size — and asks:

| Choice | Goes to | What it is for |
|---|---|---|
| **Batch resize** | `screen = batch` | one target for every file, resized in the browser and downloaded as a zip. Suggested when more than one image arrived |
| **Open the editor** | `screen = editor`, first file active | per-image placement, safe area, review, export. Suggested for a single image |

Dismissing the dialog is the same as choosing the editor. The two lanes are
different jobs, and guessing wrong costs the most on the largest drops, so the
choice is explicit rather than a default plus an undo.

## 3b. Batch resize — a separate pipeline

`src/batch.ts` shares nothing with the editor: not `Doc`, not the preset table,
not the selection. It works on `BatchSource` records that keep the real `File`,
because it re-encodes pixels rather than describing a layout.

| Step | Control | Wiring |
|---|---|---|
| 01 Target frame | width × height, ratio chips, Fit/Fill/Stretch cards, frame background | `drawRect()` decides where each source lands: Fit contains, Fill covers, Stretch distorts |
| 02 Preview | the first three files in the chosen frame | CSS `object-fit: contain / cover / fill`, which is the same contain/cover/fill the canvas draw uses, so the preview cannot drift from the result |
| 03 Output | PNG/JPG/WEBP, quality (hidden for PNG), suffix, keep-subfolders | `planNames()` produces the path inside the zip and resolves the collisions flattening creates |
| Run | **Resize and download** | `runBatch()` draws each source into a canvas at the target size, encodes it, and collects entries; Cancel is polled between files |
| Download | automatic | `makeZip()` writes a store-only zip — PNG/JPG/WEBP are already compressed, so deflating again would only add a dependency — and the browser downloads `minima-<w>x<h>.zip` |

There is no destination folder: the browser downloads the zip. Nothing is
uploaded; every resize happens on the user's machine.

Failures are per file and never abort the run: unreadable sources are listed on
the done panel and the rest still download.

The batch screen hides the inspector and the editor's status-bar actions,
because a second set of Apply/Export controls would contradict its own.

## 4. Derived, never stored

Computed so two surfaces cannot disagree:

- **Status** — `statusOf()`: corrupt → Error, unprocessed → Pending,
  `warningReason()` → Warning, else Completed.
- **Warning reason** — `warningReason()`: aspect mismatch outranks safe-area
  overflow; `fixed` clears both.
- **Filter counts** — `countByStatus()`. **Gallery rows** — `filterAssets()`.
- **Apply / Export scope** — `scopeAssets()`.
- **The frame** — `resizeBox()` / `clampBox()` / `anchor()` / `snapBox()` and
  the `marginsOf()` ⇄ `boxFromMargins()` pair, all in percent of the canvas so
  zoom never changes the result.
- **Output filenames** — `outputName()` for export, `planNames()` for batch.
- **Back target** — `backTarget()`.
- **Batch draw rect** — `drawRect()`, shared by the preview and the canvas draw.

`npm run check` runs all of it: `tsc`, the `demo()` assertions in `flow.ts` and
`batch.ts` — including CRC32 against known values and the zip's own structure —
then server-renders every screen and overlay.
