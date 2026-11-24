import { describe, expect, it } from "vitest";
import { parseEnhanceMenu } from "./enhance-menu";

describe("parseEnhanceMenu", () => {
  it("reads the level a weapon gets from its skill family", () => {
    const data = parseEnhanceMenu("Current skills:", [
      { text: "Weapon Skills", isCategory: true },
      { text: "     long sword [Expert]", isSelectable: false },
      { text: "     saber      [Unskilled] (family: Skilled)", isSelectable: false },
      { text: "  #  broadsword [Restricted] (family: Basic)", isSelectable: false },
    ]);
    const entries = data?.groups[0]?.entries ?? [];
    expect(entries.map((entry) => [entry.name, entry.currentRank, entry.familyRank])).toEqual([
      ["Long Sword", "Expert", null],
      ["Saber", "Unskilled", "Skilled"],
      ["Broadsword", "Restricted", "Basic"],
    ]);
    expect(entries[2]?.availability).toBe("maxed_out");
  });
});
