/**
 * Inventory-screen operations, run by the core's internal #nh3dinventory
 * command (core/NetHack/win/shim/nh3d_knowledge.c). The shell holds an
 * operation until the next ordinary command prompt, leaves it in
 * nethackGlobal.nh3dInventoryRequest and sends M-^I; the core answers the
 * real command's prompts itself and runs it.
 */

/** Protocol input carrying one encoded operation ("__NH3D_INVOP__:wear:c"). */
export const inventoryOperationInputPrefix = "__NH3D_INVOP__:";

/** M-^I, bound to #nh3dinventory in the core (cmd.c). */
export const inventoryOperationKeyCode = 0x89;

export type InventoryOperation =
  | { readonly op: "adjust"; readonly from: string; readonly to: string }
  | { readonly op: "wear" | "takeoff" | "remove"; readonly item: string }
  | { readonly op: "puton"; readonly item: string; readonly hand?: "left" | "right" }
  /** item "-" empties the hands or the quiver. */
  | { readonly op: "wield" | "quiver"; readonly item: string }
  /** Ready the item as the alternate (off-hand) weapon, leaving the hand alone. */
  | { readonly op: "alternate"; readonly item: string }
  /** altunwield empties the alternate weapon (#altunwield); sort gives the letters out again in class order (no time, like #adjust). */
  | { readonly op: "swap" | "twoweapon" | "altunwield" | "sort" }
  /** Write NetHack's checkpoint files now, without taking a turn (trial save slots). */
  | { readonly op: "checkpoint" }
  /** count 0 (or none) means the whole stack. */
  | { readonly op: "pickup" | "drop"; readonly items: readonly InventoryOperationItem[] }
  /** Open a carried or floor container, take out `out`, then put in `in`, in one action. */
  | { readonly op: "loot"; readonly container: number; readonly out: readonly number[]; readonly in: readonly number[] };

export interface InventoryOperationItem {
  /** The game's object id. */
  readonly id: number;
  readonly count?: number;
}

const isId = (value: number) => Number.isInteger(value) && value > 0 && value < 2 ** 32;
const encodeItems = (items: readonly InventoryOperationItem[]) =>
  items
    .map((item) => (item.count && item.count > 0 ? `${item.id}x${Math.trunc(item.count)}` : `${item.id}`))
    .join(",");

const isInventoryLetter = (value: string) => /^[a-zA-Z$]$/.test(value);
const isItemOrHands = (value: string) => isInventoryLetter(value) || value === "-";

/** The core's request string ("adjust:a:q"); null for an operation the core would refuse. */
export function encodeInventoryOperation(operation: InventoryOperation): string | null {
  switch (operation.op) {
    case "adjust":
      return isInventoryLetter(operation.from) && isInventoryLetter(operation.to) && operation.from !== operation.to
        ? `adjust:${operation.from}:${operation.to}`
        : null;
    case "wear":
    case "takeoff":
    case "remove":
    case "alternate":
      return isInventoryLetter(operation.item) ? `${operation.op}:${operation.item}` : null;
    case "puton":
      if (!isInventoryLetter(operation.item)) return null;
      return operation.hand
        ? `puton:${operation.item}:${operation.hand === "left" ? "l" : "r"}`
        : `puton:${operation.item}`;
    case "wield":
    case "quiver":
      return isItemOrHands(operation.item) ? `${operation.op}:${operation.item}` : null;
    case "swap":
    case "twoweapon":
    case "altunwield":
    case "sort":
    case "checkpoint":
      return operation.op;
    case "pickup":
    case "drop":
      if (operation.items.length === 0 || operation.items.length > 128) return null;
      if (!operation.items.every((item) => isId(item.id))) return null;
      return `${operation.op}:${encodeItems(operation.items)}`;
    case "loot":
      if (!isId(operation.container)) return null;
      if (operation.out.length + operation.in.length > 128) return null;
      if (![...operation.out, ...operation.in].every(isId)) return null;
      return `loot:${operation.container}:${operation.out.join(",")}:${operation.in.join(",")}`;
    default:
      return null;
  }
}

/** Accepts only what encodeInventoryOperation produces. */
export function isInventoryOperationRequest(request: string): boolean {
  if (request.length > 2000) return false;
  return /^(adjust:[a-zA-Z$]:[a-zA-Z$]|(wear|takeoff|remove|alternate):[a-zA-Z$]|puton:[a-zA-Z$](:[lr])?|(wield|quiver):[a-zA-Z$-]|swap|twoweapon|altunwield|sort|checkpoint|(pickup|drop):\d+(x\d+)?(,\d+(x\d+)?)*|loot:\d+:(\d+(,\d+)*)?:(\d+(,\d+)*)?)$/.test(
    request,
  );
}
