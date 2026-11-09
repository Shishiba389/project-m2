/**
 * Where the product is inside a picture - MINIMA_V2_EDITOR_MODE_ENGINE §20-21.
 *
 * A product shot is usually a product on a plain background, and the
 * background is not the product: two shots of the same shoe with different
 * white margins are the same size to a shopper, but not to a layout that
 * measures the whole picture. This finds the product's bounds so the editor
 * can measure that instead.
 *
 *   Level 1  transparent background: the product is whatever is opaque.
 *   Level 2  plain background: the border of the picture tells us its colour,
 *            and the product is whatever differs from it.
 *
 * Anything else - a scene, a gradient, a product cut off at every edge - is
 * reported as not found, and callers use the whole picture (Level 0). §20 is
 * explicit that the engine must not claim subject-aware layout when it does
 * not actually know where the subject is.
 *
 * Pure: pixels in, a rectangle out. No DOM, so it is tested directly.
 */

/** The product's bounds as fractions of the (uncropped) source, like a crop. */
export type SubjectRect = { left: number; top: number; right: number; bottom: number };
export type Subject = {
  rect: SubjectRect;
  /** How it was found: transparency, or difference from a plain background. */
  method: "alpha" | "background";
  /** The background colour, for a plain background. */
  background?: [number, number, number];
  /** How far from that colour a pixel had to be to count as product. */
  threshold?: number;
};

/** Alpha at or below this is background on a transparent image. */
const CLEAR_ALPHA = 16;
/** Per-channel distance that still counts as "the background colour". */
const BACKGROUND_TOLERANCE = 20;
/**
 * Per-channel distance from the background at which a pixel is product.
 *
 * Not one number: it follows how noisy the background is. A studio render on
 * pure white has no noise at all, and the faint grey edge of a white box or a
 * white dropper tip - six or eight levels off white - is product there. A
 * photographed JPEG wobbles by a few levels everywhere, and the same six
 * levels are noise. So the threshold is twice the background's own noise plus
 * a small margin: 4 on a clean render, rising to the old fixed 26 on a noisy
 * photo, never above it.
 *
 * Measured on 25 real product renders (SKIN1004, pure 255 white): a fixed 26
 * cut 61-111 px off four mostly-white products; this cut nothing, and moved
 * every other box by 10 px or less. The cost is that on a clean render a
 * visible shadow counts as part of the product - which errs towards keeping
 * the whole product, the safer way round.
 */
const MIN_PRODUCT_DISTANCE = 4;
const MAX_PRODUCT_DISTANCE = 26;
export const productThreshold = (noise: number) =>
  Math.min(MAX_PRODUCT_DISTANCE, Math.max(MIN_PRODUCT_DISTANCE, Math.ceil(2 * noise + MIN_PRODUCT_DISTANCE)));
/**
 * Share of the border that has to be background for the background to be
 * trusted. Not higher: a product shot tight often runs off one or two edges,
 * and that is still a product on a plain background.
 */
const PLAIN_BORDER = 0.7;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Every pixel index on the picture's outer two-pixel frame. */
function borderIndices(width: number, height: number) {
  const indices: number[] = [];
  const ring = Math.min(2, Math.floor(Math.min(width, height) / 2));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < ring || y < ring || x >= width - ring || y >= height - ring) indices.push(y * width + x);
      else if (x === ring) x = width - ring - 1; // jump across the interior
    }
  }
  return indices;
}

/**
 * Bounds of a mask, ignoring specks: a row or column only counts when enough
 * of it is product, so dust, JPEG noise and a stray pixel at the edge of the
 * frame do not stretch the box.
 */
function maskBounds(isProduct: (index: number) => boolean, width: number, height: number): SubjectRect | null {
  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isProduct(y * width + x)) continue;
      rows[y] += 1; columns[x] += 1; total += 1;
    }
  }
  // Too little to be a product: an empty frame, or only noise.
  if (total < Math.max(4, width * height * 0.0005)) return null;
  // At least two pixels, and 0.3% of the line: a lone pixel is dust.
  const minInRow = Math.max(2, Math.round(width * 0.003));
  const minInColumn = Math.max(2, Math.round(height * 0.003));
  let top = 0; while (top < height && rows[top] < minInRow) top += 1;
  let bottom = height - 1; while (bottom > top && rows[bottom] < minInRow) bottom -= 1;
  let left = 0; while (left < width && columns[left] < minInColumn) left += 1;
  let right = width - 1; while (right > left && columns[right] < minInColumn) right -= 1;
  if (top >= height || left >= width) return null;
  return { left: left / width, top: top / height, right: (right + 1) / width, bottom: (bottom + 1) / height };
}

/** Find the product in RGBA pixels, or null when the background is not plain enough to trust. */
export function detectSubject(data: Uint8ClampedArray, width: number, height: number): Subject | null {
  if (width < 4 || height < 4 || data.length < width * height * 4) return null;
  const border = borderIndices(width, height);

  // Level 1: a transparent background.
  const clearBorder = border.filter((index) => data[index * 4 + 3] <= CLEAR_ALPHA).length;
  if (clearBorder / border.length >= PLAIN_BORDER) {
    const rect = maskBounds((index) => data[index * 4 + 3] > CLEAR_ALPHA, width, height);
    return rect && { rect, method: "alpha" };
  }

  // Level 2: a plain background, whose colour the border gives away.
  const opaque = border.filter((index) => data[index * 4 + 3] > CLEAR_ALPHA);
  const background: [number, number, number] = [0, 1, 2].map((channel) => median(opaque.map((index) => data[index * 4 + channel]))) as [number, number, number];
  const distance = (index: number) => Math.max(
    Math.abs(data[index * 4] - background[0]),
    Math.abs(data[index * 4 + 1] - background[1]),
    Math.abs(data[index * 4 + 2] - background[2]),
  );
  const plain = opaque.map(distance).filter((value) => value <= BACKGROUND_TOLERANCE).sort((a, b) => a - b);
  if (!opaque.length || plain.length / border.length < PLAIN_BORDER) return null;
  // The background's own noise: how far its border pixels stray from its colour.
  const noise = plain[Math.min(plain.length - 1, Math.floor(plain.length * 0.99))];
  const threshold = productThreshold(noise);
  const rect = maskBounds((index) => data[index * 4 + 3] > CLEAR_ALPHA && distance(index) > threshold, width, height);
  return rect && { rect, method: "background", background, threshold };
}

/** The whole picture, for an image whose product was not found. */
export const WHOLE: SubjectRect = { left: 0, top: 0, right: 1, bottom: 1 };

/**
 * The product's bounds as fractions of an element's box: the subject seen
 * through the element's crop. Null when the crop leaves none of it showing.
 */
export function subjectInBox(subject: SubjectRect | null | undefined, crop: SubjectRect | null): SubjectRect | null {
  const product = subject ?? WHOLE;
  const window = crop ?? WHOLE;
  const width = window.right - window.left;
  const height = window.bottom - window.top;
  const left = Math.max(product.left, window.left);
  const right = Math.min(product.right, window.right);
  const top = Math.max(product.top, window.top);
  const bottom = Math.min(product.bottom, window.bottom);
  if (right <= left || bottom <= top || width <= 0 || height <= 0) return null;
  return { left: (left - window.left) / width, right: (right - window.left) / width, top: (top - window.top) / height, bottom: (bottom - window.top) / height };
}

/** True when the product fills the picture, so there is nothing to measure separately. */
export const isWhole = (rect: SubjectRect | null | undefined) =>
  !rect || (rect.left <= 0.001 && rect.top <= 0.001 && rect.right >= 0.999 && rect.bottom >= 0.999);
