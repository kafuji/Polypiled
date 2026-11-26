/**
 * Where a sprite picture is solid, measured from its alpha channel, as
 * fractions of the picture (u right, v down from the top).
 */
export interface SpriteAlphaMetrics {
  readonly minU: number;
  readonly maxU: number;
  readonly topV: number;
  readonly bottomV: number;
  /** Solid span along the bottom rows: where the picture touches the ground. */
  readonly contactMinU: number;
  readonly contactMaxU: number;
}

export const EMPTY_SPRITE_ALPHA_METRICS: SpriteAlphaMetrics = {
  minU: 0.25,
  maxU: 0.75,
  topV: 0,
  bottomV: 1,
  contactMinU: 0.35,
  contactMaxU: 0.65,
};

/** Rows counted as the bottom, as a share of the solid height. */
const CONTACT_BAND = 0.12;
const ALPHA_THRESHOLD = 24;

export function measureSpriteAlpha(
  data: ArrayLike<number>,
  width: number,
  height: number,
): SpriteAlphaMetrics {
  const w = Math.max(1, Math.trunc(width));
  const h = Math.max(1, Math.trunc(height));
  let minX = w;
  let maxX = -1;
  let minY = h;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return EMPTY_SPRITE_ALPHA_METRICS;
  const bandTop = Math.max(minY, maxY - Math.max(1, Math.round((maxY - minY + 1) * CONTACT_BAND)) + 1);
  let contactMinX = w;
  let contactMaxX = -1;
  for (let y = bandTop; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < contactMinX) contactMinX = x;
        if (x > contactMaxX) contactMaxX = x;
      }
    }
  }
  return {
    minU: minX / w,
    maxU: (maxX + 1) / w,
    topV: minY / h,
    bottomV: (maxY + 1) / h,
    contactMinU: contactMinX / w,
    contactMaxU: (contactMaxX + 1) / w,
  };
}
