import { getGlyphCatalogEntry, getGlyphCatalogRanges } from "./registry";

/** Test helper: the first map-symbol glyph with this symbol index (S_stone = 0). */
export function cmapGlyphForSymbol(symidx: number): number {
  const range = getGlyphCatalogRanges().find((entry) => entry.kind === "cmap")!;
  for (let glyph = range.start; glyph < range.endExclusive; glyph++) {
    if (getGlyphCatalogEntry(glyph)?.symidx === symidx) return glyph;
  }
  throw new Error(`No map glyph for symbol ${symidx}`);
}
