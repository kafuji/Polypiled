import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";

/**
 * A runnable tool for the SDK's tool runner, the same object the SDK's
 * betaTool() helper makes (Vite cannot resolve that helper's subpath). The
 * runner passes the model's input through unchanged; the session checks
 * every action it is given.
 */
function defineTool<Input>(options: {
  name: string;
  description: string;
  inputSchema: { type: "object"; [key: string]: unknown };
  run: (input: Input) => Promise<string>;
}): BetaRunnableTool<Input> {
  return {
    type: "custom",
    name: options.name,
    description: options.description,
    input_schema: options.inputSchema,
    run: options.run,
    parse: (content: unknown) => content as Input,
  } as BetaRunnableTool<Input>;
}
import type { AgentAction, AgentActResult } from "../../agent/agent-session";
import { formatForModel } from "../../agent/agent-format";
import type { AgentHost } from "./agent-host";

/**
 * Polypiled: the tools the playing agent calls. They act on the game on
 * screen through the AgentHost, one action at a time at the host's pace.
 */

const direction = { type: "string", enum: ["n", "ne", "e", "se", "s", "sw", "w", "nw", "up", "down", "self"] } as const;
const itemRef = {
  type: "object",
  properties: { id: { type: "integer", minimum: 1 }, count: { type: "integer", minimum: 1 } },
  required: ["id"],
  additionalProperties: false,
} as const;

/** One action; exactly one of the fields (count goes with move). */
const actionSchema = {
  type: "object",
  description: "Exactly one of: move (with optional count), keys, extended, answer, select, text, position, inventory, dismiss.",
  properties: {
    move: { ...direction, description: "Walk or attack one step; at a direction or position prompt, answers it" },
    count: { type: "integer", minimum: 1, maximum: 999, description: "Repeat the move (stops when something interesting happens)" },
    keys: {
      type: "array", minItems: 1, maxItems: 16,
      items: { type: "string" },
      description: 'Raw keys: one character, "Enter", "Escape", "^x" for Ctrl, "M-x" for Meta. E.g. ["s"] to search, ["2","0","s"] to search 20 times, [","] to pick up, [">"] to go down',
    },
    extended: { type: "string", description: "An extended command name, e.g. pray, loot, offer, chat, force, enhance" },
    answer: { type: "string", description: "One key for a y/n, direction or position prompt" },
    select: {
      type: "array", maxItems: 64,
      items: {
        type: "object",
        properties: { index: { type: "integer", minimum: 0 }, count: { type: "integer", minimum: 1 } },
        required: ["index"], additionalProperties: false,
      },
      description: "Menu items by prompt.items[].index; several only when prompt.multi",
    },
    text: { type: "string", maxLength: 255, description: "The answer to a text prompt" },
    position: {
      type: "object",
      properties: { x: { type: "integer", minimum: 1, maximum: 79 }, y: { type: "integer", minimum: 0, maximum: 20 } },
      required: ["x", "y"], additionalProperties: false,
      description: "Pick this square on a position prompt",
    },
    inventory: {
      type: "object",
      description: "A whole item action, answered by the game itself: wear/takeoff/puton/remove/wield/quiver/alternate (item letter), swap, twoweapon, adjust (from, to), pickup/drop (items by object id), loot (container id, out, in)",
      properties: {
        op: { type: "string", enum: ["wear", "takeoff", "remove", "puton", "wield", "quiver", "alternate", "swap", "twoweapon", "altunwield", "sort", "adjust", "pickup", "drop", "loot"] },
        item: { type: "string", maxLength: 1 },
        hand: { type: "string", enum: ["left", "right"] },
        from: { type: "string", maxLength: 1 },
        to: { type: "string", maxLength: 1 },
        items: { type: "array", items: itemRef, maxItems: 64 },
        container: { type: "integer", minimum: 1 },
        out: { type: "array", items: itemRef, maxItems: 64 },
        in: { type: "array", items: itemRef, maxItems: 64 },
      },
      required: ["op"],
      additionalProperties: false,
    },
    dismiss: { type: "boolean", enum: [true], description: "Close the prompt: Enter for info/more, Escape otherwise" },
  },
  additionalProperties: false,
} as const;

interface StepReport {
  action: AgentAction;
  turns?: number | null;
  messages?: string[];
  prompt?: string;
  status?: Record<string, string>;
  error?: string;
}

const promptAnswers = new Set(["answer", "select", "text", "dismiss", "position", "keys"]);

/** Whether to stop a batch after this result before running the next action. */
function interruption(result: AgentActResult, next: AgentAction | undefined): string | null {
  if (result.gameOver?.over) return "the game is over";
  const hp = result.statusChanges.hp;
  if (hp && Number(hp.to) < Number(hp.from)) return "you lost hit points";
  if (next && result.prompt.kind !== "command" && !Object.keys(next).some(key => promptAnswers.has(key))) {
    return `the game asks something (${result.prompt.kind})`;
  }
  return null;
}

export interface AgentToolCallbacks {
  /** Something the agent did, for the spectators' log. */
  onStep(report: StepReport): void;
  onNotes(text: string): void;
}

