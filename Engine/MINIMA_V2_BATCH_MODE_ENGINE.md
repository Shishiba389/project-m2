# MINIMA V2 — BatchModeEngine Specification

## 1. Purpose

`BatchModeEngine` is the web application's one-click high-volume processing engine.

Its purpose is to preserve the existing MINIMA batch-processing behavior as closely as practical while adapting execution to a browser/web-worker environment.

This engine is based on the current MINIMA desktop algorithm described in `MINIMA_IMAGE_PROCESSING_ALGORITHM.md`.

---

# 2. Primary Goals

BatchModeEngine should:

- Process a large folder/batch with minimal user intervention.
- Preserve exact-size output behavior.
- Preserve the existing high-quality resize pipeline.
- Preserve memory-aware planning philosophy.
- Support multiple output formats.
- Support shared output options:
  - quality
  - DPI
  - maximum file size
  - filename rules
- Provide progress and per-file status.
- Avoid freezing the UI.
- Recover gracefully from individual file failures.

---

# 3. Non-Goals

BatchModeEngine does NOT provide:

- Manual drag.
- Manual scale.
- Fit.
- Fill.
- Crop editor.
- Safe area.
- Margin constraints.
- Subject occupancy.
- Recipe propagation.
- Needs Review workflow.

Those belong to Editor Mode.

---

# 4. Existing Algorithm Behavior to Preserve

The current source behavior is:

```text
Input
→ Identify
→ Preflight
→ Choose normal or low-memory path
→ Decode
→ Auto Orient
→ Convert sRGB to linear-light
→ Premultiply alpha
→ Area prefilter when strongly downscaling
→ Catmull–Rom bicubic resize
→ Unpremultiply
→ Convert linear-light to sRGB
→ Encode
```

The current output is exact-size.

If the user requests:

```text
1500 × 1500
```

the output is:

```text
1500 × 1500
```

even when the source aspect ratio differs.

This behavior must remain the default in Batch Mode.

---

# 5. Supported Inputs

Source algorithm currently supports:

```text
.jpg
.jpeg
.png
.webp
.bmp
.tif
.tiff
```

For the web version, initial browser-native support may be narrower.

Recommended initial browser support:

```text
JPEG
PNG
WEBP
```

Optional later:

```text
BMP
TIFF
AVIF
HEIC
```

If browser decoding does not support a format:

```text
UNSUPPORTED_FORMAT
```

Do not silently alter the file.

---

# 6. Batch Request Model

```ts
type BatchModeRequest = {
  files: File[]

  target: {
    width: number
    height: number
  }

  output: {
    format: 'jpeg' | 'png' | 'webp' | 'tiff'

    quality?: number

    dpi?: {
      x: number
      y: number
    }

    fileSizeLimit?: {
      enabled: boolean
      maxBytes: number
    }

    jpegBackground?: 'white' | 'black' | string

    filename?: {
      keepOriginal: boolean
      prefix?: string
      suffix?: string
    }
  }
}
```

---

# 7. Dimension Validation

Preserve the desktop constraints unless intentionally changed.

Recommended:

```text
width:
1..20,000

height:
1..20,000
```

Also validate:

```text
width × height <= 100,000,000 pixels
```

If invalid:

```text
INVALID_OUTPUT_DIMENSIONS
```

---

# 8. Preflight

Every file should be inspected before execution.

Preflight should determine:

```text
sourceWidth
sourceHeight
sourcePixels
destinationPixels
prefilterWidth
prefilterHeight
estimatedMemory
recommendedPath
```

---

# 9. Prefilter Dimensions

Preserve the current planning rule:

```text
prefilterWidth =
  sourceWidth > 2 × targetWidth
    ? min(sourceWidth, 2 × targetWidth)
    : sourceWidth

prefilterHeight =
  sourceHeight > 2 × targetHeight
    ? min(sourceHeight, 2 × targetHeight)
    : sourceHeight
```

---

# 10. Memory Estimate

The desktop source uses:

```text
sourcePixels      = sourceWidth × sourceHeight
destinationPixels = destinationWidth × destinationHeight

preWidth =
  sourceWidth > 2 × destinationWidth
    ? min(sourceWidth, 2 × destinationWidth)
    : sourceWidth

preHeight =
  sourceHeight > 2 × destinationHeight
    ? min(sourceHeight, 2 × destinationHeight)
    : sourceHeight

prePixels = preWidth × preHeight

estimatedPeakBytes =
    sourcePixels × 36
  + max(
      preWidth × sourceHeight + prePixels,
      destinationWidth × preHeight
    ) × 32
  + destinationPixels × 4
```

