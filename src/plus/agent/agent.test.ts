import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { AgentHost, AgentStoppedError } from "./agent-host";
import { AgentPlayer, addUsage, emptyUsage, type AgentEnd, type AgentSettings } from "./agent-brain";
import type { Nethack3DEngineController } from "../../game/ui-types";

type Event = { type: string; [key: string]: unknown };

/** A pretend game: each action takes one turn and the game asks for the next command. */
class FakeGame {
  tap: ((event: Event) => void) | null = null;
  sent: string[][] = [];
  closed: string[] = [];
  private wait = 0;
  private commandId = 0;
  turn = 1;

  readonly engine = {
    addAgentTap: (tap: (event: Event) => void) => { this.tap = tap; return () => { this.tap = null; }; },
    sendAgentInputs: (inputs: string[], requestId: number) => {
      const commandId = ++this.commandId;
      this.sent.push(inputs);
      queueMicrotask(() => {
        this.emit({ type: "input_consumed", commandId, requestId });
        this.emit({ type: "input_wait", requestId, state: "consumed", purpose: "command-or-position", callback: "shim_nh_poskey" });
        this.turn++;
        this.emit({ type: "status_update", fieldName: "BL_TIME", value: String(this.turn) });
        this.emit({ type: "text", text: `You search (${inputs.join("")}).` });
        this.ready();
      });
      return commandId;
    },
    closeAgentAnsweredPrompt: (kind: string) => { this.closed.push(kind); },
    closeAgentTransientDialogs: () => {},
  } as unknown as Nethack3DEngineController;

  emit(event: Event): void { this.tap?.(event); }

  ready(): void {
    this.emit({ type: "command_ready", turn: this.turn, x: 10, y: 5 });
    this.emit({ type: "input_wait", requestId: ++this.wait, state: "waiting", purpose: "command-or-position", callback: "shim_nh_poskey" });
  }
}

const quietEvents = { onControlChange: () => {}, onAskAgent: () => {}, onNewGame: () => {} };

function hostWithGame() {
  const game = new FakeGame();
  const host = new AgentHost(game.engine, quietEvents);
  host.stepDelayMs = 0;
  game.emit({ type: "status_update", fieldName: "BL_TIME", value: "1" });
  game.ready();
  return { game, host };
}

