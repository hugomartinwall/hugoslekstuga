import type { Faction, GameState, Node, NodeKind } from "./state";
import { NEUTRAL, PLAYER } from "./state";
import type { Command } from "./commands";
import {
  BEACON_FACTOR,
  BEACON_RANGE,
  EMIT_EVERY,
  FACTORY_PROD_INTERVAL,
  MAX_PACKETS,
  CORRUPT_EVERY,
  CORRUPT_RANGE,
  NURSERY_NEUTRAL_INTERVAL,
  OVERCHARGE_DIV,
  OVERCHARGE_TICKS,
  PACKET_SPEED,
  PROD_INTERVAL,
  PROD_INTERVAL_FLOOR,
  RELAY_PACKET_SPEED,
  RIFT_TRAVEL_TICKS,
  SIPHON_EVERY,
  SIPHON_RANGE,
  STASIS_TICKS,
  TURRET_EVERY,
  TURRET_RANGE,
  UPGRADE_COST,
  UPGRADE_TICKS,
  VAULT_PROD_INTERVAL,
  VOLATILE_DAMAGE,
  VOLATILE_RADIUS,
  unitCap,
} from "./constants";
import {
  KIND_BEACON,
  KIND_FACTORY,
  KIND_FORTRESS,
  KIND_CORRUPTER,
  KIND_NURSERY,
  KIND_RELAY,
  KIND_RIFT,
  KIND_SIPHON,
  KIND_TURRET,
  KIND_VAULT,
  KIND_VOLATILE,
} from "./state";
import { aiDecide } from "./ai";

/** Simulation rate. The renderer runs at whatever the display gives us. */
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

export function dist(a: Node, b: Node): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* ------------------------------------------------------- ability effects */

/** Is `id` in `list` with time left? Linear scan — the lists hold 0–3 entries. */
function effectActive(
  list: { node: number; until: number }[] | undefined,
  id: number,
  tick: number,
): boolean {
  if (!list) return false;
  for (const e of list) if (e.node === id && e.until > tick) return true;
  return false;
}

/** Exported for the renderer's freeze/surge marks — one truth, two consumers. */
export function isStasised(state: GameState, nodeId: number): boolean {
  return effectActive(state.effects?.stasis, nodeId, state.tick);
}

export function isOvercharged(state: GameState, nodeId: number): boolean {
  return effectActive(state.effects?.overcharge, nodeId, state.tick);
}

/**
 * Drop expired effects. Runs right after applyCommands: a fresh effect's
 * `until` is always in the future so it can never be pruned on its birth
 * tick, and pruning before the AI wakes means aiDecide never reads a corpse.
 * Deterministic — pure function of (effects, tick).
 */
function pruneEffects(state: GameState): void {
  const fx = state.effects;
  if (!fx) return;
  if (fx.overcharge.length > 0)
    fx.overcharge = fx.overcharge.filter((e) => e.until > state.tick);
  if (fx.stasis.length > 0) fx.stasis = fx.stasis.filter((e) => e.until > state.tick);
}

