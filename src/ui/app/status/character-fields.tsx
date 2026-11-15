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

export function getExperienceThresholdForLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  const normalizedLevel = Math.trunc(level);
  if (normalizedLevel < 1) {
    return 0;
  }
  if (normalizedLevel < 10) {
    return 10 * (1 << normalizedLevel);
  }
  if (normalizedLevel < 20) {
    return 10000 * (1 << (normalizedLevel - 10));
  }
  return 10000000 * (normalizedLevel - 19);
}

export function formatCharacterNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.max(0, Math.trunc(value)).toLocaleString("en-US");
}

