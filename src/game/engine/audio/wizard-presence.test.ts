import { describe, expect, it } from "vitest";
import { GLYPH_CATALOG } from "../../glyphs";
import { isWizardOfYendorGlyph, WizardPresenceTracker } from "./wizard-presence";

describe("isWizardOfYendorGlyph", () => {
  it("finds him seen, tame, sensed and ridden", () => {
    const found = GLYPH_CATALOG.filter((entry) => isWizardOfYendorGlyph(entry.glyph));
    expect(new Set(found.map((entry) => entry.kind))).toEqual(new Set(["mon", "pet", "detect", "ridden"]));
    expect(new Set(found.map((entry) => entry.asciiChar))).toEqual(new Set(["@"]));
    // Male and female tiles for each of the four kinds, and nothing else.
    expect(found).toHaveLength(8);
  });

  it("never matches non-glyphs", () => {
    expect(isWizardOfYendorGlyph(undefined)).toBe(false);
    expect(isWizardOfYendorGlyph(-1)).toBe(false);
  });
});

describe("WizardPresenceTracker", () => {
  const tracker = () => new WizardPresenceTracker((glyph) => glyph === 7);

  it("is present while any cell shows him, including his double", () => {
    const presence = tracker();
    expect(presence.update({ x: 1, y: 1, glyph: 7 })).toBe(true);
    expect(presence.update({ x: 5, y: 2, glyph: 7 })).toBe(false);
    expect(presence.update({ x: 1, y: 1, glyph: 0 })).toBe(false);
    expect(presence.present).toBe(true);
    expect(presence.update({ x: 5, y: 2, glyph: 0 })).toBe(true);
    expect(presence.present).toBe(false);
  });

  it("forgets him when the level changes", () => {
    const presence = tracker();
    presence.update({ x: 1, y: 1, glyph: 7 });
    expect(presence.clear()).toBe(true);
    expect(presence.present).toBe(false);
    expect(presence.clear()).toBe(false);
  });

  it("ignores tiles without a position", () => {
    const presence = tracker();
    expect(presence.update({ glyph: 7 })).toBe(false);
    expect(presence.update(null)).toBe(false);
  });
});