/** Is any node owned by `owner` and of kind `kind` within `range` of `n`? */
function hasAllyOfKindInRange(
  state: GameState,
  n: Node,
  kind: NodeKind,
  owner: Faction,
  range: number,
): boolean {
  const r2 = range * range;
  for (const m of state.nodes) {
    if (m.kind !== kind || m.owner !== owner) continue;
    const dx = m.x - n.x;
    const dy = m.y - n.y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}

/**
 * Production interval for a node, honoring kind, beacons and player meta boosts.
 *
 * The single dispatch point for production speed: ai.ts and renderer.ts both
 * call it, so they inherit every kind's economy for free. Order matters —
 * kind base rate, then the player's meta boost, then any beacon, then the
 * floor. A node's OWN kind wins over the player boost (that was already true
 * of factories) but a beacon stacks on whatever the result was.
 *
 * O(nodes) unconditionally — the beacon scan runs whether or not one exists,
 * so produce() is O(n²). Measured at 7 ns/call and ~350 calls on the worst
 * tick (a 13-node all-tier-7 stalemate), i.e. 4 µs against a 33,333 µs budget.
 */
export function prodInterval(state: GameState, n: Node): number {
  let base: number;
  if (n.kind === KIND_VAULT) base = VAULT_PROD_INTERVAL[n.size];
  else if (n.kind === KIND_FACTORY) base = FACTORY_PROD_INTERVAL[n.size];
  else if (n.owner === PLAYER) base = state.cfg.playerProdInterval[n.size];
  else base = PROD_INTERVAL[n.size];

  // Beacons only lift their own faction, and never a neutral's growth.
  if (n.owner !== NEUTRAL && hasAllyOfKindInRange(state, n, KIND_BEACON, n.owner, BEACON_RANGE)) {
    base = Math.round(base * BEACON_FACTOR);
  }
  const floored = Math.max(PROD_INTERVAL_FLOOR, base);
  // Overcharge divides AFTER the floor (see constants.ts for why), with its
  // own floor of 1. Living here — the single dispatch point — means the AI's
  // cost model and the renderer's fill ring both see the surge for free.
  return isOvercharged(state, n.id) ? Math.max(1, Math.round(floored / OVERCHARGE_DIV)) : floored;
}

/** World units per tick for a packet launched from `src`. */
export function packetSpeed(state: GameState, src: Node): number {
  const base = src.kind === KIND_RELAY ? RELAY_PACKET_SPEED : PACKET_SPEED;
  return base * (state.cfg.packetSpeedMul ?? 1);
}

/**
 * Ticks for one packet to fly src → dst.
 *
 * The single source of truth for travel time, because three places need the
 * same answer and one of them is the AI: emitPackets stamps `arriveTick` with
 * it, `waveTicks` in ai.ts prices attacks with it, and the balance bot prices
 * its own. A rift pair that only the emitter knew about would make the AI
 * mis-time every send launched through one. Reads the level's speed
 * multiplier (bigger boards fly faster packets), which is why it takes state.
 */
export function travelTicks(state: GameState, src: Node, dst: Node): number {
  const normal = Math.max(1, Math.ceil(dist(src, dst) / packetSpeed(state, src)));
  const linked =
    src.kind === KIND_RIFT && dst.kind === KIND_RIFT && src.owner !== NEUTRAL && src.owner === dst.owner;
  return linked ? Math.min(normal, RIFT_TRAVEL_TICKS) : normal;
}

/**
 * Start (or replace) the drain-stream from `from` toward `to`.
 * Shared by the player's sendUnits command and the AI — same mechanic for both.
 * Sends `fraction` of the units present NOW (player sends 100%, the AI keeps a
 * garrison); production during the drain stays home.
 *
 * Returns true when a flow was created or redirected — the definition of an
 * "effective send" that gauntlet budgets charge for. Cancels and sends that
 * round down to nothing return false. AI callers ignore the return value.
 */
export function startFlow(state: GameState, from: number, to: number, fraction = 1): boolean {
  const src = state.nodes[from];
  const dst = state.nodes[to];
  if (!src || !dst) return false;
  const idx = state.flows.findIndex((f) => f.from === from);
  if (from === to) {
    // Tap/send on self = cancel the active stream.
    if (idx !== -1) state.flows.splice(idx, 1);
    return false;
  }
  const remaining = Math.floor(src.units * fraction);
  if (remaining < 1) return false;
  const flow = { from, to, remaining };
  if (idx !== -1) state.flows[idx] = flow; // redirect: unsent units were never removed
  else state.flows.push(flow);
  return true;
}

/**
 * Begin a node size upgrade, draining the cost up front.
 * Shared by the player's upgradeNode command and the AI.
 */
export function applyUpgrade(state: GameState, nodeId: number, owner: Faction): boolean {
  const n = state.nodes[nodeId];
  if (!n || n.owner !== owner || owner === NEUTRAL) return false;
  if (n.size >= 2 || n.upgrading !== 0) return false;
  // Meta-progression boosts apply to the player only; AIs pay base rates.
  const cost =
    owner === PLAYER ? state.cfg.playerUpgradeCost[n.size as 0 | 1] : UPGRADE_COST[n.size as 0 | 1];
  if (n.units < cost) return false;
  n.units -= cost;
  n.upgrading = state.tick + (owner === PLAYER ? state.cfg.playerUpgradeTicks : UPGRADE_TICKS);
  return true;
}

function applyCommands(state: GameState, commands: readonly Command[]): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case "selectNode": {
        for (const n of state.nodes) n.selected = n.id === cmd.nodeId;
        break;
      }
      case "deselect": {
        for (const n of state.nodes) n.selected = false;
        break;
      }
      case "sendUnits": {
        // Never trust input: only player-owned sources may send, and the
        // fraction is clamped into [0, 1] (startFlow's floor turns 0 into a
        // no-op) rather than trusted to be sane.
        const src = state.nodes[cmd.from];
        if (src?.owner !== PLAYER) break;
        const f = Math.min(1, Math.max(0, cmd.fraction ?? 1));
        const started = startFlow(state, cmd.from, cmd.to, f);
        if (cmd.from !== cmd.to) {
          // Gauntlet budgets charge for effective sends only — a send from an
          // empty node costs nothing, a redirect costs one (or an emptied
          // source could re-aim its stream forever for free). Command-path
          // only, like the flags below: the AI never spends the budget.
          if (started) state.sendsUsed += 1;
          state.firstSendDone = true;
          // The coach's ratio-step signal. Command-path only, deliberately:
          // the AI calls startFlow directly and must never satisfy a lesson.
          if (f < 1) state.halfSendDone = true;
        }
        break;
      }
      case "upgradeNode": {
        applyUpgrade(state, cmd.nodeId, PLAYER);
        break;
      }
      case "useAbility": {
        useAbility(state, cmd.ability, cmd.nodeId);
        break;
      }
    }
  }
}

