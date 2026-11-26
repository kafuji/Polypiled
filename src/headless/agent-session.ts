import type { RuntimeEvent } from "../runtime/types";
import type { RuntimeCommandIdentity, RuntimeInputPurpose } from "../runtime/protocol/types";
import type { KnowledgeFrame, KnowledgeHero, KnowledgeLevel, KnowledgeMonster } from "../runtime/knowledge";
import type { InventoryObject, InventoryState } from "../runtime/inventory-state";

/**
 * An agent's view of one game, built straight from runtime events (no UI).
 *
 * It follows the protocol's input waits: the game is "settled" when it waits
 * for input and nothing else is happening. act() sends one action against
 * the open wait and resolves once the game has settled again, with what the
 * action caused.
 *
 * Everything here is what the hero can know; it comes from the core's
 * knowledge frame, glances, structured inventory and the displayed map.
 */

export interface AgentRuntimePort {
  sendInput(input: string, identity: RuntimeCommandIdentity): void;
  sendInputSequence(inputs: string[], identity: RuntimeCommandIdentity): void;
  isMultiSelectMenuActive(): boolean;
}

export type AgentDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw" | "up" | "down" | "self";
export const agentDirections: readonly AgentDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw", "up", "down", "self"];

/** Exactly one field is used. */
export type AgentAction =
  | { keys: string[] }
  | { move: AgentDirection; count?: number }
  | { extended: string }
  | { answer: string }
  | { select: Array<{ index: number; count?: number }> }
  | { text: string }
  | { dismiss: true };

export interface AgentMenuItem {
  index: number;
  text: string;
  accelerator: string | null;
  isCategory: boolean;
  isSelectable: boolean;
}

export type AgentPrompt =
  | { kind: "command" }
  | { kind: "more"; text: string | null }
  | { kind: "yn"; text: string; choices: string; default: string }
  | { kind: "direction"; text: string }
  | { kind: "menu"; text: string; multi: boolean; items: AgentMenuItem[] }
  | { kind: "text"; text: string }
  | { kind: "info"; title: string; lines: string[] }
  | { kind: "position"; text: string; cursor: { x: number; y: number } | null }
  | { kind: "game_over" }
  | { kind: "none" };

export interface AgentMessage { seq: number; turn: number | null; text: string }

export interface AgentMonster {
  x: number; y: number; name: string | null; sense: string;
  pet: boolean; peaceful: boolean; health: string | null;
}

export interface AgentObservation {
  turn: number | null;
  prompt: AgentPrompt;
  hero: (Pick<KnowledgeHero, "x" | "y"> & { flags: string[] }) | null;
  level: (Pick<KnowledgeLevel, "dnum" | "dlevel" | "depth"> & { flags: string[] }) | null;
  status: Record<string, string>;
  messages: AgentMessage[];
  monsters: AgentMonster[];
  here: unknown;
  map?: AgentMap;
  gameOver: AgentGameOver | null;
}

export interface AgentMap { x0: number; y0: number; ruler: string; rows: string[] }
export interface AgentGameOver { over: boolean; score: number | null; lines: string[] }

export interface AgentActResult {
  settled: boolean;
  turnsElapsed: number | null;
  messages: AgentMessage[];
  prompt: AgentPrompt;
  hero: AgentObservation["hero"];
  statusChanges: Record<string, { from: string | null; to: string }>;
  gameOver: AgentGameOver | null;
}

interface OpenWait { id: number; purpose: RuntimeInputPurpose; callback: string }

const MENU_SELECT_PREFIX = "__MENU_SELECT__:";
const TEXT_INPUT_PREFIX = "__TEXT_INPUT__:";
const promptEventTypes = new Set(["question", "direction_question", "info_menu", "text_request", "position_request"]);
// Numpad names: the runtime turns them into the right key for either number_pad mode.
const directionKeys: Record<AgentDirection, string> = {
  n: "Numpad8", ne: "Numpad9", e: "Numpad6", se: "Numpad3",
  s: "Numpad2", sw: "Numpad1", w: "Numpad4", nw: "Numpad7",
  up: "<", down: ">", self: ".",
};
const ignoredStatusFields = new Set(["BL_FLUSH", "BL_RESET", "BL_CHARACTERISTICS"]);

