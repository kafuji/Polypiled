import {
  KNOWLEDGE_CELL_WORDS,
  KNOWLEDGE_COLUMNS,
  KNOWLEDGE_ROWS,
  KnowledgeVision,
  type KnowledgeFrame,
  type KnowledgeHero,
  type KnowledgeLevel,
  type KnowledgeLight,
  type KnowledgeMonster,
} from "../../../runtime/knowledge";

/**
 * What the hero knows, as the game core reports it in knowledge frames
 * (src/runtime/knowledge.ts). Renderers read it instead of guessing from
 * glyphs and messages; until a frame arrives (an older core, or before the
 * first map display) `available` is false and they keep their estimates.
 */
export class PlayerKnowledge {
  readonly columns = KNOWLEDGE_COLUMNS;

  readonly rows = KNOWLEDGE_ROWS;

  /** True once a complete frame has been applied. */
  available = false;

  /** Increases with every applied frame; cheap change detection for readers. */
  revision = 0;

  sequence = 0;

  turn = 0;

  hero: KnowledgeHero | null = null;

  level: KnowledgeLevel | null = null;

  monsters: readonly KnowledgeMonster[] = [];

  lights: readonly KnowledgeLight[] = [];

  private readonly cellWords = new Int32Array(KNOWLEDGE_COLUMNS * KNOWLEDGE_ROWS * KNOWLEDGE_CELL_WORDS);

  apply(frame: KnowledgeFrame): void {
    if (!frame.complete && !this.available) return; // a delta needs a base
    if (frame.complete) this.cellWords.fill(0);
    const { cells } = frame;
    for (let base = 0; base + KNOWLEDGE_CELL_WORDS <= cells.length; base += KNOWLEDGE_CELL_WORDS) {
      const x = cells[base] & 0xff;
      const y = (cells[base] >>> 8) & 0xff;
      if (x >= this.columns || y >= this.rows) continue;
      this.cellWords.set(cells.subarray(base, base + KNOWLEDGE_CELL_WORDS), (y * this.columns + x) * KNOWLEDGE_CELL_WORDS);
    }
    this.available = true;
    this.sequence = frame.sequence;
    this.turn = frame.turn;
    this.hero = frame.hero;
    this.level = frame.level;
    this.monsters = frame.monsters;
    this.lights = frame.lights;
    this.revision++;
  }

  /** Forget everything, for a new game or a restarted runtime. */
  reset(): void {
    this.cellWords.fill(0);
    this.available = false;
    this.sequence = 0;
    this.turn = 0;
    this.hero = null;
    this.level = null;
    this.monsters = [];
    this.lights = [];
    this.revision++;
  }

  private word(x: number, y: number, word: number): number {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return 0;
    return this.cellWords[(y * this.columns + x) * KNOWLEDGE_CELL_WORDS + word];
  }

  /** KnowledgeVision bits of a cell. */
  vision(x: number, y: number): number {
    return (this.word(x, y, 0) >>> 16) & 0xff;
  }

  canSee(x: number, y: number): boolean {
    return (this.vision(x, y) & KnowledgeVision.canSee) !== 0;
  }

  /**
   * Whether the location is lit by its own light (a lit room or corridor):
   * as seen now when in sight, otherwise as the hero remembers it.
   */
  isLitLocation(x: number, y: number): boolean {
    const vision = this.vision(x, y);
    return (vision & KnowledgeVision.canSee) !== 0
      ? (vision & KnowledgeVision.lit) !== 0
      : (vision & KnowledgeVision.wasLit) !== 0;
  }

  /** Last seen terrain (KnowledgeTerrain); stone when never seen. */
  terrain(x: number, y: number): number {
    return this.word(x, y, 1) & 0xff;
  }

  /** Type of a trap the hero has seen at the location, 0 for none. */
  trap(x: number, y: number): number {
    return (this.word(x, y, 1) >>> 8) & 0xff;
  }

  /** Directions the location has been seen from (NetHack's seenv bits). */
  seenFrom(x: number, y: number): number {
    return (this.word(x, y, 0) >>> 24) & 0xff;
  }
}
