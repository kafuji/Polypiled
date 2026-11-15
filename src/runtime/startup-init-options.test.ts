import { describe, expect, it } from "vitest";

import {
  createDefaultStartupInitOptionValues,
  getAutomaticRuntimeInitOptionTokens,
  getStartupInitOptionDefinitions,
  normalizeStartupInitOptionValues,
  sanitizeStartupInitOptionTokens,
  serializeStartupInitOptionTokens,
} from "./startup-init-options";

describe("terminal-friendly startup defaults", () => {
  it.each(["5.0"] as const)(
    "enables NetHack color output for %s",
    (runtimeVersion) => {
      expect(getAutomaticRuntimeInitOptionTokens(runtimeVersion)).toContain(
        "color",
      );
    },
  );

  it("selects IBMgraphics by default for supported runtimes", () => {
    const defaults = createDefaultStartupInitOptionValues();

    expect(defaults.symset).toBe("IBMgraphics");
    expect(serializeStartupInitOptionTokens(defaults, "5.0")).toContain(
      "symset:IBMgraphics",
    );
  });

  it("offers the tutorial toggle and never sends the positive form", () => {
    const defaults = createDefaultStartupInitOptionValues();

    expect(
      getStartupInitOptionDefinitions("5.0").some(
        (definition) => definition.key === "tutorial",
      ),
    ).toBe(true);
    expect(defaults.tutorial).toBe(false);
    expect(serializeStartupInitOptionTokens(defaults, "5.0")).toContain(
      "!tutorial",
    );
    const offeredTutorialTokens = serializeStartupInitOptionTokens(
      { ...defaults, tutorial: true },
      "5.0",
    );
    expect(offeredTutorialTokens).not.toContain("tutorial");
    expect(offeredTutorialTokens).not.toContain("!tutorial");
    expect(sanitizeStartupInitOptionTokens(["!tutorial"], "5.0")).toEqual([
      "!tutorial",
    ]);
    expect(sanitizeStartupInitOptionTokens(["tutorial"], "5.0")).toEqual([]);
  });
});

describe("NetHack 5 pauper startup mode", () => {
  it("offers a disabled-by-default switch through the startup option definitions", () => {
    expect(getStartupInitOptionDefinitions("5.0").find(option => option.key === "pauper"))
      .toMatchObject({ control: "boolean", defaultValue: false });
    const defaults = createDefaultStartupInitOptionValues();
    expect(defaults.pauper).toBe(false);
    expect(serializeStartupInitOptionTokens(defaults, "5.0")).toContain("!pauper");
  });

  it("preserves the saved toggle through normalization and the runtime token sanitizer", () => {
    const saved = JSON.parse(JSON.stringify({
      ...createDefaultStartupInitOptionValues(),
      pauper: true,
    }));
    const restored = normalizeStartupInitOptionValues(saved);
    const runtimeTokens = sanitizeStartupInitOptionTokens(
      serializeStartupInitOptionTokens(restored, "5.0"),
      "5.0",
    );
    expect(restored.pauper).toBe(true);
    expect(runtimeTokens).toContain("pauper");
    expect(runtimeTokens).not.toContain("!pauper");
    expect(normalizeStartupInitOptionValues({}).pauper).toBe(false);
    expect(normalizeStartupInitOptionValues({ pauper: "true" }).pauper).toBe(false);
  });
});