/**
 * Fire a player ability. All validation lives here — never trust input — and
 * a charge is consumed on success only. Zero RNG on every path.
 */
function useAbility(
  state: GameState,
  ability: "overcharge" | "stasis" | "recall",
  nodeId?: number,
): void {
  const charges = state.abilityCharges;
  if (!charges || charges[ability] <= 0) return;

  if (ability === "overcharge" || ability === "stasis") {
    const n = nodeId !== undefined ? state.nodes[nodeId] : undefined;
    if (!n) return;
    // Target legality: overcharge boosts an OWN ball; stasis freezes any
    // ball that is NOT yours (rival or neutral — a growing nursery counts).
    if (ability === "overcharge" ? n.owner !== PLAYER : n.owner === PLAYER) return;
    const fx = (state.effects ??= { overcharge: [], stasis: [] });
    const list = ability === "overcharge" ? fx.overcharge : fx.stasis;
    const until = state.tick + (ability === "overcharge" ? OVERCHARGE_TICKS : STASIS_TICKS);
    // Re-casting on the same node refreshes rather than stacking — two
    // entries for one node would double-hash a single visible effect.
    const existing = list.find((e) => e.node === n.id);
    if (existing) existing.until = until;
    else list.push({ node: n.id, until });
    charges[ability] -= 1;
    return;
  }

  /*
   * RECALL: one pass over every in-flight PLAYER packet, retargeting each to
   * the player's nearest own ball. Packet positions are DERIVED, so the
   * packet is rebuilt around a virtual origin: current interpolated x/y goes
   * into fx/fy, departTick becomes now, and arriveTick is recomputed from
   * that point to the new destination at base packet speed (the floating
   * origin has no launching node, so relay/rift privileges do not apply).
   * Consumes a charge only if at least one packet actually turned around.
   */
  const own: Node[] = [];
  for (const n of state.nodes) if (n.owner === PLAYER) own.push(n);
  if (own.length === 0) return; // nowhere to recall to: charge kept
  const nearestTo = (x: number, y: number): Node => {
    let best = own[0]!;
    let bestD2 = Infinity;
    for (const n of own) {
      const dx = n.x - x;
      const dy = n.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        // Strict <, iterated in ascending id order: ties go to the lowest id.
        bestD2 = d2;
        best = n;
      }
    }
    return best;
  };
  const speed = PACKET_SPEED * (state.cfg.packetSpeedMul ?? 1);
  let any = false;
  for (const p of state.packets) {
    if (p.owner !== PLAYER || p.arriveTick <= state.tick) continue; // landing this tick: too late
    const a = state.nodes[p.from]!;
    const b = state.nodes[p.to]!;
    const ax = p.fx ?? a.x;
    const ay = p.fy ?? a.y;
    const alpha = (state.tick - p.departTick) / (p.arriveTick - p.departTick);
    const x = ax + (b.x - ax) * alpha;
    const y = ay + (b.y - ay) * alpha;
    const dest = nearestTo(x, y);
    const travel = Math.max(1, Math.ceil(Math.hypot(dest.x - x, dest.y - y) / speed));
    p.to = dest.id;
    p.departTick = state.tick;
    p.arriveTick = state.tick + travel;
    p.fx = x;
    p.fy = y;
    any = true;
  }
  if (any) charges.recall -= 1;
}

