import { describe, expect, it } from "vitest";
import { GLYPH_CATALOG } from "../../glyphs/glyph-catalog.5.generated";
import { NH5_TILE_KEYS } from "../../hires-tiles/tile-keys.5.generated";
import {
  CONDITION_MASK,
  HERO_FLIGHT,
  HERO_LEVITATION,
  WATER_FALL_HOLD_MS,
  WATER_FALL_RISE_MS,
  WATER_FALL_SINK_MS,
  WATER_FALL_TOTAL_MS,
  isWaterFallUnder,
  resolveGroundingProfile,
  resolveHeroPose,
  sampleWaterFallDepth,
} from "./grounding-profiles";

function glyphOf(kind: string, tileKeyPrefix: string): number {
  const entry = GLYPH_CATALOG.find(
    (candidate) => candidate.kind === kind && (NH5_TILE_KEYS[candidate.tileIndex] ?? "").startsWith(tileKeyPrefix),
  );
  if (!entry) throw new Error(`no ${kind} glyph for ${tileKeyPrefix}`);
  return entry.glyph;
}

describe("grounding profiles", () => {
  it("stands people and animals on their feet", () => {
    expect(resolveGroundingProfile(glyphOf("mon", "mon/jackal")).kind).toBe("feet");
    expect(resolveGroundingProfile(glyphOf("mon", "mon/valkyrie")).kind).toBe("feet");
    expect(resolveGroundingProfile(glyphOf("mon", "mon/red_dragon")).kind).toBe("feet");
  });

  it("floats eyes, vortices, ghosts, bats and air elementals", () => {
    for (const key of ["mon/floating_eye", "mon/dust_vortex", "mon/ghost", "mon/bat", "mon/air_elemental"]) {
      const profile = resolveGroundingProfile(glyphOf("mon", key));
      expect(profile.kind, key).toBe("hover");
      expect(profile.lift).toBeGreaterThan(0);
    }
  });

  it("gives things that shine no shadow", () => {
    expect(resolveGroundingProfile(glyphOf("mon", "mon/yellow_light")).kind).toBe("none");
    expect(resolveGroundingProfile(glyphOf("mon", "mon/fire_vortex")).kind).toBe("none");
  });

  it("lays objects down as silhouettes", () => {
    const object = GLYPH_CATALOG.find((entry) => entry.kind === "obj");
    expect(resolveGroundingProfile(object!.glyph).kind).toBe("silhouette");
  });

  it("stands upright dungeon features on the floor", () => {
    for (const key of ["other/fountain", "other/sink", "other/staircase_up"]) {
      expect(resolveGroundingProfile(glyphOf("cmap", key)).kind, key).toBe("feet");
    }
    expect(resolveGroundingProfile(glyphOf("cmap", "other/staircase_down")).kind).toBe("silhouette");
  });
});

describe("hero pose", () => {
  const at = (conditionMask: number, extra: Partial<Parameters<typeof resolveHeroPose>[0]> = {}) =>
    resolveHeroPose({ conditionMask, trapHere: null, waterFallAtMs: null, nowMs: 1000, ...extra });

  it("rises while levitating, a little less while flying", () => {
    expect(at(0)).toMatchObject({ lift: 0, sink: 0, tint: null, shadowVisible: true });
    expect(at(CONDITION_MASK.levitation).lift).toBe(HERO_LEVITATION.lift);
    expect(at(CONDITION_MASK.fly).lift).toBe(HERO_FLIGHT.lift);
    expect(at(CONDITION_MASK.fly).bob).toBeLessThan(at(CONDITION_MASK.levitation).bob);
  });

  it("sinks into a pit, lava and water", () => {
    expect(at(CONDITION_MASK.trapped, { trapHere: "spiked pit" }).sink).toBeGreaterThan(0);
    expect(at(CONDITION_MASK.trapped, { trapHere: "bear trap" }).sink).toBe(0);
    expect(at(CONDITION_MASK.inLava)).toMatchObject({ shadowVisible: false });
    expect(at(CONDITION_MASK.submerged).tint).not.toBeNull();
  });

  it("goes under where it fell in, then hops up where it crawled out", () => {
    expect(sampleWaterFallDepth(0)).toBe(0);
    expect(sampleWaterFallDepth(WATER_FALL_SINK_MS / 2)).toBeGreaterThan(0.3);
    // Deep enough for the whole picture to be under the waterline.
    expect(sampleWaterFallDepth(WATER_FALL_SINK_MS)).toBeGreaterThanOrEqual(1);
    expect(isWaterFallUnder(WATER_FALL_SINK_MS)).toBe(true);
    expect(isWaterFallUnder(WATER_FALL_SINK_MS + WATER_FALL_HOLD_MS)).toBe(false);

    // While the stand-in sinks, the hero on the bank is hidden, not sunk.
    const under = at(0, { waterFallAtMs: 1000 - WATER_FALL_SINK_MS / 2 });
    expect(under).toMatchObject({ hidden: true, sink: 0, shadowVisible: false });
    const rising = at(0, {
      waterFallAtMs: 1000 - (WATER_FALL_SINK_MS + WATER_FALL_HOLD_MS + WATER_FALL_RISE_MS / 2),
    });
    expect(rising).toMatchObject({ hidden: false, sink: 0 });
    expect(rising.lift).toBeGreaterThan(0);
    expect(at(0, { waterFallAtMs: 1000 - WATER_FALL_TOTAL_MS })).toMatchObject({ hidden: false, lift: 0, tint: null });
  });
});
