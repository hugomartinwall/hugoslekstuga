/**
 * Mix → spell. The composition rules from `content/spells.ts`, applied.
 *
 * Pure functions, no state, no randomness. `resolveMix` is called by the sim
 * when a cast fires AND by the HUD every frame to preview what the current
 * queue would produce — one implementation, so the preview can never promise
 * something the cast does not deliver. That mattered enough to be the reason
 * this is a pure function rather than a method on the state.
 *
 * ## The rules, in order
 *
 *   1. **Primary.** The element with a plurality; ties broken by PRECEDENCE,
 *      never by queue order, so the same set always resolves the same way.
 *   2. **Compose.** Damage sums the elements' profiles; the count sets cast
 *      time and radius.
 *   3. **Name it.** Two distinct elements are ALWAYS an authored pair — with a
 *      queue of two, all fifteen pairings carry their own identity, which is
 *      the owner's rule that every mix does something needed.
 *
 * Cancellation is retired. Fire+water used to annihilate to a fizzle; it is
 * Steam Vent now. The anti-synergy survives on IMPACT (the status matrix),
 * where it is a decision about a target rather than a wasted press.
 */

import {
  ELEMENT_PROFILE,
  NOTABLE,
  PRECEDENCE,
  type CastForm,
  type Element,
  type PatchKind,
  type StatusId,
} from "../../content";

/** A resolved cast, ready for the sim to launch. */
export interface Spell {
  /** Drives the FX colour, the audio voice, and which INTERACTIONS row fires. */
  primary: Element;
  /** Player-facing name, for the queue preview. "Ice Shard", "Steam". */
  name: string;
  damage: number;
  status: StatusId | null;
  patch: PatchKind | null;
  /** Impact radius, metres. Sub-metre means effectively single-target. */
  radius: number;
  /** Metres of shove applied to anything caught. */
  knockback: number;
  /** Projectile passes through its first victim. */
  pierces: boolean;
  /** Projectile speed multiplier. 1 for everything without a speed identity. */
  speed: number;
  /**
   * Flight cap, metres. The app always AIMS at `BASE_CAST_RANGE`; a spell
   * whose range is shorter detonates early on the same line. Never longer —
   * "detonates at the point it was aimed at" is pinned behaviour.
   */
  range: number;
  /** Ticks between the cast input and the spell existing. */
  castTicks: number;
  /** An empty cast. Unreachable through the sim (casting needs a queue), kept
   *  so the HUD preview of an empty strip stays total. */
  fizzled: boolean;
  /** How many elements composed it. */
  weight: number;
  /**
   * Multiplier on the GROUND the spell leaves — laid patch radius AND
   * lifetime, never the blast (R6a: Deluge, the water double, is "more
   * water, more puddle"). 1 for everything without a patch identity.
   */
  patchScale: number;
}

/** Projectile speed in metres per tick (≈14 m/s at 30 Hz). */
export const PROJECTILE_SPEED = 14 / 30;
/** Ticks a projectile lives before expiring (≈1.4 s ⇒ ~20 m range). */
export const PROJECTILE_TICKS = 42;
/**
 * The authored cast distance, metres — where forward-fire aims. Lives sim-side
 * (the input layer imports it) so per-element range identities resolve in the
 * same place as every other spell number.
 */
export const BASE_CAST_RANGE = 9;
/**
 * Single-element blast radius. 1.1 m, up from the original 0.9: blast radius
 * is one of the two sanctioned dials when forward-fire feels imprecise
 * (`CLAUDE.md` §12), and the playtest's "width makes it hard" pointed here.
 * Pairs keep their 1.4 base so no NOTABLE mix silently buffed.
 */
const SINGLE_RADIUS = 1.1;

/** The element with a plurality; ties broken by PRECEDENCE, never by order. */
function primaryOf(elements: readonly Element[]): Element {
  const counts = new Map<Element, number>();
  for (const e of elements) counts.set(e, (counts.get(e) ?? 0) + 1);
  let best = elements[0]!;
  let bestCount = -1;
  // Iterate PRECEDENCE rather than the mix, so the result cannot depend on
  // insertion order — replay determinism, same discipline as the engine's
  // initiative tie-break.
  for (const e of PRECEDENCE) {
    const n = counts.get(e) ?? 0;
    if (n > bestCount) {
      best = e;
      bestCount = n;
    }
  }
  return best;
}

