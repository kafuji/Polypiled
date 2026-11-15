import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VultureTilesetTranslator } from "./translation";
import { getGlyphCatalogEntry, getGlyphCatalogEntriesForVersion, getGlyphCatalogRanges } from "../glyphs/registry";
import { LEGACY_CMAP_INDEX_BY_TILE, LEGACY_MONSTER_KEY_BY_TILE, LEGACY_OBJECT_TOKEN_BY_TILE } from "./legacy-tile-identities";
import { translateNh367TileIndexToNh5 } from "../tileset-367-to-5-translation";

let translator: VultureTilesetTranslator;
beforeEach(() => {
  translator = new VultureTilesetTranslator({ dataRootUrl: "unused" });
  // Identity resolution does not require network image/config loading.
  Object.assign(translator, { configLoaded: true, configLoadingStarted: true });
});
afterEach(() => { translator.dispose(); });

function lookup(glyph: number, useTileIndex = true, forBillboard = false) {
  return translator.resolveLookupForTile({ glyph,
    tileIndex: useTileIndex ? getGlyphCatalogEntry(glyph)?.tileIndex : null,
    materialKind: null, forBillboard,
  });
}

describe("NetHack 5 Vulture identities", () => {
  it.each([true, false])("renders room floors as floors with runtime tile index=%s", useTile => {
    expect(lookup(3992, useTile)?.category).toBe("floor");
    expect(translator.resolveCmapIndexForTileIndex(1291)).toBe(19);
  });
  it.each([[3986, "VDOOR_WOOD_OPEN"], [3987, "HDOOR_WOOD_OPEN"], [3988, "VDOOR_WOOD_CLOSED"], [3989, "HDOOR_WOOD_CLOSED"], [4014, "FOUNTAIN"], [3998, "STAIRS_UP"]] as const)("maps native cmap %s to %s", (glyph, name) => {
    expect(lookup(glyph)?.name).toBe(name);
    expect(lookup(glyph, false)?.name).toBe(name);
  });
  // Native include/monsters.h preprocessed with MONS_ENUM and MAIL_STRUCTURES:
  // PM_ARCHEOLOGIST=331, NUMMONS=383; female glyphs add NUMMONS, pets add 766.
  it.each([331, 714, 766 + 331, 766 + 714])("renders male/female player and pet glyph %s as the Archeologist", glyph => {
    expect(lookup(glyph, true, true)).toEqual({ category: "monster", name: "PM_ARCHEOLOGIST", projection: "sprite" });
  });
  it("maps both statue sexes through the legacy species tile identity", async () => {
    const catalog = await getGlyphCatalogEntriesForVersion("5.0");
    const male = catalog.find(entry => entry.kind === "statue" && entry.tileIndex === translateNh367TileIndexToNh5(1417))!;
    expect(male).toBeDefined();
    expect(lookup(male.glyph, true, true)?.name).toBe("PM_ARCHEOLOGIST");
    const female = catalog.find(entry => entry.kind === "statue" && entry.tileIndex === male.tileIndex! + 1)!;
    expect(female).toBeDefined();
    expect(lookup(female.glyph, true, true)?.name).toBe("PM_ARCHEOLOGIST");
  });
  it("preserves randomized object appearance mappings using the native object ID", async () => {
    const legacyTile = [...LEGACY_OBJECT_TOKEN_BY_TILE].find(([, token]) => token === "POT_HEALING")![0];
    const catalog = await getGlyphCatalogEntriesForVersion("5.0");
    const native = catalog.find(entry => entry.kind === "obj" && entry.tileIndex === translateNh367TileIndexToNh5(legacyTile))!;
    expect(native).toBeDefined();
    expect(lookup(native.glyph, true, true)?.name).toBe("POT_HEALING");
    const nativeTileByObjectId: number[] = [];
    nativeTileByObjectId[native.glyph - 3448] = 987;
    translator.setRuntimeObjectTileIndexByObjectId(nativeTileByObjectId);
    expect(translator.resolveLookupForTile({ glyph: native.glyph, tileIndex: 987, materialKind: null, forBillboard: true })?.name).toBe("POT_HEALING");
    const pileStart = getGlyphCatalogRanges().find(range => range.key === "GLYPH_OBJ_PILETOP_OFF")!.start;
    const pileGlyph = pileStart + native.glyph - 3448;
    expect(lookup(pileGlyph, true, true)?.name).toBe("POT_HEALING");
    expect(translator.resolveLookupForTile({ glyph: pileGlyph, tileIndex: 987, materialKind: null, forBillboard: true })?.name).toBe("POT_HEALING");
  });
});


it("normalizes every native 5 wall/corner variant to the original wall symbol", async () => {
  const variants = (await getGlyphCatalogEntriesForVersion("5.0")).filter(entry => entry.kind === "cmap" && entry.symidx! >= 1 && entry.symidx! <= 11);
  expect(variants.length).toBeGreaterThan(11);
  for (const entry of variants) {
    expect(translator.resolveCmapIndexForTileIndex(entry.tileIndex!), `glyph ${entry.glyph}`).toBe(entry.symidx);
    expect(lookup(entry.glyph)?.category, `glyph ${entry.glyph}`).toBe("wall");
    expect(lookup(entry.glyph, false)?.category, `glyph ${entry.glyph} without tile`).toBe("wall");
  }
});

describe("3.6.7 tile identity table", () => {
  it("covers every monster with its statue, every object and every map symbol", () => {
    expect(LEGACY_MONSTER_KEY_BY_TILE.size).toBe(762);
    expect(new Set(LEGACY_MONSTER_KEY_BY_TILE.values()).size).toBe(381);
    expect(LEGACY_OBJECT_TOKEN_BY_TILE.size).toBe(453);
    expect(LEGACY_CMAP_INDEX_BY_TILE.size).toBe(87);
    expect(LEGACY_MONSTER_KEY_BY_TILE.get(0)).toBe("PM_GIANT_ANT");
    expect(LEGACY_MONSTER_KEY_BY_TILE.get(1082)).toBe("PM_GIANT_ANT");
    expect(LEGACY_OBJECT_TOKEN_BY_TILE.get(394)).toBe("STRANGE_OBJECT");
    expect(LEGACY_CMAP_INDEX_BY_TILE.get(850)).toBe(0);
  });
});
