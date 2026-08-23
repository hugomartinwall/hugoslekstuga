/**
 * The six statuses and their interaction matrix — the depth of the game
 * (`CLAUDE.md` §10.1, `docs/GAME_DESIGN.md` §3.4).
 *
 * The interactions live in `element × the target's existing statuses`, so an
 * ability inherits every combo from its element and cannot forget one. Adding
 * a fire ability automatically spreads Burning off Oiled and automatically
 * fizzles against Wet; nobody has to remember to wire it.
 *
 * Every entry here needs a row in `docs/PEDAGOGY.md` before it ships. A
 * mechanic nobody notices is not "undocumented", it is unshipped.
 */

import type { Element, Status, StatusId } from "./types";

export const STATUSES: Record<StatusId, Status> = {
  burning: {
    id: "burning",
    name: "Burning",
    damagePerTurn: 6,
    incoming: {},
    speedDelta: 0,
    skipsTurn: false,
    turns: 3,
  },
  wet: {
    id: "wet",
    name: "Wet",
    damagePerTurn: 0,
    // Wet resists fire and conducts lightning. The resistance is what makes
    // Burning + Wet an honest anti-synergy rather than a hidden gotcha.
    incoming: { fire: 0.5, lightning: 1.5 },
    speedDelta: 0,
    skipsTurn: false,
    turns: 3,
  },
  shocked: {
    id: "shocked",
    name: "Shocked",
    damagePerTurn: 0,
    incoming: {},
    // The whole point of Shocked is visible in the initiative queue: you can
    // SEE the tempo you stole. A status the player cannot observe is not a
    // mechanic.
    speedDelta: -6,
    skipsTurn: false,
    turns: 2,
  },
  frozen: {
    id: "frozen",
    name: "Frozen",
    damagePerTurn: 0,
    incoming: {},
    speedDelta: 0,
    skipsTurn: true,
    turns: 1,
  },
  oiled: {
    id: "oiled",
    name: "Oiled",
    damagePerTurn: 0,
    incoming: { fire: 1.6 },
    speedDelta: 0,
    skipsTurn: false,
    turns: 3,
  },
  bleeding: {
    id: "bleeding",
    name: "Bleeding",
    damagePerTurn: 3,
    incoming: {},
    speedDelta: 0,
    skipsTurn: false,
    turns: 3,
  },
};

export const STATUS_IDS = Object.keys(STATUSES) as StatusId[];

/* ------------------------------------------------------------ the matrix */

/** What an incoming element does to a status already on the target. */
export interface Interaction {
  /** Statuses stripped from the target. */
  removes?: StatusId[];
  /** Status forced onto the target, overriding the ability's own. */
  applies?: StatusId;
  /**
   * Suppress the ability's own `applies` entirely.
   *
   * Needed for the anti-synergy: fire onto Wet must leave the target with
   * NEITHER status. Without this the interaction stripped the Wet and then the
   * ability cheerfully applied Burning anyway, so "extinguishes" quietly
   * became "costs one turn of Wet and still sets you alight" — the opposite of
   * the intended lesson. Caught by the status-matrix test, not by review.
   */
  blocksApply?: boolean;
  /** Damage multiplier on this hit, on top of the status's own `incoming`. */
  damageMultiplier?: number;
  /** Chain to every other combatant on the target's side sharing `chainOn`. */
  chainOn?: StatusId;
  /** Spread `applies` to the ranks adjacent to the target. */
  spreadsToAdjacentRanks?: boolean;
  /** A short, player-facing name for the combo — used by the HUD flash. */
  label: string;
}

/**
 * `INTERACTIONS[element][existingStatus]`.
 *
 * Read the anti-synergy first, because it is the one that makes the rest
 * meaningful: **fire onto Wet extinguishes** rather than burning. Combos are
 * decisions, not free wins — if every pairing were positive there would be
 * nothing to think about.
 */
export const INTERACTIONS: Partial<Record<Element, Partial<Record<StatusId, Interaction>>>> = {
  fire: {
    // Burning + Wet extinguishes. The anti-synergy (`CLAUDE.md` §10.1).
    // Both statuses end up gone: the water is spent AND nothing catches.
    wet: { removes: ["wet"], blocksApply: true, damageMultiplier: 0.5, label: "Doused" },
    // Oiled + Fire spreads to the neighbouring ranks.
    oiled: {
      removes: ["oiled"],
      applies: "burning",
      spreadsToAdjacentRanks: true,
      label: "Oil ignites",
    },
  },
  water: {
    // Water puts fires out. Same rule from the other direction.
    burning: { removes: ["burning"], applies: "wet", label: "Extinguished" },
  },
  lightning: {
    // Wet + Lightning chains to every other Wet target on that side.
    wet: { applies: "shocked", chainOn: "wet", damageMultiplier: 1.0, label: "Chain!" },
  },
  frost: {
    // Wet + Frost freezes.
    wet: { removes: ["wet"], applies: "frozen", label: "Frozen solid" },
  },
  spore: {
    // A hard burst shatters a frozen target and frees it.
    frozen: { removes: ["frozen"], damageMultiplier: 2.0, label: "Shatter!" },
  },
};

/** The interaction for this element against a target carrying these statuses. */
export function interactionFor(
  element: Element,
  present: readonly StatusId[],
): Interaction | null {
  const byStatus = INTERACTIONS[element];
  if (!byStatus) return null;
  // Deterministic priority: STATUS_IDS order, never the target's array order,
  // so two targets with the same statuses in a different sequence resolve the
  // same way. Replay depends on this.
  for (const id of STATUS_IDS) {
    if (present.includes(id) && byStatus[id]) return byStatus[id]!;
  }
  return null;
}
