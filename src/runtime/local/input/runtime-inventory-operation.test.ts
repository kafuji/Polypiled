import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LocalNetHackRuntime from "../../LocalNetHackRuntime";
import {
  encodeInventoryOperation,
  inventoryOperationInputPrefix,
  inventoryOperationKeyCode,
  isInventoryOperationRequest,
} from "../../input/inventory-operation";
import type { RuntimeSystems } from "../create-runtime-systems";
import { RuntimeBootstrap } from "../startup/bootstrap";

let runtime: LocalNetHackRuntime;
let systems: RuntimeSystems;
const host = globalThis as { nethackGlobal?: Record<string, unknown> };

beforeEach(() => {
  vi.spyOn(RuntimeBootstrap.prototype, "initializeNetHack").mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  runtime = new LocalNetHackRuntime(() => {});
  runtime.nethackModule = { HEAPU8: new Uint8Array(4096) };
  systems = (runtime as unknown as { systems: RuntimeSystems }).systems;
  host.nethackGlobal = { ...(host.nethackGlobal || {}), nh3dInventoryRequest: null };
});
afterEach(() => {
  runtime.shutdown("test complete");
  vi.restoreAllMocks();
});

const nextCommand = () => runtime.handleUICallback("shim_nh_poskey", [64, 68, 72]);
const sellQuestion = () => runtime.handleUICallback("shim_yn_function", [
  "Will you accept 10 gold pieces for your dagger?", "ynaq", 110,
]);
const send = (request: string) => runtime.sendInput(`${inventoryOperationInputPrefix}${request}`);

describe("inventory operation encoding", () => {
  it("encodes what the core accepts", () => {
    expect(encodeInventoryOperation({ op: "adjust", from: "a", to: "Q" })).toBe("adjust:a:Q");
    expect(encodeInventoryOperation({ op: "puton", item: "d", hand: "left" })).toBe("puton:d:l");
    expect(encodeInventoryOperation({ op: "wield", item: "-" })).toBe("wield:-");
    expect(encodeInventoryOperation({ op: "swap" })).toBe("swap");
    expect(encodeInventoryOperation({ op: "adjust", from: "a", to: "a" })).toBeNull();
    expect(encodeInventoryOperation({ op: "wear", item: "-" })).toBeNull();
    expect(isInventoryOperationRequest("wear:c")).toBe(true);
    expect(isInventoryOperationRequest("wear:c:x")).toBe(false);
    expect(isInventoryOperationRequest("drop:c")).toBe(false);
  });
});

describe("inventory operations at command boundaries", () => {
  it("services an already waiting command prompt", async () => {
    const command = nextCommand();
    send("wear:c");
    expect(await command).toBe(inventoryOperationKeyCode);
    expect(host.nethackGlobal?.nh3dInventoryRequest).toBe("wear:c");
  });

  it("waits through a question and never answers it", async () => {
    send("adjust:a:q");
    const answer = sellQuestion();
    expect(host.nethackGlobal?.nh3dInventoryRequest).toBeNull();
    runtime.sendInput("n");
    expect(await answer).toBe(110);
    expect(await nextCommand()).toBe(inventoryOperationKeyCode);
    expect(host.nethackGlobal?.nh3dInventoryRequest).toBe("adjust:a:q");
  });

  it("runs queued operations one per command prompt, in order", async () => {
    send("takeoff:c");
    send("wear:d");
    expect(await nextCommand()).toBe(inventoryOperationKeyCode);
    expect(host.nethackGlobal?.nh3dInventoryRequest).toBe("takeoff:c");
    expect(await nextCommand()).toBe(inventoryOperationKeyCode);
    expect(host.nethackGlobal?.nh3dInventoryRequest).toBe("wear:d");
    const command = nextCommand();
    runtime.sendInput(".");
    expect(await command).toBe(46);
  });

  it("ignores requests the core would refuse", async () => {
    send("drop:c");
    expect(systems.inputRequests.pendingInventoryOperations).toEqual([]);
    const command = nextCommand();
    runtime.sendInput(".");
    expect(await command).toBe(46);
  });
});
