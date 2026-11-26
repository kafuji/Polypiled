import { describe, expect, it } from "vitest";
import { AgentSession, conditionNames, toRuntimeKey, type AgentRuntimePort } from "./agent-session";
import type { RuntimeCommandIdentity } from "../runtime/protocol/types";
import type { RuntimeEvent } from "../runtime/types";

/** A fake runtime: records what was sent and answers with scripted events. */
function harness(options: { multi?: boolean; onSend?: (inputs: string[], session: AgentSession) => void } = {}) {
  const session = new AgentSession();
  const sent: Array<{ inputs: string[]; identity: RuntimeCommandIdentity }> = [];
  const port: AgentRuntimePort = {
    sendInput: (input, identity) => { sent.push({ inputs: [input], identity }); options.onSend?.([input], session); },
    sendInputSequence: (inputs, identity) => { sent.push({ inputs, identity }); options.onSend?.(inputs, session); },
    isMultiSelectMenuActive: () => options.multi ?? false,
  };
  session.attach(port);
  return { session, sent };
}

const wait = (requestId: number, state: "waiting" | "consumed" | "cancelled", purpose = "command-or-position"): RuntimeEvent =>
  ({ type: "input_wait", requestId, callback: "shim_nh_poskey", purpose, state });

describe("toRuntimeKey", () => {
  it("passes plain keys and names, and spells Ctrl and Meta as the runtime expects", () => {
    expect(toRuntimeKey("s")).toBe("s");
    expect(toRuntimeKey("Enter")).toBe("Enter");
    expect(toRuntimeKey("^W")).toBe("__CTRL__:w");
    expect(toRuntimeKey("M-p")).toBe("__META__:p");
    expect(() => toRuntimeKey("F1")).toThrow(/Unsupported key/);
  });
});

describe("conditionNames", () => {
  it("decodes BL_MASK bits", () => {
    expect(conditionNames(0)).toEqual([]);
    expect(conditionNames(0x2 | 0x400000)).toEqual(["blind", "stun"]);
  });
});

describe("AgentSession", () => {
  it("is a command prompt when a command wait is open with no prompt", () => {
    const { session } = harness();
    expect(session.prompt()).toEqual({ kind: "none" });
    session.handle(wait(1, "waiting"));
    expect(session.prompt()).toEqual({ kind: "command" });
    session.handle(wait(1, "consumed"));
    expect(session.prompt()).toEqual({ kind: "none" });
  });

  it("classifies prompts attached to the open wait", () => {
    const { session } = harness({ multi: true });
    session.handle(wait(2, "waiting", "question"));
    session.handle({ type: "question", text: "Really attack?", choices: "yn", default: "110", menuItems: [], inputRequestId: 2 });
    expect(session.prompt()).toEqual({ kind: "yn", text: "Really attack?", choices: "yn", default: "n" });
    session.handle(wait(2, "consumed"));
    session.handle(wait(3, "waiting", "question"));
    session.handle({ type: "question", text: "Pick up what?", menuItems: [
      { text: "Comestibles", isCategory: true },
      { text: "a food ration", accelerator: "a", menuIndex: 0, isSelectable: true },
    ], inputRequestId: 3 });
    expect(session.prompt()).toMatchObject({ kind: "menu", multi: true, items: [{ index: 0, isSelectable: false }, { index: 1, accelerator: "a", isSelectable: true }] });
  });

  it("keeps a non-blocking information window as messages", () => {
    const { session } = harness();
    session.handle({ type: "info_menu", title: "Things that are here:", lines: ["a dagger", ""] });
    session.handle({ type: "text", text: "You see here a rock.   " });
    expect(session.observe({ map: false }).messages.map(message => message.text)).toEqual(["Things that are here:", "a dagger", "You see here a rock."]);
    expect(session.observe({ map: false }).messages).toEqual([]);
  });

  it("tracks status fields, the turn, and strips glyph escapes", () => {
    const { session } = harness();
    session.handle({ type: "status_update", fieldName: "BL_GOLD", value: "\\G0BC30F2E:42" });
    session.handle({ type: "status_update", fieldName: "BL_TIME", value: "  17" });
    session.handle({ type: "status_update", fieldName: "BL_CONDITION", value: 2 });
    expect(session.observe({ map: false })).toMatchObject({ turn: 17, status: { gold: "42", time: "17", condition: "blind" } });
  });

  it("renders the displayed map trimmed to what was seen", () => {
    const { session } = harness();
    session.handle({ type: "map_glyph_batch", tiles: [{ x: 10, y: 3, char: "-" }, { x: 11, y: 3, char: "-" }, { x: 10, y: 4, char: "@" }] });
    expect(session.mapView()).toEqual({ x0: 10, y0: 3, ruler: "  |01", rows: ["03|--", "04|@"] });
    session.handle({ type: "clear_scene" });
    expect(session.mapView().rows).toEqual([]);
  });

  it("acts against the open wait and returns what the action caused", async () => {
    const { session, sent } = harness({
      onSend: (_inputs, s) => {
        s.handle({ type: "input_consumed", commandId: 1, requestId: 1 });
        s.handle(wait(1, "consumed"));
        s.handle({ type: "text", text: "You find a hidden door." });
        s.handle({ type: "status_update", fieldName: "BL_TIME", value: "6" });
        s.handle(wait(4, "waiting"));
      },
    });
    session.handle({ type: "status_update", fieldName: "BL_TIME", value: "5" });
    session.handle(wait(1, "waiting"));
    const result = await session.act({ move: "e", count: 12 });
    expect(sent).toEqual([{ inputs: ["1", "2", "Numpad6"], identity: expect.objectContaining({ requestId: 1, commandId: 1 }) }]);
    expect(result).toMatchObject({ settled: true, turnsElapsed: 1, prompt: { kind: "command" }, statusChanges: { time: { from: "5", to: "6" } } });
    expect(result.messages.map(message => message.text)).toEqual(["You find a hidden door."]);
  });

  it("selects menu entries by menu index and confirms multi-select menus", async () => {
    const { session, sent } = harness({ multi: true, onSend: (_inputs, s) => { s.handle(wait(3, "consumed")); s.handle(wait(5, "waiting")); } });
    session.handle(wait(3, "waiting", "menu"));
    session.handle({ type: "question", text: "Pick up what?", menuItems: [
      { text: "Gems", isCategory: true },
      { text: "3 rocks", menuIndex: 7, isSelectable: true },
    ], inputRequestId: 3 });
    await expect(session.act({ select: [{ index: 0 }] })).rejects.toThrow(/cannot be selected/);
    await session.act({ select: [{ index: 1, count: 2 }] });
    expect(sent[sent.length - 1].inputs).toEqual(["__MENU_SELECT__:7:2", "Enter"]);
  });

  it("refuses actions that do not fit the prompt", async () => {
    const { session } = harness();
    session.handle(wait(1, "waiting"));
    await expect(session.act({ text: "Elbereth" })).rejects.toThrow(/No text prompt/);
    await expect(session.act({ keys: ["s"], move: "e" } as never)).rejects.toThrow(/exactly one/);
  });
});
