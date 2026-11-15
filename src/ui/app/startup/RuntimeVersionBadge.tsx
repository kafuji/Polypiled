import type {
  NethackRuntimeVersion
} from "../../../runtime/types";

/** Runtime version label and badge. */
export function resolveRuntimeVersionDisplayLabel(
  runtimeVersion: NethackRuntimeVersion,
): string {
  return "NetHack 5.0";
}

export function RuntimeVersionBadge({
  label,
  startup = false,
}: {
  label: string;
  startup?: boolean;
}): JSX.Element {
  return (
    <div
      className={`nh3d-dialog-context-label${startup ? " nh3d-dialog-context-label-startup" : ""
        }`}
    >
      <span className="nh3d-dialog-context-label-text">{label}</span>
    </div>
  );
}
