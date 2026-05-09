// Munch — WebSocket entrypoint.
//
// Runs a single shared game world. Clients connect, send `join` once,
// then push `input` packets ~30Hz; the server pushes `state` snapshots
// at SNAPSHOT_HZ. Server-authoritative — clients can't claim mass or
// position.
//
// Run locally with:    npm run munch
// In production:       Fly.io single-instance, auto-stop when no players.
//                      See Dockerfile + fly.toml at the repo root.

import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
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

const PORT = Number(process.env.MUNCH_PORT ?? 8080);

/* -------------------------------------------------------------------------
 * HTTP server — exposes /health for Fly.io's health-check probe AND hosts
 * the WebSocket upgrade. Without an HTTP layer Fly can't distinguish "server
 * up" from "server down", and auto-stop / auto-start break.
 * -----------------------------------------------------------------------*/

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(
      JSON.stringify({
        ok: true,
        players: game.players.size,
        sockets: sockets.size,
        uptime: Math.round(process.uptime()),
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

const game = new Game();
const sockets = new Map<string, WebSocket>();
let nextPlayerId = 1;

const wss = new WebSocketServer({ server: httpServer });

httpServer.listen(PORT, () => {
  console.log(`munch server listening on :${PORT}`);
});

/* -------------------------------------------------------------------------
 * Per-IP rate limit on connection attempts. Stops one bad client from
 * spamming connections faster than we can disconnect them. Generous limit;
 * a real player legitimately reconnecting on a flaky network won't trip it.
 * -----------------------------------------------------------------------*/

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CONNECTIONS = 30;
const ipBuckets = new Map<string, number[]>();

function clientIpFrom(req: IncomingMessage): string {
  // Fly.io and most proxies set Fly-Client-IP / X-Forwarded-For. Fall back
  // to the raw socket address if no proxy headers are present (local dev).
  const fly = req.headers["fly-client-ip"];
  if (typeof fly === "string") return fly;
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") return xff.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip) ?? [];
  const recent = bucket.filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  ipBuckets.set(ip, recent);
  return recent.length > RATE_MAX_CONNECTIONS;
}

// Periodically prune empty buckets so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of ipBuckets.entries()) {
    const recent = bucket.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length === 0) ipBuckets.delete(ip);
    else ipBuckets.set(ip, recent);
  }
}, RATE_WINDOW_MS).unref();

/* -------------------------------------------------------------------------
 * Connection handler. Each WebSocket gets its own message handlers, all
 * defensively wrapped — a thrown exception on one socket must never take
 * the whole game world down.
 * -----------------------------------------------------------------------*/

wss.on("connection", (ws, req) => {
  try {
    const ip = clientIpFrom(req);
    if (isRateLimited(ip)) {
      send(ws, { type: "error", reason: "Too many connections — slow down." });
      ws.close(1008, "rate limited");
      return;
    }

    if (sockets.size >= MAX_PLAYERS) {
      send(ws, {
        type: "error",
        reason: "Server is full — try again in a minute.",
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
          const player = game.addPlayer(id, name);
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
          // Either accept the dir as-is OR if the player is dead, treat
          // any input as a respawn intent.
          const me = game.players.get(playerId);
          if (!me) return;
          if (!me.alive) {
            // Hitting space (split) on the dead screen → respawn.
            if (msg.split) game.respawn(playerId);
            return;
          }
          game.setInput(playerId, msg.dir, msg.split);
          return;
        }
        // pong handled implicitly via lastInputAt updates above; nothing to do.
      } catch (err) {
        console.error("munch: error handling message", err);
      }
    });

    ws.on("close", () => {
      if (playerId) {
        game.removePlayer(playerId);
        sockets.delete(playerId);
      }
    });

    ws.on("error", (err) => {
      console.error("munch: socket error", err);
      if (playerId) {
        game.removePlayer(playerId);
        sockets.delete(playerId);
      }
    });
  } catch (err) {
    console.error("munch: error in connection handler", err);
    try {
      ws.close();
    } catch {}
  }
});

wss.on("error", (err) => {
  console.error("munch: wss error", err);
});

/* ---- Game loop ---- */

const tickIntervalMs = 1000 / TICK_HZ;
const snapshotIntervalMs = 1000 / SNAPSHOT_HZ;
let lastSnapshotAt = 0;
const lastDeadEmitTick = new Map<string, number>(); // remember which players we've already told about death

const tickTimer = setInterval(() => {
  try {
    game.tick();
    const now = Date.now();

    // AFK kick
    for (const [id, p] of game.players.entries()) {
      if (now - p.lastInputAt > AFK_TIMEOUT_MS) {
        const ws = sockets.get(id);
        if (ws) {
          send(ws, { type: "error", reason: "kicked for inactivity" });
          ws.close();
        }
        game.removePlayer(id);
        sockets.delete(id);
      }
    }

    // Send "dead" message ONCE per death so the client shows the score screen.
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
      const { hx, hy } = viewportHalfFor(Math.max(20, totalMass));
      const snap = game.snapshotFor(id, hx, hy);
      send(ws, {
        type: "state",
        tick: 0, // not used yet client-side
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

/* -------------------------------------------------------------------------
 * Graceful shutdown. SIGTERM is what Fly.io sends on deploy and auto-stop;
 * we tell every connected client politely, then close the listener.
 * -----------------------------------------------------------------------*/

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`munch: ${signal} received, shutting down`);
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
  wss.close();
  httpServer.close(() => process.exit(0));
  // Hard exit if cleanup hangs.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("munch: uncaught exception", err);
});
process.on("unhandledRejection", (err) => {
  console.error("munch: unhandled rejection", err);
});

/* ---- Helpers ---- */

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket died mid-send; cleanup happens on close
  }
}

// Tiny defensive name filter. Not a moderation system — just keeps
// obvious slurs and control characters out. Anything more serious
// belongs in a real moderation pipeline once this is deployed.
const BLOCKED = [
  // intentionally a small set of unambiguous tokens; expand if needed
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
    .replace(/[\u0000-\u001f\u007f]/g, "")
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
