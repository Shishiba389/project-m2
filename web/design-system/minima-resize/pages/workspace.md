# MINIMA Workspace — Page Override

This page follows the project-authored source of truth in `Engine/MINIMA_Resize_UI_UX_Discussion.md` and the nine mockups under `UI_UX_REFERENCE/`. These rules override the generic master design system wherever they differ.

The editor's geometry now follows `Engine/ui_ux_architecture_for_affine_2d_editor.md`. Where the two disagree, this file records what the code does.

## Product character

- Professional native-style image production utility, not a general design canvas.
- Dense, monochrome desktop chrome with a light editing canvas.
- Optimize the primary path: Import → Select → Resize/Position → Preset → Review → Export.
- Product imagery remains placeholder-only until real assets are supplied.
- One palette. There is no dark theme, and Tailwind's `dark:` variant is bound to a class nothing sets so component libraries cannot reintroduce one.

## Layout

- 44px top toolbar, 66px left navigation rail, fluid workspace, 274px inspector, 34px status bar.
- Gallery and Editor are persistent views; Editor shows one active image plus a filmstrip.
- The page is an **artboard inside a workspace**, not the container. Objects may sit outside it: they stay visible, selectable and draggable, and the area beyond the page is dimmed to mark what will not be exported.
- Rulers along the top and left edges read **output pixels**, with zero at the page's own corner. Negative readings are the workspace outside it.
- Inspector groups transform, layers, preset, canvas dimensions, Fit/Fill/Stretch, 3×3 alignment, safe area, scope, and apply state.
- Below 980px, prioritize the working surface; below 640px, move primary navigation to the bottom.

## Objects

- An **asset** is a reusable source file; a **placement** is one appearance of it on the canvas. The same file may be placed many times, each with its own geometry, crop and history.
- The **subject** is the asset open in the editor before anything has placed it. It is previewed on the canvas, pinned to the base of the stack, and is how a batch runs each import through the canvas as a template.
- Export writes one file per instance. Three placements of one image are three files, each showing its own copy with the other two hidden.
- Frames clip one image each. Deleting a frame keeps its image on the canvas as a free layer.

## Interaction

- Click, Ctrl/Cmd-click, Shift-click, and Ctrl/Cmd+A selection.
- Double-click opens Editor. Drag or arrow keys reposition the active object; Shift+Arrow nudges farther.
- **Space + drag** pans the workspace, middle-drag pans, scroll pans, Ctrl+scroll zooms about the pointer. **`\`** holds the before/after comparison.
- Shift+1 fits the page, Shift+2 zooms to the selection, Ctrl+Shift+F enters focus mode, Escape leaves it.
- Dragging on empty workspace sweeps a marquee: left-to-right takes objects wholly inside, right-to-left takes anything crossed. Ctrl+D duplicates a layer.
- Snapping is a constraint solver with hysteresis — a guide engages at 7px and releases at 12px — and the guides drawn are its result, never its input.
- Batch processing exposes progress and disables the apply action while running.

## Quality constraints

- Lucide SVG icons only; no emoji.
- Visible keyboard focus, explicit text/icon status, reduced-motion support. The only view-level animation is Fit / Zoom-to-selection, which jumps under `prefers-reduced-motion`.
- Every drag has a keyboard or single-pointer alternative, including layer reordering (Alt + arrows).
- Minimum 24×24 CSS-pixel web pointer targets, expanded to 44px on compact touch layouts.
- Geometry is owned by the document, never by the DOM: nothing may size `.canvas-scene`, whose measured box is the origin every pointer coordinate is derived from.
- The MINIMA resampler is bit-exact and guarded by checksums. Rotation and mirroring reach the file through a rigid canvas transform layered on top of it, never by resampling twice.
- No dependency on ChatGPT Sites, Vinext, Cloudflare, or a hosted runtime.
