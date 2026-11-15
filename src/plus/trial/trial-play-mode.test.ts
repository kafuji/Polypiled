import { describe, expect, it } from "vitest";
import { sanitizeStartupInitOptionTokens } from "../../runtime/startup-init-options";
import { isTrialPlayMode, toRuntimePlayModeTokens } from "./trial-play-mode";

describe("trial play mode", () => {
  it("survives startup option sanitizing so saves remember the mode", () => {
    const tokens = sanitizeStartupInitOptionTokens(["playmode:trial", "autopickup"], "5.0");
    expect(tokens).toContain("playmode:trial");
    expect(isTrialPlayMode(tokens)).toBe(true);
  });

  it("reaches NetHack as a normal game", () => {
    expect(toRuntimePlayModeTokens(["checkpoint", "playmode:trial"])).toEqual([
      "checkpoint",
      "playmode:normal",
    ]);
    expect(toRuntimePlayModeTokens(["playmode:explore"])).toEqual(["playmode:explore"]);
  });

  it("is off for other modes and missing options", () => {
    expect(isTrialPlayMode(["playmode:normal"])).toBe(false);
    expect(isTrialPlayMode(undefined)).toBe(false);
  });
});
