/**
 * How each kind of sprite meets the ground: where its shadow falls and how
 * high it floats. Renderer-free so it can be unit tested.
 *
 * - feet: stands on the floor; a tight contact shadow under where the
 *   picture touches the ground (people, animals, statues).
 * - hover: floats a little above the floor and bobs; a small soft shadow
 *   on the floor below (floating eyes, vortices, ghosts, bats and birds).
 * - silhouette: lies on the floor; the shadow is the picture's own outline
 *   laid down behind it (objects, corpses, dungeon features).
 * - none: casts no shadow (things that give off light, beams, explosions).
 */

import { getGlyphCatalogEntry } from "../../glyphs/registry";
import type { GlyphKind } from "../../glyphs/types";
import { NH5_TILE_KEYS } from "../../hires-tiles/tile-keys.5.generated";
import { resolveGlowingMonsterLight } from "./glowing-monsters";

export type GroundingKind = "feet" | "hover" | "silhouette" | "none";

export interface GroundingProfile {
  readonly kind: GroundingKind;
  /** Height above the floor, in sprite heights. */
  readonly lift: number;
  /** Bobbing amplitude, in sprite heights. */
  readonly bob: number;
}

export const FEET_PROFILE: GroundingProfile = { kind: "feet", lift: 0, bob: 0 };
export const HOVER_PROFILE: GroundingProfile = { kind: "hover", lift: 0.16, bob: 0.035 };
export const SILHOUETTE_PROFILE: GroundingProfile = { kind: "silhouette", lift: 0, bob: 0 };
export const NO_SHADOW_PROFILE: GroundingProfile = { kind: "none", lift: 0, bob: 0 };

/** The hero's own float while levitating or flying (in sprite heights). */
export const HERO_LEVITATION = { lift: 0.18, bob: 0.04 } as const;
export const HERO_FLIGHT = { lift: 0.12, bob: 0.025 } as const;

/** Bob period in milliseconds. */
export const HOVER_BOB_PERIOD_MS = 2400;

const LIVE_MONSTER_KINDS: ReadonlySet<GlyphKind> = new Set(["mon", "pet", "detect", "ridden"]);

/**
 * Monster classes (map letters) that float: floating eyes and spheres,
 * lights, vortices, ghosts and shades, bats and birds. Large flyers such as
 * dragons, angels and gargoyles stand on their feet.
 */
const HOVER_CLASSES: ReadonlySet<string> = new Set(["e", "y", "v", " ", "B"]);

/** Single species that float although their class does not. */
const HOVER_SPECIES: ReadonlySet<string> = new Set(["air_elemental"]);

function speciesFromTileKey(key: string | undefined): string | null {
  if (!key || !key.startsWith("mon/")) return null;
  return key.slice(4).replace(/_(?:male|female)$/, "").replace(/\.\d+$/, "");
}

/** Profile of the sprite a map glyph is drawn as. */
export function resolveGroundingProfile(glyph: number | null): GroundingProfile {
  if (glyph === null || !Number.isFinite(glyph)) return FEET_PROFILE;
  const entry = getGlyphCatalogEntry(Math.trunc(glyph));
  if (!entry) return FEET_PROFILE;
  if (LIVE_MONSTER_KINDS.has(entry.kind)) {
    if (resolveGlowingMonsterLight(glyph)) return NO_SHADOW_PROFILE;
    const species = speciesFromTileKey(NH5_TILE_KEYS[entry.tileIndex]);
    if (species && HOVER_SPECIES.has(species)) return HOVER_PROFILE;
    if (entry.asciiChar !== null && HOVER_CLASSES.has(entry.asciiChar)) return HOVER_PROFILE;
    return FEET_PROFILE;
  }
  switch (entry.kind) {
    case "statue":
      return FEET_PROFILE;
    case "obj":
    case "body":
    case "cmap":
      return SILHOUETTE_PROFILE;
    case "invis":
    case "zap":
    case "explode":
    case "swallow":
    case "warning":
      return NO_SHADOW_PROFILE;
    default:
      return FEET_PROFILE;
  }
}

