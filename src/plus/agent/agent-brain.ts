import Anthropic from "@anthropic-ai/sdk";
import type { AgentHost } from "./agent-host";
import { createAgentTools, type AgentToolCallbacks } from "./agent-tools";
import { advisorSystemPrompt, playerSystemPrompt, resumeMessage, startMessage } from "./agent-prompts";

/**
 * Polypiled: the in-game agent's calls to the Claude API.
 *
 * AgentPlayer plays: a tool runner loop whose tools act on the game on
 * screen. The conversation is kept across pauses, so handing the game back
 * goes on from where the agent was; it is summarized (compaction) when it
 * grows long. askAdvisor answers the player's #askagent questions, with the
 * hero's current knowledge attached to each question.
 *
 * The API key is the player's own and stays in this browser; requests go
 * from here straight to the Claude API.
 */

export const agentModels = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export type AgentModel = (typeof agentModels)[number];
export const agentEfforts = ["low", "medium", "high"] as const;
export type AgentEffort = (typeof agentEfforts)[number];

export interface AgentSettings {
  apiKey: string;
  model: AgentModel;
  effort: AgentEffort;
  /** The language the agent writes in, e.g. "Japanese". */
  language: string;
  /** Stop playing once the estimated cost of this play reaches this many dollars. */
  budgetUsd: number;
}

/** US dollars per million tokens (list prices of the Claude API; an estimate, not a bill). */
const prices: Record<AgentModel, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export interface AgentUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export const emptyUsage = (): AgentUsage => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });

type UsageLike = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  iterations?: Array<UsageLike & { type?: string }> | null;
};

/** Adds a response's usage; compaction and fallback runs are listed in usage.iterations. */
export function addUsage(total: AgentUsage, usage: UsageLike | null | undefined, model: AgentModel): AgentUsage {
  if (!usage) return total;
  const parts = usage.iterations?.length ? usage.iterations : [usage];
  const next = { ...total, requests: total.requests + 1 };
  const price = prices[model];
  for (const part of parts) {
    const input = part.input_tokens ?? 0, output = part.output_tokens ?? 0;
    const read = part.cache_read_input_tokens ?? 0, write = part.cache_creation_input_tokens ?? 0;
    next.inputTokens += input;
    next.outputTokens += output;
    next.cacheReadTokens += read;
    next.cacheWriteTokens += write;
    next.costUsd += (input * price.input + output * price.output + read * price.cacheRead + write * price.cacheWrite) / 1e6;
  }
  return next;
}

/** Summarize the conversation once a request reads this many tokens. */
const COMPACT_AT_INPUT_TOKENS = 80_000;
/** Turns in a row the model may end without a tool call before the agent stops. */
const MAX_IDLE_TURNS = 2;

export type AgentClientFactory = (settings: AgentSettings) => Anthropic;

const defaultClient: AgentClientFactory = settings =>
  new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });

/** Server-side fallbacks on a refusal, for the models that have them (not Haiku 5.5). */
function fallbackParams(model: AgentModel) {
  return model === "claude-haiku-5-5" ? { betas: [] as string[] } : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

/** A message the player can read, for the errors that need their action. */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return "The API key was not accepted.";
  if (error instanceof Anthropic.PermissionDeniedError) return "The API key may not use this model.";
  if (error instanceof Anthropic.RateLimitError) return "The Claude API is rate limiting requests; try again shortly.";
  if (error instanceof Anthropic.APIConnectionError) return "Could not reach the Claude API.";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status ?? ""}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export type AgentEnd = "stopped" | "game_over" | "budget" | "refusal" | "idle" | "error";

export interface AgentPlayerCallbacks extends AgentToolCallbacks {
  onText(text: string): void;
  onThinking(text: string): void;
  onUsage(usage: AgentUsage): void;
  onEnd(reason: AgentEnd, detail?: string): void;
}

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** Every tool call must be answered: close calls a stop left open. */
function answerOpenToolCalls(messages: MessageParam[]): MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant" || typeof last.content === "string") return messages;
  const open = last.content.filter(block => block.type === "tool_use") as Array<{ id: string }>;
  if (!open.length) return messages;
  return [...messages, {
    role: "user",
    content: open.map(block => ({ type: "tool_result" as const, tool_use_id: block.id, content: "Stopped: the player took over.", is_error: true })),
  }];
}

export class AgentPlayer {
  private messages: MessageParam[] = [];
  private abort: AbortController | null = null;
  private usage = emptyUsage();
  private running = false;

