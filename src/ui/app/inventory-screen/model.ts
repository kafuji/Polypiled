import type { InventoryOperation } from "../../../runtime/input/inventory-operation";
import {
  InventoryWornMask,
  type InventoryArmorCategory,
  type InventoryObject,
  type InventoryState,
  encumbranceThresholds,
} from "../../../runtime/inventory-state";
import type { InventoryCategoryId } from "../inventory/types";

/**
 * The inventory screen's rules: which slot an object belongs to and what a
 * drag means as game commands. Nothing here decides whether an action is
 * allowed (a curse, a cloak in the way): the screen sends the commands and
 * the game answers. Only public state is used for hints.
 */

export type EquipmentSlotId =
  | "eyewear"
  | "helmet"
  | "amulet"
  | "cloak"
  | "bodyArmor"
  | "shirt"
  | "leftRing"
  | "gloves"
  | "rightRing"
  | "weapon"
  | "boots"
  | "shield"
  | "secondaryWeapon"
  | "quiver";

export interface EquipmentSlotLayout {
  readonly id: EquipmentSlotId;
  /** CSS grid placement on the body: column 1-3, row 1-5. */
  readonly column: number;
  readonly row: number;
}

/** The slots around the body, head to feet; weapons at the bottom. */
export const equipmentSlotLayout: readonly EquipmentSlotLayout[] = [
  { id: "eyewear", column: 1, row: 1 },
  { id: "helmet", column: 2, row: 1 },
  { id: "amulet", column: 3, row: 1 },
  { id: "cloak", column: 1, row: 2 },
  { id: "bodyArmor", column: 2, row: 2 },
  { id: "shirt", column: 3, row: 2 },
  { id: "leftRing", column: 1, row: 3 },
  { id: "gloves", column: 2, row: 3 },
  { id: "rightRing", column: 3, row: 3 },
  { id: "shield", column: 1, row: 4 },
  { id: "boots", column: 2, row: 4 },
  { id: "quiver", column: 3, row: 4 },
  { id: "weapon", column: 1, row: 5 },
  { id: "secondaryWeapon", column: 3, row: 5 },
];

const slotMask: Record<EquipmentSlotId, number> = {
  eyewear: InventoryWornMask.eyewear,
  helmet: InventoryWornMask.helmet,
  amulet: InventoryWornMask.amulet,
  cloak: InventoryWornMask.cloak,
  bodyArmor: InventoryWornMask.bodyArmor,
  shirt: InventoryWornMask.shirt,
  leftRing: InventoryWornMask.leftRing,
  gloves: InventoryWornMask.gloves,
  rightRing: InventoryWornMask.rightRing,
  weapon: InventoryWornMask.weapon,
  boots: InventoryWornMask.boots,
  shield: InventoryWornMask.shield,
  secondaryWeapon: InventoryWornMask.secondaryWeapon,
  quiver: InventoryWornMask.quiver,
};

const armorSlots: Record<InventoryArmorCategory, EquipmentSlotId> = {
  bodyArmor: "bodyArmor",
  shield: "shield",
  helmet: "helmet",
  gloves: "gloves",
  boots: "boots",
  cloak: "cloak",
  shirt: "shirt",
};

/** NetHack object classes (include/objclass.h). */
export const ObjectClass = {
  weapon: 2,
  armor: 3,
  ring: 4,
  amulet: 5,
  tool: 6,
  food: 7,
  potion: 8,
  scroll: 9,
  spellbook: 10,
  wand: 11,
  coin: 12,
  gem: 13,
  rock: 14,
  ball: 15,
  chain: 16,
  venom: 17,
} as const;

/** The 52 letter slots in NetHack's order, then gold. */
export const inventoryGridLetters: readonly string[] = [
  ..."abcdefghijklmnopqrstuvwxyz",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ",
];
export const goldLetter = "$";

export function objectInSlot(state: InventoryState, slot: EquipmentSlotId): InventoryObject | null {
  const mask = slotMask[slot];
  return state.objects.find((object) => (object.wornMask & mask) !== 0) ?? null;
}

/** The slots an object fills now. */
export function slotsOf(object: InventoryObject): EquipmentSlotId[] {
  return equipmentSlotLayout
    .map((slot) => slot.id)
    .filter((slot) => (object.wornMask & slotMask[slot]) !== 0);
}

/** Worn or wielded in a slot of the screen (ball and chain, saddle are not). */
export function isEquipped(object: InventoryObject): boolean {
  return slotsOf(object).length > 0;
}

