import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export interface StatMeterProps {
  /** Text above the bar, e.g. "HP: 12/20". */
  label: ReactNode;
  labelClassName: string;
  /** Filled share, 0..1. */
  fraction: number;
  fillClassName?: string;
  fillStyle?: CSSProperties;
  /**
   * Bumped when the bar starts over (a new experience level): the bar first
   * fills up, then refills from empty to the new share.
   */
  cycle?: number;
  title?: string;
}

/** How long a loss stays marked before the marker shrinks away (ms). */
export const STAT_METER_LOSS_HOLD_MS = 500;
const GAIN_FLASH_MS = 650;
const ROLLOVER_FILL_MS = 320;

const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * A labelled bar that shows its changes: a loss stays marked in white for a
 * moment before shrinking, a gain glows, and a bar that starts over (level
 * up) fills to the end before refilling.
 */
export function StatMeter({
  label,
  labelClassName,
  fraction,
  fillClassName = "",
  fillStyle,
  cycle = 0,
  title,
}: StatMeterProps) {
  const target = clamp01(fraction);
  const [shown, setShown] = useState(target);
  const [trail, setTrail] = useState(target);
  const [gain, setGain] = useState<{ key: number; from: number; to: number } | null>(null);
  const [instant, setInstant] = useState(false);
  const previous = useRef({ fraction: target, cycle });
  const timers = useRef<number[]>([]);

  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const before = previous.current;
    previous.current = { fraction: target, cycle };
    if (before.fraction === target && before.cycle === cycle) return;
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current = [];
    const later = (ms: number, run: () => void) => {
      timers.current.push(window.setTimeout(run, ms));
    };
    setInstant(false);
    // One step up is a level gained; bigger jumps are a game being loaded.
    if (cycle === before.cycle + 1) {
      // Fill to the end, jump back to empty, then refill to the new share.
      setShown(1);
      setTrail(1);
      setGain((value) => ({ key: (value?.key ?? 0) + 1, from: before.fraction, to: 1 }));
      later(ROLLOVER_FILL_MS, () => {
        setInstant(true);
        setShown(0);
        setTrail(0);
        later(30, () => {
          setInstant(false);
          setShown(target);
          setTrail(target);
        });
      });
      return;
    }
    setShown(target);
    if (target < before.fraction) {
      setTrail(before.fraction);
      later(STAT_METER_LOSS_HOLD_MS, () => setTrail(target));
    } else {
      setTrail(target);
      setGain((value) => ({ key: (value?.key ?? 0) + 1, from: before.fraction, to: target }));
    }
  }, [target, cycle]);

  return (
    <div className="nh3d-stats-meter" title={title}>
      <div className={`nh3d-stats-meter-label ${labelClassName}`}>{label}</div>
      <div className={`nh3d-stats-meter-track${instant ? " is-instant" : ""}`}>
        <div className="nh3d-stats-meter-trail" style={{ width: `${trail * 100}%` }} />
        <div
          className={`nh3d-stats-meter-fill ${fillClassName}`}
          style={{ ...fillStyle, width: `${shown * 100}%` }}
        />
        {gain && gain.to > gain.from ? (
          <div
            key={gain.key}
            className="nh3d-stats-meter-gain"
            style={{
              left: `${gain.from * 100}%`,
              width: `${(gain.to - gain.from) * 100}%`,
              animationDuration: `${GAIN_FLASH_MS}ms`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
