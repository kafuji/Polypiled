import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptDialogs, type PromptDialogsDependencies } from "./prompt-dialogs";
import { silentInventoryRefreshCommand } from "../../../runtime/input/inventory-refresh";

vi.mock("../../../state/gameStore", () => ({ useGameStore: {} }));
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const sendInput = vi.fn();
  const gameplayInput = vi.fn();
  const engineState = { session: { sendInput } as { sendInput: typeof sendInput } | null };
  const questionMenus = { isInQuestion: false };
  const prompts = new PromptDialogs({
    engineState,
    questionMenus,
    directionPrompts: { isInDirectionQuestion: false },
    positionSelection: { positionInputModeActive: false },
    extendedCommands: { metaCommandModeActive: false },
    gameOver: { gameOverState: { active: false } },
    inputCommands: { sendInput: gameplayInput },
  } as unknown as PromptDialogsDependencies);
  vi.spyOn(console, "log").mockImplementation(() => {});
  return { prompts, sendInput, gameplayInput, engineState, questionMenus };
}

describe("silent inventory refresh dispatch", () => {
  it("requests a worker-scheduled snapshot when mutation arrives before the sell prompt", () => {
    const f = fixture();
    expect(f.prompts.requestSilentInventoryRefresh("inventory-updated-signal")).toBe(true);
    expect(f.sendInput).toHaveBeenCalledExactlyOnceWith(silentInventoryRefreshCommand);
    expect(f.gameplayInput).not.toHaveBeenCalled();
    expect(f.prompts.inventoryRefreshInFlight).toBe(true);
    expect(f.prompts.pendingInventoryDialog).toBe(false);
    expect(f.prompts.requestSilentInventoryRefresh("inventory-updated-signal")).toBe(false);
    expect(f.sendInput).toHaveBeenCalledOnce();
  });

  it("does not mark a refresh in flight without a runtime session", () => {
    const f = fixture();
    f.engineState.session = null;
    expect(f.prompts.requestSilentInventoryRefresh("fps-mode-enter")).toBe(false);
    expect(f.prompts.inventoryRefreshInFlight).toBe(false);
    expect(f.sendInput).not.toHaveBeenCalled();
  });

  it("keeps visible question prompts ahead of a refresh request", () => {
    const f = fixture();
    f.questionMenus.isInQuestion = true;
    expect(f.prompts.requestSilentInventoryRefresh("inventory-updated-signal")).toBe(false);
    expect(f.prompts.inventoryRefreshInFlight).toBe(false);
    expect(f.sendInput).not.toHaveBeenCalled();
    expect(f.gameplayInput).not.toHaveBeenCalled();
  });

  it("retries a mutation refresh once the command's menu has closed", () => {
    const f = fixture();
    f.questionMenus.isInQuestion = true;
    f.prompts.queueSilentInventoryRefresh("inventory-updated-signal");
    f.prompts.maybeRequestQueuedSilentInventoryRefresh();
    expect(f.sendInput).not.toHaveBeenCalled();
    f.questionMenus.isInQuestion = false;
    f.prompts.maybeRequestQueuedSilentInventoryRefresh();
    expect(f.sendInput).toHaveBeenCalledExactlyOnceWith(silentInventoryRefreshCommand);
    f.prompts.inventoryRefreshInFlight = false;
    f.prompts.maybeRequestQueuedSilentInventoryRefresh();
    expect(f.sendInput).toHaveBeenCalledOnce();
  });

  it("repeats a refresh that was already in flight when the inventory changed", () => {
    const f = fixture();
    f.prompts.queueSilentInventoryRefresh("first");
    f.prompts.queueSilentInventoryRefresh("second");
    expect(f.sendInput).toHaveBeenCalledOnce();
    f.prompts.inventoryRefreshInFlight = false;
    f.prompts.maybeRequestQueuedSilentInventoryRefresh();
    expect(f.sendInput).toHaveBeenCalledTimes(2);
  });
});

describe("i and Shift+I", () => {
  function screenFixture() {
    const gameplayInput = vi.fn();
    const uiAdapter = new Proxy({}, { get: () => vi.fn() }) as Record<string, ReturnType<typeof vi.fn>>;
    // anything else the dialogs touch: a do-nothing stand-in
    const lenient = (target: object): object =>
      new Proxy(target, { get: (t, k) => (k in t ? (t as Record<PropertyKey, unknown>)[k] : vi.fn()) });
    const given: Record<string, object> = {
      engineState: { session: { sendInput: vi.fn() }, uiAdapter, clientOptions: { inventoryScreen: true } },
      questionMenus: { isInQuestion: false },
      directionPrompts: { isInDirectionQuestion: false },
      positionSelection: { positionInputModeActive: false },
      extendedCommands: { metaCommandModeActive: false },
      gameOver: { gameOverState: { active: false }, fulfillDeferredGameOverPromptReadyIfPossible: vi.fn() },
      inputCommands: { sendInput: gameplayInput },
      pointerLock: { syncFpsPointerLockForUiState: vi.fn() },
    };
    const prompts = new PromptDialogs(new Proxy(given, {
      get: (t, k: string) => lenient(t[k] ?? {}),
    }) as unknown as PromptDialogsDependencies);
    prompts.setInventoryStateAvailable(true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    return { prompts, gameplayInput };
  }

  it("i opens the inventory screen; Shift+I over it changes to the game's own list", () => {
    const f = screenFixture();
    f.prompts.toggleInventoryDialogState();
    expect(f.prompts.isInventoryScreenVisible).toBe(true);
    expect(f.gameplayInput).not.toHaveBeenCalled();
    f.prompts.toggleInventoryDialogState(true);
    expect(f.prompts.isInventoryScreenVisible).toBe(false);
    expect(f.gameplayInput).toHaveBeenCalledExactlyOnceWith("i");
    expect(f.prompts.pendingInventoryDialog).toBe(true);
  });

  it("Shift+I opens the list with the screen closed, and i closes the screen", () => {
    const f = screenFixture();
    f.prompts.toggleInventoryDialogState(true);
    expect(f.prompts.isInventoryScreenVisible).toBe(false);
    expect(f.gameplayInput).toHaveBeenCalledExactlyOnceWith("i");
    f.prompts.inventoryRefreshInFlight = false;
    f.prompts.toggleInventoryDialogState();
    f.prompts.toggleInventoryDialogState();
    expect(f.prompts.isInventoryScreenVisible).toBe(false);
  });
});
