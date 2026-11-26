import { describe, expect, it } from "vitest";
import type { KnowledgeSpecialLevel } from "../../runtime/knowledge";
import { resolveMusicRegion, type MusicLevel } from "./music-region";

const doom: MusicLevel = {
  mines: false,
  sokoban: false,
  gehennom: false,
  quest: false,
  endgame: false,
  specialLevel: null,
};

describe("resolveMusicRegion", () => {
  it.each([
    [{}, "dungeon"],
    [{ mines: true }, "mines"],
    [{ sokoban: true }, "sokoban"],
    [{ quest: true }, "quest"],
    [{ gehennom: true }, "gehennom"],
    [{ endgame: true }, "endgame"],
  ] as const)("branch %o -> %s", (flags, region) => {
    expect(resolveMusicRegion({ ...doom, ...flags })).toBe(region);
  });

  it.each([
    ["medusa", "medusa"],
    ["castle", "castle"],
    ["ludios", "ludios"],
    ["sanctum", "sanctum"],
    ["valley", "gehennom"],
    ["vlad-tower", "gehennom"],
    ["wizard-tower", "gehennom"],
    ["quest-home", "quest"],
    ["earth", "endgame"],
    ["astral", "endgame"],
  ] as const)("special level %s -> %s", (special: KnowledgeSpecialLevel, region) => {
    expect(resolveMusicRegion({ ...doom, specialLevel: special })).toBe(region);
  });

  it("prefers the special level over the branch", () => {
    expect(resolveMusicRegion({ ...doom, gehennom: true, specialLevel: "sanctum" })).toBe("sanctum");
  });
});
