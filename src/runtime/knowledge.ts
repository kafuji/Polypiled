/**
 * Player knowledge frames: what the hero can know about the map, the
 * monsters they sense, visible lights, their own state and the level, sent by
 * the game core after each map display (core/NetHack/win/shim/nh3d_knowledge.c).
 *
 * The core only ever writes what the window port could legitimately show or
 * what its display is based on: objects are given by tile (appearance), never
 * by glyph number, terrain is the last seen type with secret doors shown as
 * walls, and lighting is reported only for locations in sight. See
 * docs/player-knowledge-interface.md.
 */

export const KNOWLEDGE_FORMAT_VERSION = 2;

/**
 * Version 1 had the last four level words reserved (always 0), which decode
 * as no special level, no attacks and no hostiles in view.
 */
const OLDEST_READABLE_FORMAT_VERSION = 1;

/** Map size the frame covers; column 0 is never used by NetHack. */
export const KNOWLEDGE_COLUMNS = 80;
export const KNOWLEDGE_ROWS = 21;

const HEADER_WORDS = 8;
const HERO_WORDS = 8;
const LEVEL_WORDS = 8;
export const KNOWLEDGE_CELL_WORDS = 4;
const MONSTER_WORDS = 4;
const LIGHT_WORDS = 4;
const FIXED_WORDS = HEADER_WORDS + HERO_WORDS + LEVEL_WORDS;
const NO_TILE = 0xffff;

/** Vision bits of a cell. Lit bits are only set for locations in sight. */
export const KnowledgeVision = {
  couldSee: 0x01,
  canSee: 0x02,
  /** Lit by a light source (a lamp, a glowing monster), in sight. */
  tempLit: 0x04,
  /** A lit location (a lit room, a lit corridor), in sight. */
  lit: 0x08,
  /** The hero remembers the location as lit. */
  wasLit: 0x10,
} as const;

/** What a glyph shows. */
export const KnowledgeGlyphKind = {
  unexplored: 0,
  nothing: 1,
  terrain: 2,
  object: 3,
  monster: 4,
  invisible: 5,
  warning: 6,
  trap: 7,
  effect: 8,
  statue: 9,
  body: 10,
} as const;

/** NetHack 5.0 levl_typ_types (include/rm.h). Secret doors and corridors never appear. */
export const KnowledgeTerrain = {
  stone: 0,
  vwall: 1,
  hwall: 2,
  tlcorner: 3,
  trcorner: 4,
  blcorner: 5,
  brcorner: 6,
  crosswall: 7,
  tuwall: 8,
  tdwall: 9,
  tlwall: 10,
  trwall: 11,
  dbwall: 12,
  tree: 13,
  pool: 16,
  moat: 17,
  water: 18,
  drawbridgeUp: 19,
  lavaPool: 20,
  lavaWall: 21,
  ironBars: 22,
  door: 23,
  corridor: 24,
  room: 25,
  stairs: 26,
  ladder: 27,
  fountain: 28,
  throne: 29,
  sink: 30,
  grave: 31,
  altar: 32,
  ice: 33,
  drawbridgeDown: 34,
  air: 35,
  cloud: 36,
} as const;

export function isWallTerrain(terrain: number): boolean {
  return terrain >= KnowledgeTerrain.vwall && terrain <= KnowledgeTerrain.dbwall;
}

/** Floor a room's light falls on: everything walkable inside a room. */
export function isRoomFloorTerrain(terrain: number): boolean {
  return terrain === KnowledgeTerrain.room || (terrain >= KnowledgeTerrain.stairs && terrain <= KnowledgeTerrain.ice) ||
    terrain === KnowledgeTerrain.drawbridgeDown || terrain === KnowledgeTerrain.door;
}

export type KnowledgeSense = "sight" | "sensed" | "detected" | "warning" | "remembered-invisible";

const SENSES: Readonly<Record<number, KnowledgeSense>> = {
  1: "sight",
  2: "sensed",
  3: "detected",
  4: "warning",
  5: "remembered-invisible",
};

