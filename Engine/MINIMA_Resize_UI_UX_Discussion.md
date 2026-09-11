# MINIMA Resize — UI/UX Discussion Notes

## 1. Product Direction

The app should not be designed as **“Canva with fewer features.”**

It should be designed as:

> **A native image production workspace focused on one task: resizing images efficiently and consistently.**

The interaction model can feel familiar to Canva, especially around canvas handling, zooming, selection, and visual editing, but every workflow should be optimized for **throughput**, **batch work**, and **precise image resizing**.

Primary workflow:

**Import → Select image(s) → Resize / Position → Apply preset → Review batch → Export**

---

# 2. Core Layout

Recommended desktop structure:

```text
┌─────────────────────────────────────────────────────────────┐
│ Top Bar                                                     │
├──────────┬───────────────────────────────────────┬──────────┤
│          │                                       │          │
│ Sidebar  │                Canvas                 │ Property │
│          │                                       │  Panel   │
│          │                                       │          │
│          │                                       │          │
├──────────┴───────────────────────────────────────┴──────────┤
│ Status / Zoom / Image navigation                            │
└─────────────────────────────────────────────────────────────┘
```

The app should preserve the strengths of Canva's editor composition:

- Large central canvas
- Light gray workspace background
- Clear focus on the active image
- Contextual controls
- Zoom controls
- Quick navigation
- Multi-image workflows

But unnecessary Canva concepts should be removed.

---

# 3. Left Sidebar

Canva's general-purpose sidebar is too broad for a resize application.

Instead of:

- Templates
- Elements
- Text
- Brand
- Uploads
- Projects
- Apps

Use a simplified navigation structure:

```text
┌──────┐
│  ⊕   │ Import
│      │
│  ▣   │ Images
│      │
│  ⛶   │ Presets
│      │
│  ⇩   │ Export
│      │
│  ⚙   │ Settings
└──────┘
```

Recommended default panel: **Images**

Example:

```text
Images
────────────────────

[ + Add images ]

▣ 8809968136217_1
  1800 × 2600

▣ 8809968136217_2
  1800 × 2600

▣ 8809968136217_3
  1600 × 2000

▣ 8809968136217_4
  2000 × 2000

────────────────────
12 images selected
```

---

# 4. Editor View

The app should normally display **one active image at a time**.

Avoid Canva's long multi-page document model.

Instead of:

```text
Page 5
[ image ]

Page 6
[ image ]
```

Use:

```text
              5 / 177

        ┌───────────────┐
        │               │
        │     IMAGE     │
        │               │
        └───────────────┘
```

Navigation:

```text
←    5 / 177    →
```

Users can also switch images using thumbnails.

The mental model should be **files/images**, not document pages.

---

# 5. Right Resize Inspector

The right-side inspector should be the most important control area.

Recommended width:

**280–320 px**

Example:

```text
Resize
──────────────────────

Preset
[ Zalando 9:13        ▼ ]

Width        Height
[ 1801 ]  ×  [ 2600 ]

☑ Lock aspect ratio


Fit
┌────────┬────────┬────────┐
│  Fit   │  Fill  │ Stretch│
└────────┴────────┴────────┘


Position
┌─────────────────────┐
│ ↖  ↑  ↗             │
│ ←  ●  →             │
│ ↙  ↓  ↘             │
└─────────────────────┘


Padding
Top      [ 10 % ]
Bottom   [ 10 % ]
Left     [ 16.66 % ]
Right    [ 16.66 % ]


Background
[ #F6F6F6 ]


──────────────────────
[ Apply to selected ]
```

---

# 6. Separate Canvas Size and Image Size

The UI should clearly distinguish between:

## Canvas Size

Example:

```text
1801 × 2600
```

## Image Size

Example:

```text
Scale
[ 84% ]

Actual image
1512 × 2184
```

These are separate concepts and should never be visually mixed.

This is particularly useful for marketplace image specifications where the output canvas is fixed but the product must sit within controlled margins.

---

# 7. Preset System

Presets should be a first-class feature.

Suggested structure:

```text
Presets

Marketplace
────────────────────
Zalando
Douglas
Amazon
Shopee
Lazada

Social
────────────────────
Instagram Square
Instagram Portrait
Facebook
TikTok

Custom
────────────────────
Product Master
BOJ Catalog
Douglas PL
```

Example preset:

```text
Zalando Product

Canvas
1801 × 2600

Ratio
9 : 13

Background
#F6F6F6

Horizontal safe margin
16.66%

Vertical safe margin
10%

Object alignment
Center
```

A preset should apply all relevant resize rules in one action.

---

# 8. Top Toolbar

The top toolbar should remain compact.

Suggested actions:

```text
← Back

8809968136217_2.png

Undo   Redo

[ Fit ] [ Fill ] [ 1:1 ]

↺ Rotate
↔ Flip

──────────────

100%    ⛶
```

Less frequently used actions should be placed inside:

```text
•••
```

Avoid large numbers of always-visible icons.

---

# 9. Native Desktop Behavior

The app should feel like a native desktop application rather than a browser editor.

