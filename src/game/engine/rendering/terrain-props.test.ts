import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGlyphCatalogEntry, getGlyphCatalogRanges } from "../../glyphs/registry";
import { EntityBillboards, type EntityBillboardsDependencies } from "./entity-billboards";
import { NH5_TILE_KEYS } from "../../hires-tiles/tile-keys.5.generated";
import { doorRotation, resolveTerrainPropSpec, TerrainPropModels } from "./terrain-props";

function cmapGlyphWithSymidx(symidx: number): number {
  const range = getGlyphCatalogRanges().find((entry) => entry.kind === "cmap")!;
  for (let glyph = range.start; glyph < range.endExclusive; glyph++) {
    if (getGlyphCatalogEntry(glyph)?.symidx === symidx) {
      return glyph;
    }
  }
  throw new Error(`no cmap glyph for symidx ${symidx}`);
}

afterEach(() => vi.unstubAllGlobals());

describe("terrain props", () => {
  it("tells stairs, ladders and branch variants apart", () => {
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(25), "stairs_up")).toEqual({ kind: "stairs_up", branch: false });
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(28), "stairs_down")).toEqual({ kind: "ladder_down", branch: false });
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(30), "stairs_down")).toEqual({ kind: "stairs_down", branch: true });
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(31), "stairs_up")).toEqual({ kind: "ladder_up", branch: true });
    expect(resolveTerrainPropSpec(null, "floor")).toBeNull();
  });

  it("recognises dungeon features and altar alignments", () => {
    expect(resolveTerrainPropSpec(null, "fountain")?.kind).toBe("fountain");
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(34), "feature")?.kind).toBe("grave");
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(35), "feature")?.kind).toBe("throne");
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(36), "feature")?.kind).toBe("sink");
    const altar = cmapGlyphWithSymidx(33);
    const chaoticTile = NH5_TILE_KEYS.indexOf("other/chaotic_altar");
    expect(resolveTerrainPropSpec(altar, "feature", chaoticTile)).toEqual({ kind: "altar", branch: false, alignment: "chaotic" });
    expect(resolveTerrainPropSpec(altar, "feature")?.alignment).toBe("unaligned");
  });

  it("reads door state and axis from the glyph; an empty doorway gets no model", () => {
    const closed = resolveTerrainPropSpec(cmapGlyphWithSymidx(15), "door")!;
    expect(closed.door).toEqual({ state: "closed", axis: "vertical" });
    expect(doorRotation(closed)).toBeCloseTo(Math.PI / 2);
    const open = resolveTerrainPropSpec(cmapGlyphWithSymidx(14), "door")!;
    expect(open.door).toEqual({ state: "open", axis: "horizontal" });
    expect(doorRotation(open)).toBe(0);
    expect(resolveTerrainPropSpec(cmapGlyphWithSymidx(12), "floor")).toBeNull();
  });

  it("builds every kind of model", () => {
    const models = new TerrainPropModels(() => {});
    for (const kind of ["stairs_up", "stairs_down", "ladder_up", "ladder_down", "fountain", "sink", "altar", "grave", "throne", "door"] as const) {
      expect(models.build({ kind, branch: false }).children.length).toBeGreaterThan(0);
    }
    models.dispose();
  });

  it("gives the fountain moving water and stone that fits inside its tile", () => {
    const patch = vi.fn();
    const models = new TerrainPropModels(patch);
    const fountain = models.build({ kind: "fountain", branch: false });
    expect(patch.mock.calls.some(([, options]) => options.liquid)).toBe(true);
    const bounds = new THREE.Box3().setFromObject(fountain);
    expect(bounds.max.x).toBeLessThanOrEqual(0.5);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.5);
    expect(bounds.min.z).toBeGreaterThanOrEqual(0);
    models.dispose();
  });

  it.each([true, false])("replaces the stairs billboard only with the 3D model option (%s)", (models) => {
    vi.stubGlobal("HTMLCanvasElement", class {});
    const scene = new THREE.Scene();
    const billboards = new EntityBillboards({
      engineState: { clientOptions: { tilesetMode: "tiles", tilesetBackgroundRemovalMode: "none" } },
      movementInput: { isFpsMode: () => false },
      playerMovement: { hasSeenPlayerPosition: false, playerPos: { x: 0, y: 0 } },
      tilesetAssets: {
        tileSourceSize: 32,
        shouldUseVultureTiles: () => false,
        getWorldTileScaleX: () => 1,
        isTerrainModelsActive: () => models,
        resolveTerrainModelTexture: () => null,
        resolveTextureAnisotropyLevel: () => 1,
      },
      glyphTextures: { createTileTexture: () => new THREE.CanvasTexture(undefined) },
      lighting: { patchMaterialForVignette: vi.fn() },
      renderPipeline: { scene },
      damageFlashes: { stopMonsterBillboardDamageFlash: () => {} },
      worldClassification: {
        getPlayerUnderlayBillboardKey: (key: string) => `${key}|underlay-feature`,
        isBoulderGlyphByCatalog: () => false,
      },
    } as unknown as EntityBillboardsDependencies);
    vi.spyOn(billboards, "ensureEntityBlobShadow").mockImplementation(() => {});
    vi.spyOn(billboards, "updateMonsterBillboardPitchLockStateForEntry").mockImplementation(() => {});
    const stairs = cmapGlyphWithSymidx(26);
    billboards.ensureMonsterBillboard("3,4", 3, 4, ">", "#fff", 10, "monster", false, stairs, "stairs_down");
    expect(billboards.terrainProps.has("3,4")).toBe(models);
    expect(billboards.monsterBillboards.has("3,4")).toBe(!models);
    if (models) {
      expect(billboards.terrainProps.get("3,4")!.position.toArray()).toEqual([3, -4, 0]);
    }
    billboards.removeMonsterBillboard("3,4");
    expect(billboards.terrainProps.size).toBe(0);
    expect(billboards.monsterBillboards.size).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});