/** The authored pair for exactly these two distinct elements, if any. */
function notableFor(distinct: readonly Element[]): (typeof NOTABLE)[number] | null {
  if (distinct.length !== 2) return null;
  for (const n of NOTABLE) {
    if (n.pair.includes(distinct[0]!) && n.pair.includes(distinct[1]!)) return n;
  }
  return null;
}

/** The empty cast. Unreachable through the sim; keeps the HUD preview total. */
function nothing(): Spell {
  return {
    primary: "spore",
    name: "—",
    damage: 0,
    status: null,
    patch: null,
    radius: 1.2,
    knockback: 0,
    pierces: false,
    speed: 1,
    range: BASE_CAST_RANGE,
    castTicks: 6,
    fizzled: true,
    weight: 0,
    patchScale: 1,
  };
}

/**
 * Resolve a queue into a spell.
 *
 * `form` only affects cast time — a self-cast is faster because it needs no
 * aim. Everything else about the spell comes from the mix, which is what makes
 * the two-form control scheme honest: the expressiveness lives in what you
 * composed, not in which button you released.
 */
export function resolveMix(elements: readonly Element[], form: CastForm): Spell {
  if (elements.length === 0) return nothing();
  const surviving = elements;

  const primary = primaryOf(surviving);
  const distinct = PRECEDENCE.filter((e) => surviving.includes(e));
  const weight = surviving.length;

  let damage = 0;
  let status: StatusId | null = null;
  let patch: PatchKind | null = null;
  let knockback = 0;
  for (const e of surviving) {
    const p = ELEMENT_PROFILE[e];
    damage += p.damage;
    knockback += p.knockback;
    // The primary's own status and patch win; a minor element contributes its
    // damage but does not get to decide what the spell leaves behind.
    if (e === primary) {
      status = p.status;
      patch = p.patch;
    }
  }

  // More elements is more spell, super-linearly — otherwise a three-element
  // mix is just three one-element casts with extra steps and nobody composes.
  damage *= 1 + (weight - 1) * 0.25;

  let name = distinct.map((e) => e.toUpperCase()).join("+");
  let radius = weight === 1 ? SINGLE_RADIUS : 1.4 + (weight - 2) * 0.5;
  let pierces = false;
  let speed = 1;
  let range = BASE_CAST_RANGE;

  // One distinct element — a single, or a same-element double — takes its
  // element's SHAPE identity. Two distinct elements are always an authored
  // pair, and the NOTABLE block below stays authoritative for those.
  let patchScale = 1;
  if (distinct.length === 1) {
    const p = ELEMENT_PROFILE[primary];
    radius *= p.radiusMul ?? 1;
    speed *= p.speedMul ?? 1;
    range *= p.rangeMul ?? 1;
    // DELUGE (R6a): the water double's identity is the GROUND — half again
    // the puddle, half again its life. fun's worth-casting pass found w²
    // with no moment anywhere (worst-tier damage, and Conduction beat every
    // wet-then-spark sequence as setup); "more water, more puddle" gives it
    // one without a single new rule, and ch2's frost panes inherit it.
    if (primary === "water" && weight >= 2) {
      name = "Deluge";
      patchScale = 1.5;
    }
  }

  const notable = notableFor(distinct);
  if (notable) {
    name = notable.name;
    if (notable.status !== undefined) status = notable.status;
    if (notable.patch !== undefined) patch = notable.patch;
    if (notable.damage !== undefined) damage *= notable.damage;
    if (notable.knockback !== undefined) knockback = notable.knockback;
    if (notable.radius !== undefined) radius = notable.radius;
    if (notable.pierces !== undefined) pierces = notable.pierces;
    if (notable.speed !== undefined) speed = notable.speed;
  }

  // 6 / 9 ticks — 0.2 s / 0.3 s. Long enough that a mix is a commitment under
  // pressure, short enough that it never feels like a cast bar. Self-casts
  // skip the aim and are two ticks faster. (The retired third slot's 13 ticks
  // goes with it — restore the step if the queue ever grows.)
  const castTicks = [6, 9][Math.min(1, weight - 1)]! - (form === "self" ? 2 : 0);

  return {
    primary,
    name,
    damage: Math.round(damage),
    status,
    patch,
    radius,
    knockback,
    pierces,
    speed,
    range,
    castTicks,
    fizzled: false,
    weight,
    patchScale,
  };
}
