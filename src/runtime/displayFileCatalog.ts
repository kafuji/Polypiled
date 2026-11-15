import cmdhelpText from "../../imported/nethack-5.0/dat/cmdhelp?raw";
import helpText from "../../imported/nethack-5.0/dat/help?raw";
import hhText from "../../imported/nethack-5.0/dat/hh?raw";
import historyText from "../../imported/nethack-5.0/dat/history?raw";
import keyhelpText from "../../imported/nethack-5.0/dat/keyhelp?raw";
import licenseText from "../../imported/nethack-5.0/dat/license?raw";
import opthelpText from "../../imported/nethack-5.0/dat/opthelp?raw";
import optmenuText from "../../imported/nethack-5.0/dat/optmenu?raw";
import usagehlpText from "../../imported/nethack-5.0/dat/usagehlp?raw";
import wizhelpText from "../../imported/nethack-5.0/dat/wizhelp?raw";

type DisplayFilePayload = {
  canonicalName: string;
  title: string;
  lines: string[];
};

type CatalogEntry = {
  title: string;
  text: string;
};

// NetHack 5.0's own help files (core/NetHack/dat).
const catalog: Record<string, CatalogEntry> = {
  cmdhelp: { title: "Command Help", text: cmdhelpText },
  help: { title: "NetHack Help", text: helpText },
  hh: { title: "NetHack Help", text: hhText },
  history: { title: "NetHack History", text: historyText },
  keyhelp: { title: "Key Help", text: keyhelpText },
  license: { title: "NetHack License", text: licenseText },
  opthelp: { title: "Option Help", text: opthelpText },
  optmenu: { title: "Option Menu Help", text: optmenuText },
  usagehlp: { title: "Command Line Help", text: usagehlpText },
  wizhelp: { title: "Wizard Help", text: wizhelpText },
};

const aliases: Record<string, string> = {
  shelp: "cmdhelp",
  help: "help",
  history: "history",
  keyhelp: "keyhelp",
  optionfile: "opthelp",
  wizhelp: "wizhelp",
  license: "license",
};

function normalizeDisplayFileName(nameLike: unknown): string {
  const raw = typeof nameLike === "string" ? nameLike : String(nameLike ?? "");
  return raw.trim().toLowerCase();
}

function normalizeDisplayFileLines(rawText: string): string[] {
  const normalizedText = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\f/g, "\n\n");
  const lines = normalizedText.split("\n").map((line) => line.trimEnd());

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

export function getBundledDisplayFile(
  fileName: unknown,
): DisplayFilePayload | null {
  const normalizedName = normalizeDisplayFileName(fileName);
  if (!normalizedName) {
    return null;
  }

  const canonicalName = aliases[normalizedName] || normalizedName;
  const entry = catalog[canonicalName];
  if (!entry) {
    return null;
  }

  return {
    canonicalName,
    title: entry.title,
    lines: normalizeDisplayFileLines(entry.text),
  };
}
