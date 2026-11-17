import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getGlyphCatalogEntry, getGlyphCatalogRanges } from "../../glyphs/registry";
import { KnowledgeTerrain, KnowledgeVision, decodeKnowledgeFrame } from "../../../runtime/knowledge";
import { encodeKnowledgeFrame, type FixtureCell, type FixtureLight } from "../../../runtime/knowledge-fixture";
import { PlayerKnowledge } from "../world/player-knowledge";
import { LIGHT_FIELD_RANGE, LIGHT_FIELD_SUBCELLS, LightField, glowFromKnowledgeLight, type LightFieldDependencies } from "./light-field";
import { createWorldShadingUniforms } from "./world-shading";

function cmapGlyph(symidx: number): number {
  const range = getGlyphCatalogRanges().find((entry) => entry.kind === "cmap")!;
  for (let glyph = range.start; glyph < range.endExclusive; glyph++) {
    if (getGlyphCatalogEntry(glyph)?.symidx === symidx) return glyph;
  }
  return range.start + symidx;
}

const ROOM = cmapGlyph(19);

function fixture() {
  const tileMap = new Map<string, THREE.Mesh>();
  const uniforms = createWorldShadingUniforms({ maxDarkAlpha: 0.82, bloodGroundStrength: 1, bloodGroundSpecularReferenceStrength: 1 });
  const knowledge = new PlayerKnowledge();
  const clientOptions = { lightingEnabled: true, dynamicLighting: true };
  const lights = new LightField({
    camera: { camera: new THREE.PerspectiveCamera() },
    engineState: { clientOptions },
    lighting: { vignetteUniforms: uniforms, lightingVignetteMaxDarkAlpha: 0.82 },
    movementInput: { isFpsMode: () => false },
    playerKnowledge: knowledge,
    playerMovement: { playerPos: { x: 5, y: 4 }, hasSeenPlayerPosition: true },
    promptDialogs: { currentInventory: [] },
    terminalRendering: { isTerminalDisplayMode: () => false },
    tileRendering: { tileMap },
    tilesetAssets: { shouldUseVultureTiles: () => false },
  } as unknown as LightFieldDependencies);
  // A 9 x 5 room the game draws with lit floor wherever the hero sees it.
  for (let y = 2; y <= 6; y++) {
    for (let x = 1; x <= 9; x++) {
      const mesh = new THREE.Mesh();
      mesh.userData = { tileX: x, tileY: y, sourceGlyph: ROOM, isWall: false };
      tileMap.set(`${x},${y}`, mesh);
    }
  }
  const report = (vision: (x: number, y: number) => number, frameLights: FixtureLight[] = []) => {
    const cells: FixtureCell[] = [];
    for (let y = 2; y <= 6; y++) for (let x = 1; x <= 9; x++) cells.push({ x, y, vision: vision(x, y), terrain: KnowledgeTerrain.room });
    knowledge.apply(decodeKnowledgeFrame(encodeKnowledgeFrame({ hero: { x: 5, y: 4 }, cells, lights: frameLights }))!);
  };
  const texel = (x: number, y: number) => {
    const data = (uniforms.uLightField.value as THREE.DataTexture).image.data as Uint8Array;
    const width = lights.columns * LIGHT_FIELD_SUBCELLS;
    const middle = Math.floor(LIGHT_FIELD_SUBCELLS / 2);
    const base = ((y * LIGHT_FIELD_SUBCELLS + middle) * width + x * LIGHT_FIELD_SUBCELLS + middle) * 4;
    return [...[0, 1, 2].map((c) => (data[base + c] / 255) * LIGHT_FIELD_RANGE), data[base + 3] / 255];
  };
  return { lights, uniforms, knowledge, report, texel, clientOptions };
}

