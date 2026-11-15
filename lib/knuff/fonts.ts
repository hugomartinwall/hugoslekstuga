/**
 * A canvas `ctx.font` cannot read CSS variables, and next/font hashes its
 * family names. So the three families are resolved off probe spans wearing
 * the site's utility classes, as the other games do. No wait for the fonts
 * to load: the game draws every frame, so a late swap-in corrects itself.
 */
export type KnuffFonts = {
  /** Jersey 15: numbers in play. */
  display: string;
  /** Silkscreen: labels. */
  pixel: string;
  /** Chivo Mono: a sentence. */
  sans: string;
};

function resolveFamily(cls: "font-display" | "font-pixel" | "font-sans"): string {
  const probe = document.createElement("span");
  probe.className = cls;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family || "ui-monospace, monospace";
}

export function resolveKnuffFonts(): KnuffFonts {
  return {
    display: resolveFamily("font-display"),
    pixel: resolveFamily("font-pixel"),
    sans: resolveFamily("font-sans"),
  };
}
