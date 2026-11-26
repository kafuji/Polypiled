import { describe, expect, it } from "vitest";
import { MusicDirector } from "./music-director";

const base = { hp: 20, maxHp: 20, turn: 100, dangerCondition: false };

describe("MusicDirector", () => {
  it("starts calm", () => {
    const d = new MusicDirector();
    expect(d.update({ ...base, nowMs: 0 })).toBe("calm");
  });

  it("escalates to combat immediately and holds for turns", () => {
    const d = new MusicDirector();
    d.update({ ...base, nowMs: 0 });
    d.notifyCombat(1000, 100);
    expect(d.update({ ...base, nowMs: 1000 })).toBe("combat");
    // Real time passes but the player has not moved many turns: stay.
    expect(d.update({ ...base, nowMs: 60000, turn: 102 })).toBe("combat");
    // Enough turns and time have passed: back to calm.
    expect(d.update({ ...base, nowMs: 61000, turn: 103 })).toBe("calm");
  });

  it("does not guess a fight from HP loss alone (traps, hunger)", () => {
    const d = new MusicDirector();
    d.update({ ...base, nowMs: 0 });
    expect(d.update({ ...base, hp: 17, nowMs: 100 })).toBe("calm");
  });

  it("fights when a hostile comes close, and holds after it leaves", () => {
    const d = new MusicDirector();
    const far = { count: 1, maxDifficulty: 1, nearestDistance: 5 };
    expect(d.update({ ...base, hostiles: far, nowMs: 0 })).toBe("calm");
    expect(d.update({ ...base, hostiles: { ...far, nearestDistance: 2 }, nowMs: 100 })).toBe("combat");
    expect(d.update({ ...base, hostiles: null, nowMs: 1000, turn: 101 })).toBe("combat");
    expect(d.update({ ...base, hostiles: null, nowMs: 5000, turn: 110 })).toBe("calm");
  });

  it("enters danger when something in view far outmatches the hero", () => {
    const d = new MusicDirector();
    const dragon = { count: 1, maxDifficulty: 20, nearestDistance: 8 };
    expect(d.update({ ...base, experienceLevel: 14, hostiles: dragon, nowMs: 0 })).toBe("danger");
    // A seasoned hero is not daunted, nor is one who cannot tell (hallucinating: 0).
    const e = new MusicDirector();
    expect(e.update({ ...base, experienceLevel: 15, hostiles: dragon, nowMs: 0 })).toBe("calm");
    expect(e.update({ ...base, experienceLevel: 1, hostiles: { ...dragon, maxDifficulty: 0 }, nowMs: 0 })).toBe("calm");
  });

  it("enters danger below 1/3 HP and needs 45% to leave", () => {
    const d = new MusicDirector();
    d.update({ ...base, nowMs: 0 });
    expect(d.update({ ...base, hp: 6, nowMs: 100 })).toBe("danger");
    // Healed a little (40%) - still danger.
    expect(d.update({ ...base, hp: 8, nowMs: 20000, turn: 200 })).toBe("danger");
    // Healed to 50% and combat long over.
    expect(d.update({ ...base, hp: 10, nowMs: 40000, turn: 300 })).toBe("calm");
  });

  it("enters danger from a dangerous status", () => {
    const d = new MusicDirector();
    expect(d.update({ ...base, dangerCondition: true, nowMs: 0 })).toBe("danger");
  });

  it("waits the minimum dwell time before de-escalating", () => {
    const d = new MusicDirector({ minDwellMs: 4000, combatHoldMs: 0, combatHoldTurns: 0 });
    d.update({ ...base, nowMs: 0 });
    expect(d.update({ ...base, dangerCondition: true, nowMs: 1000 })).toBe("danger");
    expect(d.update({ ...base, nowMs: 2000 })).toBe("danger");
    expect(d.update({ ...base, nowMs: 5100 })).toBe("calm");
  });

  it("falls back to real time when the turn counter is unknown", () => {
    const d = new MusicDirector();
    d.update({ ...base, turn: 0, nowMs: 0 });
    d.notifyCombat(0, 0);
    expect(d.update({ ...base, turn: 0, nowMs: 2000 })).toBe("combat");
    // Hold time (2.5s) is over, but the 1.5s minimum dwell counts from 2000ms.
    expect(d.update({ ...base, turn: 0, nowMs: 3000 })).toBe("combat");
    expect(d.update({ ...base, turn: 0, nowMs: 3600 })).toBe("calm");
  });
});
