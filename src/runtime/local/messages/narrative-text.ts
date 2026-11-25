import questSource from "../../../../core/NetHack/dat/quest.lua?raw";
import air from "../../../../core/NetHack/dat/air.lua?raw";
import astral from "../../../../core/NetHack/dat/astral.lua?raw";
import earth from "../../../../core/NetHack/dat/earth.lua?raw";
import water from "../../../../core/NetHack/dat/water.lua?raw";
import { NH5_TILE_KEYS } from "../../../game/hires-tiles/tile-keys.5.generated";

// Leader, guardian and nemesis, in the order used by src/role.c.
const questActors: Record<string, readonly [string, string, string]> = {
  Arc: ["lord_carnarvon", "student", "minion_of_huhetotl"],
  Bar: ["pelias", "chieftain", "thoth_amon"],
  Cav: ["shaman_karnov", "neanderthal", "chromatic_dragon"],
  Hea: ["hippocrates", "attendant", "cyclops"],
  Kni: ["king_arthur", "page", "ixoth"],
  Mon: ["grand_master", "abbot", "master_kaen"],
  Pri: ["arch_priest", "acolyte", "nalzok"],
  Ran: ["orion", "hunter", "scorpius"],
  Rog: ["master_of_thieves", "thug", "master_assassin"],
  Sam: ["lord_sato", "roshi", "ashikaga_takauji"],
  Tou: ["twoflower", "guide", "master_of_thieves"],
  Val: ["norn", "warrior", "lord_surtur"],
  Wiz: ["neferet_the_green", "apprentice", "dark_one"],
};

const noSpeaker = /^(?:firsttime|nexttime|othertime|locate_.+|goal_.+|gotit|killed_nemesis)$/;
const monsterSpecies = new Set(NH5_TILE_KEYS.flatMap(key => {
  const match = /^mon\/(.+)_male$/.exec(key);
  return match ? [match[1]] : [];
}));
const substitutions = /%[a-zA-Z](?:[AaCPpSst]|(?<=[dlno])[hHiIjJ])?/g;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

interface NarrativePattern { actor: string; needle: string; match: RegExp }

function compileNarratives(): NarrativePattern[] {
  const patterns: NarrativePattern[] = [];
  function add(text: string, actor: string) {
    const parts = normalize(text).split(substitutions);
    if (!parts.join("").trim()) return;
    const needle = parts.reduce((longest, part) => part.length > longest.length ? part : longest, "");
    const regex = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+?");
    patterns.push({ actor, needle: needle.toLowerCase(), match: new RegExp(`^${regex}$`, "i") });
  }
  let role = "";
  let key = "";
  let byLine = false;
  // The bundled quest file uses text fields and arrays of alternative lines.
  // Synopsis fields are history entries and must not display a second time.
  const fields = /^ {3}(\w+) = \{$|^ {6}(\w+) = \{$|^ {9}(?:(output|text) = )?(?:\[\[([\s\S]*?)\]\]|"((?:[^"\\]|\\.)*)")/gm;
  for (const match of questSource.replace(/\r/g, "").matchAll(fields)) {
    if (match[1]) { role = match[1]; key = ""; continue; }
    if (match[2]) { key = match[2]; byLine = false; continue; }
    if (match[3] === "output") { byLine = match[5] === "pline"; continue; }
    if (!key || key === "TEST_PATTERN" || role === "msg_fallbacks") continue;
    const actors = questActors[role];
    const text = (match[4] ?? match[5]).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    const actor = noSpeaker.test(key) || !actors
      ? "narration"
      : key.startsWith("guardtalk_") ? actors[1]
      : /^(?:nemesis_|discourage$)/.test(key) ? actors[2] : actors[0];
    for (const page of byLine ? text.split("\n") : [text]) add(page, actor);
  }
  for (const source of [air, astral, earth, water]) {
    for (const match of source.matchAll(/\bdes\.message\("([^"]+)"\)/g)) add(match[1], "narration");
  }
  return patterns.sort((a, b) => b.needle.length - a.needle.length);
}

let narratives: NarrativePattern[] | undefined;

/** Match the core's expanded quest text regardless of language or wrapping. */
export function narrativeActor(text: string, tileIndex?: number | null): string | undefined {
  const normalized = normalize(text);
  if (!normalized) return;
  const lower = normalized.toLowerCase();
  const knownActor = tileIndex == null ? undefined : /^mon\/(.+)_(?:male|female)$/.exec(NH5_TILE_KEYS[tileIndex])?.[1];
  let first: string | undefined;
  for (const { actor, needle, match } of narratives ??= compileNarratives()) {
    if (!lower.includes(needle) || !match.test(normalized)) continue;
    if (!knownActor || actor === knownActor) return actor;
    first ??= actor;
  }
  return first;
}

export function spokenActor(text: string): string | undefined {
  const speech = /^(?:(?:the |an? )?([\w -]+?) (?:says|whispers|shouts|asks|replies|yells|exclaims)(?:[:,]\s*|\s+)|\s*)"[\s\S]+"\s*$/i.exec(text);
  if (!speech) return;
  const species = speech[1]?.toLowerCase().replace(/[ -]/g, "_");
  return species && monsterSpecies.has(species) ? species : "narration";
}
