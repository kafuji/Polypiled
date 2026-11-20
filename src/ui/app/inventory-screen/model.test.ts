import { describe, expect, it } from "vitest";
import { InventoryWornMask, type InventoryObject, type InventoryState } from "../../../runtime/inventory-state";
import {
  ObjectClass,
  objectInSlot,
  planEquip,
  planMove,
  planToggle,
  planUnequip,
  slotsFor,
  weightSummary,
  estimateTurns,
  planContainer,
  planDrop,
  planNested,
  planPickup,
} from "./model";

function object(letter: string, overrides: Partial<InventoryObject> = {}): InventoryObject {
  return {
    id: letter.charCodeAt(0),
    letter,
    name: letter,
    objectClass: ObjectClass.tool,
    glyph: 0,
    tileIndex: null,
    quantity: 1,
    armorCategory: null,
    eyewear: false,
    armorDelay: null,
    weight: 10,
    wornMask: 0,
    donning: false,
    doffing: false,
    skin: false,
    buc: null,
    enchantment: null,
    charges: null,
    recharged: null,
    eroded: null,
    eroded2: null,
    erodeproof: false,
    poisoned: false,
    greased: false,
    lit: false,
    unpaid: false,
    named: false, baseName: null, price: null, priceKind: null,
    container: null,
    ...overrides,
  };
}

function state(objects: InventoryObject[]): InventoryState {
  return { weight: 100, capacity: 450, encumbrance: 0, twoWeapon: false, punished: false, objects, floor: [], floorHidden: false, floorCount: 0, gameId: 1 };
}

const armor = (letter: string, category: InventoryObject["armorCategory"], wornMask = 0) =>
  object(letter, { objectClass: ObjectClass.armor, armorCategory: category, wornMask });

describe("where an object can go", () => {
  it("follows the armor category, rings, amulets and eyewear", () => {
    expect(slotsFor(armor("a", "helmet"))).toEqual(["helmet"]);
    expect(slotsFor(object("b", { objectClass: ObjectClass.ring }))).toEqual(["leftRing", "rightRing"]);
    expect(slotsFor(object("c", { objectClass: ObjectClass.amulet }))).toEqual(["amulet"]);
    expect(slotsFor(object("d", { eyewear: true }))).toEqual(["eyewear"]);
    expect(slotsFor(object("e", { objectClass: ObjectClass.weapon }))).toEqual(["weapon", "secondaryWeapon", "quiver"]);
    expect(slotsFor(object("$", { objectClass: ObjectClass.coin }))).toEqual([]);
  });
});

describe("equipping by drag", () => {
  it("wears into an empty slot", () => {
    const helmet = armor("a", "helmet");
    expect(planEquip(state([helmet]), helmet, "helmet").operations).toEqual([{ op: "wear", item: "a" }]);
  });

  it("refuses a slot the object does not fit", () => {
    const helmet = armor("a", "helmet");
    expect(planEquip(state([helmet]), helmet, "boots").operations).toEqual([]);
  });

  it("takes off what is in the way and puts outer layers back", () => {
    const cloak = armor("c", "cloak", InventoryWornMask.cloak);
    const oldSuit = armor("s", "bodyArmor", InventoryWornMask.bodyArmor);
    const newSuit = armor("n", "bodyArmor");
    const plan = planEquip(state([cloak, oldSuit, newSuit]), newSuit, "bodyArmor");
    expect(plan.operations).toEqual([
      { op: "takeoff", item: "c" },
      { op: "takeoff", item: "s" },
      { op: "wear", item: "n" },
      { op: "wear", item: "c" },
    ]);
    expect(plan.removes).toEqual([cloak, oldSuit]);
  });

  it("puts a ring on the chosen hand, moving it from the other", () => {
    const ring = object("r", { objectClass: ObjectClass.ring, wornMask: InventoryWornMask.leftRing });
    expect(planEquip(state([ring]), ring, "rightRing").operations).toEqual([
      { op: "remove", item: "r" },
      { op: "puton", item: "r", hand: "right" },
    ]);
  });

  it("makes an alternate weapon by wielding and swapping", () => {
    const sword = object("a", { objectClass: ObjectClass.weapon, wornMask: InventoryWornMask.weapon });
    const dagger = object("b", { objectClass: ObjectClass.weapon });
    expect(planEquip(state([sword, dagger]), dagger, "secondaryWeapon").operations).toEqual([
      { op: "wield", item: "b" },
      { op: "swap" },
    ]);
    expect(planEquip(state([sword, dagger]), sword, "secondaryWeapon").operations).toEqual([{ op: "swap" }]);
  });

  it("replaces a wielded weapon without taking it off first", () => {
    const sword = object("a", { objectClass: ObjectClass.weapon, wornMask: InventoryWornMask.weapon });
    const axe = object("b", { objectClass: ObjectClass.weapon });
    expect(planEquip(state([sword, axe]), axe, "weapon").operations).toEqual([{ op: "wield", item: "b" }]);
  });
});