/** The slots an object could go to, from what the hero can see of it. */
export function slotsFor(object: InventoryObject): EquipmentSlotId[] {
  if (object.objectClass === ObjectClass.armor) {
    return object.armorCategory ? [armorSlots[object.armorCategory]] : [];
  }
  if (object.objectClass === ObjectClass.ring) return ["leftRing", "rightRing"];
  if (object.objectClass === ObjectClass.amulet) return ["amulet"];
  if (object.eyewear) return ["eyewear"];
  if (object.objectClass === ObjectClass.coin) return [];
  if (object.objectClass === ObjectClass.weapon || object.objectClass === ObjectClass.gem
    || object.objectClass === ObjectClass.rock) {
    return ["weapon", "secondaryWeapon", "quiver"];
  }
  // anything else can be wielded (apply-able tools such as pick-axes too)
  return ["weapon", "secondaryWeapon"];
}

/** The layers over a body slot, outermost first: they must come off before it. */
const layersOver: Partial<Record<EquipmentSlotId, EquipmentSlotId[]>> = {
  bodyArmor: ["cloak"],
  shirt: ["cloak", "bodyArmor"],
};

function takeOff(object: InventoryObject, slot: EquipmentSlotId): InventoryOperation | null {
  if (!object.letter) return null;
  switch (slot) {
    case "weapon":
      return { op: "wield", item: "-" };
    case "quiver":
      return { op: "quiver", item: "-" };
    case "secondaryWeapon":
      return { op: "altunwield" };
    case "amulet":
    case "leftRing":
    case "rightRing":
    case "eyewear":
      return { op: "remove", item: object.letter };
    default:
      return { op: "takeoff", item: object.letter };
  }
}

function putOn(object: InventoryObject, slot: EquipmentSlotId, state: InventoryState): InventoryOperation[] {
  const letter = object.letter!;
  switch (slot) {
    case "weapon":
      return [{ op: "wield", item: letter }];
    case "secondaryWeapon":
      // the weapon in hand trades places; anything else is readied directly
      if ((object.wornMask & InventoryWornMask.weapon) !== 0) return [{ op: "swap" }];
      return [{ op: "alternate", item: letter }];
    case "quiver":
      return [{ op: "quiver", item: letter }];
    case "leftRing":
    case "rightRing":
      return [{ op: "puton", item: letter, hand: slot === "leftRing" ? "left" : "right" }];
    case "amulet":
    case "eyewear":
      return [{ op: "puton", item: letter }];
    default:
      void state;
      return [{ op: "wear", item: letter }];
  }
}

export interface DropPlan {
  /** Commands to send, in order; empty when the drop means nothing. */
  readonly operations: readonly InventoryOperation[];
  /** Other worn items that come off first (shown as a hint). */
  readonly removes: readonly InventoryObject[];
  /** The drop cannot be done from the screen (no such command). */
  readonly unsupported?: boolean;
}

const noPlan: DropPlan = { operations: [], removes: [] };

/** An object dropped onto an equipment slot. */
export function planEquip(state: InventoryState, object: InventoryObject, slot: EquipmentSlotId): DropPlan {
  if (!object.letter || !slotsFor(object).includes(slot)) return noPlan;
  if ((object.wornMask & slotMask[slot]) !== 0) return noPlan; // already there
  const operations: InventoryOperation[] = [];
  const removes: InventoryObject[] = [];
  const removed: Array<[InventoryObject, EquipmentSlotId]> = [];

  // the object itself leaves the slot it is in now (a ring moving hands)
  for (const from of slotsOf(object)) {
    if (from === "weapon" && slot === "secondaryWeapon") continue; // swap handles it
    const op = takeOff(object, from);
    if (!op) return { operations: [], removes: [], unsupported: true };
    operations.push(op);
  }
  for (const outer of layersOver[slot] ?? []) {
    const worn = objectInSlot(state, outer);
    if (worn && worn !== object) removed.push([worn, outer]);
  }
  const occupant = objectInSlot(state, slot);
  if (occupant && occupant !== object && slot !== "weapon" && slot !== "secondaryWeapon" && slot !== "quiver") {
    removed.push([occupant, slot]);
  }
  for (const [worn, wornSlot] of removed) {
    const op = takeOff(worn, wornSlot);
    if (!op) return { operations: [], removes: [], unsupported: true };
    operations.push(op);
    removes.push(worn);
  }
  operations.push(...putOn(object, slot, state));
  // outer layers go back on, innermost first
  for (const [worn, wornSlot] of [...removed].reverse()) {
    if (wornSlot !== slot) operations.push(...putOn(worn, wornSlot, state));
  }
  return { operations, removes };
}

/** An equipped object dragged off its slot. */
export function planUnequip(object: InventoryObject): DropPlan {
  const operations: InventoryOperation[] = [];
  for (const slot of slotsOf(object)) {
    const op = takeOff(object, slot);
    if (!op) return { operations: [], removes: [], unsupported: true };
    operations.push(op);
  }
  return { operations, removes: [] };
}

