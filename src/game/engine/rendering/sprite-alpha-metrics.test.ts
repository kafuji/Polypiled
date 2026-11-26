import { describe, expect, it } from "vitest";
import { EMPTY_SPRITE_ALPHA_METRICS, measureSpriteAlpha } from "./sprite-alpha-metrics";

function picture(width: number, height: number, solid: (x: number, y: number) => boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (solid(x, y)) data[(y * width + x) * 4 + 3] = 255;
    }
  }
  return data;
}

describe("sprite alpha metrics", () => {
  it("finds the solid box and where it touches the ground", () => {
    // A wide body (x 2..17) on two narrow legs (x 6..7 and 12..13).
    const data = picture(20, 20, (x, y) => (y >= 2 && y < 14 && x >= 2 && x < 18) || (y >= 14 && y < 18 && ((x >= 6 && x < 8) || (x >= 12 && x < 14))));
    const metrics = measureSpriteAlpha(data, 20, 20);
    expect(metrics.minU).toBeCloseTo(0.1);
    expect(metrics.maxU).toBeCloseTo(0.9);
    expect(metrics.topV).toBeCloseTo(0.1);
    expect(metrics.bottomV).toBeCloseTo(0.9);
    expect(metrics.contactMinU).toBeCloseTo(0.3);
    expect(metrics.contactMaxU).toBeCloseTo(0.7);
  });

  it("falls back for an empty picture", () => {
    expect(measureSpriteAlpha(picture(4, 4, () => false), 4, 4)).toBe(EMPTY_SPRITE_ALPHA_METRICS);
  });
});
