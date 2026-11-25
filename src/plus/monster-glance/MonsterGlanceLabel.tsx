import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { translateSquareName } from "../../i18n/game-ground";
import { translateMonsterName } from "../../i18n/game-monsters";
import type { GlancedMonster, MonsterHealth } from "../../runtime/monster-glance";
import { useMonsterGlance } from "./store";
import "./monster-glance.css";

const healthLabels: Record<MonsterHealth, [string, string]> = {
  uninjured: ["Uninjured", "無傷"],
  wounded: ["Wounded", "負傷"],
  "badly wounded": ["Badly wounded", "重傷"],
  "nearly dead": ["Nearly dead", "瀕死"],
};

const pointerGapPx = 14;

function monsterTitle(monster: GlancedMonster, ja: boolean): string {
  const attitude = monster.tame ? "tame " : monster.peaceful ? "peaceful " : "";
  if (!ja) return `${attitude}${monster.name}`;
  // "little dog called Hachi": the kind is translated, the given name kept.
  const called = /^(.+?) (?:called|named) (.+)$/.exec(monster.name);
  const kind = called ? called[1] : monster.name;
  // translateMonsterName needs an article; an untranslated name stays English.
  const translated = translateMonsterName(`the ${attitude}${kind}`, "ja");
  const shown = translated === `the ${attitude}${kind}` ? `${attitude}${kind}` : translated;
  return called ? `${called[2]}という${shown}` : shown;
}

/** Polypiled: what the hero can tell of the map square under the pointer. */
export function MonsterGlanceLabel({ hidden = false }: { readonly hidden?: boolean }): JSX.Element | null {
  const { locale } = useI18n();
  const glance = useMonsterGlance();
  if (!glance || hidden) return null;
  const ja = locale === "ja";
  const { monster, square } = glance;
  const name = (text: string): string => translateSquareName(text, locale);
  // Top to bottom as they stack on the square: monster, object, trap, feature, ground.
  const things = square
    ? [square.object, square.trap, square.feature].filter((text): text is string => !!text)
    : [];
  const placeLeft = glance.clientX > window.innerWidth - 260;
  return createPortal(
    <div
      className="nh3d-monster-glance"
      role="tooltip"
      style={{
        top: glance.clientY + pointerGapPx,
        ...(placeLeft
          ? { right: window.innerWidth - glance.clientX + pointerGapPx }
          : { left: glance.clientX + pointerGapPx }),
      }}
    >
      {monster && (
        <div className={`nh3d-monster-glance-row is-${monster.health.replace(/ /g, "-")}`}>
          <span className="nh3d-monster-glance-name">{monsterTitle(monster, ja)}</span>
          <span className="nh3d-monster-glance-health">{healthLabels[monster.health][ja ? 1 : 0]}</span>
        </div>
      )}
      {things.map((text) => (
        <div key={text} className="nh3d-monster-glance-row">
          {name(text)}
        </div>
      ))}
      {square?.ground && <div className="nh3d-monster-glance-row is-ground">{name(square.ground)}</div>}
    </div>,
    document.body,
  );
}