/** An object dropped onto a letter slot: #adjust (move, swap or merge). */
export function planMove(object: InventoryObject, toLetter: string): DropPlan {
  if (!object.letter || object.letter === toLetter) return noPlan;
  if ((toLetter === goldLetter) !== (object.objectClass === ObjectClass.coin)) return noPlan;
  return { operations: [{ op: "adjust", from: object.letter, to: toLetter }], removes: [] };
}

/** Double click: put on or take off, whichever applies. */
export function planToggle(state: InventoryState, object: InventoryObject): DropPlan {
  if (isEquipped(object)) return planUnequip(object);
  const slots = slotsFor(object);
  if (object.objectClass === ObjectClass.ring) {
    const free = slots.find((slot) => !objectInSlot(state, slot));
    return free ? planEquip(state, object, free) : noPlan;
  }
  if (object.objectClass === ObjectClass.armor || object.objectClass === ObjectClass.amulet || object.eyewear) {
    return slots[0] ? planEquip(state, object, slots[0]) : noPlan;
  }
  if (object.objectClass === ObjectClass.weapon) return planEquip(state, object, "weapon");
  return noPlan;
}

export interface WeightSummary {
  readonly weight: number;
  readonly capacity: number;
  /** The level now (0 unencumbered ... 5 overloaded). */
  readonly level: number;
  /** The weight at which the next level starts; null when overloaded. */
  readonly nextThreshold: number | null;
  /** How much more fits before the next level. */
  readonly remaining: number | null;
  /** 0..1 within the current level's band, for the bar. */
  readonly fill: number;
}

export function weightSummary(state: Pick<InventoryState, "weight" | "capacity" | "encumbrance">): WeightSummary {
  const thresholds = encumbranceThresholds(state.capacity);
  const level = state.encumbrance;
  const next = level < thresholds.length ? thresholds[level] : null;
  const bandStart = level === 0 ? 0 : thresholds[level - 1];
  const fill = next === null ? 1 : Math.max(0, Math.min(1, (state.weight - bandStart) / Math.max(1, next - bandStart)));
  return {
    weight: state.weight,
    capacity: state.capacity,
    level,
    nextThreshold: next,
    remaining: next === null ? null : Math.max(0, next - state.weight),
    fill,
  };
}

/** The old inventory's category, for the shared context actions. */
export function categoryOf(object: InventoryObject): InventoryCategoryId {
  switch (object.objectClass) {
    case ObjectClass.weapon: return "weapons";
    case ObjectClass.armor: return "armor";
    case ObjectClass.ring: return "rings";
    case ObjectClass.amulet: return "amulets";
    case ObjectClass.tool: return "tools";
    case ObjectClass.food: return "comestibles";
    case ObjectClass.potion: return "potions";
    case ObjectClass.scroll: return "scrolls";
    case ObjectClass.spellbook: return "spellbooks";
    case ObjectClass.wand: return "wands";
    case ObjectClass.coin: return "coins";
    case ObjectClass.gem: return "gems_stones";
    case ObjectClass.rock: return "boulders_statues";
    case ObjectClass.ball: return "iron_balls";
    case ObjectClass.chain: return "chains";
    case ObjectClass.venom: return "venoms";
    default: return "illegal_objects";
  }
}

/** One kind of thing in the "by kind" view: its class and what is carried of it, by letter. */
export interface ClassGroup {
  readonly objectClass: number;
  readonly objects: readonly InventoryObject[];
}

/** The pack by kind, in the game's class order (inv_order); kinds it does not list come last. */
export function groupByClass(state: InventoryState): ClassGroup[] {
  const rank = (letter: string | null) => (letter ? inventoryGridLetters.indexOf(letter) : -1);
  const byClass = new Map<number, InventoryObject[]>();
  for (const object of state.objects) {
    if (!object.letter) continue;
    const list = byClass.get(object.objectClass) ?? [];
    list.push(object);
    byClass.set(object.objectClass, list);
  }
  const unlisted = [...byClass.keys()].filter((c) => !state.classOrder.includes(c)).sort((a, b) => a - b);
  return [...state.classOrder, ...unlisted]
    .filter((objectClass) => byClass.has(objectClass))
    .map((objectClass) => ({
      objectClass,
      objects: byClass.get(objectClass)!.sort((a, b) => rank(a.letter) - rank(b.letter)),
    }));
}

/**
 * Objects without letters (a container's contents) in the pack's class order,
 * unlisted classes last; within a class they keep the order the core gave.
 */
export function sortByClass<T extends { readonly objectClass: number }>(objects: readonly T[], classOrder: readonly number[]): T[] {
  const rank = (objectClass: number) => {
    const index = classOrder.indexOf(objectClass);
    return index < 0 ? classOrder.length + objectClass : index;
  };
  return objects
    .map((object, index) => ({ object, index }))
    .sort((a, b) => rank(a.object.objectClass) - rank(b.object.objectClass) || a.index - b.index)
    .map(({ object }) => object);
}

