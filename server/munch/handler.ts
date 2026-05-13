// Munch — connection handler + game tick loop.
//
// This module owns munch's game state, bot manager, sockets map, and
// tick loop at module scope. The shared shell (server/index.ts) calls
// `mountMunch(ws, req)` for each new munch connection, then this module
// handles everything per-connection.
//
// Importing the module starts the tick loop (singleton). The shell
// calls `shutdownMunch()` during graceful shutdown.

import type { WebSocket } from "ws";
import {
  AFK_TIMEOUT_MS,
  MAX_PLAYERS,
  SNAPSHOT_HZ,
  TICK_HZ,
  WORLD_SIZE,
  viewportHalfFor,
  type ClientMsg,
  type ServerMsg,
} from "../../lib/munch/protocol.js";
import { Game } from "./game.js";
import { BotManager } from "./bots.js";

/* -------------------------- module state ---------------------------- */

const game = new Game();
const bots = new BotManager(game);
const sockets = new Map<string, WebSocket>();
let nextPlayerId = 1;
const lastDeadEmitTick = new Map<string, number>();

/* -------------------------- waiting queue --------------------------- */
// Mirror of the noodle handler's queue — see comments there for the
// design. Park join requests that would push us over MAX_PLAYERS (humans
// only); the tick loop promotes the front of the queue as slots open.

type QueueEntry = {
  ws: WebSocket;
  name: string;
  nobots: boolean;
  joinedAt: number;
};

const queue: QueueEntry[] = [];
const QUEUE_BROADCAST_MS = 2000;
let lastQueueBroadcastAt = 0;

type ConnState = { playerId: string | null };
const wsState = new WeakMap<WebSocket, ConnState>();

function humanCount(): number {
  let n = 0;
  for (const p of game.players.values()) {
    if (!p.isBot) n++;
  }
  return n;
}

function broadcastQueuePositions(): void {
  for (let i = 0; i < queue.length; i++) {
    send(queue[i].ws, {
      type: "queued",
      position: i + 1,
      total: queue.length,
    });
  }
}

function removeFromQueue(ws: WebSocket): void {
  const idx = queue.findIndex((q) => q.ws === ws);
  if (idx !== -1) queue.splice(idx, 1);
}

function joinPlayer(
  ws: WebSocket,
  state: ConnState,
  name: string,
  nobots: boolean,
): void {
  const id = `p${nextPlayerId++}`;
  state.playerId = id;
  sockets.set(id, ws);
  // Place new humans near a random bot when bots exist.
  const spawn = nobots ? null : bots.pickHumanSpawnPosition();
  const player = spawn
    ? game.addPlayer(id, name, spawn.x, spawn.y)
    : game.addPlayer(id, name);
  if (nobots) bots.setNobots(id, true);
  send(ws, {
    type: "welcome",
    playerId: id,
    worldSize: WORLD_SIZE,
    color: player.color,
    name: player.name,
  });
}

function promoteFromQueue(entry: QueueEntry): void {
  const state = wsState.get(entry.ws);
  if (!state) return;
  joinPlayer(entry.ws, state, entry.name, entry.nobots);
}

/* -------------------------- telemetry ------------------------------- */
//
// Phase-A telemetry — see server/noodle/handler.ts for the rationale.

const TELEMETRY_INTERVAL_MS = 5000;
let telemetryTickCount = 0;
let telemetryTickTimeMs = 0;
let telemetrySnapshotCount = 0;
let telemetrySnapshotBytes = 0;
let lastTelemetryLogAt = Date.now();

function logTelemetryIfDue(now: number, humans: number, bots: number): void {
  if (now - lastTelemetryLogAt < TELEMETRY_INTERVAL_MS) return;
  const tickAvgMs = telemetryTickCount > 0
    ? (telemetryTickTimeMs / telemetryTickCount).toFixed(2)
    : "0";
  const snapAvgBytes = telemetrySnapshotCount > 0
    ? Math.round(telemetrySnapshotBytes / telemetrySnapshotCount)
    : 0;
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(
    `munch: humans=${humans} bots=${bots} tick=${tickAvgMs}ms snap=${snapAvgBytes}B rss=${rssMb}MB`,
  );
  telemetryTickCount = 0;
  telemetryTickTimeMs = 0;
  telemetrySnapshotCount = 0;
  telemetrySnapshotBytes = 0;
  lastTelemetryLogAt = now;
}

/* -------------------------- tick loop ------------------------------- */

const tickIntervalMs = 1000 / TICK_HZ;
const snapshotIntervalMs = 1000 / SNAPSHOT_HZ;
let lastSnapshotAt = 0;

