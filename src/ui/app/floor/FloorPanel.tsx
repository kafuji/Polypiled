import type * as React from "react";
import { useI18n } from "../../../i18n";
import { translateGroundObject } from "../../../i18n/game-ground";
import { translateRuntimeText } from "../../../i18n/runtime-text";
import type { FloorHere, FloorHereEngraving } from "../../../runtime/floor-here";
import { useGameStore } from "../../../state/gameStore";
import { t } from "../shared/translations";

/** Objects shown before the rest are summed up as "and N more". */
export const FLOOR_PANEL_MAX_OBJECTS = 5;

export interface FloorPanelProps {
  visible: boolean;
  /** Player position, or the runtime's own status ("Game ended"). */
  statusText?: string;
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
 * The bottom-center panel: where the hero stands and what lies there, always
 * on screen. The line along the bottom gives the position, the terrain and a
 * trap the hero has seen; an engraving the hero has read and the objects here
 * (the first few, then a count) stack above it, so there is no need to look
 * with ':' or to wait for a pile popup.
 */
export function FloorPanel(props: FloorPanelProps) {
  const floorHere = useGameStore((state) => state.floorHere);
  return <FloorPanelView {...props} floorHere={floorHere} />;
}

export function FloorPanelView({
  visible,
  statusText = "",
  renderTilePreview,
  floorHere,
}: FloorPanelProps & { floorHere: FloorHere | null }) {
  const { locale } = useI18n();
  const status = statusText.trim() ? translateRuntimeText(statusText.trim(), locale) : "";
  if (!visible || (!floorHere && !status)) return null;
  const shown = floorHere ? floorHere.objects.slice(0, FLOOR_PANEL_MAX_OBJECTS) : [];
  const rest = floorHere ? floorHere.count - shown.length : 0;
  const feature = floorHere?.feature ? translateGroundObject(floorHere.feature, locale) : "";
  const trap = floorHere?.trap ? translateGroundObject(floorHere.trap, locale) : "";
  const hasDetails = !!floorHere && (!!floorHere.engraving || floorHere.hidden || floorHere.count > 0);
  return (
    <aside id="game-status" className="nh3d-floor-panel" aria-label={t.floorPanel.label} aria-live="polite">
      {hasDetails && floorHere ? (
        <div className="nh3d-floor-panel-details">
          {floorHere.engraving ? (
            <div className="nh3d-floor-panel-engraving">
              <span className="nh3d-floor-panel-engraving-kind">{engravingLabel(floorHere.engraving)}</span>
              <q className="nh3d-floor-panel-engraving-text">{floorHere.engraving.text}</q>
            </div>
          ) : null}
          {floorHere.hidden ? (
            <div className="nh3d-floor-panel-note">{t.floorPanel.hidden}</div>
          ) : floorHere.count === 0 ? null : (
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
        </div>
      ) : null}
      <div className="nh3d-floor-panel-feature">
        {status ? <span className="nh3d-floor-panel-position">{status}</span> : null}
        {feature ? <span className="nh3d-floor-panel-terrain">{feature}</span> : null}
        {trap ? <span className="nh3d-floor-panel-trap">{trap}</span> : null}
      </div>
    </aside>
  );
}
