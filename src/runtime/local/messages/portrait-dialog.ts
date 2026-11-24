export interface PortraitScene {
  actor: string;
  text: string;
  tileIndex?: number;
  input?: "yes-no" | "offer";
  conversation?: boolean;
}

const nurseHit = /^(?:the |a )?nurse(?: named .+?)? hits(?: you)?[!.]/i;
const pets = / (whines|meows|whinnies|is confused from hunger|seems famished)\.$/i;

function petActor(text: string): string {
  if (/\b(?:dog|puppy|hound)\b| whines\.$/i.test(text)) return "dog";
  if (/\b(?:cat|kitten)\b| meows\.$/i.test(text)) return "kitten";
  if (/\b(?:horse|pony|warhorse)\b| whinnies\.$/i.test(text)) return "pony";
  return "pet";
}

/** Suspends the message callback. Acknowledgement is never a NetHack key. */
export class RuntimePortraitDialogs {
  private enabled: boolean;
  private serial = 0;
  private pending?: { id: number; input?: PortraitScene["input"]; resolve: (value: string) => void };
  private speaker?: string;
  private speakerTile?: number;
  private chatTile: number | null | undefined;
  private lastWarning = new Map<string, number>();
  private commands = 0;

  constructor(enabled: boolean, private readonly show: (id: number, scene: PortraitScene) => void,
    private readonly closeConversation: () => void) {
    this.enabled = enabled;
  }

  get active() { return Boolean(this.pending); }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.chatTile = undefined;
      this.lastWarning.clear();
      const pending = this.pending;
      this.pending = undefined;
      pending?.resolve(pending.input === "yes-no" ? "n" : "0");
      this.endConversation();
    }
  }

  beginCommand() {
    this.endConversation();
    this.chatTile = undefined;
    this.commands++;
  }

  chatResponse(tileIndex: number | null) {
    if (this.enabled) this.chatTile = tileIndex;
  }

  endConversation() {
    if (!this.speaker) return;
    this.speaker = undefined;
    this.speakerTile = undefined;
    this.closeConversation();
  }

  dismiss(id: number, answer = "") {
    if (this.pending?.id !== id) return;
    if (this.pending.input === "yes-no" && !/^[yn]$/.test(answer)) return;
    if (this.pending.input === "offer" && !/^\d{1,10}$/.test(answer)) return;
    const { resolve } = this.pending;
    this.pending = undefined;
    resolve(answer);
  }

  private page(scene: PortraitScene) {
    return new Promise<string>(resolve => {
      const id = ++this.serial;
      this.pending = { id, input: scene.input, resolve };
      this.show(id, { ...scene, conversation: Boolean(this.speaker) });
    });
  }

  question(text: string, choices: string) {
    if (!this.enabled || !/^(?:yn)?$/i.test(choices)) return;
    const directedChat = choices.toLowerCase() === "yn" && this.chatTile != null;
    const spokenQuestion = this.speaker && (/^"/.test(text) || /Shall I remove your |May I have it\?|Would you wear it for me\?/i.test(text));
    if (!directedChat && !spokenQuestion) return;
    if (directedChat) {
      this.speaker = "chat";
      this.speakerTile = this.chatTile ?? undefined;
      this.chatTile = undefined;
    }
    return this.page({ actor: this.speaker!, tileIndex: this.speakerTile, text, input: "yes-no" }).then(answer => answer.charCodeAt(0));
  }

  offer(text: string) {
    if (this.speaker === "baalzebub" && /^How much will you offer\?/i.test(text))
      return this.page({ actor: this.speaker, text, input: "offer" });
  }

  message(text: string, readTurn: () => number | null): number | Promise<number> {
    if (!this.enabled || this.pending) return 0;
    const tileIndex = this.chatTile;
    this.chatTile = undefined;
    let actor: string;
    let warning = "";
    if (/!\s+Welcome(?: again)? to |^"Invisible customers are not welcome!|^"So, .+, you dare return to |^"Back again, .+I've got my/i.test(text)) actor = "shopkeeper";
    else if (nurseHit.test(text)) { actor = "nurse"; warning = actor; }
    else if (pets.test(text) || /^"I'm hungry\."$|^You feel worried about .+\.$/i.test(text)) {
      actor = petActor(text);
      warning = text;
    } else if (/^"So thou thought thou couldst .+ me, fool\."$/i.test(text)) actor = "wizard";
    else if (/\bbaalzebub\b.* (demands|seems to be demanding) /i.test(text)) actor = "baalzebub";
    else if (/^You feel very attracted to (?:the |an? )?(succubus|incubus)\.$/i.test(text)) actor = /succubus/i.test(text) ? "succubus" : "incubus";
    else if (tileIndex === null && / (?:howls|barks|yips)\.$/i.test(text)) actor = "dog";
    else if (tileIndex === null && / (?:purrs|mews|yowls)\.$/i.test(text)) actor = "kitten";
    else if (tileIndex === null && / (?:whickers|neighs)\.$/i.test(text)) actor = "pony";
    else if (tileIndex !== undefined && (tileIndex !== null || /^"/.test(text))) actor = "chat";
    else if (this.speaker && (/^"|^(?:The |An? )?(?:succubus|incubus|Baalzebub)\b|^(?:He|She) |^Time stands still while |^You (?:refuse\.|give |seem to have enjoyed)/i.test(text))) actor = this.speaker;
    else return 0;
    if (["succubus", "incubus", "baalzebub", "chat"].includes(actor)) {
      this.speaker = actor;
      if (tileIndex != null) this.speakerTile = tileIndex;
    }
    else this.endConversation();
    if (warning && tileIndex === undefined) {
      // Consecutive hits or cries belong to one encounter. Re-arm after a quiet interval.
      const now = readTurn() ?? this.commands;
      const previous = this.lastWarning.get(warning);
      this.lastWarning.set(warning, now);
      for (const [key, last] of this.lastWarning) if (now - last > 5) this.lastWarning.delete(key);
      if (previous !== undefined && now >= previous && now - previous <= 5) return 0;
    }
    return this.page({ actor, text, tileIndex: tileIndex ?? this.speakerTile }).then(() => 0);
  }
}