const tickTimer = setInterval(() => {
  try {
    // Bots first so the AI's input is consumed by this tick's physics.
    const tickStart = performance.now();
    bots.tick();
    game.tick();
    telemetryTickTimeMs += performance.now() - tickStart;
    telemetryTickCount++;
    const now = Date.now();

    // AFK kick — humans only.
    for (const [id, p] of game.players.entries()) {
      if (p.isBot) continue;
      if (now - p.lastInputAt > AFK_TIMEOUT_MS) {
        const ws = sockets.get(id);
        if (ws) {
          send(ws, { type: "error", reason: "kicked for inactivity" });
          ws.close();
        }
        game.removePlayer(id);
        sockets.delete(id);
        bots.setNobots(id, false);
      }
    }

    // Send "dead" message ONCE per death.
    for (const [id, p] of game.players.entries()) {
      if (p.alive) {
        lastDeadEmitTick.delete(id);
        continue;
      }
      if (lastDeadEmitTick.has(id)) continue;
      const ws = sockets.get(id);
      if (ws) {
        send(ws, {
          type: "dead",
          finalScore: p.finalScore,
          killer: p.killedBy,
        });
      }
      lastDeadEmitTick.set(id, 1);
    }

    if (now - lastSnapshotAt < snapshotIntervalMs) {
      // Tick-only frames still tick the telemetry log.
      let humans = 0;
      let botCount = 0;
      for (const p of game.players.values()) {
        if (p.isBot) botCount++;
        else humans++;
      }
      logTelemetryIfDue(now, humans, botCount);
      return;
    }
    lastSnapshotAt = now;

    let humans = 0;
    let botCount = 0;
    for (const p of game.players.values()) {
      if (p.isBot) botCount++;
      else humans++;
    }

    // Per-player snapshot.
    for (const [id, ws] of sockets.entries()) {
      const me = game.players.get(id);
      if (!me) continue;
      const totalMass = me.cells.reduce((a, c) => a + c.mass, 0);
      const { hx, hy } = viewportHalfFor(
        Math.max(20, totalMass),
        me.aspect ?? undefined,
      );
      const snap = game.snapshotFor(id, hx, hy);
      send(
        ws,
        {
          type: "state",
          tick: 0,
          you: snap.you,
          players: snap.players,
          food: snap.food,
          leaderboard: snap.leaderboard,
          tEcho: me.lastInputT,
        },
        true,
      );
    }

    logTelemetryIfDue(now, humans, botCount);

    // Promote queued joins when human slots open.
    while (queue.length > 0 && humanCount() < MAX_PLAYERS) {
      const next = queue.shift()!;
      if (next.ws.readyState !== next.ws.OPEN) continue;
      promoteFromQueue(next);
    }
    if (queue.length > 0 && now - lastQueueBroadcastAt > QUEUE_BROADCAST_MS) {
      broadcastQueuePositions();
      lastQueueBroadcastAt = now;
    }
  } catch (err) {
    console.error("munch: error in tick", err);
  }
}, tickIntervalMs);

/* -------------------------- public API ------------------------------ */

/** Mount a new munch connection. The shared shell calls this after it
 *  routes the WS upgrade by URL path. */
export function mountMunch(ws: WebSocket): void {
  try {
    const state: ConnState = { playerId: null };
    wsState.set(ws, state);

    ws.on("message", (raw) => {
      try {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "join") {
          if (state.playerId !== null) return; // already joined
          if (queue.some((q) => q.ws === ws)) return; // already queued
          const name = sanitiseName(msg.name);
          const nobots = msg.nobots === true;
          if (humanCount() >= MAX_PLAYERS) {
            queue.push({ ws, name, nobots, joinedAt: Date.now() });
            send(ws, {
              type: "queued",
              position: queue.length,
              total: queue.length,
            });
            return;
          }
          joinPlayer(ws, state, name, nobots);
          return;
        }
        if (!state.playerId) return; // ignore until joined
        if (msg.type === "input") {
          const me = game.players.get(state.playerId);
          if (!me) return;
          if (!me.alive) {
            if (msg.split) game.respawn(state.playerId);
            return;
          }
          game.setInput(
            state.playerId,
            msg.dir,
            msg.split,
            msg.aspect,
            msg.t,
          );
          return;
        }
      } catch (err) {
        console.error("munch: error handling message", err);
      }
    });

    const cleanup = () => {
      removeFromQueue(ws);
      if (state.playerId) {
        game.removePlayer(state.playerId);
        sockets.delete(state.playerId);
        bots.setNobots(state.playerId, false);
        state.playerId = null;
      }
    };

    ws.on("close", cleanup);
    ws.on("error", (err) => {
      console.error("munch: socket error", err);
      cleanup();
    });
  } catch (err) {
    console.error("munch: error in connection handler", err);
    try {
      ws.close();
    } catch {}
  }
}

/** Health snapshot for the shared /health endpoint. */
export function getMunchHealth(): { players: number; sockets: number } {
  return { players: game.players.size, sockets: sockets.size };
}

/** Called by the shared shell during graceful shutdown. Tells each
 *  connected client politely, then stops the tick loop. */
export function shutdownMunch(): void {
  clearInterval(tickTimer);
  for (const ws of sockets.values()) {
    try {
      send(ws, {
        type: "error",
        reason: "Server is restarting — reconnect in a moment.",
      });
      ws.close(1001, "server going down");
    } catch {}
  }
}

/* -------------------------- helpers --------------------------------- */

function send(
  ws: WebSocket,
  msg: ServerMsg,
  countBytes: boolean = false,
): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    const payload = JSON.stringify(msg);
    if (countBytes) {
      telemetrySnapshotBytes += payload.length;
      telemetrySnapshotCount++;
    }
    ws.send(payload);
  } catch {
    // socket died mid-send; cleanup happens on close
  }
}

// Tiny defensive name filter. Not a moderation system — just keeps
// obvious slurs and control characters out.
const BLOCKED = [
  "n1gger",
  "nigger",
  "f4ggot",
  "faggot",
  "retard",
  "kike",
  "tranny",
];

function sanitiseName(raw: unknown): string {
  let n = String(raw ?? "")
    // Strip controls and newlines
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 16);
  if (n === "") n = `anon-${Math.floor(Math.random() * 9999)}`;
  const lower = n.toLowerCase();
  for (const bad of BLOCKED) {
    if (lower.includes(bad)) {
      n = `anon-${Math.floor(Math.random() * 9999)}`;
      break;
    }
  }
  return n;
}
