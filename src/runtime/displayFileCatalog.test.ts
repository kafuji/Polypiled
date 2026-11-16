import { describe, expect, it } from "vitest";
import { translateHelpDocument } from "../i18n/help-text";
import { getBundledDisplayFile } from "./displayFileCatalog";

describe("bundled display files", () => {
  it("serves NetHack 5.0's own files", () => {
    expect(getBundledDisplayFile("history")?.lines[0]).toBe("NetHack History file for release 5.0");
    expect(getBundledDisplayFile("usagehlp")?.lines.length).toBeGreaterThan(0);
    expect(getBundledDisplayFile("cmdhelp")?.title).toBe("Command Help");
    expect(getBundledDisplayFile("cmdhelp")?.lines.some((line) => line.includes("explore mode"))).toBe(true);
    expect(getBundledDisplayFile("porthelp")).toBeNull();
  });

  // The license stays in its original wording.
  it.each(["help", "hh", "history", "keyhelp", "opthelp", "optmenu", "usagehlp", "wizhelp"])("translates %s as a whole", (name) => {
    expect(translateHelpDocument(getBundledDisplayFile(name)!.lines, "ja")).toMatch(/[\p{Script=Hiragana}\p{Script=Han}]/u);
  });
});
