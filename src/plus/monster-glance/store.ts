// Polypiled: the hover label over a map square. The core lists the monsters
// the hero sees (src/runtime/monster-glance.ts) and what the hero knows of
// each square (src/runtime/square-glance.ts); the mouse handler reports
// which map square the pointer rests on.
import { useSyncExternalStore } from "react";
import type { GlancedMonster } from "../../runtime/monster-glance";
import type { GlancedSquare } from "../../runtime/square-glance";

export interface MonsterGlanceLabel {
  readonly monster: GlancedMonster | null;
  readonly square: GlancedSquare | null;
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
let squares = new Map<number, GlancedSquare>();
let pointer: Pointer | null = null;
let label: MonsterGlanceLabel | null = null;
const listeners = new Set<() => void>();

const squareKey = (x: number, y: number): number => y * 256 + x;

function update(): void {
  let next: MonsterGlanceLabel | null = null;
  if (pointer) {
    const { tileX, tileY } = pointer;
    const monster = monsters.find((m) => m.x === tileX && m.y === tileY) ?? null;
    const square = squares.get(squareKey(tileX, tileY)) ?? null;
    if (monster || square) next = { monster, square, clientX: pointer.clientX, clientY: pointer.clientY };
  }
  if (
    next === label ||
    (next && label && next.monster === label.monster && next.square === label.square &&
      next.clientX === label.clientX && next.clientY === label.clientY)
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

export function setGlancedSquares(list: readonly GlancedSquare[]): void {
  const next = new Map<number, GlancedSquare>();
  for (const square of list) {
    // Keep the old object for an unchanged square so the label does not re-render.
    const key = squareKey(square.x, square.y);
    const old = squares.get(key);
    next.set(
      key,
      old && old.ground === square.ground && old.feature === square.feature &&
        old.trap === square.trap && old.object === square.object
        ? old
        : square,
    );
  }
  squares = next;
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
  squares = new Map();
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
