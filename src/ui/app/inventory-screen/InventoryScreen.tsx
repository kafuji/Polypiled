import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { useI18n } from "../../../i18n";
import { translateInventoryItem } from "../../../i18n/inventory-text";
import type { InventoryOperation } from "../../../runtime/input/inventory-operation";
import type { InventoryObject, InventoryState } from "../../../runtime/inventory-state";
import { useGameStore } from "../../../state/gameStore";
import type { Nethack3DEngineController } from "../../../game/ui-types";
import { inventoryCategoryActionBlocklist, inventoryContextActions } from "../inventory/actions";
import { t } from "../shared/translations";
import {
  type DropPlan,
  type EquipmentSlotId,
  ObjectClass,
  categoryOf,
  equipmentSlotLayout,
  goldLetter,
  inventoryGridLetters,
  isEquipped,
  objectInSlot,
  objectsByLetter,
  planEquip,
  planMove,
  planToggle,
  planUnequip,
  slotsFor,
  weightSummary,
} from "./model";

export interface InventoryScreenProps {
  renderTilePreview: (tileIndex: number | null) => React.ReactNode;
  reducedMotion: boolean;
}

type DropTarget =
  | { kind: "slot"; slot: EquipmentSlotId }
  | { kind: "letter"; letter: string }
  | { kind: "grid" };

const classSymbols: Record<number, string> = {
  [ObjectClass.weapon]: ")", [ObjectClass.armor]: "[", [ObjectClass.ring]: "=", [ObjectClass.amulet]: "\"",
  [ObjectClass.tool]: "(", [ObjectClass.food]: "%", [ObjectClass.potion]: "!", [ObjectClass.scroll]: "?",
  [ObjectClass.spellbook]: "+", [ObjectClass.wand]: "/", [ObjectClass.coin]: "$", [ObjectClass.gem]: "*",
  [ObjectClass.rock]: "`", [ObjectClass.ball]: "0", [ObjectClass.chain]: "_", [ObjectClass.venom]: ".",
};

const DRAG_START_DISTANCE_PX = 6;

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
  if (value === "grid") return { kind: "grid" };
  const [kind, id] = value.split(":");
  if (kind === "slot" && id) return { kind: "slot", slot: id as EquipmentSlotId };
  if (kind === "letter" && id) return { kind: "letter", letter: id };
  return null;
}

