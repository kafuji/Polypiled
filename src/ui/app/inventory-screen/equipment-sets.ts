import type { InventoryOperation } from "../../../runtime/input/inventory-operation";
import type { InventoryObject, InventoryState } from "../../../runtime/inventory-state";
import type { InventoryProcedure } from "../../../game/engine/ui/inventory-procedures";
import {
  type EquipmentSlotId,
  equipmentSlotLayout,
  objectInSlot,
  putOnOperations,
  slotsOf,
  takeOffOperation,
} from "./model";

/**
 * Equipment sets: a named loadout (for spellcasting, for melee, ...) that
 * one press puts on. Each slot holds an object (by the game's o_id), "empty"
 * (take off what is there), or nothing (leave the slot alone).
 *
 * Applying a set runs one game command at a time (InventoryProcedures): each
 * step is chosen from the inventory as it is then, so a curse, a refusal or
 * a hostile coming into view stops it where it stands, and applying it
 * again carries on from there.
 */

export type EquipmentSetSlot = number | "empty";

export interface EquipmentSet {
  readonly name: string;
  readonly slots: Partial<Record<EquipmentSlotId, EquipmentSetSlot>>;
}

export const EQUIPMENT_SET_COUNT = 3;

const STORAGE_KEY = "nh3d.equipmentSets.v1";
const MAX_GAMES = 20;

interface StoredSets {
  /** game id (the core's start time) -> sets, most recently used last */
  readonly games: Record<string, { readonly sets: (EquipmentSet | null)[]; readonly usedAt: number }>;
}

function readStore(): StoredSets {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredSets) : null;
    if (parsed && typeof parsed === "object" && parsed.games && typeof parsed.games === "object") return parsed;
  } catch {
    // unreadable storage: start over
  }
  return { games: {} };
}

function isSlotValue(value: unknown): value is EquipmentSetSlot {
  return value === "empty" || (typeof value === "number" && Number.isInteger(value) && value > 0);
}

function normalizeSet(raw: unknown): EquipmentSet | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { name?: unknown; slots?: unknown };
  const slots: Partial<Record<EquipmentSlotId, EquipmentSetSlot>> = {};
  if (candidate.slots && typeof candidate.slots === "object") {
    for (const { id } of equipmentSlotLayout) {
      const value = (candidate.slots as Record<string, unknown>)[id];
      if (isSlotValue(value)) slots[id] = value;
    }
  }
  return { name: typeof candidate.name === "string" ? candidate.name.slice(0, 24) : "", slots };
}

/** The sets saved for this game (kept on this device, per game). */
export function loadEquipmentSets(gameId: number | null): (EquipmentSet | null)[] {
  const empty = Array.from({ length: EQUIPMENT_SET_COUNT }, () => null);
  if (gameId === null) return empty;
  const entry = readStore().games[String(gameId)];
  if (!entry || !Array.isArray(entry.sets)) return empty;
  return empty.map((_, index) => normalizeSet(entry.sets[index]));
}

export function saveEquipmentSets(gameId: number | null, sets: readonly (EquipmentSet | null)[]): void {
  if (gameId === null) return;
  try {
    const store = readStore();
    const games = { ...store.games, [String(gameId)]: { sets: [...sets], usedAt: Date.now() } };
    const kept = Object.entries(games)
      .sort(([, a], [, b]) => b.usedAt - a.usedAt)
      .slice(0, MAX_GAMES);
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ games: Object.fromEntries(kept) }));
  } catch {
    // storage full or blocked: the sets live until the page closes
  }
}

/**
 * The equipment as it is now. Empty slots are recorded as "empty", except
 * the quiver, which is left alone.
 */
export function recordEquipmentSet(state: InventoryState, name: string): EquipmentSet {
  const slots: Partial<Record<EquipmentSlotId, EquipmentSetSlot>> = {};
  for (const { id } of equipmentSlotLayout) {
    const object = objectInSlot(state, id);
    if (object) slots[id] = object.id;
    else if (id !== "quiver") slots[id] = "empty";
  }
  return { name, slots };
}

/** Outer layers first when taking off, inner first when putting on. */
const removalOrder: readonly EquipmentSlotId[] = [
  "cloak", "bodyArmor", "shirt", "gloves", "leftRing", "rightRing", "helmet", "boots", "shield", "amulet", "eyewear",
];
const putOnOrder: readonly EquipmentSlotId[] = [
  "shirt", "bodyArmor", "cloak", "leftRing", "rightRing", "gloves", "helmet", "boots", "shield", "amulet", "eyewear",
];
const layersOver: Partial<Record<EquipmentSlotId, readonly EquipmentSlotId[]>> = {
  bodyArmor: ["cloak"],
  shirt: ["cloak", "bodyArmor"],
};

