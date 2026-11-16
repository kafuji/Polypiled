import { describe, expect, it } from "vitest";
import {
  getMenuSelectionInput,
  isReadOnlyQuestionOptionMenuItem,
  isSelectableQuestionMenuItem,
  isYesNoChoicePrompt,
  parseQuestionChoices,
  shouldUseCompactQuestionChoiceLayout,
} from "./question-choices";

describe("question choice interaction contracts", () => {
  it("merges runtime and bracket choices without losing range order or case", () => {
    expect(parseQuestionChoices("Choose [a-cC-A0-2?]", "b, c or $"))
      .toEqual(["b", "c", "$", "a", "C", "B", "A", "0", "1", "2", "?"]);
  });

  it("recognizes yes/no auxiliaries without treating inventory letters as yes/no", () => {
    expect(isYesNoChoicePrompt(["Y", "n", "a", "q", "#", "?"])).toBe(true);
    expect(isYesNoChoicePrompt(["y", "n", "b"])).toBe(false);
  });

  it("lays out a few single-character choices compactly", () => {
    expect(shouldUseCompactQuestionChoiceLayout("Use what? [a?]", ["a", "?"], false))
      .toBe(true);
  });

  it("keeps adjust-letter and yes/no prompts compact even with many choices", () => {
    expect(shouldUseCompactQuestionChoiceLayout("Adjust letter to what?", ["a", "b", "c", "d", "e"], false))
      .toBe(true);
    expect(shouldUseCompactQuestionChoiceLayout("Continue?", ["y", "n", "a", "q", "?"], true))
      .toBe(true);
  });

  it("preserves explicit runtime selection inputs and nonselectable decisions", () => {
    expect(getMenuSelectionInput({ accelerator: "a", selectionInput: "2a" })).toBe("2a");
    expect(isSelectableQuestionMenuItem({ accelerator: "a", isSelectable: false })).toBe(false);
    expect(isSelectableQuestionMenuItem({ accelerator: "a", identifier: 0 })).toBe(false);
    expect(isSelectableQuestionMenuItem({ accelerator: "a", identifier: 1 })).toBe(true);
    expect(isSelectableQuestionMenuItem({ isCategory: true, isSelectable: true })).toBe(false);
  });

  it("recognizes read-only option rows only in the options menu", () => {
    const row = { text: "  windowtype [nh3d]", isSelectable: false };
    expect(isReadOnlyQuestionOptionMenuItem(row, "Set what options?")).toBe(true);
    expect(isReadOnlyQuestionOptionMenuItem(row, "Choose an item")).toBe(false);
    expect(isReadOnlyQuestionOptionMenuItem({ ...row, isSelectable: true }, "Set what options?")).toBe(false);
  });
});
