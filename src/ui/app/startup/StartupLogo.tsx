import type { CSSProperties } from "react";
import { commonStrings } from "../shared/translations";

// Both layers draw the same art; the subtitle is plain text under it.
const logoArt = `
                                            ;x$$&&&&$                                               :X&&$x   .xX$&&&&&.                               .xX$$&&&&X
xX$&&&&&&XXX$&&$Xx+:                          .X&&&&$                                               $&&&&&+     +&&&&&.                                  .X&&&&X
   X$$$$$    .x$$$$$X                          +$$$$X                                               .xXXX+      :$$$$$.                                   +$$$$X
   x$$$$$      X$$$$$;                         +$$$$X                                                           :$$$$$.                                   +$$$$X
   x$$$$$      x$$$$$;     .:+xx++xx+;.        ;$$$$X  .+++++++++;  .++++++;;;+++xx; :+xxxx+:     ;;;++xxx:     :$$$$$.       .;+x++xx+;.        .:+xxxxx+x$$$$X
   x$$$$$     :$$$$$+    .+X$$X.   ;$$$X;      ;$$$$X   .;X$$$$X.    .:$X;..:;X$$$$X+;;;X$$$$X:   .:+$$$$$;     :$$$$$.     :x$$X:  .X$$$x.    .+X$$$+. .;X$$$$x
   +XXXXX:::;xXXXX+:    .XXXXX.     ;XXXXx     ;XXXXx     .XXXXX;     ;X:     +XXXX+     +XXXXX.     XXXXX;     :XXXXX.    ;XXXX+    ;XXXXX   .xXXXX;     ;XXXXx
   +XXXXX;;;;;::.       xXXXXX      :XXXXX;    ;XXXXx      .XXXXX;   :X:      +XXXX+      XXXXXx     XXXXX;     .XXXXX.   .XXXXX+;;;;+XXXXX:  +XXXXX      ;XXXXx
   +XXXXX               XXXXXx      .XXXXX+    ;XXXXx       .xXXXX; .X;       +XXXX;      xXXXXx     XXXXX;     .XXXXX.   ;XXXXX;..........   xXXXX+      ;XXXXx
   +xxxxx               +xxxxx      :xxxxx:    ;xxxxx        .xxxxx;x;        +xxxx;      xxxxx+     xxxxx;     .xxxxx.   .xxxxx+             ;xxxxx.     ;xxxx+
   +xxxxx               .xxxxx.     ;xxxx;     ;xxxx+         .xxxxx+         ;xxxx;     :xxxx+.     xxxxx:     .xxxxx.    :xxxxx;       :+.  .+xxxx;     ;xxxx+
.::+xxxxx;:..            .;+xx+.  .;xxx+.    ..+xxxxx:.        .xxx+          ;xxxxx;...:xxx+:     .:xxxxx+:. ..;xxxxx;..   .;xxxx+;:::;++:    .;xxxx+;::;+xxxxx;:.
::::::::::::.               .:;;;;;;:..      ::::::::::.        .++           ;++++;.:;;;;:.      .:::::::::: .:::::::::.     ..:;;;;;:..        .:;;;;;...::::....
                                                         ::::  .;;            ;++++:
                                                        :+++++:+:             ;++++;
                                                        .:;++;:.           .:;++++++;;:.
`;
const logoLayers = [logoArt, logoArt];
// Part of the title, so it stays English in every locale.
const logoSubtitle = "a random NetHack variant";

// Preserve desktop's original spacing, but give VR the visible art's bounds.
const logoLayouts = logoLayers.map(logo => {
  const rows = logo.split("\n");
  const ink = rows.filter(row => row.trim().length > 0);
  const left = Math.min(...ink.map(row => row.length - row.trimStart().length));
  const right = Math.max(...ink.map(row => row.trimEnd().length));
  return { rows, left, width: right - left };
});

export interface StartupLogoProps {
  asciiLogoVisible: boolean;
}

export function StartupLogo({ asciiLogoVisible }: StartupLogoProps) {
  if (!asciiLogoVisible) return null;
  return (
    <div className="logo-container" role="img" aria-label={`${commonStrings.appName}: ${logoSubtitle}`}>
      {logoLayouts.map(({ rows, left, width }, layer) => {
        return <pre className="nethack-ascii-logo" aria-hidden="true" key={layer}
          style={{ "--nh3d-logo-ink-left": `${left}ch`, "--nh3d-logo-ink-width": `${width}ch` } as CSSProperties}>
          {rows.map((row, index) => <span className="nh3d-logo-row" key={index}
            style={{ "--nh3d-logo-wave-delay": `${index * 4.5 / Math.max(1, rows.length - 1)}s` } as CSSProperties}>
            {row || " "}
          </span>)}
          {layer === 0 ? <span className="nh3d-logo-row nh3d-logo-subtitle"
            style={{ "--nh3d-logo-wave-delay": "4.5s" } as CSSProperties}>
            {logoSubtitle}
          </span> : null}
        </pre>;
      })}
    </div>
  );
}
