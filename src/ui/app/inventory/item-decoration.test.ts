import { describe, expect, it } from "vitest";
import { iconShellProps, itemTextClassName, parseItemTextDecoration } from "./item-decoration";

describe("parseItemTextDecoration", () => {
  it("reads BUC only when the name says it", () => {
    expect(parseItemTextDecoration("a blessed +1 long sword").buc).toBe("blessed");
    expect(parseItemTextDecoration("a cursed ring of hunger").buc).toBe("cursed");
    expect(parseItemTextDecoration("an uncursed ring of warning").buc).toBe("uncursed");
    expect(parseItemTextDecoration("a ring of warning").buc).toBeNull();
    expect(parseItemTextDecoration("2 potions of holy water").buc).toBe("blessed");
    expect(parseItemTextDecoration("a potion of unholy water").buc).toBe("cursed");
  });

  it("ignores words in a name the player gave", () => {
    expect(parseItemTextDecoration("an uncursed dagger named cursed rusty thing").buc).toBe("uncursed");
    expect(parseItemTextDecoration("an uncursed dagger named cursed rusty thing").eroded).toBeNull();
    expect(parseItemTextDecoration("a gem called blessed").buc).toBeNull();
  });

  it("reads erosion and its level", () => {
    const both = parseItemTextDecoration("an uncursed very rusty thoroughly corroded long sword");
    expect(both.eroded).toEqual({ kind: "rust", level: 2 });
    expect(both.eroded2).toEqual({ kind: "corrode", level: 3 });
    expect(parseItemTextDecoration("a burnt rotted cloak").eroded).toEqual({ kind: "burn", level: 1 });
    expect(parseItemTextDecoration("a burnt rotted cloak").eroded2).toEqual({ kind: "rot", level: 1 });
  });

  it("reads lit and greased", () => {
    expect(parseItemTextDecoration("a wax candle (lit)").lit).toBe(true);
    expect(parseItemTextDecoration("an oil lamp (lit)").lit).toBe(true);
    expect(parseItemTextDecoration("an oil lamp").lit).toBe(false);
    expect(parseItemTextDecoration("a greased +0 cloak").greased).toBe(true);
  });
});

describe("menu props", () => {
  it("carries the marks on the icon's box", () => {
    expect(iconShellProps("shell", "a cursed very burnt leather cloak")).toEqual({
      className: "shell is-cursed",
      "data-erosion": "burn",
      "data-erosion2": undefined,
      "data-erosion-level": 2,
    });
    expect(iconShellProps("shell", "a dagger").className).toBe("shell");
  });

  it("colors only blessed and cursed item names", () => {
    expect(itemTextClassName("text", "a blessed bag of holding", true)).toBe("text blessed-text");
    expect(itemTextClassName("text", "a cursed ring", true)).toBe("text cursed-text");
    expect(itemTextClassName("text", "an uncursed ring", true)).toBe("text");
    expect(itemTextClassName("text", "Remove curse from cursed items", false)).toBe("text");
  });
});
