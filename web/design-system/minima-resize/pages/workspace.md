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
- The editor's contextual toolbar floats over the top of the canvas. Fit (Shift+1) and zoom-to-selection (Shift+2) centre the page in the area *below* it, so the toolbar never covers the page edge or the rotate handle.
- Toolbar groups, left to right: mode (Edit image, Crop, Add frame, Canvas) | Fit · Fill · Stretch | adjustment icons (scale, rotate, flip, more). Icon buttons always carry a tooltip and an accessible name. Below 1320px the image count and the Import label drop out so every tool stays in view.
- Gallery and Editor are persistent views; Editor shows one active image plus a filmstrip.
- The page is an **artboard inside a workspace**, not the container. Objects may sit outside it: they stay visible, selectable and draggable, and the area beyond the page is dimmed to mark what will not be exported.
- Rulers along the top and left edges read **output pixels**, with zero at the page's own corner. Negative readings are the workspace outside it.
- Inspector order: the selected image (product line, X/Y/W/H/angle) → Fit to page → Align on page → Layers → Page (preset, size, ratio lock, safe area, guides and background). Away from the canvas (Gallery, Review) the fit and alignment move into Page and set the rule for every image not edited by hand.
- The apply panel is pinned at the inspector's foot and stays compact: "Apply <image>'s edit to", a Selected · All segmented scope, a one-line summary of what travels (folded options behind "Change"), and the one primary button.
- Below 980px the inspector is a panel that slides over the canvas from the top bar's inspector button and starts closed; on a phone it takes the full width above the bottom navigation.
- Below 980px, prioritize the working surface; below 640px, move primary navigation to the bottom.

## Objects

- An **asset** is a reusable source file; a **placement** is one appearance of it on the canvas. The same file may be placed many times, each with its own geometry, crop and history.
- The **subject** is the asset open in the editor before anything has placed it. It is previewed on the canvas, pinned to the base of the stack, and is how a batch runs each import through the canvas as a template.
- Export writes one file per instance. Three placements of one image are three files, each showing its own copy with the other two hidden.
- Frames clip one image each. Deleting a frame keeps its image on the canvas as a free layer.

## Geometry

- An image element's box **is the visible picture**: its pixel aspect is the cropped source's aspect unless the ratio is unlocked. Selection, handles, snapping and the inspector numbers all describe what the user sees.
- Fit, Fill and Stretch are **commands** that lay the selected image out against the whole page (the white canvas): Fit contains it, Fill covers it, Stretch matches the page exactly. Rotation resets; crop and mirrors are kept. One undo step.
- An image nobody has placed by hand has no stored box (`element: null`) and follows the page's fit and alignment, so a preset change re-lays it out. The first hand edit stores a box.
- A change of page size carries every stored box onto the new page, keeping each picture's proportions.
- Cropping moves the box with the crop window, so nothing on the page shifts.

## Product detection

- At import each image's product bounds are found on a ≤1024px copy: by transparency, or against a plain background read from the picture's border, with a threshold that follows the background's own noise (4 on a clean render, up to 26 on a noisy photo). A busy picture reports no product, and the whole picture is measured.
- The selected image shows its product as a green dashed outline; the inspector line carries the same dashed swatch.

## Edit one, apply to all

- The image open in the editor is the reference. Its edit is read back as rules: the product's share of the safe area, the edge it is aligned to, the offset left over, rotation and mirror, and the crop only when asked. Each other image gets its own layout from those rules, measured on its own product.
- Images adjusted by hand are skipped unless "Also change images adjusted by hand" is ticked. A run is one undo step for every image, status included.
- Review flags what the export would do badly: a picture enlarged past its own pixels (over 110% warns, over 150% needs review) or a product cut off by the page. Fix is real: fit to page, or shrink to 100%.

## Interaction

