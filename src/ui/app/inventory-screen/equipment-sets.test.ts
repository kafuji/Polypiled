import { afterEach, describe, expect, it, vi } from "vitest";
import type { InventoryOperation } from "../../../runtime/input/inventory-operation";
import { defaultClassOrder, InventoryWornMask as W, type InventoryObject, type InventoryState } from "../../../runtime/inventory-state";
import {
  loadEquipmentSets,
  missingFromSet,
  nextEquipmentSetStep,
  recordEquipmentSet,
  saveEquipmentSets,
  setHotkeyIndex,
  type EquipmentSet,
} from "./equipment-sets";
import { ObjectClass } from "./model";

function object(id: number, letter: string, overrides: Partial<InventoryObject> = {}): InventoryObject {
  return {
    id, letter, name: `#${id}`, objectClass: ObjectClass.tool, glyph: 0, tileIndex: null, quantity: 1,
    armorCategory: null, eyewear: false, armorDelay: null, weight: 1, wornMask: 0, donning: false,
    doffing: false, skin: false, buc: null, enchantment: null, charges: null, recharged: null, eroded: null,
    eroded2: null, erodeproof: false, poisoned: false, greased: false, lit: false, unpaid: false, named: false, baseName: null, price: null, priceKind: null,
    container: null, ...overrides,
  };
}
const armor = (id: number, letter: string, category: InventoryObject["armorCategory"], wornMask = 0) =>
  object(id, letter, { objectClass: ObjectClass.armor, armorCategory: category, wornMask });
const weapon = (id: number, letter: string, wornMask = 0) => object(id, letter, { objectClass: ObjectClass.weapon, wornMask });
const ring = (id: number, letter: string, wornMask = 0) => object(id, letter, { objectClass: ObjectClass.ring, wornMask });

const state = (objects: InventoryObject[]): InventoryState => ({
  weight: 1, capacity: 450, encumbrance: 0, twoWeapon: false, punished: false, objects,
  floor: [], floorHidden: false, floorCount: 0, gameId: 7, classOrder: defaultClassOrder,
});

const armorMask = { bodyArmor: W.bodyArmor, cloak: W.cloak, helmet: W.helmet, shield: W.shield, gloves: W.gloves, boots: W.boots, shirt: W.shirt } as const;

