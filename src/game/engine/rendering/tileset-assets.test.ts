import { afterEach, describe, expect, it, vi } from "vitest";
import { TilesetAssets, type TilesetAssetsDependencies } from "./tileset-assets";
import { nh5OutputRows, nh5ExpectedTileCount, translateNh367TileIndexToNh5 } from "../../tileset-367-to-5-translation";
import { DarkWallOverrides, type DarkWallOverridesDependencies } from "./dark-wall-overrides";
import type { Nh3dClientOptions } from "../../ui-types";
import { clearNh3dUserTilesets, resolveNh3dTilesetAssetUrl, setNh3dUserTilesets } from "../../tilesets";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("detects an edited user atlas under the same path so it reloads", () => {
  const assets = new TilesetAssets({} as TilesetAssetsDependencies);
  const registration = { id: "columns", label: "Columns", tileSize: 24, tileLayoutVersion: "3.6.7" as const, blob: new Blob() };
  try {
    setNh3dUserTilesets([registration]);
    assets.tilesetTextureAssetUrl = resolveNh3dTilesetAssetUrl("user:columns");
    expect(assets.hasTilesetSourceChanged("user:columns")).toBe(false);
    setNh3dUserTilesets([{ ...registration, blob: new Blob(["edited"]) }]);
    expect(assets.hasTilesetSourceChanged("user:columns")).toBe(true);
  } finally { clearNh3dUserTilesets(); }
});
function canvasFixture() {
  const drawImage = vi.fn();
  const getImageData = vi.fn((_x, _y, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }));
  const context = { clearRect: vi.fn(), drawImage, getImageData, imageSmoothingEnabled: true };
  vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => context }) });
  const assets = new TilesetAssets({ engineState: { clientOptions: { tilesetBackgroundTileId: 41 } } } as unknown as TilesetAssetsDependencies);
  return { assets, drawImage, getImageData };
}
describe("rectangular atlas loading", () => {
  it.each(["raw","compiled"] as const)("preserves the selected dark wall tile in a %s legacy pack",async layout=>{
    const {assets,drawImage}=canvasFixture();
    assets.resolveRuntimeVersion=()=>"5.0";
    assets.loadedTilesetSourceLayoutVersion="3.6.7";
    assets.loadedTilesetTileLayoutVersion=layout==="compiled"?"5.0":"3.6.7";
    assets.resolveLoadedAtlasTileCount=()=>layout==="compiled"?nh5ExpectedTileCount:1082;
    assets.isVultureTilesActive=()=>false;
    const selected=866, runtime=translateNh367TileIndexToNh5(selected);
    expect(runtime).not.toBe(selected);
    const options={darkCorridorWallTileOverrideEnabled:true,darkCorridorWallTileOverrideTileId:selected,darkCorridorWallSolidColorOverrideEnabled:false};
    const overrides=new DarkWallOverrides({engineState:{clientOptions:options},tilesetAssets:assets} as unknown as DarkWallOverridesDependencies);
    expect(overrides.resolveTileTextureIndex(0,true)).toBe(runtime);
    expect(overrides.resolveTileTextureIndex(17,false)).toBe(17);
    expect(assets.resolveSourceTileIndexForRuntime(runtime)).toBe(selected);
    const atlasTile=assets.resolveAtlasTileIndexForRuntime(runtime,assets.resolveLoadedAtlasTileCount());
    if(layout==="raw") expect(atlasTile).toBe(selected);
    else {
      expect(atlasTile).toBe(runtime);
      await assets.compileLegacyTilesetAtlasToNh5({width:640,height:448} as HTMLImageElement,16,null);
      const cell=drawImage.mock.calls.find(call=>call[5]===(runtime%40)*16 && call[6]===Math.floor(runtime/40)*16)!;
      expect(cell.slice(1,3)).toEqual([(selected%40)*16,Math.floor(selected/40)*16]);
    }
    options.darkCorridorWallSolidColorOverrideEnabled=true;
    expect(overrides.resolveTileTextureIndex(17,true)).toBe(17);
    options.darkCorridorWallSolidColorOverrideEnabled=false;options.darkCorridorWallTileOverrideEnabled=false;
    expect(overrides.resolveTileTextureIndex(17,true)).toBe(17);
  });
  it("extracts a second-row reference cell with its native height", () => {
    const { assets, drawImage, getImageData } = canvasFixture();
    const source = { width: 600, height: 975 } as HTMLImageElement;
    assets.captureTilesetBackgroundReferenceTile(source, 15, 25);
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(source, 15, 25, 15, 25, 0, 0, 15, 25);
    expect(getImageData).toHaveBeenCalledExactlyOnceWith(0, 0, 15, 25);
    expect(assets.tilesetBackgroundReferenceTilePixels).toHaveLength(15 * 25 * 4);
  });
  it("retains rectangular rows when translating a legacy atlas to NetHack 5", async () => {
    const { assets, drawImage } = canvasFixture();
    const source = { width: 600, height: 975 } as HTMLImageElement;
    const output = await assets.compileLegacyTilesetAtlasToNh5(source, 15, null, 25);
    expect([output.width, output.height]).toEqual([600, nh5OutputRows * 25]);
    expect(drawImage.mock.calls.length).toBeGreaterThan(1000);
    for (const [image, sx, sy, sw, sh, dx, dy, dw, dh] of drawImage.mock.calls) {
      expect(image).toBe(source);
      expect([sw, sh, dw, dh]).toEqual([15, 25, 15, 25]);
      expect(sx % 15).toBe(0); expect(sy % 25).toBe(0);
      expect(dx % 15).toBe(0); expect(dy % 25).toBe(0);
      expect(sy + sh).toBeLessThanOrEqual(source.height);
    }
  });
  it("lets loading frames run between atlas chunks and cancels superseded work", async () => {
    const { assets, drawImage } = canvasFixture();
    let current = true;
    const compilation = assets.compileLegacyTilesetAtlasToNh5(
      { width: 640, height: 448 } as HTMLImageElement, 16, null, 16, 16, 16, () => current,
    );
    const firstChunk = drawImage.mock.calls.length;
    expect(firstChunk).toBeGreaterThan(0);
    expect(firstChunk).toBeLessThanOrEqual(64);
    current = false;
    await expect(compilation).rejects.toThrow("superseded");
    expect(drawImage).toHaveBeenCalledTimes(firstChunk);
  });
});

