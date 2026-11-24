import type { PortraitScene } from "../../runtime/local/messages/portrait-dialog";

export interface VisiblePortrait extends PortraitScene {
  preview?: string | null;
  /** The game has moved past this page; it only stays up to frame the conversation. */
  acknowledged?: boolean;
  acknowledge(answer?: string): void;
}

let current: VisiblePortrait | null = null;
const listeners = new Set<() => void>();
export const portraitSnapshot = () => current;
export function subscribePortrait(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function markPortraitAcknowledged() {
  if (current && !current.acknowledged) setPortrait({ ...current, acknowledged: true });
}

/** A game prompt took over: a conversation page the game already moved past must not cover it. */
export function releaseAcknowledgedPortrait() {
  if (current?.acknowledged) setPortrait(null);
}

export function setPortrait(scene: VisiblePortrait | null) {
  current = scene;
  for (const listener of listeners) listener();
}
