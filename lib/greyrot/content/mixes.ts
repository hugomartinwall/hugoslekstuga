/**
 * The grimoire's index: every distinct mix, numbered.
 *
 * The grimoire is a **record of what you worked out**, not a manual you study
 * (`GAME_DESIGN.md` §4), so what it stores is one bit per mix — and a bit needs
 * a stable number to sit at. §7's rule is decisions and seeds, never derived
 * state; "which mixes have I seen" is the smallest possible decision log.
 *
 * ## The count derives from QUEUE_MAX
 *
 * With the queue at 2 (owner decision — mixing two is the max for now) the
 * grimoire holds **27** mixes: 6 singles + 21 pairs-with-repeats. If a future
 * Act unbolts the reserved third slot, this enumeration grows to 83 on its
 * own — and the save's grimoire bitset resizes with it, which is a schema
 * change and gets a version bump, not a shrug.
 *
 * Generated rather than written out, because hand-typed keys are typos that
 * only show up as save-slot collisions in Act 2.
 *
 * ## Canonical order
 *
 * A mix is a SET with repeats, not a sequence: FIRE+OIL and OIL+FIRE are the
 * same discovery, and `resolveMix` already refuses to let queue order change
 * the outcome. So the key sorts by `PRECEDENCE` — a fixed authored order, never
 * a runtime sort by anything that could differ between machines.
 */

import { PRECEDENCE, QUEUE_MAX } from "./spells";
import type { Element } from "./types";

/** Rank in the authored precedence order. The only ordering the key uses. */
function rank(e: Element): number {
  const i = PRECEDENCE.indexOf(e);
  return i < 0 ? PRECEDENCE.length : i;
}

/**
 * The canonical key for a queue: its elements in precedence order.
 *
 * Takes the RAW queue, before cancellation. FIRE+WATER is a discovery — it is
 * the anti-synergy lesson, and the player who casts it has learned something
 * even though the spell fizzled. Recording the resolved spell instead would
 * quietly file every fizzle under the same empty entry.
 */
export function mixKey(elements: readonly Element[]): string {
  return [...elements].sort((a, b) => rank(a) - rank(b)).join("+");
}

/** Every distinct mix of 1 to QUEUE_MAX elements, in a fixed generated order. */
export const MIX_KEYS: readonly string[] = (() => {
  const out: string[] = [];
  // Multisets of each size up to the queue cap, in precedence order — the
  // recursion keeps indices non-decreasing, so every set appears exactly once.
  const walk = (fromIndex: number, held: Element[]): void => {
    if (held.length > 0) out.push(mixKey(held));
    if (held.length >= QUEUE_MAX) return;
    for (let i = fromIndex; i < PRECEDENCE.length; i++) {
      walk(i, [...held, PRECEDENCE[i]!]);
    }
  };
  walk(0, []);
  return out;
})();

const INDEX: ReadonlyMap<string, number> = new Map(MIX_KEYS.map((k, i) => [k, i]));

/** The grimoire slot for a queue, or -1 if it is not a legal mix. */
export function mixIndex(elements: readonly Element[]): number {
  if (elements.length === 0) return -1;
  return INDEX.get(mixKey(elements)) ?? -1;
}

/** How many slots the grimoire has. The save sizes its bitset from this. */
export const MIX_COUNT = MIX_KEYS.length;
