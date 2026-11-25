/**
 * Polypiled: what the hero knows about each map square, sent by the game
 * core whenever it changes (core/NetHack/win/shim/nh3d_knowledge.c,
 * notification "shim_square_glance"): the ground, a dungeon feature on it,
 * a trap the hero has found and the top object the hero remembers there.
 * Squares the hero knows nothing about are not listed.
 */

export interface GlancedSquare {
  readonly x: number;
  readonly y: number;
  /** "floor of a room", "corridor", "doorway"... */
  readonly ground: string | null;
  /** "staircase down", "fountain", "lawful altar"... */
  readonly feature: string | null;
  /** "bear trap"... */
  readonly trap: string | null;
  /** As farlook names it ("a dagger", "2 uncursed food rations"). */
  readonly object: string | null;
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value);

/** Reads the core's JSON; null for anything malformed or of another version. */
export function parseSquareGlance(raw: unknown): GlancedSquare[] | null {
  if (typeof raw !== "string") return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.v !== 1) return null;
  if (!Array.isArray(data.squares) || !Array.isArray(data.names)) return null;
  const names = data.names as unknown[];
  if (!names.every((name) => typeof name === "string")) return null;
  const name = (index: unknown): string | null | undefined => {
    if (index === -1) return null;
    return isInt(index) && index >= 0 && index < names.length ? (names[index] as string) : undefined;
  };
  const squares: GlancedSquare[] = [];
  for (const entry of data.squares as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 6) return null;
    const [x, y, groundIndex, featureIndex, trapIndex, object] = entry;
    const ground = name(groundIndex);
    const feature = name(featureIndex);
    const trap = name(trapIndex);
    if (!isInt(x) || !isInt(y) || ground === undefined || feature === undefined || trap === undefined) return null;
    if (object !== null && typeof object !== "string") return null;
    squares.push({ x, y, ground, feature, trap, object });
  }
  return squares;
}
