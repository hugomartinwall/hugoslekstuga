/**
 * Greyrot ships no font of its own — game2 declared no `font-family` at all
 * and rendered its HUD in whatever the browser defaulted to. On the site it
 * wears the house faces instead.
 *
 * Resolved off probe spans rather than read from CSS variables, because the
 * HUD's styles are injected into the UI root as literal CSS text (see
 * `ui/hud.ts`) and next/font hashes its family names. Same trick as
 * PixelWordmark, Overrun and Adventure.
 *
 * Unlike theirs this feeds CSS, not `ctx.font` — but the reasoning is
 * identical, and so is the tolerance for a late swap-in: the HUD restyles
 * itself as soon as the families land.
 */
export interface GameFonts {
  /** Chivo Mono — HUD copy, dialogue, seam panels. */
  body: string;
  /** Silkscreen — micro-labels, element chips, badges. */
  pixel: string;
}

function resolveFamily(cls: "font-sans" | "font-pixel"): string {
  const probe = document.createElement("span");
  probe.className = cls;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "ui-monospace, monospace";
}

export function resolveGameFonts(): GameFonts {
  return {
    body: resolveFamily("font-sans"),
    pixel: resolveFamily("font-pixel"),
  };
}
