import type { EngineState } from "../runtime/engine-state";
import type { MovementInput } from "../input/movement-input";
import type { TilesetAssets } from "./tileset-assets";

export interface DarkWallOverridesDependencies {
  readonly engineState: Pick<
    EngineState,
    "clientOptions"
  >;
  readonly movementInput: Pick<
    MovementInput,
    "isFpsMode"
  >;
  readonly tilesetAssets: Pick<
    TilesetAssets,
    "isVultureTilesActive"
    | "resolveHiResTile"
    | "resolveOverrideTileIndexForRuntime"
  >;
}

/**
 * The player's tile and solid-colour choices for NetHack 5.0 dark corridor
 * walls drawn with a tileset that has no art for them
 * (`TilesetAssets.isNh5DarkCorridorWallVariantForLegacyTileset`). Every method
 * takes whether that compatibility applies to the tile being drawn.
 */
export class DarkWallOverrides {
  constructor(private readonly dependencies: DarkWallOverridesDependencies) {}

  private isSuppressedByVultureTiles(): boolean {
    return this.dependencies.tilesetAssets.isVultureTilesActive(this.dependencies.engineState.clientOptions);
  }

  private isSolidColorActive(active: boolean): boolean {
    return active &&
      !this.isSuppressedByVultureTiles() &&
      this.dependencies.engineState.clientOptions.darkCorridorWallSolidColorOverrideEnabled;
  }

  resolveTileTextureIndex(fallbackTileIndex: number, active: boolean): number {
    const options = this.dependencies.engineState.clientOptions;
    if (
      !active ||
      this.isSuppressedByVultureTiles() ||
      options.darkCorridorWallSolidColorOverrideEnabled ||
      !options.darkCorridorWallTileOverrideEnabled
    ) {
      return fallbackTileIndex;
    }
    const overrideTileIndex = Math.trunc(options.darkCorridorWallTileOverrideTileId);
    if (!Number.isFinite(overrideTileIndex) || overrideTileIndex < 0) {
      return fallbackTileIndex;
    }
    return this.dependencies.tilesetAssets.resolveOverrideTileIndexForRuntime(overrideTileIndex);
  }

  resolveSolidColorHex(active: boolean): string | null {
    if (!this.isSolidColorActive(active)) {
      return null;
    }
    const options = this.dependencies.engineState.clientOptions;
    const preferredHex = this.dependencies.movementInput.isFpsMode()
      ? options.darkCorridorWallSolidColorHexFps
      : options.darkCorridorWallSolidColorHex;
    const normalized = String(preferredHex || options.darkCorridorWallSolidColorHex || "").trim();
    const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);
    return match ? `#${match[1].toLowerCase()}` : null;
  }

  /**
   * The solid colour for a dark wall drawn with this tile, or null to show the
   * tile itself. The colour stands in for rock that has no art of its own; a
   * high-resolution pack paints that rock (other/stone). Every path that
   * (re)applies a wall material must use this, or blocks that are rebuilt later
   * (such as rounded corners) fall back to the flat colour.
   */
  resolveSolidColorHexForTile(
    active: boolean,
    tileTextureIndex: number,
    useTerrainTiles: boolean,
  ): string | null {
    if (
      active &&
      useTerrainTiles &&
      tileTextureIndex >= 0 &&
      this.dependencies.tilesetAssets.resolveHiResTile(tileTextureIndex) !== null
    ) {
      return null;
    }
    return this.resolveSolidColorHex(active);
  }

  resolveSolidColorGridEnabled(active: boolean): boolean {
    return this.isSolidColorActive(active) &&
      this.dependencies.engineState.clientOptions.darkCorridorWallSolidColorGridEnabled === true;
  }

  resolveSolidColorGridDarknessPercent(active: boolean): number {
    if (!this.isSolidColorActive(active)) {
      return 15;
    }
    const raw = this.dependencies.engineState.clientOptions.darkCorridorWallSolidColorGridDarknessPercent;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return 15;
    }
    return Math.max(0, Math.min(100, Math.round(raw)));
  }
}
