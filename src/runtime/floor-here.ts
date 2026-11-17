/**
 * What lies under the hero, sent by the game core whenever it changes
 * (core/NetHack/win/shim/nh3d_knowledge.c, notification "shim_floor_here"):
 * the terrain as ':' describes it, a trap the hero has seen, an engraving
 * the hero has read or felt,
 * and the objects here with the names the game would print. Objects are
 * listed only when the hero can see them; an object type the hero does not
 * know comes as its class's generic glyph with the tile of its appearance.
 */

export interface FloorHereObject {
  /** As the game names it, shop price included ("a +0 dagger (for sale, 4 zorkmids)"). */
  readonly name: string;
  readonly glyph: number;
  readonly tileIndex: number | null;
  readonly quantity: number;
}

export interface FloorHereEngraving {
  /** NetHack engr_type: 1 dust, 2 engraved, 3 burned, 4 marker, 5 blood, 6 headstone. */
  readonly type: number;
  readonly text: string;
}

export interface FloorHere {
  readonly x: number;
  readonly y: number;
  /** "floor of a room", "staircase down", "altar to Anhur (chaotic)", ...; empty when engulfed. */
  readonly feature: string;
  /** A trap the hero has seen here ("bear trap"), if any. */
  readonly trap: string | null;
  readonly engraving: FloorHereEngraving | null;
  /** The hero cannot see what lies here (blind, engulfed, under lava or water). */
  readonly hidden: boolean;
  /** At most the first 40 objects; `count` is how many there are. */
  readonly objects: readonly FloorHereObject[];
  readonly count: number;
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/** Reads the core's JSON; null for anything malformed or of another version. */
export function parseFloorHere(raw: unknown): FloorHere | null {
  if (typeof raw !== "string") return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.v !== 1) return null;
  if (!isInt(data.x) || !isInt(data.y) || typeof data.feature !== "string" || !isInt(data.count)) return null;
  if (!Array.isArray(data.objects)) return null;
  const objects: FloorHereObject[] = [];
  for (const entry of data.objects as unknown[]) {
    const item = entry as Record<string, unknown> | null;
    if (!item || typeof item.name !== "string" || !isInt(item.glyph)) return null;
    objects.push({
      name: item.name,
      glyph: item.glyph,
      tileIndex: isInt(item.tile) && item.tile >= 0 ? item.tile : null,
      quantity: isInt(item.quan) && item.quan > 0 ? item.quan : 1,
    });
  }
  const engraving = data.engraving as Record<string, unknown> | null;
  return {
    x: data.x,
    y: data.y,
    feature: data.feature,
    trap: typeof data.trap === "string" && data.trap ? data.trap : null,
    engraving:
      engraving && typeof engraving === "object" && typeof engraving.text === "string" && isInt(engraving.type)
        ? { type: engraving.type, text: engraving.text }
        : null,
    hidden: data.hidden === true,
    objects,
    count: Math.max(data.count, objects.length),
  };
}
