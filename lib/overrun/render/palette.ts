import type { Faction } from "../sim/state";

/**
 * The one place the game's colours live — Nattöppet edition.
 *
 * Every literal the canvas paints should come from here. The renderer and fx
 * are copied wholesale from the upstream game on each re-sync, so the fewer
 * hexes live in those two files the cheaper the next sync is. If you find
 * yourself typing an rgba() into renderer.ts, add it here instead.
 *
 * Faction indices: 0 neutral, 1 player, 2 Warlord, 3 Builder, 4 Vulture.
 * Values mirror lib/colors.ts (canvas can't read CSS variables).
 *
 * Colourblind rationale: Warlord coral and Builder acid are the pair most at
 * risk — under deuteranopia both lose their hue cue and only lightness is
 * left. Upstream paired red with gold for ~21 L* of separation; coral against
 * acid gives ~30 L*, so the pair is safer here than it was there. Vulture
 * violet sits ~18 L* below the player's cyan (upstream: ~8). Verified with
 * DevTools vision-deficiency emulation at level 11+, where four factions
 * share the board.
 */
export const FACTION_COLORS: readonly string[] = [
  "#8e97a8", // neutral — ink-muted
  "#35e0ff", // player — cyan. Sacred; never reassign.
  "#ff6e5e", // Warlord — coral
  "#d8ff3d", // Builder — acid
  "#a78bff", // Vulture — violet
];

export const FACTION_DIM: readonly string[] = [
  "rgba(142,151,168,0.35)",
  "rgba(53,224,255,0.35)",
  "rgba(255,110,94,0.35)",
  "rgba(216,255,61,0.35)",
  "rgba(167,139,255,0.35)",
];

export const FACTION_NAMES: readonly string[] = ["", "YOU", "WARLORD", "BUILDER", "VULTURE"];

/** Room-dark ink on the bright fills, phosphor everywhere else. */
export function inkOn(faction: Faction): string {
  return faction === 3 ? "#0b0c14" : "#e8f2e9";
}

/* ── surfaces + chrome ─────────────────────────────────────────────── */

/** Phosphor text. Mirrors --color-ink / INK_HEX. */
export const INK = "#e8f2e9";
/** Phosphor at an alpha — the HUD's workhorse. */
export const ink = (a: number): string => `rgba(232,242,233,${a})`;
/** Coral at an alpha — damage, hearts, the mute slash. */
export const coral = (a: number): string => `rgba(255,110,94,${a})`;

/** The letterbox outside the board. Mirrors --color-cream. */
export const BG_LETTERBOX = "#0b0c14";
/** Raised panels: pause menu, shop. Mirrors --color-panel. */
export const BG_PANEL = "#1e2136";
/** Backdrop wash behind overlays. */
export const backdrop = (a: number): string => `rgba(5,6,12,${a})`;

/** Cores currency — ice. Amber is free for stars/streak now that Builder took acid. */
export const CORE_HEX = "#8af0ff";
/** Star ratings and the streak flame — amber. */
export const GOLD_HEX = "#ffb13d";

/* ── particles ─────────────────────────────────────────────────────── */

/** Particle palette: slots 0–4 = faction colours, 5 = ink, 6 = ember. */
export const P_WHITE = 5;
export const P_EMBER = 6;
export const PARTICLE_PALETTE: readonly string[] = [...FACTION_COLORS, INK, "#5c2a24"];
