import type { PortraitScene } from "../../runtime/local/messages/portrait-dialog";

export interface VisiblePortrait extends PortraitScene {
  preview?: string | null;
  acknowledge(answer?: string): void;
}

let current: VisiblePortrait | null = null;
const listeners = new Set<() => void>();
export const portraitSnapshot = () => current;
export function subscribePortrait(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setPortrait(scene: VisiblePortrait | null) {
  current = scene;
  for (const listener of listeners) listener();
}