describe("unequipping and moving", () => {
  it("takes off, removes or empties the hands", () => {
    expect(planUnequip(armor("a", "helmet", InventoryWornMask.helmet)).operations).toEqual([{ op: "takeoff", item: "a" }]);
    expect(planUnequip(object("b", { objectClass: ObjectClass.amulet, wornMask: InventoryWornMask.amulet })).operations)
      .toEqual([{ op: "remove", item: "b" }]);
    expect(planUnequip(object("c", { objectClass: ObjectClass.weapon, wornMask: InventoryWornMask.weapon })).operations)
      .toEqual([{ op: "wield", item: "-" }]);
  });

  it("cannot empty the alternate weapon alone", () => {
    const plan = planUnequip(object("c", { objectClass: ObjectClass.weapon, wornMask: InventoryWornMask.secondaryWeapon }));
    expect(plan.unsupported).toBe(true);
    expect(plan.operations).toEqual([]);
  });

  it("moves with #adjust, gold only to $", () => {
    expect(planMove(object("a"), "q").operations).toEqual([{ op: "adjust", from: "a", to: "q" }]);
    expect(planMove(object("a"), "a").operations).toEqual([]);
    expect(planMove(object("a"), "$").operations).toEqual([]);
  });

  it("toggles on double click", () => {
    const ringLeft = object("r", { objectClass: ObjectClass.ring, wornMask: InventoryWornMask.leftRing });
    const ring = object("s", { objectClass: ObjectClass.ring });
    const inventory = state([ringLeft, ring]);
    expect(planToggle(inventory, ring).operations).toEqual([{ op: "puton", item: "s", hand: "right" }]);
    expect(planToggle(inventory, ringLeft).operations).toEqual([{ op: "remove", item: "r" }]);
    expect(objectInSlot(inventory, "leftRing")).toBe(ringLeft);
  });
});

describe("weight summary", () => {
  it("measures the band up to the next level", () => {
    expect(weightSummary({ weight: 225, capacity: 450, encumbrance: 0 })).toMatchObject({
      nextThreshold: 451,
      remaining: 226,
      level: 0,
    });
    expect(weightSummary({ weight: 5000, capacity: 450, encumbrance: 5 })).toMatchObject({
      nextThreshold: null,
      remaining: null,
      fill: 1,
    });
  });
});

describe("floor, containers and turn estimates", () => {
  it("estimates turns from armor delays, with #adjust free", () => {
    const cloak = { ...armor("c", "cloak", InventoryWornMask.cloak), armorDelay: 0 };
    const suit = { ...armor("s", "bodyArmor"), armorDelay: 5 };
    const inventory = state([cloak, suit]);
    expect(estimateTurns(inventory, [
      { op: "takeoff", item: "c" },
      { op: "wear", item: "s" },
      { op: "wear", item: "c" },
      { op: "adjust", from: "s", to: "z" },
    ])).toBe(1 + 6 + 1);
  });

  it("drops worn things after taking them off", () => {
    const helmet = armor("h", "helmet", InventoryWornMask.helmet);
    expect(planDrop(helmet).operations).toEqual([
      { op: "takeoff", item: "h" },
      { op: "drop", items: [{ id: helmet.id, count: 0 }] },
    ]);
    expect(planDrop(object("a", { quantity: 5 }), 2).operations).toEqual([{ op: "drop", items: [{ id: 97, count: 2 }] }]);
  });

  it("picks up with a count only for a single stack", () => {
    const a = object("a", { letter: null });
    const b = object("b", { letter: null });
    expect(planPickup([a], 3).operations).toEqual([{ op: "pickup", items: [{ id: a.id, count: 3 }] }]);
    expect(planPickup([a, b], 3).operations).toEqual([{ op: "pickup", items: [{ id: a.id, count: 0 }, { id: b.id, count: 0 }] }]);
  });

  it("reaches into a bag inside a bag in three actions", () => {
    const outer = object("o");
    const inner = object("i", { letter: null });
    expect(planNested(outer, inner, { in: [5] }).operations).toEqual([
      { op: "loot", container: outer.id, out: [inner.id], in: [] },
      { op: "loot", container: inner.id, out: [], in: [5] },
      { op: "loot", container: outer.id, out: [], in: [inner.id] },
    ]);
    expect(planContainer({ containerId: 3, out: [1], in: [2] }).operations).toEqual([
      { op: "loot", container: 3, out: [1], in: [2] },
    ]);
  });
});
