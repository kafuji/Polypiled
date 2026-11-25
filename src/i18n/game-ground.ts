import type { SupportedLocale } from "./core";
import { translateInventoryItem } from "./inventory-text";
import { deityNames } from "./intro-story";

// Features are translated from the actual visible prose, never from hidden
// map state. A doorway is not an inventory item and may have no door at all.
const features: Readonly<Record<string, string>> = {
  doorway: "戸口", "open doorway": "開いた戸口", "doorless doorway": "扉のない戸口",
  door: "扉", "open door": "開いた扉", "closed door": "閉じた扉", "broken door": "壊れた扉",
  "staircase up": "上り階段", "staircase down": "下り階段", "stairway up": "上り階段", "stairway down": "下り階段",
  "staircase up out of the dungeon": "ダンジョンの外へ続く上り階段",
  "ladder up": "上りはしご", "ladder down": "下りはしご", "up staircase": "上り階段", "down staircase": "下り階段",
  fountain: "泉", sink: "流し台", throne: "玉座", grave: "墓", altar: "祭壇", tree: "木", "iron bars": "鉄格子",
  "pool of water": "水たまり", pool: "水たまり", moat: "堀", water: "水", lava: "溶岩", ice: "氷",
  "floor of a room": "部屋の床", "room floor": "部屋の床", corridor: "通路", "dark corridor": "暗い通路", "secret corridor": "隠し通路",
  "magic portal": "魔法のポータル", "bear trap": "トラバサミ", "pit": "落とし穴", "spiked pit": "針のある落とし穴",
  "trap door": "落とし戸", "sleeping gas trap": "睡眠ガスの罠", "arrow trap": "矢の罠", "dart trap": "投げ矢の罠",
  "teleportation trap": "テレポートの罠", "level teleporter": "階移動の罠", "fire trap": "火の罠", "magic trap": "魔法の罠",
  "anti-magic field": "反魔法の場", "rust trap": "錆の罠", "polymorph trap": "変化の罠", "land mine": "地雷", "rolling boulder trap": "転がる大岩の罠",
  "squeaky board": "きしむ床板", "web": "蜘蛛の巣", "hole": "穴", "vibrating square": "振動するマス",
};

/** src/i18n's own name for a map feature or trap ("teleportation trap"), if any. */
export function translateCuratedFeature(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(features, name) ? features[name] : undefined;
}

/** Translate a visible ground feature or item without changing game state. */
export function translateGroundObject(text: string, locale: SupportedLocale): string {
  if (locale !== "ja" || !text.trim()) return text;
  const whitespace = /^(\s*)(.*?)(\s*)$/s.exec(text);
  if (!whitespace) return text;
  const [, leading, content, trailing] = whitespace;
  const stripped = content.replace(/^(?:a|an|the) /, "");
  if (Object.prototype.hasOwnProperty.call(features, stripped)) return `${leading}${features[stripped]}${trailing}`;
  const stairs = /^(?:a |the )?(?:staircase|stairway) (up|down) to level (\d+)$/.exec(content);
  if (stairs) return `${leading}${stairs[2]}階へ${stairs[1] === "up" ? "上る" : "下りる"}階段${trailing}`;
  const altar = /^(?:an? |the )?(high )?altar to (.+) \((lawful|neutral|chaotic|unaligned)\)$/.exec(content);
  if (altar) {
    const god = Object.prototype.hasOwnProperty.call(deityNames, altar[2]) ? deityNames[altar[2]] : altar[2];
    const alignment = { lawful: "秩序", neutral: "中立", chaotic: "混沌", unaligned: "無属性" }[altar[3] as "lawful"];
    return `${leading}${god}の${altar[1] ? "大" : ""}祭壇（${alignment}）${trailing}`;
  }
  return translateInventoryItem(text, locale);
}

// Polypiled: names only the hover label uses (core/NetHack/win/shim/nh3d_knowledge.c).
// Kept apart from `features` so message translation is unaffected.
const squareNames: Readonly<Record<string, string>> = {
  wall: "壁", "lawful altar": "秩序の祭壇", "neutral altar": "中立の祭壇", "chaotic altar": "混沌の祭壇",
  "unaligned altar": "無属性の祭壇", "high altar": "高位の祭壇", "lowered drawbridge": "下りた跳ね橋",
  "raised drawbridge": "上がった跳ね橋", air: "空中", cloud: "雲", "falling rock trap": "落石の罠", "statue trap": "石像の罠",
};

/** Translate a name the hover label shows for a map square (ground, feature, trap or object). */
export function translateSquareName(text: string, locale: SupportedLocale): string {
  if (locale === "ja" && Object.prototype.hasOwnProperty.call(squareNames, text)) return squareNames[text];
  return translateGroundObject(text, locale);
}
