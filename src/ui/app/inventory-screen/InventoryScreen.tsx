import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type * as React from "react";
import { useI18n } from "../../../i18n";
import { translateInventoryItem } from "../../../i18n/inventory-text";
import type { InventoryObject, InventoryState } from "../../../runtime/inventory-state";
import { useGameStore } from "../../../state/gameStore";
import type { Nethack3DEngineController } from "../../../game/ui-types";
import { fixedProcedure, type InventoryProcedureState } from "../../../game/engine/ui/inventory-procedures";
import { inventoryCategoryActionBlocklist, inventoryContextActions } from "../inventory/actions";
import { t } from "../shared/translations";
import {
  type ContainerStaging,
  type DropPlan,
  type EquipmentSlotId,
  ObjectClass,
  categoryOf,
  equipmentSlotLayout,
  estimateTurns,
  findContainer,
  goldLetter,
  inventoryGridLetters,
  isContainerLike,
  isEquipped,
  objectInSlot,
  objectsByLetter,
  planContainer,
  planDrop,
  planEquip,
  planMove,
  planNested,
  planPickup,
  planToggle,
  planUnequip,
  slotsFor,
  weightSummary,
} from "./model";
import {
  EQUIPMENT_SET_COUNT,
  type EquipmentSet,
  cycleSetSlot,
  equipmentSetProcedure,
  loadEquipmentSets,
  missingFromSet,
  recordEquipmentSet,
  saveEquipmentSets,
} from "./equipment-sets";

export interface InventoryScreenProps {
  renderTilePreview: (tileIndex: number | null) => React.ReactNode;
  reducedMotion: boolean;
}

/** Where a dragged object comes from. */
type DragSource =
  | { kind: "pack"; object: InventoryObject }
  | { kind: "floor"; object: InventoryObject }
  /** contents of the open container */
  | { kind: "content"; object: InventoryObject; containerId: number }
  /** contents of a container inside the open container */
  | { kind: "inner"; object: InventoryObject; containerId: number; innerId: number };

type DropTarget =
  | { kind: "slot"; slot: EquipmentSlotId }
  | { kind: "letter"; letter: string }
  | { kind: "grid" }
  | { kind: "floor" }
  | { kind: "container" }
  | { kind: "inner"; innerId: number };

const classSymbols: Record<number, string> = {
  [ObjectClass.weapon]: ")", [ObjectClass.armor]: "[", [ObjectClass.ring]: "=", [ObjectClass.amulet]: "\"",
  [ObjectClass.tool]: "(", [ObjectClass.food]: "%", [ObjectClass.potion]: "!", [ObjectClass.scroll]: "?",
  [ObjectClass.spellbook]: "+", [ObjectClass.wand]: "/", [ObjectClass.coin]: "$", [ObjectClass.gem]: "*",
  [ObjectClass.rock]: "`", [ObjectClass.ball]: "0", [ObjectClass.chain]: "_", [ObjectClass.venom]: ".",
};

const DRAG_START_DISTANCE_PX = 6;
const LONG_PRESS_MS = 550;
const PROCEDURE_NOTICE_MS = 5000;

/**
 * Item-menu actions that take no game time keep the screen open; every
 * other one (apply, invoke, read, eat, quaff, zap, throw, drop, ...) closes
 * it. Equipping and rearranging by drag keep it open too.
 */
export const menuActionsThatKeepScreenOpen: ReadonlySet<string> = new Set(["info", "name", "call", "adjust"]);

function parseDropTarget(element: Element | null): DropTarget | null {
  const host = element?.closest<HTMLElement>("[data-invs-drop]");
  const value = host?.dataset.invsDrop;
  if (!value) return null;
  if (value === "grid" || value === "floor" || value === "container") return { kind: value };
  const [kind, id] = value.split(":");
  if (kind === "slot" && id) return { kind: "slot", slot: id as EquipmentSlotId };
  if (kind === "letter" && id) return { kind: "letter", letter: id };
  if (kind === "inner" && id) return { kind: "inner", innerId: Number(id) };
  return null;
}

const sameTarget = (a: DropTarget | null, b: DropTarget) =>
  !!a && JSON.stringify(a) === JSON.stringify(b);

/** What a drop means: commands, or a change to the open container's staging. */
type DropResult =
  | { kind: "plan"; plan: DropPlan; label: string; confirm?: boolean }
  | { kind: "stage"; out?: number; in?: number }
  | { kind: "notice"; text: string }
  | { kind: "none" };

function resolveDrop(
  state: InventoryState,
  source: DragSource,
  target: DropTarget,
  openContainer: InventoryObject | null,
): DropResult {
  const strings = t.inventoryScreen;
  const { object } = source;
  const plan = (value: DropPlan, label = strings.planEquip, confirm = false): DropResult =>
    value.operations.length > 0 || value.unsupported ? { kind: "plan", plan: value, label, confirm } : { kind: "none" };
  switch (source.kind) {
    case "pack":
      switch (target.kind) {
        case "slot":
          return plan(planEquip(state, object, target.slot));
        case "letter":
          return plan(isEquipped(object) ? planUnequip(object) : planMove(object, target.letter));
        case "grid":
          return isEquipped(object) ? plan(planUnequip(object)) : { kind: "none" };
        case "floor":
          return plan(planDrop(object));
        case "container":
          if (!openContainer || openContainer.id === object.id) return { kind: "none" };
          return { kind: "stage", in: object.id };
        case "inner": {
          if (!openContainer || target.innerId === object.id) return { kind: "none" };
          const inner = openContainer.container?.contents?.find((inside) => inside.id === target.innerId);
          return inner ? plan(planNested(openContainer, inner, { in: [object.id] }), strings.planNested, true) : { kind: "none" };
        }
      }
      return { kind: "none" };
    case "floor":
      if (target.kind === "slot" || target.kind === "letter" || target.kind === "grid") return plan(planPickup([object]));
      if (target.kind === "container" || target.kind === "inner") return { kind: "notice", text: strings.floorToContainer };
      return { kind: "none" };
    case "content":
      if (target.kind === "letter" || target.kind === "grid" || target.kind === "slot") return { kind: "stage", out: object.id };
      if (target.kind === "floor") return { kind: "notice", text: strings.containerToFloor };
      return { kind: "none" };
    case "inner": {
      if (!(target.kind === "letter" || target.kind === "grid" || target.kind === "slot") || !openContainer) return { kind: "none" };
      const inner = openContainer.container?.contents?.find((inside) => inside.id === source.innerId);
      return inner ? plan(planNested(openContainer, inner, { out: [object.id] }), strings.planNested, true) : { kind: "none" };
    }
  }
}

