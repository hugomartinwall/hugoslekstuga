import type { GameState } from "../sim/state";
import { NEUTRAL, PLAYER } from "../sim/state";

/**
 * Per-tick gameplay events, derived by diffing the previous and current sim
 * states in the app layer. The sim itself stays pure — it never records
 * events. This feed serves AUDIO ONLY; visual effects derive their own state
 * inside the renderer.
 *
 * Multi-faction: player-involved events stay loud; AI-vs-AI war is a quiet,
 * distant bed. The struct is reused every tick — no allocations.
 */
export interface TickEvents {
  playerCaptures: number; // nodes flipped TO the player
  playerLosses: number; // nodes flipped AWAY from the player, to any faction
  aiCaptures: number; // an AI flipped a neutral or another AI's node
  playerSends: number; // new or redirected flow from a player node
  threatSends: number; // AI flow whose target is player-owned — audible warning
  distantSends: number; // AI flow targeting AI/neutral — near-silent
  arrivalsFriendly: number; // deposits into player-owned nodes
  arrivalsHostile: number; // combat arrivals involving the player
  distantArrivals: number; // AI-vs-AI / AI-vs-neutral combat — the far-war bed
  turretZaps: number; // packets destroyed by turrets this tick
  rivalsEliminated: number; // AI factions whose material hit zero this tick
}

export function createTickEvents(): TickEvents {
  return {
    playerCaptures: 0,
    playerLosses: 0,
    aiCaptures: 0,
    playerSends: 0,
    threatSends: 0,
    distantSends: 0,
    arrivalsFriendly: 0,
    arrivalsHostile: 0,
    distantArrivals: 0,
    turretZaps: 0,
    rivalsEliminated: 0,
  };
}

// Reused scratch for per-faction material tallies (no allocation per tick).
const prevMat = [0, 0, 0, 0, 0];
const currMat = [0, 0, 0, 0, 0];

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
  out.aiCaptures = 0;
  out.playerSends = 0;
  out.threatSends = 0;
  out.distantSends = 0;
  out.arrivalsFriendly = 0;
  out.arrivalsHostile = 0;
  out.distantArrivals = 0;
  out.turretZaps = 0;
  out.rivalsEliminated = 0;

  // Owner flips — O(N)
  for (let i = 0; i < curr.nodes.length; i++) {
    const was = prev.nodes[i]!.owner;
    const is = curr.nodes[i]!.owner;
    if (was === is) continue;
    if (is === PLAYER) out.playerCaptures++;
    else if (was === PLAYER) out.playerLosses++;
    else out.aiCaptures++;
  }

  // Sends — a flow is "new" if it appeared, changed target, or grew. O(F²)
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
    if (curr.nodes[f.from]!.owner === PLAYER) out.playerSends++;
    else if (curr.nodes[f.to]!.owner === PLAYER) out.threatSends++;
    else out.distantSends++;
  }

  // Arrivals — every prev packet due at or before prev.tick was consumed by
  // this tick (new packets always have arriveTick > tick). O(P)
  for (const p of prev.packets) {
    if (p.arriveTick > prev.tick) continue;
    const target = prev.nodes[p.to]!;
    if (target.owner === PLAYER || p.owner === PLAYER) {
      if (p.owner === target.owner) out.arrivalsFriendly++;
      else out.arrivalsHostile++;
    } else {
      out.distantArrivals++;
    }
  }

  // Turret zaps — packets that vanished while still mid-flight. Both arrays
  // preserve relative order, so a two-pointer sweep finds them. Identity:
  // (owner, from, departTick) is unique — a node emits ≤1 packet per tick.
  let ci = 0;
  for (const p of prev.packets) {
    if (p.arriveTick <= prev.tick) continue; // consumed by arrival, not a zap
    let found = false;
    while (ci < curr.packets.length) {
      const c = curr.packets[ci]!;
      if (c.owner === p.owner && c.from === p.from && c.departTick === p.departTick) {
        found = true;
        ci++;
        break;
      }
      // curr packet not in prev's remaining stream — freshly emitted; but
      // fresh packets are appended at the END, so anything here that doesn't
      // match means p was removed. Stop scanning for p.
      break;
    }
    if (!found) out.turretZaps++;
  }

  // Rival eliminations — per-faction material presence prev vs curr. O(N+P)
  prevMat.fill(0);
  currMat.fill(0);
  for (const n of prev.nodes) prevMat[n.owner]! += n.units + 1; // +1: owning a node counts
  for (const p of prev.packets) prevMat[p.owner]! += 1;
  for (const n of curr.nodes) currMat[n.owner]! += n.units + 1;
  for (const p of curr.packets) currMat[p.owner]! += 1;
  for (let f = 2; f <= 4; f++) {
    if (prevMat[f]! > 0 && currMat[f]! === 0) out.rivalsEliminated++;
  }
}
