import { AgentSession, type AgentAction, type AgentActResult, type AgentMessage, type AgentObservation } from "./agent-session";
import { checkHeadlessSeed, startNodeRuntime, type NodeRuntime } from "./node-runtime";
import type { RuntimeCharacterCreationConfig } from "../runtime/types";

/** What decides a game: the same setup and the same actions give the same game. */
export interface HeadlessGameSetup {
  /** The core's random seed, 0 to 4294967295. Default 0. */
  seed?: number;
  name?: string;
  /** Give all four to choose the character; otherwise it is random (from the seed). */
  role?: string;
  race?: string;
  gender?: string;
  align?: string;
  /** "debug" is wizard mode; its character is always named "wizard". */
  playmode?: "normal" | "explore" | "debug";
  /** Extra NetHack option tokens, e.g. "autopickup" or "!autopickup" or "pickup_types:$". */
  options?: string[];
}

export interface HeadlessGameOptions extends HeadlessGameSetup {
  /** Directory holding nethack-5.js and nethack-5.wasm. */
  publicDir: string;
  /** Start from a snapshot instead: replay its actions on its setup (the setup fields above are ignored). */
  snapshot?: HeadlessSnapshot;
  verbose?: boolean;
}

/**
 * A saved point in a game: its setup and every action taken so far.
 * Starting from it replays the actions, which the deterministic core turns
 * into the same game; the fingerprint checks that it did.
 */
export interface HeadlessSnapshot {
  format: "polypiled-headless-snapshot";
  version: 1;
  setup: HeadlessGameSetup;
  actions: AgentAction[];
  turn: number | null;
  fingerprint: string;
}

/** Several steps run as one: their messages and turns together, the last prompt. */
export interface HeadlessStepsResult extends AgentActResult { steps: number }

// Fixed choices that keep a headless game free of interactive surprises and
// keep key handling simple (counts are plain digits when number_pad is off).
const HEADLESS_OPTIONS = ["!tutorial", "number_pad:0", "!autopickup", "!legacy"];

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizeSetup(setup: HeadlessGameSetup): HeadlessGameSetup {
  const clean: HeadlessGameSetup = { seed: checkHeadlessSeed(setup.seed ?? 0) };
  if (setup.playmode && setup.playmode !== "normal") clean.playmode = setup.playmode;
  if (setup.name !== undefined) clean.name = setup.name;
  for (const key of ["role", "race", "gender", "align"] as const) if (setup[key] !== undefined) clean[key] = setup[key];
  if (setup.options?.length) clean.options = [...setup.options];
  return clean;
}

/** One game in this thread: start(), then observe() and act() until it ends. */
export class HeadlessGame {
  private readonly actions: AgentAction[] = [];

  private constructor(private readonly node: NodeRuntime, readonly session: AgentSession, readonly setup: HeadlessGameSetup) {}

  static async start(options: HeadlessGameOptions): Promise<HeadlessGame> {
    const snapshot = options.snapshot;
    if (snapshot && (snapshot.format !== "polypiled-headless-snapshot" || snapshot.version !== 1 || !Array.isArray(snapshot.actions))) {
      throw new Error("Not a headless snapshot (format polypiled-headless-snapshot, version 1)");
    }
    const setup = normalizeSetup(snapshot ? snapshot.setup : options);
    // The core lets only the player named "wizard" into debug mode (bootstrap's sysconf: WIZARDS=wizard).
    if (setup.playmode === "debug" && setup.name !== undefined && setup.name !== "wizard") throw new Error('Debug mode needs the name "wizard"');
    const name = setup.playmode === "debug" ? "wizard" : setup.name ?? "Agent";
    const character: RuntimeCharacterCreationConfig = { mode: "random", name };
    const chosen = [setup.role, setup.race, setup.gender, setup.align];
    if (chosen.some(value => value !== undefined)) {
      if (chosen.some(value => typeof value !== "string" || !value)) throw new Error("Give role, race, gender and align together");
      Object.assign(character, { mode: "create", role: setup.role, race: setup.race, gender: setup.gender, align: setup.align });
    }
    const extra = setup.options ?? [];
    for (const token of extra) {
      if (typeof token !== "string" || !/^!?[a-z_]+(?::[^,]*)?$/i.test(token)) throw new Error(`Invalid option "${token}"`);
    }
    const initOptions = [
      ...HEADLESS_OPTIONS,
      ...extra.filter(token => !/^!?number_pad\b/i.test(token)),
      ...(setup.playmode ? [`playmode:${setup.playmode}`] : []),
    ];
    const session = new AgentSession();
    const node = await startNodeRuntime({
      publicDir: options.publicDir,
      seed: setup.seed ?? 0,
      verbose: options.verbose,
      startupOptions: { runtimeVersion: "5.0", characterCreation: character, initOptions },
      onEvent: event => session.handle(event),
    });
    session.attach({
      sendInput: (input, identity) => node.runtime.sendInput(input, identity),
      sendInputSequence: (inputs, identity) => node.runtime.sendInputSequence(inputs, identity),
      isMultiSelectMenuActive: () => node.runtime.isMultiSelectMenuActive(),
    });
    const game = new HeadlessGame(node, session, setup);
    try {
      if (!(await session.settle())) throw new Error("The game did not reach its first input request");
      if (snapshot) await game.replay(snapshot);
    } catch (error) {
      game.shutdown();
      throw error;
    }
    return game;
  }

