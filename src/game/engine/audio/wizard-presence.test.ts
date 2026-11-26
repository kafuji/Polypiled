import { describe, expect, it } from "vitest";
import { GLYPH_CATALOG } from "../../glyphs";
import { isWizardOfYendorGlyph, isWizardOfYendorInView } from "./wizard-presence";

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

describe("isWizardOfYendorInView", () => {
  const isWizard = (glyph: unknown) => glyph === 7;
  const monster = (glyph: number | null, hero = false) => ({ glyph, hero });

  it("finds him among the monsters shown, his double included", () => {
    expect(isWizardOfYendorInView([monster(3), monster(7)], isWizard)).toBe(true);
    expect(isWizardOfYendorInView([monster(3), monster(null)], isWizard)).toBe(false);
    expect(isWizardOfYendorInView([], isWizard)).toBe(false);
  });

  it("ignores the hero polymorphed into him", () => {
    expect(isWizardOfYendorInView([monster(7, true)], isWizard)).toBe(false);
  });
});