function itemClasses(object: InventoryObject): string {
  const classes = ["nh3d-invs-item"];
  if (object.buc) classes.push(`is-${object.buc}`);
  if (object.eroded) classes.push("is-eroded");
  if (object.eroded2) classes.push("is-eroded2");
  if (object.erodeproof) classes.push("is-erodeproof");
  if (object.lit) classes.push("is-lit");
  if (object.greased) classes.push("is-greased");
  if (object.unpaid) classes.push("is-unpaid");
  return classes.join(" ");
}

function badgeText(object: InventoryObject): string | null {
  if (object.enchantment !== null) return `${object.enchantment >= 0 ? "+" : ""}${object.enchantment}`;
  if (object.charges !== null) return `${object.recharged ?? 0}:${object.charges}`;
  return null;
}

function erosionText(object: InventoryObject): string[] {
  const strings = t.inventoryScreen;
  const levels = [strings.erosionLevel.plain, strings.erosionLevel.very, strings.erosionLevel.thoroughly];
  const lines: string[] = [];
  for (const erosion of [object.eroded, object.eroded2]) {
    if (!erosion) continue;
    const word = (strings.erosion as Record<string, string>)[erosion.kind] ?? erosion.kind;
    lines.push(`${levels[erosion.level - 1] ?? ""}${word}`);
  }
  return lines;
}

function detailLines(object: InventoryObject): string[] {
  const strings = t.inventoryScreen;
  const lines: string[] = [];
  if (object.buc) lines.push(strings.buc[object.buc]);
  lines.push(...erosionText(object));
  if (object.erodeproof) lines.push(strings.erodeproof);
  if (object.poisoned) lines.push(strings.poisoned);
  if (object.greased) lines.push(strings.greased);
  if (object.lit) lines.push(strings.lit);
  if (object.unpaid) lines.push(strings.unpaid);
  if (object.container) {
    const contents = object.container.contents;
    if (object.container.locked) lines.push(strings.locked);
    lines.push(
      contents === null
        ? strings.contentsUnknown
        : contents.length + object.container.more === 0
          ? strings.contentsEmpty
          : strings.contents(contents.length + object.container.more),
    );
  }
  if (object.weight !== null) lines.push(strings.itemWeight(object.weight));
  return lines;
}

function levelName(level: number): string {
  const names = t.inventoryScreen.encumbrance;
  return [names.unencumbered, names.burdened, names.stressed, names.strained, names.overtaxed, names.overloaded][level] ?? "";
}

function procedureText(state: InventoryProcedureState): string {
  const strings = t.inventoryScreen;
  switch (state.status) {
    case "running": return strings.procRunning(state.label);
    case "done": return strings.procDone(state.label);
    case "failed": return strings.procFailed(state.label);
    case "interrupted": return strings.procInterrupted(state.label);
    case "cancelled": return strings.procCancelled(state.label);
  }
}

function runPlan(controller: Nethack3DEngineController | null, plan: DropPlan, label: string) {
  if (!controller || plan.operations.length === 0) return;
  if (plan.operations.length === 1) controller.runInventoryOperation(plan.operations[0]);
  else controller.runInventoryProcedure(fixedProcedure(label, plan.operations));
}

/**
 * The inventory screen: equipment slots around the body with equipment
 * sets, the 52 letter slots of the inventory (a slot's position is the
 * item's letter), what lies here, an open container, and the carried
 * weight. Every change is a game command run through the core; the screen
 * only shows what the game reports.
 */
export function InventoryScreen(props: InventoryScreenProps) {
  const open = useGameStore((state) => state.inventoryScreenOpen);
  const inventory = useGameStore((state) => state.inventoryState);
  const controller = useGameStore((state) => state.engineController);
  const procedure = useGameStore((state) => state.inventoryProcedure);
  const gameId = inventory?.gameId ?? null;
  const [sets, setSets] = useState<(EquipmentSet | null)[]>(() => loadEquipmentSets(gameId));
  useEffect(() => setSets(loadEquipmentSets(gameId)), [gameId]);
  const updateSets = useCallback(
    (next: (EquipmentSet | null)[]) => {
      setSets(next);
      saveEquipmentSets(gameId, next);
    },
    [gameId],
  );

  // F1-F6 put on a set from anywhere in play
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const match = /^F([1-6])$/.exec(event.key);
      if (!match || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const store = useGameStore.getState();
      if (!store.inventoryState || store.question || store.directionQuestion) return;
      const set = sets[Number(match[1]) - 1];
      if (!set || !store.engineController) return;
      event.preventDefault();
      event.stopPropagation();
      store.engineController.runInventoryProcedure(equipmentSetProcedure(set, set.name || t.inventoryScreen.setDefaultName(Number(match[1]))));
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [sets]);

  if (!open || !inventory) return null;
  return (
    <InventoryScreenView
      {...props}
      inventory={inventory}
      controller={controller}
      procedure={procedure}
      sets={sets}
      onSetsChange={updateSets}
    />
  );
}

