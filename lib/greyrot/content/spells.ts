/**
 * The element composition tables — the third combat direction's centre.
 *
 * You queue up to three elements and cast; the *combination* is the spell.
 * This file is DATA (`CLAUDE.md` §6): no functions with behaviour, no imports
 * from the renderer, nothing that reads a clock. `sim/rt/spell.ts` applies it.
 *
 * ## Why this is compositional rather than a 56-row table
 *
 * Same reason `statuses.ts` keys its combos on `element × existing statuses`:
 * a table with one row per mix drifts, and a seventh element would need 100+
 * new rows written by hand. So a mix resolves through **rules** — cancellation,
 * a primary element, a magnitude from the count — and only the handful of
 * pairings that deserve their own identity are authored below.
 *
 * Every mix is legal. Nothing is ever "an invalid combination"; the worst case
 * is a fizzle, which is itself a lesson.
 */

import type { Element, StatusId } from "./types";

/* ------------------------------------------------------- the six castables */

/**
 * The six elements the player can queue, in button order.
 *
 * The sixth element is `spore`, and it used to be called `physical` — a
 * leftover from the turn engine, where "a physical attack" was a category of
 * ability rather than a thing you cast. A burst of spores is castable in
 * Greyrot's fiction; "physical" is not. It kept the old id until the turn
 * tables were deleted, because a rename that touches the status matrix is not
 * worth doing twice, and the matrix had two consumers until then.
 */
export interface Castable {
  element: Element;
  /** The word on the button. One syllable where possible; 44 px is not wide. */
  label: string;
  /** Physical key position, matched on `KeyboardEvent.code` so AZERTY works. */
  code: string;
  /** The letter drawn on the button for keyboard players. */
  legend: string;
}

export const CASTABLES: readonly Castable[] = [
  { element: "water", label: "WATER", code: "KeyQ", legend: "Q" },
  { element: "fire", label: "FIRE", code: "KeyW", legend: "W" },
  { element: "frost", label: "FROST", code: "KeyE", legend: "E" },
  { element: "lightning", label: "SPARK", code: "KeyA", legend: "A" },
  { element: "oil", label: "OIL", code: "KeyS", legend: "S" },
  { element: "spore", label: "SPORE", code: "KeyD", legend: "D" },
];

/* ------------------------------------------------------ the found bitmask */

/**
 * The campaign save's `found` field, encoded here because CASTABLES is the
 * single source of the element ORDER: bit i is CASTABLES[i], bit 6 is THE
 * WEAVE. It exists because finds are TAKEN, not walked over (third playtest)
 * — a player can clear stages while deliberately leaving a find standing, so
 * held power is a decision the save must record, not something derivable
 * from the stages walked.
 */
export const FOUND_WEAVE_BIT = 1 << CASTABLES.length;

export function encodeFound(unlocked: readonly Element[], wove: boolean): number {
  let bits = wove ? FOUND_WEAVE_BIT : 0;
  CASTABLES.forEach((c, i) => {
    if (unlocked.includes(c.element)) bits |= 1 << i;
  });
  return bits;
}

export function foundHas(bits: number, kind: Element | "weave"): boolean {
  if (kind === "weave") return (bits & FOUND_WEAVE_BIT) !== 0;
  const i = CASTABLES.findIndex((c) => c.element === kind);
  return i >= 0 && (bits & (1 << i)) !== 0;
}

/**
 * Maximum elements in one cast. **2, by owner decision (2026-08-08):** "mixing
 * 2 should be max for now." A third slot is *reserved* as a future Act's power
 * spike — raising this to 3 opens 56 more mixes without a new element, which
 * is exactly the kind of expansion CrazyGames' quality guidance asks games to
 * keep in their pocket. Do not raise it casually: the grimoire index, the
 * save's bitset and the HUD strip all derive from it.
 */
export const QUEUE_MAX = 2;

/*
 * Cancellation is retired — every mix does something that is NEEDED (owner
 * decision, same date). Fire+water used to annihilate to a fizzle; it is now
 * Steam Vent, a spell with a job. The anti-synergy lesson (combos are
 * decisions) survives where it always mattered most: on IMPACT, in the status
 * matrix — fire onto a Wet target still extinguishes rather than burning.
 */

/**
 * Tie-break order when no element has a plurality in the mix.
 *
 * Most *active* first — a mix that is one part lightning and one part oil reads
 * as a discharge, not as a puddle. Fixed order, never sorted at runtime by
 * anything that could differ between machines.
 */
export const PRECEDENCE: readonly Element[] = [
  "lightning",
  "fire",
  "frost",
  "oil",
  "water",
  "spore",
];

/* -------------------------------------------------------------- the forms */

/**
 * How a cast leaves the caster. Two, not four.
 *
 * Magicka has four; we have two, because the touch scheme has one cast button
 * and a third form would mean the phone player is playing a different game.
 * The expressive space is preserved by moving it into the mix instead: a spell
 * that leaves a patch leaves one wherever it lands, so "ground-target" is a
 * property of what you composed rather than a separate control to learn.
 */
