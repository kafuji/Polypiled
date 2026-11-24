import { NH5_TILE_KEYS } from "../../game/hires-tiles/tile-keys.5.generated";
import { TERMINAL_MG_FLAGS } from "../../game/terminal/terminal-display";

export const petSpecies = ["little_dog", "dog", "large_dog", "kitten", "housecat", "large_cat", "pony", "horse", "warhorse"];

const painted = new Set([...petSpecies, "shopkeeper", "shopkeeper_female", "wizard", "nurse",
  "incubus", "succubus", "baalzebub", "oracle", "watchman"]);

export function portraitActor(actor: string, tileIndex?: number) {
  const tile = tileIndex === undefined ? undefined : NH5_TILE_KEYS[tileIndex]?.match(/^mon\/(.+)_(male|female)$/);
  const species = tile?.[1];
  if (species === "shopkeeper" && (actor === "chat" || actor === "shopkeeper"))
    return tile?.[2] === "female" ? "shopkeeper_female" : "shopkeeper";
  if (species && petSpecies.includes(species) && (actor === "chat" || actor === "pet" || petSpecies.includes(actor))) return species;
  if (actor === "chat" && species) {
    if (species === "amorous_demon") return tile[2] === "female" ? "succubus" : "incubus";
    if (species === "wizard_of_yendor") return "wizard";
    return species;
  }
  return actor;
}

export function hasPaintedPortrait(actor: string) {
  return painted.has(actor);
}

interface ShownTile { x: number; y: number; tileIndex: number; glyphFlags: number }

/** A spontaneous greeting or cry has no direction selection. Use a nearby displayed
 * tile only when all candidates agree on the portrait. */
export function nearbySpeakerTile(actor: string, tiles: Iterable<ShownTile>, player: { x: number; y: number }) {
  const family = actor === "dog" ? petSpecies.slice(0, 3) : actor === "kitten" ? petSpecies.slice(3, 6)
    : actor === "pony" ? petSpecies.slice(6) : actor === "pet" ? petSpecies : [];
  let found: number | undefined;
  for (const tile of tiles) {
    if (Math.max(Math.abs(tile.x - player.x), Math.abs(tile.y - player.y)) > 3) continue;
    const key = NH5_TILE_KEYS[tile.tileIndex];
    if (!key?.startsWith("mon/")) continue;
    const species = key.slice(4).replace(/_(male|female)$/, "");
    if (actor === "shopkeeper" ? species !== actor : !(tile.glyphFlags & TERMINAL_MG_FLAGS.pet) || !family.includes(species)) continue;
    if (found !== undefined && portraitActor(actor, found) !== portraitActor(actor, tile.tileIndex)) return undefined;
    found = tile.tileIndex;
  }
  return found;
}
