import type {
  GameOverState,
  Nethack3DEngineUIAdapter,
  NethackConnectionState,
  NewGamePromptState,
  PlayerStatsSnapshot,
  QuestionDialogState,
  InfoMenuState,
  InventoryDialogState,
  TextInputRequestState,
} from "../game/ui-types";
import { useGameStore } from "./gameStore";
import type { FloorHere } from "../runtime/floor-here";
import type { InventoryState } from "../runtime/inventory-state";

export function createEngineUiAdapter(): Nethack3DEngineUIAdapter {
  return {
    setStatus(status: string): void {
      useGameStore.getState().setStatusText(status);
    },
    setConnectionStatus(
      status: string,
      state: NethackConnectionState,
    ): void {
      useGameStore.getState().setConnectionStatus(status, state);
    },
    setLoadingVisible(visible: boolean): void {
      useGameStore.getState().setLoadingVisible(visible);
    },
    setGameMessages(messages: string[], turns?: readonly (number | null)[]): void {
      useGameStore.getState().setGameMessages(messages, turns);
    },
    pushFloatingMessage(message: string): void {
      useGameStore.getState().pushFloatingMessage(message);
    },
    setPlayerStats(stats: PlayerStatsSnapshot): void {
      useGameStore.getState().setPlayerStats(stats);
    },
    setQuestion(state: QuestionDialogState | null): void {
      useGameStore.getState().setQuestion(state);
    },
    setDirectionQuestion(question: string | null): void {
      useGameStore.getState().setDirectionQuestion(question);
    },
    setNumberPadModeEnabled(enabled: boolean): void {
      useGameStore.getState().setNumberPadModeEnabled(enabled);
    },
    setInfoMenu(state: InfoMenuState | null): void {
      useGameStore.getState().setInfoMenu(state);
    },
    setInventory(state: InventoryDialogState): void {
      useGameStore.getState().setInventory(state);
    },
    setTextInput(state: TextInputRequestState | null): void {
      useGameStore.getState().setTextInput(state);
    },
    setExtendedCommands(commands: string[]): void {
      useGameStore.getState().setExtendedCommands(commands);
    },
    setPositionRequest(text: string | null): void {
      useGameStore.getState().setPositionRequest(text);
    },
    setFloorHere(state: FloorHere | null): void {
      useGameStore.getState().setFloorHere(state);
    },
    setInventoryState(state: InventoryState | null): void {
      useGameStore.getState().setInventoryState(state);
    },
    setInventoryScreenOpen(open: boolean): void {
      useGameStore.getState().setInventoryScreenOpen(open);
    },
    setInventoryProcedure(state): void {
      useGameStore.getState().setInventoryProcedure(state);
    },
    setPositionInputActive(active: boolean, origin?: string | null): void {
      useGameStore.getState().setPositionInputActive(active, origin);
    },
    setFpsCrosshairContext(state): void {
      useGameStore.getState().setFpsCrosshairContext(state);
    },
    setRepeatActionVisible(visible: boolean): void {
      useGameStore.getState().setRepeatActionVisible(visible);
    },
    setNewGamePrompt(state: NewGamePromptState): void {
      useGameStore.getState().setNewGamePrompt(state);
    },
    setGameOver(state: GameOverState): void {
      useGameStore.getState().setGameOver(state);
    },
  };
}