/** "Enter", "Escape", one character, "^x" (Ctrl) or "M-x" (Meta), as the runtime takes them. */
export function toRuntimeKey(key: string): string {
  if (key === "Enter" || key === "Escape") return key;
  if (key === "Space") return " ";
  const ctrl = /^\^([A-Za-z])$/.exec(key) ?? /^C-([A-Za-z])$/.exec(key);
  if (ctrl) return `__CTRL__:${ctrl[1].toLowerCase()}`;
  const meta = /^M-([A-Za-z])$/.exec(key);
  if (meta) return `__META__:${meta[1].toLowerCase()}`;
  if (key.length === 1 && key >= " " && key <= "~") return key;
  throw new Error(`Unsupported key "${key}": use one printable character, Enter, Escape, ^x or M-x`);
}

export class AgentSession {
  readonly sessionId = `headless-${Math.random().toString(36).slice(2, 10)}`;
  private port: AgentRuntimePort | null = null;
  private eventCount = 0;
  private nextCommandId = 0;
  private readonly waits = new Map<number, OpenWait>();
  private readonly promptByWait = new Map<number, RuntimeEvent>();
  private positionActive = false;
  private positionCursor: { x: number; y: number } | null = null;
  private lastMessageText: string | null = null;
  private readonly messages: AgentMessage[] = [];
  private nextMessageSeq = 0;
  private readSeq = 0;
  private status: Record<string, string> = {};
  private frame: Pick<KnowledgeFrame, "turn" | "hero" | "level" | "monsters"> | null = null;
  private glance: Array<{ x: number; y: number; name: string; health: string | null; tame: boolean; peaceful: boolean }> = [];
  private here: unknown = null;
  private inventory: InventoryState | null = null;
  private readonly chars = new Map<number, string>();
  private levelKey: string | null = null;
  private gameOver: AgentGameOver | null = null;
  private terminated = false;
  private readonly rejected = new Set<number>();
  private readonly consumed = new Map<number, number>();
  private consumedTokens(commandId: number): number { return this.consumed.get(commandId) ?? 0; }
  private readonly settleWaiters: Array<() => void> = [];

  attach(port: AgentRuntimePort): void { this.port = port; }

  /** Stop accepting actions; the runtime behind it has been shut down. */
  close(): void { this.port = null; this.terminated = true; }

  /** Feed every runtime event, in order. */
  handle(event: RuntimeEvent): void {
    this.eventCount++;
    switch (event.type) {
      case "input_wait": {
        const id = event.requestId as number;
        if (event.state === "waiting") {
          this.waits.set(id, { id, purpose: event.purpose as RuntimeInputPurpose, callback: String(event.callback) });
        } else {
          this.waits.delete(id);
          this.promptByWait.delete(id);
        }
        break;
      }
      case "command_result":
        if (event.status === "rejected") this.rejected.add(event.commandId as number);
        break;
      case "input_consumed":
        if (typeof event.commandId === "number") this.consumed.set(event.commandId, (this.consumed.get(event.commandId) ?? 0) + 1);
        break;
      case "position_input_state":
        this.positionActive = event.active === true;
        if (!this.positionActive) this.positionCursor = null;
        break;
      case "position_cursor":
        if (Number.isSafeInteger(event.x) && Number.isSafeInteger(event.y)) this.positionCursor = { x: event.x as number, y: event.y as number };
        break;
      case "text":
      case "raw_print":
        this.addMessage(event.text);
        break;
      case "status_update":
        this.observeStatus(event);
        break;
      case "knowledge_frame":
        this.observeFrame(event.frame as KnowledgeFrame);
        break;
      case "monster_glance":
        this.glance = Array.isArray(event.monsters) ? event.monsters as typeof this.glance : [];
        break;
      case "floor_here":
        this.here = event.floorHere ?? null;
        break;
      case "inventory_state":
        this.inventory = (event.inventory as InventoryState) ?? null;
        break;
      case "clear_scene":
        this.chars.clear();
        break;
      case "map_glyph":
        this.observeGlyph(event);
        break;
      case "map_glyph_batch":
        if (Array.isArray(event.tiles)) for (const tile of event.tiles) this.observeGlyph(tile as RuntimeEvent);
        break;
      case "game_over_started":
        this.gameOver = { over: true, score: this.gameOver?.score ?? null, lines: this.gameOver?.lines ?? [] };
        break;
      case "game_over_score":
        this.gameOver = { over: true, score: typeof event.points === "number" ? event.points : null, lines: this.gameOver?.lines ?? [] };
        break;
      case "outrip":
        if (this.gameOver && Array.isArray(event.lines)) this.gameOver.lines = event.lines.map(String);
        break;
      case "runtime_terminated":
        this.terminated = true;
        break;
    }
    if (promptEventTypes.has(event.type)) {
      const waitId = event.inputRequestId;
      if (typeof waitId === "number") this.promptByWait.set(waitId, event);
      else if (event.type === "info_menu") {
        // Not blocking: the game shows it and carries on. Keep the text.
        if (typeof event.title === "string" && event.title) this.addMessage(event.title);
        if (Array.isArray(event.lines)) for (const line of event.lines) this.addMessage(line);
      }
    }
    if (this.settleWaiters.length) this.scheduleSettleCheck();
  }

