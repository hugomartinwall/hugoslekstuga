/**
 * Main-thread handle to the routing Web Worker. Spawns the worker, matches
 * replies to requests by id, and resolves a promise per route() call.
 *
 * Client-only: call createRouter() inside an effect, never during render/SSR
 * (it touches `Worker`). The `new Worker(new URL(...))` form is what Turbopack
 * needs to bundle the worker and its imports.
 */

export interface RouteReply {
  ok: boolean;
  /** Route polyline [lng, lat][] when ok. */
  coords?: [number, number][];
  /** Travelled distance in metres when ok. */
  distanceM?: number;
  /** How many legs ran along a vetted corridor. */
  corridorLegs?: number;
  /** "start-dry" | "end-dry" | "no-route" | error string when !ok. */
  error?: string;
}

export interface Router {
  route(start: [number, number], end: [number, number]): Promise<RouteReply>;
  dispose(): void;
}

export function createRouter(): Router {
  const worker = new Worker(new URL("./routing.worker.ts", import.meta.url), {
    type: "module",
  });
  let nextId = 1;
  const pending = new Map<number, (r: RouteReply) => void>();

  worker.onmessage = (ev: MessageEvent) => {
    const { id, ...reply } = ev.data as { id: number } & RouteReply;
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve(reply);
    }
  };

  return {
    route(start, end) {
      const id = nextId++;
      return new Promise<RouteReply>((resolve) => {
        pending.set(id, resolve);
        worker.postMessage({ id, start, end });
      });
    },
    dispose() {
      worker.terminate();
      pending.clear();
    },
  };
}