function carried(state: InventoryState, id: number): InventoryObject | null {
  return state.objects.find((object) => object.id === id) ?? null;
}

/** A carried container whose known contents hold the object. */
function bagHolding(state: InventoryState, id: number): InventoryObject | null {
  return (
    state.objects.find((object) => object.container?.contents?.some((inside) => inside.id === id)) ?? null
  );
}

/** What the set wants in a slot, given what can be had; undefined = leave alone. */
function wanted(set: EquipmentSet, slot: EquipmentSlotId, state: InventoryState): number | "empty" | undefined {
  const value = set.slots[slot];
  if (value === undefined || value === "empty") return value;
  return carried(state, value) || bagHolding(state, value) ? value : undefined;
}

function satisfied(set: EquipmentSet, slot: EquipmentSlotId, state: InventoryState): boolean {
  const want = wanted(set, slot, state);
  if (want === undefined) return true;
  const current = objectInSlot(state, slot);
  return want === "empty" ? current === null : current?.id === want;
}

/** The next command that brings the equipment closer to the set; null when it matches. */
export function nextEquipmentSetStep(state: InventoryState, set: EquipmentSet): InventoryOperation | null {
  // fetch wanted things from a carried bag first
  for (const { id: slot } of equipmentSlotLayout) {
    const want = wanted(set, slot, state);
    if (typeof want === "number" && !carried(state, want)) {
      const bag = bagHolding(state, want);
      if (bag) return { op: "loot", container: bag.id, out: [want], in: [] };
    }
  }

  // take off what is wrong, what is in the way of an inner layer, and
  // what the set wants somewhere else (a ring changing hands)
  for (const slot of removalOrder) {
    const current = objectInSlot(state, slot);
    if (!current) continue;
    const wrongHere = !satisfied(set, slot, state);
    const blocksInner = Object.entries(layersOver).some(
      ([inner, outers]) => outers?.includes(slot) && !satisfied(set, inner as EquipmentSlotId, state),
    );
    const wantedElsewhere = equipmentSlotLayout.some(
      ({ id: other }) => other !== slot && wanted(set, other, state) === current.id,
    );
    if (wrongHere || blocksInner || wantedElsewhere) {
      const operation = takeOffOperation(current, slot);
      if (operation) return operation;
    }
  }

  // put on, inner layers first
  for (const slot of putOnOrder) {
    const want = wanted(set, slot, state);
    if (typeof want !== "number" || objectInSlot(state, slot)) continue;
    const object = carried(state, want);
    if (!object?.letter || slotsOf(object).length > 0) continue;
    return putOnOperations(object, slot, state)[0] ?? null;
  }

  // weapons: the alternate weapon first (wield it, then swap), then the hand
  const primary = objectInSlot(state, "weapon");
  const alternate = objectInSlot(state, "secondaryWeapon");
  const wantAlternate = wanted(set, "secondaryWeapon", state);
  if (wantAlternate === "empty" && alternate) return { op: "altunwield" };
  if (typeof wantAlternate === "number" && alternate?.id !== wantAlternate) {
    const object = carried(state, wantAlternate);
    if (object?.letter) {
      return primary?.id === wantAlternate ? { op: "swap" } : { op: "wield", item: object.letter };
    }
  }
  const wantPrimary = wanted(set, "weapon", state);
  if (wantPrimary !== undefined && !satisfied(set, "weapon", state)) {
    if (wantPrimary === "empty") return { op: "wield", item: "-" };
    const object = carried(state, wantPrimary);
    if (object?.letter) {
      if (alternate?.id === wantPrimary && set.slots.secondaryWeapon === undefined) return { op: "swap" };
      return { op: "wield", item: object.letter };
    }
  }
  const wantQuiver = wanted(set, "quiver", state);
  if (wantQuiver !== undefined && !satisfied(set, "quiver", state)) {
    if (wantQuiver === "empty") return { op: "quiver", item: "-" };
    const object = carried(state, wantQuiver);
    if (object?.letter) return { op: "quiver", item: object.letter };
  }
  return null;
}

export function equipmentSetProcedure(set: EquipmentSet, label: string): InventoryProcedure {
  return { label, next: (state) => nextEquipmentSetStep(state, set) };
}

/** Wanted objects that are neither carried nor in a carried bag the hero has looked into. */
export function missingFromSet(state: InventoryState, set: EquipmentSet): number[] {
  return Object.values(set.slots).filter(
    (value): value is number => typeof value === "number" && !carried(state, value) && !bagHolding(state, value),
  );
}
