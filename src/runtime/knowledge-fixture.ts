/**
 * Test helper: writes knowledge frames the way the core does
 * (core/NetHack/win/shim/nh3d_knowledge.c), so decoding can be checked
 * without a built core. Not used by the app.
 */
import { KNOWLEDGE_FORMAT_VERSION } from "./knowledge";

export interface FixtureCell {
  x: number;
  y: number;
  vision?: number;
  seenFrom?: number;
  terrain?: number;
  trap?: number;
  shownKind?: number;
  rememberedKind?: number;
  shownTile?: number | null;
  rememberedTile?: number | null;
  shownFlags?: number;
  shownColor?: number;
}

export interface FixtureMonster {
  x: number;
  y: number;
  sense: number;
  flags?: number;
  id?: number;
  tile?: number | null;
  warningLevel?: number;
  glyph?: number;
}

export interface FixtureLight {
  x: number;
  y: number;
  range: number;
  source: 1 | 2;
  kind: number;
  flags?: number;
  tile?: number | null;
  glyph?: number;
}

export interface FixtureFrame {
  version?: number;
  sequence?: number;
  complete?: boolean;
  turn?: number;
  hero?: { x: number; y: number; dx?: number; dy?: number; flags?: number; tile?: number | null; glyph?: number; steedId?: number; swallowerId?: number };
  level?: {
    dnum?: number;
    dlevel?: number;
    depth?: number;
    flags?: number;
    /** nh3d_special_level code. */
    special?: number;
    heroAttacks?: number;
    foeAttacks?: number;
    hostiles?: { count: number; maxDifficulty?: number; nearestDistance?: number };
  };
  cells?: FixtureCell[];
  monsters?: FixtureMonster[];
  lights?: FixtureLight[];
}

const tile = (value: number | null | undefined) => (value === null || value === undefined ? 0xffff : value & 0xffff);

export function encodeKnowledgeFrame(frame: FixtureFrame): Int32Array {
  const words: number[] = [
    frame.version ?? KNOWLEDGE_FORMAT_VERSION,
    frame.sequence ?? 1,
    frame.complete === false ? 0 : 1,
    frame.cells?.length ?? 0,
    frame.monsters?.length ?? 0,
    frame.lights?.length ?? 0,
    frame.turn ?? 1,
    0,
  ];
  const hero = frame.hero ?? { x: 1, y: 1 };
  words.push(
    hero.x,
    hero.y,
    ((hero.dx ?? 0) & 0xff) | (((hero.dy ?? 0) & 0xff) << 8),
    hero.flags ?? 0,
    tile(hero.tile),
    hero.glyph ?? -1,
    hero.steedId ?? -1,
    hero.swallowerId ?? -1,
  );
  const level = frame.level ?? {};
  const hostiles = level.hostiles;
  words.push(
    level.dnum ?? 0,
    level.dlevel ?? 1,
    level.depth ?? 1,
    level.flags ?? 0,
    level.special ?? 0,
    ((level.heroAttacks ?? 0) & 0xffff) | (((level.foeAttacks ?? 0) & 0xffff) << 16),
    hostiles
      ? (hostiles.count & 0xff) | (((hostiles.maxDifficulty ?? 0) & 0xff) << 8) |
          (((hostiles.nearestDistance ?? 255) & 0xff) << 16)
      : 255 << 16,
    0,
  );
  for (const cell of frame.cells ?? []) {
    words.push(
      (cell.x & 0xff) | ((cell.y & 0xff) << 8) | (((cell.vision ?? 0) & 0xff) << 16) | (((cell.seenFrom ?? 0) & 0xff) << 24),
      ((cell.terrain ?? 0) & 0xff) | (((cell.trap ?? 0) & 0xff) << 8) | (((cell.shownKind ?? 0) & 0xff) << 16) |
        (((cell.rememberedKind ?? 0) & 0xff) << 24),
      tile(cell.shownTile) | (tile(cell.rememberedTile) << 16),
      ((cell.shownFlags ?? 0) & 0xffff) | (((cell.shownColor ?? 0) & 0xff) << 16),
    );
  }
  for (const monster of frame.monsters ?? []) {
    words.push(
      (monster.x & 0xff) | ((monster.y & 0xff) << 8) | ((monster.sense & 0xff) << 16) | (((monster.flags ?? 0) & 0xff) << 24),
      monster.id ?? -1,
      tile(monster.tile) | (((monster.warningLevel ?? 0) & 0xffff) << 16),
      monster.glyph ?? -1,
    );
  }
  for (const light of frame.lights ?? []) {
    words.push(
      (light.x & 0xff) | ((light.y & 0xff) << 8) | ((light.range & 0xff) << 16) | ((light.source & 0xff) << 24),
      (light.kind & 0xff) | (((light.flags ?? 0) & 0xff) << 8),
      tile(light.tile),
      light.glyph ?? -1,
    );
  }
  return Int32Array.from(words);
}
