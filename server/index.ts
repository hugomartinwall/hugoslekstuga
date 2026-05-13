// Shared multiplayer server shell.
//
// Hosts both Munch and Noodle on a single Node process. One HTTP
// server, one WebSocket upgrade endpoint, routed by URL path:
//
//   ws://host/         → munch (legacy clients connect to root)
//   ws://host/munch    → munch
//   ws://host/noodle   → noodle
//
// Per-game state, tick loops, and bot managers live inside their
// respective handler modules. This shell is just plumbing:
//   - the HTTP server (with /health for Fly.io)
//   - the WebSocket upgrade handler with path routing
//   - shared per-IP rate limiting (applies to both games)
//   - graceful shutdown that calls each game's shutdown function
//
// Run locally with:    npm run munch
// In production:       Fly.io single-instance, auto-stop when idle.
//                      See Dockerfile + fly.toml at the repo root.

import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  mountMunch,
  getMunchHealth,
  shutdownMunch,
} from "./munch/handler.js";
import {
  mountNoodle,
  getNoodleHealth,
  shutdownNoodle,
} from "./noodle/handler.js";

const PORT = Number(process.env.MUNCH_PORT ?? 8080);

/* -------------------------------------------------------------------------
 * HTTP server — exposes /health for Fly's health-check probe AND hosts the
 * WebSocket upgrade. Without an HTTP layer Fly can't distinguish "server up"
 * from "server down", and auto-stop / auto-start break.
 * -----------------------------------------------------------------------*/

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        munch: getMunchHealth(),
        noodle: getNoodleHealth(),
        uptime: Math.round(process.uptime()),
      }),
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

/* -------------------------------------------------------------------------
 * Per-IP rate limit on connection attempts. Stops one bad client from
 * spamming connections faster than we can disconnect them. Generous limit;
 * a real player legitimately reconnecting on a flaky network won't trip it.
 * Applies across BOTH games — one IP can open a total of N connections per
 * minute regardless of which game they're targeting.
 * -----------------------------------------------------------------------*/

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_CONNECTIONS = 30;
const ipBuckets = new Map<string, number[]>();

function clientIpFrom(req: IncomingMessage): string {
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

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of ipBuckets.entries()) {
    const recent = bucket.filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length === 0) ipBuckets.delete(ip);
    else ipBuckets.set(ip, recent);
  }
}, RATE_WINDOW_MS).unref();

/* -------------------------------------------------------------------------
 * WebSocket upgrade routing.
 *
 * One WSS instance, no auto-attach to the HTTP server — we handle the
 * upgrade manually so we can rate-limit (and reject) before allocating
 * a WebSocket, and route by URL path.
 * -----------------------------------------------------------------------*/

// Enable permessage-deflate compression on outgoing frames. JSON
// snapshots from Noodle compress 5-10×; cost is negligible CPU on
// modern Node (deflate is native). zlib settings tuned conservatively
// — small concurrent-window so per-connection memory stays bounded
// even at MAX_PLAYERS, and a 1KB threshold so tiny welcome/pong
// frames bypass compression overhead.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1, memLevel: 7 },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    threshold: 1024,
  },
});

httpServer.on("upgrade", (req, socket, head) => {
  const ip = clientIpFrom(req);
  if (isRateLimited(ip)) {
    rejectUpgrade(socket, 429, "Too many connections");
    return;
  }

  const url = req.url ?? "/";
  if (url.startsWith("/noodle") || url.startsWith("/munch") || url === "/") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    rejectUpgrade(socket, 404, "Unknown game path");
  }
});

wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
  const url = req.url ?? "/";
  if (url.startsWith("/noodle")) {
    mountNoodle(ws);
  } else {
    // Default + /munch path → munch. Legacy clients without a path land here.
    mountMunch(ws);
  }
});

wss.on("error", (err) => {
  console.error("server: wss error", err);
});

/** Send a small HTTP response on a non-upgraded socket and close. */
function rejectUpgrade(socket: Duplex, code: number, reason: string): void {
  try {
    socket.write(
      `HTTP/1.1 ${code} ${reason}\r\n` +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n\r\n",
    );
  } catch {}
  socket.destroy();
}

/* -------------------------- listen ---------------------------------- */

httpServer.listen(PORT, () => {
  console.log(`server listening on :${PORT} (munch + noodle)`);
});

/* -------------------------------------------------------------------------
 * Graceful shutdown. SIGTERM is what Fly.io sends on deploy and auto-stop;
 * each game shuts down its own clients politely, then we close the listener.
 * -----------------------------------------------------------------------*/

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`server: ${signal} received, shutting down`);
  shutdownMunch();
  shutdownNoodle();
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  console.error("server: uncaught exception", err);
});
process.on("unhandledRejection", (err) => {
  console.error("server: unhandled rejection", err);
});