/** Light sources by how they look to the hero. */
export type KnowledgeLightKind =
  | "other"
  | "candle"
  | "lamp"
  | "lantern"
  | "magic-lamp"
  | "sunsword"
  | "potion"
  | "monster";

const LIGHT_KINDS: readonly KnowledgeLightKind[] = [
  "other", "candle", "lamp", "lantern", "magic-lamp", "sunsword", "potion", "monster",
];

export interface KnowledgeHero {
  readonly x: number;
  readonly y: number;
  /** Direction of the last move, each -1..1. */
  readonly dx: number;
  readonly dy: number;
  readonly blind: boolean;
  readonly hallucinating: boolean;
  readonly underwater: boolean;
  readonly swallowed: boolean;
  readonly buried: boolean;
  readonly levitating: boolean;
  readonly flying: boolean;
  readonly riding: boolean;
  /** Invisible without see invisible: the hero cannot see themself. */
  readonly unseenSelf: boolean;
  readonly polymorphed: boolean;
  /** Tile shown at the hero's position. */
  readonly tileIndex: number | null;
  /** Monster glyph shown at the hero's position, if it shows one. */
  readonly glyph: number | null;
  readonly steedId: number | null;
  readonly swallowerId: number | null;
}

/** Special levels the core reports (version 2); see nh3d_special_level(). */
export type KnowledgeSpecialLevel =
  | "medusa"
  | "castle"
  | "valley"
  | "sanctum"
  | "ludios"
  | "vlad-tower"
  | "wizard-tower"
  | "quest-home"
  | "earth"
  | "air"
  | "fire"
  | "water"
  | "astral";

const SPECIAL_LEVELS: readonly (KnowledgeSpecialLevel | null)[] = [
  null, "medusa", "castle", "valley", "sanctum", "ludios", "vlad-tower", "wizard-tower",
  "quest-home", "earth", "air", "fire", "water", "astral",
];

/** Hostile monsters the hero can spot that the map shows as monsters. */
export interface KnowledgeHostiles {
  readonly count: number;
  /** Highest difficulty of what they look like; 0 while hallucinating. */
  readonly maxDifficulty: number;
  /** Chebyshev distance to the nearest; null with none in view. */
  readonly nearestDistance: number | null;
}

export interface KnowledgeLevel {
  readonly dnum: number;
  readonly dlevel: number;
  /** Depth as the status line shows it. */
  readonly depth: number;
  readonly mines: boolean;
  readonly sokoban: boolean;
  readonly gehennom: boolean;
  readonly quest: boolean;
  readonly endgame: boolean;
  readonly inShop: boolean;
  readonly inTemple: boolean;
  /** The special level the hero is on, as far as they can tell. */
  readonly specialLevel: KnowledgeSpecialLevel | null;
  /**
   * Counters (0-65535, wrapping) of attacks the hero made and attacks made on
   * the hero, ranged ones and misses included. Readers watch for changes.
   */
  readonly heroAttacks: number;
  readonly foeAttacks: number;
  readonly hostiles: KnowledgeHostiles;
}

export interface KnowledgeMonster {
  readonly x: number;
  readonly y: number;
  readonly sense: KnowledgeSense;
  /** Tracking id (0 for the hero); null for warnings and remembered invisible markers. */
  readonly id: number | null;
  readonly tileIndex: number | null;
  /** The monster glyph shown, if any; it only shows what the hero perceives. */
  readonly glyph: number | null;
  /** Warning level 0-5 for warnings. */
  readonly warningLevel: number;
  readonly pet: boolean;
  readonly peaceful: boolean;
  readonly steed: boolean;
  readonly hero: boolean;
}

export interface KnowledgeLight {
  readonly x: number;
  readonly y: number;
  /** NetHack light radius in tiles. */
  readonly range: number;
  readonly source: "object" | "monster";
  readonly kind: KnowledgeLightKind;
  readonly carriedByHero: boolean;
  /** The hero gives off light themself (polymorphed into a light-emitting form). */
  readonly isHero: boolean;
  readonly tileIndex: number | null;
  /** Monster glyph for monster sources; null for objects. */
  readonly glyph: number | null;
}