export type CastForm =
  /** Away from the caster, at the cursor or the auto-aim target. */
  | "aimed"
  /** Centred on the caster. This is the one that sets you on fire. */
  | "self";

/* ------------------------------------------------ authored notable mixes */

/** A pairing that earns its own identity. Order-independent. */
export interface NotableMix {
  pair: readonly [Element, Element];
  name: string;
  /** Overrides the status the primary element would apply. */
  status?: StatusId;
  /** Multiplier on the composed damage. */
  damage?: number;
  /** Leaves this patch kind where it lands. */
  patch?: PatchKind;
  /** Metres the target is shoved away from the impact. */
  knockback?: number;
  /** Passes through the first thing it hits and keeps going. */
  pierces?: boolean;
  /** Impact radius in metres, overriding the default. */
  radius?: number;
  /** Projectile speed multiplier. Speed as an identity, not a stat spray. */
  speed?: number;
}

export type PatchKind = "water" | "fire" | "oil" | "ice";

/**
 * ALL fifteen pairs, each with a name, a logic, and — the owner's rule — a
 * JOB. With a queue of two, this table plus the six singles and six doubles
 * IS the spell list (27 mixes), so there is no "filler pair" to hide behind:
 * a pair without a niche is a pair that teaches the player mixing is noise.
 *
 * The logic column of the design table lives in `GAME_DESIGN.md` §3.1; the
 * two former cancellations are the first two entries, because a mix that
 * produced NOTHING was the old rule and Hugo's feedback retired it.
 */
export const NOTABLE: readonly NotableMix[] = [
  {
    // Water on fire is steam. ("Stone" was considered and declined: nothing
    // in the six is earth, so stone would come from nowhere.) The job: the
    // panic button — a scalding shove that soaks whatever it catches.
    pair: ["water", "fire"],
    name: "Steam Vent",
    status: "wet",
    damage: 1.1,
    radius: 2.4,
    knockback: 3.0,
  },
  {
    // Fire meeting frost is violent expansion — the "gas" instinct, made
    // concussive. The job: the single-target payload, and the shatter
    // delivery for anything Frozen.
    pair: ["fire", "frost"],
    name: "Thermal Shock",
    damage: 1.55,
    radius: 1.1,
    knockback: 1.2,
  },
  {
    pair: ["water", "frost"],
    name: "Ice Shard",
    status: "frozen",
    damage: 1.35,
    pierces: true,
  },
  {
    pair: ["fire", "oil"],
    name: "Sticky Flame",
    status: "burning",
    damage: 1.2,
    patch: "fire",
    radius: 2.6,
  },
  {
    // THE REQUIRED-MIX STAR: it lays the water it conducts through, so a dry
    // fight can be chained anyway. The Dry Gulch is staged around exactly this.
    pair: ["lightning", "water"],
    name: "Conduction",
    status: "shocked",
    patch: "water",
    radius: 2.2,
  },
  {
    pair: ["frost", "spore"],
    name: "Shatter Hammer",
    damage: 1.4,
    knockback: 3.2,
  },
  {
    pair: ["lightning", "spore"],
    name: "Discharge",
    status: "shocked",
    radius: 3.4,
    knockback: 1.6,
  },
  {
    pair: ["oil", "spore"],
    name: "Tar Burst",
    status: "oiled",
    patch: "oil",
    radius: 2.8,
    knockback: 2.0,
  },
  {
    // Water plus matter is mud. The job: the control tool — it bogs a charger
    // down (soaked and heavily shoved) without needing a status the set does
    // not have. A true "slowed" status is M2 work; the shove carries the job
    // until then.
    pair: ["water", "spore"],
    name: "Mudshot",
    status: "wet",
    damage: 1.1,
    knockback: 3.6,
    radius: 1.6,
  },
  {
    // Emulsion. The job: hazard prep at a shove's distance — one cast that
    // soaks the target AND slicks the floor under it for whatever comes next.
    pair: ["water", "oil"],
    name: "Slick Wash",
    status: "wet",
    patch: "oil",
    damage: 0.9,
    radius: 3.0,
    knockback: 2.2,
  },
  {
    // Plasma. The job: speed — the bolt for the foe you barely have time to
    // face. Identity carried by velocity, not by a bigger number.
    pair: ["fire", "lightning"],
    name: "Flashfire",
    status: "burning",
    damage: 1.15,
    radius: 0.9,
    speed: 1.7,
  },
  {
    // Smoke and embers. The job: the wide soft burn — crowd DoT across a pack
    // that a single fire bolt would only clip.
    pair: ["fire", "spore"],
    name: "Ash Cloud",
    status: "burning",
    damage: 0.8,
    radius: 3.4,
  },
  {
    // Congealed slick frozen solid. The job: area denial — the most slippery
    // floor the game can lay (PATCH_SLIP ice = 4).
    pair: ["frost", "oil"],
    name: "Black Ice",
    patch: "ice",
    damage: 0.9,
    radius: 2.6,
  },
  {
    // Static chill. The job: the lockdown bolt — Shocked's slow, delivered
    // cold, for the foe that must not reach you.
    pair: ["frost", "lightning"],
    name: "Hoarfrost",
    status: "shocked",
    damage: 1.1,
    knockback: 0.8,
  },
  {
    // A spark IS an ignition source. The job: light the floor at range — the
    // fire patch it leaves ignites any oil it touches through the field's own
    // spread rules.
    pair: ["lightning", "oil"],
    name: "Ignition Arc",
    patch: "fire",
    damage: 1.0,
    radius: 1.6,
  },
];

