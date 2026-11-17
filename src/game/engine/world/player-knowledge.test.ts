import { describe, expect, it } from "vitest";
import { KnowledgeTerrain, KnowledgeVision, decodeKnowledgeFrame } from "../../../runtime/knowledge";
import { encodeKnowledgeFrame, type FixtureFrame } from "../../../runtime/knowledge-fixture";
import { PlayerKnowledge } from "./player-knowledge";

const frame = (fixture: FixtureFrame) => decodeKnowledgeFrame(encodeKnowledgeFrame(fixture))!;

describe("PlayerKnowledge", () => {
  it("applies a complete frame and then changes", () => {
    const knowledge = new PlayerKnowledge();
    knowledge.apply(frame({
      cells: [
        { x: 3, y: 4, vision: KnowledgeVision.canSee | KnowledgeVision.lit, terrain: KnowledgeTerrain.room },
        { x: 5, y: 4, vision: KnowledgeVision.wasLit, terrain: KnowledgeTerrain.corridor },
      ],
    }));
    expect(knowledge.available).toBe(true);
    expect(knowledge.canSee(3, 4)).toBe(true);
    expect(knowledge.isLitLocation(3, 4)).toBe(true);
    expect(knowledge.isLitLocation(5, 4)).toBe(true); // remembered
    expect(knowledge.terrain(5, 4)).toBe(KnowledgeTerrain.corridor);

    // The hero walks away: in sight but dark now, so the memory is wrong no longer.
    knowledge.apply(frame({ complete: false, sequence: 2, cells: [{ x: 5, y: 4, vision: KnowledgeVision.canSee, terrain: KnowledgeTerrain.corridor }] }));
    expect(knowledge.isLitLocation(5, 4)).toBe(false);
    expect(knowledge.canSee(3, 4)).toBe(true); // unchanged cells stay

    // A complete frame (a new level) forgets the old cells.
    knowledge.apply(frame({ sequence: 3, cells: [] }));
    expect(knowledge.canSee(3, 4)).toBe(false);
    expect(knowledge.terrain(3, 4)).toBe(KnowledgeTerrain.stone);
  });

  it("ignores changes until it has a complete frame", () => {
    const knowledge = new PlayerKnowledge();
    knowledge.apply(frame({ complete: false, cells: [{ x: 3, y: 4, vision: KnowledgeVision.canSee }] }));
    expect(knowledge.available).toBe(false);
    expect(knowledge.canSee(3, 4)).toBe(false);
  });

  it("forgets everything on reset", () => {
    const knowledge = new PlayerKnowledge();
    knowledge.apply(frame({ cells: [{ x: 3, y: 4, vision: KnowledgeVision.canSee }], lights: [{ x: 1, y: 1, range: 1, source: 1, kind: 2, flags: 1 }] }));
    const revision = knowledge.revision;
    knowledge.reset();
    expect(knowledge.available).toBe(false);
    expect(knowledge.lights).toEqual([]);
    expect(knowledge.canSee(3, 4)).toBe(false);
    expect(knowledge.revision).toBeGreaterThan(revision);
  });
});
