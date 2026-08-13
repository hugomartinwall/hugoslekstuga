import type { Faction } from "../sim/state";

/**
 * The one place faction colors live. Indexed by Faction (0 neutral, 1 player,
 * 2 Warlord, 3 Builder, 4 Vulture).
 *
 * Re-skinned to Nattöppet: player cyan, Warlord coral, Builder acid, Vulture
 * violet on the site's room-dark surfaces. Builder is acid rather than
 * upstream's amber — against our coral it gives ~30 L* of lightness
 * separation where amber gave 13.6, and under deuteranopia lightness is the
 * only cue that pair has left. Values mirror lib/colors.ts (canvas can't
 * read CSS variables); if you find yourself typing an rgba() into
 * renderer.ts, add it here instead — that's what keeps the next sync cheap.
 *
 * Colorblind rationale: asserted under simulated deuteranopia/protanopia/
 * tritanopia in test/sigil.test.ts. With these values the weakest pair is
 * player/Vulture at 0.343 simulated distance (the player-vs-rival bound is
 * 0.08 — a 4× margin; upstream's own weakest pair sat at 0.093), and every
 * inkOn() ink clears the 3:1 contrast bound on the shaded limb fill,
 * tightest at 3.49 on player cyan.
 *
 * Colour is not the only faction channel off the board — the ticker badges,
 * intro-card legend, death marks (render/sigil.ts) and share-bar hatches are
 * shape-coded. ON the board it is the only channel since 2026-08-10 (in-ball
 * sigils removed at Hugo's call), which makes these CVD assertions the load-
 * bearing defence for ball identity.
 *
 * Typed as Record<Faction, string> rather than readonly string[] so tsc
 * enforces totality and call sites drop their non-null assertions.
 */
export const FACTION_COLORS: Record<Faction, string> = {
  0: "#8e97a8", // neutral — ink-muted
  1: "#35e0ff", // player — cyan. Sacred; never reassign.
  2: "#ff6e5e", // Warlord — coral
  3: "#d8ff3d", // Builder — acid
  4: "#a78bff", // Vulture — violet
};

export const FACTION_DIM: Record<Faction, string> = {
  0: "rgba(142,151,168,0.35)",
  1: "rgba(53,224,255,0.35)",
  2: "rgba(255,110,94,0.35)",
  3: "rgba(216,255,61,0.35)",
  4: "rgba(167,139,255,0.35)",
};

/** Neutral is deliberately nameless — "NEUTRAL" would surface in the ticker
 *  and intro card, where it means nothing. */
export const FACTION_NAMES: Record<Faction, string> = {
  0: "",
  1: "YOU",
  2: "WARLORD",
  3: "BUILDER",
  4: "VULTURE",
};

/** Panel fill — mirrors the site's --color-panel. */
export const UI_PANEL = "#1e2136";
/** Core ice: currency, checkpoints, "this is good". */
export const UI_ACCENT = "#8af0ff";
/** UI_ACCENT as an rgb triple, for `rgba(${...},a)` call sites. */
export const UI_ACCENT_RGB = "138,240,255";
/** rgb triples, for `rgba(${...},a)` — scrims and ink vary only in alpha. */
export const UI_SCRIM = "5,6,12";
export const UI_INK = "232,242,233";
export const UI_PLAYER = "53,224,255";

/** Stars, streak flame, objective gold — the site's amber. Free for this role
 *  precisely because Builder is acid here, not upstream's amber. */
export const GOLD_HEX = "#ffb13d";

/**
 * Semantic colours. NOT faction colours.
 *
 * The defeat title used to reach into FACTION_COLORS[2] for a generic "bad",
 * which meant losing to anyone painted the screen Warlord red — muddying
 * red-as-Warlord at the emotional peak of a loss. danger stays coral-family
 * but measurably apart from the Warlord (0.21–0.24 simulated CVD distance,
 * where upstream's equivalent pair had 0.10).
 */
export const SEMANTIC = {
  danger: "#ff9b82",
  accent: UI_ACCENT,
} as const;

/** Room-dark ink on bright fills (Builder acid), phosphor everywhere else —
 *  the site rule: every accent takes room-dark text. */
export function inkOn(faction: Faction): string {
  return faction === 3 ? "#0b0c14" : "#e8f2e9";
}

/** `inkOn` at an alpha. Three call sites hardcoded this rule independently. */
export function inkOnAlpha(faction: Faction, a: number): string {
  return faction === 3 ? `rgba(11,12,20,${a})` : `rgba(232,242,233,${a})`;
}

/** Particle palette: slots 0–4 = faction colors, 5 = phosphor, 6 = ember.
 *
 *  Do NOT add slots casually: ParticlePool.draw iterates
 *  PARTICLE_PALETTE.length × MAX_PARTICLES every frame regardless of how many
 *  particles are live, so each new entry costs another unconditional
 *  512-iteration pass forever. */
export const P_WHITE = 5;
export const P_EMBER = 6;
export const PARTICLE_PALETTE: readonly string[] = [
  FACTION_COLORS[0],
  FACTION_COLORS[1],
  FACTION_COLORS[2],
  FACTION_COLORS[3],
  FACTION_COLORS[4],
  "#e8f2e9",
  "#5c2a24",
];