/** Status condition bits (include/botl.h BL_MASK_*). */
export const CONDITION_MASK = {
  fly: 0x00000040,
  inLava: 0x00002000,
  levitation: 0x00004000,
  ride: 0x00010000,
  submerged: 0x00800000,
  trapped: 0x04000000,
} as const;

export interface HeroPoseInput {
  readonly conditionMask: number;
  /** Name of the trap under the hero, as the floor report gives it. */
  readonly trapHere: string | null;
  /** When the hero last fell into water (ms), or null. */
  readonly waterFallAtMs: number | null;
  readonly nowMs: number;
}

export interface HeroPose {
  /** Target float above the floor, in sprite heights (before bobbing). */
  readonly lift: number;
  readonly bob: number;
  /** How deep the sprite sinks into the floor, in sprite heights. */
  readonly sink: number;
  /** Multiplied into the sprite colour, or null for none. */
  readonly tint: readonly [number, number, number] | null;
  /** Sideways sway amplitude, in sprite widths. */
  readonly sway: number;
  readonly shadowVisible: boolean;
}

/** Sink in, hold under, then climb out (ms). */
export const WATER_FALL_SINK_MS = 520;
export const WATER_FALL_HOLD_MS = 260;
export const WATER_FALL_RISE_MS = 560;
export const WATER_FALL_TOTAL_MS = WATER_FALL_SINK_MS + WATER_FALL_HOLD_MS + WATER_FALL_RISE_MS;
const WATER_FALL_DEPTH = 0.55;

const WATER_TINT: readonly [number, number, number] = [0.55, 0.74, 1];
const LAVA_TINT: readonly [number, number, number] = [1, 0.62, 0.4];

/** Depth of the water-fall dip at `elapsedMs` (0 = on the surface). */
export function sampleWaterFallDepth(elapsedMs: number): number {
  if (!(elapsedMs >= 0) || elapsedMs >= WATER_FALL_TOTAL_MS) return 0;
  if (elapsedMs < WATER_FALL_SINK_MS) {
    const t = elapsedMs / WATER_FALL_SINK_MS;
    return WATER_FALL_DEPTH * (1 - (1 - t) ** 2);
  }
  if (elapsedMs < WATER_FALL_SINK_MS + WATER_FALL_HOLD_MS) return WATER_FALL_DEPTH;
  const t = (elapsedMs - WATER_FALL_SINK_MS - WATER_FALL_HOLD_MS) / WATER_FALL_RISE_MS;
  return WATER_FALL_DEPTH * (1 - t * t * (3 - 2 * t));
}

export function isPitTrap(trapName: string | null): boolean {
  return !!trapName && /\bpit\b/i.test(trapName);
}

/** How the hero's sprite sits right now. */
export function resolveHeroPose(input: HeroPoseInput): HeroPose {
  const mask = Math.trunc(input.conditionMask) || 0;
  let lift = 0;
  let bob = 0;
  if (mask & CONDITION_MASK.levitation) {
    lift = HERO_LEVITATION.lift;
    bob = HERO_LEVITATION.bob;
  } else if (mask & CONDITION_MASK.fly) {
    lift = HERO_FLIGHT.lift;
    bob = HERO_FLIGHT.bob;
  }
  let sink = 0;
  let tint: HeroPose["tint"] = null;
  let sway = 0;
  let shadowVisible = true;
  if (mask & CONDITION_MASK.inLava) {
    sink = 0.3;
    tint = LAVA_TINT;
    shadowVisible = false;
  } else if (mask & CONDITION_MASK.submerged) {
    sink = 0.22;
    tint = WATER_TINT;
    sway = 0.025;
    shadowVisible = false;
  } else if (mask & CONDITION_MASK.trapped && isPitTrap(input.trapHere)) {
    sink = 0.34;
  }
  if (input.waterFallAtMs !== null) {
    const depth = sampleWaterFallDepth(input.nowMs - input.waterFallAtMs);
    if (depth > 0) {
      sink = Math.max(sink, depth);
      tint = WATER_TINT;
      shadowVisible = false;
      lift = 0;
      bob = 0;
    }
  }
  return { lift, bob, sink, tint, sway, shadowVisible };
}