  private addMessage(text: unknown): void {
    if (typeof text !== "string") return;
    const trimmed = text.replace(/\s+$/, "");
    if (!trimmed) return;
    this.lastMessageText = trimmed;
    this.messages.push({ seq: ++this.nextMessageSeq, turn: this.currentTurn(), text: trimmed });
    if (this.messages.length > 500) this.messages.shift();
  }

  /** The status line's turn counter (the time option is always on); the knowledge frame only arrives when the map changes. */
  private currentTurn(): number | null {
    const time = Number.parseInt(this.status.time ?? "", 10);
    return Number.isSafeInteger(time) ? time : this.frame?.turn ?? null;
  }

  private observeStatus(event: RuntimeEvent): void {
    const name = typeof event.fieldName === "string" ? event.fieldName : null;
    if (!name || ignoredStatusFields.has(name)) return;
    const key = name.replace(/^BL_/, "").toLowerCase();
    let value = event.value === null || event.value === undefined ? "" : String(event.value).trim();
    if (key === "condition") value = conditionNames(Number(value)).join(" ");
    // Symbols drawn as tiles arrive as \GXXXXXXXX glyph escapes ("\G0BC30F2E:0" for gold).
    else value = value.replace(/\\G[0-9A-Fa-f]{8}:?/g, "");
    if (value === "" && !(key in this.status)) return;
    this.status = { ...this.status, [key]: value };
  }

  private observeFrame(frame: KnowledgeFrame | undefined): void {
    if (!frame || !frame.hero || !frame.level) return;
    const key = `${frame.level.dnum}:${frame.level.dlevel}`;
    if (this.levelKey !== null && key !== this.levelKey) this.chars.clear();
    this.levelKey = key;
    this.frame = { turn: frame.turn, hero: frame.hero, level: frame.level, monsters: frame.monsters ?? [] };
  }

  private observeGlyph(tile: RuntimeEvent): void {
    const x = tile.x, y = tile.y;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return;
    const key = (y as number) * 256 + (x as number);
    if (tile.isRuntimeUndiscoveredClear === true) { this.chars.delete(key); return; }
    const char = typeof tile.char === "string" && tile.char.length ? tile.char : null;
    if (char === null || char === " ") this.chars.delete(key);
    else this.chars.set(key, char);
  }

  private openWait(): OpenWait | null {
    let latest: OpenWait | null = null;
    for (const wait of this.waits.values()) if (!latest || wait.id > latest.id) latest = wait;
    return latest;
  }

  get isSettled(): boolean { return this.terminated || this.openWait() !== null; }

  /** Resolves when the game waits for input and two event-loop turns pass without new events. */
  settle(timeoutMs = 15_000): Promise<boolean> {
    return new Promise(resolve => {
      let finished = false;
      const timer = setTimeout(() => { finished = true; resolve(this.isSettled); }, timeoutMs);
      const check = () => {
        if (finished) return;
        if (!this.isSettled) { this.settleWaiters.push(check); return; }
        const seen = this.eventCount;
        setImmediate(() => setImmediate(() => {
          if (finished) return;
          if (this.eventCount === seen && this.isSettled) { finished = true; clearTimeout(timer); resolve(true); }
          else check();
        }));
      };
      check();
    });
  }

  private scheduleSettleCheck(): void {
    const waiters = this.settleWaiters.splice(0);
    queueMicrotask(() => { for (const waiter of waiters) waiter(); });
  }