  constructor(
    private readonly host: AgentHost,
    private readonly callbacks: AgentPlayerCallbacks,
    private readonly createClient: AgentClientFactory = defaultClient,
  ) {}

  get isRunning(): boolean { return this.running; }

  /** Forget the conversation (a new game). */
  reset(): void {
    this.stop();
    this.messages = [];
    this.usage = emptyUsage();
    this.callbacks.onUsage(this.usage);
  }

  stop(): void { this.abort?.abort(); }

  /** Play until stopped, the game ends, the budget is spent, or the model stops. */
  async play(settings: AgentSettings): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const anthropic = this.createClient(settings);
    const tools = createAgentTools(this.host, this.callbacks);
    const fallback = fallbackParams(settings.model);
    let end: AgentEnd = "stopped";
    let detail: string | undefined;
    let idleTurns = 0;
    this.messages = answerOpenToolCalls(this.messages);
    this.messages.push({ role: "user", content: this.messages.length ? resumeMessage() : startMessage() });
    try {
      while (!signal.aborted) {
        const runner = anthropic.beta.messages.toolRunner({
          model: settings.model,
          max_tokens: 16000,
          thread: false,
          system: [{ type: "text", text: playerSystemPrompt(settings.language), cache_control: { type: "ephemeral" } }],
          cache_control: { type: "ephemeral" },
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: settings.effort },
          tools,
          messages: this.messages,
          betas: ["compact-2026-09-04", ...fallback.betas],
          ...("fallbacks" in fallback ? { fallbacks: fallback.fallbacks } : {}),
        }, { signal });
        let last: Anthropic.Beta.Messages.BetaMessage | null = null;
        for await (const message of runner) {
          last = message;
          this.usage = addUsage(this.usage, message.usage, settings.model);
          this.callbacks.onUsage(this.usage);
          for (const block of message.content) {
            if (block.type === "text" && block.text.trim()) this.callbacks.onText(block.text.trim());
            if (block.type === "thinking" && block.thinking.trim()) this.callbacks.onThinking(block.thinking.trim());
          }
          if (message.stop_reason === "refusal") { end = "refusal"; break; }
          if (this.usage.costUsd >= settings.budgetUsd) { end = "budget"; break; }
          if (this.host.peek().prompt.kind === "game_over") { end = "game_over"; break; }
          const read = (message.usage.input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
          if (read > COMPACT_AT_INPUT_TOKENS) runner.compactBeforeNextTurn();
        }
        this.messages = [...runner.params.messages] as MessageParam[];
        if (last && !this.messages.some(message => message.role === "assistant" && message.content === last!.content)) {
          this.messages.push({ role: "assistant", content: last.content } as unknown as MessageParam);
        }
        if (end !== "stopped" || signal.aborted || this.host.control !== "agent") break;
        // The model ended its turn without a tool call: nudge it on, a little.
        if (++idleTurns > MAX_IDLE_TURNS) { end = "idle"; break; }
        this.messages.push({ role: "user", content: "Keep playing: decide the next action and call a tool." });
      }
    } catch (error) {
      if (!signal.aborted && !(error instanceof Error && error.name === "AgentStoppedError")) {
        end = "error";
        detail = describeApiError(error);
      }
    } finally {
      this.messages = answerOpenToolCalls(this.messages);
      this.running = false;
      this.abort = null;
      this.callbacks.onEnd(end, detail);
    }
  }
}

export interface AdvisorTurn { question: string; answer: string }

/** One #askagent answer, streamed; earlier turns of this chat give it context. */
export async function askAdvisor(
  settings: AgentSettings,
  history: AdvisorTurn[],
  question: string,
  state: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  createClient: AgentClientFactory = defaultClient,
): Promise<{ answer: string; usage: AgentUsage }> {
  const anthropic = createClient(settings);
  const fallback = fallbackParams(settings.model);
  const messages: MessageParam[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question }, { role: "assistant", content: turn.answer });
  }
  messages.push({ role: "user", content: [
    { type: "text", text: `What my character sees and knows now:\n${state}` },
    { type: "text", text: question },
  ] });
  const stream = anthropic.beta.messages.stream({
    model: settings.model,
    max_tokens: 8000,
    system: [{ type: "text", text: advisorSystemPrompt(settings.language), cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    output_config: { effort: settings.effort },
    messages,
    betas: fallback.betas,
    ...("fallbacks" in fallback ? { fallbacks: fallback.fallbacks } : {}),
  }, { signal });
  stream.on("text", onDelta);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude declined to answer this question.");
  const answer = message.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("").trim();
  return { answer, usage: addUsage(emptyUsage(), message.usage, settings.model) };
}
