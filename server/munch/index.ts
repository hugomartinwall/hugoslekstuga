// Munch — WebSocket entrypoint.
//
// Runs a single shared game world. Clients connect, send `join` once,
// then push `input` packets ~30Hz; the server pushes `state` snapshots
// at SNAPSHOT_HZ. Server-authoritative — clients can't claim mass or
// position.
//
// Run locally with:    npm run munch
// (dev only — production deploy is its own conversation.)

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

const game = new Game();
const sockets = new Map<string, WebSocket>();
let nextPlayerId = 1;

const wss = new WebSocketServer({ port: PORT });
console.log(`munch server listening on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  if (sockets.size >= MAX_PLAYERS) {
    send(ws, { type: "error", reason: "Server is full — try again in a minute." });
    ws.close();
    return;
  }

  let playerId: string | null = null;

  ws.on("message", (raw) => {
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
  });

  ws.on("close", () => {
    if (playerId) {
      game.removePlayer(playerId);
      sockets.delete(playerId);
    }
  });

  ws.on("error", () => {
    if (playerId) {
      game.removePlayer(playerId);
      sockets.delete(playerId);
    }
  });
});

/* ---- Game loop ---- */

const tickIntervalMs = 1000 / TICK_HZ;
const snapshotIntervalMs = 1000 / SNAPSHOT_HZ;
let lastSnapshotAt = 0;
const lastDeadEmitTick = new Map<string, number>(); // remember which players we've already told about death

setInterval(() => {
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
}, tickIntervalMs);

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
