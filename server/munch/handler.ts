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

/* -------------------------- tick loop ------------------------------- */

const tickIntervalMs = 1000 / TICK_HZ;
const snapshotIntervalMs = 1000 / SNAPSHOT_HZ;
let lastSnapshotAt = 0;

const tickTimer = setInterval(() => {
  try {
    // Bots first so the AI's input is consumed by this tick's physics.
    bots.tick();
    game.tick();
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

    if (now - lastSnapshotAt < snapshotIntervalMs) return;
    lastSnapshotAt = now;

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
      send(ws, {
        type: "state",
        tick: 0,
        you: snap.you,
        players: snap.players,
        food: snap.food,
        leaderboard: snap.leaderboard,
      });
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
    // Cap covers humans AND bots — population can't exceed MAX_PLAYERS.
    if (game.players.size >= MAX_PLAYERS) {
      send(ws, {
        type: "error",
        reason: "Room is full — try again in a minute.",
      });
      ws.close();
      return;
    }

    let playerId: string | null = null;

    ws.on("message", (raw) => {
      try {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === "join") {
          if (playerId !== null) return; // already joined
          const name = sanitiseName(msg.name);
          const id = `p${nextPlayerId++}`;
          playerId = id;
          sockets.set(id, ws);
          // Place new humans near a random bot when bots exist.
          const spawn = msg.nobots === true ? null : bots.pickHumanSpawnPosition();
          const player = spawn
            ? game.addPlayer(id, name, spawn.x, spawn.y)
            : game.addPlayer(id, name);
          if (msg.nobots === true) bots.setNobots(id, true);
          send(ws, {
            type: "welcome",
            playerId: id,
            worldSize: WORLD_SIZE,
            color: player.color,
            name: player.name,
          });
          return;
        }
        if (!playerId) return; // ignore until joined
        if (msg.type === "input") {
          const me = game.players.get(playerId);
          if (!me) return;
          if (!me.alive) {
            if (msg.split) game.respawn(playerId);
            return;
          }
          game.setInput(playerId, msg.dir, msg.split, msg.aspect);
          return;
        }
      } catch (err) {
        console.error("munch: error handling message", err);
      }
    });

    ws.on("close", () => {
      if (playerId) {
        game.removePlayer(playerId);
        sockets.delete(playerId);
        bots.setNobots(playerId, false);
      }
    });

    ws.on("error", (err) => {
      console.error("munch: socket error", err);
      if (playerId) {
        game.removePlayer(playerId);
        sockets.delete(playerId);
        bots.setNobots(playerId, false);
      }
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

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
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
