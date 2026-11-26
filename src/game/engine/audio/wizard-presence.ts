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

const wizardGlyphCache = new Map<number, boolean>();

/** Whether the knowledge frame's monsters include the Wizard (he may have doubles). */
export function isWizardOfYendorInView(
  monsters: readonly { readonly glyph: number | null; readonly hero: boolean }[],
  isWizard: (glyph: unknown) => boolean = isWizardOfYendorGlyph,
): boolean {
  for (const monster of monsters) {
    if (monster.hero || monster.glyph === null) continue;
    let wizard = isWizard === isWizardOfYendorGlyph ? wizardGlyphCache.get(monster.glyph) : undefined;
    if (wizard === undefined) {
      wizard = isWizard(monster.glyph);
      if (isWizard === isWizardOfYendorGlyph) wizardGlyphCache.set(monster.glyph, wizard);
    }
    if (wizard) return true;
  }
  return false;
}
