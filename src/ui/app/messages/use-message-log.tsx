import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode
} from "react";
import { useGameStore } from "../../../state/gameStore";
import type {
  Nh3dClientOptions
} from "../../../game/ui-types";
import type * as React from "react";
import { GameMessageText } from "./GameMessageText";
import {
  t
} from "../shared/translations";
import {
  mobileActions
} from "../menus/mobile-actions";
// nh3d-plus: drag-resizable desktop message log.
import { ResizableDesktopLogPanel } from "../../../plus/ui/message-log/ResizableDesktopLogPanel";

export interface UseMessageLogStyleDependencies {
  readonly clientOptions: Nh3dClientOptions;
}

/** Floating log text/timing and desktop/mobile log rendering */
export function useMessageLogStyle(dependencies: UseMessageLogStyleDependencies) {
  const {
    clientOptions,
  } = dependencies;

  const floatingMessageTextStyle = useMemo(
    () =>
      ({
        "--floating-message-fade-delay-ms": `${clientOptions.liveMessageDisplayTimeMs}ms`,
        "--floating-message-fade-duration-ms": `${clientOptions.liveMessageFadeOutTimeMs}ms`,
      }) as React.CSSProperties,
    [
      clientOptions.liveMessageDisplayTimeMs,
      clientOptions.liveMessageFadeOutTimeMs,
    ],
  );
  return {
    floatingMessageTextStyle,
  } as const;
}

export interface UseMessageLogEffectsDependencies {
  readonly setFloatingMessageTiming: (delayMs: number, durationMs: number) => void;
  readonly clientOptions: Nh3dClientOptions;
  readonly setIsMobileLogVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

/** Floating log text/timing and desktop/mobile log rendering */
export function useMessageLogEffects(dependencies: UseMessageLogEffectsDependencies) {
  const {
    setFloatingMessageTiming,
    clientOptions,
    setIsMobileLogVisible,
  } = dependencies;

  useEffect(() => {
    setFloatingMessageTiming(
      clientOptions.liveMessageDisplayTimeMs,
      clientOptions.liveMessageFadeOutTimeMs,
    );
  }, [
    clientOptions.liveMessageDisplayTimeMs,
    clientOptions.liveMessageFadeOutTimeMs,
    setFloatingMessageTiming,
  ]);

  useEffect(() => {
    if (!clientOptions.liveMessageLog) {
      setIsMobileLogVisible(false);
    }
  }, [clientOptions.liveMessageLog]);

}

export interface UseMessageLogViewDependencies {
  readonly clientOptions: Nh3dClientOptions;
  readonly terminalDesktopGutterVisible: boolean;
  readonly mobileTouchUiVisible: boolean;
  readonly isMobileLogVisible: boolean;
  readonly renderMobileDialogCloseButton: (onClick: () => void, label?: string) => JSX.Element | null;
  readonly setIsMobileLogVisible: React.Dispatch<React.SetStateAction<boolean>>;
  readonly gameMessages: string[];
  readonly isMobileViewport: boolean;
  readonly isDesktopGameRunning: boolean;
  readonly statusText: string;
}

/** Floating log text/timing and desktop/mobile log rendering */
export function useMessageLogView(dependencies: UseMessageLogViewDependencies) {
  const {
    clientOptions,
    terminalDesktopGutterVisible,
    mobileTouchUiVisible,
    isMobileLogVisible,
    renderMobileDialogCloseButton,
    setIsMobileLogVisible,
    gameMessages,
    isMobileViewport,
    isDesktopGameRunning,
  } = dependencies;

  const gameMessageTurns = useGameStore((state) => state.gameMessageTurns);

  const gameMessageLog =
    clientOptions.liveMessageLog ? (
      <MessageLogScroll
        closeButton={
          mobileTouchUiVisible && isMobileLogVisible
            ? renderMobileDialogCloseButton(
              () => setIsMobileLogVisible(false),
              t.dialogs.mobileActions.closeMessageLog,
            )
            : null
        }
        messages={gameMessages}
        turns={gameMessageTurns}
      />
    ) : null;

  const desktopGameMessageLog =
    !isMobileViewport && isDesktopGameRunning && gameMessageLog ? (
      // nh3d-plus: drag-resizable boxed log (the terminal gutter stays fixed).
      <ResizableDesktopLogPanel
        className={`top-left-ui with-stats${terminalDesktopGutterVisible
          ? " nh3d-terminal-log-gutter-panel"
          : ""
          }`}
        resizable={!terminalDesktopGutterVisible}
      >
        <div className="nh3d-overflow-glow-frame">{gameMessageLog}</div>
      </ResizableDesktopLogPanel>
    ) : null;

  return {
    gameMessageLog,
    desktopGameMessageLog,
  } as const;
}

// Stay pinned to the newest line unless the reader scrolled up to look back.
const stickToBottomThresholdPx = 24;

interface MessageLogScrollProps {
  readonly closeButton: ReactNode;
  /** Newest first, as the engine keeps them. */
  readonly messages: readonly string[];
  /** Turn of each entry of `messages` (same order). */
  readonly turns: readonly (number | null)[];
}

/** Message log, oldest at the top and each new line added at the bottom. */
function MessageLogScroll({ closeButton, messages, turns }: MessageLogScrollProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const scrollToBottom = (): void => {
    const element = scrollRef.current;
    if (element && stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  };

  useLayoutEffect(scrollToBottom, [messages]);

  // Resizing the panel (drag handle, mobile expand/collapse) keeps the newest line in view.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    stickToBottomRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight <=
      stickToBottomThresholdPx;
  };

  const lines: JSX.Element[] = [];
  let previousTurn: number | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const turn = turns[index] ?? null;
    // Several lines from one turn show the number once, on the first of them.
    const turnStarts = turn !== null && turn !== previousTurn;
    previousTurn = turn;
    lines.push(
      <div
        className={`nh3d-message-log-line${turnStarts ? " nh3d-message-log-turn-start" : ""}`}
        key={`${index}-${message}`}
      >
        <span className="nh3d-message-log-turn">{turnStarts ? turn : ""}</span>
        <span className="nh3d-message-log-text"><GameMessageText message={message} /></span>
      </div>,
    );
  }

  return (
    <div
      className="nh3d-message-log-scroll"
      data-nh3d-overflow-glow
      data-nh3d-overflow-glow-host="parent"
      id="game-log"
      onScroll={handleScroll}
      ref={scrollRef}
    >
      {closeButton}
      {lines}
    </div>
  );
}
