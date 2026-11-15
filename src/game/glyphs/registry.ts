import {
  GLYPH_CATALOG,
  GLYPH_CATALOG_META,
  GLYPH_CATALOG_RANGES,
} from "./glyph-catalog.5.generated";
import type {
  GlyphCatalogEntry,
  GlyphCatalogMeta,
  GlyphCatalogRange,
  GlyphKind,
  ResolvedGlyph,
} from "./types";

type GlyphCatalogModule = {
  GLYPH_CATALOG: readonly GlyphCatalogEntry[];
  GLYPH_CATALOG_META: GlyphCatalogMeta;
  GLYPH_CATALOG_RANGES: readonly GlyphCatalogRange[];
};

// NetHack 5.0's catalog is the only one.
const activeGlyphCatalog: GlyphCatalogModule = {
  GLYPH_CATALOG,
  GLYPH_CATALOG_META,
  GLYPH_CATALOG_RANGES,
};

export async function getGlyphCatalogEntriesForVersion(
): Promise<readonly GlyphCatalogEntry[]> {
  return activeGlyphCatalog.GLYPH_CATALOG;
}

function normalizeRuntimeChar(runtimeChar?: string | null): string | null {
  if (typeof runtimeChar !== "string" || runtimeChar.length === 0) {
    return null;
  }
  return runtimeChar.charAt(0);
}

function normalizeRuntimeColor(runtimeColor?: number | null): number | null {
  return typeof runtimeColor === "number" && Number.isFinite(runtimeColor)
    ? runtimeColor
    : null;
}

function normalizeRuntimeTileIndex(
  runtimeTileIndex?: number | null,
): number | null {
  if (
    typeof runtimeTileIndex !== "number" ||
    !Number.isFinite(runtimeTileIndex)
  ) {
    return null;
  }
  const normalized = Math.trunc(runtimeTileIndex);
  return normalized >= 0 ? normalized : null;
}

function normalizeRuntimeKind(
  runtimeKind?: GlyphKind | string | null,
): GlyphKind | null {
  if (typeof runtimeKind !== "string" || runtimeKind.length === 0) {
    return null;
  }
  switch (runtimeKind) {
    case "mon":
    case "pet":
    case "invis":
    case "detect":
    case "body":
    case "ridden":
    case "obj":
    case "cmap":
    case "explode":
    case "zap":
    case "swallow":
    case "warning":
    case "statue":
    case "unexplored":
    case "nothing":
      return runtimeKind;
    default:
      return null;
  }
}

function codePointToChar(codePoint: number): string | null {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

export function getGlyphCatalogMeta(): GlyphCatalogMeta {
  return activeGlyphCatalog.GLYPH_CATALOG_META;
}

export function getGlyphCatalogRanges(): readonly GlyphCatalogRange[] {
  return activeGlyphCatalog.GLYPH_CATALOG_RANGES;
}

export function getGlyphCatalogEntry(glyph: number): GlyphCatalogEntry | null {
  const catalog = activeGlyphCatalog.GLYPH_CATALOG;
  if (!Number.isInteger(glyph) || glyph < 0 || glyph >= catalog.length) {
    return null;
  }
  return catalog[glyph] || null;
}

export function getGlyphKind(glyph: number): GlyphKind | "unknown" {
  const entry = getGlyphCatalogEntry(glyph);
  return entry ? entry.kind : "unknown";
}

export function resolveGlyph(
  glyph: number,
  runtimeChar?: string | null,
  runtimeColor?: number | null,
  runtimeTileIndex?: number | null,
  runtimeKind?: GlyphKind | null,
): ResolvedGlyph {
  const entry = getGlyphCatalogEntry(glyph);
  const normalizedRuntimeChar = normalizeRuntimeChar(runtimeChar);
  const normalizedRuntimeColor = normalizeRuntimeColor(runtimeColor);
  const normalizedRuntimeTileIndex = normalizeRuntimeTileIndex(runtimeTileIndex);
  const normalizedRuntimeKind = normalizeRuntimeKind(runtimeKind);

  if (!entry) {
    return {
      glyph,
      kind: normalizedRuntimeKind ?? "unknown",
      char: normalizedRuntimeChar,
      color: normalizedRuntimeColor,
      isKnown: false,
      tileIndex: normalizedRuntimeTileIndex ?? -1,
    };
  }

  const catalogChar = codePointToChar(entry.ch);
  return {
    glyph,
    kind: normalizedRuntimeKind ?? entry.kind,
    char: normalizedRuntimeChar ?? catalogChar,
    color:
      normalizedRuntimeColor ??
      (typeof entry.color === "number" ? entry.color : null),
    isKnown: true,
    tileIndex: normalizedRuntimeTileIndex ?? entry.tileIndex,
  };
}
