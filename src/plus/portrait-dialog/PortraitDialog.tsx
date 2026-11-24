import { useEffect, useRef, useSyncExternalStore } from "react";
import { useI18n } from "../../i18n";
import { translateMonsterName } from "../../i18n/game-monsters";
import { presentGameMessage } from "../../i18n/message-presentation";
import { hasPaintedPortrait, portraitActor } from "./actors";
import { portraitSnapshot, subscribePortrait } from "./store";
import "./portrait-dialog.css";

const labels: Record<string, [string, string]> = {
  shopkeeper: ["Shopkeeper", "店主"], nurse: ["Nurse", "看護師"],
  little_dog: ["Little dog", "子犬"], dog: ["Dog", "犬"], large_dog: ["Large dog", "大型犬"],
  kitten: ["Kitten", "子猫"], housecat: ["Housecat", "飼い猫"], large_cat: ["Large cat", "大型猫"],
  pony: ["Pony", "仔馬"], horse: ["Horse", "馬"], warhorse: ["Warhorse", "軍馬"],
  shopkeeper_female: ["Shopkeeper", "店主"], oracle: ["Oracle", "神託者"], watchman: ["Watchman", "衛兵"],
  wizard: ["Wizard of Yendor", "イェンダーの魔法使い"], pet: ["Pet", "ペット"],
  baalzebub: ["Baalzebub", "ベルゼブブ"], succubus: ["Succubus", "サキュバス"],
  incubus: ["Incubus", "インキュバス"], chat: ["Conversation", "会話"],
};

export function PortraitDialog() {
  const scene = useSyncExternalStore(subscribePortrait, portraitSnapshot);
  const { locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const offerField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const held = new Set<string>();
    let afterDialog = false;
    function key(event: KeyboardEvent) {
      const current = portraitSnapshot();
      const code = event.code || event.key;
      if (current) afterDialog = true;
      if (!current && event.repeat && afterDialog) held.add(code);
      if (!current && (!held.has(code) || (!event.repeat && event.type === "keydown"))) {
        if (!event.repeat && event.type === "keydown") afterDialog = false;
        held.delete(code);
        return;
      }
      event.stopImmediatePropagation();
      const editing = current?.input === "offer" && event.target === offerField.current;
      if (current?.input && event.key === "Tab") return;
      if (editing && !["Enter", "Escape"].includes(event.key)) return;
      event.preventDefault();
      if (event.type === "keyup") held.delete(code);
      else {
        held.add(code);
        if (!current || event.repeat || event.isComposing) return;
        if (current.input === "yes-no") {
          const answer = event.key.toLowerCase();
          if (answer === "y" || answer === "n") current.acknowledge(answer);
          else if (event.key === "Escape") current.acknowledge("n");
          else if (event.key === "Enter" && event.target instanceof HTMLButtonElement && event.target.dataset.answer)
            current.acknowledge(event.target.dataset.answer);
        } else if (current.input === "offer") {
          if (event.key === "Escape") current.acknowledge("0");
          else if (event.key === "Enter" && event.target instanceof HTMLButtonElement) event.target.click();
          else if (event.key === "Enter") offerField.current?.form?.requestSubmit();
        } else if (event.key === "Enter" || event.key === "Escape") current.acknowledge();
      }
    }
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
    };
  }, []);
  useEffect(() => {
    if (scene && !dialog.current?.open) dialog.current?.showModal();
    if (scene?.input === "offer" && offerField.current) {
      offerField.current.value = "";
      offerField.current.focus();
    }
  }, [scene]);
  if (!scene) return null;
  const actor = portraitActor(scene.actor, scene.tileIndex);
  const label = labels[actor]?.[locale === "ja" ? 1 : 0] ?? translateMonsterName(actor.replace(/_/g, " "), locale);
  const portrait = hasPaintedPortrait(actor) ? `assets/portraits/${actor}.png`
    : scene.preview ?? (/^[a-z0-9_]+$/.test(actor) && !["pet", "chat"].includes(actor)
      ? `assets/vulture/win/vulture/gamedata/tiles/monster.pm_${actor}.png` : null);
  return <dialog ref={dialog} className="portrait-dialog" aria-labelledby="portrait-speaker"
    onCancel={event => event.preventDefault()}>
    <div className="portrait-stage">
      <img className="portrait-player" alt="" src="assets/portraits/traveler.png" />
      {portrait && <img key={portrait} className="portrait-speaker-art" alt="" src={portrait}
        onError={event => { event.currentTarget.hidden = true; }} />}
      <div className="portrait-caption">
        <strong id="portrait-speaker">{label}</strong>
        <p>{presentGameMessage(scene.text, locale).text}</p>
        <div className="portrait-actions" onClick={event => event.stopPropagation()}>
          {scene.input === "yes-no" ? <>
            <button type="button" data-answer="y" onClick={() => scene.acknowledge("y")}>{locale === "ja" ? "はい" : "Yes"} <kbd>Y</kbd></button>
            <button type="button" data-answer="n" onClick={() => scene.acknowledge("n")}>{locale === "ja" ? "いいえ" : "No"} <kbd>N</kbd></button>
          </> : scene.input === "offer" ? <form onSubmit={event => {
            event.preventDefault();
            const value = offerField.current?.value ?? "";
            if (/^\d{1,10}$/.test(value)) scene.acknowledge(value);
          }}>
            <input ref={offerField} aria-label={locale === "ja" ? "提示額" : "Offer amount"} placeholder="0" inputMode="numeric" pattern="[0-9]{1,10}" maxLength={10} required />
            <button type="submit">{locale === "ja" ? "提示する" : "Offer"}</button>
            <button type="button" onClick={() => scene.acknowledge("0")}>{locale === "ja" ? "断る" : "Refuse"}</button>
          </form> : <button type="button" onClick={() => scene.acknowledge()}>
            {locale === "ja" ? "次へ" : "Continue"} ▸ <kbd>Enter / Esc</kbd>
          </button>}
        </div>
      </div>
    </div>
  </dialog>;
}
