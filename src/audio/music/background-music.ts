import { MusicDirector, type MusicHostiles, type MusicMood } from "./music-director";
import { FileMusicPlayer } from "./file-music-player";
import type { MusicLibrary } from "./music-library";
import { resolveMusicPack, type MusicPack } from "./music-pack";
import { ProceduralMusicPlayer, type BackgroundMusicPlayer } from "./procedural-music-player";
import type { MusicRegion } from "./music-region";
import type { MusicStatusEffect } from "./status-effects";

export type BackgroundMusicSettings = {
  soundEnabled: boolean;
  /** Music pack id, or "none" for no music (see music-pack.ts). */
  musicPack: string;
  musicVolume: number;
};

export type BackgroundMusicStats = {
  hp: number;
  maxHp: number;
  time: number;
  /** Experience level, to tell how outmatched the hero is. */
  level?: number;
};

/** What the game core reports with each knowledge frame (src/runtime/knowledge.ts). */
export type BackgroundMusicKnowledge = {
  region: MusicRegion;
  /** Wrapping counters; an increase means a fight is on. */
  heroAttacks: number;
  foeAttacks: number;
  hostiles: MusicHostiles;
  /** The Wizard of Yendor is on the map. */
  wizardInView: boolean;
};

const EVALUATE_INTERVAL_MS = 250;

/**
 * Only an ascension prints the choir line: offering the Amulet at your own
 * altar. It comes before the game-over sequence, so the music starts with the
 * moment itself. The final killer text "ascended" is the fallback.
 */
const ASCENSION_MESSAGE = /invisible choir sings|^\s*ascended\b/i;

/**
 * The Wizard teleports away to heal and comes straight back, so the panic
 * outlasts his last sighting a little instead of cutting out at every blink.
 */
export const WIZARD_LINGER_MS = 8000;

function resolvePublicAssetUrl(path: string): string {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  const rawBase =
    typeof import.meta.env?.BASE_URL === "string" && import.meta.env.BASE_URL.trim()
      ? import.meta.env.BASE_URL.trim()
      : "/";
  const base = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;
  if (typeof window === "undefined" || !window.location?.href) return `${base}${normalizedPath}`;
  return new URL(normalizedPath, new URL(base, window.location.href)).toString();
}

/** Bundled music files, falling back to the procedural synth if they fail to load. */
export function createFileMusicPlayer(library: MusicLibrary): BackgroundMusicPlayer {
  return new FileMusicPlayer(library, resolvePublicAssetUrl, new ProceduralMusicPlayer());
}

/**
 * Glue between the game and the music player: feeds the director with
 * player stats / combat events and switches the player's mood. The player
 * belongs to the selected music pack and is replaced when the pack changes.
 */
export class BackgroundMusic {
  private readonly director = new MusicDirector();
  private settings: BackgroundMusicSettings | null = null;
  private pack: MusicPack | null = null;
  private player: BackgroundMusicPlayer | null = null;
  private stats: BackgroundMusicStats | null = null;
  private dangerCondition = false;
  private gameOver = false;
  private ascended = false;
  private previewMood: MusicMood | null | undefined = undefined;
  private region: MusicRegion | null = null;
  private wizardInView = false;
  private wizardLastSeenAt = Number.NEGATIVE_INFINITY;
  private wizardPanic = false;
  private statusEffects: MusicStatusEffect[] = [];
  private hostiles: MusicHostiles | null = null;
  private attackCounters: { hero: number; foe: number } | null = null;
  private evaluateTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(
    private readonly createPlayer: (pack: MusicPack) => BackgroundMusicPlayer = (pack) =>
      createFileMusicPlayer(pack.library),
    private readonly now: () => number = () => Date.now(),
  ) {}

  setSettings(settings: BackgroundMusicSettings): void {
    if (this.disposed) return;
    const packChanged = settings.musicPack !== this.settings?.musicPack;
    this.settings = { ...settings };
    if (packChanged) this.usePack(resolveMusicPack(settings.musicPack));
    this.player?.setVolume(settings.musicVolume);
    if (!this.isEnabled()) {
      this.player?.setMood(null);
      void this.player?.suspend();
    } else {
      void this.player?.resume();
    }
    this.evaluate();
  }

  getMusicPack(): MusicPack | null {
    return this.pack;
  }

  private usePack(pack: MusicPack | null): void {
    this.player?.stopOnce?.();
    this.player?.dispose();
    this.pack = pack;
    this.player = pack ? this.createPlayer(pack) : null;
    if (!this.player) return;
    this.player.setStatusEffects?.(this.statusEffects);
    this.applyTrackPreference();
  }

  notifyPlayerStats(
    stats: BackgroundMusicStats,
    dangerCondition: boolean,
    statusEffects: readonly MusicStatusEffect[] = [],
  ): void {
    this.stats = { ...stats };
    this.dangerCondition = dangerCondition;
    this.setStatusEffects(statusEffects);
    this.evaluate();
  }

  /** A knowledge frame: the region, fights and hostiles in view. */
  notifyKnowledge(knowledge: BackgroundMusicKnowledge): void {
    this.updateRegion(knowledge.region);
    this.hostiles = { ...knowledge.hostiles };
    const previous = this.attackCounters;
    this.attackCounters = { hero: knowledge.heroAttacks, foe: knowledge.foeAttacks };
    if (previous && (previous.hero !== knowledge.heroAttacks || previous.foe !== knowledge.foeAttacks)) {
      this.director.notifyCombat(this.now(), this.stats?.time ?? 0);
    }
    if (knowledge.wizardInView !== this.wizardInView) {
      this.notifyWizardPresence(knowledge.wizardInView);
    } else {
      this.evaluate();
    }
  }

