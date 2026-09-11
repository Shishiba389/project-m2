# MINIMA V2 — EditorModeEngine Specification

## 1. Purpose

`EditorModeEngine` is the interactive and adaptive processing engine for MINIMA V2.

Unlike Batch Mode, Editor Mode is not designed as a blind one-click exact-size transformer.

Its purpose is to:

1. Let the user visually edit a reference image.
2. Capture the user's intent as reusable rules.
3. Apply those rules automatically to other images.
4. Validate the automatic results.
5. Flag weak images for review.
6. Allow the user to manually correct only the problematic images.
7. Export the entire reviewed batch using the shared Output Engine.

---

# 2. Core Product Idea

Editor Mode workflow:

```text
Import batch
    |
    v
Choose reference image
    |
    v
User edits image
    |
    v
Interpret user edit
    |
    v
Create Edit Recipe
    |
    v
Apply recipe to remaining images
    |
    v
Validate results
    |
    +------------------+
    |                  |
    v                  v
Completed         Needs Review
                       |
                       v
                 User correction
                       |
                       v
                     Export
```

---

# 3. Key Difference from Batch Mode

Batch Mode asks:

```text
"What output dimensions should every image become?"
```

Editor Mode asks:

```text
"How should the subject appear inside the output canvas?"
```

Editor Mode therefore requires:

- layout rules
- margin rules
- aspect ratio rules
- safe area
- subject occupancy
- relative positioning
- validation

---

# 4. Editor Mode Architecture

```text
Editor UI
   |
   v
Editor State
   |
   v
Layout Constraint Engine
   |
   v
Edit Recipe Engine
   |
   v
Auto Apply Engine
   |
   v
Per-Image Layout
   |
   v
Result Validator
   |
   +------------+
   |            |
   v            v
 PASS         REVIEW
   |            |
   v            v
Render       Manual Fix
   |
   v
Shared Output Engine
```

---

# 5. Major Components

```text
EditorModeEngine
|
+-- EditorState
+-- LayoutConstraintEngine
+-- EditRecipeEngine
+-- SubjectGeometryProvider
+-- AutoApplyEngine
+-- ResultValidator
+-- ReviewQueue
+-- RenderPlanner
```

---

# 6. Editor State

```ts
type EditorState = {
  imageId: string

  canvas: {
    width: number
    height: number
  }

  transform: {
    x: number
    y: number
    scale: number
    rotation: number
  }

  fitMode:
    | 'fit'
    | 'fill'
    | 'manual'

  alignment: {
    horizontal: 'left' | 'center' | 'right'
    vertical: 'top' | 'center' | 'bottom'
  }

  safeAreaVisible: boolean

  marginConstraint?: MarginConstraint | MarginRangeConstraint

  subjectOccupancy?: SubjectOccupancyConstraint

  background: string
}
```

Rotation can exist in editor state for future extensibility, but manual rotation should only be enabled if product requirements actually need it.

---

# 7. Layout Constraint Engine

The Layout Constraint Engine decides where the image/subject should appear inside the canvas.

It should support:

```text
canvas dimensions
canvas aspect ratio
fit
fill
manual
alignment
margin
margin range
safe area
subject occupancy
relative offset
clipping checks
```

---

# 8. Percentage Margin

Example:

```text
Canvas:
1500 × 1500

Margin:
10%
```

Calculate:

```text
left   = 150 px
right  = 150 px
top    = 150 px
bottom = 150 px
```

Valid layout area:

```text
1200 × 1200
```

---

# 9. Asymmetric Percentage Margin

Support:

```text
Top     10%
Right    8%
Bottom  12%
Left     8%
```

Do not assume all sides are equal.

---

# 10. Pixel Margin

Support:

```text
Top    100 px
Right  120 px
Bottom 100 px
Left   120 px
```

---

# 11. Margin Range

Retailer-style rule:

```text
5–10% margin
```

Model:

```ts
type MarginRangeConstraint = {
  unit: 'percent' | 'px'

  min: number
  preferred: number
  max: number

  mode: 'hard' | 'soft'
}
```

Example:

```text
min       = 5
preferred = 7.5
max       = 10
```

Auto-layout should aim at:

```text
preferred
```

Validation accepts:

```text
min <= actual <= max
```

---

# 12. Hard vs Soft Constraint

## Hard

The automatic layout must not violate the rule.

If it cannot satisfy all hard rules:

```text
NEEDS_REVIEW
```

## Soft

The engine may produce the best available result and attach:

```text
WARNING
```

Example:

```text
requested minimum margin = 5%
actual margin = 4.7%
```

---

# 13. Canvas Aspect Ratio

Support:

```text
1:1
9:13
4:5
3:4
custom
```

Aspect ratio can be:

```text
informational
```

or:

```text
locked
```

If dimensions are exact:

```text
1801 × 2600
```

that exact dimension takes priority.

---

# 14. Fit Mode

Fit preserves the entire image inside the target area.

Formula:

```text
scale =
  min(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight
  )
```

Result:

- no crop
- may leave empty canvas area

---

# 15. Fill Mode

Fill covers the target area.

Formula:

```text
scale =
  max(
    targetWidth / sourceWidth,
    targetHeight / sourceHeight
  )
```

Result:

- fills target area
- may crop overflow

Alignment decides which region is retained.

---

# 16. Manual Mode

Manual mode uses the user's transform directly.

It still records relative properties so the transform can be generalized.

Example current-image transform:

```text
x = 342 px
y = 190 px
scale = 0.74
```

Recipe interpretation might become:

```text
center horizontally
subject height = 76% canvas
vertical offset = -1.5%
```

---

# 17. Alignment

Support 9 positions:

```text
top-left
top-center
top-right

middle-left
center
middle-right

bottom-left
bottom-center
bottom-right
```

Alignment should be stored as semantic intent.

---

# 18. Relative Offset

After semantic alignment, user may make a small manual adjustment.

Store as percentage:

```ts
type RelativeOffset = {
  xPercent: number
  yPercent: number
}
```

Example:

```text
xPercent = +1.0%
yPercent = -2.5%
```

This is more reusable than absolute pixels.

---

# 19. Subject Occupancy

Editor Mode should support rules such as:

```text
Product height:
70–80% of canvas height
```

Model:

```ts
type SubjectOccupancyConstraint = {
  axis: 'width' | 'height' | 'both'

  min?: number
  preferred?: number
  max?: number
}
```

Normalized values:

```text
0.70 = 70%
0.75 = 75%
0.80 = 80%
```

---

# 20. Subject Geometry

For the strongest automatic behavior, Editor Mode should eventually distinguish:

```text
source image bounds
subject/product bounds
```

Possible subject geometry sources:

```text
transparent alpha bounds
background segmentation
edge-based detection
manual user-defined bounds
future AI segmentation
```

Initial implementation can start with:

```text
full image bounds
```

if no reliable subject detector exists.

Important:

Do not claim subject-aware margin compliance unless the engine actually knows subject bounds.

---

# 21. Progressive Subject Detection Strategy

Recommended maturity levels:

## Level 0
Use full image bounds.

## Level 1
Use alpha bounds for transparent-background product images.

## Level 2
Use deterministic foreground/background analysis.

## Level 3
Optional AI segmentation.

Build Editor Mode so `SubjectGeometryProvider` can be replaced without rewriting recipe logic.

---

# 22. Edit Recipe

The Edit Recipe is the reusable representation of user intent.

```ts
type EditRecipe = {
  version: number

  canvas: {
    width: number
    height: number
    aspectRatio?: [number, number]
  }

  fitMode: 'fit' | 'fill' | 'manual'

  alignment: {
    horizontal: 'left' | 'center' | 'right'
    vertical: 'top' | 'center' | 'bottom'
  }

  relativeOffset: {
    xPercent: number
    yPercent: number
  }

  margin?: MarginConstraint | MarginRangeConstraint

  subjectOccupancy?: SubjectOccupancyConstraint

  safeArea?: {
    unit: 'percent' | 'px'
    top: number
    right: number
    bottom: number
    left: number
  }

  background: string

  output: OutputConfig
}
```

---

# 23. Recipe Creation

The recipe can come from:

```text
preset rules
+
user interaction
```

Example initial preset:

```text
Canvas:
1500 × 1500

Margin:
5–10%

Preferred:
7%

Alignment:
center
```

User then drags the product slightly down.

Recipe becomes:

```text
Canvas:
1500 × 1500

Margin:
5–10%

Preferred:
7%

Alignment:
center

Vertical offset:
+1.8%
```

---

# 24. Recipe Generalization

Do not copy:

```text
x = 341
y = 221
width = 1040
height = 1280
```

Prefer:

```text
center-x
subject occupancy = 76%
vertical offset = +1.8%
```

Absolute layout values are still used when rendering the current image.

They are not the reusable rule.

---

# 25. Applying Recipe to Other Images

For each new image:

```text
1. Decode metadata
2. Determine subject bounds
3. Determine target canvas
4. Calculate preferred scale
5. Apply margin constraint
6. Apply occupancy constraint
7. Apply alignment
8. Apply relative offset
9. Resolve collisions/violations
10. Validate
11. Return layout + status
```

---

# 26. Constraint Priority

