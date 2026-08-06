import type { GameState } from "../sim/state";
import { PLAYER } from "../sim/state";

/**
 * One-time upgrade teaching nudge (SaveV3.flags.upgradeNudgeShown).
 * Pure predicates over sim state; the app layer owns the level gate,
 * the save flag, and the per-level lifecycle.
 */

/** Upgrade-eligible (chevron criteria minus `selected`) AND safe:
 *  no hostile flow targets it, no outbound flow drains it. */
export function isNudgeCandidate(state: GameState, nodeId: number): boolean {
  const n = state.nodes[nodeId];
  if (!n || n.owner !== PLAYER || n.size >= 2 || n.upgrading !== 0) return false;
  if (n.units < state.cfg.playerUpgradeCost[n.size as 0 | 1]) return false;
  for (const f of state.flows) {
    if (f.from === nodeId) return false;
    if (f.to === nodeId && state.nodes[f.from]!.owner !== PLAYER) return false;
  }
  return true;
}

/** Node to spotlight for the one-time nudge, or null. A still-valid
 *  stickyId is returned as-is so the nudge doesn't hop between nodes. */
export function pickUpgradeNudgeNode(
  state: GameState,
  stickyId?: number | null,
): number | null {
  if (stickyId != null && isNudgeCandidate(state, stickyId)) return stickyId;
  let best: number | null = null;
  for (const n of state.nodes) {
    if (!isNudgeCandidate(state, n.id)) continue;
    if (best === null || n.units > state.nodes[best]!.units) best = n.id;
  }
  return best;
}
