import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityMovement, PLAYER_MOVE_HOLD_TIMEOUT_MS } from "./entity-movement";

function setup() {
  const playerMovement = { playerPos: { x: 5, y: 5 } };
  const refresh = vi.fn();
  const movement = new EntityMovement({
    camera: { fpsStepCameraMinDurationMs: 60, runtimeTravelStepDelayMs: 60 },
    levelTerrainCache: {
      lastKnownTerrain: new Map(),
      parseTileKey: (key: string) => {
        const [x, y] = key.split(",").map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      },
    },
    playerMovement,
    tileUpdates: { refreshTileVisualFromStateCache: refresh },
  } as never);
  const object = new THREE.Object3D();
  const dispose = vi.fn();
  const start = (toKey: string) =>
    movement.beginOrRetargetEntityMoveTransition("player", toKey, 100, null, () => ({ object, dispose }));
  return { movement, playerMovement, object, dispose, start };
}

describe("hero move animation reconciled with the confirmed square", () => {
  let now = 0;
  afterEach(() => vi.restoreAllMocks());
  const at = (ms: number) => {
    now = ms;
    vi.spyOn(performance, "now").mockReturnValue(now);
  };

  it("carries on to the square the hero crawled out onto", () => {
    const { movement, playerMovement, dispose, start } = setup();
    at(0);
    start("6,5"); // stepped into water at (6, 5)
    playerMovement.playerPos = { x: 7, y: 6 }; // crawled out onto (7, 6)
    movement.finalizeHeldPlayerMoveTransitionIfConfirmed(7, 6);
    for (const ms of [200, 400, 600]) {
      at(ms);
      movement.updateEntityMoveTransitions();
    }
    expect(movement.activeEntityMoveTransitions.has("player")).toBe(false);
    expect(dispose).toHaveBeenCalled();
  });

  it("drops a copy held on a square the hero never reached", () => {
    const { movement, dispose, start } = setup();
    at(0);
    start("6,5"); // the hero stays at (5, 5): the step was refused
    at(200);
    movement.updateEntityMoveTransitions();
    expect(movement.activeEntityMoveTransitions.get("player")?.holdAtDestinationUntilConfirmation).toBe(true);
    at(200 + PLAYER_MOVE_HOLD_TIMEOUT_MS + 1);
    movement.updateEntityMoveTransitions();
    // Back to the hero's square, then done.
    for (const ms of [1600, 1800, 2000]) {
      at(ms);
      movement.updateEntityMoveTransitions();
    }
    expect(movement.activeEntityMoveTransitions.has("player")).toBe(false);
    expect(dispose).toHaveBeenCalled();
  });

  it("still finishes normally on the confirmed square", () => {
    const { movement, playerMovement, dispose, start } = setup();
    at(0);
    start("6,5");
    playerMovement.playerPos = { x: 6, y: 5 };
    movement.finalizeHeldPlayerMoveTransitionIfConfirmed(6, 5);
    at(200);
    movement.updateEntityMoveTransitions();
    expect(movement.activeEntityMoveTransitions.has("player")).toBe(false);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