  prompt(): AgentPrompt {
    if (this.gameOver?.over && this.terminated) return { kind: "game_over" };
    const wait = this.openWait();
    if (!wait) return { kind: "none" };
    const event = this.promptByWait.get(wait.id);
    if (event) {
      const text = String(event.text ?? "");
      switch (event.type) {
        case "question": {
          const items = Array.isArray(event.menuItems) ? event.menuItems as Array<Record<string, unknown>> : [];
          if (items.length === 0) return { kind: "yn", text, choices: String(event.choices ?? ""), default: defaultChoice(event.default) };
          return {
            kind: "menu", text, multi: this.port?.isMultiSelectMenuActive() ?? false,
            items: items.map((item, index) => ({
              index,
              text: typeof item.text === "string" ? item.text : "",
              accelerator: typeof item.accelerator === "string" && item.accelerator ? item.accelerator : null,
              isCategory: item.isCategory === true,
              isSelectable: isSelectableMenuItem(item),
            })),
          };
        }
        case "direction_question": return { kind: "direction", text };
        case "text_request": return { kind: "text", text };
        case "info_menu": return { kind: "info", title: String(event.title ?? ""), lines: Array.isArray(event.lines) ? event.lines.map(String) : [] };
        case "position_request": return { kind: "position", text, cursor: this.positionCursor };
      }
    }
    if (wait.purpose === "command-or-position") {
      return this.positionActive ? { kind: "position", text: "", cursor: this.positionCursor } : { kind: "command" };
    }
    if (wait.purpose === "text") return { kind: "text", text: "" };
    return { kind: "more", text: this.lastMessageText };
  }

  private heroView(): AgentObservation["hero"] {
    const hero = this.frame?.hero;
    if (!hero) return null;
    const flagNames = ["blind", "hallucinating", "underwater", "swallowed", "buried", "levitating", "flying", "riding", "unseenSelf", "polymorphed"] as const;
    return { x: hero.x, y: hero.y, flags: flagNames.filter(name => hero[name]) };
  }

  /** Messages after the last call that returned messages (observe or act). */
  private unreadMessages(): AgentMessage[] {
    const unread = this.messages.filter(message => message.seq > this.readSeq);
    this.readSeq = this.nextMessageSeq;
    return unread;
  }

  observe(options: { map?: boolean } = {}): AgentObservation {
    const level = this.frame?.level;
    const levelFlags = level ? (["mines", "sokoban", "gehennom", "quest", "endgame", "inShop", "inTemple"] as const).filter(name => level[name]) : [];
    return {
      turn: this.currentTurn(),
      prompt: this.prompt(),
      hero: this.heroView(),
      level: level ? { dnum: level.dnum, dlevel: level.dlevel, depth: level.depth, flags: [...levelFlags] } : null,
      status: { ...this.status },
      messages: this.unreadMessages(),
      monsters: this.monsterView(),
      here: this.here,
      ...(options.map === false ? {} : { map: this.mapView() }),
      gameOver: this.gameOver,
    };
  }

  private monsterView(): AgentMonster[] {
    const monsters: readonly KnowledgeMonster[] = this.frame?.monsters ?? [];
    return monsters.filter(monster => !monster.hero).map(monster => {
      const seen = this.glance.find(entry => entry.x === monster.x && entry.y === monster.y);
      return {
        x: monster.x, y: monster.y, name: seen?.name ?? null, sense: monster.sense,
        pet: monster.pet, peaceful: monster.peaceful, health: seen?.health ?? null,
      };
    });
  }

  /** The displayed map, trimmed to what has been seen. Row labels are y; the ruler gives x mod 10. */
  mapView(): AgentMap {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const key of this.chars.keys()) {
      const x = key % 256, y = Math.floor(key / 256);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (!Number.isFinite(x0)) return { x0: 0, y0: 0, ruler: "", rows: [] };
    let ruler = "";
    for (let x = x0; x <= x1; x++) ruler += String(x % 10);
    const rows: string[] = [];
    for (let y = y0; y <= y1; y++) {
      let row = "";
      for (let x = x0; x <= x1; x++) row += this.chars.get(y * 256 + x) ?? " ";
      rows.push(`${String(y).padStart(2, "0")}|${row.replace(/\s+$/, "")}`);
    }
    return { x0, y0, ruler: `  |${ruler}`, rows };
  }

  inventoryView(): { available: boolean; weight?: number; capacity?: number; encumbrance?: number; items: unknown[]; floor: unknown[] } {
    const inventory = this.inventory;
    if (!inventory) return { available: false, items: [], floor: [] };
    return {
      available: true, weight: inventory.weight, capacity: inventory.capacity, encumbrance: inventory.encumbrance,
      items: inventory.objects.map(compactObject), floor: inventory.floor.map(compactObject),
    };
  }