describe("AgentHost", () => {
  it("acts only while the agent has the game", async () => {
    const { game, host } = hostWithGame();
    await expect(host.act({ keys: ["s"] })).rejects.toBeInstanceOf(AgentStoppedError);
    host.setControl("agent");
    const result = await host.act({ keys: ["s"] });
    expect("playerPlayed" in result).toBe(false);
    expect(game.sent).toEqual([["s"]]);
    expect(game.closed).toEqual(["command"]); // the answered request's prompt is closed when it closes
  });

  it("waits while paused and goes on when resumed", async () => {
    const { game, host } = hostWithGame();
    host.setControl("paused");
    let done = false;
    const acting = host.act({ keys: ["s"] }).then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(done).toBe(false);
    expect(game.sent).toEqual([]);
    host.setControl("agent");
    await acting;
    expect(game.sent).toEqual([["s"]]);
  });

  it("stops a waiting action when the player takes the game", async () => {
    const { host } = hostWithGame();
    host.setControl("paused");
    const acting = host.act({ keys: ["s"] });
    host.setControl("human");
    await expect(acting).rejects.toBeInstanceOf(AgentStoppedError);
  });

  it("leaves saving and quitting to the player", async () => {
    const { host } = hostWithGame();
    host.setControl("agent");
    await expect(host.act({ extended: "quit" })).rejects.toThrow(/player's decision/);
    await expect(host.act({ keys: ["S"] })).rejects.toThrow(/player's decision/);
  });

  it("starts a fresh session for a new game", async () => {
    let newGames = 0;
    const game = new FakeGame();
    const host = new AgentHost(game.engine, { ...quietEvents, onNewGame: () => { newGames++; } });
    game.emit({ type: "agent_runtime_started" });
    expect(newGames).toBe(1);
    game.ready();
    host.stepDelayMs = 0;
    host.setControl("agent");
    await host.act({ keys: ["s"] });
    expect(game.sent).toEqual([["s"]]);
  });

  it("passes #askagent on", () => {
    let asked = 0;
    const game = new FakeGame();
    new AgentHost(game.engine, { ...quietEvents, onAskAgent: () => { asked++; } });
    game.emit({ type: "ask_agent" });
    expect(asked).toBe(1);
  });
});

describe("usage", () => {
  it("prices tokens per model and counts compaction and fallback runs", () => {
    const one = addUsage(emptyUsage(), { input_tokens: 1_000_000, output_tokens: 0 }, "claude-opus-5-5");
    expect(one.costUsd).toBeCloseTo(4);
    const iterations = addUsage(emptyUsage(), { input_tokens: 0, output_tokens: 0, iterations: [
      { type: "compaction", input_tokens: 1_000_000, output_tokens: 0 },
      { type: "message", input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 },
    ] }, "claude-sonnet-5-5");
    expect(iterations.costUsd).toBeCloseTo(2 + 10 + 0.1);
  });
});

/** Claude API replies in order; records each request body. */
function fakeClaude(replies: Array<{ content: unknown[]; stop_reason: string }>) {
  const requests: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
  let next = 0;
  const fetch = async (_url: unknown, init?: { body?: unknown; headers?: unknown }) => {
    requests.push({ body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers as HeadersInit) });
    const reply = replies[Math.min(next++, replies.length - 1)];
    return new Response(JSON.stringify({
      id: `msg_${next}`, type: "message", role: "assistant", model: "claude-opus-5-5",
      content: reply.content, stop_reason: reply.stop_reason, stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const createClient = () => new Anthropic({ apiKey: "sk-ant-test", fetch: fetch as unknown as typeof globalThis.fetch, maxRetries: 0 });
  return { requests, createClient };
}

const settings: AgentSettings = { apiKey: "sk-ant-test", model: "claude-opus-5-5", effort: "medium", language: "English", budgetUsd: 5 };

describe("AgentPlayer", () => {
  it("plays through tool calls and stops when the model keeps ending its turn", async () => {
    const { game, host } = hostWithGame();
    host.setControl("agent");
    const { requests, createClient } = fakeClaude([
      { stop_reason: "tool_use", content: [{ type: "text", text: "Looking around." }, { type: "tool_use", id: "t1", name: "observe", input: {} }] },
      { stop_reason: "tool_use", content: [{ type: "text", text: "Searching." }, { type: "tool_use", id: "t2", name: "act", input: { actions: [{ keys: ["s"] }, { keys: ["s"] }] } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "Done for now." }] },
    ]);
    const texts: string[] = [];
    const steps: string[] = [];
    let end: AgentEnd | null = null;
    const player = new AgentPlayer(host, {
      onText: text => texts.push(text), onThinking: () => {}, onUsage: () => {},
      onStep: step => steps.push(JSON.stringify(step.action)), onNotes: () => {},
      onEnd: reason => { end = reason; },
    }, createClient);
    await player.play(settings);
    expect(end).toBe("idle");
    expect(game.sent).toEqual([["s"], ["s"]]);
    expect(steps).toEqual(['{"keys":["s"]}', '{"keys":["s"]}']);
    expect(texts.slice(0, 3)).toEqual(["Looking around.", "Searching.", "Done for now."]);
    const first = requests[0];
    expect(first.body.model).toBe("claude-opus-5-5");
    expect(first.body.fallbacks).toBe("default");
    expect(first.body.output_config).toEqual({ effort: "medium" });
    expect(String(first.headers.get("anthropic-beta"))).toMatch(/compact-2026-09-04/);
    expect(String(first.headers.get("anthropic-beta"))).toMatch(/server-side-fallback-2026-07-01/);
    // The act tool's result reaches the model, with the game's message.
    const toolResults = JSON.stringify(requests[2].body.messages);
    expect(toolResults).toMatch(/You search \(s\)/);
  });

  it("stops at the spending limit", async () => {
    const { host } = hostWithGame();
    host.setControl("agent");
    const { createClient } = fakeClaude([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "observe", input: {} }] },
    ]);
    let end: AgentEnd | null = null;
    const player = new AgentPlayer(host, {
      onText: () => {}, onThinking: () => {}, onUsage: () => {}, onStep: () => {}, onNotes: () => {},
      onEnd: reason => { end = reason; },
    }, createClient);
    await player.play({ ...settings, budgetUsd: 0.001 });
    expect(end).toBe("budget");
  });

  it("ends quietly when the player takes the game back", async () => {
    const { host } = hostWithGame();
    host.setControl("paused");
    const { createClient } = fakeClaude([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "act", input: { actions: [{ keys: ["s"] }] } }] },
      { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] },
    ]);
    let end: AgentEnd | null = null;
    const player = new AgentPlayer(host, {
      onText: () => {}, onThinking: () => {}, onUsage: () => {}, onStep: () => {}, onNotes: () => {},
      onEnd: reason => { end = reason; },
    }, createClient);
    const playing = player.play(settings);
    await new Promise(resolve => setTimeout(resolve, 30));
    host.setControl("human");
    player.stop();
    await playing;
    expect(end).toBe("stopped");
  });
});
