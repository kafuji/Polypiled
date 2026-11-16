// @ts-nocheck
// Legacy dynamic WASM integration; dependency membership is checked by assembly.

import type { RuntimeCoordinator } from "../runtime-coordinator";
import type { RuntimeMenuSelection } from "../menus/selection";
import type { RuntimeGameOver } from "../lifecycle/game-over";
import type { RuntimeCheckpointRecovery } from "../persistence/checkpoint-recovery";
import type { RuntimeKeyboardInput } from "./keyboard";
import type { RuntimeContextualLook } from "./contextual-look";
import type { RuntimeInputRequests } from "./input-requests";

export interface RuntimeQuestionInputDependencies {
  readonly contextualLook: Pick<
    RuntimeContextualLook,
    "resolveContextualLookInfoAutoAnswer"
  >;
  readonly coordinator: Pick<
    RuntimeCoordinator,
    "logRoutine"
    | "emit"
    | "eventHandler"
    | "runtimeVersion"
  >;
  readonly gameOver: Pick<
    RuntimeGameOver,
    "beginGameOverSequence"
    | "isGameOverPossessionsIdentifyQuestion"
    | "pendingGameOverPossessionsInventoryFlow"
  >;
  readonly inputRequests: Pick<
    RuntimeInputRequests,
    "waitForQuestionInput"
  >;
  readonly keyboardInput: Pick<
    RuntimeKeyboardInput,
    "processKey"
  >;
  readonly menuSelection: Pick<
    RuntimeMenuSelection,
    "isContainerLootTypeQuestion"
    | "normalizeQuestionText"
  >;
  readonly recovery: Pick<
    RuntimeCheckpointRecovery,
    "shouldAutoConfirmCheckpointCleanup"
    | "shouldAutoRecoverCheckpointResume"
  >;
}

/** YN question dispatch, legacy inventory prompts, default answers and escape semantics. */
export class RuntimeQuestionInput {
  declare lastQuestionText: any;
  declare activeYnPrompt: any;

  constructor(private readonly deps: RuntimeQuestionInputDependencies) {
    this.lastQuestionText = null;
    // Store the last question for menu expansion
    this.activeYnPrompt = null;
  }

  normalizeYnDefaultChoice(defaultChoice) {
    if (typeof defaultChoice === "string" && defaultChoice.length > 0) {
      return defaultChoice.trim().charAt(0).toLowerCase();
    }
    if (
      typeof defaultChoice === "number" &&
      Number.isFinite(defaultChoice) &&
      defaultChoice > 0
    ) {
      return String.fromCharCode(Math.trunc(defaultChoice)).toLowerCase();
    }
    return "";
  }

  handleShimYnFunction(args) {
    const [question, choices, defaultChoice] = args;
    const normalizedChoices =
      typeof choices === "string" ? choices : String(choices ?? "");
    const normalizedDefaultChoice =
      typeof defaultChoice === "number" && Number.isFinite(defaultChoice)
        ? Math.trunc(defaultChoice)
        : 0;
    this.deps.coordinator.logRoutine(
      `Y/N Question: "${question}" choices: "${choices}" default: ${defaultChoice}`,
    );

    this.lastQuestionText = question;
    this.activeYnPrompt = null;
    this.deps.gameOver.pendingGameOverPossessionsInventoryFlow =
      this.deps.gameOver.isGameOverPossessionsIdentifyQuestion(question);
    if (this.deps.gameOver.pendingGameOverPossessionsInventoryFlow) {
      this.deps.gameOver.beginGameOverSequence("possessions-question");
    }

    if (this.deps.recovery.shouldAutoRecoverCheckpointResume(question)) {
      // Autosave rows in the load-game UI represent explicit recovery of
      // checkpoint-only runs. Once the wasm package exposes a full browser-side
      // checkpoint resume bridge, accept NetHack's follow-up recover prompt
      // automatically so resume goes straight into the recovered save without
      // asking the player twice.
      const recoveryChoice = /r/i.test(normalizedChoices) ? "r" : "y";
      this.deps.coordinator.logRoutine(
        `Auto-confirming checkpoint recovery with "${recoveryChoice}" during autosave resume`,
      );
      return this.deps.keyboardInput.processKey(recoveryChoice);
    }

    if (this.deps.recovery.shouldAutoConfirmCheckpointCleanup(question)) {
      // Unsupported wasm builds cannot recover checkpoint shards into a proper
      // save file. For those builds, auto-confirm stale cleanup during
      // fresh-game startup instead of surfacing an unusable prompt.
      this.deps.coordinator.logRoutine(
        'Auto-confirming stale checkpoint cleanup with "y" during fresh-game startup',
      );
      return this.deps.keyboardInput.processKey("y");
    }

    if (this.deps.menuSelection.isContainerLootTypeQuestion(question)) {
      this.deps.coordinator.logRoutine('Auto-answering container loot type question with "a"');
      return this.deps.keyboardInput.processKey("a");
    }

    const contextualLookInfoAutoAnswer =
      this.deps.contextualLook.resolveContextualLookInfoAutoAnswer(
        question,
        normalizedChoices,
        defaultChoice,
      );
    if (contextualLookInfoAutoAnswer) {
      return this.deps.keyboardInput.processKey(contextualLookInfoAutoAnswer);
    }

    if (question && question.toLowerCase().includes("direction")) {
      this.activeYnPrompt = {
        choices: normalizedChoices,
        defaultChoice: normalizedDefaultChoice,
      };
      if (this.deps.coordinator.eventHandler) {
        this.deps.coordinator.emit({
          type: "direction_question",
          text: question,
          choices: choices,
          default: defaultChoice,
        });
      }
      const requested = this.deps.inputRequests.waitForQuestionInput();
      if (requested && typeof requested.then === "function") {
        return requested.finally(() => {
          this.activeYnPrompt = null;
        });
      }
      this.activeYnPrompt = null;
      return requested;
    }

    this.activeYnPrompt = {
      choices: normalizedChoices,
      defaultChoice: normalizedDefaultChoice,
    };
    if (this.deps.coordinator.eventHandler) {
      this.deps.coordinator.emit({
        type: "question",
        text: question,
        choices: choices,
        default: defaultChoice,
        menuItems: [],
      });
    }

    const requested = this.deps.inputRequests.waitForQuestionInput();
    if (requested && typeof requested.then === "function") {
      return requested.finally(() => {
        this.activeYnPrompt = null;
      });
    }
    this.activeYnPrompt = null;
    return requested;
  }

  resolveEscapeForActiveYnPrompt() {
    const prompt = this.activeYnPrompt;
    if (!prompt || typeof prompt !== "object") {
      return null;
    }

    const choices =
      typeof prompt.choices === "string" ? prompt.choices : String(prompt.choices ?? "");
    if (!choices) {
      return null;
    }
    const choicesLower = choices.toLowerCase();

    const defaultCode =
      typeof prompt.defaultChoice === "number" &&
        Number.isFinite(prompt.defaultChoice)
        ? Math.trunc(prompt.defaultChoice)
        : 0;
    const defaultChar =
      defaultCode > 0 && defaultCode <= 255
        ? String.fromCharCode(defaultCode).toLowerCase()
        : "";
    if (defaultChar && choicesLower.includes(defaultChar)) {
      return defaultChar;
    }
    if (choicesLower.includes("n")) {
      return "n";
    }
    if (choicesLower.includes("q")) {
      return "q";
    }
    return null;
  }
}