function finishUpgrades(state: GameState): void {
  for (const n of state.nodes) {
    if (n.upgrading !== 0 && state.tick >= n.upgrading) {
      if (n.size < 2) n.size = (n.size + 1) as Node["size"];
      n.upgrading = 0;
    }
  }
}

function emitPackets(state: GameState): void {
  for (let i = state.flows.length - 1; i >= 0; i--) {
    const flow = state.flows[i]!;
    const src = state.nodes[flow.from]!;
    // A captured source stops shooting for its old owner immediately.
    if (flow.remaining <= 0 || src.owner === NEUTRAL) {
      state.flows.splice(i, 1);
      continue;
    }
    if (state.tick % EMIT_EVERY !== 0) continue;
    if (state.packets.length >= MAX_PACKETS) continue; // safety valve, resumes when clear
    if (src.units < 1) continue; // stalled: wait for production to refill
    // Stasis: the source emits nothing while frozen. The flow itself survives
    // (skipped, not spliced), so the stream resumes when the freeze lifts.
    if (isStasised(state, flow.from)) continue;
    const dst = state.nodes[flow.to]!;
    src.units -= 1;
    flow.remaining -= 1;
    const travel = travelTicks(state, src, dst);
    state.packets.push({
      owner: src.owner,
      from: flow.from,
      to: flow.to,
      departTick: state.tick,
      arriveTick: state.tick + travel,
    });
    if (flow.remaining <= 0) state.flows.splice(i, 1);
  }
}

function resolveArrivals(state: GameState): void {
  let write = 0;
  for (let read = 0; read < state.packets.length; read++) {
    const p = state.packets[read]!;
    if (p.arriveTick > state.tick) {
      state.packets[write++] = p;
      continue;
    }
    const node = state.nodes[p.to]!;
    if (p.owner === node.owner) {
      node.units += 1; // deposits may exceed the cap; the cap only limits growth
    } else if (node.units > 0) {
      // Fortress armor: every second hostile packet is absorbed.
      if (node.kind === KIND_FORTRESS && node.guard === 0) {
        node.guard = 1;
      } else {
        node.units -= 1;
        node.guard = 0;
      }
    } else {
      node.owner = p.owner;
      node.units = 1;
      node.selected = false;
      node.guard = 0;
      node.upgrading = 0; // construction is lost with the node
      // The flipped node's outgoing stream (if any) dies with its old owner.
      const fi = state.flows.findIndex((f) => f.from === node.id);
      if (fi !== -1) state.flows.splice(fi, 1);
      if (node.kind === KIND_VOLATILE) detonate(state, node);
    }
  }
  state.packets.length = write;
}