function planFor(state: InventoryState, object: InventoryObject, target: DropTarget): DropPlan {
  if (target.kind === "slot") return planEquip(state, object, target.slot);
  if (isEquipped(object)) return planUnequip(object);
  if (target.kind === "letter") return planMove(object, target.letter);
  return { operations: [], removes: [] };
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

function run(controller: Nethack3DEngineController | null, operations: readonly InventoryOperation[]) {
  if (!controller) return;
  for (const operation of operations) controller.runInventoryOperation(operation);
}

/**
 * The inventory screen: equipment slots around the body, the 52 letter
 * slots of the inventory (a slot's position is the item's letter), and the
 * carried weight. Every change is a game command run through the core; the
 * screen only shows what the game reports.
 */
export function InventoryScreen(props: InventoryScreenProps) {
  const open = useGameStore((state) => state.inventoryScreenOpen);
  const inventory = useGameStore((state) => state.inventoryState);
  const controller = useGameStore((state) => state.engineController);
  if (!open || !inventory) return null;
  return <InventoryScreenView {...props} inventory={inventory} controller={controller} />;
}

interface DragState {
  object: InventoryObject;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

interface ContextMenuState {
  object: InventoryObject;
  x: number;
  y: number;
}

export function InventoryScreenView({
  inventory,
  controller,
  renderTilePreview,
  reducedMotion,
}: InventoryScreenProps & { inventory: InventoryState; controller: Nethack3DEngineController | null }) {
  const { locale } = useI18n();
  const strings = t.inventoryScreen;
  const byLetter = useMemo(() => objectsByLetter(inventory), [inventory]);
  const gold = byLetter.get(goldLetter) ?? null;
  const [focused, setFocused] = useState<InventoryObject | null>(null);
  const [held, setHeld] = useState<InventoryObject | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [hoverTarget, setHoverTarget] = useState<DropTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

  // the game's report replaces objects: follow them by id
  const current = useCallback(
    (object: InventoryObject | null) => (object ? inventory.objects.find((o) => o.id === object.id) ?? null : null),
    [inventory],
  );
  const heldObject = current(held);
  const focusedObject = current(focused);
  const dragObject = heldObject ?? (dragRef.current?.dragging ? current(dragRef.current.object) : null);

  const perform = useCallback(
    (object: InventoryObject, target: DropTarget) => {
      const plan = planFor(inventory, object, target);
      if (plan.unsupported) {
        setNotice(strings.unsupported);
        return;
      }
      setNotice(null);
      run(controller, plan.operations);
    },
    [controller, inventory, strings],
  );

  useEffect(() => {
    if (!held || heldObject) return;
    setHeld(null);
  }, [held, heldObject]);

  // pointer drag: listeners live on the window while a press is active
  const onPointerMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START_DISTANCE_PX) return;
      drag.dragging = true;
      setHeld(null);
    }
    setGhost({ x: event.clientX, y: event.clientY });
    setHoverTarget(parseDropTarget(document.elementFromPoint(event.clientX, event.clientY)));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setGhost(null);
    setHoverTarget(null);
  }, []);

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      window.removeEventListener("pointermove", onPointerMove);
      if (drag.dragging) {
        suppressClickRef.current = true;
        const target = parseDropTarget(document.elementFromPoint(event.clientX, event.clientY));
        const object = inventory.objects.find((o) => o.id === drag.object.id);
        if (target && object) perform(object, target);
      }
      endDrag();
    },
    [endDrag, inventory, onPointerMove, perform],
  );

  useEffect(() => () => {
    window.removeEventListener("pointermove", onPointerMove);
  }, [onPointerMove]);

  const beginPress = (event: React.PointerEvent, object: InventoryObject) => {
    if (event.button !== 0) return;
    dragRef.current = { object, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", () => {
      window.removeEventListener("pointermove", onPointerMove);
      endDrag();
    }, { once: true });
  };

  // tap / Enter: pick up, then tap / Enter on a slot or letter to place
  const activate = (target: DropTarget, object: InventoryObject | null) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setMenu(null);
    if (heldObject) {
      if (object && object.id === heldObject.id) {
        setHeld(null);
        return;
      }
      perform(heldObject, target);
      setHeld(null);
      return;
    }
    if (object) setHeld(object);
  };

  const toggle = (object: InventoryObject) => {
    setHeld(null);
    const plan = planToggle(inventory, object);
    if (plan.unsupported) setNotice(strings.unsupported);
    else run(controller, plan.operations);
  };

  const openMenu = (event: React.MouseEvent, object: InventoryObject) => {
    event.preventDefault();
    setHeld(null);
    setMenu({ object, x: event.clientX, y: event.clientY });
  };

  const runMenuAction = (actionId: string) => {
    const object = menu ? current(menu.object) : null;
    setMenu(null);
    if (!object?.letter || !controller) return;
    const action = inventoryContextActions.find((entry) => entry.id === actionId);
    if (!action) return;
    // using an item (apply, invoke, read, eat, zap, ...) takes time and
    // usually needs the map: the screen gets out of the way at once
    if (!menuActionsThatKeepScreenOpen.has(action.id)) controller.closeInventoryScreen();
    if (action.kind === "extended" && action.value) {
      if (action.armInventorySelection !== false) {
        controller.sendInput(`__INVCTX_SELECT__:${object.letter}:${action.id}`);
      }
      controller.runExtendedCommand(action.value, { forceHashSubmission: true });
    } else {
      controller.runInventoryItemAction(action.id, object.letter);
    }
  };

  const hintPlan = dragObject && hoverTarget ? planFor(inventory, dragObject, hoverTarget) : null;
  const validSlots = dragObject ? new Set(slotsFor(dragObject)) : null;
  const detail = dragObject ?? focusedObject;
  const weight = weightSummary(inventory);

  const renderItem = (object: InventoryObject, extraClass = "") => {
    const badge = badgeText(object);
    const name = translateInventoryItem(object.name, locale);
    const erosionLevel = Math.max(object.eroded?.level ?? 0, object.eroded2?.level ?? 0);
    const tile = object.tilePreviewDataUrl
      ? <img alt="" aria-hidden="true" draggable={false} src={object.tilePreviewDataUrl} />
      : renderTilePreview(object.tileIndex);
    return (
      <span
        className={`${itemClasses(object)}${extraClass}`}
        data-erosion={object.eroded?.kind}
        data-erosion2={object.eroded2?.kind}
        data-erosion-level={erosionLevel || undefined}
        title={name}
        onPointerDown={(event) => beginPress(event, object)}
        onDoubleClick={() => toggle(object)}
        onContextMenu={(event) => openMenu(event, object)}
        onPointerEnter={() => setFocused(object)}
      >
        <span className="nh3d-invs-item-tile">
          {tile ?? <span className="nh3d-invs-item-symbol">{classSymbols[object.objectClass] ?? "?"}</span>}
        </span>
        {object.quantity > 1 ? <span className="nh3d-invs-item-quantity">{object.quantity}</span> : null}
        {badge ? <span className="nh3d-invs-item-badge">{badge}</span> : null}
        {object.erodeproof ? <span className="nh3d-invs-item-proof" aria-hidden="true">⛨</span> : null}
        {object.unpaid ? <span className="nh3d-invs-item-price" aria-hidden="true">¤</span> : null}
      </span>
    );
  };

  // With a button of the screen focused the engine leaves keys alone, so the
  // screen closes itself: Escape drops a held item first, then closes; i
  // closes like it opened.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (menu) setMenu(null);
      else if (heldObject) setHeld(null);
      else controller?.closeInventoryScreen();
    } else if ((event.key === "i" || event.key === "I") && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      controller?.closeInventoryScreen();
    }
  };

  const slotLabel = (slot: EquipmentSlotId) =>
    slot === "secondaryWeapon" && inventory.twoWeapon ? strings.slots.offHand : strings.slots[slot];

  const targetClass = (target: DropTarget, valid: boolean) => {
    const hovered =
      hoverTarget &&
      hoverTarget.kind === target.kind &&
      (target.kind !== "slot" || (hoverTarget as { slot?: string }).slot === target.slot) &&
      (target.kind !== "letter" || (hoverTarget as { letter?: string }).letter === target.letter);
    return `${valid ? " is-valid-target" : ""}${hovered ? " is-hover-target" : ""}`;
  };

  return (
    <div
      className={`nh3d-inventory-screen${reducedMotion ? " is-reduced-motion" : ""}`}
      role="dialog"
      aria-label={strings.title}
      onClick={() => setMenu(null)}
      onKeyDown={onKeyDown}
    >
      <header className="nh3d-invs-header">
        <h2 className="nh3d-invs-title">{strings.title}</h2>
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
        <button type="button" className="nh3d-invs-close" onClick={() => controller?.closeInventoryScreen()}>
          {strings.close}
        </button>
      </header>

      <div className="nh3d-invs-body">
        <section className="nh3d-invs-equipment" aria-label={strings.equipped}>
          <div className="nh3d-invs-figure">
            {equipmentSlotLayout.map(({ id, column, row }) => {
              const object = objectInSlot(inventory, id);
              const target: DropTarget = { kind: "slot", slot: id };
              const valid = Boolean(validSlots?.has(id));
              return (
                <button
                  type="button"
                  key={id}
                  className={`nh3d-invs-slot${object ? " is-filled" : ""}${targetClass(target, valid)}`}
                  style={{ gridColumn: column, gridRow: row }}
                  data-invs-drop={`slot:${id}`}
                  aria-label={`${slotLabel(id)}: ${object ? translateInventoryItem(object.name, locale) : strings.emptySlot}`}
                  onClick={() => activate(target, object)}
                  onFocus={() => object && setFocused(object)}
                >
                  {object ? renderItem(object) : null}
                  <span className="nh3d-invs-slot-label">{slotLabel(id)}</span>
                </button>
              );
            })}
          </div>
          <div className="nh3d-invs-equipment-actions">
            <button type="button" onClick={() => run(controller, [{ op: "swap" }])}>{strings.swap}</button>
            <button
              type="button"
              aria-pressed={inventory.twoWeapon}
              onClick={() => run(controller, [{ op: "twoweapon" }])}
            >
              {strings.twoWeapon}
            </button>
          </div>
        </section>

        <section className="nh3d-invs-pack" data-invs-drop="grid" aria-label={strings.title}>
          <div className="nh3d-invs-grid">
            {inventoryGridLetters.map((letter) => {
              const object = byLetter.get(letter) ?? null;
              const target: DropTarget = { kind: "letter", letter };
              const isHeld = heldObject && object && heldObject.id === object.id;
              return (
                <button
                  type="button"
                  key={letter}
                  className={`nh3d-invs-cell${object ? " is-filled" : ""}${object && isEquipped(object) ? " is-equipped" : ""}${isHeld ? " is-held" : ""}${targetClass(target, Boolean(dragObject) && dragObject?.objectClass !== ObjectClass.coin)}`}
                  data-invs-drop={`letter:${letter}`}
                  aria-label={object ? `${letter} - ${translateInventoryItem(object.name, locale)}` : strings.letter(letter)}
                  onClick={() => activate(target, object)}
                  onFocus={() => object && setFocused(object)}
                >
                  <span className="nh3d-invs-cell-letter" aria-hidden="true">{letter}</span>
                  {object ? renderItem(object) : null}
                </button>
              );
            })}
            <button
              type="button"
              className={`nh3d-invs-cell nh3d-invs-cell-gold${gold ? " is-filled" : ""}`}
              data-invs-drop={`letter:${goldLetter}`}
              aria-label={gold ? translateInventoryItem(gold.name, locale) : strings.letter(goldLetter)}
              onClick={() => activate({ kind: "letter", letter: goldLetter }, gold)}
              onFocus={() => gold && setFocused(gold)}
            >
              <span className="nh3d-invs-cell-letter" aria-hidden="true">$</span>
              {gold ? renderItem(gold) : null}
            </button>
          </div>
        </section>
      </div>

      <footer className="nh3d-invs-detail" aria-live="polite">
        {detail ? (
          <>
            <span className="nh3d-invs-detail-letter">{detail.letter}</span>
            <span className="nh3d-invs-detail-name">{translateInventoryItem(detail.name, locale)}</span>
            <span className="nh3d-invs-detail-lines">{detailLines(detail).join(" · ")}</span>
          </>
        ) : (
          <span className="nh3d-invs-detail-hint">{strings.hint}</span>
        )}
        {hintPlan && hintPlan.removes.length > 0 ? (
          <span className="nh3d-invs-detail-plan">
            {strings.takesOffFirst(hintPlan.removes.map((o) => translateInventoryItem(o.name, locale)).join(", "))}
          </span>
        ) : null}
        {hintPlan?.unsupported || notice ? (
          <span className="nh3d-invs-detail-notice">{notice ?? strings.unsupported}</span>
        ) : null}
      </footer>

      {ghost && dragObject ? (
        <div className="nh3d-invs-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          {renderItem(dragObject)}
        </div>
      ) : null}

      {menu ? (
        <div
          className="nh3d-invs-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="nh3d-invs-menu-title">{translateInventoryItem(menu.object.name, locale)}</div>
          {inventoryContextActions
            .filter((action) => !inventoryCategoryActionBlocklist[categoryOf(menu.object)].has(action.id))
            .map((action) => (
              <button type="button" role="menuitem" key={action.id} onClick={() => runMenuAction(action.id)}>
                {action.label}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
