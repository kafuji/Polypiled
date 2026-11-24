import { expect, it } from "vitest";
import { NH5_TILE_KEYS } from "../../game/hires-tiles/tile-keys.5.generated";
import { TERMINAL_MG_FLAGS } from "../../game/terminal/terminal-display";
import { hasPaintedPortrait, nearbySpeakerTile, petSpecies, portraitActor } from "./actors";

const index = (key: string) => NH5_TILE_KEYS.indexOf("mon/" + key);

it.each(petSpecies)("preserves the %s stage on pet chat and hunger", species => {
  for (const sex of ["male", "female"]) {
    const tile = index(species + "_" + sex);
    expect(tile).toBeGreaterThanOrEqual(0);
    expect(portraitActor("chat", tile)).toBe(species);
    expect(portraitActor("pet", tile)).toBe(species);
    expect(hasPaintedPortrait(species)).toBe(true);
  }
});

it("uses shopkeeper and amorous demon tile sex", () => {
  for (const sex of ["male", "female"]) {
    expect(portraitActor("shopkeeper", index("shopkeeper_" + sex))).toBe(sex === "female" ? "shopkeeper_female" : "shopkeeper");
    expect(portraitActor("chat", index("amorous_demon_" + sex))).toBe(sex === "female" ? "succubus" : "incubus");
  }
});

it("resolves an unambiguous nearby pet and avoids choosing between different stages", () => {
  const player = { x: 10, y: 10 };
  const little = { x: 11, y: 10, tileIndex: index("little_dog_male"), glyphFlags: TERMINAL_MG_FLAGS.pet };
  const large = { ...little, x: 12, tileIndex: index("large_dog_male") };
  expect(nearbySpeakerTile("dog", [little, { ...large, glyphFlags: 0 }], player)).toBe(little.tileIndex);
  expect(nearbySpeakerTile("dog", [little, large], player)).toBeUndefined();
});