/**
 * Volatile blast: damage every OTHER node in radius, whoever owns it.
 *
 * Re-arms, because kinds survive capture — a contested volatile keeps punishing
 * whoever trades it, which is the whole point of the kind. Touches only
 * `units`, never `state.packets`, so it is safe to call from inside
 * resolveArrivals' compaction loop. Subtraction commutes, so node order is
 * irrelevant to the result; it is still iterated in id order for hygiene.
 */
function detonate(state: GameState, source: Node): void {
  const r2 = VOLATILE_RADIUS * VOLATILE_RADIUS;
  for (const n of state.nodes) {
    if (n.id === source.id) continue;
    const dx = n.x - source.x;
    const dy = n.y - source.y;
    if (dx * dx + dy * dy > r2) continue;
    n.units = Math.max(0, n.units - VOLATILE_DAMAGE);
  }
}

/**
 * Owned siphons steal a unit from the nearest hostile node in range.
 *
 * Runs after combat and before production, for the same reason turretFire
 * does: a unit produced this tick should not be drained the instant it exists.
 * Deterministic — nearest wins, ties broken by node id via strict `<`.
 *
 * **A full siphon stops stealing**, exactly as a full node stops producing.
 * Without that guard this is not a transfer, it is creation: the victim tops
 * back up from its own production while the siphon accumulates forever, and a
 * frontier siphon measured 834 units after 20 minutes against a cap of 50. A
 * node with 834 defenders is untakeable by any AI (`effDef` feeds `killCost`)
 * and prints a three-digit label in a circle sized for two. Deposits are the
 * one sanctioned way past the cap and they are bounded by what the sender had;
 * this had no bound at all.
 */
function siphonDrain(state: GameState): void {
  if (state.tick % SIPHON_EVERY !== 0) return;
  const range2 = SIPHON_RANGE * SIPHON_RANGE;
  for (const s of state.nodes) {
    if (s.kind !== KIND_SIPHON || s.owner === NEUTRAL) continue; // dormant until owned
    if (s.units >= unitCap(s.size, s.kind)) continue; // full: nowhere to put it
    let victim: Node | null = null;
    let bestD2 = range2;
    for (const n of state.nodes) {
      if (n.owner === s.owner || n.units <= 0) continue; // neutrals are fair game
      const dx = n.x - s.x;
      const dy = n.y - s.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        victim = n;
      }
    }
    if (victim) {
      victim.units -= 1;
      s.units += 1;
    }
  }
}

/** Owned turrets zap the nearest hostile in-flight packet on a fixed cadence. */
function turretFire(state: GameState): void {
  if (state.tick % TURRET_EVERY !== 0) return;
  const range2 = TURRET_RANGE * TURRET_RANGE;
  for (const t of state.nodes) {
    if (t.kind !== KIND_TURRET || t.owner === NEUTRAL) continue; // dormant until owned
    let best = -1;
    let bestD2 = range2;
    for (let i = 0; i < state.packets.length; i++) {
      const p = state.packets[i]!;
      if (p.owner === t.owner || p.arriveTick <= state.tick) continue;
      const a = state.nodes[p.from]!;
      const b = state.nodes[p.to]!;
      // Recalled packets fly from a floating origin, not their source node.
      const ax = p.fx ?? a.x;
      const ay = p.fy ?? a.y;
      const alpha = (state.tick - p.departTick) / (p.arriveTick - p.departTick);
      const dx = ax + (b.x - ax) * alpha - t.x;
      const dy = ay + (b.y - ay) * alpha - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best !== -1) state.packets.splice(best, 1); // splice keeps arrival order deterministic
  }
}

