import experSource from "../../core/NetHack/src/exper.c?raw";
import { describe, expect, it } from "vitest";
import { EXPERIENCE_TABLE, resolveExperienceProgress } from "./experience";

describe("experience curve", () => {
  it("matches the core's uexp_table", () => {
    const body = /static const long uexp_table\[\] = \{([\s\S]*?)\};/.exec(experSource)?.[1] ?? "";
    const values = [...body.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(\d+)L/g)].map((m) => Number(m[1]));
    expect(values.length).toBeGreaterThan(20);
    expect(EXPERIENCE_TABLE).toEqual(values);
  });

  it("measures progress from this level's start to the next", () => {
    expect(resolveExperienceProgress(1, 0)).toEqual({ floor: 0, next: 20, fraction: 0 });
    expect(resolveExperienceProgress(1, 10).fraction).toBeCloseTo(0.5);
    expect(resolveExperienceProgress(8, 1000)).toEqual({ floor: 1000, next: 1810, fraction: 0 });
    expect(resolveExperienceProgress(8, 1405).fraction).toBeCloseTo(0.5);
  });

  it("fills the bar at the top level and clamps drained experience", () => {
    expect(resolveExperienceProgress(30, 12_000_000)).toMatchObject({ next: null, fraction: 1 });
    expect(resolveExperienceProgress(5, 10).fraction).toBe(0);
  });
});
