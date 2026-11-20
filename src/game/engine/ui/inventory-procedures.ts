import {
  encodeInventoryOperation,
  inventoryOperationInputPrefix,
  type InventoryOperation,
} from "../../../runtime/input/inventory-operation";
import type { InventoryState } from "../../../runtime/inventory-state";
import type { KnowledgeMonster } from "../../../runtime/knowledge";

/**
 * Multi-step inventory plans (taking off a cloak to change body armor, an
 * equipment set, reaching into a bag inside a bag) run one game command at
 * a time: each step goes to the core at a command prompt, and the next is
 * chosen only after the game asks for a command again
 * ("inventory_operation_settled"), from the inventory as it is then.
 *
 * A plan stops when it is done, when a step changed nothing (a curse, a
 * refusal: the game has said why), when a hostile the hero did not see at
 * the start comes into view, or when cancelled.
 */

export type InventoryProcedureStatus = "running" | "done" | "failed" | "interrupted" | "cancelled";

export interface InventoryProcedureState {
  readonly label: string;
  readonly status: InventoryProcedureStatus;
  /** Steps sent so far. */
  readonly steps: number;
}

export interface InventoryProcedure {
  readonly label: string;
  /** The next step from the inventory as it is now; null when nothing is left. */
  next(state: InventoryState, stepIndex: number): InventoryOperation | null;
}

export interface InventoryProceduresDependencies {
  sendInput(input: string): void;
  latestInventoryState(): InventoryState | null;
  visibleMonsters(): readonly KnowledgeMonster[];
  publish(state: InventoryProcedureState | null): void;
}

const MAX_STEPS = 40;

/** What a step can change: letters, wear, quantities, contents and the floor. */
function inventorySignature(state: InventoryState | null): string {
  if (!state) return "";
  const describe = (objects: InventoryState["objects"]): unknown =>
    objects.map((object) => [
      object.id,
      object.letter,
      object.wornMask,
      object.quantity,
      object.donning,
      object.container?.contents ? describe(object.container.contents) : object.container ? "?" : null,
    ]);
  return JSON.stringify([describe(state.objects), describe(state.floor), state.twoWeapon]);
}

function hostiles(monsters: readonly KnowledgeMonster[]): Set<number> {
  const ids = new Set<number>();
  for (const monster of monsters) {
    if (monster.hero || monster.pet || monster.peaceful || monster.id === null) continue;
    if (monster.sense === "warning" || monster.sense === "remembered-invisible") continue;
    ids.add(monster.id);
  }
  return ids;
}

export class InventoryProcedures {
  private procedure: InventoryProcedure | null = null;
  private steps = 0;
  private waiting = false;
  private lastSignature = "";
  private hostilesAtStart = new Set<number>();

  constructor(private readonly deps: InventoryProceduresDependencies) {}

  get running(): boolean {
    return this.procedure !== null;
  }

  /** Sends one operation without waiting for the ones before it. */
  send(operation: InventoryOperation): boolean {
    const request = encodeInventoryOperation(operation);
    if (!request) return false;
    this.deps.sendInput(`${inventoryOperationInputPrefix}${request}`);
    return true;
  }

  start(procedure: InventoryProcedure): void {
    if (this.procedure) this.finish("cancelled");
    this.procedure = procedure;
    this.steps = 0;
    this.waiting = false;
    this.hostilesAtStart = hostiles(this.deps.visibleMonsters());
    this.step();
  }

  cancel(): void {
    if (this.procedure) this.finish("cancelled");
  }

  /** The game asks for a command again after a step. */
  onSettled(): void {
    if (!this.procedure || !this.waiting) return;
    this.waiting = false;
    const state = this.deps.latestInventoryState();
    if (inventorySignature(state) === this.lastSignature) {
      this.finish("failed");
      return;
    }
    for (const id of hostiles(this.deps.visibleMonsters())) {
      if (!this.hostilesAtStart.has(id)) {
        this.finish("interrupted");
        return;
      }
    }
    this.step();
  }

  /** The game ended or restarted. */
  reset(): void {
    this.procedure = null;
    this.waiting = false;
    this.deps.publish(null);
  }

  private step(): void {
    const procedure = this.procedure;
    const state = this.deps.latestInventoryState();
    if (!procedure || !state) {
      this.finish("failed");
      return;
    }
    if (this.steps >= MAX_STEPS) {
      this.finish("failed");
      return;
    }
    const operation = procedure.next(state, this.steps);
    if (!operation) {
      this.finish("done");
      return;
    }
    this.lastSignature = inventorySignature(state);
    if (!this.send(operation)) {
      this.finish("failed");
      return;
    }
    this.steps++;
    this.waiting = true;
    this.deps.publish({ label: procedure.label, status: "running", steps: this.steps });
  }

  private finish(status: Exclude<InventoryProcedureStatus, "running">): void {
    const procedure = this.procedure;
    this.procedure = null;
    this.waiting = false;
    if (procedure) this.deps.publish({ label: procedure.label, status, steps: this.steps });
  }
}

/** A plan of fixed steps (the screen worked them out from what it saw). */
export function fixedProcedure(label: string, operations: readonly InventoryOperation[]): InventoryProcedure {
  return {
    label,
    next: (_state, stepIndex) => operations[stepIndex] ?? null,
  };
}
