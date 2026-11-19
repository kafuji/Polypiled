/**
 * The hero's inventory, sent by the game core whenever it changes
 * (core/NetHack/win/shim/nh3d_knowledge.c, notification "shim_inventory").
 *
 * Every field is what the game would tell the player: BUC only when known,
 * enchantment and charges only where the game's own name shows them, erosion
 * as the words the name uses. Objects come by appearance (public glyph and
 * tile), never by type. A container whose contents the hero knows lists
 * them; otherwise `contents` is null.
 *
 * Weights are those of what the hero carries (docs/inventory-screen-design.md,
 * section 4): each top-level object, contents included, and the total.
 * Objects inside containers have no weight of their own here.
 */

/** NetHack worn-mask bits (include/prop.h). */
export const InventoryWornMask = {
  bodyArmor: 0x00000001,
  cloak: 0x00000002,
  helmet: 0x00000004,
  shield: 0x00000008,
  gloves: 0x00000010,
  boots: 0x00000020,
  shirt: 0x00000040,
  weapon: 0x00000100,
  quiver: 0x00000200,
  secondaryWeapon: 0x00000400,
  amulet: 0x00010000,
  leftRing: 0x00020000,
  rightRing: 0x00040000,
  eyewear: 0x00080000,
  saddle: 0x00100000,
  ball: 0x00200000,
  chain: 0x00400000,
} as const;

export type InventoryWornSlot = keyof typeof InventoryWornMask;

export type InventoryBuc = "blessed" | "uncursed" | "cursed";

/** Armor categories in NetHack's order (enum obj_armor_types). */
export const inventoryArmorCategories = ["bodyArmor", "shield", "helmet", "gloves", "boots", "cloak", "shirt"] as const;
export type InventoryArmorCategory = (typeof inventoryArmorCategories)[number];

export interface InventoryErosion {
  /** 1 (plain), 2 ("very"), 3 ("thoroughly"). */
  readonly level: number;
  /** eroded: "rust" | "crack" | "burn"; eroded2: "corrode" | "rot". */
  readonly kind: string;
}

export interface InventoryContainer {
  /** Known lock state of a box; null when unknown or not a box. */
  readonly locked: boolean | null;
  /** What the hero knows is inside; null when the contents are unknown. */
  readonly contents: readonly InventoryObject[] | null;
  /** Objects beyond the listed ones (the core lists at most 200 per container). */
  readonly more: number;
  /** Nested too deep for the core to list (contents is null although known). */
  readonly tooDeep: boolean;
}

export interface InventoryObject {
  /** The game's object id (o_id): stable while the object exists, says nothing about its type. */
  readonly id: number;
  /** Inventory letter; null inside containers. */
  readonly letter: string | null;
  /** As the game names it ("an uncursed +1 long sword (weapon in hand)"). */
  readonly name: string;
  /** NetHack object class (WEAPON_CLASS = 2, ARMOR_CLASS = 3 ...). */
  readonly objectClass: number;
  readonly glyph: number;
  readonly tileIndex: number | null;
  readonly quantity: number;
  /** Where this armor is worn (public: look-alike armor shares its category); null for non-armor. */
  readonly armorCategory: InventoryArmorCategory | null;
  /** A blindfold, towel or lenses, worn over the eyes. */
  readonly eyewear: boolean;
  /** Carried weight, contents included; null inside containers. */
  readonly weight: number | null;
  /** owornmask bits; 0 when not worn or wielded. */
  readonly wornMask: number;
  readonly donning: boolean;
  readonly doffing: boolean;
  /** Armor that is the hero's own skin (polymorphed into a dragon). */
  readonly skin: boolean;
  readonly buc: InventoryBuc | null;
  readonly enchantment: number | null;
  readonly charges: number | null;
  readonly recharged: number | null;
  readonly eroded: InventoryErosion | null;
  readonly eroded2: InventoryErosion | null;
  readonly erodeproof: boolean;
  readonly poisoned: boolean;
  readonly greased: boolean;
  readonly lit: boolean;
  readonly unpaid: boolean;
  readonly named: boolean;
  /** Present for anything that looks like a container. */
  readonly container: InventoryContainer | null;
}