interface PressState {
  source: DragSource;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  dragging: boolean;
  shift: boolean;
  longPressTimer: number | null;
}

interface MenuState {
  object: InventoryObject;
  x: number;
  y: number;
}

interface CountPrompt {
  object: InventoryObject;
  make: (count: number) => DropPlan;
  label: string;
}

interface ConfirmPrompt {
  plan: DropPlan;
  label: string;
}

const emptySets: (EquipmentSet | null)[] = Array.from({ length: EQUIPMENT_SET_COUNT }, () => null);

const MENU_MARGIN_PX = 8;

/**
 * The item menu, drawn on the body: the screen's frame neither clips nor
 * shifts it. Its actions wrap into columns, and it is moved back inside
 * the window when it would stick out.
 */
function ItemMenu({ x, y, title, onDismiss, children }: {
  x: number;
  y: number;
  title: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(MENU_MARGIN_PX, Math.min(x, window.innerWidth - width - MENU_MARGIN_PX));
    const top = y + height + MENU_MARGIN_PX > window.innerHeight
      ? Math.max(MENU_MARGIN_PX, Math.min(y - height, window.innerHeight - height - MENU_MARGIN_PX))
      : y;
    setPosition({ left, top });
  }, [x, y]);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [onDismiss]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      className="nh3d-invs-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="nh3d-invs-menu-title">{title}</div>
      <div className="nh3d-invs-menu-actions">{children}</div>
    </div>,
    document.body,
  );
}