- Click, Ctrl/Cmd-click, Shift-click, and Ctrl/Cmd+A selection.
- Double-click opens Editor. Drag or arrow keys reposition the active object; Shift+Arrow nudges farther.
- **Space + drag** pans the workspace, middle-drag pans, scroll pans, Ctrl+scroll zooms about the pointer. **`\`** holds the before/after comparison.
- Shift+1 fits the page, Shift+2 zooms to the selection, Ctrl+Shift+F enters focus mode, Escape leaves it.
- Dragging on empty workspace sweeps a marquee: left-to-right takes objects wholly inside, right-to-left takes anything crossed. Ctrl+D duplicates a layer.
- Snapping is a constraint solver with hysteresis — a guide engages at 7px and releases at 12px — and the guides drawn are its result, never its input.
- On a picture with its ratio locked, corners scale and **edges crop** (content stays put); Shift on an edge stretches instead; Alt resizes about the centre; Shift on the rotate handle snaps to 15°.
- Double-click an image (or Crop) for crop mode: the whole source shows faded around a fixed window; drag to slide the picture under it, its corners scale it, the window's handles resize the crop. Enter finishes, Esc cancels.
- A readout next to the pointer shows position, size or angle while a gesture runs.
- Batch processing exposes progress and disables the apply action while running.

## Quality constraints

- Lucide SVG icons only; no emoji, no ✕ characters.
- Text floor: labels 12px, secondary 11px, nothing smaller. Status pills are pale tints with dark text of the same hue (completed #dcfae5/#04250e, warning #fffbeb/#92400e with a #fde68a edge, error #ffedea/#831c1e).
- One selection colour (`--frame-line`, orange) for selection, crop window and frame outlines; the product outline is the only green. No violet, no decorative gradients (the checkerboard and the thirds grid are functional and marked `taste-skill-ignore`).
- Visible keyboard focus, explicit text/icon status, reduced-motion support. The only view-level animation is Fit / Zoom-to-selection, which jumps under `prefers-reduced-motion`.
- Every drag has a keyboard or single-pointer alternative, including layer reordering (Alt + arrows).
- Minimum 24×24 CSS-pixel web pointer targets, expanded to 44px on compact touch layouts.
- Geometry is owned by the document, never by the DOM: nothing may size `.canvas-scene`, whose measured box is the origin every pointer coordinate is derived from.
- The MINIMA resampler is bit-exact and guarded by checksums. Rotation and mirroring reach the file through a rigid transform layered on top of it (`transformRgba`: Catmull-Rom in linear light with anti-ringing; quarter turns and mirrors move whole pixels), never by resampling twice. A canvas filtered turns in gamma space and darkened fine detail (0.31 of the light kept, against 0.5).
- The resampler streams a few rows at a time and can compute any window of its output with the pixels the whole resize would have there. Export renders only the part of each picture that reaches the page, so a zoomed-in image costs the page, not the enlargement; template layers are resampled once per export run.
- Export and Batch render in web workers, so the editor never freezes while files are written; Cancel stops the file in progress. Without OffscreenCanvas the same code runs on the main thread and writes the same bytes.
- Transparency is exact. Pages are composited in software in unpremultiplied 8-bit, and PNG is read (when it has transparency and no colour profile, gamma or orientation for the browser to apply) and written by png.ts, never through a canvas, which premultiplies and rounds partly transparent pixels away. Display P3 PNG is converted in software and tagged with the browser's own P3 profile. A canvas is left only for decoding non-PNG sources and encoding JPG and WebP.
- Upright frames clip hard-edged, a pixel in when its centre is (the canvas rule). Turned frames clip with anti-aliased edges (4×4 coverage), as the editor view draws them, instead of a canvas's staircase.
- Resampling is a choice in Export and Batch: **MINIMA classic** (the default, desktop parity) or **High quality** (opt-in; Catmull–Rom widened by the reduction factor plus anti-ringing: about 3–4× less moiré past the new resolution and no edge halos, roughly twice as slow, different pixels from desktop).
- No dependency on ChatGPT Sites, Vinext, Cloudflare, or a hosted runtime.