Recommended:

- Native title bar behavior
- Windows snap layout support
- Native window controls
- Drag-enabled title bar
- Dark/light system theme
- Keyboard focus states
- Fast window resizing
- High-DPI scaling
- Native drag and drop
- Background processing

Possible title bar:

```text
┌──────────────────────────────────────────────────────────┐
│ MINIMA Resize       project-name                    — □ × │
├──────────────────────────────────────────────────────────┤
```

---

# 10. Collapsible Panels

Both the left sidebar and right inspector should be collapsible.

Normal layout:

```text
| Sidebar 240 | Canvas | Inspector 300 |
```

Focus mode:

```text
|             Canvas                  |
```

Possible shortcut:

```text
Ctrl + Shift + F
```

---

# 11. Bottom Status Bar

Do not replicate Canva's Notes / Timer area.

Use a functional native status bar:

```text
1920 × 1080 px     RGB     PNG     2.4 MB

                 −   75%   +     Fit
```

For multi-selection:

```text
12 images selected       Estimated output: 34.8 MB
```

During processing:

```text
Processing 18 / 177       █████████░░░ 62%
```

---

# 12. Multi-Image Workflow

The app should support batch image workflows efficiently.

Recommended optional **filmstrip mode**:

```text
                   CANVAS

              ┌────────────┐
              │            │
              │   Image    │
              │            │
              └────────────┘


─────────────────────────────────────────────
[img1] [img2] [img3] [img4] [img5] [img6]
─────────────────────────────────────────────
```

Selection should support:

- Single click
- Ctrl + Click
- Shift + Click
- Ctrl + A
- Drag selection where appropriate

---

# 13. Batch Operation Scope

Every batch-changing action should clearly show its scope.

Example:

```text
Apply resize to

● Current image
○ Selected images (12)
○ All images (177)
```

Buttons should reflect the action scope.

Preferred:

```text
Apply to 12 images
```

Instead of:

```text
Apply
```

This reduces accidental bulk changes.

---

# 14. Original / Preview Comparison

Useful options:

```text
Original | Preview
```

or:

```text
Hold SPACE → Original
```

Example:

```text
Before                    After

┌───────────┐          ┌───────────┐
│           │          │           │
│ product   │    →     │  product  │
│           │          │           │
└───────────┘          └───────────┘
```

---

# 15. Object Manipulation

Keep direct manipulation simple.

When an image is selected:

```text
        ┌───────────────┐
        │               │
        │    PRODUCT    │
        │               │
        └───────────────┘
```

Support:

- Drag
- Resize handles
- Mouse wheel zoom
- Arrow-key nudging
- Shift + Arrow = larger nudge
- Center snapping
- Safe-area snapping
- Alignment guides

Avoid full Canva-style object editing complexity.

---

# 16. Safe Area as a First-Class Feature

Safe areas should be visible and editable.

Example:

```text
Canvas
┌──────────────────────────┐
│    · · · · · · · · ·     │
│    ·                ·     │
│    ·                ·     │
│    ·    PRODUCT     ·     │
│    ·                ·     │
│    ·                ·     │
│    · · · · · · · · ·     │
└──────────────────────────┘
```

Controls:

```text
Safe Area

Horizontal
[ 16.66 % ]

Vertical
[ 10 % ]

☑ Show guides
☑ Snap object to safe area
```

---

# 17. Export Flow

Export should be a dedicated workflow rather than a small popup.

Example:

```text
Export 177 images
──────────────────────────

Format
[ PNG ▼ ]

Quality
[ 100 ]

Color profile
[ sRGB ]

Naming
Original name
☑ Keep original filename

Suffix
[ _resized ]

Output
C:\Products\Zalando\

──────────────────────────

177 files
Estimated size: 420 MB

[ Cancel ]       [ Export ]
```

Processing state:

```text
Exporting

108 / 177

████████████████░░░░ 61%

8809968136217_2.png

[ Run in background ]
```

---

# 18. Drag & Drop as Main Entry Point

Empty state:

```text
             MINIMA Resize

        ┌──────────────────────┐
        │                      │
        │    Drop images here  │
        │                      │
        │     or Browse        │
        │                      │
        └──────────────────────┘

             PNG JPG WEBP
```

The app should support:

- Individual image files
- Multiple image files
- Folders
- Large batches

---

# 19. Editor View ↔ Gallery View

The app should have two primary visual modes:

**Editor View** ↔ **Gallery View**

A persistent view switch should be placed near the bottom-right area, similar to Canva's view switch.

Example:

```text
[ ▦ ] [ ⛶ ]
```

or:

```text
[ Grid ] [ Editor ]
```

Recommended implementation:

```text
┌─────────────────┐
│ ▦ Grid │ ◫ Edit │
└─────────────────┘
```

This segmented control makes the active mode obvious.

---

# 20. Gallery View

Gallery View should show all imported / edited images in a batch.

