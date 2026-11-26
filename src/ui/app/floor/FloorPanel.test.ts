import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "../../../i18n";
import type { FloorHere } from "../../../runtime/floor-here";
import { useGameStore } from "../../../state/gameStore";
import { t } from "../shared/translations";
import { FLOOR_PANEL_MAX_OBJECTS, FloorPanelView } from "./FloorPanel";

const floor = (overrides: Partial<FloorHere> = {}): FloorHere => ({
  x: 3,
  y: 4,
  feature: "staircase down",
  trap: null,
  engraving: null,
  hidden: false,
  objects: [],
  count: 0,
  ...overrides,
});

function render(locale: "ja" | "en" = "ja", visible = true, statusText = ""): string {
  const panel = createElement(FloorPanelView, {
    visible,
    statusText,
    floorHere: useGameStore.getState().floorHere,
    renderTilePreview: (tile: number | null) => (tile === null ? null : createElement("img", { "data-tile": tile, alt: "" })),
  });
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLocale: locale }, panel));
}

vi.hoisted(() => vi.stubGlobal("window", {
  matchMedia: () => ({ matches: false }), location: { protocol: "http:", hostname: "localhost" },
}));
afterAll(() => vi.unstubAllGlobals());
afterEach(() => useGameStore.getState().setFloorHere(null));

describe("FloorPanel", () => {
  it("shows nothing until the game reports the floor, or while hidden", () => {
    expect(render()).toBe("");
    useGameStore.getState().setFloorHere(floor());
    expect(render("ja", false)).toBe("");
  });

  it("puts the player position on the same line as the terrain", () => {
    expect(render("ja", true, "Player at (58, 16)")).toContain("プレイヤー位置 (58, 16)");
    useGameStore.getState().setFloorHere(floor({ trap: "bear trap" }));
    const html = render("ja", true, "Player at (58, 16)");
    const line = html.slice(html.indexOf("nh3d-floor-panel-feature"));
    expect(line).toContain("プレイヤー位置 (58, 16)");
    expect(line).toContain("下り階段");
    expect(line).toContain("トラバサミ");
    expect(html).not.toContain("Polypiled");
  });

  it("shows only the terrain when nothing lies here", () => {
    useGameStore.getState().setFloorHere(floor());
    const html = render();
    expect(html).toContain("下り階段");
    expect(html).not.toContain("nh3d-floor-panel-objects");
    expect(html).not.toContain("nh3d-floor-panel-note");
  });

  it("names a trap the hero has seen here", () => {
    useGameStore.getState().setFloorHere(floor({ feature: "floor of a room", trap: "bear trap" }));
    expect(render()).toContain("トラバサミ");
  });

  it("lists the first objects with their tiles and counts the rest", () => {
    const objects = Array.from({ length: 7 }, (_, index) => ({
      name: index === 0 ? "a dagger" : `object ${index}`,
      glyph: 3500 + index,
      tileIndex: 800 + index,
      quantity: 1,
    }));
    useGameStore.getState().setFloorHere(floor({ objects, count: 9 }));
    const html = render();
    expect(html).toContain('data-tile="800"');
    expect(html).toContain("ダガー");
    expect((html.match(/nh3d-floor-panel-object"/g) ?? []).length).toBe(FLOOR_PANEL_MAX_OBJECTS);
    expect(html).toContain(t.floorPanel.more(9 - FLOOR_PANEL_MAX_OBJECTS));
  });

  it("shows an engraving the hero has read, and a floor the hero cannot see", () => {
    useGameStore.getState().setFloorHere(floor({ feature: "floor of a room", engraving: { type: 1, text: "Elbereth" }, hidden: true }));
    const html = render();
    expect(html).toContain("部屋の床");
    expect(html).toContain(t.floorPanel.engravingKinds.dust);
    expect(html).toContain("Elbereth");
    expect(html).toContain(t.floorPanel.hidden.replace(/'/g, "&#x27;"));
  });
});
