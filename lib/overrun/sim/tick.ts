import type { GameState, Node, Owner } from "./state";
import type { Command } from "./commands";
import { EMIT_EVERY, MAX_PACKETS, PACKET_SPEED, PROD_INTERVAL, UNIT_CAP } from "./constants";
import { aiDecide } from "./ai";

/** Simulation rate. The renderer runs at whatever the display gives us. */
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;

export function dist(a: Node, b: Node): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
        if (src?.owner !== "player") break;
        startFlow(state, cmd.from, cmd.to);
        if (cmd.from !== cmd.to) state.firstSendDone = true;
        break;
      }
    }
  }
}

function emitPackets(state: GameState): void {
  for (let i = state.flows.length - 1; i >= 0; i--) {
    const flow = state.flows[i]!;
    const src = state.nodes[flow.from]!;
    // A captured source stops shooting for its old owner immediately.
    if (flow.remaining <= 0 || src.owner === "neutral") {
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
      node.units -= 1;
    } else {
      node.owner = p.owner;
      node.units = 1;
      node.selected = false;
      // The flipped node's outgoing stream (if any) dies with its old owner.
      const fi = state.flows.findIndex((f) => f.from === node.id);
      if (fi !== -1) state.flows.splice(fi, 1);
    }
  }
  state.packets.length = write;
}

function produce(state: GameState): void {
  for (const n of state.nodes) {
    if (n.owner === "neutral") continue; // neutrals are static prizes
    if (n.units >= UNIT_CAP[n.size]) continue;
    if (state.tick % PROD_INTERVAL[n.size] === 0) n.units += 1;
  }
}

function updateStatus(state: GameState): void {
  const alive = (o: Owner): boolean =>
    state.nodes.some((n) => n.owner === o) || state.packets.some((p) => p.owner === o);
  // Enemy checked first: mutual elimination on the same tick is a player win.
  if (!alive("enemy")) state.status = "won";
  else if (!alive("player")) state.status = "lost";
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
  emitPackets(state);
  resolveArrivals(state);
  produce(state);
  updateStatus(state);

  state.tick += 1;
}
