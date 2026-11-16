import { getGlyphCatalogEntry } from "../../glyphs/registry";
import type { GlyphKind } from "../../glyphs/types";
import { NH5_TILE_KEYS } from "../../hires-tiles/tile-keys.5.generated";

export interface GlowLight {
  /** Linear RGB times intensity. */
  readonly color: readonly [number, number, number];
  /** Reach in tiles, including a soft edge. */
  readonly radius: number;
}

/**
 * Monsters that emit light in NetHack (emits_light): the lights, the
 * flaming and shocking spheres, fire vortices and fire elementals, and gold
 * dragons. Keyed by species name as in the tile files.
 */
const GLOWING_SPECIES: Readonly<Record<string, GlowLight>> = {
  yellow_light: { color: [0.95, 0.85, 0.3], radius: 2.5 },
  black_light: { color: [0.55, 0.3, 0.95], radius: 2.5 },
  flaming_sphere: { color: [0.95, 0.48, 0.16], radius: 2.5 },
  shocking_sphere: { color: [0.55, 0.7, 1.0], radius: 2.5 },
  fire_vortex: { color: [0.95, 0.42, 0.14], radius: 2.5 },
  fire_elemental: { color: [0.95, 0.4, 0.12], radius: 2.5 },
  gold_dragon: { color: [0.95, 0.78, 0.32], radius: 2.5 },
  baby_gold_dragon: { color: [0.95, 0.78, 0.32], radius: 2.5 },
};

/** Lava glows a deep orange; it is baked per lava cell. */
export const LAVA_GLOW: GlowLight = { color: [0.85, 0.32, 0.08], radius: 1.8 };

/** The monster itself, a pet, one sensed by telepathy, or ridden. Not corpses or statues. */
const LIVE_MONSTER_KINDS: ReadonlySet<GlyphKind> = new Set(["mon", "pet", "detect", "ridden"]);

function speciesFromNh5TileKey(key: string | undefined): string | null {
  if (!key || !key.startsWith("mon/")) return null;
  return key.slice(4).replace(/_(?:male|female)$/, "").replace(/\.\d+$/, "");
}

/** The light a map glyph gives off when it shows a glowing monster. */
export function resolveGlowingMonsterLight(glyph: unknown): GlowLight | null {
  if (typeof glyph !== "number" || !Number.isFinite(glyph)) return null;
  const entry = getGlyphCatalogEntry(Math.trunc(glyph));
  if (!entry || !LIVE_MONSTER_KINDS.has(entry.kind) || typeof entry.tileIndex !== "number") return null;
  const species = speciesFromNh5TileKey(NH5_TILE_KEYS[entry.tileIndex]);
  return species ? GLOWING_SPECIES[species] ?? null : null;
}