export function createAgentTools(host: AgentHost, callbacks: AgentToolCallbacks) {
  const observe = defineTool<{ map?: boolean }>({
    name: "observe",
    description: "Look at the game now: turn, the open prompt (what the game waits for), hero position, level, status line, unread messages, monsters you perceive, what is here, and the map. Call this first, after the player has played, and whenever you are unsure.",
    inputSchema: {
      type: "object",
      properties: { map: { type: "boolean", description: "Include the map (default true)" } },
      additionalProperties: false,
    },
    run: async input => {
      await host.settle();
      return formatForModel(host.observe({ map: input.map !== false }));
    },
  });

  const act = defineTool<{ actions: AgentAction[]; map?: boolean }>({
    name: "act",
    description: "Do up to 10 actions in order, each waiting until the game waits for input again. The batch stops early when you lose hit points, when the game asks something the next action does not answer, on an error, or when the player takes over. Returns what each action caused and, by default, the map afterwards. Prefer short batches in danger and longer ones while exploring.",
    inputSchema: {
      type: "object",
      properties: {
        actions: { type: "array", items: actionSchema, minItems: 1, maxItems: 10 },
        map: { type: "boolean", description: "Include the map after the batch (default true)" },
      },
      required: ["actions"],
      additionalProperties: false,
    },
    run: async input => {
      const actions = Array.isArray(input.actions) ? input.actions : [];
      const steps: StepReport[] = [];
      let stopped: string | null = null;
      for (let i = 0; i < actions.length && !stopped; i++) {
        const action = actions[i];
        try {
          const result = await host.act(action);
          if ("playerPlayed" in result) {
            stopped = "the player played while you were paused; observe before acting again";
            break;
          }
          const step: StepReport = {
            action,
            turns: result.turnsElapsed,
            messages: result.messages.map(message => message.text),
            prompt: result.prompt.kind,
            ...(Object.keys(result.statusChanges).length
              ? { status: Object.fromEntries(Object.entries(result.statusChanges).map(([key, change]) => [key, change.to])) }
              : {}),
          };
          steps.push(step);
          callbacks.onStep(step);
          stopped = interruption(result, actions[i + 1]);
        } catch (error) {
          const step = { action, error: error instanceof Error ? error.message : String(error) };
          if (error instanceof Error && error.name === "AgentStoppedError") throw error;
          steps.push(step);
          callbacks.onStep(step);
          stopped = "an action failed";
        }
      }
      const after = host.observe({ map: input.map !== false });
      return formatForModel({
        steps,
        ...(stopped ? { stoppedBecause: stopped } : {}),
        now: { turn: after.turn, prompt: after.prompt, hero: after.hero, status: after.status, monsters: after.monsters, here: after.here, gameOver: after.gameOver },
        unreadMessages: after.messages.map(message => message.text),
        ...(after.map ? { map: after.map } : {}),
      });
    },
  });

  const travel = defineTool<{ x: number; y: number }>({
    name: "travel",
    description: "Walk to the square x, y with the travel command, by a known path. The walk can stop early when something happens. Use it for long walks to seen places, such as stairs.",
    inputSchema: {
      type: "object",
      properties: { x: { type: "integer", minimum: 1, maximum: 79 }, y: { type: "integer", minimum: 0, maximum: 20 } },
      required: ["x", "y"],
      additionalProperties: false,
    },
    run: async input => {
      const start = await host.act({ keys: ["_"] });
      if ("playerPlayed" in start) return "The player played while you were paused; observe before acting again.";
      if (start.prompt.kind !== "position") return formatForModel({ error: "travel did not ask for a position", prompt: start.prompt, messages: start.messages.map(m => m.text) });
      const walked = await host.act({ position: { x: input.x, y: input.y } });
      if ("playerPlayed" in walked) return "The player played while you were paused; observe before acting again.";
      callbacks.onStep({ action: { position: { x: input.x, y: input.y } }, turns: walked.turnsElapsed, messages: walked.messages.map(m => m.text), prompt: walked.prompt.kind });
      return formatForModel({ turns: walked.turnsElapsed, messages: walked.messages.map(m => m.text), prompt: walked.prompt, hero: walked.hero, status: walked.statusChanges });
    },
  });

  const inventory = defineTool<Record<string, never>>({
    name: "inventory",
    description: "Your inventory as the game knows it (object id, letter, name, class, quantity, known blessed/cursed state, enchantment, charges, worn), weight, capacity and encumbrance, and what lies here with object ids. Takes no game time.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => JSON.stringify(host.inventory()),
  });

  const notes = defineTool<{ text: string }>({
    name: "notes",
    description: "Replace your notes: your plan, what you know about this game (where things are, dangers, identified items). The people watching see them, and they help you keep track. Keep them short.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", maxLength: 2000 } },
      required: ["text"],
      additionalProperties: false,
    },
    run: async input => {
      callbacks.onNotes(input.text);
      return "Notes saved.";
    },
  });

  return [observe, act, travel, inventory, notes];
}
