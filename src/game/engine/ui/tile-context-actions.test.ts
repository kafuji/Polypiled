import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  TileContextActions,
  type TileContextActionsDependencies,
} from "./tile-context-actions";

function fixture() {
  const selfTile = new THREE.Mesh();
  selfTile.userData.isLootLikeCharacter = true;
  const rayTile = new THREE.Mesh();
  const crosshairTile = new THREE.Mesh();
  const setFpsCrosshairContext = vi.fn();
  const sendInput = vi.fn();
  const sendMouseInput = vi.fn();
  const dependencies = {
    aimHighlights: {},
    camera: { getFpsAimDirectionFromCamera: vi.fn(() => ({ dx: 1, dy: 0 })) },
    controllerGameplay: {},
    directionPrompts: { isInDirectionQuestion: false },
    engineMessages: { logClickLookTileDebug: vi.fn() },
    engineState: { session: {}, uiAdapter: { setFpsCrosshairContext } },
    entityBillboards: { monsterBillboards: new Map() },
    extendedCommands: { metaCommandModeActive: false },
    inputCommands: {
      clearAutomaticGlancePendingState: vi.fn(),
      contextualGlanceProbePrefix: "__CTX_GLANCE_PROBE__",
      executeQuickAction: vi.fn(),
      sendInput,
      sendInputSequence: vi.fn(),
      sendMouseInput,
      shouldUseLegacyTileContextLookProbe: vi.fn(() => false),
      skipNextMobileFpsClickLookPromptMessage: false,
    },
    levelTerrainCache: { parseTileStateSignature: vi.fn() },
    movementInput: { isFpsMode: vi.fn(() => true), shouldUseFpsSelfTileDirectionTarget: vi.fn(() => false) },
    playerMovement: { playerPos: { x: 4, y: 6 } },
    pointerLock: { syncFpsPointerLockForUiState: vi.fn() },
    pointerTargeting: {
      getTilePositionFromClientCoordinates: vi.fn(),
      getTileUnderFpsCrosshair: vi.fn(() => ({ key: "9,9", x: 9, y: 9, mesh: crosshairTile })),
    },
    positionSelection: { isFpsFarLookViewActive: vi.fn(() => false), positionInputModeActive: false },
    promptDialogs: {
      isAnyModalVisible: vi.fn(() => false),
      isInfoDialogOpen: vi.fn(() => false),
      isInventoryDialogOpen: vi.fn(() => false),
      isTextInputActive: false,
    },
    questionMenus: { isInQuestion: false },
    renderPipeline: { renderer: {} },
    runtimeEntityTracking: { isPlayerRiding: vi.fn(() => false) },
    terminalRendering: { terminalRenderOptionStates: {} },
    tileFaceTextureRotationDebug: { cycleRotation: vi.fn(), isEnabled: vi.fn(() => false) },
    tileRendering: { tileMap: new Map([["4,6", selfTile], ["7,6", rayTile], ["9,9", crosshairTile]]) },
    tileUpdates: { tileStateCache: new Map() },
    tilesetAssets: { getWorldTileScaleX: vi.fn(() => 1), resolveRuntimeVersion: vi.fn(), shouldUseVultureTiles: vi.fn(() => false) },
    worldClassification: { getKnownTerrainSnapshotAtKey: vi.fn(() => null), isLootLikeBehavior: vi.fn(() => false), isMonsterLikeBehavior: vi.fn(() => false) },
  } as unknown as TileContextActionsDependencies;
  return {
    context: new TileContextActions(dependencies),
    dependencies,
    sendInput,
    sendMouseInput,
    setFpsCrosshairContext,
  };
}

describe("immersive FPS context target", () => {
  it("keeps an explicit ray target through updates and probes instead of following the head crosshair", () => {
    const f = fixture();

    f.context.openFpsCrosshairContextMenu({ x: 4, y: 6 });
    f.context.updateFpsCrosshairContextMenu();

    expect(f.dependencies.pointerTargeting.getTileUnderFpsCrosshair).not.toHaveBeenCalled();
    expect(f.context.activeContextActionTile).toEqual({ x: 4, y: 6 });
    expect(f.sendInput).toHaveBeenCalledExactlyOnceWith(":", { keepContextMenuOpen: true });
    expect(f.sendMouseInput).not.toHaveBeenCalled();
    expect(f.setFpsCrosshairContext).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tileX: 4,
        tileY: 6,
        actions: expect.arrayContaining([expect.objectContaining({ id: "eat" })]),
      }),
    );
  });

  it("probes a remote explicit ray target, then restores desktop crosshair targeting after close", () => {
    const f = fixture();

    f.context.openFpsCrosshairContextMenu({ x: 7, y: 6 });

    expect(f.context.activeContextActionTile).toEqual({ x: 7, y: 6 });
    expect(f.dependencies.pointerTargeting.getTileUnderFpsCrosshair).not.toHaveBeenCalled();
    expect(f.sendMouseInput).toHaveBeenCalledExactlyOnceWith(7, 6, 0, {
      keepContextMenuOpen: true,
    });
    f.context.closeFpsCrosshairContextMenu(false);
    f.context.openFpsCrosshairContextMenu();

    expect(f.dependencies.pointerTargeting.getTileUnderFpsCrosshair).toHaveBeenCalledOnce();
    expect(f.context.activeContextActionTile).toEqual({ x: 9, y: 9 });
  });
});

describe("riding context actions", () => {
  const ids = (actions: { id: string; kind: string; value: string }[]) =>
    actions.map((action) => `${action.kind}:${action.id}:${action.value}`);

  it("offers Ride on an adjacent saddled monster while on foot", () => {
    const f = fixture();
    const actions = f.context.getFpsCrosshairActionsForTile(
      "5,6", new THREE.Mesh(), "monster", "u  pony (tame saddled pony)",
    );
    expect(ids(actions)).toContain("extended:ride:ride");
  });

  it("omits Ride for unsaddled, distant, or already-mounted cases", () => {
    const f = fixture();
    const mesh = new THREE.Mesh();
    expect(ids(f.context.getFpsCrosshairActionsForTile("5,6", mesh, "monster", "u  pony (tame pony)")))
      .not.toContain("extended:ride:ride");
    expect(ids(f.context.getFpsCrosshairActionsForTile("7,6", mesh, "monster", "u  pony (tame saddled pony)")))
      .not.toContain("extended:ride:ride");
    vi.mocked(f.dependencies.runtimeEntityTracking.isPlayerRiding).mockReturnValue(true);
    expect(ids(f.context.getFpsCrosshairActionsForTile("5,6", mesh, "monster", "u  pony (tame saddled pony)")))
      .not.toContain("extended:ride:ride");
  });

  it("offers Dismount on the hero's own tile only while riding", () => {
    const f = fixture();
    const mesh = new THREE.Mesh();
    expect(ids(f.context.getFpsCrosshairActionsForTile("4,6", mesh))).not.toContain("extended:dismount:ride");
    vi.mocked(f.dependencies.runtimeEntityTracking.isPlayerRiding).mockReturnValue(true);
    expect(ids(f.context.getFpsCrosshairActionsForTile("4,6", mesh))).toContain("extended:dismount:ride");
  });
});
