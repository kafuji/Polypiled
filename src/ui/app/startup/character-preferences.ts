import type {
  CharacterCreationConfig
} from "../../../game/ui-types";
import type {
  NethackRuntimeVersion
} from "../../../runtime/types";
import {
  sanitizeStartupInitOptionTokens
} from "../../../runtime/startup-init-options";
import {
  type StartupCharacterPreferences,
  type StartupCharacterPreferencesByRuntime
} from "../../../storage/client-options-storage";
import {
  normalizeStartupCreateCharacterSelection
} from "../../../game/helpers/startup-character-constraints";

/** Runtime-specific startup character defaults, equality and canonical names. */
export type StartupFlowStep = "choose" | "create" | "resume";

export const startupDefaultCharacterName = "Web_user";

export function createDefaultStartupCharacterPreferences(
  runtimeVersion: NethackRuntimeVersion = "5.0",
): StartupCharacterPreferences {
  const defaultCreateSelection = normalizeStartupCreateCharacterSelection(
    {},
    runtimeVersion,
  );
  return {
    createName: startupDefaultCharacterName,
    createRole: defaultCreateSelection.role,
    createRace: defaultCreateSelection.race,
    createGender: defaultCreateSelection.gender,
    createAlign: defaultCreateSelection.align,
  };
}

export function createDefaultStartupCharacterPreferencesByRuntime(): StartupCharacterPreferencesByRuntime {
  return {
    "5.0": createDefaultStartupCharacterPreferences("5.0"),
  };
}

export function resolveStartupCharacterPreferencesForRuntime(
  preferencesByRuntime: StartupCharacterPreferencesByRuntime,
  defaultPreferencesByRuntime: StartupCharacterPreferencesByRuntime,
  runtimeVersion: NethackRuntimeVersion,
): StartupCharacterPreferences {
  return (
    preferencesByRuntime[runtimeVersion] ??
    defaultPreferencesByRuntime[runtimeVersion] ??
    createDefaultStartupCharacterPreferences(runtimeVersion)
  );
}

export function areStartupCharacterPreferencesEqual(
  left: StartupCharacterPreferences | undefined,
  right: StartupCharacterPreferences,
): boolean {
  return (
    left?.createName === right.createName &&
    left?.createRole === right.createRole &&
    left?.createRace === right.createRace &&
    left?.createGender === right.createGender &&
    left?.createAlign === right.createAlign
  );
}

export function normalizeStartupCharacterName(value: string): string {
  const normalized = String(value || "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Web_user";
  }
  return normalized.slice(0, 30);
}

export function resolveEffectiveStartupCharacterName(
  config: CharacterCreationConfig,
): string {
  const normalizedName = normalizeStartupCharacterName(config.name || "");
  const startupTokens = sanitizeStartupInitOptionTokens(
    config.initOptions,
  );
  // NetHack wizard/debug playmode canonicalizes the player name to
  // "wizard" during startup, so align save-name logic with runtime behavior.
  if (startupTokens.includes("playmode:debug")) {
    return "wizard";
  }
  return normalizedName;
}
