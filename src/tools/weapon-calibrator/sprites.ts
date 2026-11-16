import * as THREE from 'three';
import { GlyphTextures } from '../../game/engine/rendering/glyph-textures';
import { flipHeldWeaponTexture } from '../../game/engine/rendering/held-weapon-texture';
import { resolveHeldWeaponTileFlips } from '../../game/engine/rendering/held-weapon-flips';
import { translateNh5TileIndexToNh367 } from '../../game/tileset-367-to-5-translation';
import { defaultNh3dClientOptions } from '../../game/ui-types';
import { inferNh3dTilesetTileDimensions, resolveDefaultNh3dTilesetBackgroundRemovalMode,
  resolveDefaultNh3dTilesetBackgroundTileId, resolveDefaultNh3dTilesetSolidChromaKeyColorHex,
  type Nh3dTilesetEntry } from '../../game/tilesets';

export async function loadAtlas(entry: Nh3dTilesetEntry) {
  const image = new Image();
  image.src = '/' + entry.path;
  await image.decode();
  const { tileWidth: width, tileHeight: height } = inferNh3dTilesetTileDimensions(image.width, image.height, entry.path);
  const columns = Math.floor(image.width / width), count = columns * Math.floor(image.height / height);
  // Catalog data is only an initial selection hint; explicit atlas tile IDs remain authoritative.
  // A 3.6.7-layout atlas is addressed through the same translation the game uses.
  const catalog = await import('../../game/glyphs/glyph-catalog.5.generated');
  const toAtlasTile = (tile: number) => entry.tileLayoutVersion === '5.0' ? tile : translateNh5TileIndexToNh367(tile);
  const suggestedTile = catalog.GLYPH_CATALOG
    .filter(glyph => glyph.kind === 'obj' && glyph.asciiChar === ')' && glyph.tileIndex >= 0)
    .map(glyph => toAtlasTile(glyph.tileIndex))
    .find(tile => tile >= 0 && tile < count) ?? 0;
  const options = { ...defaultNh3dClientOptions, tilesetPath: entry.path,
    tilesetBackgroundRemovalMode: resolveDefaultNh3dTilesetBackgroundRemovalMode(entry.path),
    tilesetBackgroundTileId: resolveDefaultNh3dTilesetBackgroundTileId(entry.path),
    tilesetSolidChromaKeyColorHex: resolveDefaultNh3dTilesetSolidChromaKeyColorHex(entry.path) };
  const unsupportedProjection = (): never => { throw new Error('The atlas preview does not use Vulture projection.'); };
  // Use the game's atlas extraction and background removal without booting the game or WASM.
  const textures = new GlyphTextures({ engineState: { clientOptions: options },
    lighting: { patchMaterialForVignette() {} },
    tilesetAssets: { tileSourceSize: width, tileSourceHeight: height, tilesetTexture: null,
      tilesetBackgroundReferenceTilePixels: null, vultureTilesetTranslator: null,
      resolveTilesetAtlasImageSource: () => image, resolveAtlasTileIndexForRuntime: tile => tile,
      resolveHiResTile: () => null,
      resolveTilesetBackgroundReferenceTileIndex: () => options.tilesetBackgroundTileId,
      resolveTextureAnisotropyLevel: () => 1, drawTilesetBackgroundReferenceTile: () => false },
    vultureProjection: { reprojectVultureWallTexture: unsupportedProjection,
      resolveVultureDoorProjectionDebugFamily: unsupportedProjection, resolveVultureDoorProjectionOrientation: unsupportedProjection,
      resolveVultureWallProjectionFamily: unsupportedProjection, tryDrawVulturePrebakedProjectionTexture: unsupportedProjection },
    vultureProjectionDebug: { captureVultureWallProjectionSourcePreview: unsupportedProjection },
  });
  return { image, width, height, columns, count, options, suggestedTile,
    texture(tile: number, flip = resolveHeldWeaponTileFlips(entry.path, tile)): THREE.CanvasTexture {
      textures.tilesetBackgroundTilePixelsCache.clear();
      const texture = textures.createTileTexture(tile, 1, true);
      return flipHeldWeaponTexture(texture, flip, { source: texture.image, width, height });
    },
  };
}
export type Atlas = Awaited<ReturnType<typeof loadAtlas>>;
