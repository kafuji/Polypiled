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
