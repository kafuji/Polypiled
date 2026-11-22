import { describe, expect, it } from "vitest";
import { defaultClassOrder, type InventoryObject, type InventoryState } from "../../../runtime/inventory-state";
import type { KnowledgeMonster } from "../../../runtime/knowledge";
import { InventoryProcedures, fixedProcedure, type InventoryProcedureState } from "./inventory-procedures";

const state = (wornMask: number): InventoryState => ({
  weight: 10,
  capacity: 450,
  encumbrance: 0,
  twoWeapon: false,
  punished: false,
  objects: [{ id: 1, letter: "a", wornMask, quantity: 1, donning: false, container: null } as unknown as InventoryObject],
  floor: [],
  floorHidden: false,
  floorCount: 0,
  gameId: 1, classOrder: defaultClassOrder,
});

function harness() {
  let current: InventoryState | null = state(0);
  let monsters: KnowledgeMonster[] = [];
  const sent: string[] = [];
  const published: Array<InventoryProcedureState | null> = [];
  const procedures = new InventoryProcedures({
    sendInput: (input) => sent.push(input),
    latestInventoryState: () => current,
    visibleMonsters: () => monsters,
    publish: (value) => published.push(value),
  });
  return {
    procedures,
    sent,
    published,
    set: (next: InventoryState) => (current = next),
    see: (next: KnowledgeMonster[]) => (monsters = next),
    last: () => published[published.length - 1],
  };
}

const hostile = { id: 7, hero: false, pet: false, peaceful: false, sense: "sight" } as KnowledgeMonster;

describe("inventory procedures", () => {
  it("sends one step per settle until the plan is done", () => {
    const h = harness();
    h.procedures.start(fixedProcedure("swap", [{ op: "wear", item: "a" }, { op: "remove", item: "a" }]));
    expect(h.sent).toEqual(["__NH3D_INVOP__:wear:a"]);
    h.set(state(1));
    h.procedures.onSettled();
    expect(h.sent).toEqual(["__NH3D_INVOP__:wear:a", "__NH3D_INVOP__:remove:a"]);
    h.set(state(0));
    h.procedures.onSettled();
    expect(h.last()).toEqual({ label: "swap", status: "done", steps: 2 });
    expect(h.procedures.running).toBe(false);
  });

  it("stops when a step changed nothing", () => {
    const h = harness();
    h.procedures.start(fixedProcedure("p", [{ op: "wear", item: "a" }, { op: "wear", item: "a" }]));
    h.procedures.onSettled();
    expect(h.sent).toHaveLength(1);
    expect(h.last()?.status).toBe("failed");
  });

  it("stops when a new hostile comes into view, not for one seen at the start", () => {
    const h = harness();
    h.see([{ ...hostile, id: 3 }]);
    h.procedures.start(fixedProcedure("p", [{ op: "wear", item: "a" }, { op: "remove", item: "a" }, { op: "wear", item: "a" }]));
    h.set(state(1));
    h.procedures.onSettled();
    expect(h.sent).toHaveLength(2);
    h.see([{ ...hostile, id: 3 }, hostile]);
    h.set(state(0));
    h.procedures.onSettled();
    expect(h.sent).toHaveLength(2);
    expect(h.last()?.status).toBe("interrupted");
  });

  it("can be cancelled, and ignores settles it did not wait for", () => {
    const h = harness();
    h.procedures.onSettled();
    expect(h.sent).toEqual([]);
    h.procedures.start(fixedProcedure("p", [{ op: "wear", item: "a" }]));
    h.procedures.cancel();
    expect(h.last()?.status).toBe("cancelled");
    h.set(state(1));
    h.procedures.onSettled();
    expect(h.sent).toHaveLength(1);
  });
});
