import { describe, expect, it } from "vitest";

import {
  MIN_RECOVERABLE_CHECKPOINT_LEVEL_ZERO_BYTES,
  getRuntimeCheckpointMountDir,
  getRuntimeRootPersistenceDbName,
  getRuntimeSaveCompatTag,
  getRuntimeSaveDbName,
  getRuntimeSaveDbNames,
  getRuntimeSaveMountDir,
  isCheckpointLevelFilename,
  isRecoverableCheckpointLevelZeroByteLength,
  resolveRuntimeSaveDbNames,
  supportsRuntimeRootPersistence,
} from "./save-storage";

describe("save-storage: normal (manual) save loading", () => {
  it("stores manual saves on the /save mount", () => {
    expect(getRuntimeSaveMountDir()).toBe("/save");
  });

  it("resolves the save mount relative to the runtime cwd", () => {
    expect(getRuntimeSaveMountDir("/nethack")).toBe(
      "/nethack/save",
    );
    // Trailing slashes / bare root normalize to the top-level mount.
    expect(getRuntimeSaveMountDir("/")).toBe("/save");
    expect(getRuntimeSaveMountDir("")).toBe("/save");
  });

  it("backs the /save mount with a /save-<compat> IndexedDB database", () => {
    const dbName = getRuntimeSaveDbName();
    expect(dbName).toBe(`/save-${getRuntimeSaveCompatTag()}`);
    expect(dbName.startsWith("/save-")).toBe(true);
  });

  it("does not reuse the databases of the removed runtimes", () => {
    const dbName = getRuntimeSaveDbName();
    expect(dbName).not.toContain("367");
    expect(dbName).not.toContain("slashem");
  });

  it("enumerates save databases across known playground roots", () => {
    const names = getRuntimeSaveDbNames();
    const tag = getRuntimeSaveCompatTag();
    expect(names).toContain(`/save-${tag}`);
    expect(names).toContain(`/nethack/save-${tag}`);
  });
});

describe("save-storage: autosave (checkpoint) loading", () => {
  // Regression: when root persistence was added, checkpoint storage
  // was moved from the /save mount to "/", stranding autosaves. Checkpoints
  // must resolve to the /save mount for EVERY runtime, root persistence or not.
  it("stores autosave checkpoints on the /save mount, never at root", () => {
    const checkpointDir = getRuntimeCheckpointMountDir();
    expect(checkpointDir).toBe("/save");
    expect(checkpointDir).not.toBe("/");
  });

  it("checkpoint mount matches the manual save mount (shared /save path)", () => {
    expect(getRuntimeCheckpointMountDir()).toBe(
      getRuntimeSaveMountDir(),
    );
  });

  it("checkpoint mount honors the runtime cwd", () => {
    expect(getRuntimeCheckpointMountDir("/nethack")).toBe(
      "/nethack/save",
    );
  });
});

describe("save-storage: root persistence stays decoupled from checkpoints", () => {
  // Root persistence must remain enabled so top-scores/record/xlogfile/bones
  // survive reloads, but it must NOT be the home of checkpoint shards.
  it("enables root persistence", () => {
    expect(supportsRuntimeRootPersistence()).toBe(true);
  });

  it("keeps the root-persistence database separate from the save database", () => {
    const rootDb = getRuntimeRootPersistenceDbName();
    const saveDb = getRuntimeSaveDbName();
    expect(rootDb).toBe(`/root-${getRuntimeSaveCompatTag()}`);
    expect(rootDb).not.toBe(saveDb);
  });

  it("exposes both the save and root databases for top-score reads", async () => {
    // In the Node test env indexedDB is undefined, so this resolves to the
    // static set (save DBs + root persistence DB) without enumeration.
    const names = await resolveRuntimeSaveDbNames();
    expect(names).toContain(getRuntimeSaveDbName());
    expect(names).toContain(getRuntimeRootPersistenceDbName());
  });
});

describe("save-storage: checkpoint level-file classification", () => {
  it("recognizes NetHack checkpoint/level shards", () => {
    for (const name of ["0Web_user.0", "0Web_user.1", "0Web_user.15", "awizard.0"]) {
      expect(isCheckpointLevelFilename(name)).toBe(true);
    }
  });

  it("does not treat root-persistence game data as a checkpoint shard", () => {
    for (const name of [
      "record",
      "xlogfile",
      "logfile",
      "sysconf",
      "nhdat",
      "0Web_user", // lock base name, no numeric level suffix
      "bonM0.T", // special-level bones use a letter suffix -> root persistence
    ]) {
      expect(isCheckpointLevelFilename(name)).toBe(false);
    }
  });

  it("only classifies bare filenames, never paths", () => {
    expect(isCheckpointLevelFilename("/0Web_user.0")).toBe(false);
    expect(isCheckpointLevelFilename("save/0Web_user.0")).toBe(false);
    expect(isCheckpointLevelFilename("")).toBe(false);
    expect(isCheckpointLevelFilename(null)).toBe(false);
    expect(isCheckpointLevelFilename(undefined)).toBe(false);
  });
});

describe("save-storage: recoverable checkpoint detection", () => {
  it("requires at least the minimum level-zero byte length", () => {
    expect(
      isRecoverableCheckpointLevelZeroByteLength(
        MIN_RECOVERABLE_CHECKPOINT_LEVEL_ZERO_BYTES,
      ),
    ).toBe(true);
    expect(
      isRecoverableCheckpointLevelZeroByteLength(
        MIN_RECOVERABLE_CHECKPOINT_LEVEL_ZERO_BYTES + 1,
      ),
    ).toBe(true);
  });

  it("rejects bare lock files and missing/invalid sizes", () => {
    expect(
      isRecoverableCheckpointLevelZeroByteLength(
        MIN_RECOVERABLE_CHECKPOINT_LEVEL_ZERO_BYTES - 1,
      ),
    ).toBe(false);
    expect(isRecoverableCheckpointLevelZeroByteLength(0)).toBe(false);
    expect(isRecoverableCheckpointLevelZeroByteLength(null)).toBe(false);
    expect(isRecoverableCheckpointLevelZeroByteLength(undefined)).toBe(false);
    expect(isRecoverableCheckpointLevelZeroByteLength(Number.NaN)).toBe(false);
    expect(isRecoverableCheckpointLevelZeroByteLength(-10)).toBe(false);
  });
});
