import { describe, expect, it } from "vitest";
import { KnowledgeTerrain, KnowledgeVision, decodeKnowledgeCell, decodeKnowledgeFrame } from "./knowledge";
import { encodeKnowledgeFrame } from "./knowledge-fixture";

describe("knowledge frames", () => {
  it("decodes the hero, the level, cells, monsters and lights", () => {
    const frame = decodeKnowledgeFrame(encodeKnowledgeFrame({
      sequence: 7,
      turn: 1234,
      hero: { x: 10, y: 5, dx: -1, dy: 1, flags: 0x0001 | 0x0080, tile: 340, glyph: 12, steedId: 55 },
      level: { dnum: 2, dlevel: 3, depth: 4, flags: 0x01 | 0x20 },
      cells: [{
        x: 79, y: 20,
        vision: KnowledgeVision.canSee | KnowledgeVision.lit,
        seenFrom: 0xff,
        terrain: KnowledgeTerrain.room,
        trap: 14,
        shownKind: 3, rememberedKind: 2,
        shownTile: 1001, rememberedTile: null,
        shownFlags: 0x80, shownColor: 15,
      }],
      monsters: [
        { x: 11, y: 5, sense: 1, flags: 0x01, id: 42, tile: 300, glyph: 900 },
        { x: 12, y: 6, sense: 4, tile: 1200, warningLevel: 3 },
      ],
      lights: [{ x: 10, y: 5, range: 2, source: 1, kind: 3, flags: 0x1, tile: 500 }],
    }));

    expect(frame).not.toBeNull();
    expect(frame!.sequence).toBe(7);
    expect(frame!.complete).toBe(true);
    expect(frame!.turn).toBe(1234);
    expect(frame!.hero).toMatchObject({ x: 10, y: 5, dx: -1, dy: 1, blind: true, riding: true, hallucinating: false, tileIndex: 340, glyph: 12, steedId: 55, swallowerId: null });
    expect(frame!.level).toMatchObject({ dnum: 2, dlevel: 3, depth: 4, mines: true, inShop: true, sokoban: false });
    expect(decodeKnowledgeCell(frame!.cells, 0)).toEqual({
      x: 79, y: 20,
      vision: KnowledgeVision.canSee | KnowledgeVision.lit,
      seenFrom: 0xff,
      terrain: KnowledgeTerrain.room,
      trap: 14,
      shownKind: 3, rememberedKind: 2,
      shownTile: 1001, rememberedTile: null,
      shownFlags: 0x80, shownColor: 15,
    });
    expect(frame!.monsters).toEqual([
      { x: 11, y: 5, sense: "sight", id: 42, tileIndex: 300, glyph: 900, warningLevel: 0, pet: true, peaceful: false, steed: false, hero: false },
      { x: 12, y: 6, sense: "warning", id: null, tileIndex: 1200, glyph: null, warningLevel: 3, pet: false, peaceful: false, steed: false, hero: false },
    ]);
    expect(frame!.lights).toEqual([
      { x: 10, y: 5, range: 2, source: "object", kind: "lantern", carriedByHero: true, isHero: false, tileIndex: 500, glyph: null },
    ]);
  });

  it("decodes the special level, attack counters and hostiles in view", () => {
    const frame = decodeKnowledgeFrame(encodeKnowledgeFrame({
      level: { special: 2, heroAttacks: 65535, foeAttacks: 7, hostiles: { count: 3, maxDifficulty: 21, nearestDistance: 2 } },
    }));
    expect(frame!.level).toMatchObject({
      specialLevel: "castle",
      heroAttacks: 65535,
      foeAttacks: 7,
      hostiles: { count: 3, maxDifficulty: 21, nearestDistance: 2 },
    });
  });

  it("reads version 1 frames, whose reserved level words are zero", () => {
    const words = encodeKnowledgeFrame({ version: 1 });
    words.fill(0, 8 + 8 + 4, 8 + 8 + 8);
    const frame = decodeKnowledgeFrame(words);
    expect(frame!.level).toMatchObject({
      specialLevel: null,
      heroAttacks: 0,
      foeAttacks: 0,
      hostiles: { count: 0, maxDifficulty: 0, nearestDistance: null },
    });
  });

  it("refuses frames of another format or with a wrong length", () => {
    expect(decodeKnowledgeFrame(encodeKnowledgeFrame({ version: 3 }))).toBeNull();
    expect(decodeKnowledgeFrame(encodeKnowledgeFrame({ version: 0 }))).toBeNull();
    const words = encodeKnowledgeFrame({ cells: [{ x: 1, y: 1 }] });
    expect(decodeKnowledgeFrame(words.slice(0, words.length - 1))).toBeNull();
    expect(decodeKnowledgeFrame([1, 2, 3])).toBeNull();
    expect(decodeKnowledgeFrame(null)).toBeNull();
  });

  it("marks delta frames as incomplete", () => {
    expect(decodeKnowledgeFrame(encodeKnowledgeFrame({ complete: false }))!.complete).toBe(false);
  });
});