  /** Confusion, hallucination, ... color the music (see status-effects.ts). */
  setStatusEffects(effects: readonly MusicStatusEffect[]): void {
    const sorted = [...new Set(effects)].sort();
    if (sorted.join(",") === this.statusEffects.join(",")) return;
    this.statusEffects = sorted;
    this.player?.setStatusEffects?.(sorted);
  }

  getCurrentRegion(): MusicRegion | null {
    return this.region;
  }

  /** Whether the Wizard of Yendor is on the map right now. */
  notifyWizardPresence(inView: boolean): void {
    if (inView === this.wizardInView) return;
    this.wizardInView = inView;
    // Count the linger from when he leaves the map.
    if (!inView) this.wizardLastSeenAt = this.now();
    this.evaluate();
  }

  isWizardPanic(): boolean {
    return this.wizardPanic;
  }

  private applyTrackPreference(): void {
    const pack = this.pack;
    if (!pack) return;
    const regional = this.region ? pack.regionTracks[this.region] : {};
    const wizard = this.wizardPanic ? pack.wizardTrackId : null;
    this.player?.setTrackPreference?.(wizard ? { ...regional, combat: [wizard] } : regional);
  }

  private updateWizardPanic(): void {
    const sighted = this.wizardInView || this.now() - this.wizardLastSeenAt < WIZARD_LINGER_MS;
    const panic = sighted && Boolean(this.pack?.wizardTrackId);
    if (panic === this.wizardPanic) return;
    this.wizardPanic = panic;
    this.applyTrackPreference();
  }

  private updateRegion(region: MusicRegion): void {
    if (region === this.region) return;
    const entering = this.region !== null;
    this.region = region;
    this.applyTrackPreference();
    // A small fanfare when walking into a new branch or special level (not on
    // game start).
    if (entering && region !== "dungeon" && this.isEnabled() && !this.gameOver) {
      this.player?.playStinger?.("region-enter");
    }
  }

  /** A game message or the final death text; an ascension starts its music. */
  notifyGameMessage(text: string): void {
    if (ASCENSION_MESSAGE.test(text)) this.notifyAscension();
  }

  notifyAscension(): void {
    if (this.ascended) return;
    this.ascended = true;
    this.evaluate();
    const track = this.pack?.ascensionTrack;
    if (track && this.isEnabled()) this.player?.playOnce?.(track);
  }

  setGameOver(active: boolean): void {
    const ended = active && !this.gameOver;
    this.gameOver = active;
    this.evaluate();
    if (ended && !this.ascended && this.isEnabled()) this.player?.playStinger?.("game-over");
  }

  resumeFromUserGesture(): void {
    if (this.isEnabled()) void this.player?.resume();
  }

  /** New game / reconnect. */
  reset(): void {
    this.director.reset();
    this.stats = null;
    this.dangerCondition = false;
    this.gameOver = false;
    this.ascended = false;
    this.player?.stopOnce?.();
    this.region = null;
    this.wizardInView = false;
    this.wizardLastSeenAt = Number.NEGATIVE_INFINITY;
    this.wizardPanic = false;
    this.hostiles = null;
    this.attackCounters = null;
    this.setStatusEffects([]);
    this.player?.setMood(null);
  }

  /** Debug: force a mood (null = silence), or undefined to return to auto. */
  setPreviewMood(mood: MusicMood | null | undefined): void {
    this.previewMood = mood;
    if (mood !== undefined) void this.player?.resume();
    this.evaluate();
  }

  getCurrentMood(): MusicMood {
    return this.director.currentMood;
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.player?.dispose();
    this.player = null;
  }

  private isEnabled(): boolean {
    const settings = this.settings;
    return (
      !this.disposed &&
      this.player !== null &&
      settings !== null &&
      settings.soundEnabled &&
      settings.musicVolume > 0
    );
  }

  private evaluate(): void {
    const player = this.player;
    if (this.disposed || !player) {
      this.stopTimer();
      return;
    }
    if (this.previewMood !== undefined) {
      player.setMood(this.isEnabled() ? this.previewMood : null);
      this.stopTimer();
      return;
    }
    if (!this.isEnabled() || this.gameOver || this.ascended || !this.stats || this.stats.maxHp <= 0) {
      player.setMood(null);
      this.stopTimer();
      return;
    }
    const mood = this.director.update({
      nowMs: this.now(),
      hp: this.stats.hp,
      maxHp: this.stats.maxHp,
      turn: this.stats.time,
      dangerCondition: this.dangerCondition,
      experienceLevel: this.stats.level,
      hostiles: this.hostiles,
    });
    // The Wizard's track rides on the combat channel and outranks every mood.
    this.updateWizardPanic();
    player.setMood(this.wizardPanic ? "combat" : mood);
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.evaluateTimer !== null) return;
    // Combat and dwell timers expire in real time, so re-check periodically.
    this.evaluateTimer = setInterval(() => this.evaluate(), EVALUATE_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.evaluateTimer === null) return;
    clearInterval(this.evaluateTimer);
    this.evaluateTimer = null;
  }
}