describe("LightField with the game's knowledge", () => {
  it("keeps a dark room dark around a carried lantern", () => {
    const { lights, report, texel } = fixture();
    const near = (x: number, y: number) => Math.max(Math.abs(x - 5), Math.abs(y - 4)) <= 2;
    report(
      (x, y) => (near(x, y) ? KnowledgeVision.canSee | KnowledgeVision.couldSee | KnowledgeVision.tempLit : KnowledgeVision.couldSee),
      [{ x: 5, y: 4, range: 2, source: 1, kind: 3, flags: 0x1 }],
    );
    lights.update(0);
    expect(lights.rooms).toEqual([]);
    expect(lights.carriedLight).toEqual({ kind: "lantern", radius: 2 });
    const [red] = texel(5, 4);
    expect(red).toBeLessThan(lights.tuning.ambient + 0.01);
    lights.dispose();
  });

  it("lights a room the game reports as lit", () => {
    const { lights, report, texel } = fixture();
    report(() => KnowledgeVision.canSee | KnowledgeVision.couldSee | KnowledgeVision.lit);
    lights.update(0);
    expect(lights.rooms).toEqual([{ minX: 1, minY: 2, maxX: 9, maxY: 6 }]);
    const [red] = texel(2, 3);
    expect(red).toBeGreaterThan(lights.tuning.ambient + 0.2);
    lights.dispose();
  });

  it("remembers a lit room the hero has left", () => {
    const { lights, report, texel } = fixture();
    report(() => KnowledgeVision.wasLit);
    lights.update(0);
    expect(lights.rooms).toHaveLength(1);
    expect(texel(2, 3)[3]).toBe(0); // not seen: drawn as remembered
    lights.dispose();
  });

  it("marks what the hero sees in alpha and tells the shader so", () => {
    const { lights, uniforms, report, texel } = fixture();
    report((x) => (x <= 5 ? KnowledgeVision.canSee | KnowledgeVision.lit : KnowledgeVision.wasLit));
    lights.update(0);
    expect(uniforms.uLightParams.value.w).toBe(1);
    expect(texel(3, 4)[3]).toBe(1);
    expect(texel(8, 4)[3]).toBe(0);
    lights.dispose();
  });

  it("falls back to estimates until the game reports", () => {
    const { lights, uniforms, knowledge } = fixture();
    expect(knowledge.available).toBe(false);
    lights.update(0);
    expect(uniforms.uLightParams.value.w).toBe(0);
    // Estimated from the lit floor glyphs: the whole room counts as lit.
    expect(lights.rooms).toHaveLength(1);
    lights.dispose();
  });

  it("draws what the hero does not see at half brightness and with less colour", () => {
    const { lights, uniforms, report } = fixture();
    report(() => KnowledgeVision.canSee | KnowledgeVision.lit);
    lights.update(0);
    const look = uniforms.uMemoryLook.value;
    expect(look.x).toBeCloseTo(lights.tuning.memorySaturation);
    expect(lights.tuning.memoryBrightness).toBe(0.5);
    // The tint carries the brightness; it stays close to grey.
    for (const channel of [look.y, look.z, look.w]) expect(channel).toBeGreaterThan(0.45);
    for (const channel of [look.y, look.z, look.w]) expect(channel).toBeLessThan(0.55);
    lights.dispose();
  });

  it("counts the hero's own spot as seen even when blind", () => {
    const { lights, report, texel } = fixture();
    report(() => KnowledgeVision.wasLit); // blind: nothing in sight
    lights.update(0);
    expect(texel(5, 4)[3]).toBe(1);
    expect(texel(6, 4)[3]).toBe(0);
    lights.dispose();
  });

  it("still tells seen from remembered with dynamic lighting off", () => {
    const { lights, uniforms, report, texel, clientOptions } = fixture();
    clientOptions.dynamicLighting = false;
    report((x) => (x <= 5 ? KnowledgeVision.canSee | KnowledgeVision.lit : KnowledgeVision.wasLit));
    lights.update(0);
    expect(lights.isActive()).toBe(true);
    expect(uniforms.uLightFieldEnabled.value).toBe(1);
    expect(uniforms.uLightParams.value.w).toBe(1);
    expect(uniforms.uAmbientLight.value.x).toBe(1);
    expect(uniforms.uPlayerLightColor.value.length()).toBe(0);
    expect(lights.rooms).toEqual([]);
    const [red, green, blue, seen] = texel(3, 4);
    expect([red, green, blue].map((c) => Math.round(c * 100) / 100)).toEqual([1, 1, 1]);
    expect(seen).toBe(1);
    expect(texel(8, 4)[3]).toBe(0);
    lights.dispose();
  });

  it("stays off without dynamic lighting until the game reports vision", () => {
    const { lights, uniforms, clientOptions } = fixture();
    clientOptions.dynamicLighting = false;
    lights.update(0);
    expect(lights.isActive()).toBe(false);
    expect(uniforms.uLightFieldEnabled.value).toBe(0);
  });

  it("turns lights others hold into glows", () => {
    expect(glowFromKnowledgeLight({ x: 1, y: 1, range: 2, source: "object", kind: "candle", carriedByHero: false, isHero: false, tileIndex: null, glyph: null })?.radius).toBe(3.5);
    expect(glowFromKnowledgeLight({ x: 1, y: 1, range: 1, source: "object", kind: "lamp", carriedByHero: true, isHero: false, tileIndex: null, glyph: null })).toBeNull();
    expect(glowFromKnowledgeLight({ x: 1, y: 1, range: 1, source: "monster", kind: "monster", carriedByHero: false, isHero: false, tileIndex: null, glyph: null })?.radius).toBe(2.5);
  });
});
