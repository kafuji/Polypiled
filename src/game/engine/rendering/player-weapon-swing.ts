/**
 * Pose math for the weapon sprites drawn over the player in overhead view.
 * Everything here is screen-space and renderer-free so it can be unit tested.
 */

/** Fraction of the player sprite's shorter side covered by one weapon. */
export const PLAYER_WEAPON_SIZE = 0.62;

/** Where the grip sits inside a weapon tile (tiles draw hilts bottom-left). */
export const PLAYER_WEAPON_GRIP_UV = { u: 0.24, v: 0.24 } as const;

/** Resting hand position inside the player sprite, for the viewer-right hand. */
export const PLAYER_WEAPON_HAND_UV = { u: 0.66, v: 0.38 } as const;

export const PLAYER_WEAPON_SWING_DURATION_MS = 340;

/** Second swing of a two-weapon attack starts this soon after the first. */
export const PLAYER_WEAPON_OFF_HAND_SWING_DELAY_MS = 150;

export type ScreenSide = -1 | 1;

export interface PlayerWeaponSwingPose {
  /** Rotation in radians, positive = counter-clockwise on screen. */
  readonly angle: number;
  /** Lunge offset in player-sprite heights, screen space (x right, y up). */
  readonly offsetX: number;
  readonly offsetY: number;
}

const REST_POSE: PlayerWeaponSwingPose = { angle: 0, offsetX: 0, offsetY: 0 };

const WIND_UP_ANGLE = (40 * Math.PI) / 180;
const FOLLOW_THROUGH_ANGLE = (-105 * Math.PI) / 180;
const LUNGE_DISTANCE = 0.16;

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t ** 3;
const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

export type PlayerWeaponSwingOutcome = "hit" | "miss" | null;

const HIT_STOP_ANGLE = (-62 * Math.PI) / 180;
const MISS_OVERSHOOT_ANGLE = (-132 * Math.PI) / 180;

/**
 * Sample a Battle Brothers style swing: a short wind-up back over the
 * shoulder, a fast chop through the target side, then a slower recovery.
 * `side` mirrors the arc (1 = weapon on the viewer's right).
 * `lunge` is the screen-space unit direction towards the target.
 * A blow that lands stops short at the impact and holds for a beat; one that
 * misses carries through past the target and reaches further.
 */
export function samplePlayerWeaponSwing(
  progress: number,
  side: ScreenSide,
  lunge: { x: number; y: number } | null,
  outcome: PlayerWeaponSwingOutcome = null,
): PlayerWeaponSwingPose {
  if (!(progress > 0) || progress >= 1) {
    return REST_POSE;
  }
  const endAngle =
    outcome === "hit" ? HIT_STOP_ANGLE : outcome === "miss" ? MISS_OVERSHOOT_ANGLE : FOLLOW_THROUGH_ANGLE;
  const peakReach = outcome === "miss" ? 1.35 : 1;
  const holdEnd = outcome === "hit" ? 0.62 : 0.5;
  let angle: number;
  let reach: number;
  if (progress < 0.28) {
    const t = easeOutCubic(progress / 0.28);
    angle = WIND_UP_ANGLE * t;
    reach = -0.25 * t;
  } else if (progress < 0.5) {
    const t = easeInCubic((progress - 0.28) / 0.22);
    angle = WIND_UP_ANGLE + (endAngle - WIND_UP_ANGLE) * t;
    reach = -0.25 + (peakReach + 0.25) * t;
  } else if (progress < holdEnd) {
    // Impact: the blade rests where it struck, with a small recoil.
    const t = (progress - 0.5) / (holdEnd - 0.5);
    angle = endAngle * (1 - 0.08 * Math.sin(Math.PI * t));
    reach = peakReach;
  } else {
    const t = easeInOutSine((progress - holdEnd) / (1 - holdEnd));
    angle = endAngle * (1 - t);
    reach = peakReach * (1 - t);
  }
  return {
    angle: angle * side,
    offsetX: lunge ? lunge.x * LUNGE_DISTANCE * reach : 0,
    offsetY: lunge ? lunge.y * LUNGE_DISTANCE * reach : 0,
  };
}

/** Screen side a target lies on, or null when it is straight above/below. */
export function resolveScreenSide(screenDeltaX: number): ScreenSide | null {
  if (Math.abs(screenDeltaX) < 1e-3) {
    return null;
  }
  return screenDeltaX > 0 ? 1 : -1;
}

/**
 * Whether a message tells of the hero swinging at empty air. Blows at a
 * monster come from the core (shim_hero_blow) with the hand that struck;
 * a forced fight at nothing has no target and so only this message.
 */
export function isPlayerWeaponThinAirMessage(message: string): boolean {
  return /\byou\s+(?:harmlessly\s+)?attack thin air\b/i.test(message.replace(/\s+/g, " ").trim());
}
