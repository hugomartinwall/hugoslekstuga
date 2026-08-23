/**
 * The authored look, in one file.
 *
 * `docs/ART_DIRECTION.md` is the spec; this is its executable half. Every
 * colour, light intensity and grade value the renderer uses comes from here,
 * because the alternative — literals scattered across sky.ts, world/index.ts,
 * post.ts and half a dozen mesh generators — is how a game ends up with a look
 * that was accumulated rather than designed.
 *
 * **Rule: no colour literal anywhere else in src/render/.** If a new colour is
 * needed, add it to `ART_DIRECTION.md` §2 first, then here, then use it.
 *
 * Colours are authored in **sRGB**, in [0, 1] — the way a human picks them,
 * and the convention every consumer in this codebase already uses. The
 * conversion to linear happens once at each boundary: `Mesh.toGeometry()` for
 * meshes, `buildTerrainGeometry()` for terrain, `Sky`'s uniform upload for the
 * sky. Do not pre-convert here, or values get linearised twice and the whole
 * game turns muddy.
 */

import type { RGB } from "./mesh/dsl";

/* ------------------------------------------------------------------- world */

/**
 * The world palette. A warm hand-made forest floor at golden hour — warmth is
 * the default state and the Greyrot is the intrusion.
 */
export const WORLD = {
  skyZenith: [0.16, 0.33, 0.52] as RGB,
  /** Also the fog colour, so distance reads as haze rather than as a wall. */
  skyHorizon: [0.92, 0.72, 0.48] as RGB,
  skyGround: [0.3, 0.24, 0.15] as RGB,
  /** Amber, never white. A white sun makes everything look like a tech demo. */
  sunDisc: [1.0, 0.86, 0.62] as RGB,

  moss: [0.28, 0.42, 0.2] as RGB,
  mossLit: [0.55, 0.66, 0.28] as RGB,
  /** The ROAD tread. No longer the shoreline — see `shore` (round 6). */
  earth: [0.42, 0.31, 0.19] as RGB,
  /**
   * Damp silt at the waterline — cool and DARKER than earth, so the lake
   * edge reads soaked rather than sandy. Round 6: the old earth shoreline
   * band ran 3.6 m up from the water and the whole basin read tan.
   */
  shore: [0.3, 0.32, 0.24] as RGB,
  bark: [0.3, 0.21, 0.15] as RGB,
  water: [0.14, 0.36, 0.42] as RGB,
  /** The lake's middle — darker, never grey. */
  waterDeep: [0.1, 0.26, 0.34] as RGB,
  /** Shoreline lap only — a whisper, not a surf. */
  waterFoam: [0.88, 0.93, 0.9] as RGB,
  /** Terrain bands: steep faces and summits. */
  rock: [0.42, 0.38, 0.34] as RGB,
  lichen: [0.72, 0.74, 0.62] as RGB,
  /** Boulders — one step warmer than the terrain band. */
  scatterRock: [0.46, 0.43, 0.39] as RGB,
  leaf: [0.36, 0.5, 0.26] as RGB,
  leafWarm: [0.52, 0.58, 0.26] as RGB,
  /** Charred snag trunks (the ash country) — darker than bark, never black. */
  charBark: [0.19, 0.16, 0.15] as RGB,
  hutWall: [0.72, 0.64, 0.5] as RGB,
  hutRoof: [0.5, 0.3, 0.18] as RGB,
  hutDoor: [0.32, 0.22, 0.13] as RGB,
  /** The cozy signal. Use it liberally — but only where a lantern is visible. */
  lantern: [1.0, 0.72, 0.34] as RGB,
} as const;

/**
 * The three zones' ground colours (`ART_DIRECTION.md` §2.1b, round 7). The
 * band STRUCTURE is global; only the three low bands vary, blended per
 * terrain face by nearest road sample. The village rows alias the global
 * entries — the meadow IS the baseline. The ash rows are the tan-basin
 * reconciliation: char and cinder, sat ≤ 0.2, warm R-max against the Rot's
 * violet B-max — a desert of ash, never of sand, bounded by its arc-span.
 */