/**
 * Owned corrupters take the nearest hostile in-flight packet instead of
 * destroying it. The turret's mirror, down to the scan.
 *
 * The packet keeps flying the same line to the same node — only `owner`
 * changes — so a stolen unit ARRIVES, and arrives on the wrong side: a wave
 * aimed at a rival node now reinforces it. That double swing is why the cadence
 * is slower than a turret's, and it is also what makes the mechanic readable
 * without a tutorial, because the stream visibly changes colour mid-flight.
 *
 * Runs immediately after turretFire, on the same reasoning that puts turretFire
 * before produce: this tick's arrivals have already resolved, so a packet
 * cannot be both delivered and stolen. A turret that fired first has already
 * removed its victim from the array, so the two never contest a packet.
 */
function corrupterSteal(state: GameState): void {
  if (state.tick % CORRUPT_EVERY !== 0) return;
  const range2 = CORRUPT_RANGE * CORRUPT_RANGE;
  for (const c of state.nodes) {
    if (c.kind !== KIND_CORRUPTER || c.owner === NEUTRAL) continue; // dormant until owned
    let best = -1;
    let bestD2 = range2;
    for (let i = 0; i < state.packets.length; i++) {
      const p = state.packets[i]!;
      if (p.owner === c.owner || p.arriveTick <= state.tick) continue;
      const a = state.nodes[p.from]!;
      const b = state.nodes[p.to]!;
      // Same floating-origin rule as turretFire.
      const ax = p.fx ?? a.x;
      const ay = p.fy ?? a.y;
      const alpha = (state.tick - p.departTick) / (p.arriveTick - p.departTick);
      const dx = ax + (b.x - ax) * alpha - c.x;
      const dy = ay + (b.y - ay) * alpha - c.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best !== -1) state.packets[best]!.owner = c.owner;
  }
}

function produce(state: GameState): void {
  for (const n of state.nodes) {
    // Stasis: a frozen ball produces nothing, whoever owns it (a neutral
    // nursery's growth counts as production and freezes with it).
    if (isStasised(state, n.id)) continue;
    // Neutrals are static prizes — except a nursery, which keeps growing, so
    // leaving one alone is a decision with a cost.
    const interval =
      n.owner === NEUTRAL
        ? n.kind === KIND_NURSERY
          ? NURSERY_NEUTRAL_INTERVAL
          : 0
        : prodInterval(state, n);
    if (interval === 0) continue;
    if (n.units >= unitCap(n.size, n.kind)) continue;
    if (state.tick % interval === 0) n.units += 1;
  }
}

function alive(state: GameState, f: Faction): boolean {
  return state.nodes.some((n) => n.owner === f) || state.packets.some((p) => p.owner === f);
}

/**
 * Advance objective progress counters. Runs after combat has resolved and
 * before updateStatus reads them, so "held on the tick the ring fills" wins
 * on that tick, not the next.
 *
 * Only `hold` has per-tick progress. `sendsUsed` advances in applyCommands
 * (it is a command-log fact, not a board fact), and the rest are pure
 * predicates over the state.
 */
function advanceObjective(state: GameState): void {
  const obj = state.cfg.objective;
  if (obj?.type !== "hold" || obj.targetNodeId === undefined) return;
  const hill = state.nodes[obj.targetNodeId];
  if (!hill) return;
  // Fills while held, drains while lost, floors at zero — the ring swings
  // rather than resetting, so losing the hill is a setback, not a wipe.
  if (hill.owner === PLAYER) state.holdTicks += 1;
  else if (state.holdTicks > 0) state.holdTicks -= 1;
}

