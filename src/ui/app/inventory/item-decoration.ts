import type { InventoryBuc, InventoryErosion } from "../../../runtime/inventory-state";

/**
 * What an item's English menu text tells about it, for the same marks the
 * inventory screen draws on its icons: BUC, erosion, lit and greased.
 * Only what the name says counts: an unknown BUC stays null.
 */
export interface ItemTextDecoration {
  readonly buc: InventoryBuc | null;
  /** rust, burn or crack */
  readonly eroded: InventoryErosion | null;
  /** corrode or rot */
  readonly eroded2: InventoryErosion | null;
  readonly lit: boolean;
  readonly greased: boolean;
}

const erosionWords: Readonly<Record<string, { kind: string; second: boolean }>> = {
  rusty: { kind: "rust", second: false },
  burnt: { kind: "burn", second: false },
  cracked: { kind: "crack", second: false },
  corroded: { kind: "corrode", second: true },
  rotted: { kind: "rot", second: true },
};

const erosionLevels: Readonly<Record<string, number>> = { very: 2, thoroughly: 3 };

export function parseItemTextDecoration(text: string | null | undefined): ItemTextDecoration {
  // the object's own description, not a name the player gave it
  const own = (text ?? "").split(/\s+(?:named|called)\s+/)[0].toLowerCase();
  let buc: InventoryBuc | null = null;
  if (/\b(?:blessed|holy water)\b/.test(own.replace(/\bunholy\b/g, ""))) buc = "blessed";
  else if (/\b(?:cursed|unholy water)\b/.test(own)) buc = "cursed";
  else if (/\buncursed\b/.test(own)) buc = "uncursed";

  let eroded: InventoryErosion | null = null;
  let eroded2: InventoryErosion | null = null;
  for (const match of own.matchAll(/\b(?:(very|thoroughly)\s+)?(rusty|burnt|cracked|corroded|rotted)\b/g)) {
    const word = erosionWords[match[2]];
    const erosion = { kind: word.kind, level: match[1] ? erosionLevels[match[1]] : 1 };
    if (word.second) eroded2 ??= erosion;
    else eroded ??= erosion;
  }

  return {
    buc,
    eroded,
    eroded2,
    lit: /\((?:[^)]*\s)?lit\)/.test(own),
    greased: /\bgreased\b/.test(own),
  };
}

/** The classes and data attributes that carry the marks on an icon. */
export function itemDecorationAttributes(decoration: ItemTextDecoration): {
  className: string;
  "data-erosion"?: string;
  "data-erosion2"?: string;
  "data-erosion-level"?: number;
} {
  const classes: string[] = [];
  if (decoration.buc) classes.push(`is-${decoration.buc}`);
  if (decoration.lit) classes.push("is-lit");
  if (decoration.greased) classes.push("is-greased");
  const level = Math.max(decoration.eroded?.level ?? 0, decoration.eroded2?.level ?? 0);
  return {
    className: classes.join(" "),
    "data-erosion": decoration.eroded?.kind,
    "data-erosion2": decoration.eroded2?.kind,
    "data-erosion-level": level || undefined,
  };
}

/** The name's color class: blessed and cursed only. */
export function itemTextBucClass(decoration: ItemTextDecoration): string {
  return decoration.buc === "blessed" ? "blessed-text" : decoration.buc === "cursed" ? "cursed-text" : "";
}

/** Props for a menu icon's box: its base class plus the marks the text gives. */
export function iconShellProps(base: string, text: string | null | undefined) {
  const attributes = itemDecorationAttributes(parseItemTextDecoration(text));
  return { ...attributes, className: [base, attributes.className].filter(Boolean).join(" ") };
}

/** A menu line's text class plus the BUC color, for items only. */
export function itemTextClassName(base: string, text: string | null | undefined, isItem: boolean): string {
  const buc = isItem ? itemTextBucClass(parseItemTextDecoration(text)) : "";
  return buc ? `${base} ${buc}` : base;
}
