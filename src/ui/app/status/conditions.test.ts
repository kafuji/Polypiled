import { describe, expect, it } from "vitest";

import type { PlayerStatsSnapshot } from "../../../game/ui-types";
import {
  buildPlayerStatusBadges,
  resolveCharacterStatusLineSeverity,
  resolveConditionStatusBadges,
  resolveConditionStatusLineSeverity,
  resolveEncumbranceStatusBadge,
  resolveHungerStatusBadge,
} from "./conditions";

const sampleStats: PlayerStatsSnapshot = {
  name: "Status test", hp: 10, maxHp: 10, power: 4, maxPower: 4,
  level: 1, experience: 0, strength: 10, dexterity: 10, constitution: 10,
  intelligence: 10, wisdom: 10, charisma: 10, armor: 10,
  dungeon: "Dungeons of Doom", dlevel: 1, gold: 0, alignment: "neutral",
  hunger: "", encumbrance: "", conditionMask: 0, time: 1, score: 0,
};

describe("player status presentation", () => {
  it("interprets condition bits as NetHack 5.0 defines them", () => {
    // Bit 0x100000 is petrification; bit 1 is bare hands, not the 3.6.7 petrification bit.
    expect(resolveConditionStatusBadges(0x100000, "5.0")).toEqual([
      expect.objectContaining({ severity: "danger" }),
    ]);
    expect(resolveConditionStatusLineSeverity("You are turning to stone.", 0x100000, "5.0"))
      .toBe("danger");
    expect(resolveConditionStatusLineSeverity("You are turning to stone.", 1, "5.0"))
      .toBeNull();
  });

  it("ignores malformed condition masks and unknown bits", () => {
    for (const mask of [undefined, null, "1", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveConditionStatusBadges(mask, "5.0")).toEqual([]);
    }
    expect(resolveConditionStatusBadges(0x40000000, "5.0")).toEqual([]);
    expect(resolveConditionStatusBadges(0x20000000, "5.0")).toHaveLength(1);
  });

  it("distinguishes normal hunger, satiation and critical hunger", () => {
    expect(resolveHungerStatusBadge(" not hungry ")).toBeNull();
    expect(resolveHungerStatusBadge("Satiated")).toEqual({
      label: "Satiated", severity: "good",
    });
    expect(resolveHungerStatusBadge("Hungry")?.severity).toBe("warning");
    for (const label of ["Weak", "Fainting", "Fainted", "Starved"]) {
      expect(resolveHungerStatusBadge(label)?.severity).toBe("danger");
    }
  });

  it("keeps unencumbered separate from burdened and critical load", () => {
    expect(resolveEncumbranceStatusBadge("Unencumbered")?.severity).toBe("good");
    expect(resolveEncumbranceStatusBadge("Burdened")?.severity).toBe("warning");
    expect(resolveEncumbranceStatusBadge("Overloaded")?.severity).toBe("danger");
  });

  it("highlights only status lines whose condition is currently active", () => {
    const stats = {
      ...sampleStats,
      hunger: "Weak",
      encumbrance: "Burdened",
      conditionMask: 0x2,
    };
    expect(resolveCharacterStatusLineSeverity("  You are\n weak. ", stats, "5.0"))
      .toBe("danger");
    expect(resolveCharacterStatusLineSeverity("You are burdened.", stats, "5.0"))
      .toBe("warning");
    expect(resolveCharacterStatusLineSeverity("You are blind.", stats, "5.0"))
      .toBe("warning");
    expect(resolveCharacterStatusLineSeverity("You are stunned.", stats, "5.0"))
      .toBeNull();
    expect(resolveCharacterStatusLineSeverity("Your weakness has passed.", stats, "5.0"))
      .toBeNull();
  });

  it("keeps hunger then load then condition badge order", () => {
    const stats = {
      ...sampleStats,
      hunger: "Weak",
      encumbrance: "Burdened",
      conditionMask: 0x2,
    };
    expect(buildPlayerStatusBadges(stats, "5.0")).toEqual([
      { label: "Weak", severity: "danger" },
      { label: "Burdened", severity: "warning" },
      ...resolveConditionStatusBadges(0x2, "5.0"),
    ]);
  });
});