  private async replay(snapshot: HeadlessSnapshot): Promise<void> {
    for (const [index, action] of snapshot.actions.entries()) {
      try {
        await this.act(action);
      } catch (error) {
        throw new Error(`Replaying action ${index + 1} of ${snapshot.actions.length} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.session.observe({ map: false }); // the replayed messages are old news
    const fingerprint = this.fingerprint();
    if (fingerprint !== snapshot.fingerprint) {
      throw new Error(`The replay did not reach the snapshot's state (fingerprint ${fingerprint}, expected ${snapshot.fingerprint}); was it made with another core?`);
    }
  }

  /** A short hash of what the hero sees: turn, prompt, hero, level, status and map. */
  fingerprint(): string {
    const { turn, prompt, hero, level, status } = this.session.peek();
    return fnv1a(JSON.stringify({ turn, prompt, hero, level, status, map: this.session.mapView().rows }));
  }

  snapshot(): HeadlessSnapshot {
    return {
      format: "polypiled-headless-snapshot", version: 1,
      setup: structuredClone(this.setup), actions: structuredClone(this.actions),
      turn: this.session.peek().turn, fingerprint: this.fingerprint(),
    };
  }

  get actionCount(): number { return this.actions.length; }

  observe(options?: { map?: boolean }): AgentObservation { return this.session.observe(options); }

  async act(action: AgentAction, timeoutMs?: number): Promise<AgentActResult> {
    const result = await this.session.act(action, timeoutMs);
    // Recorded once sent: the game has consumed it, so a replay must send it too.
    this.actions.push(structuredClone(action));
    return result;
  }

  inventory() { return this.session.inventoryView(); }

  /** Debug mode only: the level as it really is. Takes no time and no randomness. */
  async reveal(): Promise<unknown> {
    this.requireDebug("reveal");
    await this.act({ reveal: true });
    const reveal = this.session.takeReveal();
    if (!reveal) throw new Error("The core did not reveal the level (it needs a core with the reveal operation)");
    return reveal;
  }

  /** Debug mode: wish for an object (^W). */
  wish(text: string): Promise<HeadlessStepsResult> {
    this.requireDebug("wish");
    return this.steps([{ keys: ["^w"] }, { expect: "text", action: { text } }]);
  }

  /** Debug mode: create a monster (^G), e.g. "jackal" or "3 peaceful gnomes". */
  createMonster(text: string): Promise<HeadlessStepsResult> {
    this.requireDebug("create_monster");
    return this.steps([{ keys: ["^g"] }, { expect: "text", action: { text } }]);
  }

  /** Debug mode: teleport within the level (^T) to x, y. */
  teleport(x: number, y: number): Promise<HeadlessStepsResult> {
    this.requireDebug("teleport");
    return this.steps([{ keys: ["^t"] }, { expect: "position", action: { position: { x, y } } }]);
  }

  /** Debug mode: teleport to another level (^V), by number or name ("minetown", "oracle"). */
  levelTeleport(level: string): Promise<HeadlessStepsResult> {
    this.requireDebug("level_teleport");
    return this.steps([{ keys: ["^v"] }, { expect: "text", action: { text: level } }]);
  }

  /** Debug mode: map the level (^F). */
  mapLevel(): Promise<HeadlessStepsResult> {
    this.requireDebug("map");
    return this.steps([{ keys: ["^f"] }]);
  }

  /** Walk to x, y with the travel command, choosing the target on its position prompt. */
  travel(x: number, y: number): Promise<HeadlessStepsResult> {
    return this.steps([{ keys: ["_"] }, { expect: "position", action: { position: { x, y } } }]);
  }

  private requireDebug(what: string): void {
    if (this.setup.playmode !== "debug") throw new Error(`${what} needs a game in debug mode (playmode "debug")`);
  }

  /**
   * Run steps in order. A step with expect runs only when that prompt is
   * open; otherwise the steps stop and the result shows where the game is.
   * Information windows and --More-- left at the end are dismissed.
   */
  private async steps(plan: Array<AgentAction | { expect: string; action: AgentAction }>): Promise<HeadlessStepsResult> {
    const messages: AgentMessage[] = [];
    let turns = 0, steps = 0;
    let last: AgentActResult | null = null;
    const statusChanges: AgentActResult["statusChanges"] = {};
    const run = async (action: AgentAction) => {
      last = await this.act(action);
      steps++;
      messages.push(...last.messages);
      turns += last.turnsElapsed ?? 0;
      for (const [key, change] of Object.entries(last.statusChanges)) {
        statusChanges[key] = { from: statusChanges[key]?.from ?? change.from, to: change.to };
      }
    };
    for (const step of plan) {
      if ("expect" in step) {
        const kind = (last as AgentActResult | null)?.prompt.kind ?? this.session.prompt().kind;
        if (kind !== step.expect) break;
        await run(step.action);
      } else {
        await run(step);
      }
    }
    for (let i = 0; i < 20 && last && ["more", "info"].includes((last as AgentActResult).prompt.kind); i++) await run({ dismiss: true });
    const final = last as AgentActResult | null;
    return {
      steps,
      settled: final?.settled ?? true,
      turnsElapsed: turns,
      messages,
      prompt: final?.prompt ?? this.session.prompt(),
      hero: final?.hero ?? this.session.peek().hero,
      statusChanges,
      gameOver: final?.gameOver ?? null,
    };
  }

  shutdown(): void { this.session.close(); this.node.shutdown(); }
}
