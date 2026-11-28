import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EFFECT_STEP_DELAY_MS, RuntimeTravel } from "./travel-delay";

function makeTravel() {
  const mapCallbacks = {
    effectGlyphSerial: 0,
    playerPosition: { x: 10, y: 5 },
    playerPositionMovementSerial: 3,
  };
  const travel = new RuntimeTravel({
    coordinator: { emit: vi.fn(), eventHandler: null, runtimeVersion: 5 },
    mapCallbacks,
    mouseInput: { beginClickMoveBlockWindow: vi.fn() },
    status: { readLatestStatusInteger: () => 100 },
  } as never);
  return { travel, mapCallbacks };
}

describe("RuntimeTravel effect delays", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("waits on every beam step even though the hero has not moved", () => {
    const { travel, mapCallbacks } = makeTravel();
    for (let step = 0; step < 5; step++) {
      mapCallbacks.effectGlyphSerial += 1;
      const result = travel.handleShimDelayOutput();
      expect(result).toBeInstanceOf(Promise);
    }
  });

  it("holds an explosion frame for both of its delays, then stops", () => {
    const { travel, mapCallbacks } = makeTravel();
    mapCallbacks.effectGlyphSerial += 9;
    expect(travel.handleShimDelayOutput()).toBeInstanceOf(Promise);
    vi.advanceTimersByTime(EFFECT_STEP_DELAY_MS);
    expect(travel.handleShimDelayOutput()).toBeInstanceOf(Promise);
    vi.advanceTimersByTime(EFFECT_STEP_DELAY_MS);
    // Travel delay at the same square: the travel deduplication applies again.
    expect(travel.handleShimDelayOutput()).toBeInstanceOf(Promise);
    expect(travel.handleShimDelayOutput()).toBe(0);
  });

  it("does not slow headless play", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const { travel, mapCallbacks } = makeTravel();
    mapCallbacks.effectGlyphSerial += 1;
    expect(travel.handleShimDelayOutput()).toBe(0);
  });
});
