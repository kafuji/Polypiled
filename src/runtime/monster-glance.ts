/**
 * Polypiled: the monsters the hero actually sees, sent by the game core
 * whenever the list changes (core/NetHack/win/shim/nh3d_knowledge.c,
 * notification "shim_monster_glance"). Each has the name the game would use
 * and how hurt it looks; monsters sensed any other way are not listed.
 */

export type MonsterHealth = "uninjured" | "wounded" | "badly wounded" | "nearly dead";

export interface GlancedMonster {
  readonly x: number;
  readonly y: number;
  /** As the game names it ("watchman", "Fido"). */
  readonly name: string;
  readonly health: MonsterHealth;
  readonly tame: boolean;
  readonly peaceful: boolean;
}

const healths: readonly MonsterHealth[] = ["uninjured", "wounded", "badly wounded", "nearly dead"];
const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/** Reads the core's JSON; null for anything malformed or of another version. */
export function parseMonsterGlance(raw: unknown): GlancedMonster[] | null {
  if (typeof raw !== "string") return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.v !== 1 || !Array.isArray(data.monsters)) return null;
  const monsters: GlancedMonster[] = [];
  for (const entry of data.monsters as unknown[]) {
    const item = entry as Record<string, unknown> | null;
    if (!item || !isInt(item.x) || !isInt(item.y) || typeof item.name !== "string") return null;
    if (!healths.includes(item.health as MonsterHealth)) return null;
    monsters.push({
      x: item.x,
      y: item.y,
      name: item.name,
      health: item.health as MonsterHealth,
      tame: item.tame === true,
      peaceful: item.peaceful === true,
    });
  }
  return monsters;
}