export const BIOME_GROUND = {
  village: { shore: WORLD.shore, ground: WORLD.moss, groundLit: WORLD.mossLit },
  fen: {
    /** Peat silt — darker than the global shore, so pond edges read drowned. */
    shore: [0.19, 0.22, 0.18] as RGB,
    /**
     * Bog green: moss darkened ~35% and cooled. Soaked, still green — first
     * capture round: at −30% the warm grade compressed it back into the
     * village moss and the fen read as the same meadow.
     */
    ground: [0.17, 0.27, 0.18] as RGB,
    /** Olive — the fen never goes fully golden. */
    groundLit: [0.33, 0.43, 0.25] as RGB,
  },
  ash: {
    /**
     * Wet charcoal — the Seeping Run's margins, and since R4's causeway
     * drop the WHOLE eastern tail (causeway 0.2 sits the stage footprint
     * inside the < 1.3 m shore ramp, so this row paints at arena scale).
     * The first value was R-max — fine as a thin pond margin, but the
     * amber key multiplied it into sand across the entire tail: the third
     * capture round to prove the same light × albedo trap. B-max now,
     * leaning HARDER than the dry char ground: a wet surface is sky-lit.
     */
    shore: [0.2, 0.21, 0.235] as RGB,
    /**
     * Char and cinder — and the albedo leans slightly COOL, deliberately.
     * What the player sees is light × albedo, and the amber key
     * (`sunDisc 1.0, 0.86, 0.62`) multiplies any warm-or-neutral grey into
     * tan — two capture rounds proved it (sat 0.19, then 0.14, both rendered
     * sand). A faint B-max albedo cancels against the warm light and LANDS
     * on warm grey: golden hour on ash, not a dune.
     */
    ground: [0.3, 0.305, 0.325] as RGB,
    /**
     * Sun-bleached pale cinder — the cancellation leans HARDER here than on
     * the low band: this ramp paints the big smooth sunlit rises, where a
     * merely-neutral product still pooled into khaki at arena scale.
     */
    groundLit: [0.37, 0.4, 0.46] as RGB,
  },
} as const;

/**
 * The medium art tier's surface detail (`ART_DIRECTION.md` §2.1a). All
 * procedural, all world-space — there are no UVs anywhere in this renderer.
 * Everything here is a MODULATION of palette colours, never a new colour:
 * the flat-shaded band look stays the design, this is the hand-made grain on
 * top of it.
 */
export const DETAIL = {
  /** Terrain albedo modulation, ± fraction of luminance. */
  terrainAmp: 0.06,
  /** Fraction the terrain noise pulls hue toward moss (up) / earth (down). */
  terrainHue: 0.05,
  /** Crevice darkening on slopes, max fraction. */
  crevice: 0.08,
  /** World-space noise scales, metres⁻¹ (two octaves). */
  scaleCoarse: 0.6,
  scaleFine: 2.9,
  /** Scatter (bark/boulder) speckle, ± fraction. */
  scatterAmp: 0.04,
  /** Grass sway at the blade tip, metres. */
  windAmp: 0.05,
  /** Composite-stage film grain, fraction. */
  grain: 0.015,
  /**
   * Ground haze: full this many metres above the waterline, gone `hazeFade`
   * higher. Tuned tight to the water on purpose — the first pass reached
   * 3.5 m and washed the whole valley floor to khaki, and the second was
   * still stacked on the old tan shoreline band over the same 3.3 m (round
   * 6: "the basin reads TAN"). The haze is lake breath, not a colour grade.
   */
  hazeBelow: 0.7,
  hazeFade: 1.6,
  /** How much of the fog colour the haze may contribute at full strength. */
  hazeAmount: 0.1,
} as const;

/**
 * The Greyrot. Desaturated and slightly violet, **never black** — black reads
 * as a hole punched in the frame, violet-grey reads as *drained*, which is the
 * story the game is telling.
 *
 * Hard rule: no Rot surface exceeds 0.12 saturation. If a Rot creature ever
 * reads as colourful, the whole readability system breaks — enemies stop
 * separating from the world at a glance.
 */
export const ROT = {
  body: [0.36, 0.34, 0.38] as RGB,
  growth: [0.48, 0.46, 0.52] as RGB,
  glow: [0.62, 0.58, 0.7] as RGB,
} as const;

/* ------------------------------------------------------------------- light */

/**
 * One key, one fill, plus lantern practicals. Three lights is a look; six is a
 * mess.
 *
 * The sun sits low (≈22° elevation) so it throws long readable shadows across
 * the stage — with a fixed 3/4 camera those shadows are most of what tells the
 * player how the ground is shaped.
 */
export const LIGHT = {
  /** Normalised sun direction. y ≈ sin(22°). */
  sunDir: [0.45, 0.37, 0.28] as RGB,
  keyIntensity: 2.1,
  /**
   * Cool sky fill against the warm key is what seats the characters in the
   * world. Shadows are warm-LIT, never black: if a shadow reads as a void,
   * raise THIS — never the key.
   *
   * It is deliberately high. Foliage shadows at this sun angle cover most of
   * the stage, and at intensity 1.0 every one of them read as a black hole in
   * the frame — a cozy forest floor cannot have voids in it. The fill now
   * carries roughly as much of the exposure as the key does, which is what
   * "lit like a toy theatre" actually means.
   */
  hemiSky: [0.72, 0.84, 1.0] as RGB,
  hemiGround: [0.46, 0.38, 0.24] as RGB,
  hemiIntensity: 2.5,
} as const;

