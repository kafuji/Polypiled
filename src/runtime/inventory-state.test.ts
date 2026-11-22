import { describe, expect, it } from "vitest";
import {
  defaultClassOrder,
  encumbranceThresholds,
  inventoryWornSlots,
  parseInventoryState,
  weightUntilNextEncumbrance,
} from "./inventory-state";

const sword = {
  id: 12,
  letter: "a",
  name: "an uncursed rusty +1 long sword (weapon in hand)",
  class: 1,
  glyph: 3500,
  tile: 840,
  quan: 1,
  weight: 40,
  worn: 0x100,
  buc: "uncursed",
  eroded: { level: 1, kind: "rust" },
  enchantment: 1,
};

const bag = {
  id: 30,
  letter: "p",
  name: "a bag",
  class: 6,
  glyph: 3600,
  tile: 900,
  quan: 1,
  weight: 25,
  container: {
    contents: [
      { id: 31, name: "2 potions", class: 8, glyph: 3700, tile: 950, quan: 2 },
      { id: 32, name: "a sack", class: 6, glyph: 3600, tile: 901, quan: 1, container: { contents: null } },
    ],
    more: 3,
  },
};

const sample = {
  v: 1,
  weight: 412,
  capacity: 450,
  encumbrance: 0,
  twoweapon: false,
  punished: false,
  objects: [sword, bag],
};

describe("inventory from the core", () => {
  it("reads objects with what the game tells about them", () => {
    const state = parseInventoryState(JSON.stringify(sample));
    expect(state).toMatchObject({ weight: 412, capacity: 450, encumbrance: 0, twoWeapon: false });
    expect(state?.objects[0]).toMatchObject({
      id: 12,
      letter: "a",
      tileIndex: 840,
      weight: 40,
      wornMask: 0x100,
      buc: "uncursed",
      enchantment: 1,
      charges: null,
      eroded: { level: 1, kind: "rust" },
      eroded2: null,
      container: null,
    });
  });

  it("reads the armor category and eyewear", () => {
    const state = parseInventoryState(
      JSON.stringify({
        ...sample,
        objects: [
          { ...sword, letter: "c", armor: 5 },
          { ...sword, letter: "g", eyewear: true },
          { ...sword, letter: "h", armor: 9 },
        ],
      }),
    );
    expect(state?.objects.map((object) => [object.armorCategory, object.eyewear])).toEqual([
      ["cloak", false],
      [null, true],
      [null, false],
    ]);
  });

  it("reads the class order, or falls back to the default", () => {
    expect(parseInventoryState(JSON.stringify({ ...sample, order: [8, 2] }))?.classOrder).toEqual([8, 2]);
    expect(parseInventoryState(JSON.stringify(sample))?.classOrder).toEqual(defaultClassOrder);
    expect(parseInventoryState(JSON.stringify({ ...sample, order: ["x"] }))?.classOrder).toEqual(defaultClassOrder);
  });

  it("reads the base name and a shop's price, ignoring a broken one", () => {
    const state = parseInventoryState(
      JSON.stringify({
        ...sample,
        objects: [
          { ...sword, base: "long sword", price: 20, priceKind: "unpaid" },
          { ...sword, letter: "b", price: 20, priceKind: "free" },
          sword,
        ],
      }),
    );
    expect(state?.objects.map((o) => [o.baseName, o.price, o.priceKind])).toEqual([
      ["long sword", 20, "unpaid"],
      [null, null, null],
      [null, null, null],
    ]);
  });

  it("leaves unknown BUC and enchantment as null", () => {
    const state = parseInventoryState(
      JSON.stringify({ ...sample, objects: [{ ...sword, buc: undefined, enchantment: undefined }] }),
    );
    expect(state?.objects[0].buc).toBeNull();
    expect(state?.objects[0].enchantment).toBeNull();
  });

  it("reads known contents, unknown contents and the rest beyond the list", () => {
    const container = parseInventoryState(JSON.stringify(sample))?.objects[1].container;
    expect(container?.more).toBe(3);
    expect(container?.contents).toHaveLength(2);
    const [potions, sack] = container!.contents!;
    expect(potions).toMatchObject({ letter: null, weight: null, quantity: 2 });
    expect(sack.container).toEqual({ locked: null, contents: null, more: 0, tooDeep: false });
  });

  it("rejects another version, a top-level object without a letter and broken JSON", () => {
    expect(parseInventoryState(JSON.stringify({ ...sample, v: 2 }))).toBeNull();
    expect(parseInventoryState(JSON.stringify({ ...sample, objects: [{ ...sword, letter: undefined }] }))).toBeNull();
    expect(parseInventoryState("{")).toBeNull();
    expect(parseInventoryState(42)).toBeNull();
  });

  it("names the slots an object fills", () => {
    expect(inventoryWornSlots({ wornMask: 0x100 })).toEqual(["weapon"]);
    expect(inventoryWornSlots({ wornMask: 0x00020000 })).toEqual(["leftRing"]);
    expect(inventoryWornSlots({ wornMask: 0 })).toEqual([]);
  });
});

describe("encumbrance thresholds", () => {
  // calc_capacity(): level = floor((weight - wc) * 2 / wc) + 1 when over wc
  const level = (weight: number, wc: number) =>
    weight - wc <= 0 ? 0 : Math.min(5, Math.floor(((weight - wc) * 2) / wc) + 1);

  it("matches the game's formula at every weight", () => {
    for (const wc of [1, 25, 449, 450, 1000]) {
      const thresholds = encumbranceThresholds(wc);
      for (let weight = 0; weight <= wc * 4; weight++) {
        const expected = level(weight, wc);
        const reached = thresholds.filter((threshold) => weight >= threshold).length;
        expect(reached, `wc ${wc}, weight ${weight}`).toBe(expected);
      }
    }
  });

  it("says how much more fits before the next level", () => {
    expect(weightUntilNextEncumbrance({ weight: 412, capacity: 450 })).toEqual({
      level: 1,
      threshold: 451,
      remaining: 39,
    });
    expect(weightUntilNextEncumbrance({ weight: 5000, capacity: 450 })).toBeNull();
  });
});
