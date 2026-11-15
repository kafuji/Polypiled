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
  it("enables NetHack color output for", () => {
    expect(getAutomaticRuntimeInitOptionTokens()).toContain(
      "color",
    );
  });

  it("selects IBMgraphics by default for supported runtimes", () => {
    const defaults = createDefaultStartupInitOptionValues();

    expect(defaults.symset).toBe("IBMgraphics");
    expect(serializeStartupInitOptionTokens(defaults)).toContain(
      "symset:IBMgraphics",
    );
  });

  it("offers the tutorial toggle and never sends the positive form", () => {
    const defaults = createDefaultStartupInitOptionValues();

    expect(
      getStartupInitOptionDefinitions().some(
        (definition) => definition.key === "tutorial",
      ),
    ).toBe(true);
    expect(defaults.tutorial).toBe(false);
    expect(serializeStartupInitOptionTokens(defaults)).toContain(
      "!tutorial",
    );
    const offeredTutorialTokens = serializeStartupInitOptionTokens(
      { ...defaults, tutorial: true },
    );
    expect(offeredTutorialTokens).not.toContain("tutorial");
    expect(offeredTutorialTokens).not.toContain("!tutorial");
    expect(sanitizeStartupInitOptionTokens(["!tutorial"])).toEqual([
      "!tutorial",
    ]);
    expect(sanitizeStartupInitOptionTokens(["tutorial"])).toEqual([]);
  });
});

describe("NetHack 5 pauper startup mode", () => {
  it("offers a disabled-by-default switch through the startup option definitions", () => {
    expect(getStartupInitOptionDefinitions().find(option => option.key === "pauper"))
      .toMatchObject({ control: "boolean", defaultValue: false });
    const defaults = createDefaultStartupInitOptionValues();
    expect(defaults.pauper).toBe(false);
    expect(serializeStartupInitOptionTokens(defaults)).toContain("!pauper");
  });

  it("preserves the saved toggle through normalization and the runtime token sanitizer", () => {
    const saved = JSON.parse(JSON.stringify({
      ...createDefaultStartupInitOptionValues(),
      pauper: true,
    }));
    const restored = normalizeStartupInitOptionValues(saved);
    const runtimeTokens = sanitizeStartupInitOptionTokens(
      serializeStartupInitOptionTokens(restored),
    );
    expect(restored.pauper).toBe(true);
    expect(runtimeTokens).toContain("pauper");
    expect(runtimeTokens).not.toContain("!pauper");
    expect(normalizeStartupInitOptionValues({}).pauper).toBe(false);
    expect(normalizeStartupInitOptionValues({ pauper: "true" }).pauper).toBe(false);
  });
});