export function InventoryScreenView({
  inventory,
  controller,
  renderTilePreview,
  reducedMotion,
  procedure = null,
  sets = emptySets,
  onSetsChange = () => undefined,
}: InventoryScreenProps & {
  inventory: InventoryState;
  controller: Nethack3DEngineController | null;
  procedure?: InventoryProcedureState | null;
  sets?: (EquipmentSet | null)[];
  onSetsChange?: (sets: (EquipmentSet | null)[]) => void;
}) {
  const { locale } = useI18n();
  const strings = t.inventoryScreen;
  const name = useCallback((object: InventoryObject) => translateInventoryItem(object.name, locale), [locale]);
  const byLetter = useMemo(() => objectsByLetter(inventory), [inventory]);
  const gold = byLetter.get(goldLetter) ?? null;
  /** Chosen by a click or focus; the detail line follows the pointer over others. */
  const [focused, setFocused] = useState<InventoryObject | null>(null);
  const [hovered, setHovered] = useState<InventoryObject | null>(null);
  const [held, setHeld] = useState<DragSource | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DropTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [staging, setStaging] = useState<ContainerStaging | null>(null);
  const [countPrompt, setCountPrompt] = useState<CountPrompt | null>(null);
  const [countValue, setCountValue] = useState("1");
  const [confirm, setConfirm] = useState<ConfirmPrompt | null>(null);
  const [editingSet, setEditingSet] = useState<number | null>(null);
  const [procedureNotice, setProcedureNotice] = useState<InventoryProcedureState | null>(null);
  const pressRef = useRef<PressState | null>(null);
  const suppressClickRef = useRef(false);

  const findObject = useCallback(
    (id: number): InventoryObject | null => {
      for (const object of [...inventory.objects, ...inventory.floor]) {
        if (object.id === id) return object;
        for (const inside of object.container?.contents ?? []) {
          if (inside.id === id) return inside;
          for (const deeper of inside.container?.contents ?? []) if (deeper.id === id) return deeper;
        }
      }
      return null;
    },
    [inventory],
  );
  const openContainer = staging ? findContainer(inventory, staging.containerId) : null;
  const focusedObject = focused ? findObject(focused.id) : null;
  const heldObject = held ? findObject(held.object.id) : null;
  const activeSource: DragSource | null = dragSource ?? (held && heldObject ? { ...held, object: heldObject } : null);

  // the report replaces objects: forget what no longer exists
  useEffect(() => {
    if (staging && !openContainer) setStaging(null);
    else if (staging) {
      const contents = new Set((openContainer?.container?.contents ?? []).map((inside) => inside.id));
      const carried = new Set(inventory.objects.map((object) => object.id));
      const out = staging.out.filter((id) => contents.has(id));
      const into = staging.in.filter((id) => carried.has(id));
      if (out.length !== staging.out.length || into.length !== staging.in.length) setStaging({ ...staging, out, in: into });
    }
    if (held && !heldObject) setHeld(null);
  }, [inventory, staging, openContainer, held, heldObject]);

  // a finished plan stays on screen for a moment
  useEffect(() => {
    if (!procedure) return undefined;
    setProcedureNotice(procedure);
    if (procedure.status === "running") return undefined;
    const timer = window.setTimeout(() => setProcedureNotice(null), PROCEDURE_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [procedure]);

  const commitStaging = useCallback(
    (current: ContainerStaging | null) => {
      if (!current || (current.out.length === 0 && current.in.length === 0)) return;
      runPlan(controller, planContainer(current), strings.planEquip);
    },
    [controller, strings],
  );

  const openContainerPanel = (object: InventoryObject) => {
    if (staging?.containerId === object.id) return;
    commitStaging(staging);
    setStaging({ containerId: object.id, out: [], in: [] });
  };

  const closeContainerPanel = () => {
    commitStaging(staging);
    setStaging(null);
  };

  const apply = useCallback(
    (source: DragSource, target: DropTarget, shift: boolean) => {
      const result = resolveDrop(inventory, source, target, openContainer);
      setNotice(null);
      if (result.kind === "notice") {
        setNotice(result.text);
        return;
      }
      if (result.kind === "stage") {
        if (!staging) return;
        const next = {
          ...staging,
          out: result.out !== undefined ? [...new Set([...staging.out, result.out])] : staging.out.filter((id) => id !== result.in),
          in: result.in !== undefined ? [...new Set([...staging.in, result.in])] : staging.in.filter((id) => id !== result.out),
        };
        // moving back where it came from undoes the staging
        if (result.out !== undefined && staging.in.includes(result.out)) next.out = next.out.filter((id) => id !== result.out);
        setStaging(next);
        return;
      }
      if (result.kind !== "plan") return;
      if (result.plan.unsupported) {
        setNotice(strings.unsupported);
        return;
      }
      const object = source.object;
      if (shift && object.quantity > 1 && (source.kind === "floor" || (source.kind === "pack" && target.kind === "floor"))) {
        setCountValue(String(object.quantity));
        setCountPrompt({
          object,
          label: strings.planEquip,
          make: (count) => (source.kind === "floor" ? planPickup([object], count) : planDrop(object, count)),
        });
        return;
      }
      if (result.confirm) {
        setConfirm({ plan: result.plan, label: result.label });
        return;
      }
      runPlan(controller, result.plan, result.label);
    },
    [controller, inventory, openContainer, staging, strings],
  );

  // pointer: drag to move, tap to pick up and place, long press for the menu
  const onPointerMove = useCallback((event: PointerEvent) => {
    const press = pressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < DRAG_START_DISTANCE_PX) return;
      press.dragging = true;
      if (press.longPressTimer !== null) window.clearTimeout(press.longPressTimer);
      setHeld(null);
      setDragSource(press.source);
    }
    press.shift = event.shiftKey;
    setGhost({ x: event.clientX, y: event.clientY });
    setHoverTarget(parseDropTarget(document.elementFromPoint(event.clientX, event.clientY)));
  }, []);

  const endPress = useCallback(() => {
    const press = pressRef.current;
    if (press?.longPressTimer !== null && press?.longPressTimer !== undefined) window.clearTimeout(press.longPressTimer);
    pressRef.current = null;
    setGhost(null);
    setHoverTarget(null);
    setDragSource(null);
    window.removeEventListener("pointermove", onPointerMove);
  }, [onPointerMove]);

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const press = pressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (press.dragging) {
        suppressClickRef.current = true;
        const target = parseDropTarget(document.elementFromPoint(event.clientX, event.clientY));
        const object = findObject(press.source.object.id);
        if (target && object) apply({ ...press.source, object }, target, press.shift || event.shiftKey);
      }
      endPress();
    },
    [apply, endPress, findObject],
  );

  useEffect(() => () => endPress(), [endPress]);

  const openMenuAt = (object: InventoryObject, x: number, y: number) => {
    if (!object.letter) return;
    setHeld(null);
    setMenu({ object, x, y });
  };

  const beginPress = (event: React.PointerEvent, source: DragSource) => {
    if (event.button !== 0) return;
    const press: PressState = {
      source,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      shift: event.shiftKey,
      longPressTimer: null,
    };
    if (event.pointerType !== "mouse") {
      const { clientX, clientY } = event;
      press.longPressTimer = window.setTimeout(() => {
        if (pressRef.current !== press || press.dragging) return;
        suppressClickRef.current = true;
        openMenuAt(source.object, clientX, clientY);
      }, LONG_PRESS_MS);
    }
    pressRef.current = press;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", endPress, { once: true });
  };

  // A click or tap only chooses (moving starts with a drag). Enter or the
  // pad's confirm (a click with no pointer, detail 0) picks up, then places
  // on a slot, letter, the floor or the open container.
  const activate = (target: DropTarget, source: DragSource | null, viaPointer: boolean) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setMenu(null);
    if (viaPointer) {
      setHeld(null);
      setFocused(source?.object ?? null);
      return;
    }
    if (held && heldObject) {
      if (source && source.object.id === heldObject.id) {
        setHeld(null);
        return;
      }
      apply({ ...held, object: heldObject }, target, false);
      setHeld(null);
      return;
    }
    if (source) setHeld(source);
  };

  const toggle = (source: DragSource) => {
    setHeld(null);
    const object = source.object;
    if (isContainerLike(object) && (source.kind === "pack" || source.kind === "floor")) {
      openContainerPanel(object);
      return;
    }
    if (source.kind !== "pack") return;
    const plan = planToggle(inventory, object);
    if (plan.unsupported) setNotice(strings.unsupported);
    else runPlan(controller, plan, strings.planEquip);
  };

  const runMenuAction = (actionId: string) => {
    const object = menu ? findObject(menu.object.id) : null;
    setMenu(null);
    if (!object?.letter || !controller) return;
    const action = inventoryContextActions.find((entry) => entry.id === actionId);
    if (!action) return;
    // using an item (apply, invoke, read, eat, zap, ...) takes time and
    // usually needs the map: the screen gets out of the way at once
    if (!menuActionsThatKeepScreenOpen.has(action.id)) {
      closeContainerPanel();
      controller.closeInventoryScreen();
    }
    if (action.kind === "extended" && action.value) {
      if (action.armInventorySelection !== false) {
        controller.sendInput(`__INVCTX_SELECT__:${object.letter}:${action.id}`);
      }
      controller.runExtendedCommand(action.value, { forceHashSubmission: true });
    } else {
      controller.runInventoryItemAction(action.id, object.letter);
    }
  };

  // equipment sets
  const setLabel = (index: number) => sets[index]?.name || strings.setDefaultName(index + 1);
  const applySet = (index: number) => {
    const set = sets[index];
    if (!set || !controller) return;
    const missing = missingFromSet(inventory, set);
    setNotice(missing.length > 0 ? strings.setMissing(missing.length) : null);
    controller.runInventoryProcedure(equipmentSetProcedure(set, setLabel(index)));
  };
  const writeSet = (index: number, set: EquipmentSet | null) => {
    const next = [...sets];
    next[index] = set;
    onSetsChange(next);
  };
  const onSetButton = (index: number) => {
    if (editingSet !== null) {
      setEditingSet(index);
      if (!sets[index]) writeSet(index, recordEquipmentSet(inventory, ""));
      return;
    }
    if (sets[index]) applySet(index);
    else writeSet(index, recordEquipmentSet(inventory, ""));
  };
  const editedSet = editingSet !== null ? sets[editingSet] : null;

  // keys while the screen is open (the pad sends the same keys): Escape and
  // i close, m opens the item menu, e puts on or takes off, 1-6 use a set
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const store = useGameStore.getState();
      if (store.question || store.directionQuestion) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && event.key !== "Escape") return;
      let handled = true;
      if (event.key === "Escape") {
        if (menu) setMenu(null);
        else if (countPrompt) setCountPrompt(null);
        else if (confirm) setConfirm(null);
        else if (held) setHeld(null);
        else if (editingSet !== null) setEditingSet(null);
        else if (staging) closeContainerPanel();
        else controller?.closeInventoryScreen();
      } else if ((event.key === "i" || event.key === "I") && !event.ctrlKey && !event.altKey && !event.metaKey) {
        closeContainerPanel();
        controller?.closeInventoryScreen();
      } else if (event.key === "m" && focusedObject) {
        const rect = (document.activeElement as HTMLElement | null)?.getBoundingClientRect();
        openMenuAt(focusedObject, rect ? rect.left + rect.width / 2 : window.innerWidth / 2, rect ? rect.bottom : window.innerHeight / 2);
      } else if (event.key === "e" && focusedObject?.letter) {
        toggle({ kind: "pack", object: focusedObject });
      } else if (/^[1-6]$/.test(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey) {
        applySet(Number(event.key) - 1);
      } else {
        handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  // what the drag would do
  const hint = activeSource && hoverTarget ? resolveDrop(inventory, activeSource, hoverTarget, openContainer) : null;
  const hintPlan = hint?.kind === "plan" ? hint.plan : null;
  const hintTurns = hintPlan && !hintPlan.unsupported ? estimateTurns(inventory, hintPlan.operations) : null;
  const validSlots = activeSource?.kind === "pack" ? new Set(slotsFor(activeSource.object)) : null;
  const hoveredObject = hovered ? findObject(hovered.id) : null;
  const detail = activeSource?.object ?? hoveredObject ?? focusedObject;
  const weight = weightSummary(inventory);

  const renderItem = (source: DragSource, extraClass = "") => {
    const object = source.object;
    const badge = badgeText(object);
    const label = name(object);
    const erosionLevel = Math.max(object.eroded?.level ?? 0, object.eroded2?.level ?? 0);
    const tile = object.tilePreviewDataUrl
      ? <img alt="" aria-hidden="true" draggable={false} src={object.tilePreviewDataUrl} />
      : renderTilePreview(object.tileIndex);
    return (
      <span
        className={`${itemClasses(object)}${extraClass}${focusedObject?.id === object.id ? " is-selected" : ""}`}
        data-erosion={object.eroded?.kind}
        data-erosion2={object.eroded2?.kind}
        data-erosion-level={erosionLevel || undefined}
        title={label}
        onPointerDown={(event) => beginPress(event, source)}
        onDoubleClick={() => toggle(source)}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenuAt(object, event.clientX, event.clientY);
        }}
        onPointerEnter={() => setHovered(object)}
        onPointerLeave={() => setHovered(null)}
      >
        <span className="nh3d-invs-item-tile">
          {tile ?? <span className="nh3d-invs-item-symbol">{classSymbols[object.objectClass] ?? "?"}</span>}
        </span>
        {object.quantity > 1 ? <span className="nh3d-invs-item-quantity">{object.quantity}</span> : null}
        {badge ? <span className="nh3d-invs-item-badge">{badge}</span> : null}
        {object.erodeproof ? <span className="nh3d-invs-item-proof" aria-hidden="true">⛨</span> : null}
        {object.unpaid ? <span className="nh3d-invs-item-price" aria-hidden="true">¤</span> : null}
        {object.container ? <span className="nh3d-invs-item-bag" aria-hidden="true">▾</span> : null}
      </span>
    );
  };

  const slotLabel = (slot: EquipmentSlotId) =>
    slot === "secondaryWeapon" && inventory.twoWeapon ? strings.slots.offHand : strings.slots[slot];

  const targetClass = (target: DropTarget, valid: boolean) => {
    const hovered = sameTarget(hoverTarget, target);
    return `${valid ? " is-valid-target" : ""}${hovered ? " is-hover-target" : ""}`;
  };
  const turnsAttr = (target: DropTarget) =>
    sameTarget(hoverTarget, target) && hintTurns ? { "data-turns": strings.turns(hintTurns) } : {};

  const stagedIn = new Set(staging?.in ?? []);
  const stagedOut = new Set(staging?.out ?? []);
  const containerContents = openContainer?.container?.contents ?? null;

  return (
    <div
      className={`nh3d-inventory-screen${reducedMotion ? " is-reduced-motion" : ""}`}
      role="dialog"
      aria-label={strings.title}
      onClick={() => setMenu(null)}
    >
      <header className="nh3d-invs-header">
        <h2 className="nh3d-invs-title">{strings.title}</h2>
        {procedureNotice ? (
          <span className={`nh3d-invs-procedure is-${procedureNotice.status}`} aria-live="polite">
            {procedureText(procedureNotice)}
            {procedureNotice.status === "running" ? (
              <button type="button" onClick={() => controller?.cancelInventoryProcedure()}>{strings.procCancel}</button>
            ) : null}
          </span>
        ) : null}
        <div className="nh3d-invs-weight" data-level={weight.level}>
          <span className="nh3d-invs-weight-label">{strings.weightLabel}</span>
          <span className="nh3d-invs-weight-value">
            {weight.weight}
            {weight.nextThreshold !== null ? <span className="nh3d-invs-weight-limit"> / {weight.nextThreshold - 1}</span> : null}
          </span>
          <span className="nh3d-invs-weight-bar" aria-hidden="true">
            <span className="nh3d-invs-weight-fill" style={{ width: `${Math.round(weight.fill * 100)}%` }} />
          </span>
          <span className="nh3d-invs-weight-level">{levelName(weight.level)}</span>
        </div>
        <button
          type="button"
          className="nh3d-invs-close"
          onClick={() => {
            closeContainerPanel();
            controller?.closeInventoryScreen();
          }}
        >
          {strings.close}
        </button>
      </header>

      <div className="nh3d-invs-body">
        <section className="nh3d-invs-equipment" aria-label={strings.equipped}>
          <div className="nh3d-invs-sets" role="group" aria-label={strings.setsLabel}>
            {sets.map((set, index) => (
              <button
                type="button"
                key={index}
                className={`nh3d-invs-set${set ? " is-saved" : ""}${editingSet === index ? " is-editing" : ""}`}
                title={set ? `${setLabel(index)} (F${index + 1})` : strings.setEmpty}
                onClick={() => onSetButton(index)}
              >
                <span className="nh3d-invs-set-key">{index + 1}</span>
                <span className="nh3d-invs-set-name">{set ? setLabel(index) : "+"}</span>
              </button>
            ))}
            <button
              type="button"
              className={`nh3d-invs-set-edit${editingSet !== null ? " is-active" : ""}`}
              aria-pressed={editingSet !== null}
              onClick={() => setEditingSet(editingSet === null ? sets.findIndex((set) => set) : null)}
            >
              {editingSet !== null ? strings.setDone : strings.setEdit}
            </button>
          </div>
          {editingSet !== null && editingSet >= 0 ? (
            <div className="nh3d-invs-set-editor">
              <input
                type="text"
                maxLength={24}
                aria-label={strings.setName}
                placeholder={strings.setDefaultName(editingSet + 1)}
                value={editedSet?.name ?? ""}
                onChange={(event) => writeSet(editingSet, { ...(editedSet ?? { slots: {} }), name: event.target.value })}
              />
              <button type="button" onClick={() => writeSet(editingSet, recordEquipmentSet(inventory, editedSet?.name ?? ""))}>
                {strings.setRecord}
              </button>
              <button type="button" onClick={() => writeSet(editingSet, null)}>{strings.setDelete}</button>
              <span className="nh3d-invs-set-hint">{strings.setEditHint}</span>
            </div>
          ) : null}
          <div className="nh3d-invs-figure">
            {equipmentSlotLayout.map(({ id, column, row }) => {
              const object = objectInSlot(inventory, id);
              const target: DropTarget = { kind: "slot", slot: id };
              const valid = Boolean(validSlots?.has(id));
              const setValue = editedSet?.slots[id];
              const setObject = typeof setValue === "number" ? findObject(setValue) : null;
              return (
                <button
                  type="button"
                  key={id}
                  className={`nh3d-invs-slot${object ? " is-filled" : ""}${targetClass(target, valid)}${editedSet ? " is-set-editing" : ""}`}
                  style={{ gridColumn: column, gridRow: row }}
                  data-invs-drop={`slot:${id}`}
                  {...turnsAttr(target)}
                  aria-label={`${slotLabel(id)}: ${object ? name(object) : strings.emptySlot}`}
                  onClick={(event) => {
                    if (editedSet && editingSet !== null) {
                      writeSet(editingSet, cycleSetSlot(editedSet, id, inventory));
                      return;
                    }
                    activate(target, object ? { kind: "pack", object } : null, event.detail > 0);
                  }}
                  onFocus={() => object && setFocused(object)}
                >
                  {editedSet ? (
                    setObject ? renderItem({ kind: "pack", object: setObject }, " is-set-preview")
                      : <span className="nh3d-invs-set-mark">{setValue === "empty" ? strings.setSlotEmpty : strings.setSlotIgnore}</span>
                  ) : object ? renderItem({ kind: "pack", object }) : null}
                  <span className="nh3d-invs-slot-label">{slotLabel(id)}</span>
                </button>
              );
            })}
          </div>
          <div className="nh3d-invs-equipment-actions">
            <button type="button" onClick={() => controller?.runInventoryOperation({ op: "swap" })}>{strings.swap}</button>
            <button
              type="button"
              aria-pressed={inventory.twoWeapon}
              onClick={() => controller?.runInventoryOperation({ op: "twoweapon" })}
            >
              {strings.twoWeapon}
            </button>
          </div>
        </section>

        <div className="nh3d-invs-side">
          <section className="nh3d-invs-pack" data-invs-drop="grid" aria-label={strings.title}>
            <div className="nh3d-invs-grid">
              {inventoryGridLetters.map((letter) => {
                const object = byLetter.get(letter) ?? null;
                const target: DropTarget = { kind: "letter", letter };
                const isHeld = heldObject && object && heldObject.id === object.id;
                const classes = [
                  "nh3d-invs-cell",
                  object ? "is-filled" : "",
                  object && isEquipped(object) ? "is-equipped" : "",
                  object && stagedIn.has(object.id) ? "is-staged" : "",
                  isHeld ? "is-held" : "",
                ].filter(Boolean).join(" ");
                return (
                  <button
                    type="button"
                    key={letter}
                    className={`${classes}${targetClass(target, Boolean(activeSource) && activeSource?.object.objectClass !== ObjectClass.coin)}`}
                    data-invs-drop={`letter:${letter}`}
                    {...turnsAttr(target)}
                    aria-label={object ? `${letter} - ${name(object)}` : strings.letter(letter)}
                    onClick={(event) => activate(target, object ? { kind: "pack", object } : null, event.detail > 0)}
                    onFocus={() => object && setFocused(object)}
                  >
                    <span className="nh3d-invs-cell-letter" aria-hidden="true">{letter}</span>
                    {object ? renderItem({ kind: "pack", object }) : null}
                  </button>
                );
              })}
              <button
                type="button"
                className={`nh3d-invs-cell nh3d-invs-cell-gold${gold ? " is-filled" : ""}`}
                data-invs-drop={`letter:${goldLetter}`}
                aria-label={gold ? name(gold) : strings.letter(goldLetter)}
                onClick={(event) => activate({ kind: "letter", letter: goldLetter }, gold ? { kind: "pack", object: gold } : null, event.detail > 0)}
                onFocus={() => gold && setFocused(gold)}
              >
                <span className="nh3d-invs-cell-letter" aria-hidden="true">$</span>
                {gold ? renderItem({ kind: "pack", object: gold }) : null}
              </button>
            </div>
          </section>

          <section
            className={`nh3d-invs-floor${targetClass({ kind: "floor" }, activeSource?.kind === "pack")}`}
            data-invs-drop="floor"
            {...turnsAttr({ kind: "floor" })}
            aria-label={strings.floor}
          >
            <div className="nh3d-invs-section-head">
              <span className="nh3d-invs-section-title">{strings.floor}</span>
              {inventory.floor.length > 0 ? (
                <button type="button" onClick={() => runPlan(controller, planPickup(inventory.floor), strings.pickUpAll)}>
                  {strings.pickUpAll}
                </button>
              ) : null}
            </div>
            {inventory.floorHidden ? (
              <span className="nh3d-invs-note">{strings.floorHidden}</span>
            ) : inventory.floor.length === 0 ? (
              <span className="nh3d-invs-note">{strings.floorEmpty}</span>
            ) : (
              <div className="nh3d-invs-row">
                {inventory.floor.map((object) => (
                  <button
                    type="button"
                    key={object.id}
                    className={`nh3d-invs-cell is-filled${staging?.containerId === object.id ? " is-open-container" : ""}`}
                    aria-label={name(object)}
                    onClick={(event) => activate({ kind: "floor" }, { kind: "floor", object }, event.detail > 0)}
                    onFocus={() => setFocused(object)}
                  >
                    {renderItem({ kind: "floor", object })}
                  </button>
                ))}
                {inventory.floorCount > inventory.floor.length ? (
                  <span className="nh3d-invs-note">{strings.floorMore(inventory.floorCount - inventory.floor.length)}</span>
                ) : null}
              </div>
            )}
          </section>

          {openContainer ? (
            <section
              className={`nh3d-invs-container${targetClass({ kind: "container" }, activeSource?.kind === "pack")}`}
              data-invs-drop="container"
              aria-label={strings.containerTitle(name(openContainer))}
            >
              <div className="nh3d-invs-section-head">
                <span className="nh3d-invs-section-title">{strings.containerTitle(name(openContainer))}</span>
                {staging && (staging.out.length > 0 || staging.in.length > 0) ? (
                  <>
                    <button type="button" onClick={() => {
                      commitStaging(staging);
                      setStaging({ ...staging, out: [], in: [] });
                    }}>
                      {strings.commit} ({strings.turns(1)})
                    </button>
                    <button type="button" onClick={() => setStaging({ ...staging, out: [], in: [] })}>{strings.cancel}</button>
                  </>
                ) : null}
                <button type="button" onClick={closeContainerPanel}>{strings.closeContainer}</button>
              </div>
              {openContainer.container?.locked ? <span className="nh3d-invs-note">{strings.locked}</span> : null}
              {containerContents === null ? (
                <div className="nh3d-invs-row">
                  <span className="nh3d-invs-note">{strings.contentsUnknownOpen}</span>
                  <button type="button" onClick={() => runPlan(controller, planContainer({ containerId: openContainer.id, out: [], in: [] }), strings.open)}>
                    {strings.open}
                  </button>
                </div>
              ) : (
                <div className="nh3d-invs-row">
                  {containerContents.map((object) => (
                    <div key={object.id} className="nh3d-invs-content">
                      <button
                        type="button"
                        className={`nh3d-invs-cell is-filled${stagedOut.has(object.id) ? " is-staged" : ""}${object.container ? " is-inner-container" : ""}${object.container ? targetClass({ kind: "inner", innerId: object.id }, activeSource?.kind === "pack") : ""}`}
                        data-invs-drop={object.container ? `inner:${object.id}` : undefined}
                        {...(object.container ? turnsAttr({ kind: "inner", innerId: object.id }) : {})}
                        aria-label={name(object)}
                        onClick={(event) => {
                          // marked to come out: click to leave it in
                          if (!held && staging && stagedOut.has(object.id)) {
                            setStaging({ ...staging, out: staging.out.filter((other) => other !== object.id) });
                            return;
                          }
                          activate(object.container ? { kind: "inner", innerId: object.id } : { kind: "container" }, { kind: "content", object, containerId: openContainer.id }, event.detail > 0);
                        }}
                        onFocus={() => setFocused(object)}
                      >
                        {renderItem({ kind: "content", object, containerId: openContainer.id })}
                      </button>
                      {object.container?.contents && object.container.contents.length > 0 ? (
                        <div className="nh3d-invs-inner">
                          {object.container.contents.map((inside) => (
                            <button
                              type="button"
                              key={inside.id}
                              className="nh3d-invs-cell is-filled is-inner"
                              aria-label={name(inside)}
                              onClick={(event) => activate({ kind: "container" }, { kind: "inner", object: inside, containerId: openContainer.id, innerId: object.id }, event.detail > 0)}
                              onFocus={() => setFocused(inside)}
                            >
                              {renderItem({ kind: "inner", object: inside, containerId: openContainer.id, innerId: object.id })}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {staging?.in.map((id) => {
                    const object = findObject(id);
                    // waiting to go in: click to keep it out
                    return object ? (
                      <button
                        type="button"
                        key={`in-${id}`}
                        className="nh3d-invs-cell is-filled is-staged is-pending"
                        title={strings.staged}
                        aria-label={`${strings.staged}: ${name(object)}`}
                        onClick={() => staging && setStaging({ ...staging, in: staging.in.filter((other) => other !== id) })}
                      >
                        {renderItem({ kind: "pack", object })}
                      </button>
                    ) : null;
                  })}
                  {containerContents.length === 0 && (staging?.in.length ?? 0) === 0 ? (
                    <span className="nh3d-invs-note">{strings.contentsEmpty}</span>
                  ) : null}
                  {openContainer.container && openContainer.container.more > 0 ? (
                    <span className="nh3d-invs-note">{strings.floorMore(openContainer.container.more)}</span>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>

      <footer className="nh3d-invs-detail" aria-live="polite">
        {countPrompt ? (
          <form
            className="nh3d-invs-prompt"
            onSubmit={(event) => {
              event.preventDefault();
              const count = Math.max(1, Math.min(countPrompt.object.quantity, Math.trunc(Number(countValue)) || 1));
              runPlan(controller, countPrompt.make(count), countPrompt.label);
              setCountPrompt(null);
            }}
          >
            <span>{name(countPrompt.object)}</span>
            <label>
              {strings.countLabel}
              <input
                type="number"
                min={1}
                max={countPrompt.object.quantity}
                value={countValue}
                autoFocus
                onChange={(event) => setCountValue(event.target.value)}
              />
            </label>
            <button type="submit">{strings.ok}</button>
            <button type="button" onClick={() => setCountPrompt(null)}>{strings.cancel}</button>
          </form>
        ) : confirm ? (
          <span className="nh3d-invs-prompt">
            <span>{strings.nestedConfirm(confirm.plan.operations.length, estimateTurns(inventory, confirm.plan.operations))}</span>
            <button type="button" autoFocus onClick={() => {
              runPlan(controller, confirm.plan, confirm.label);
              setConfirm(null);
            }}>{strings.run}</button>
            <button type="button" onClick={() => setConfirm(null)}>{strings.stop}</button>
          </span>
        ) : detail ? (
          <>
            {detail.letter ? <span className="nh3d-invs-detail-letter">{detail.letter}</span> : null}
            <span className="nh3d-invs-detail-name">{name(detail)}</span>
            <span className="nh3d-invs-detail-lines">{detailLines(detail).join(" · ")}</span>
          </>
        ) : (
          <span className="nh3d-invs-detail-hint">{strings.hint}</span>
        )}
        {hintTurns ? <span className="nh3d-invs-detail-turns">{strings.turns(hintTurns)}</span> : null}
        {hintPlan && hintPlan.removes.length > 0 ? (
          <span className="nh3d-invs-detail-plan">
            {strings.takesOffFirst(hintPlan.removes.map((o) => name(o)).join(", "))}
          </span>
        ) : null}
        {hint?.kind === "notice" ? <span className="nh3d-invs-detail-notice">{hint.text}</span> : null}
        {hintPlan?.unsupported || notice ? (
          <span className="nh3d-invs-detail-notice">{notice ?? strings.unsupported}</span>
        ) : null}
      </footer>

      {ghost && dragSource && typeof document !== "undefined"
        ? createPortal(
          <div className="nh3d-invs-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
            {renderItem(dragSource)}
          </div>,
          document.body,
        )
        : null}

      {menu ? (
        <ItemMenu x={menu.x} y={menu.y} title={name(menu.object)} onDismiss={() => setMenu(null)}>
          {isContainerLike(menu.object) ? (
            <button type="button" role="menuitem" autoFocus onClick={() => {
              setMenu(null);
              openContainerPanel(menu.object);
            }}>
              {strings.open}
            </button>
          ) : null}
          {inventoryContextActions
            .filter((action) => !inventoryCategoryActionBlocklist[categoryOf(menu.object)].has(action.id))
            .map((action, index) => (
              <button
                type="button"
                role="menuitem"
                key={action.id}
                autoFocus={index === 0 && !isContainerLike(menu.object)}
                onClick={() => runMenuAction(action.id)}
              >
                {action.label}
              </button>
            ))}
        </ItemMenu>
      ) : null}
    </div>
  );
}