  /** Send one action against the open wait, then wait for the game to settle. */
  async act(action: AgentAction, timeoutMs = 15_000): Promise<AgentActResult> {
    if (!this.port) throw new Error("Session is not attached to a runtime");
    if (this.terminated) throw new Error("The game has ended");
    if (!(await this.settle(timeoutMs))) throw new Error("The game is still busy; observe and try again");
    const wait = this.openWait()!;
    const prompt = this.prompt();
    const inputs = this.inputsFor(action, prompt);
    const turnBefore = this.currentTurn();
    const statusBefore = { ...this.status };
    const identity: RuntimeCommandIdentity = { sessionId: this.sessionId, commandId: ++this.nextCommandId, lastProcessedSequence: 0, requestId: wait.id };
    if (inputs.length === 1) this.port.sendInput(inputs[0], identity);
    else this.port.sendInputSequence(inputs, identity);
    if (this.rejected.has(identity.commandId)) throw new Error("The input request closed before the action was sent; observe and try again");
    // Done once the wait we answered closes, or once the game has read every
    // key we sent and gone quiet (a key that only toggles a menu entry leaves
    // the menu, and its wait, open). The quiet fallback covers keys the
    // runtime handles without reporting them.
    const settled = await new Promise<boolean>(resolve => {
      let expired = false;
      let lastCount = this.eventCount;
      let quietSince = performance.now();
      const deadline = setTimeout(() => { expired = true; resolve(false); }, timeoutMs);
      const poll = () => {
        if (expired) return;
        if (this.eventCount !== lastCount) { lastCount = this.eventCount; quietSince = performance.now(); }
        const answered = !this.waits.has(wait.id) || this.terminated
          || (this.consumedTokens(identity.commandId) >= inputs.length && this.eventCount === lastCount && performance.now() - quietSince > 5)
          || performance.now() - quietSince > 250;
        if (!answered) { setTimeout(poll, 1); return; }
        clearTimeout(deadline);
        this.settle(timeoutMs).then(resolve);
      };
      poll();
    });
    this.consumed.delete(identity.commandId);
    const statusChanges: AgentActResult["statusChanges"] = {};
    for (const [key, value] of Object.entries(this.status)) {
      if (statusBefore[key] !== value) statusChanges[key] = { from: statusBefore[key] ?? null, to: value };
    }
    const turnAfter = this.currentTurn();
    return {
      settled,
      turnsElapsed: turnBefore !== null && turnAfter !== null ? turnAfter - turnBefore : null,
      messages: this.unreadMessages(),
      prompt: this.prompt(),
      hero: this.heroView(),
      statusChanges,
      gameOver: this.gameOver,
    };
  }