/** A tiny game: applies a step the way the core would, layers included. */
function play(start: InventoryState, set: EquipmentSet, limit = 30): { end: InventoryState; steps: InventoryOperation[] } {
  let current = start;
  const steps: InventoryOperation[] = [];
  const byLetter = (letter: string) => current.objects.find((o) => o.letter === letter)!;
  const wornWith = (mask: number) => current.objects.some((o) => (o.wornMask & mask) !== 0);
  const update = (id: number, change: (o: InventoryObject) => InventoryObject) => {
    current = { ...current, objects: current.objects.map((o) => (o.id === id ? change(o) : o)) };
  };
  for (let index = 0; index < limit; index++) {
    const step = nextEquipmentSetStep(current, set);
    if (!step) return { end: current, steps };
    steps.push(step);
    switch (step.op) {
      case "wear": {
        const o = byLetter(step.item);
        const mask = armorMask[o.armorCategory!];
        if (mask === W.bodyArmor && wornWith(W.cloak)) throw new Error("cloak in the way");
        if (mask === W.shirt && wornWith(W.cloak | W.bodyArmor)) throw new Error("layers in the way");
        update(o.id, (x) => ({ ...x, wornMask: mask }));
        break;
      }
      case "takeoff": {
        const o = byLetter(step.item);
        if (o.wornMask === W.bodyArmor && wornWith(W.cloak)) throw new Error("cloak in the way");
        update(o.id, (x) => ({ ...x, wornMask: 0 }));
        break;
      }
      case "puton":
        update(byLetter(step.item).id, (x) => ({ ...x, wornMask: step.hand === "left" ? W.leftRing : W.rightRing }));
        break;
      case "remove":
        update(byLetter(step.item).id, (x) => ({ ...x, wornMask: 0 }));
        break;
      case "wield":
        current = {
          ...current,
          objects: current.objects.map((o) =>
            o.letter === step.item ? { ...o, wornMask: W.weapon } : o.wornMask & W.weapon ? { ...o, wornMask: 0 } : o),
        };
        break;
      case "swap":
        current = {
          ...current,
          objects: current.objects.map((o) =>
            o.wornMask & W.weapon ? { ...o, wornMask: W.secondaryWeapon }
              : o.wornMask & W.secondaryWeapon ? { ...o, wornMask: W.weapon } : o),
        };
        break;
      case "alternate":
        current = {
          ...current,
          objects: current.objects.map((o) =>
            o.letter === step.item ? { ...o, wornMask: W.secondaryWeapon } : o.wornMask & W.secondaryWeapon ? { ...o, wornMask: 0 } : o),
        };
        break;
      case "altunwield":
        current = {
          ...current,
          objects: current.objects.map((o) => (o.wornMask & W.secondaryWeapon ? { ...o, wornMask: 0 } : o)),
        };
        break;
      case "loot": {
        const bag = current.objects.find((o) => o.id === step.container)!;
        const taken = bag.container!.contents!.filter((o) => step.out.includes(o.id));
        current = {
          ...current,
          objects: [
            ...current.objects.map((o) =>
              o.id === bag.id ? { ...o, container: { ...o.container!, contents: o.container!.contents!.filter((x) => !step.out.includes(x.id)) } } : o),
            ...taken.map((o, i) => ({ ...o, letter: String.fromCharCode(0x70 + i) })),
          ],
        };
        break;
      }
      default:
        throw new Error(`unexpected ${step.op}`);
    }
  }
  throw new Error("did not finish");
}

describe("equipment sets", () => {
  it("records the equipment, an empty alternate as empty, leaving an empty quiver alone", () => {
    const inventory = state([weapon(1, "a", W.weapon), armor(2, "b", "cloak", W.cloak)]);
    const set = recordEquipmentSet(inventory, "melee");
    expect(set.slots.weapon).toBe(1);
    expect(set.slots.cloak).toBe(2);
    expect(set.slots.shield).toBe("empty");
    expect(set.slots.secondaryWeapon).toBe("empty");
    expect(set.slots.quiver).toBeUndefined();
  });

  it("changes body armor under a cloak and puts the cloak back", () => {
    const start = state([
      armor(1, "a", "cloak", W.cloak),
      armor(2, "b", "bodyArmor", W.bodyArmor),
      armor(3, "c", "bodyArmor"),
    ]);
    const { end, steps } = play(start, { name: "x", slots: { cloak: 1, bodyArmor: 3 } });
    expect(steps).toEqual([
      { op: "takeoff", item: "a" },
      { op: "takeoff", item: "b" },
      { op: "wear", item: "c" },
      { op: "wear", item: "a" },
    ]);
    expect(end.objects.find((o) => o.id === 3)?.wornMask).toBe(W.bodyArmor);
    expect(end.objects.find((o) => o.id === 1)?.wornMask).toBe(W.cloak);
  });

  it("switches melee to spellcasting: shield off, staff in hand, sword as alternate", () => {
    const start = state([
      weapon(1, "a", W.weapon),
      weapon(2, "b"),
      armor(3, "c", "shield", W.shield),
      armor(4, "d", "helmet", W.helmet),
    ]);
    const { end } = play(start, { name: "magic", slots: { weapon: 2, secondaryWeapon: 1, shield: "empty", helmet: "empty" } });
    const worn = (id: number) => end.objects.find((o) => o.id === id)?.wornMask;
    expect(worn(2)).toBe(W.weapon);
    expect(worn(1)).toBe(W.secondaryWeapon);
    expect(worn(3)).toBe(0);
    expect(worn(4)).toBe(0);
  });

  it("empties the alternate weapon when the set has none", () => {
    const start = state([weapon(1, "a", W.weapon), weapon(2, "b", W.secondaryWeapon)]);
    const { end, steps } = play(start, { name: "x", slots: { weapon: 1, secondaryWeapon: "empty" } });
    expect(steps).toEqual([{ op: "altunwield" }]);
    expect(end.objects.find((o) => o.id === 2)?.wornMask).toBe(0);
  });

  it("moves a ring to the other hand and leaves untouched slots alone", () => {
    const start = state([ring(1, "a", W.leftRing), armor(2, "b", "boots", W.boots)]);
    const { end } = play(start, { name: "x", slots: { rightRing: 1 } });
    expect(end.objects.find((o) => o.id === 1)?.wornMask).toBe(W.rightRing);
    expect(end.objects.find((o) => o.id === 2)?.wornMask).toBe(W.boots);
  });

  it("takes a wanted item out of a carried bag first", () => {
    const bag = object(9, "z", { container: { locked: null, contents: [armor(5, null as unknown as string, "helmet")], more: 0, tooDeep: false } });
    const { steps, end } = play(state([bag]), { name: "x", slots: { helmet: 5 } });
    expect(steps[0]).toEqual({ op: "loot", container: 9, out: [5], in: [] });
    expect(end.objects.find((o) => o.id === 5)?.wornMask).toBe(W.helmet);
  });

  it("skips what is not there and reports it", () => {
    const inventory = state([weapon(1, "a", W.weapon)]);
    const set: EquipmentSet = { name: "x", slots: { weapon: 99 } };
    expect(nextEquipmentSetStep(inventory, set)).toBeNull();
    expect(missingFromSet(inventory, set)).toEqual([99]);
  });
});

