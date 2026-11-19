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
  | { readonly op: "swap" | "twoweapon" };

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
      return operation.op;
    default:
      return null;
  }
}

/** Accepts only what encodeInventoryOperation produces. */
export function isInventoryOperationRequest(request: string): boolean {
  return /^(adjust:[a-zA-Z$]:[a-zA-Z$]|(wear|takeoff|remove):[a-zA-Z$]|puton:[a-zA-Z$](:[lr])?|(wield|quiver):[a-zA-Z$-]|swap|twoweapon)$/.test(
    request,
  );
}
