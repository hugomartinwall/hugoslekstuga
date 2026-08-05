import type { GameState } from "../sim/state";

/**
 * Per-tick gameplay events, derived by diffing the previous and current sim
 * states in the app layer. The sim itself stays pure — it never records
 * events. This feed serves AUDIO ONLY; visual effects derive their own state
 * inside the renderer.
 *
 * The struct is reused every tick (counters zeroed on entry) — no allocations.
 */
export interface TickEvents {
  playerCaptures: number; // nodes flipped TO player
  playerLosses: number; // nodes flipped AWAY FROM player
  enemyCaptures: number; // enemy took a neutral (quiet awareness tick)
  playerSends: number; // new or redirected flow from a player node
  enemySends: number;
  arrivalsFriendly: number; // deposits resolved this tick
  arrivalsHostile: number; // hits on a defended node this tick
}

export function createTickEvents(): TickEvents {
  return {
    playerCaptures: 0,
    playerLosses: 0,
    enemyCaptures: 0,
    playerSends: 0,
    enemySends: 0,
    arrivalsFriendly: 0,
    arrivalsHostile: 0,
  };
}

/**
 * Diff two consecutive sim states into `out`.
 * Assumes `curr` is exactly one tick after `prev` on the same level (node
 * arrays index-stable). Callers must skip the diff across level swaps.
 *
 * Arrival classification uses the PRE-tick target owner, so the handful of
 * packets that resolve on the same tick a node flips can be misclassified —
 * acceptable, since the flip triggers its own (louder) capture/loss sound.
 */
export function diffTick(prev: GameState, curr: GameState, out: TickEvents): void {
  out.playerCaptures = 0;
  out.playerLosses = 0;
  out.enemyCaptures = 0;
  out.playerSends = 0;
  out.enemySends = 0;
  out.arrivalsFriendly = 0;
  out.arrivalsHostile = 0;

  // Owner flips — O(N)
  for (let i = 0; i < curr.nodes.length; i++) {
    const was = prev.nodes[i]!.owner;
    const is = curr.nodes[i]!.owner;
    if (was === is) continue;
    if (is === "player") out.playerCaptures++;
    else if (was === "player") out.playerLosses++;
    else out.enemyCaptures++;
  }

  // Sends — a flow is "new" if it appeared, changed target, or grew (re-send
  // replaces the flow with a fresh budget). O(F²) with F ≤ node count.
  for (const f of curr.flows) {
    let prevFlow = null;
    for (const pf of prev.flows) {
      if (pf.from === f.from) {
        prevFlow = pf;
        break;
      }
    }
    const isSend = !prevFlow || prevFlow.to !== f.to || f.remaining > prevFlow.remaining;
    if (!isSend) continue;
    if (curr.nodes[f.from]!.owner === "player") out.playerSends++;
    else out.enemySends++;
  }

  // Arrivals — every prev packet due at or before prev.tick was consumed by
  // this tick (new packets always have arriveTick > tick). O(P)
  for (const p of prev.packets) {
    if (p.arriveTick > prev.tick) continue;
    const target = prev.nodes[p.to]!;
    if (p.owner === target.owner) out.arrivalsFriendly++;
    else out.arrivalsHostile++;
  }
}