The browser implementation can preserve this estimate as a relative planning tool.

Important:

A browser cannot reliably know actual free RAM.

Therefore, `estimatedPeakBytes` should be used to:

- classify jobs
- reduce worker concurrency
- reject obviously unsafe jobs
- select lower-memory fallback paths

Do not claim it is an exact memory measurement.

---

# 11. Browser Batch Safety Strategy

Recommended:

```text
small / normal job
→ normal worker path

large job
→ reduced concurrency

very large job
→ low-memory path

unsafe job
→ fail gracefully
```

Possible thresholds should be configurable.

---

# 12. Worker Pool

Use a bounded worker pool.

Example strategy:

```ts
const logical = navigator.hardwareConcurrency || 4

workerCount = Math.min(
  8,
  Math.max(1, Math.floor(logical / 2))
)
```

Then reduce based on batch memory estimate.

Example:

```text
8 logical cores
→ initial pool = 4

large source images
→ pool reduced to 2

very large image
→ pool reduced to 1
```

---

# 13. Batch Queue Model

```ts
type BatchJob = {
  id: string
  file: File

  sourceWidth?: number
  sourceHeight?: number

  estimatedPeakBytes?: number

  status:
    | 'queued'
    | 'processing'
    | 'completed'
    | 'warning'
    | 'error'
    | 'cancelled'

  progress?: number

  error?: {
    code: string
    message: string
  }
}
```

---

# 14. Core Pixel Pipeline

## 14.1 Decode and Orientation

Equivalent intent:

```text
decode RGBA
apply EXIF orientation
```

Browser implementation options:

```text
createImageBitmap
Canvas
WASM decoder
```

If orientation behavior differs across browser decoding paths, normalize it explicitly.

---

# 15. sRGB to Linear-Light

For each RGB channel normalized to `0..1`:

```text
if s <= 0.04045:
    linear = s / 12.92
else:
    linear = ((s + 0.055) / 1.055) ^ 2.4
```

---

# 16. Premultiply Alpha

For:

```text
R
G
B
A
```

Use:

```text
a = A / 255

r = srgbToLinear(R / 255) × a
g = srgbToLinear(G / 255) × a
b = srgbToLinear(B / 255) × a
```

Store:

```text
(r, g, b, a)
```

---

# 17. Area Prefilter

Apply only when source dimension is more than twice target dimension.

For one axis:

```text
scale = sourceLength / destinationLength

left  = d × scale
right = (d + 1) × scale
```

Source pixel overlap:

```text
overlap(i) =
  max(
    0,
    min(right, i + 1) - max(left, i)
  )
```

Weight:

```text
weight(i) = overlap(i) / scale
```

Perform separably:

```text
horizontal
then
vertical
```

---

# 18. Catmull–Rom Bicubic

Use:

```text
a = -0.5
```

Source coordinate:

```text
sourceCoordinate(d) =
  (d + 0.5) × scale - 0.5
```

Sample range:

```text
ceil(sourceCoordinate - 2)
to
floor(sourceCoordinate + 2)
```

Kernel:

```text
t = abs(sourceIndex - sourceCoordinate)

K(t) =
    1.5t^3 - 2.5t^2 + 1
        when t <= 1

    -0.5t^3 + 2.5t^2 - 4t + 2
        when 1 < t <= 2

    0
        when t > 2
```

Clamp source indices.

Combine duplicate clamped indices.

Normalize finite weights.

---

# 19. Separable Resize

Horizontal pass:

```text
horizontal[y, x] =
  Σ source[y, mappedXIndex] × mappedXWeight
```

Vertical pass:

```text
output[y, x] =
  Σ horizontal[mappedYIndex, x] × mappedYWeight
```

Precompute X and Y maps once per resize job.

---

# 20. Unpremultiply

After filtering:

```text
a = clamp(a, 0, 1)
```

If:

```text
a < 1e-9
```

output:

```text
0,0,0,0
```

Otherwise:

```text
channelLinear =
  clamp(channel / a, 0, 1)
```

---

# 21. Linear-Light to sRGB

```text
if l <= 0.0031308:
    srgb = 12.92 × l
else:
    srgb = 1.055 × l^(1/2.4) - 0.055
```

Quantize to 8-bit output.

---

# 22. Quality

The original desktop source uses quality `92` for:

```text
JPEG
WEBP
```

Batch Mode default should therefore initially be:

```text
92
```

unless product requirements intentionally change.