Recommended default priority:

```text
1. Hard canvas dimensions
2. Hard clipping prevention
3. Hard margin constraints
4. Hard safe-area constraints
5. Subject occupancy
6. Alignment
7. Relative offset
8. Soft aesthetic preferences
```

This priority should be configurable later if needed.

---

# 27. Constraint Solver Strategy

Editor Mode does not need a general mathematical solver initially.

A deterministic rule-based layout sequence is sufficient.

Example:

```text
Calculate maximum allowed subject rectangle
        |
        v
Choose scale
        |
        v
Apply alignment
        |
        v
Apply relative offset
        |
        v
Clamp against hard bounds
        |
        v
Validate final result
```

---

# 28. Auto Apply Engine

The Auto Apply Engine runs the recipe across a batch.

```text
Reference image
    |
Edit Recipe
    |
    +--> Image 2
    +--> Image 3
    +--> Image 4
    +--> ...
```

Each image receives an independent calculated layout.

Do not reuse one image's absolute scale or coordinates.

---

# 29. Auto Apply Result

```ts
type AutoApplyResult = {
  imageId: string

  layout: {
    x: number
    y: number
    width: number
    height: number
    scale: number
  }

  status:
    | 'completed'
    | 'warning'
    | 'needs_review'
    | 'error'

  warnings: ProcessingWarning[]
}
```

---

# 30. Validation

Validation runs after auto-layout.

Checks may include:

```text
margin
safe area
subject occupancy
clipping
canvas aspect ratio
source resolution
upscale amount
```

---

# 31. Margin Validation

Example:

```text
Allowed:
5–10%

Actual:
7.2%
```

Result:

```text
PASS
```

Actual:

```text
4.3%
```

Result:

```text
WARNING or NEEDS_REVIEW
```

depending on hard/soft rule.

---

# 32. Safe Area Validation

If subject bounds exceed safe area:

```text
SAFE_AREA_OVERFLOW
```

Possible actions:

```text
auto-scale down
warn
send to review
```

---

# 33. Occupancy Validation

Example:

```text
Required:
70–80%

Actual:
84%
```

Result:

```text
SUBJECT_OCCUPANCY_TOO_HIGH
```

---

# 34. Low Resolution Validation

If the user-requested display scale requires meaningful upscaling:

```text
UPSCALE_REQUIRED
```

Optional severity rules:

```text
< 110%:
info

110–150%:
warning

> 150%:
needs_review
```

Exact thresholds should be product-configurable.

---

# 35. Needs Review

Use `needs_review` when:

- hard rules conflict
- subject detection is uncertain
- clipping remains
- margin cannot be satisfied
- occupancy cannot be satisfied
- source resolution is inadequate
- auto-layout confidence is too low

---

# 36. Review Queue

Review Queue should support:

```text
Review Next
Review Previous
Accept
Adjust
Apply Fix to Similar Images
Skip
Remove
```

---

# 37. Manual Correction

When user manually corrects an automatically processed image:

```text
original recipe
+
manual override
```

should be stored.

Do not necessarily overwrite the global recipe immediately.

Provide separate actions:

```text
Save only for this image
```

and:

```text
Update recipe from this correction
```

---

# 38. Recipe Update from Manual Correction

If user chooses:

```text
Apply this correction to remaining images
```

then:

```text
1. infer recipe delta
2. update recipe
3. apply only to unreviewed images
4. do not silently overwrite already accepted images
```

---

# 39. Similar-Image Groups — Future

Later, Editor Mode can support multiple recipes within one batch.

Example:

```text
Tall bottles
→ Recipe A

Wide boxes
→ Recipe B

Square compacts
→ Recipe C
```

This is not required for the first version but the data model should allow:

```text
recipeId per image
```

---

# 40. Preview Rendering

Interactive preview should prioritize responsiveness.

Do not run full-resolution bicubic processing on every pointer move.

During drag:

```text
Konva / Canvas transform
```

On pointer release:

```text
update layout
```

High-quality final render happens when:

```text
Apply
Process
Export
```

---

# 41. Preview / Final Consistency

Preview and final render must use the same layout model.

Recommended:

```text
calculateLayout()
        |
   +----+----+
   |         |
   v         v
Preview    Final Render
```

This avoids:

```text
preview looks correct
but
export is positioned differently
```

---

# 42. Layout Result

```ts
type LayoutResult = {
  canvasWidth: number
  canvasHeight: number

  subjectBounds?: {
    x: number
    y: number
    width: number
    height: number
  }

  imageRect: {
    x: number
    y: number
    width: number
    height: number
  }

  cropRect?: {
    x: number
    y: number
    width: number
    height: number
  }

  warnings: ProcessingWarning[]
}
```

