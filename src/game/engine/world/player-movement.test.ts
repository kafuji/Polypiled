import { describe, expect, it, vi } from "vitest";
import { PlayerMovement, type PlayerMovementDependencies } from "./player-movement";
import { InputCommands } from "../input/input-commands";
vi.mock("../../ui-types", () => ({ nh3dOpenCharacterSheetEventName: "open-character-sheet" }));

function fixture(riding = false) {
  const visible = vi.fn();
  const commands = new InputCommands({
    engineState: { uiAdapter: { setRepeatActionVisible: visible } },
  } as unknown as ConstructorParameters<typeof InputCommands>[0]);
  const movement = new PlayerMovement({
    inputCommands: commands,
    camera: { reserveSharedStepMotionDurationMs: () => 100, recenterCameraOnPlayerIfNeeded: vi.fn() },
    entityMovement: { activeEntityMoveTransitions: new Map(), tryStartProvisionalPlayerSwapTransitions: vi.fn(() => false), startPlayerMoveTransition: vi.fn() },
    movementInput: { isFpsMode: () => false, lastMovementInputAtMs: 0 },
    runtimeEntityTracking: { hasRuntimeTrackedPlayerEntitySupport: () => false, isPlayerRiding: () => riding },
    promptDialogs: { pendingStartupInventoryRefresh: false },
  } as unknown as PlayerMovementDependencies);
  return { movement, commands, visible, deps: (movement as unknown as { dependencies: PlayerMovementDependencies }).dependencies };
}

describe("repeat action after player movement", () => {
  it.each([[5, 4], [4, 3], [25, 18]])("clears repeat state after a confirmed move to %i,%i", (x, y) => {
    const f = fixture(); f.movement.hasSeenPlayerPosition = true;
    f.commands.armRepeatableAction({ kind: "quick", value: "search" });
    f.commands.queueRepeatDirectionCandidate({ kind: "quick", value: "kick" });
    f.commands.repeatAutoDirectionPending = true;
    f.commands.repeatAutoDirectionArmedAtMs = Date.now();
    f.movement.recordPlayerMovement(4, 4, x, y);
    expect(f.commands.repeatActionVisible).toBe(false);
    expect(f.commands.repeatableAction).toBeNull();
    expect(f.commands.repeatDirectionCandidate).toBeNull();
    expect(f.commands.repeatAutoDirectionPending).toBe(false);
    expect(f.commands.repeatAutoDirectionArmedAtMs).toBe(0);
    expect(f.visible).toHaveBeenLastCalledWith(false);
  });
  it("keeps repeat available for same-tile updates, such as a blocked move or repeated action", () => {
    const f = fixture(); f.movement.hasSeenPlayerPosition = true;
    f.commands.armRepeatableAction({ kind: "quick", value: "search" });
    f.movement.recordPlayerMovement(4, 4, 4, 4);
    expect(f.commands.repeatActionVisible).toBe(true);
    expect(f.visible).not.toHaveBeenCalledWith(false);
  });
  it("does not treat the initial player position as movement", () => {
    const f = fixture(); f.commands.armRepeatableAction({ kind: "quick", value: "search" });
    f.movement.recordPlayerMovement(0, 0, 4, 4);
    expect(f.commands.repeatActionVisible).toBe(true);
    f.movement.recordPlayerMovement(4, 4, 5, 4);
    expect(f.commands.repeatActionVisible).toBe(false);
  });
});

describe("hero move transition while riding", () => {
  it("animates the hero sprite when on foot", () => {
    const f = fixture(); f.movement.hasSeenPlayerPosition = true;
    f.movement.recordPlayerMovement(4, 4, 5, 4);
    expect(f.deps.entityMovement.startPlayerMoveTransition).toHaveBeenCalled();
  });
  it("leaves the move to the steed's own transition when mounted", () => {
    const f = fixture(true); f.movement.hasSeenPlayerPosition = true;
    f.movement.recordPlayerMovement(4, 4, 5, 4);
    expect(f.deps.entityMovement.startPlayerMoveTransition).not.toHaveBeenCalled();
    expect(f.deps.entityMovement.tryStartProvisionalPlayerSwapTransitions).not.toHaveBeenCalled();
  });
});