export interface InventoryState {
  /** Total carried weight, as the game counts it (100 coins weigh 1). */
  readonly weight: number;
  /** weight_cap(): carrying more than this is Burdened. */
  readonly capacity: number;
  /** 0 unencumbered ... 5 overloaded (near_capacity()). */
  readonly encumbrance: number;
  readonly twoWeapon: boolean;
  readonly punished: boolean;
  readonly objects: readonly InventoryObject[];
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const bucValues: ReadonlySet<string> = new Set(["blessed", "uncursed", "cursed"]);

function parseErosion(raw: unknown): InventoryErosion | null {
  if (!isRecord(raw) || !isInt(raw.level) || raw.level <= 0 || typeof raw.kind !== "string") return null;
  return { level: Math.min(raw.level, 3), kind: raw.kind };
}

function parseObjectList(raw: unknown, depth: number): InventoryObject[] | null {
  if (!Array.isArray(raw)) return null;
  const objects: InventoryObject[] = [];
  for (const entry of raw) {
    const object = parseObject(entry, depth);
    if (!object) return null;
    objects.push(object);
  }
  return objects;
}

function parseContainer(raw: unknown, depth: number): InventoryContainer | null | undefined {
  if (raw === undefined) return null;
  if (!isRecord(raw)) return undefined;
  let contents: InventoryObject[] | null = null;
  if (raw.contents !== null && raw.contents !== undefined) {
    contents = parseObjectList(raw.contents, depth + 1);
    if (!contents) return undefined;
  }
  return {
    locked: typeof raw.locked === "boolean" ? raw.locked : null,
    contents,
    more: isInt(raw.more) && raw.more > 0 ? raw.more : 0,
    tooDeep: raw.deep === true,
  };
}

function parseObject(raw: unknown, depth: number): InventoryObject | null {
  if (!isRecord(raw) || !isInt(raw.id) || typeof raw.name !== "string" || !isInt(raw.glyph)) return null;
  const container = parseContainer(raw.container, depth);
  if (container === undefined) return null;
  const topLevel = depth === 0;
  const letter = topLevel && typeof raw.letter === "string" && raw.letter.length === 1 ? raw.letter : null;
  if (topLevel && letter === null) return null;
  return {
    id: raw.id,
    letter,
    name: raw.name,
    objectClass: isInt(raw.class) ? raw.class : 0,
    glyph: raw.glyph,
    tileIndex: isInt(raw.tile) && raw.tile >= 0 ? raw.tile : null,
    quantity: isInt(raw.quan) && raw.quan > 0 ? raw.quan : 1,
    armorCategory: isInt(raw.armor) ? inventoryArmorCategories[raw.armor] ?? null : null,
    eyewear: raw.eyewear === true,
    weight: topLevel && isInt(raw.weight) && raw.weight >= 0 ? raw.weight : null,
    wornMask: topLevel && isInt(raw.worn) ? raw.worn >>> 0 : 0,
    donning: raw.donning === true,
    doffing: raw.doffing === true,
    skin: raw.skin === true,
    buc: typeof raw.buc === "string" && bucValues.has(raw.buc) ? (raw.buc as InventoryBuc) : null,
    enchantment: isInt(raw.enchantment) ? raw.enchantment : null,
    charges: isInt(raw.charges) ? raw.charges : null,
    recharged: isInt(raw.recharged) ? raw.recharged : null,
    eroded: parseErosion(raw.eroded),
    eroded2: parseErosion(raw.eroded2),
    erodeproof: raw.erodeproof === true,
    poisoned: raw.poisoned === true,
    greased: raw.greased === true,
    lit: raw.lit === true,
    unpaid: raw.unpaid === true,
    named: raw.named === true,
    container,
  };
}

/** Reads the core's JSON; null for anything malformed or of another version. */
export function parseInventoryState(raw: unknown): InventoryState | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data) || data.v !== 1) return null;
  if (!isInt(data.weight) || !isInt(data.capacity) || !isInt(data.encumbrance)) return null;
  const objects = parseObjectList(data.objects, 0);
  if (!objects) return null;
  return {
    weight: data.weight,
    capacity: Math.max(1, data.capacity),
    encumbrance: Math.max(0, Math.min(5, data.encumbrance)),
    twoWeapon: data.twoweapon === true,
    punished: data.punished === true,
    objects,
  };
}

/** The slots an object occupies (an object can fill two: a ring is never on both hands). */
export function inventoryWornSlots(object: Pick<InventoryObject, "wornMask">): InventoryWornSlot[] {
  return (Object.keys(InventoryWornMask) as InventoryWornSlot[]).filter(
    (slot) => (object.wornMask & InventoryWornMask[slot]) !== 0,
  );
}

/**
 * The carried weight at which each encumbrance level starts to apply
 * (calc_capacity(): level n while weight - capacity is within
 * ((n-1)·capacity/2, n·capacity/2], integer arithmetic). Index 0 is the
 * Burdened threshold; the array ends with Overloaded.
 */
export function encumbranceThresholds(capacity: number): number[] {
  const wc = Math.max(1, Math.floor(capacity));
  const thresholds: number[] = [];
  for (let level = 1; level <= 5; level++) {
    // smallest excess wt with floor(wt * 2 / wc) + 1 >= level
    const excess = level === 1 ? 1 : Math.ceil(((level - 1) * wc) / 2);
    thresholds.push(wc + excess);
  }
  return thresholds;
}

/** How much more the hero can carry before the next encumbrance level; null when already overloaded. */
export function weightUntilNextEncumbrance(state: Pick<InventoryState, "weight" | "capacity">): {
  level: number;
  threshold: number;
  remaining: number;
} | null {
  const thresholds = encumbranceThresholds(state.capacity);
  for (let index = 0; index < thresholds.length; index++) {
    if (state.weight < thresholds[index]) {
      return { level: index + 1, threshold: thresholds[index], remaining: thresholds[index] - state.weight };
    }
  }
  return null;
}
