import { AgentSession, type AgentAction, type AgentActResult, type AgentObservation, type AgentPrompt } from "../../agent/agent-session";
import type { Nethack3DEngineController } from "../../game/ui-types";

/**
 * Polypiled: the AI agent's hold on the game on screen.
 *
 * An AgentSession follows the live game through the engine's agent tap (the
 * same runtime events the screen is drawn from), and its actions go to the
 * worker as targeted inputs. The game, the screen and the saves stay as they
 * are; the agent is one more player at the keyboard.
 *
 * Who plays is the control: "human" (the agent waits), "agent" (it acts), or
 * "paused". Any key, click or touch of the player's on the game while the
 * agent plays hands the game back at once, and the agent is told the player
 * played before it may go on.
 */

export type AgentControl = "human" | "agent" | "paused";

export interface AgentHostEvents {
  onControlChange(control: AgentControl, reason: "player" | "agent" | "ui"): void;
  /** The player typed #askagent. */
  onAskAgent(): void;
  /** A new game started (the session was reset). */
  onNewGame(): void;
}

export class AgentStoppedError extends Error {
  constructor() {
    super("The agent was stopped");
    this.name = "AgentStoppedError";
  }
}

// Things the agent never does on its own: ending or saving the game.
const forbiddenExtended = new Set(["quit", "save", "exploremode"]);
const forbiddenCommandKeys = new Set(["S", "__CTRL__:c"]);

export class AgentHost {
  private session = new AgentSession();
  private removeTap: (() => void) | null = null;
  private answering: { requestId: number; kind: AgentPrompt["kind"] } | null = null;
  private controlState: AgentControl = "human";
  private resumeWaiters: Array<(go: boolean) => void> = [];
  private playerPlayedWhilePaused = false;
  private readonly removeListeners: Array<() => void> = [];
  /** Milliseconds between the agent's actions, so that people can follow. */
  stepDelayMs = 400;

  constructor(private readonly engine: Nethack3DEngineController, private readonly events: AgentHostEvents) {
    this.attachSession();
    this.removeTap = engine.addAgentTap(event => this.onRuntimeEvent(event));
    this.watchPlayerInput();
  }

  get control(): AgentControl { return this.controlState; }

  dispose(): void {
    this.removeTap?.();
    this.removeTap = null;
    for (const remove of this.removeListeners.splice(0)) remove();
    this.wake(false);
    this.session.close();
  }

  private attachSession(): void {
    this.session.attach({
      send: (inputs, requestId, prompt) => {
        this.answering = { requestId, kind: prompt.kind };
        const commandId = this.engine.sendAgentInputs(inputs, requestId);
        if (commandId === null) this.answering = null;
        return commandId;
      },
    });
  }

  private onRuntimeEvent(event: { type: string; [key: string]: unknown }): void {
    if (event.type === "agent_runtime_started") {
      this.session.close();
      this.session = new AgentSession();
      this.attachSession();
      this.answering = null;
      this.events.onNewGame();
      return;
    }
    if (event.type === "ask_agent") this.events.onAskAgent();
    // The request the agent answered has closed: close its dialog now,
    // before the engine shows whatever comes next.
    const answering = this.answering;
    if (answering && event.type === "input_wait" && event.state !== "waiting" && answering.requestId === event.requestId) {
      this.engine.closeAgentAnsweredPrompt(answering.kind);
      this.answering = null;
    }
    this.session.handle(event);
  }

  // --- control ---------------------------------------------------------------

  setControl(control: AgentControl, reason: "player" | "agent" | "ui" = "ui"): void {
    if (control === this.controlState) return;
    this.controlState = control;
    if (control === "agent") this.wake(true);
    if (control === "human") this.wake(false);
    this.events.onControlChange(control, reason);
  }

  private wake(go: boolean): void {
    for (const waiter of this.resumeWaiters.splice(0)) waiter(go);
  }

  /** Resolves when the agent may act; throws AgentStoppedError if the game was handed to the player. */
  private async waitForTurn(): Promise<void> {
    while (this.controlState !== "agent") {
      if (this.controlState === "human") throw new AgentStoppedError();
      const go = await new Promise<boolean>(resolve => this.resumeWaiters.push(resolve));
      if (!go) throw new AgentStoppedError();
    }
  }

  /** The player touched the game: take it back from the agent. */
  private watchPlayerInput(): void {
    if (typeof window === "undefined") return;
    const onPlayerInput = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[data-agent-panel]")) return; // the agent's own controls
      if (event instanceof KeyboardEvent && ["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
      if (this.controlState === "agent") this.setControl("paused", "player");
      if (this.controlState === "paused") this.playerPlayedWhilePaused = true;
    };
    for (const type of ["keydown", "pointerdown", "wheel"] as const) {
      window.addEventListener(type, onPlayerInput, { capture: true });
      this.removeListeners.push(() => window.removeEventListener(type, onPlayerInput, { capture: true }));
    }
  }

  // --- what the agent tools call ----------------------------------------------

  observe(options?: { map?: boolean }): AgentObservation { return this.session.observe(options); }

  peek() { return this.session.peek(); }

  /** What the hero can see and knows now, for the advisor; reads no messages. */
  snapshot(): AgentObservation { return this.session.snapshot(); }

  inventory() { return this.session.inventoryView(); }

  async settle(): Promise<boolean> { return this.session.settle(); }

  /**
   * One action of the agent's, at its pace. Waits while the game is paused,
   * refuses to end or save the game, and reports when the player played in
   * between so that the agent looks again before going on.
   */
  async act(action: AgentAction): Promise<AgentActResult | { playerPlayed: true }> {
    await this.waitForTurn();
    if (this.playerPlayedWhilePaused) {
      this.playerPlayedWhilePaused = false;
      return { playerPlayed: true };
    }
    this.refuseForbidden(action);
    if (this.stepDelayMs > 0) await new Promise(resolve => setTimeout(resolve, this.stepDelayMs));
    await this.waitForTurn();
    const result = await this.session.act(action);
    this.engine.closeAgentTransientDialogs();
    return result;
  }

  private refuseForbidden(action: AgentAction): void {
    const prompt = this.session.prompt();
    if ("extended" in action && forbiddenExtended.has(action.extended.toLowerCase())) {
      throw new Error(`#${action.extended} is the player's decision, not the agent's`);
    }
    if ("keys" in action && prompt.kind === "command" && action.keys.length > 0) {
      const first = action.keys[0] === "^c" || action.keys[0] === "^C" ? "__CTRL__:c" : action.keys[0];
      if (forbiddenCommandKeys.has(first)) throw new Error("Saving or quitting is the player's decision, not the agent's");
      if (action.keys[0] === "#") throw new Error("Use extended for extended commands");
    }
  }
}
