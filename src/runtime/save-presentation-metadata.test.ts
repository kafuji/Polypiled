import { describe, expect, it } from "vitest";

import {
  getLegacySavePresentationMetadataKey,
  getRuntimeSavePresentationMetadataKey,
  normalizeSavePresentationRuntimeVersion,
  normalizeStoredSaveInitOptions,
  resolveSaveResumeInitOptionTokens,
  resolveSavePresentationMetadataEntry,
} from "./save-presentation-metadata";

describe("save presentation metadata", () => {
  it("keeps legacy raw tokens until the save runtime is known", () => {
    const legacyTokens = normalizeStoredSaveInitOptions([
      "DECgraphics",
      "number_pad:0",
    ]);

    expect(legacyTokens).toEqual(["DECgraphics", "number_pad:0"]);
    expect(normalizeStoredSaveInitOptions(legacyTokens, "5.0")).toEqual([
      "number_pad:0",
    ]);
  });

  it("preserves both number pad modes when resuming", () => {
    expect(
      resolveSaveResumeInitOptionTokens(["number_pad:0"]),
    ).toEqual(["number_pad:0"]);
    expect(
      resolveSaveResumeInitOptionTokens(["number_pad:1"]),
    ).toEqual(["number_pad:1"]);
  });

  it("does not force number pad on when legacy metadata has no mode", () => {
    expect(resolveSaveResumeInitOptionTokens([])).toEqual([]);
  });

  it("uses runtime-scoped keys without losing legacy metadata fallback", () => {
    const runtimeKey = getRuntimeSavePresentationMetadataKey(
      "5.0",
      "manual",
      "Player",
    );
    const legacyKey = getLegacySavePresentationMetadataKey(
      "manual",
      "Player",
    );
    const metadata = {
      [legacyKey]: "legacy",
      [runtimeKey]: "scoped",
    };

    expect(
      resolveSavePresentationMetadataEntry(
        metadata,
        "5.0",
        "manual",
        "Player",
      ),
    ).toBe("scoped");
    expect(
      resolveSavePresentationMetadataEntry(
        { [legacyKey]: "legacy" },
        "5.0",
        "manual",
        "Player",
      ),
    ).toBe("legacy");
  });

  it("accepts only the NetHack 5.0 runtime identifier", () => {
    expect(normalizeSavePresentationRuntimeVersion("5.0")).toBe("5.0");
    // Removed runtimes that older builds wrote into metadata.
    expect(normalizeSavePresentationRuntimeVersion("3.6.7")).toBeUndefined();
    expect(normalizeSavePresentationRuntimeVersion("slashem")).toBeUndefined();
    expect(normalizeSavePresentationRuntimeVersion("unknown")).toBeUndefined();
  });
});
