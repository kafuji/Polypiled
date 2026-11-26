import { describe, expect, it, vi } from "vitest";
import { encodeKnowledgeFrame } from "../../knowledge-fixture";
import { RuntimeMapCallbacks } from "./map-callbacks";

function callbacks() {
  const emit = vi.fn();
  const mapCallbacks = new RuntimeMapCallbacks({
    coordinator: { emit, eventHandler: () => undefined, logRoutine: () => undefined, isClosed: false, runtimeVersion: "5.0" },
  } as never);
  return { mapCallbacks, emit };
}

describe("knowledge frame notifications", () => {
  it("emits a decoded frame", () => {
    const { mapCallbacks, emit } = callbacks();
    expect(mapCallbacks.handleShimKnowledgeFrame([encodeKnowledgeFrame({ sequence: 4, hero: { x: 7, y: 8 } })])).toBe(0);
    expect(emit).toHaveBeenCalledTimes(1);
    const event = emit.mock.calls[0][0];
    expect(event.type).toBe("knowledge_frame");
    expect(event.frame.sequence).toBe(4);
    expect(event.frame.hero).toMatchObject({ x: 7, y: 8 });
  });

  it("drops a frame it cannot read and warns once", () => {
    const { mapCallbacks, emit } = callbacks();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mapCallbacks.handleShimKnowledgeFrame([encodeKnowledgeFrame({ version: 99 })]);
    mapCallbacks.handleShimKnowledgeFrame([encodeKnowledgeFrame({ version: 99 })]);
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("floor information notifications", () => {
  it("emits what lies under the hero", () => {
    const { mapCallbacks, emit } = callbacks();
    const raw = JSON.stringify({ v: 1, x: 2, y: 3, feature: "sink", engraving: null, hidden: false, objects: [], count: 0 });
    expect(mapCallbacks.handleShimFloorHere([raw])).toBe(0);
    expect(emit).toHaveBeenCalledWith({ type: "floor_here", floorHere: expect.objectContaining({ feature: "sink", x: 2, y: 3 }) });
  });

  it("drops what it cannot read", () => {
    const { mapCallbacks, emit } = callbacks();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mapCallbacks.handleShimFloorHere(["not json"]);
    expect(emit).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("inventory notifications", () => {
  it("emits the hero's inventory", () => {
    const { mapCallbacks, emit } = callbacks();
    const raw = JSON.stringify({ v: 1, weight: 10, capacity: 450, encumbrance: 0, objects: [] });
    expect(mapCallbacks.handleShimInventory([raw])).toBe(0);
    expect(emit).toHaveBeenCalledWith({
      type: "inventory_state",
      inventory: expect.objectContaining({ weight: 10, capacity: 450, objects: [] }),
    });
  });

  it("drops what it cannot read and warns once", () => {
    const { mapCallbacks, emit } = callbacks();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mapCallbacks.handleShimInventory(["not json"]);
    mapCallbacks.handleShimInventory(["not json"]);
    expect(emit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("combat feedback notifications", () => {
  it("emits what the hero feels of a fight", () => {
    const { mapCallbacks, emit } = callbacks();
    expect(mapCallbacks.handleShimCombatFeedback([1, 10, 5, 7])).toBe(0);
    mapCallbacks.handleShimCombatFeedback([2, 11, 6, 0]);
    mapCallbacks.handleShimCombatFeedback([3, 4, 4, 0]);
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: "combat_feedback", kind: "hit", x: 10, y: 5, amount: 7 },
      { type: "combat_feedback", kind: "miss", x: 11, y: 6, amount: 0 },
      { type: "combat_feedback", kind: "dodge", x: 4, y: 4, amount: 0 },
    ]);
  });

  it("ignores kinds it does not know", () => {
    const { mapCallbacks, emit } = callbacks();
    mapCallbacks.handleShimCombatFeedback([9, 1, 1, 1]);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("hero blow and water fall notifications", () => {
  it("tells which hand struck and whether it hit", () => {
    const { mapCallbacks, emit } = callbacks();
    expect(mapCallbacks.handleShimHeroBlow([1, 10, 5, 1])).toBe(0);
    mapCallbacks.handleShimHeroBlow([2, 10, 5, 0]);
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: "hero_blow", hand: "main", x: 10, y: 5, hit: true },
      { type: "hero_blow", hand: "off", x: 10, y: 5, hit: false },
    ]);
  });

  it("tells who fell into water", () => {
    const { mapCallbacks, emit } = callbacks();
    mapCallbacks.handleShimWaterFall([0, 3, 4, 0]);
    mapCallbacks.handleShimWaterFall([42, 6, 7, 1]);
    expect(emit.mock.calls.map(([event]) => event)).toEqual([
      { type: "water_fall", monsterId: null, x: 3, y: 4, drowned: false },
      { type: "water_fall", monsterId: 42, x: 6, y: 7, drowned: true },
    ]);
  });
});