/* ------------------------------------------------------------------- grade */

/**
 * The colour grade. Generous saturation on purpose — the world is meant to be
 * vivid, and the Greyrot's whole threat is that it takes that away.
 *
 * The saturation value here is a **gameplay device as well as a grade**:
 * clearing a stage pushes it up, standing in active Rot pulls it down. See
 * `GAME_DESIGN.md` §1.
 */
export const GRADE = {
  exposure: 1.05,
  saturation: 1.15,
  /** A touch of cool in the shadows. */
  lift: [0.006, 0.01, 0.02] as [number, number, number],
  vignette: 0.35,
  /** High enough that moss never blooms — glow belongs to fx and lanterns. */
  bloomThreshold: 0.85,
} as const;

/** Saturation floor when standing in active Greyrot. */
export const ROT_SATURATION = 0.42;

/**
 * The resaturation beat (R1): the grade's saturation is a GAMEPLAY device
 * (see GRADE above) and until this cycle nothing drove it — the uniform sat
 * at 1.15 forever and the game's central reward was invisible (fun's
 * baseline verdict: "unnoticed = unshipped"). These are the authored dials
 * of the drive itself; `render/fx/resaturation.ts` is the machine.
 *
 * `drained` is deliberately far above ROT_SATURATION: a locked fight greys
 * the WORLD while the status/FX vocabulary (§6) must stay identifiable —
 * 0.78 is grey-tinged, not grim. ROT_SATURATION stays reserved for standing
 * inside active Rot growth, a deeper future use.
 */
export const RESAT = {
  /** Grade saturation while a fight lock is up. The rot pressing in. */
  drained: 0.78,
  /** Seconds for the drain to ease in. Slow — a press, not a flash. */
  drainSeconds: 1.6,
  /** Stage-clear pulse peak — a warm breath above the resting grade. */
  overshoot: 1.34,
  /** Seconds the stage-clear overshoot takes to breathe back out. */
  pulseSeconds: 0.9,
  /** Wave front travel time, kill point to full frame. */
  waveSeconds: 1.1,
  /** Wave front thickness in aspect-corrected UV units. */
  waveWidth: 0.16,
  /** Additive strength of the warm band riding the wave front. */
  waveWarm: 0.34,
  /** Bloom strength lift during the stage-clear pulse (rides bloomStrength). */
  pulseBloom: 0.3,
} as const;

/* ---------------------------------------------------------------------- fx */

/**
 * One colour per status, used ONLY for that status, everywhere, forever.
 * Players learn this vocabulary in the first minute and it must never lie to
 * them (`ART_DIRECTION.md` §6).
 */
export const FX = {
  burning: [1.0, 0.42, 0.1] as RGB,
  burningTip: [1.0, 0.76, 0.3] as RGB,
  wet: [0.31, 0.7, 0.78] as RGB,
  frozen: [0.72, 0.9, 0.96] as RGB,
  shocked: [0.72, 0.83, 1.0] as RGB,
  oiled: [0.17, 0.13, 0.1] as RGB,
  /** Brief spray only — never pools. PEGI 12 (`CLAUDE.md` §1). */
  bleeding: [0.78, 0.26, 0.35] as RGB,
  /** The reward you can see without any UI: colour coming back. */
  colourRestored: [1.0, 0.88, 0.55] as RGB,
  rotSpore: [0.62, 0.58, 0.7] as RGB,
  /**
   * "Just got hurt" — an instant emissive blink on the struck body, used for
   * that and nothing else. It used to share a channel (and a hardcoded
   * amber) with the wind-up telegraph, so "about to hit you" and "took a
   * hit" read identically; the telegraph is now the attack's element colour
   * via `attackColour` (ART_DIRECTION §6).
   */
  hitFlash: [1.0, 0.92, 0.78] as RGB,
  /** Dust kicked up by footfalls. */
  dust: [0.62, 0.56, 0.44] as RGB,
  /**
   * Dry-out steam (§6): a boss coat boiling off — announces a dry window.
   * WARM-neutral pale, deliberately: from the diorama's high angle a rising
   * plume always crosses the body in screen space, and a cool-grey veil
   * over the violet hide read as FROZEN — a §6 lie. Amber-lit vapor is the
   * golden-hour truth and cannot say ice. Low intensity: vapor is matter
   * leaving, not energy arriving, so it must never bloom.
   */
  steam: [0.82, 0.8, 0.78] as RGB,
} as const;

