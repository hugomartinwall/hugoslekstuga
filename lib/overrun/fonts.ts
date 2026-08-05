import type { GameFonts } from "./render/renderer";

/**
 * Canvas `ctx.font` can't read CSS variables, and next/font hashes its
 * family names — so resolve the concrete families off probe spans wearing
 * the utility classes (same trick as PixelWordmark). No font-load wait
 * needed: the game re-renders every frame, so a late swap-in self-corrects.
 */
function resolveFamily(cls: "font-display" | "font-pixel"): string {
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
    display: resolveFamily("font-display"),
    pixel: resolveFamily("font-pixel"),
  };
}
