// Noodle — connection handler + game tick loop.
//
// Same shape as server/munch/handler.ts. Module-scope singletons own
// the game and tick loop; the shared shell calls mountNoodle(ws) for
// each new noodle WebSocket.

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
} from "../../lib/noodle/protocol.js";
import { Game } from "./game.js";
import { BotManager } from "./bots.js";

/* -------------------------- module state ---------------------------- */

const game = new Game();
const bots = new BotManager(game);
const sockets = new Map<string, WebSocket>();
let nextPlayerId = 1;
const lastDeadEmitTick = new Map<string, number>();

/* -------------------------- telemetry ------------------------------- */
//
// Per-Phase-A of the lag-stabilisation plan: tracks per-tick CPU time
// and per-snapshot byte size so we can see, from Fly.io logs, whether
// 3-player lag is bandwidth-bound, CPU-bound, or interpolation-bound.
// Logged once every TELEMETRY_INTERVAL_MS and reset.

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
  // One-line summary — easy to grep in Fly.io logs.
  console.log(
    `noodle: humans=${humans} bots=${bots} tick=${tickAvgMs}ms snap=${snapAvgBytes}B rss=${rssMb}MB`,
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
    // Game tick first (moves snakes, builds body grid). Bots tick after,
    // reading the fresh body grid for swerve decisions and queuing aim
    // for the NEXT game tick — one-tick lag is invisible at 30Hz.
    const tickStart = performance.now();
    game.tick();
    bots.tick();
    telemetryTickTimeMs += performance.now() - tickStart;
    telemetryTickCount++;
    const now = Date.now();

    // AFK kick — humans only.
    for (const [id, s] of game.players.entries()) {
      if (s.isBot) continue;
      if (now - s.lastInputAt > AFK_TIMEOUT_MS) {
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
    for (const [id, s] of game.players.entries()) {
      if (s.alive) {
        lastDeadEmitTick.delete(id);
        continue;
      }
      if (lastDeadEmitTick.has(id)) continue;
      const ws = sockets.get(id);
      if (ws) {
        send(ws, {
          type: "dead",
          finalLength: s.finalLength,
          killer: s.killedBy,
        });
      }
      lastDeadEmitTick.set(id, 1);
    }

    if (now - lastSnapshotAt < snapshotIntervalMs) {
      // Telemetry can still tick on non-snapshot frames so the periodic
      // log fires regardless of snapshot cadence.
      let humans = 0;
      let botCount = 0;
      for (const s of game.players.values()) {
        if (s.isBot) botCount++;
        else humans++;
      }
      logTelemetryIfDue(now, humans, botCount);
      return;
    }
    lastSnapshotAt = now;

    let humans = 0;
    let botCount = 0;
    for (const s of game.players.values()) {
      if (s.isBot) botCount++;
      else humans++;
    }

    for (const [id, ws] of sockets.entries()) {
      const me = game.players.get(id);
      if (!me) continue;
      const { hx, hy } = viewportHalfFor(
        Math.max(8, me.length),
        me.aspect ?? undefined,
      );
      const snap = game.snapshotFor(id, hx, hy);
      send(
        ws,
        {
          type: "state",
          tick: 0,
          you: snap.you,
          snakes: snap.snakes,
          food: snap.food,
          leaderboard: snap.leaderboard,
          tEcho: me.lastInputT,
        },
        true, // count bytes for telemetry
      );
    }

    logTelemetryIfDue(now, humans, botCount);
  } catch (err) {
    console.error("noodle: error in tick", err);
  }
}, tickIntervalMs);

/* -------------------------- public API ------------------------------ */

export function mountNoodle(ws: WebSocket): void {
  try {
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
          if (playerId !== null) return;
          const name = sanitiseName(msg.name);
          const id = `n${nextPlayerId++}`;
          playerId = id;
          sockets.set(id, ws);
          const player = game.addPlayer(id, name);
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
        if (!playerId) return;
        if (msg.type === "input") {
          const me = game.players.get(playerId);
          if (!me) return;
          if (!me.alive) return;
          game.setInput(playerId, msg.aim, msg.boost, msg.aspect, msg.t);
          return;
        }
        if (msg.type === "respawn") {
          const me = game.players.get(playerId);
          if (!me) return;
          if (me.alive) return;
          game.respawn(playerId);
          return;
        }
      } catch (err) {
        console.error("noodle: error handling message", err);
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
      console.error("noodle: socket error", err);
      if (playerId) {
        game.removePlayer(playerId);
        sockets.delete(playerId);
        bots.setNobots(playerId, false);
      }
    });
  } catch (err) {
    console.error("noodle: error in connection handler", err);
    try {
      ws.close();
    } catch {}
  }
}

export function getNoodleHealth(): { players: number; sockets: number } {
  return { players: game.players.size, sockets: sockets.size };
}

export function shutdownNoodle(): void {
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
