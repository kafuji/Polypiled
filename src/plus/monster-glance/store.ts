// Polypiled: the hover label over a monster on the map. The core lists the
// monsters the hero sees (src/runtime/monster-glance.ts); the mouse handler
// reports which map square the pointer rests on.
import { useSyncExternalStore } from "react";
import type { GlancedMonster } from "../../runtime/monster-glance";

export interface MonsterGlanceLabel {
  readonly monster: GlancedMonster;
  readonly clientX: number;
  readonly clientY: number;
}

interface Pointer {
  readonly tileX: number;
  readonly tileY: number;
  readonly clientX: number;
  readonly clientY: number;
}

let monsters: readonly GlancedMonster[] = [];
let pointer: Pointer | null = null;
let label: MonsterGlanceLabel | null = null;
const listeners = new Set<() => void>();

function update(): void {
  const monster = pointer ? monsters.find((m) => m.x === pointer!.tileX && m.y === pointer!.tileY) : undefined;
  const next = monster && pointer ? { monster, clientX: pointer.clientX, clientY: pointer.clientY } : null;
  if (
    next === label ||
    (next && label && next.monster === label.monster && next.clientX === label.clientX && next.clientY === label.clientY)
  ) {
    return;
  }
  label = next;
  for (const listener of listeners) listener();
}

export function setGlancedMonsters(list: readonly GlancedMonster[]): void {
  monsters = list;
  update();
}

/** The map square under the pointer, or null when the pointer is off the map. */
export function setGlancePointer(next: Pointer | null): void {
  if (
    pointer === next ||
    (pointer && next && pointer.tileX === next.tileX && pointer.tileY === next.tileY &&
      pointer.clientX === next.clientX && pointer.clientY === next.clientY)
  ) {
    return;
  }
  pointer = next;
  update();
}

export function resetMonsterGlance(): void {
  monsters = [];
  pointer = null;
  update();
}

export function monsterGlanceSnapshot(): MonsterGlanceLabel | null {
  return label;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMonsterGlance(): MonsterGlanceLabel | null {
  return useSyncExternalStore(subscribe, monsterGlanceSnapshot, monsterGlanceSnapshot);
}
