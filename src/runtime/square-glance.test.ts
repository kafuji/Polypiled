import { describe, expect, it } from "vitest";
import { parseSquareGlance } from "./square-glance";
import { translateSquareName } from "../i18n/game-ground";

describe("square glance", () => {
  it("reads ground, feature, trap and object by name index", () => {
    const raw = JSON.stringify({
      v: 1,
      squares: [
        [3, 4, 0, 1, -1, null],
        [5, 6, 2, -1, 3, "a dagger"],
      ],
      names: ["floor of a room", "fountain", "corridor", "bear trap"],
    });
    expect(parseSquareGlance(raw)).toEqual([
      { x: 3, y: 4, ground: "floor of a room", feature: "fountain", trap: null, object: null },
      { x: 5, y: 6, ground: "corridor", feature: null, trap: "bear trap", object: "a dagger" },
    ]);
  });

  it("rejects malformed data", () => {
    expect(parseSquareGlance("{")).toBeNull();
    expect(parseSquareGlance(JSON.stringify({ v: 2, squares: [], names: [] }))).toBeNull();
    expect(parseSquareGlance(JSON.stringify({ v: 1, squares: [[1, 1, 5, -1, -1, null]], names: [] }))).toBeNull();
  });

  it("has Japanese names for every name the core sends", () => {
    const names = [
      "wall", "doorway", "open door", "closed door", "iron bars", "tree", "floor of a room", "corridor",
      "staircase up", "staircase down", "ladder up", "ladder down", "lawful altar", "neutral altar",
      "chaotic altar", "unaligned altar", "high altar", "grave", "throne", "sink", "fountain", "water",
      "ice", "lava", "lowered drawbridge", "raised drawbridge", "air", "cloud",
      "arrow trap", "dart trap", "falling rock trap", "squeaky board", "bear trap", "land mine",
      "rolling boulder trap", "sleeping gas trap", "rust trap", "fire trap", "pit", "spiked pit", "hole",
      "trap door", "teleportation trap", "level teleporter", "magic portal", "web", "statue trap",
      "magic trap", "anti-magic field", "polymorph trap", "vibrating square",
    ];
    for (const name of names) expect(translateSquareName(name, "ja"), name).not.toBe(name);
  });
});
