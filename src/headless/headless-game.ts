import { AgentSession, type AgentAction, type AgentActResult, type AgentObservation } from "./agent-session";
import { headlessClockForSeed, startNodeRuntime, type NodeRuntime } from "./node-runtime";
import type { RuntimeCharacterCreationConfig } from "../runtime/types";

export interface HeadlessGameOptions {
  /** Directory holding nethack-5.js and nethack-5.wasm. */
  publicDir: string;
  /** Same seed and same actions give the same game. Default 0. */
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
  verbose?: boolean;
}

// Fixed choices that keep a headless game free of interactive surprises and
// keep key handling simple (counts are plain digits when number_pad is off).
const HEADLESS_OPTIONS = ["!tutorial", "number_pad:0", "!autopickup", "!legacy"];

/** One game in this thread: start(), then observe() and act() until it ends. */
export class HeadlessGame {
  private constructor(private readonly node: NodeRuntime, readonly session: AgentSession, readonly seed: number) {}

  static async start(options: HeadlessGameOptions): Promise<HeadlessGame> {
    const seed = options.seed ?? 0;
    // The core lets only the player named "wizard" into debug mode (bootstrap's sysconf: WIZARDS=wizard).
    if (options.playmode === "debug" && options.name !== undefined && options.name !== "wizard") throw new Error('Debug mode needs the name "wizard"');
    const name = options.playmode === "debug" ? "wizard" : options.name ?? "Agent";
    const character: RuntimeCharacterCreationConfig = { mode: "random", name };
    const chosen = [options.role, options.race, options.gender, options.align];
    if (chosen.some(value => value !== undefined)) {
      if (chosen.some(value => typeof value !== "string" || !value)) throw new Error("Give role, race, gender and align together");
      Object.assign(character, { mode: "create", role: options.role, race: options.race, gender: options.gender, align: options.align });
    }
    const extra = options.options ?? [];
    for (const token of extra) {
      if (typeof token !== "string" || !/^!?[a-z_]+(?::[^,]*)?$/i.test(token)) throw new Error(`Invalid option "${token}"`);
    }
    const initOptions = [
      ...HEADLESS_OPTIONS,
      ...extra.filter(token => !/^!?number_pad\b/i.test(token)),
      ...(options.playmode && options.playmode !== "normal" ? [`playmode:${options.playmode}`] : []),
    ];
    const session = new AgentSession();
    const node = await startNodeRuntime({
      publicDir: options.publicDir,
      clockMs: headlessClockForSeed(seed),
      verbose: options.verbose,
      startupOptions: { runtimeVersion: "5.0", characterCreation: character, initOptions },
      onEvent: event => session.handle(event),
    });
    session.attach({
      sendInput: (input, identity) => node.runtime.sendInput(input, identity),
      sendInputSequence: (inputs, identity) => node.runtime.sendInputSequence(inputs, identity),
      isMultiSelectMenuActive: () => node.runtime.isMultiSelectMenuActive(),
    });
    const game = new HeadlessGame(node, session, seed);
    if (!(await session.settle())) {
      game.shutdown();
      throw new Error("The game did not reach its first input request");
    }
    return game;
  }

  observe(options?: { map?: boolean }): AgentObservation { return this.session.observe(options); }
  act(action: AgentAction, timeoutMs?: number): Promise<AgentActResult> { return this.session.act(action, timeoutMs); }
  inventory() { return this.session.inventoryView(); }
  shutdown(): void { this.session.close(); this.node.shutdown(); }
}