describe("high-resolution tiles", () => {
  it.each([
    ["5.0", "tiles", true, "assets/5.0/PixelHack.png", true],
    ["5.0", "tiles", false, "assets/5.0/PixelHack.png", false],
    ["5.0", "ascii", true, "assets/5.0/PixelHack.png", false],
    ["5.0", "tiles", true, "vulture:assets/vulture/win/vulture/gamedata", false],
  ] as const)("runtime %s, mode %s, option %s, %s -> active %s", (runtimeVersion, tilesetMode, tilesetUseHiResTiles, tilesetPath, active) => {
    const clientOptions = { tilesetMode, tilesetUseHiResTiles, tilesetPath } as Nh3dClientOptions;
    const assets = new TilesetAssets({
      engineState: { characterCreationConfig: { runtimeVersion }, clientOptions, disposed: false },
    } as unknown as TilesetAssetsDependencies);
    const frame = { key: "mon/giant_ant_male" };
    assets.hiResTilePack = { getTile: vi.fn(() => frame), dispose: vi.fn() } as never;
    expect(assets.isHiResTilesActive()).toBe(active);
    expect(assets.resolveHiResTile(0)).toBe(active ? frame : null);
    assets.syncHiResTilePack();
    expect(assets.hiResTilePack !== null).toBe(active);
  });

  it("3D models are their own option and keep the pack for their textures", () => {
    const clientOptions = {
      tilesetMode: "tiles",
      tilesetUseHiResTiles: false,
      tilesetUse3dTerrainModels: true,
      tilesetPath: "assets/5.0/PixelHack.png",
    } as Nh3dClientOptions;
    const assets = new TilesetAssets({
      engineState: { characterCreationConfig: { runtimeVersion: "5.0" }, clientOptions, disposed: false },
    } as unknown as TilesetAssetsDependencies);
    const frame = { key: "other/stone" };
    assets.hiResTilePack = { getTile: vi.fn(() => frame), dispose: vi.fn() } as never;
    expect(assets.isHiResTilesActive()).toBe(false);
    expect(assets.isTerrainModelsActive()).toBe(true);
    expect(assets.resolveHiResTile(0)).toBeNull();
    expect(assets.resolveTerrainModelTexture(0)).toBe(frame);
    assets.syncHiResTilePack();
    expect(assets.hiResTilePack).not.toBeNull();
  });
});