/**
 * The colour of each castable element. **The single source, in sRGB.**
 *
 * Three copies of this existed at once — one in `render/rt-view.ts` for bolts
 * and impact particles, one in `ui/spell-hud.ts` for the element buttons, and
 * one in `main.ts` — and they had already drifted apart: the button for the
 * sixth element was dust-brown while its particles were pale yellow. A player
 * learns "this button throws that colour" in the first ten seconds, so a HUD
 * that disagrees with the world is a HUD that teaches the wrong thing.
 *
 * Mostly aliases of the status colours above, deliberately: an element and the
 * status it applies must read as the same thing. Oil is the exception —
 * `FX.oiled` is near-black, which is right for a slick on the ground and
 * invisible as a projectile, so the castable form is lifted.
 *
 * Consumers convert at their own boundary: the renderer to linear (`srgbToLinear`
 * — skipping it once made oil and fire render identically), the HUD to a CSS
 * `rgb()` string.
 */
export const ELEMENT_COLOUR = {
  water: FX.wet,
  fire: FX.burning,
  frost: FX.frozen,
  lightning: FX.shocked,
  oil: [0.35, 0.28, 0.2] as RGB,
  spore: [1.0, 0.9, 0.7] as RGB,
} as const satisfies Record<string, RGB>;

/**
 * Per-element PROJECTILE identity — the shape half of the vocabulary above,
 * from `ART_DIRECTION.md` §6's shape column. Colour says *which* element;
 * these say it again in motion, so a bolt reads before it lands: fire rises
 * and flickers, water falls in droplets, lightning is a thin instant streak,
 * frost is slow and crystalline, oil is heavy and low, spore is a soft puff.
 *
 * `boltScale`/`stretch` shape the bolt mesh itself (stretch elongates it along
 * its flight); the trail fields drive continuous particle emission per bolt.
 * Positive `trailGravity` falls, negative rises — same convention as the
 * particle system.
 */
export interface ElementFx {
  boltScale: number;
  stretch: number;
  /** Trail particles per second, per bolt. */
  trailRate: number;
  trailSize: number;
  trailLifetime: number;
  trailGravity: number;
}

export const ELEMENT_FX: Record<keyof typeof ELEMENT_COLOUR, ElementFx> = {
  fire: { boltScale: 1.0, stretch: 1.2, trailRate: 26, trailSize: 0.16, trailLifetime: 0.5, trailGravity: -1.8 },
  water: { boltScale: 1.1, stretch: 1.0, trailRate: 22, trailSize: 0.12, trailLifetime: 0.4, trailGravity: 2.4 },
  lightning: { boltScale: 0.7, stretch: 2.4, trailRate: 30, trailSize: 0.08, trailLifetime: 0.2, trailGravity: 0 },
  frost: { boltScale: 0.9, stretch: 1.2, trailRate: 14, trailSize: 0.11, trailLifetime: 0.85, trailGravity: 0.5 },
  oil: { boltScale: 1.2, stretch: 0.95, trailRate: 12, trailSize: 0.15, trailLifetime: 0.55, trailGravity: 2.8 },
  spore: { boltScale: 1.3, stretch: 1.0, trailRate: 16, trailSize: 0.17, trailLifetime: 0.9, trailGravity: -0.3 },
};

/**
 * A FOE's attack in flight: drifting Greyrot spores, slow and upward (§6's
 * Greyrot row) — the read that says "that one is not yours" even before the
 * colour does.
 */
export const FOE_TRAIL = {
  trailRate: 14,
  trailSize: 0.13,
  trailLifetime: 0.8,
  trailGravity: -0.5,
} as const;

/* ---------------------------------------------------------------------- ui */

/**
 * UI is authored in CSS pixels, never world units (`CLAUDE.md` §11 — game1's
 * world-unit UI broke on phones). These are the only type sizes in the game.
 */
export const UI = {
  type: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 },
  /** Minimum touch target, px, at every viewport. Not a pre-submission patch. */
  touchTarget: 44,
  panelBg: "#10141bd9",
  panelBorder: "#e8c07a55",
  text: "#f5e3bd",
  textDim: "#b8a67f",
  /** UI that animates longer than this feels slow under a thumb. */
  motionMs: 120,
} as const;

/* ------------------------------------------------------------------ helpers */

/** Pack a linear RGB triple into the 0xRRGGBB int three.js constructors take. */
export function hex(c: RGB): number {
  const b = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (b(c[0]) << 16) | (b(c[1]) << 8) | b(c[2]);
}