Example:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ MINIMA Resize                     Project Name                  — □ × │
├──────────────────────────────────────────────────────────────────────┤
│ 177 images     143 completed     12 pending         Search...        │
│                                                                      │
│ [All] [Completed] [Pending] [Errors]                  Sort: Name ▼    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│ │          │ │          │ │          │ │          │ │          │    │
│ │   img    │ │   img    │ │   img    │ │   img    │ │   img    │    │
│ │          │ │          │ │          │ │          │ │          │    │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │
│ 88099...01   88099...02   88099...03   88099...04   88099...05      │
│ 1801×2600    1801×2600    1801×2600    1801×2600    1801×2600       │
│      ✓            ✓           ●            ✓           ⚠             │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ 12 selected                                     [▦ Gallery] [Editor] │
└──────────────────────────────────────────────────────────────────────┘
```

Gallery should not only be for viewing; it should be a **batch management workspace**.

---

# 21. Gallery Status Indicators

Each thumbnail should display an image status.

Suggested statuses:

```text
✓  Completed
●  Modified but not exported
○  Untouched
⚠  Warning
✕  Error
```

Example:

```text
┌─────────────────────┐
│                  ✓  │
│                     │
│       IMAGE         │
│                     │
└─────────────────────┘
8809968136217_2
1801 × 2600
```

---

# 22. Gallery Navigation Behavior

Recommended interaction:

- Single click → select image
- Ctrl + Click → add/remove from selection
- Shift + Click → range selection
- Enter → open selected image
- Double click → open directly in Editor View

When opening an image:

```text
Editor View
Image 3 / 177
```

The transition should happen within the same window.

---

# 23. Multi-Select Actions in Gallery

When multiple images are selected, show a contextual batch toolbar.

Example:

```text
12 selected

[Apply preset] [Background] [Resize] [Export] [•••]
```

This should make Gallery useful for fast bulk workflows.

---

# 24. Gallery Thumbnail Size

Allow users to change grid density.

Possible control:

```text
− ─────●───── +
```

or:

```text
Small | Medium | Large
```

Suggested behavior:

- Small → 10–12 thumbnails per row
- Medium → 6–8 thumbnails per row
- Large → 4–5 thumbnails per row

---

# 25. Gallery Density Modes

Optional modes:

```text
Normal
Compact
Large preview
```

Compact mode:

```text
[img][img][img][img][img][img][img][img]
[img][img][img][img][img][img][img][img]
[img][img][img][img][img][img][img][img]
```

Useful for quickly detecting:

- Misaligned products
- Incorrect scale
- Wrong background
- Incorrect aspect ratio
- Outlier images

---

# 26. Visual Consistency Checking

Gallery could support overlay aids:

```text
View
✓ Safe area
✓ Center guides
✓ Bounding boxes
```

Example:

```text
┌──────────────────┐
│    ┊             │
│ ┈┈┈┼┈┈┈          │
│    │ PRODUCT     │
│    ┊             │
└──────────────────┘
```

This makes it easier to inspect consistency across an entire batch.

---

# 27. Gallery Filters

Suggested header:

```text
All images                                      177

[ All 177 ] [ Modified 143 ] [ Pending 30 ] [ Error 4 ]

Search filename...

Sort
[ File name ▼ ]

Filter
[ Preset ▼ ]
```

Possible preset conformity status:

```text
Preset: Zalando 9:13
143 / 177 conform
34 need review
```

---

# 28. Thumbnail Hover Actions

When hovering over an image:

```text
┌────────────────────┐
│              ⋯     │
│                    │
│       IMAGE        │
│                    │
│    [ Edit ]        │
└────────────────────┘
```

Overflow menu:

```text
Open
Reset
Duplicate
Export
Reveal in folder
Remove
```

These controls should remain hidden until hover to avoid visual clutter.

---

# 29. Image Numbering

Avoid showing Canva-style combined labels such as:

```text
1 - filename
2 - filename
```

Instead:

```text
8809968136477
```

and keep position separately:

```text
1 / 177
```

This keeps the interface cleaner.

---

# 30. Overall UX Architecture

The app can be organized around three primary modes:

## Editor

Precise manipulation of one image.

## Gallery

Review, compare, select, filter, and batch-edit multiple images.

## Export

Generate final output files.

Workflow:

```text
                 PROJECT

                    │
                    ▼

              Editor View
         ┌───────────────────┐
         │                   │
         │   resize image    │
         │                   │
         └───────────────────┘
                │       ▲
                │       │
          Grid button   Double click
                │       │
                ▼       │

              Gallery View
 ┌─────┬─────┬─────┬─────┬─────┐
 │ img │ img │ img │ img │ img │
 ├─────┼─────┼─────┼─────┼─────┤
 │ img │ img │ img │ img │ img │
 └─────┴─────┴─────┴─────┴─────┘

                │
                ▼

          Batch Selection

                │
                ▼

              Export
```

---

# 31. Main Design Principle

The app should optimize for:

- Fewer clicks
- Fast image switching
- Clear batch scope
- Strong preset workflows
- Consistent output
- Native desktop speed
- Easy inspection of large batches
- Minimal context switching

Canva is optimized for **creation**.

MINIMA Resize should be optimized for **production throughput and consistency**.
