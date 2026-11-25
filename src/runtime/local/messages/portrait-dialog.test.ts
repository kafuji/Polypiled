import { afterEach, expect, it, vi } from "vitest";
import LocalNetHackRuntime from "../../LocalNetHackRuntime";
import { RuntimeBootstrap } from "../startup/bootstrap";
import type { RuntimeEvent } from "../../types";


let runtime: LocalNetHackRuntime;
afterEach(() => { runtime.shutdown(); vi.restoreAllMocks(); });

function setup(enabled = true) {
  vi.spyOn(RuntimeBootstrap.prototype, "initializeNetHack").mockResolvedValue(undefined);
  const events: RuntimeEvent[] = [];
  runtime = new LocalNetHackRuntime(event => events.push(event), { portraitDialog: enabled });
  return { events, say: (text: string) => runtime.handleUICallback("shim_putstr", [1, 0, text]) };
}

it("logs once, drops buffered and incoming gameplay input, and consumes only a matching acknowledgement", async () => {
  const { events, say } = setup();
  runtime.sendInputSequence([".", "."]);
  const pause = say(`"Hello, Sam!  Welcome to Izchak's lighting store!"`);
  const event = events.find(e => e.type === "portrait_dialog")!;
  expect(event.actor).toBe("shopkeeper");
  expect(events.filter(e => e.type === "text")).toHaveLength(1);
  runtime.sendInput(".");
  runtime.sendMouseInput(1, 1, 0);
  runtime.sendInputSequence([".", "."]);
  runtime.portraits.dismiss(Number(event.id) + 1);
  expect(runtime.portraits.active).toBe(true);
  runtime.portraits.dismiss(Number(event.id));
  await expect(pause).resolves.toBe(0);
  const key = runtime.handleUICallback("shim_nhgetch", []);
  expect(key).toBeInstanceOf(Promise);
  runtime.sendInput("s");
  expect(await key).toBe(115);
});

it("keeps the ordinary log when disabled", () => {
  const { events, say } = setup(false);
  expect(say("The nurse hits!")).toBe(0);
  expect(events.map(e => e.type)).toContain("text");
  expect(events.map(e => e.type)).not.toContain("portrait_dialog");
});

const minorConsultation = '"Wilt thou settle for a minor consultation?" (50 zorkmids)';
const majorConsultation = '"Then dost thou desire a major one?" (550 zorkmids)';

it("keeps both Oracle questions and the full major consultation in one portrait conversation", async () => {
  const { events } = setup();
  const minor = runtime.handleUICallback("shim_yn_function", [minorConsultation, "ynq", 113]);
  expect(events[events.length - 1]).toMatchObject({ actor: "oracle", choices: "ynq", input: "yes-no", conversation: true });
  runtime.portraits.dismiss(1, "");
  expect(runtime.portraits.active).toBe(true);
  runtime.portraits.dismiss(1, "n");
  await expect(minor).resolves.toBe(110);

  const major = runtime.handleUICallback("shim_yn_function", [majorConsultation, "yn", 110]);
  expect(events[events.length - 1]).toMatchObject({ actor: "oracle", choices: "yn", input: "yes-no" });
  runtime.portraits.dismiss(2, "q");
  expect(runtime.portraits.active).toBe(true);
  runtime.portraits.dismiss(2, "y");
  await expect(major).resolves.toBe(121);

  const lines = ["The Oracle meditates for a moment and then intones:", "", "First line.", "Second line."];
  const window = runtime.handleUICallback("shim_create_nhwindow", [5]);
  for (const line of lines) runtime.handleUICallback("shim_putstr", [window, 0, line]);
  const consultation = runtime.handleUICallback("shim_display_nhwindow", [window, true]);
  expect(events[events.length - 1]).toMatchObject({ actor: "oracle", oracleDocument: true, text: lines.join("\n") });
  expect(events.some(event => ["question", "info_menu", "portrait_conversation_end"].includes(event.type))).toBe(false);
  runtime.portraits.dismiss(3);
  await expect(consultation).resolves.toBe(0);
  runtime.portraits.beginCommand();
  expect(events[events.length - 1]?.type).toBe("portrait_conversation_end");
});

it("presents the minor consultation lead-in and rumor on the same page", async () => {
  const { events, say } = setup();
  const minor = runtime.handleUICallback("shim_yn_function", [minorConsultation, "ynq", 113]);
  runtime.portraits.dismiss(1, "y");
  await expect(minor).resolves.toBe(121);
  const intro = "True to her word, the Oracle nonchalantly says:";
  const rumor = '"They say that healing potions often come in pairs."';
  expect(say(intro)).toBe(0);
  const result = say(rumor);
  expect(events[events.length - 1]).toMatchObject({ actor: "oracle", text: `${intro}\n\n${rumor}` });
  runtime.portraits.dismiss(2);
  await expect(result).resolves.toBe(0);
});

it("preserves the ordinary text window when portraits are disabled", async () => {
  const { events } = setup(false);
  const window = runtime.handleUICallback("shim_create_nhwindow", [5]);
  runtime.handleUICallback("shim_putstr", [window, 0, "The Oracle meditates for a moment and then intones:"]);
  const consultation = runtime.handleUICallback("shim_display_nhwindow", [window, true]);
  expect(events).toContainEqual(expect.objectContaining({ type: "info_menu" }));
  expect(events.some(event => event.type === "portrait_dialog")).toBe(false);
  runtime.sendInput("Enter");
  await expect(consultation).resolves.toBe(13);
});

