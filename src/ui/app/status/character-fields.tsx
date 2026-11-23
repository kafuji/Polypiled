import {
  CharacterSheetStatKey
} from "../../modals/character-sheet";
import {
  t
} from "../shared/translations";

/** Character sheet descriptions and experience thresholds. */
export const characterStatDescriptionById: Record<CharacterSheetStatKey, string> = {
  strength: t.characterStats.descriptions.strength,
  dexterity: t.characterStats.descriptions.dexterity,
  constitution: t.characterStats.descriptions.constitution,
  intelligence: t.characterStats.descriptions.intelligence,
  wisdom: t.characterStats.descriptions.wisdom,
  charisma: t.characterStats.descriptions.charisma,
};

export const armorClassDescription = t.characterStats.armorClassDescription;

export const maxExperienceLevel = 30;

/**
 * Experience needed to reach level + 1, indexed by level. Mirrors
 * `uexp_table` in core/NetHack/src/exper.c; keep the two in step.
 */
const experienceThresholds: readonly number[] = [
  0, 20, 40, 80, 150,
  290, 540, 1000, 1810, 3210,
  5630, 9690, 16400, 27300, 44800,
  72200, 114000, 178000, 273000, 412000,
  610000, 890000, 1280000, 1800000, 2500000,
  3410000, 4570000, 6040000, 7830000, 10000000,
  12800000,
];

export function getExperienceThresholdForLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  const normalizedLevel = Math.trunc(level);
  if (normalizedLevel < 1) {
    return 0;
  }
  return experienceThresholds[Math.min(normalizedLevel, experienceThresholds.length - 1)];
}

export function formatCharacterNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

