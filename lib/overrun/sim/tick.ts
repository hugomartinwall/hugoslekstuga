import type { Faction, GameState, Node } from "./state";
import { NEUTRAL, PLAYER } from "./state";
import type { Command } from "./commands";
import {
  EMIT_EVERY,
  FACTORY_PROD_INTERVAL,
  MAX_PACKETS,
  PACKET_SPEED,
  PROD_INTERVAL,
  PROD_INTERVAL_FLOOR,
  TURRET_EVERY,
  TURRET_RANGE,
  UNIT_CAP,
  UPGRADE_COST,
  UPGRADE_TICKS,
} from "./constants";
import { KIND_FACTORY, KIND_FORTRESS, KIND_TURRET } from "./state";
import { aiDecide } from "./ai";

/** Simulation rate. The renderer runs at whatever the display gives us. */
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

export function dist(a: Node, b: Node): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Production interval for a node, honoring kind and player meta boosts. */
export function prodInterval(state: GameState, n: Node): number {
  if (n.kind === KIND_FACTORY) return FACTORY_PROD_INTERVAL[n.size];
  if (n.owner === PLAYER) {
    return Math.max(PROD_INTERVAL_FLOOR, state.cfg.playerProdInterval[n.size]);
  }
  return PROD_INTERVAL[n.size];
}

/**
 * Start (or replace) the drain-stream from `from` toward `to`.
 * Shared by the player's sendUnits command and the AI — same mechanic for both.
 * Sends `fraction` of the units present NOW (player sends 100%, the AI keeps a
 * garrison); production during the drain stays home.
 */
export function startFlow(state: GameState, from: number, to: number, fraction = 1): void {
  const src = state.nodes[from];
  const dst = state.nodes[to];
  if (!src || !dst) return;
  const idx = state.flows.findIndex((f) => f.from === from);
  if (from === to) {
    // Tap/send on self = cancel the active stream.
    if (idx !== -1) state.flows.splice(idx, 1);
    return;
  }
  const remaining = Math.floor(src.units * fraction);
  if (remaining < 1) return;
  const flow = { from, to, remaining };
  if (idx !== -1) state.flows[idx] = flow; // redirect: unsent units were never removed
  else state.flows.push(flow);
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
        // Never trust input: only player-owned sources may send.
        const src = state.nodes[cmd.from];
        if (src?.owner !== PLAYER) break;
        startFlow(state, cmd.from, cmd.to);
        if (cmd.from !== cmd.to) state.firstSendDone = true;
        break;
      }
      case "upgradeNode": {
        applyUpgrade(state, cmd.nodeId, PLAYER);
        break;
      }
    }
  }
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
    const dst = state.nodes[flow.to]!;
    src.units -= 1;
    flow.remaining -= 1;
    const travel = Math.max(1, Math.ceil(dist(src, dst) / PACKET_SPEED));
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
    }
  }
  state.packets.length = write;
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
      const alpha = (state.tick - p.departTick) / (p.arriveTick - p.departTick);
      const dx = a.x + (b.x - a.x) * alpha - t.x;
      const dy = a.y + (b.y - a.y) * alpha - t.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best !== -1) state.packets.splice(best, 1); // splice keeps arrival order deterministic
  }
}

function produce(state: GameState): void {
  for (const n of state.nodes) {
    if (n.owner === NEUTRAL) continue; // neutrals are static prizes
    if (n.units >= UNIT_CAP[n.size]) continue;
    if (state.tick % prodInterval(state, n) === 0) n.units += 1;
  }
}

function alive(state: GameState, f: Faction): boolean {
  return state.nodes.some((n) => n.owner === f) || state.packets.some((p) => p.owner === f);
}

function updateStatus(state: GameState): void {
  // Won first: mutual annihilation on the same tick is a player win.
  let anyAi = false;
  for (let f = 2 as Faction; f <= 1 + state.cfg.ais.length; f++) {
    if (alive(state, f as Faction)) {
      anyAi = true;
      break;
    }
  }
  if (!anyAi) state.status = "won";
  else if (!alive(state, PLAYER)) state.status = "lost";
}

/**
 * Advance the simulation by exactly one tick.
 * Mutates `state` in place. No wall-clock time, no deltaTime, no Math.random.
 * Pipeline order is the determinism spec — do not reorder.
 */
export function tick(state: GameState, commands: readonly Command[]): void {
  if (state.status !== "playing") return; // freeze-frame under the overlay

  applyCommands(state, commands); // player first: player wins same-tick races
  aiDecide(state);
  finishUpgrades(state);
  emitPackets(state);
  resolveArrivals(state);
  turretFire(state);
  produce(state);
  updateStatus(state);

  state.tick += 1;
}