/* ------------------------------------------------- per-element base values */

/** What one unit of an element contributes before composition. */
export interface ElementProfile {
  /** Base damage per element in the mix. */
  damage: number;
  /** Status this element applies on impact, before interactions. */
  status: StatusId | null;
  /** Patch left where it lands, if any. */
  patch: PatchKind | null;
  /** Metres of shove on impact. */
  knockback: number;
  /**
   * Shape identity, applied only when the cast holds ONE distinct element —
   * singles and same-element doubles. Pairs keep `NOTABLE` authoritative.
   * These are the playtest's "polish each element's attack width and
   * distance": before them all six singles shared one identical bolt.
   */
  /** Multiplier on the composed blast radius. */
  radiusMul?: number;
  /** Multiplier on projectile speed. */
  speedMul?: number;
  /** Multiplier on flight range (caps distance; never extends the aim). */
  rangeMul?: number;
}

export const ELEMENT_PROFILE: Record<Element, ElementProfile> = {
  // The wide soak. Slightly broad — it exists to wet things, not to snipe.
  water: { damage: 4, status: "wet", patch: "water", knockback: 0.4, radiusMul: 1.2 },
  // The honest baseline, a touch eager in flight.
  fire: { damage: 11, status: "burning", patch: null, knockback: 0, speedMul: 1.1 },
  // The quick shard: tight and fast.
  frost: { damage: 8, status: null, patch: null, knockback: 0, radiusMul: 0.9, speedMul: 1.2 },
  // The precision bolt: narrowest and much the fastest — the skill shot.
  // 13.6, not 13 (R6a, fun's worth-casting pass): the double was dominated by
  // Flashfire in all seven measured scenarios and landed 33 on the 34-hp
  // rotling — one hp under the chapter's defining execute. At 13.6 the
  // double is EXACTLY 34: a clean no-status kill-shot niche burn cannot
  // copy. Single rounds to 14, Conduction to 22; the opening is spore-driven
  // and unmoved. rt.test.ts pins the execute against the rotling's hp.
  lightning: {
    damage: 13.6,
    status: null,
    patch: null,
    knockback: 0.3,
    radiusMul: 0.8,
    speedMul: 1.5,
  },
  // The lobbed floor splash: wide, heavy, a little short.
  oil: { damage: 2, status: "oiled", patch: "oil", knockback: 0, radiusMul: 1.3, speedMul: 0.9, rangeMul: 0.9 },
  // Pim's own nature: a short, wide shove of a puff. Highest knockback in the
  // table already; the shape now says so too.
  spore: {
    damage: 9,
    status: null,
    patch: null,
    knockback: 1.4,
    radiusMul: 1.5,
    speedMul: 0.85,
    rangeMul: 0.6,
  },
};

/* ------------------------------------------------------ patch behaviour */

/**
 * What happens when an element lands on a patch that is already there.
 *
 * `null` means the patch is removed. This is the ground-level half of the
 * status matrix and it is what makes real-time chaotic rather than merely
 * fast: the floor remembers what you did to it twenty seconds ago.
 */
export const PATCH_REACTION: Partial<
  Record<PatchKind, Partial<Record<Element, PatchKind | null>>>
> = {
  oil: {
    // The one everybody discovers first, and it should be spectacular.
    fire: "fire",
  },
  water: {
    frost: "ice",
    // Water conducts rather than transforming — handled in sim/rt/field.ts.
    fire: "water",
  },
  fire: {
    water: null,
    frost: null,
  },
  ice: {
    fire: "water",
  },
};

/** Statuses applied to anything standing in a patch. `null` = none. */
export const PATCH_STATUS: Record<PatchKind, StatusId | null> = {
  water: "wet",
  fire: "burning",
  oil: "oiled",
  // Ice does not afflict — it makes you slide, which is `PATCH_SLIP`.
  ice: null,
};

/** Friction multiplier while standing in a patch. 1 is normal ground. */
export const PATCH_SLIP: Record<PatchKind, number> = {
  water: 1,
  fire: 1,
  oil: 2.2,
  ice: 4,
};

/** Ticks a freshly-laid patch lives for, at 30 Hz. */
export const PATCH_TICKS: Record<PatchKind, number> = {
  water: 300, // 10 s
  fire: 150, // 5 s — fire is the one that must not outstay its welcome
  oil: 450, // 15 s
  ice: 240, // 8 s
};
