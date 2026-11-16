import { getGlyphCatalogEntry } from "../../glyphs/registry";
import type { GlyphKind } from "../../glyphs/types";
import { NH5_TILE_KEYS } from "../../hires-tiles/tile-keys.5.generated";

/** The Wizard's tiles (male and female). */
const WIZARD_TILE_KEY = /^mon\/wizard_of_yendor(?:_(?:male|female))?$/;

/** Him in person, as a pet (!), sensed by telepathy, or ridden. Not a corpse or statue. */
const LIVE_MONSTER_KINDS: ReadonlySet<GlyphKind> = new Set(["mon", "pet", "detect", "ridden"]);

/** Whether a map glyph shows the Wizard of Yendor. */
export function isWizardOfYendorGlyph(glyph: unknown): boolean {
  if (typeof glyph !== "number" || !Number.isFinite(glyph)) return false;
  const entry = getGlyphCatalogEntry(Math.trunc(glyph));
  if (!entry || !LIVE_MONSTER_KINDS.has(entry.kind) || typeof entry.tileIndex !== "number") return false;
  return WIZARD_TILE_KEY.test(NH5_TILE_KEYS[entry.tileIndex] ?? "");
}

/** Tracks the map cells currently showing the Wizard (he may have doubles). */
export class WizardPresenceTracker {
  private readonly cells = new Set<string>();

  constructor(private readonly isWizard: (glyph: unknown) => boolean = isWizardOfYendorGlyph) {}

  get present(): boolean {
    return this.cells.size > 0;
  }

  /** A map_glyph tile; returns whether presence changed. */
  update(event: unknown): boolean {
    const tile = event as { x?: unknown; y?: unknown; glyph?: unknown } | null | undefined;
    if (!tile || typeof tile.x !== "number" || typeof tile.y !== "number") return false;
    const before = this.present;
    const key = `${Math.trunc(tile.x)},${Math.trunc(tile.y)}`;
    if (this.isWizard(tile.glyph)) this.cells.add(key);
    else this.cells.delete(key);
    return this.present !== before;
  }

  /** Level change: the old map is gone. Returns whether presence changed. */
  clear(): boolean {
    const before = this.present;
    this.cells.clear();
    return before;
  }
}