  private inputsFor(action: AgentAction, prompt: AgentPrompt): string[] {
    const fields = Object.keys(action);
    if (fields.length === 0 || (fields.length > 1 && !("move" in action && fields.every(f => f === "move" || f === "count")))) {
      throw new Error("Give exactly one of keys, move, extended, answer, select, text or dismiss");
    }
    if ("keys" in action) {
      if (!Array.isArray(action.keys) || action.keys.length === 0 || action.keys.length > 64) throw new Error("keys must list 1 to 64 keys");
      return action.keys.map(toRuntimeKey);
    }
    if ("move" in action) {
      const key = directionKeys[action.move];
      if (!key) throw new Error(`move must be one of ${agentDirections.join(", ")}`);
      if (prompt.kind === "direction" || prompt.kind === "position") {
        if (action.count !== undefined) throw new Error("count is only for commands");
        return [key];
      }
      if (prompt.kind !== "command") throw new Error(`The game is not waiting for a command (prompt: ${prompt.kind})`);
      if (action.count === undefined) return [key];
      if (!Number.isSafeInteger(action.count) || action.count < 1 || action.count > 999) throw new Error("count must be 1 to 999");
      // number_pad is off in headless games, so a count is plain digits.
      return [...String(action.count), key];
    }
    if ("extended" in action) {
      if (prompt.kind !== "command") throw new Error(`The game is not waiting for a command (prompt: ${prompt.kind})`);
      if (!/^[A-Za-z0-9_?-]{1,80}$/.test(action.extended)) throw new Error("Invalid extended command name");
      return ["#", ...action.extended, "Enter"];
    }
    if ("answer" in action) {
      if (prompt.kind !== "yn" && prompt.kind !== "direction" && prompt.kind !== "position") throw new Error(`No question is open (prompt: ${prompt.kind})`);
      return [toRuntimeKey(action.answer)];
    }
    if ("select" in action) {
      if (prompt.kind !== "menu") throw new Error(`No menu is open (prompt: ${prompt.kind})`);
      if (!Array.isArray(action.select)) throw new Error("select must be a list");
      if (!prompt.multi && action.select.length !== 1) throw new Error("This menu takes exactly one selection");
      const menuItems = this.menuItemsForWait();
      const inputs: string[] = [];
      const seen = new Set<number>();
      for (const choice of action.select) {
        const item = menuItems[choice.index];
        if (!item || !isSelectableMenuItem(item) || seen.has(choice.index)) throw new Error(`Menu item ${choice.index} cannot be selected`);
        seen.add(choice.index);
        if (!Number.isInteger(item.menuIndex)) throw new Error(`Menu item ${choice.index} has no menu index`);
        if (choice.count !== undefined && (!Number.isSafeInteger(choice.count) || choice.count < 1 || choice.count > 0x7fffffff)) throw new Error("count must be 1 to 2147483647");
        inputs.push(`${MENU_SELECT_PREFIX}${item.menuIndex}${choice.count !== undefined ? `:${choice.count}` : ""}`);
      }
      if (prompt.multi) inputs.push("Enter");
      return inputs;
    }
    if ("text" in action) {
      if (prompt.kind !== "text") throw new Error(`No text prompt is open (prompt: ${prompt.kind})`);
      if (typeof action.text !== "string" || action.text.length > 255 || action.text.includes("\0")) throw new Error("text must be at most 255 characters");
      return [`${TEXT_INPUT_PREFIX}${action.text}`];
    }
    if ("dismiss" in action) {
      switch (prompt.kind) {
        case "text": return [`${TEXT_INPUT_PREFIX}\x1b`];
        case "info": case "more": return ["Enter"];
        case "yn": case "direction": case "menu": case "position": return ["Escape"];
        default: throw new Error(`Nothing to dismiss (prompt: ${prompt.kind})`);
      }
    }
    throw new Error("Unknown action");
  }

  private menuItemsForWait(): Array<Record<string, unknown>> {
    const wait = this.openWait();
    const event = wait ? this.promptByWait.get(wait.id) : undefined;
    return Array.isArray(event?.menuItems) ? event!.menuItems as Array<Record<string, unknown>> : [];
  }
}

/** yn_function passes its default as a character code. */
function defaultChoice(value: unknown): string {
  if (typeof value === "number" && value >= 32 && value < 127) return String.fromCharCode(value);
  if (typeof value === "string" && /^\d{2,3}$/.test(value) && Number(value) >= 32 && Number(value) < 127) return String.fromCharCode(Number(value));
  return typeof value === "string" ? value : "";
}

// BL_MASK_* bits of BL_CONDITION, in bit order (include/botl.h).
const conditionBits = [
  "barehanded", "blind", "busy", "conf", "deaf", "iron", "fly", "foodpois", "glowhands", "grab",
  "hallu", "held", "icy", "inlava", "lev", "parlyz", "ride", "sleeping", "slime", "slippery",
  "stone", "strngl", "stun", "submerged", "termill", "tethered", "trapped", "unconsc", "woundedl", "holding",
];

export function conditionNames(mask: number): string[] {
  if (!Number.isSafeInteger(mask) || mask <= 0) return [];
  return conditionBits.filter((_, bit) => (mask & (1 << bit)) !== 0);
}

function isSelectableMenuItem(item: Record<string, unknown>): boolean {
  if (!item || item.isCategory === true) return false;
  if (typeof item.isSelectable === "boolean") return item.isSelectable;
  if (typeof item.identifier === "number") return item.identifier !== 0;
  if (Number.isInteger(item.menuIndex)) return true;
  return typeof item.accelerator === "string" && item.accelerator.trim() !== "";
}

function compactObject(object: InventoryObject): Record<string, unknown> {
  const out: Record<string, unknown> = { id: object.id, letter: object.letter, name: object.name, class: object.objectClass, quantity: object.quantity };
  if (object.buc) out.buc = object.buc;
  if (object.enchantment !== null) out.enchantment = object.enchantment;
  if (object.charges !== null) out.charges = object.charges;
  if (object.wornMask) out.worn = true;
  if (object.weight !== null) out.weight = object.weight;
  if (object.container) out.container = object.container;
  return out;
}