/** Every rival faction eliminated (nodes and packets both) — the classic win. */
function allRivalsDead(state: GameState): boolean {
  for (let f = 2; f <= 1 + state.cfg.ais.length; f++) {
    if (alive(state, f as Faction)) return false;
  }
  return true;
}

function playerNodeCount(state: GameState): number {
  let count = 0;
  for (const n of state.nodes) if (n.owner === PLAYER) count++;
  return count;
}

/**
 * Win/lose dispatch. Won checks run first on every path: mutual annihilation
 * on the same tick is a player win, and the same courtesy extends to every
 * objective (capture the crown on the tick your own falls → win).
 *
 * Objectives ADD win paths to the classic rules rather than replacing them —
 * wiping the board is always a win, losing everything is always a loss — with
 * one exception: a gauntlet replaces the rules wholesale, because its authored
 * boards may contain no live rival (the classic check would declare an instant
 * win) and its loss is running out of sends, not out of nodes.
 */
function updateStatus(state: GameState): void {
  const obj = state.cfg.objective;

  if (obj?.type === "gauntlet") {
    const target = obj.targetNodeId !== undefined ? state.nodes[obj.targetNodeId] : undefined;
    const goalMet = target
      ? target.owner === PLAYER
      : state.nodes.every((n) => n.owner === PLAYER);
    if (goalMet) {
      state.status = "won";
      return;
    }
    if (!alive(state, PLAYER)) {
      state.status = "lost";
      return;
    }
    // Out of sends, nothing left in the air, goal unmet: unwinnable, so call
    // it. The app layer treats a gauntlet loss as a free instant retry.
    const budget = obj.sendBudget ?? Infinity;
    if (state.sendsUsed >= budget) {
      const playerBusy =
        state.flows.some((f) => state.nodes[f.from]!.owner === PLAYER) ||
        state.packets.some((p) => p.owner === PLAYER);
      if (!playerBusy) state.status = "lost";
    }
    return;
  }

  // Objective win paths, checked before everything else.
  if (obj) {
    switch (obj.type) {
      case "crown": {
        const crown = obj.targetNodeId !== undefined ? state.nodes[obj.targetNodeId] : undefined;
        if (crown && crown.owner === PLAYER) {
          state.status = "won";
          return;
        }
        break;
      }
      case "hold": {
        if (state.holdTicks >= (obj.requiredTicks ?? Infinity)) {
          state.status = "won";
          return;
        }
        break;
      }
      case "outlast": {
        if (state.tick >= (obj.requiredTicks ?? Infinity)) {
          state.status = "won";
          return;
        }
        break;
      }
      case "claim": {
        if (playerNodeCount(state) >= (obj.quota ?? Infinity)) {
          state.status = "won";
          return;
        }
        break;
      }
    }
  }

  if (allRivalsDead(state)) {
    state.status = "won";
    return;
  }

  // Objective loss paths, after every win path has had its chance.
  if (obj?.type === "crown" && obj.playerCrownId !== undefined) {
    const home = state.nodes[obj.playerCrownId];
    if (home && home.owner !== PLAYER) {
      state.status = "lost";
      return;
    }
  }

  if (!alive(state, PLAYER)) state.status = "lost";
}

/**
 * Advance the simulation by exactly one tick.
 * Mutates `state` in place. No wall-clock time, no deltaTime, no Math.random.
 * Pipeline order is the determinism spec — do not reorder.
 */
export function tick(state: GameState, commands: readonly Command[]): void {
  if (state.status !== "playing") return; // freeze-frame under the overlay

  applyCommands(state, commands); // player first: player wins same-tick races
  pruneEffects(state); // after commands (a birth-tick effect cannot expire), before the AI reads
  aiDecide(state);
  finishUpgrades(state);
  emitPackets(state);
  resolveArrivals(state);
  turretFire(state);
  corrupterSteal(state);
  siphonDrain(state);
  produce(state);
  advanceObjective(state);
  updateStatus(state);

  state.tick += 1;
}
