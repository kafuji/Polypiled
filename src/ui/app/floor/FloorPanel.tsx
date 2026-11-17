import type * as React from "react";
import { useI18n } from "../../../i18n";
import { translateGroundObject } from "../../../i18n/game-ground";
import type { FloorHere, FloorHereEngraving } from "../../../runtime/floor-here";
import { useGameStore } from "../../../state/gameStore";
import { t } from "../shared/translations";

/** Objects shown before the rest are summed up as "and N more". */
export const FLOOR_PANEL_MAX_OBJECTS = 5;

export interface FloorPanelProps {
  visible: boolean;
  renderTilePreview: (tileIndex: number | null) => React.ReactNode;
}

function engravingLabel(engraving: FloorHereEngraving): string {
  const kinds = t.floorPanel.engravingKinds;
  switch (engraving.type) {
    case 1: return kinds.dust;
    case 2: return kinds.engraved;
    case 3: return kinds.burned;
    case 4: return kinds.marker;
    case 5: return kinds.blood;
    case 6: return kinds.headstone;
    default: return kinds.other;
  }
}

/**
 * What lies under the hero, always on screen: the terrain, a trap the hero
 * has seen, an engraving the hero has read, and the objects here (the first few, then a count), so
 * there is no need to look with ':' or to wait for a pile popup.
 */
export function FloorPanel(props: FloorPanelProps) {
  const floorHere = useGameStore((state) => state.floorHere);
  return <FloorPanelView {...props} floorHere={floorHere} />;
}

export function FloorPanelView({ visible, renderTilePreview, floorHere }: FloorPanelProps & { floorHere: FloorHere | null }) {
  const { locale } = useI18n();
  if (!visible || !floorHere) return null;
  const shown = floorHere.objects.slice(0, FLOOR_PANEL_MAX_OBJECTS);
  const rest = floorHere.count - shown.length;
  const feature = floorHere.feature ? translateGroundObject(floorHere.feature, locale) : "";
  return (
    <aside className="nh3d-floor-panel" aria-label={t.floorPanel.label} aria-live="polite">
      <div className="nh3d-floor-panel-feature">
        <span className="nh3d-floor-panel-label">{t.floorPanel.label}</span>
        {feature ? <span className="nh3d-floor-panel-terrain">{feature}</span> : null}
        {floorHere.trap ? (
          <span className="nh3d-floor-panel-trap">{translateGroundObject(floorHere.trap, locale)}</span>
        ) : null}
      </div>
      {floorHere.engraving ? (
        <div className="nh3d-floor-panel-engraving">
          <span className="nh3d-floor-panel-engraving-kind">{engravingLabel(floorHere.engraving)}</span>
          <q className="nh3d-floor-panel-engraving-text">{floorHere.engraving.text}</q>
        </div>
      ) : null}
      {floorHere.hidden ? (
        <div className="nh3d-floor-panel-note">{t.floorPanel.hidden}</div>
      ) : floorHere.count === 0 ? (
        <div className="nh3d-floor-panel-note">{t.floorPanel.nothing}</div>
      ) : (
        <ul className="nh3d-floor-panel-objects">
          {shown.map((object, index) => (
            <li key={`${index}:${object.name}`} className="nh3d-floor-panel-object">
              <span className="nh3d-floor-panel-object-tile">{renderTilePreview(object.tileIndex)}</span>
              <span className="nh3d-floor-panel-object-name">{translateGroundObject(object.name, locale)}</span>
            </li>
          ))}
          {rest > 0 ? <li className="nh3d-floor-panel-more">{t.floorPanel.more(rest)}</li> : null}
        </ul>
      )}
    </aside>
  );
}