---

# 23. JPEG Alpha Flattening

JPEG does not support alpha.

Preserve behavior:

```text
flatten alpha
```

Default:

```text
white
```

Optional:

```text
black
custom color
```

---

# 24. Low-Memory Path

The desktop source uses libvips sequential processing when estimated memory is too high.

The browser version cannot use native NetVips directly.

Possible browser strategies:

```text
WASM libvips
tile-based processing
reduced intermediate buffers
single-job processing
server fallback later
```

For the first browser implementation:

- Keep the decision point.
- Use concurrency reduction first.
- Add WASM low-memory backend later if required.
- Fail gracefully rather than crash the page.

---

# 25. Batch Execution Flow

```text
User selects files
        |
        v
Validate target settings
        |
        v
Preflight all files
        |
        v
Estimate memory
        |
        v
Select concurrency
        |
        v
Create queue
        |
        v
Process jobs
        |
        +--> decode
        +--> orient
        +--> linearize
        +--> premultiply
        +--> prefilter
        +--> bicubic
        +--> unpremultiply
        +--> encode
        |
        v
Shared Output Engine
        |
        v
Download / ZIP
```

---

# 26. Shared Output Engine Integration

BatchModeEngine must NOT implement DPI or size-limit logic itself.

It should pass final rendered pixels to:

```text
OutputEngine
```

Example:

```ts
const rendered = await batchCore.render(...)

const output = await outputEngine.encode({
  pixels: rendered,
  config: request.output
})
```

---

# 27. DPI

Add after render.

Example:

```text
300 × 300 DPI
```

No change to pixel dimensions.

---

# 28. File Size Limit

If configured:

```text
maxBytes = 500 * 1024
```

Output Engine should optimize encoding quality.

Recommended for:

```text
JPEG
WEBP
```

PNG size control may require different logic because quality sliders do not behave the same way.

Do not promise exact compression behavior across formats without testing.

---

# 29. Batch Progress

Track:

```text
total
queued
processing
completed
failed
cancelled
percentage
```

UI example:

```text
Processing 106 / 177
60%
```

---

# 30. Cancellation

Cancellation should:

- stop scheduling new jobs
- signal active workers
- preserve completed outputs
- mark unfinished jobs cancelled

Do not corrupt already completed outputs.

---

# 31. Retry

Retry only failed jobs.

Do not restart the entire batch unless requested.

---

# 32. Filename Rules

Default:

```text
keep original base name
```

Examples:

```text
8801234567890.jpg
```

With suffix:

```text
8801234567890_resized.jpg
```

If collision occurs:

```text
8801234567890_resized_2.jpg
```

---

# 33. Output Packaging

Single output:

```text
direct download
```

Multiple outputs:

```text
ZIP
```

Example:

```text
MINIMA_Output.zip
```

---

# 34. Web Worker Interface

Suggested worker input:

```ts
type BatchWorkerInput = {
  jobId: string
  source: ArrayBuffer

  sourceMetadata: {
    width: number
    height: number
    type: string
  }

  target: {
    width: number
    height: number
  }
}
```

Suggested worker output:

```ts
type BatchWorkerOutput = {
  jobId: string

  renderedPixels?: ArrayBuffer

  error?: {
    code: string
    message: string
  }
}
```

Encoding can happen in worker or shared output worker depending on implementation.

---

# 35. Determinism

For the same:

```text
source pixels
target dimensions
algorithm version
output options
```

Batch Mode should produce consistent results.

Version the algorithm:

```text
batch_engine_version = 1
```

Store version in project metadata and analytics.

---

# 36. Testing

Test:

```text
same-size resize
upscale
moderate downscale
strong downscale
transparent PNG
opaque JPEG
portrait
landscape
square
very large source
corrupted file
unsupported file
```

---

# 37. Regression Fixtures

Keep a fixed set of test images.

Compare:

```text
desktop source output
vs
web engine output
```

For the custom path, aim for the closest feasible result.

Document any known pixel-level differences caused by:

```text
browser decoder
WASM implementation
encoder differences
floating-point behavior
```

---

# 38. Batch Mode Definition of Done

BatchModeEngine is complete when:

- Existing exact-size behavior is preserved.
- Core processing pipeline is ported or faithfully wrapped.
- Large batches do not freeze the UI.
- Memory-aware concurrency exists.
- Job retry and cancellation work.
- JPEG/PNG/WEBP export works.
- DPI works.
- Maximum file size option works where supported.
- ZIP export works.
- Individual file failures do not kill the whole batch.
