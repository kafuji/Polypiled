import type { JSX } from "react/jsx-runtime";
export interface DesktopMessageLogProps {
  terminalDesktopGutterVisible: boolean;
  desktopGameMessageLog: JSX.Element | null;
  /** Player-position line at the bottom of the screen. */
  desktopStatusLine: JSX.Element | null;
}

export function DesktopMessageLog({
  terminalDesktopGutterVisible,
  desktopGameMessageLog,
  desktopStatusLine,
}: DesktopMessageLogProps) {
  return (
    <>
      {!terminalDesktopGutterVisible ? desktopGameMessageLog : null}
      {desktopStatusLine}
    </>
  );
}
