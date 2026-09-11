# MINIMA Resize — Workflow & Button Wiring

Single source of truth for navigation. Implemented in `src/flow.ts` (logic) and
`src/App.tsx` (surfaces). Any button not listed here does not exist.

## 1. The one primary path

```
Import → Select → Resize / Position → Apply preset → Review → Export
```

Every screen below exists only to serve one step of that path. Nothing in the
app is reachable by two different mental models.

## 2. State model

There is exactly **one** navigation state, `screen`. The old dual
`section` + `view` model is gone — it was the source of every dead end.

| `screen` | Step served | Entry | Exit |
|---|---|---|---|
| `import` | Import | rail **Import**; automatic when `assets.length === 0` | any import adds assets → `gallery` |
| `gallery` | Select, Review batch | rail **Images**; Back from editor/review; view switch **Gallery** | — (the hub) |
| `editor` | Resize / Position | double-click a card; **Enter** on a card; view switch **Editor** | Back → `gallery` |
| `review` | Review | **Review n** in the gallery toolbar; needs-attention count in the status bar | Back → `gallery` |
| `presets` | Apply preset | rail **Presets** | Back → `gallery` / `import` |
| `settings` | — | rail **Settings** | Back → `gallery` / `import` |

Back is one rule for all screens: `backTarget()` in `flow.ts`. It goes up one
level and is hidden on `import` (the root).

**Overlays** stack over any screen and never change `screen`:
`exportOpen`, `exporting`, `shortcutsOpen`, `removeOpen`.
Import has no overlay — Add files / Add folders / duplicate policy sit inline on
the `import` screen, as in the reference frame.

**Modifiers** change chrome, not location:

| Modifier | Effect | Toggle |
|---|---|---|
| `compare` | Editor canvas splits Original \| Resized | hold **Space**, or status-bar **Compare** (sticky) |
| `focus` | Hides rail, inspector, status bar; editor only | **Ctrl+Shift+F**, **Esc** to exit |
| `railOpen` / `inspectorOpen` | Collapses a panel | top-bar panel toggles |

Entering `compare` or `focus` from a non-editor screen switches to `editor`
first, so a modifier is never active on a screen that cannot show it.

## 3. Button wiring

### Left rail — the only screen navigator
| Button | Target | Disabled when |
|---|---|---|
| Import | `screen = import` | never |
| Images | `screen = lastImageScreen` (`gallery` or `editor`) | no assets |
| Presets | `screen = presets` | never |
| Export | opens `exportOpen`, screen unchanged | nothing processed yet |
| Settings | `screen = settings` | never |

Export appears **once**, in the rail. The status bar's Export is the same
overlay, not a second flow.

### Top bar
| Control | Wiring |
|---|---|
| Panel toggle | `railOpen` |
| Back | `backTarget(screen)`; hidden on `import` |
| Undo / Redo | history of the *document* snapshot (preset, dimensions, fit, align, safe area, object box) — never of navigation |
| Document name | active file on `editor`; screen title elsewhere |
| Zoom − / % / + | `editor`: canvas zoom. `gallery`: thumbnail density (§24). Disabled elsewhere |
| Inspector toggle | `inspectorOpen` |
| Help | `shortcutsOpen` |

### Gallery
| Control | Wiring |
|---|---|
| Filter tabs All/Completed/Pending/Warning/Error | filters the grid; counts derived by `countByStatus()` |
| Search | filename substring |
| Sort | name / date / size |
| Review *n* | `screen = review`; hidden when nothing needs attention |
| Remove | `removeOpen` → Remove selected / unselected → confirm |
| Card click / Ctrl-click / Shift-click / Ctrl+A | select / toggle / range / all |
| Card double-click, Enter | `screen = editor`, that asset active |

### Inspector — the resize step
| Control | Wiring |
|---|---|
| Preset | applies the whole preset row: dimensions, safe area, fit, align, background |
| Width × Height | free typing; aspect lock re-derives the other from the ratio captured when the lock engaged |
| Aspect ratio lock | captures the current ratio |
| Fit / Fill / Stretch | re-sizes the object box via `fitBox()` |
| 3×3 alignment | places the object via `anchor()` inside the safe area |
| Safe area Top / Left | live overlay on the canvas; re-runs fit/align |
| Scope: Current / Selected *n* / All *n* | sets which assets Apply writes to (§13) |
| **Apply to *n* images** | marks the scope processed → statuses recompute → Export unlocks. Disabled while processing |

The Apply label always names its scope. There is no bare "Apply".

### Editor canvas
Drag or arrow keys move the object (Shift = ×10), snapping to the safe-area
edges and the centre lines. Filmstrip switches the active asset and keeps the
selection intact.

### Review
Derived view of everything `statusOf()` reports as Warning or Error.
**Auto-fix (crop/pad)** sets `fixed` on the warned assets, which clears the
warning everywhere at once. Corrupt files stay Error — auto-fix cannot reach
them. They stay in the export queue and fail there, which is what fills the
export error log, so Review is the cheap place to deal with them first.

### Export
Rail Export or status-bar Export → overlay (format, quality, colour profile,
naming, output folder, estimated size) → **Export *n* images** → progress
overlay with Pause / Cancel and a per-file error log.

## 4. Derived, never stored

These are computed so two surfaces cannot disagree:

- **Status** — `statusOf(asset, preset)`: corrupt → Error, unprocessed →
  Pending, aspect mismatch vs the active preset → Warning, else Completed.
- **Filter counts** — `countByStatus()`.
- **Apply / Export scope** — `scopeAssets()`.
- **Object box** — `fitBox()` / `anchor()` / `snapBox()`, in percent of the
  canvas so zoom never changes the result.
- **Back target** — `backTarget()`.

Checks for all of the above live in `demo()` at the bottom of `flow.ts`:
`npx tsx src/flow.ts`.