---

# 43. Final Rendering

Editor Mode should reuse the shared high-quality pixel processing core where practical.

Flow:

```text
LayoutResult
    |
    v
Prepare render geometry
    |
    v
High-quality resize core
    |
    v
Composite to final canvas
    |
    v
Shared Output Engine
```

---

# 44. Exact Render Order

Recommended:

```text
Decode
→ Auto Orient
→ Determine source / subject geometry
→ Calculate layout
→ High-quality resize
→ Composite onto output canvas
→ Background handling
→ Encode
```

---

# 45. Background

Support:

```text
transparent
white
black
custom color
```

Rules depend on format.

JPEG requires flattening.

PNG/WebP can preserve transparency where supported.

---

# 46. Shared Output Config

```ts
type OutputConfig = {
  format:
    | 'jpeg'
    | 'png'
    | 'webp'
    | 'tiff'

  quality?: number

  dpi?: {
    x: number
    y: number
  }

  fileSizeLimit?: {
    enabled: boolean
    maxBytes: number
  }

  background?: string

  filename?: {
    keepOriginal: boolean
    prefix?: string
    suffix?: string
  }
}
```

---

# 47. File Size Limit

Use shared Output Engine.

EditorModeEngine must not implement compression search directly.

Example:

```text
Render:
1500 × 1500

Target:
JPEG <= 500 KB
```

Output Engine searches for the highest suitable quality.

---

# 48. DPI

DPI belongs to output metadata.

Example:

```text
300 DPI
```

does not alter:

```text
1500 × 1500 px
```

---

# 49. Editor Processing States

```text
unprocessed
auto_applied
completed
warning
needs_review
manually_adjusted
accepted
error
```

---

# 50. Gallery Status Mapping

Recommended:

```text
Completed
Warning
Needs Review
Error
```

Internal states may be more detailed than visible UI labels.

---

# 51. Preset Integration

A retailer preset may define:

```text
canvas size
aspect ratio
margin
safe area
preferred occupancy
alignment
background
output format
quality
DPI
maximum file size
```

Example:

```text
Canvas:
1500 × 1500

Margin:
5–10%

Preferred:
7.5%

Alignment:
Center

Background:
White

Format:
JPEG

DPI:
300

Max size:
500 KB
```

---

# 52. Example Editor Workflow

```text
User imports 120 images
        |
        v
Selects preset
        |
        v
Opens first image
        |
        v
Adjusts product
        |
        v
Recipe created
        |
        v
Apply to remaining 119
        |
        v
Results:
103 Completed
11 Warning
5 Needs Review
1 Error
        |
        v
User reviews 16 images
        |
        v
Export all accepted images
```

---

# 53. Analytics Events

Useful Editor Mode events:

```text
editor_mode_started
reference_image_selected
recipe_created
recipe_updated
recipe_applied
margin_constraint_used
safe_area_used
auto_apply_completed
review_opened
manual_adjustment_saved
image_accepted
export_completed
```

Do not send actual image content.

---

# 54. Performance

Editor Mode auto-apply should use a worker pool.

However, interactive editor UI remains on main thread.

Architecture:

```text
Main Thread
|
+-- Konva UI
+-- editor controls
+-- recipe state

Workers
|
+-- subject geometry
+-- layout batch calculations
+-- final rendering
+-- encoding
```

---

# 55. Versioning

Version recipes:

```text
recipe_version = 1
```

Version editor engine:

```text
editor_engine_version = 1
```

This allows future changes without invalidating older saved projects.

---

# 56. Testing

Test:

```text
square source
portrait source
landscape source
transparent product
white-background product
wide product
tall product
small subject
large subject
margin 5%
margin 10%
margin range 5–10%
safe area
fit
fill
manual adjustment
low resolution
extreme aspect ratio
```

---

# 57. Validation Tests

For each fixture verify:

```text
actual margin
actual occupancy
alignment
clipping
safe area
warning status
review status
```

---

# 58. Editor Mode Definition of Done

EditorModeEngine is complete when:

- User can drag and scale a reference image.
- User can use Fit / Fill / Manual.
- Percentage and pixel margins work.
- Margin ranges work.
- Aspect ratio constraints work.
- Subject occupancy rules work.
- Safe area works.
- User edit becomes a reusable Edit Recipe.
- Recipe auto-applies to remaining images.
- Results are independently calculated per image.
- Invalid/weak results are flagged.
- Review Queue works.
- Manual correction works.
- User can update recipe from a correction.
- Final rendering uses the shared high-quality resize core.
- Shared Output Engine supports format, quality, DPI, and max file size.
