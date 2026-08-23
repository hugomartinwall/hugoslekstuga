/**
 * `applyElement` — one element landing on one target, through the matrix.
 *
 * This is `combat/engine.ts`'s `resolveHit` with the ranks and the CombatState
 * taken out. The logic is the same and deliberately so: the interaction matrix
 * in `content/statuses.ts` is the most-tested thing in the project and it was
 * always the part worth keeping. What changes is the *shape* — it is now a pure
 * function over a status list rather than a method that mutates a combatant, so
 * the same call serves the hero, an enemy, a bystander and a barrel.
 *
 * Ranks become metres: `chainOn` chains within a radius instead of within a
 * side, and `spreadsToAdjacentRanks` spreads within a radius instead of to
 * rank ± 1. Nothing in the matrix table itself changes.
 */

import { STATUSES, interactionFor, type Element, type StatusId } from "../../content";

/** The outcome of one element hitting one target. Pure data; caller applies it. */
export interface ElementImpact {
  /** Final damage after status multipliers and the interaction's own. */
  damage: number;
  /** Status to add, after the interaction has had its say. `null` for none. */
  applies: StatusId | null;
  /** Statuses to strip. */
  removes: StatusId[];
  /** The combo's player-facing label — "Chain!", "Doused", "Shatter!". */
  combo: string | null;
  /** Chain to nearby targets carrying this status. `null` for no chain. */
  chainOn: StatusId | null;
  /** Spread `applies` to nearby targets. */
  spreads: boolean;
}

/** Product of every `incoming` multiplier the target's statuses impose. */
function statusMultiplier(present: readonly StatusId[], element: Element): number {
  let m = 1;
  for (const id of present) {
    const inc = STATUSES[id].incoming[element];
    if (inc !== undefined) m *= inc;
  }
  return m;
}

/**
 * Resolve one element against one target's current statuses.
 *
 * @param baseDamage  the spell's damage before any multiplier
 * @param element     drives which `INTERACTIONS` row is consulted
 * @param present     the target's current statuses
 * @param ownStatus   what the spell would apply on its own, before interactions
 */
export function applyElement(
  baseDamage: number,
  element: Element,
  present: readonly StatusId[],
  ownStatus: StatusId | null,
): ElementImpact {
  const inter = interactionFor(element, present);

  let damage = baseDamage;
  if (damage > 0) {
    damage *= statusMultiplier(present, element);
    if (inter?.damageMultiplier !== undefined) damage *= inter.damageMultiplier;
  }

  // The interaction's status wins over the spell's own — that is how water
  // onto Burning yields Wet, and how fire onto Oiled yields Burning even for a
  // spell that applies no status itself. `blocksApply` is the anti-synergy:
  // fire onto Wet must leave the target with NEITHER status, and without this
  // branch "extinguishes" quietly becomes "costs a turn of Wet and still sets
  // you alight". That bug shipped once; it does not ship twice.
  const applies = inter?.blocksApply ? (inter.applies ?? null) : (inter?.applies ?? ownStatus);

  return {
    damage: Math.max(0, Math.round(damage)),
    applies,
    removes: [...(inter?.removes ?? [])],
    combo: inter?.label ?? null,
    chainOn: inter?.chainOn ?? null,
    spreads: inter?.spreadsToAdjacentRanks === true,
  };
}

/* ------------------------------------------------------ status bookkeeping */

/** A status on a target, counted down in ticks rather than in turns. */
export interface ActiveStatus {
  id: StatusId;
  ticksLeft: number;
}

/**
 * Turns become ticks.
 *
 * The matrix authors durations in turns because it was written for a turn
 * queue. One turn is read as 1.5 seconds of real time — long enough that
 * Burning is a genuine problem, short enough that a mistake is survivable.
 * Kept as one constant so the whole feel of statuses is tunable from here.
 */
export const TICKS_PER_STATUS_TURN = 45;

/** Damage a status deals per second, derived from its per-turn value. */
export function statusDamagePerTick(id: StatusId): number {
  return STATUSES[id].damagePerTurn / TICKS_PER_STATUS_TURN;
}

/** Add or refresh a status. Returns true if it was newly applied. */
export function addStatus(
  list: ActiveStatus[],
  id: StatusId,
  ticks = STATUSES[id].turns * TICKS_PER_STATUS_TURN,
): boolean {
  const existing = list.find((s) => s.id === id);
  if (existing) {
    existing.ticksLeft = Math.max(existing.ticksLeft, ticks);
    return false;
  }
  list.push({ id, ticksLeft: ticks });
  return true;
}

/** Remove a status. Returns true if it was there. */
export function removeStatus(list: ActiveStatus[], id: StatusId): boolean {
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

export function hasStatus(list: readonly ActiveStatus[], id: StatusId): boolean {
  return list.some((s) => s.id === id);
}

export function statusIds(list: readonly ActiveStatus[]): StatusId[] {
  return list.map((s) => s.id);
}

/**
 * Tick every status down, returning the damage they dealt this tick.
 *
 * Fractional damage accumulates in the caller rather than here — rounding
 * per-tick would turn a 6-damage burn into either 0 or 30 depending on which
 * way it rounded, and neither is the authored number.
 */
export function tickStatuses(list: ActiveStatus[]): number {
  let damage = 0;
  for (const s of list) {
    damage += statusDamagePerTick(s.id);
    s.ticksLeft--;
  }
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]!.ticksLeft <= 0) list.splice(i, 1);
  }
  return damage;
}

/** Slowest speed multiplier any active status imposes. Frozen roots entirely. */
export function speedMultiplier(list: readonly ActiveStatus[]): number {
  let m = 1;
  for (const s of list) {
    const def = STATUSES[s.id];
    if (def.skipsTurn) return 0; // Frozen: rooted in place until it breaks
    // Shocked slows rather than reordering a queue there no longer is.
    if (def.speedDelta < 0) m *= 0.6;
  }
  return m;
}