export interface KnowledgeFrame {
  readonly version: number;
  readonly sequence: number;
  /** Every cell is included and replaces what was known. */
  readonly complete: boolean;
  readonly turn: number;
  readonly hero: KnowledgeHero;
  readonly level: KnowledgeLevel;
  /** Changed cells, KNOWLEDGE_CELL_WORDS words each; read with decodeKnowledgeCell. */
  readonly cells: Int32Array;
  readonly monsters: readonly KnowledgeMonster[];
  readonly lights: readonly KnowledgeLight[];
}

export interface KnowledgeCell {
  readonly x: number;
  readonly y: number;
  readonly vision: number;
  /** Directions the location has been seen from (NetHack's seenv). */
  readonly seenFrom: number;
  /** Last seen terrain (KnowledgeTerrain). */
  readonly terrain: number;
  /** Type of a trap the hero has seen here, 0 for none. */
  readonly trap: number;
  readonly shownKind: number;
  readonly rememberedKind: number;
  readonly shownTile: number | null;
  readonly rememberedTile: number | null;
  /** NetHack MG_* flags of what is shown. */
  readonly shownFlags: number;
  readonly shownColor: number;
}

function tileOrNull(value: number): number | null {
  return value === NO_TILE ? null : value;
}

function signedByte(value: number): number {
  return (value << 24) >> 24;
}

export function decodeKnowledgeCell(cells: Int32Array, index: number): KnowledgeCell {
  const base = index * KNOWLEDGE_CELL_WORDS;
  const w0 = cells[base], w1 = cells[base + 1], w2 = cells[base + 2], w3 = cells[base + 3];
  return {
    x: w0 & 0xff,
    y: (w0 >>> 8) & 0xff,
    vision: (w0 >>> 16) & 0xff,
    seenFrom: (w0 >>> 24) & 0xff,
    terrain: w1 & 0xff,
    trap: (w1 >>> 8) & 0xff,
    shownKind: (w1 >>> 16) & 0xff,
    rememberedKind: (w1 >>> 24) & 0xff,
    shownTile: tileOrNull(w2 & 0xffff),
    rememberedTile: tileOrNull((w2 >>> 16) & 0xffff),
    shownFlags: w3 & 0xffff,
    shownColor: (w3 >>> 16) & 0xff,
  };
}

function decodeHero(words: Int32Array, base: number): KnowledgeHero {
  const flags = words[base + 3];
  return {
    x: words[base],
    y: words[base + 1],
    dx: signedByte(words[base + 2] & 0xff),
    dy: signedByte((words[base + 2] >>> 8) & 0xff),
    blind: (flags & 0x0001) !== 0,
    hallucinating: (flags & 0x0002) !== 0,
    underwater: (flags & 0x0004) !== 0,
    swallowed: (flags & 0x0008) !== 0,
    buried: (flags & 0x0010) !== 0,
    levitating: (flags & 0x0020) !== 0,
    flying: (flags & 0x0040) !== 0,
    riding: (flags & 0x0080) !== 0,
    unseenSelf: (flags & 0x0100) !== 0,
    polymorphed: (flags & 0x0200) !== 0,
    tileIndex: tileOrNull(words[base + 4]),
    glyph: words[base + 5] >= 0 ? words[base + 5] : null,
    steedId: words[base + 6] >= 0 ? words[base + 6] : null,
    swallowerId: words[base + 7] >= 0 ? words[base + 7] : null,
  };
}

