import type { GameState } from "../sim/state";
import { KIND_SIPHON, KIND_VOLATILE, NEUTRAL, PLAYER } from "../sim/state";
import { SIPHON_EVERY, SIPHON_RANGE, unitCap } from "../sim/constants";

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
  playerUpgradesDone: number; // player nodes that finished growing this tick
  volatileBlasts: number; // volatile nodes that changed hands, i.e. detonated
  siphonDrains: number; // owned siphons that stole a unit this tick
  corrupterSteals: number; // in-flight packets that changed owner this tick
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
    playerUpgradesDone: 0,
    volatileBlasts: 0,
    siphonDrains: 0,
    corrupterSteals: 0,
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
  out.playerUpgradesDone = 0;
  out.volatileBlasts = 0;
  out.siphonDrains = 0;
  out.corrupterSteals = 0;

  // Owner flips, and finished construction — O(N)
  for (let i = 0; i < curr.nodes.length; i++) {
    const a = prev.nodes[i]!;
    const b = curr.nodes[i]!;
    // A node that was building and is now bigger has finished. Checking size
    // as well as `upgrading` matters: losing the node also clears `upgrading`,
    // and that is a defeat, not a payoff.
    if (a.upgrading !== 0 && b.upgrading === 0 && b.size > a.size && b.owner === PLAYER) {
      out.playerUpgradesDone++;
    }
    if (a.owner === b.owner) continue;
    if (b.owner === PLAYER) out.playerCaptures++;
    else if (a.owner === PLAYER) out.playerLosses++;
    else out.aiCaptures++;
    // A volatile detonates on every capture. This counts owner CHANGES, which
    // undercounts the rare case of a node flipping twice in one tick (A→B→A
    // reads as no change at all). Sonifying one blast per tick is what the
    // voice budget wants anyway, so the floor matters more than the ceiling.
    if (b.kind === KIND_VOLATILE) out.volatileBlasts++;
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

  // Turret zaps — packets that vanished while still mid-flight — and corrupter
  // steals, packets that survived but changed sides. Both arrays preserve
  // relative order, so one two-pointer sweep finds both.
  //
  // Identity is (from, departTick), NOT (owner, from, departTick). A node emits
  // at most one packet per tick, so the pair is already unique, and `owner`
  // stopped being stable the moment KIND_CORRUPTER shipped: a stolen packet
  // would fail the old key, read as missing, and be reported as a turret zap it
  // never was — a wrong sound on a board with no turret on it.
  let ci = 0;
  for (const p of prev.packets) {
    if (p.arriveTick <= prev.tick) continue; // consumed by arrival, not a zap
    let found = false;
    while (ci < curr.packets.length) {
      const c = curr.packets[ci]!;
      if (c.from === p.from && c.departTick === p.departTick) {
        found = true;
        if (c.owner !== p.owner) out.corrupterSteals++; // exact, unlike siphonDrains
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

  // Siphon drains. Re-derived from the board rather than inferred from a unit
  // delta, because a drained node is usually also producing and fighting on the
  // same tick, so the delta is not attributable to any one cause.
  //
  // An APPROXIMATION, deliberately. It reads `prev`, the start of the tick that
  // just ran, while siphonDrain() runs after combat — so it disagrees with the
  // sim whenever the board changed mid-tick: it over-reports a victim whose last
  // unit combat took first, and under-reports both a victim refilled by its own
  // deposit and a siphon captured this tick. Making it exact would mean
  // recording drains in GameState, which is hashed, for a sound.
  //
  // Worth the imprecision because of where it lands: one lowest-priority voice
  // (`admit(0)`), first to be dropped under load. A missed or spurious tick is
  // inaudible; a hashed field for audio would not be.
  if (prev.tick % SIPHON_EVERY === 0) {
    const range2 = SIPHON_RANGE * SIPHON_RANGE;
    for (const s of prev.nodes) {
      if (s.kind !== KIND_SIPHON || s.owner === NEUTRAL) continue;
      if (s.units >= unitCap(s.size, s.kind)) continue; // a full siphon stops
      for (const n of prev.nodes) {
        if (n.owner === s.owner || n.units <= 0) continue;
        const dx = n.x - s.x;
        const dy = n.y - s.y;
        // `<` not `<=`, matching siphonDrain's exclusive range test.
        if (dx * dx + dy * dy < range2) {
          out.siphonDrains++;
          break;
        }
      }
    }
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
