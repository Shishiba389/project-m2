# MINIMA Workspace — Page Override

This page follows the project-authored source of truth in `Engine/MINIMA_Resize_UI_UX_Discussion.md` and the nine mockups under `UI_UX_REFERENCE/`. These rules override the generic master design system wherever they differ.

## Product character

- Professional native-style image production utility, not a general design canvas.
- Dense, monochrome desktop chrome with a light editing canvas.
- Optimize the primary path: Import → Select → Resize/Position → Preset → Review → Export.
- Product imagery remains placeholder-only until real assets are supplied.

## Layout

- 44px top toolbar, 66px left navigation rail, fluid workspace, 274px inspector, 34px status bar.
- Gallery and Editor are persistent views; Editor shows one active image plus a filmstrip.
- Inspector groups preset, canvas dimensions, Fit/Fill/Stretch, 3×3 alignment, safe area, scope, and apply state.
- Below 980px, prioritize the working surface; below 640px, move primary navigation to the bottom.

## Interaction

- Click, Ctrl/Cmd-click, Shift-click, and Ctrl/Cmd+A selection.
- Double-click opens Editor. Drag or arrow keys reposition the active object; Shift+Arrow nudges farther.
- Hold Space for comparison, Ctrl+Shift+F for focus mode, Escape to exit focus mode.
- Batch processing exposes progress and disables the apply action while running.

## Quality constraints

- Lucide SVG icons only; no emoji.
- Visible keyboard focus, explicit text/icon status, reduced-motion support.
- Minimum 24×24 CSS-pixel web pointer targets, expanded to 44px on compact touch layouts.
- No dependency on ChatGPT Sites, Vinext, Cloudflare, or a hosted runtime.