function decodeLevel(words: Int32Array, base: number): KnowledgeLevel {
  const flags = words[base + 3];
  const hostiles = words[base + 6];
  return {
    dnum: words[base],
    dlevel: words[base + 1],
    depth: words[base + 2],
    mines: (flags & 0x01) !== 0,
    sokoban: (flags & 0x02) !== 0,
    gehennom: (flags & 0x04) !== 0,
    quest: (flags & 0x08) !== 0,
    endgame: (flags & 0x10) !== 0,
    inShop: (flags & 0x20) !== 0,
    inTemple: (flags & 0x40) !== 0,
    specialLevel: SPECIAL_LEVELS[words[base + 4]] ?? null,
    heroAttacks: words[base + 5] & 0xffff,
    foeAttacks: (words[base + 5] >>> 16) & 0xffff,
    hostiles: {
      count: hostiles & 0xff,
      maxDifficulty: (hostiles >>> 8) & 0xff,
      nearestDistance: (hostiles & 0xff) > 0 ? (hostiles >>> 16) & 0xff : null,
    },
  };
}

function decodeMonster(words: Int32Array, base: number): KnowledgeMonster {
  const w0 = words[base];
  const flags = (w0 >>> 24) & 0xff;
  const id = words[base + 1];
  return {
    x: w0 & 0xff,
    y: (w0 >>> 8) & 0xff,
    sense: SENSES[(w0 >>> 16) & 0xff] ?? "sensed",
    id: id >= 0 ? id : null,
    tileIndex: tileOrNull(words[base + 2] & 0xffff),
    glyph: words[base + 3] >= 0 ? words[base + 3] : null,
    warningLevel: (words[base + 2] >>> 16) & 0xffff,
    pet: (flags & 0x01) !== 0,
    peaceful: (flags & 0x02) !== 0,
    steed: (flags & 0x04) !== 0,
    hero: (flags & 0x08) !== 0,
  };
}

function decodeLight(words: Int32Array, base: number): KnowledgeLight {
  const w0 = words[base];
  const w1 = words[base + 1];
  const flags = (w1 >>> 8) & 0xff;
  return {
    x: w0 & 0xff,
    y: (w0 >>> 8) & 0xff,
    range: (w0 >>> 16) & 0xff,
    source: ((w0 >>> 24) & 0xff) === 2 ? "monster" : "object",
    kind: LIGHT_KINDS[w1 & 0xff] ?? "other",
    carriedByHero: (flags & 0x1) !== 0,
    isHero: (flags & 0x2) !== 0,
    tileIndex: tileOrNull(words[base + 2] & 0xffff),
    glyph: words[base + 3] >= 0 ? words[base + 3] : null,
  };
}

/**
 * Decodes one frame as the core wrote it. Returns null for a frame of another
 * format version or one whose length does not match its counts, so a client
 * paired with a different core falls back to its own estimates.
 */
export function decodeKnowledgeFrame(raw: unknown): KnowledgeFrame | null {
  if (!(raw instanceof Int32Array) || raw.length < FIXED_WORDS) return null;
  const words = raw;
  if (words[0] < OLDEST_READABLE_FORMAT_VERSION || words[0] > KNOWLEDGE_FORMAT_VERSION) return null;
  const cellCount = words[3], monsterCount = words[4], lightCount = words[5];
  if (cellCount < 0 || monsterCount < 0 || lightCount < 0) return null;
  const cellsEnd = FIXED_WORDS + cellCount * KNOWLEDGE_CELL_WORDS;
  const monstersEnd = cellsEnd + monsterCount * MONSTER_WORDS;
  const lightsEnd = monstersEnd + lightCount * LIGHT_WORDS;
  if (lightsEnd !== words.length) return null;

  const monsters: KnowledgeMonster[] = [];
  for (let base = cellsEnd; base < monstersEnd; base += MONSTER_WORDS) monsters.push(decodeMonster(words, base));
  const lights: KnowledgeLight[] = [];
  for (let base = monstersEnd; base < lightsEnd; base += LIGHT_WORDS) lights.push(decodeLight(words, base));

  return {
    version: words[0],
    sequence: words[1],
    complete: (words[2] & 0x1) !== 0,
    turn: words[6],
    hero: decodeHero(words, HEADER_WORDS),
    level: decodeLevel(words, HEADER_WORDS + HERO_WORDS),
    cells: words.slice(FIXED_WORDS, cellsEnd),
    monsters,
    lights,
  };
}
