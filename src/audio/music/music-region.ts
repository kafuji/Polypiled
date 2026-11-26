import type { KnowledgeLevel } from "../../runtime/knowledge";
import type { MusicMood } from "./music-director";

/**
 * Coarse dungeon regions that get their own track preferences, plus the
 * special levels that have their own music: Medusa's and the Castle inside
 * the Dungeons of Doom, Fort Ludios, and Moloch's Sanctum at the bottom of
 * Gehennom. Read from the level the game core reports in knowledge frames.
 */
export type MusicRegion =
  | "dungeon"
  | "medusa"
  | "castle"
  | "mines"
  | "sokoban"
  | "quest"
  | "ludios"
  | "gehennom"
  | "sanctum"
  | "endgame";

export type MusicLevel = Pick<
  KnowledgeLevel,
  "mines" | "sokoban" | "gehennom" | "quest" | "endgame" | "specialLevel"
>;

export function resolveMusicRegion(level: MusicLevel): MusicRegion {
  switch (level.specialLevel) {
    case "medusa":
    case "castle":
    case "sanctum":
    case "ludios":
      return level.specialLevel;
    case "valley":
    case "vlad-tower":
    case "wizard-tower":
      return "gehennom";
    case "quest-home":
      return "quest";
    case "earth":
    case "air":
    case "fire":
    case "water":
    case "astral":
      return "endgame";
    default:
      break;
  }
  if (level.endgame) return "endgame";
  if (level.gehennom) return "gehennom";
  if (level.quest) return "quest";
  if (level.sokoban) return "sokoban";
  if (level.mines) return "mines";
  return "dungeon";
}

/** Track ids per mood; each music pack gives one per region (MusicPack.regionTracks). */
export type TrackPreference = Partial<Record<MusicMood, readonly string[]>>;