describe("equipment set storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps sets per game", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    });
    saveEquipmentSets(7, [{ name: "melee", slots: { weapon: 1 } }, null, null]);
    expect(loadEquipmentSets(7)[0]).toEqual({ name: "melee", slots: { weapon: 1 } });
    expect(loadEquipmentSets(8)[0]).toBeNull();
    expect(loadEquipmentSets(null)).toHaveLength(3);
  });
});

describe("setHotkeyIndex", () => {
  const key = (k: string, code: string, extra: Partial<KeyboardEvent> = {}) =>
    ({ key: k, code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });
  const idle = { busy: false, typing: false, countInProgress: false };

  it("takes the top-row 1-3 and F1-F3", () => {
    expect(setHotkeyIndex(key("1", "Digit1"), idle)).toBe(0);
    expect(setHotkeyIndex(key("3", "Digit3"), idle)).toBe(2);
    expect(setHotkeyIndex(key("F2", "F2"), idle)).toBe(1);
  });

  it("leaves other digits, the keypad and modified keys to the game", () => {
    expect(setHotkeyIndex(key("4", "Digit4"), idle)).toBeNull();
    expect(setHotkeyIndex(key("1", "Numpad1"), idle)).toBeNull();
    expect(setHotkeyIndex(key("F4", "F4"), idle)).toBeNull();
    expect(setHotkeyIndex(key("!", "Digit1", { shiftKey: true }), idle)).toBeNull();
    expect(setHotkeyIndex(key("1", "Digit1", { altKey: true }), idle)).toBeNull();
  });

  it("does nothing while the game asks, a field has the key, or a count is being typed", () => {
    expect(setHotkeyIndex(key("1", "Digit1"), { ...idle, busy: true })).toBeNull();
    expect(setHotkeyIndex(key("1", "Digit1"), { ...idle, typing: true })).toBeNull();
    expect(setHotkeyIndex(key("2", "Digit2"), { ...idle, countInProgress: true })).toBeNull();
    // an F key is never part of a count
    expect(setHotkeyIndex(key("F1", "F1"), { ...idle, countInProgress: true })).toBe(0);
  });
});