/** The objects by letter, for the grid. */
export function objectsByLetter(state: InventoryState): Map<string, InventoryObject> {
  const map = new Map<string, InventoryObject>();
  for (const object of state.objects) if (object.letter) map.set(object.letter, object);
  return map;
}

/** Shared with the equipment sets (equipment-sets.ts). */
export const takeOffOperation = takeOff;
export function putOnOperations(object: InventoryObject, slot: EquipmentSlotId, state: InventoryState): InventoryOperation[] {
  return putOn(object, slot, state);
}

function findCarried(state: InventoryState, letter: string): InventoryObject | null {
  return state.objects.find((object) => object.letter === letter) ?? null;
}

/**
 * Game turns a plan should take, as far as the hero can tell: one per
 * command, plus the delay of armor being put on or taken off; #adjust takes
 * none. An estimate (speed, interruptions and the game's choices change it).
 */
export function estimateTurns(state: InventoryState, operations: readonly InventoryOperation[]): number {
  let turns = 0;
  for (const operation of operations) {
    switch (operation.op) {
      case "adjust":
        break;
      case "wear":
      case "takeoff": {
        const object = findCarried(state, operation.item);
        turns += 1 + (object?.armorDelay ?? 0);
        break;
      }
      default:
        turns += 1;
    }
  }
  return turns;
}

/** Picking up something here; count 0 is the whole stack. */
export function planPickup(objects: readonly InventoryObject[], count = 0): DropPlan {
  if (objects.length === 0) return noPlan;
  return {
    operations: [{ op: "pickup", items: objects.map((object) => ({ id: object.id, count: objects.length === 1 ? count : 0 })) }],
    removes: [],
  };
}

/** Dropping a carried object here; worn things come off first. */
export function planDrop(object: InventoryObject, count = 0): DropPlan {
  const operations: InventoryOperation[] = [];
  if (isEquipped(object)) {
    const off = planUnequip(object);
    if (off.unsupported) return off;
    operations.push(...off.operations);
  }
  operations.push({ op: "drop", items: [{ id: object.id, count }] });
  return { operations, removes: [] };
}

/** What waits to move when the open container's changes are made. */
export interface ContainerStaging {
  readonly containerId: number;
  /** Contents to take out. */
  readonly out: readonly number[];
  /** Carried objects to put in. */
  readonly in: readonly number[];
}

/** The container's one action: take out, then put in (nothing staged opens it). */
export function planContainer(staging: ContainerStaging): DropPlan {
  return {
    operations: [{ op: "loot", container: staging.containerId, out: [...staging.out], in: [...staging.in] }],
    removes: [],
  };
}

/** What the game refuses to put in a container, or would destroy it. */
export type PutInRefusal = "self" | "worn" | "attached" | "explodes";

const wornNotStashable =
  InventoryWornMask.bodyArmor | InventoryWornMask.cloak | InventoryWornMask.helmet | InventoryWornMask.shield |
  InventoryWornMask.gloves | InventoryWornMask.boots | InventoryWornMask.shirt | InventoryWornMask.amulet |
  InventoryWornMask.leftRing | InventoryWornMask.rightRing | InventoryWornMask.eyewear;
const attachedMask = InventoryWornMask.ball | InventoryWornMask.chain;
/** Known magic that blows up a bag of holding (mbag_explodes), as the core names it once identified. */
const explosive = /^(?:bags? of (?:holding|tricks)|wands? of cancellation)$/;

function carriesExplosive(object: InventoryObject): boolean {
  if (object.baseName && explosive.test(object.baseName)) return true;
  return (object.container?.contents ?? []).some(carriesExplosive);
}

/**
 * Why an object cannot go into the open container (in_container()): the
 * container itself, worn armor or accessories, the ball and chain. A wielded
 * weapon or the quiver is fine (the game lets go of it). Putting known magic
 * into a known bag of holding is refused too, as it would blow up.
 */
export function putInRefusal(container: InventoryObject, object: InventoryObject): PutInRefusal | null {
  if (object.id === container.id) return "self";
  if (object.wornMask & wornNotStashable) return "worn";
  if (object.wornMask & attachedMask) return "attached";
  if (container.baseName === "bag of holding" && carriesExplosive(object)) return "explodes";
  return null;
}

/** Anything that looks like a container (an unidentified bag of tricks too). */
export function isContainerLike(object: InventoryObject): boolean {
  return object.container !== null;
}

/** Finds a carried or floor container by id. */
export function findContainer(state: InventoryState, id: number): InventoryObject | null {
  return [...state.objects, ...state.floor].find((object) => object.id === id && object.container) ?? null;
}
