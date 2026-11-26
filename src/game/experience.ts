/**
 * Polypiled's experience curve, a copy of uexp_table in
 * core/NetHack/src/exper.c (experience.test.ts keeps the two equal).
 * EXPERIENCE_TABLE[lev] is the experience needed to reach level lev + 1.
 */
export const EXPERIENCE_TABLE: readonly number[] = [
  0, 20, 40, 80, 150,
  290, 540, 1000, 1810, 3210,
  5630, 9690, 16400, 27300, 44800,
  72200, 114000, 178000, 273000, 412000,
  610000, 890000, 1280000, 1800000, 2500000,
  3410000, 4570000, 6040000, 7830000, 10000000,
  12800000,
];

/** include/global.h MAXULEV */
export const MAX_EXPERIENCE_LEVEL = 30;

export interface ExperienceProgress {
  /** Experience at which the current level began. */
  readonly floor: number;
  /** Experience the next level needs, or null at the top level. */
  readonly next: number | null;
  /** Share of the way from this level to the next, 0..1 (1 at the top). */
  readonly fraction: number;
}

function needed(level: number): number {
  if (level < 1) return 0;
  return EXPERIENCE_TABLE[Math.min(level, EXPERIENCE_TABLE.length - 1)];
}

/** How far the hero is through the current experience level. */
export function resolveExperienceProgress(level: number, experience: number): ExperienceProgress {
  const lev = Math.max(1, Math.trunc(Number(level)) || 1);
  const exp = Math.max(0, Number(experience) || 0);
  const floor = needed(lev - 1);
  if (lev >= MAX_EXPERIENCE_LEVEL) return { floor, next: null, fraction: 1 };
  const next = needed(lev);
  const span = Math.max(1, next - floor);
  return { floor, next, fraction: Math.min(1, Math.max(0, (exp - floor) / span)) };
}
