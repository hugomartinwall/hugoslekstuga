// Noodle — connection handler.
//
// Step-2 stub: connections are accepted, immediately answered with a
// "still cooking" error, and closed. The path routing in
// server/index.ts uses this to validate that /noodle WebSocket
// connections reach the right module. Step 3 fills in the actual
// snake game.

import type { WebSocket } from "ws";

/** Mount a new noodle connection. The shared shell calls this after
 *  it routes the WS upgrade by URL path. */
export function mountNoodle(ws: WebSocket): void {
  try {
    if (ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify({
          type: "error",
          reason: "Noodle is still cooking — try again soon.",
        }),
      );
    }
    ws.close();
  } catch (err) {
    console.error("noodle: error in connection handler", err);
    try {
      ws.close();
    } catch {}
  }
}

/** Health snapshot for the shared /health endpoint. */
export function getNoodleHealth(): { players: number; sockets: number } {
  // Step-2 stub: nothing to report yet.
  return { players: 0, sockets: 0 };
}

/** Called by the shared shell during graceful shutdown. */
export function shutdownNoodle(): void {
  // Step-2 stub: nothing to clean up.
}
