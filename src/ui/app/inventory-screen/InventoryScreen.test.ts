import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranslationProvider } from "../../../i18n";
import { ja } from "../../../i18n/locales/ja";
import { InventoryWornMask, type InventoryObject, type InventoryState } from "../../../runtime/inventory-state";
import { InventoryScreenView, menuActionsThatKeepScreenOpen } from "./InventoryScreen";
import { inventoryContextActions } from "../inventory/actions";
import { ObjectClass } from "./model";

vi.hoisted(() => vi.stubGlobal("window", {
  matchMedia: () => ({ matches: false }), location: { protocol: "http:", hostname: "localhost" },
}));
afterAll(() => vi.unstubAllGlobals());

function object(letter: string, overrides: Partial<InventoryObject> = {}): InventoryObject {
  return {
    id: letter.charCodeAt(0),
    letter,
    name: `object ${letter}`,
    objectClass: ObjectClass.tool,
    glyph: 0,
    tileIndex: letter.charCodeAt(0),
    quantity: 1,
    armorCategory: null,
    eyewear: false,
    armorDelay: null,
    weight: 10,
    wornMask: 0,
    donning: false,
    doffing: false,
    skin: false,
    buc: null,
    enchantment: null,
    charges: null,
    recharged: null,
    eroded: null,
    eroded2: null,
    erodeproof: false,
    poisoned: false,
    greased: false,
    lit: false,
    unpaid: false,
    named: false,
    container: null,
    ...overrides,
  };
}

const inventory: InventoryState = {
  weight: 412,
  capacity: 450,
  encumbrance: 0,
  twoWeapon: false,
  punished: false,
  floor: [],
  floorHidden: false,
  floorCount: 0,
  gameId: 1,
  objects: [
    object("a", {
      objectClass: ObjectClass.weapon,
      wornMask: InventoryWornMask.weapon,
      buc: "blessed",
      enchantment: 2,
      eroded: { level: 2, kind: "rust" },
    }),
    object("c", { objectClass: ObjectClass.armor, armorCategory: "helmet", wornMask: InventoryWornMask.helmet, buc: "cursed" }),
    object("q", { quantity: 6 }),
    object("$", { objectClass: ObjectClass.coin, quantity: 120 }),
  ],
};

function render(state: InventoryState = inventory, locale: "en" | "ja" = "en"): string {
  const view = createElement(InventoryScreenView, {
    inventory: state,
    controller: null,
    reducedMotion: false,
    renderTilePreview: (tile: number | null) => (tile === null ? null : createElement("img", { "data-tile": tile, alt: "" })),
  });
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLocale: locale }, view));
}

describe("InventoryScreen", () => {
  it("lays out the 52 letter slots in order, then gold", () => {
    const html = render();
    const letters = [...html.matchAll(/data-invs-drop="letter:([^"]+)"/g)].map((match) => match[1]);
    expect(letters).toHaveLength(53);
    expect(letters.slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(letters[26]).toBe("A");
    expect(letters[52]).toBe("$");
  });

  it("puts worn items in their slots and leaves a shadow in the grid", () => {
    const html = render();
    expect(html).toMatch(/data-invs-drop="slot:weapon"[^>]*aria-label="Weapon: object a"/);
    expect(html).toMatch(/data-invs-drop="slot:helmet"[^>]*aria-label="Head: object c"/);
    expect(html).toMatch(/class="nh3d-invs-cell is-filled is-equipped"[^>]*data-invs-drop="letter:a"/);
  });

  it("shows BUC, erosion, enchantment and quantity only as reported", () => {
    const html = render();
    expect(html).toContain("nh3d-invs-item is-blessed is-eroded");
    expect(html).toContain('data-erosion="rust"');
    expect(html).toContain('data-erosion-level="2"');
    expect(html).toContain('<span class="nh3d-invs-item-badge">+2</span>');
    expect(html).toContain("nh3d-invs-item is-cursed");
    expect(html).toContain('<span class="nh3d-invs-item-quantity">6</span>');
    // q has no known BUC: no effect class, no mark
    expect(html).toMatch(/class="nh3d-invs-item" title="object q"/);
  });

  it("shows the weight, the limit of this level and the level", () => {
    const html = render();
    expect(html).toContain("412");
    expect(html).toContain("/ 450");
    expect(html).toContain("Unencumbered");
    expect(html).not.toContain("until");
    expect(html).toContain('data-level="0"');
  });

  it("draws the high-resolution picture when the engine attached one", () => {
    const html = render({
      ...inventory,
      objects: [object("q", { tilePreviewDataUrl: "data:image/png;base64,HIRES" })],
    });
    expect(html).toContain('src="data:image/png;base64,HIRES"');
    expect(html).not.toContain('data-tile="113"');
  });

  it("closes for item actions that take time, not for naming or info", () => {
    for (const id of ["apply", "invoke", "read", "eat", "quaff", "zap", "throw", "drop", "rub", "dip"]) {
      expect(menuActionsThatKeepScreenOpen.has(id), id).toBe(false);
    }
    for (const id of ["info", "name", "call", "adjust"]) {
      expect(inventoryContextActions.some((action) => action.id === id), id).toBe(true);
      expect(menuActionsThatKeepScreenOpen.has(id), id).toBe(true);
    }
  });

  it("lists what lies here as a drop target, or says it cannot be seen", () => {
    const here = { ...object("x"), letter: null, weight: null, name: "a large box", container: { locked: null, contents: null, more: 0, tooDeep: false } };
    const html = render({ ...inventory, floor: [here], floorCount: 3 });
    expect(html).toContain('data-invs-drop="floor"');
    expect(html).toContain('aria-label="a large box"');
    expect(html).toContain("2 more");
    expect(html).toContain("Pick up all");
    expect(render({ ...inventory, floorHidden: true })).toContain("You can&#x27;t see what lies here.");
  });

  it("shows six equipment set buttons, empty ones offering to save", () => {
    const html = render();
    expect(html.match(/class="nh3d-invs-set( |")/g)).toHaveLength(6);
    expect(html).toContain("Empty: click to save what you wear");
  });

  it("names the alternate slot the off hand while two-weaponing", () => {
    expect(render({ ...inventory, twoWeapon: true })).toContain("Off hand");
    expect(render()).toContain("Alternate");
  });

  it("is translated", () => {
    // the app takes its strings at page load; check the Japanese data itself
    const strings = ja.app.inventoryScreen;
    expect(strings.title).toBe("持ち物");
    expect(strings.encumbrance.burdened).toBe("重荷");
  });
});