it.each([
  '"Will you please leave your pick-axe outside?"',
  '"Leave the digging tools outside."',
  '"Will you please leave your warhorse outside?"',
  '"Leave Silver outside."',
  "Izchak refuses to let you in while you're riding Silver.",
])("keeps the shopkeeper on screen for the entrance restriction %s", async text => {
  const { events } = setup();
  const raw = (line: string) => runtime.handleUICallback("shim_raw_print", [line]);
  const greeting = raw('"Hello, wizard!  Welcome to Izchak\'s lighting store!"');
  runtime.portraits.dismiss(1);
  await greeting;
  const request = raw(text);
  expect(events.filter(event => event.type === "portrait_dialog")).toMatchObject([
    { actor: "shopkeeper", conversation: true, id: 1 },
    { actor: "shopkeeper", conversation: true, id: 2, text },
  ]);
  expect(events.some(event => event.type === "portrait_conversation_end")).toBe(false);
  runtime.portraits.dismiss(2);
  await request;
  runtime.portraits.beginCommand();
  expect(events[events.length - 1].type).toBe("portrait_conversation_end");
});

it.each(["shim_raw_print", "shim_raw_print_bold"])("pauses a pet reply delivered by %s", async callback => {
  const { events } = setup();
  const question = runtime.handleUICallback("shim_yn_function", ["Talk to whom? (in what direction)", "", 0]);
  runtime.sendInput("l");
  await question;
  const text = "Hachi howls.";
  const pause = runtime.handleUICallback(callback, [text]);
  expect(events.slice(-2)).toEqual([
    expect.objectContaining({ type: "raw_print", text }),
    expect.objectContaining({ type: "portrait_dialog", id: 1, actor: "dog", text }),
  ]);
  runtime.sendInput(".");
  runtime.portraits.dismiss(1);
  await expect(pause).resolves.toBe(0);
  expect(runtime.handleUICallback(callback, [text])).toBe(0);
});

it("holds a visible chat reply and does not reuse its speaker for later ordinary messages", async () => {
  const { say, events } = setup();

  runtime.portraits.chatResponse(4);
  const pause = say("The dwarf talks about mining.");
  expect(events[events.length - 1]).toMatchObject({ actor: "chat", tileIndex: 4 });
  runtime.portraits.setEnabled(false);
  await expect(pause).resolves.toBe(0);
  runtime.portraits.setEnabled(true);
  expect(say("The dwarf picks up a rock.")).toBe(0);
});

it("suppresses adjacent nurse hits and re-arms after a quiet interval", async () => {
  setup();
  const hit = (turn: number) => runtime.portraits.message("The nurse hits!  (I hope you don't mind.)", () => turn);
  const first = hit(10);
  runtime.portraits.dismiss(1);
  await expect(first).resolves.toBe(0);
  expect(hit(11)).toBe(0);
  expect(hit(17)).toBeInstanceOf(Promise);
});

it("keeps consecutive seduction questions in the portrait and returns the selected answers", async () => {
  const { say, events } = setup();
  const opening = say("You feel very attracted to the succubus.");
  runtime.portraits.dismiss(1);
  await opening;
  for (const [index, answer] of ["n", "y"].entries()) {
    const question = runtime.handleUICallback("shim_yn_function", ['"Shall I remove your boots, dear?"', "yn", 110]);
    expect(events[events.length - 1]).toMatchObject({ actor: "succubus", input: "yes-no", conversation: true });
    runtime.portraits.dismiss(index + 2);
    expect(runtime.portraits.active).toBe(true);
    runtime.portraits.dismiss(index + 2, answer);
    expect(await question).toBe(answer.charCodeAt(0));
  }
  runtime.portraits.beginCommand();
  expect(events[events.length - 1].type).toBe("portrait_conversation_end");
});

it("writes Baalzebub's offer to the original NetHack getlin buffer", async () => {
  const { say, events } = setup();
  const heap = new Uint8Array(4096);
  runtime.nethackModule = { HEAPU8: heap };
  const opening = say("Baalzebub demands 500 gold pieces for safe passage.");
  runtime.portraits.dismiss(1);
  await opening;
  const offer = runtime.handleUICallback("shim_getlin", ["How much will you offer?", 512]);
  expect(events[events.length - 1]).toMatchObject({ actor: "baalzebub", input: "offer" });
  runtime.portraits.dismiss(2, "42");
  expect(await offer).toBe(0);
  expect(Array.from(heap.slice(512, 515))).toEqual([52, 50, 0]);
});

it.each([
  ["Hachi whines.", "dog"], ["Your pony is confused from hunger.", "pony"],
  ['"So thou thought thou couldst kill me, fool."', "wizard"],
  ["Baalzebub demands 400 gold pieces for safe passage.", "baalzebub"],
  ["You feel very attracted to the succubus.", "succubus"],
])("interrupts on %s", async (text, actor) => {
  const { events, say } = setup();
  const pause = say(text);
  expect(events[events.length - 1]).toMatchObject({ type: "portrait_dialog", actor, text });
  runtime.portraits.dismiss(1);
  await expect(pause).resolves.toBe(0);
});
