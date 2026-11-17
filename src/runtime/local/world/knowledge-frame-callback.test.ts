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
