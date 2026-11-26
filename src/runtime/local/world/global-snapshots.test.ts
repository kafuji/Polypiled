import { afterEach, describe, expect, it } from "vitest";
import { RuntimeGlobalSnapshots } from "./global-snapshots";

const toInt = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

function snapshotsWithGlobals(globals: Record<string, unknown>): RuntimeGlobalSnapshots {
  (globalThis as any).nethackGlobal = { globals };
  return new RuntimeGlobalSnapshots({ memory: { normalizeRuntimeInteger: toInt } } as any);
}

const dungeons = [
  { dname: "The Dungeons of Doom", ledger_start: 0, depth_start: 1 },
  { dname: "Gehennom", ledger_start: 27, depth_start: 28 },
];

describe("RuntimeGlobalSnapshots level identity", () => {
  afterEach(() => {
    delete (globalThis as any).nethackGlobal;
  });

  it("names the current dungeon and its depth from the exported dungeons", () => {
    const identity = snapshotsWithGlobals({
      u: { uz: { dnum: 1, dlevel: 22 } },
      dungeons,
    }).resolveRuntimeLevelIdentity();
    expect(identity).toMatchObject({ dnum: 1, dlevel: 22, dungeonName: "Gehennom", ledgerNo: 49, depth: 49 });
  });
});
