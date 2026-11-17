import { describe, expect, it } from "vitest";
import { parseFloorHere } from "./floor-here";
import { migrateStartupInitOptionValues } from "./startup-init-options";

const sample = {
  v: 1,
  x: 12,
  y: 7,
  feature: "fountain",
  engraving: { type: 1, text: "Elbereth" },
  hidden: false,
  objects: [
    { name: "a +0 dagger (for sale, 4 zorkmids)", glyph: 3500, tile: 840, quan: 1 },
    { name: "3 uncursed scrolls labeled \"FOO\"", glyph: 3449, tile: -1, quan: 3 },
  ],
  count: 7,
};

describe("floor information from the core", () => {
  it("reads the terrain, the engraving and the objects", () => {
    expect(parseFloorHere(JSON.stringify(sample))).toEqual({
      x: 12,
      y: 7,
      feature: "fountain",
      engraving: { type: 1, text: "Elbereth" },
      hidden: false,
      objects: [
        { name: "a +0 dagger (for sale, 4 zorkmids)", glyph: 3500, tileIndex: 840, quantity: 1 },
        { name: "3 uncursed scrolls labeled \"FOO\"", glyph: 3449, tileIndex: null, quantity: 3 },
      ],
      count: 7,
    });
  });

  it("keeps a hidden floor and a missing engraving", () => {
    const parsed = parseFloorHere(JSON.stringify({ ...sample, engraving: null, hidden: true, objects: [], count: 0 }));
    expect(parsed?.hidden).toBe(true);
    expect(parsed?.engraving).toBeNull();
    expect(parsed?.objects).toEqual([]);
  });

  it("refuses anything malformed or of another version", () => {
    expect(parseFloorHere("{")).toBeNull();
    expect(parseFloorHere(JSON.stringify({ ...sample, v: 2 }))).toBeNull();
    expect(parseFloorHere(JSON.stringify({ ...sample, objects: [{ glyph: 1 }] }))).toBeNull();
    expect(parseFloorHere(null)).toBeNull();
  });
});

describe("stored startup options", () => {
  it("moves the old default pile limit to 2 once", () => {
    expect(migrateStartupInitOptionValues({ pile_limit: 5 }, undefined).pile_limit).toBe(2);
    expect(migrateStartupInitOptionValues({ pile_limit: 8 }, undefined).pile_limit).toBe(8);
    // Written at revision 2 or later: 5 was chosen.
    expect(migrateStartupInitOptionValues({ pile_limit: 5 }, 2).pile_limit).toBe(5);
  });
});
