/**
 * Routing Web Worker. Loads the baked CSR graph once (our own same-origin
 * static asset — not a third-party fetch), snaps the dropped start/destination
 * pins to the nearest water node, and runs A* off the main thread so the map
 * never janks. Returns the route polyline + distance.
 *
 * The graph + A* live in shared isomorphic modules (graph-format, astar) so the
 * exact code measured in the bake harness runs here unchanged.
 */

import { deserializeGraph, type RoutingGraph } from "./graph-format";
import { buildNodeIndex, findRoute, nearestNode, type NodeIndex } from "./astar";

const GRAPH_URL = "/sjokort/graph.v1.bin";

interface RouteRequest {
  id: number;
  start: [number, number]; // [lng, lat]
  end: [number, number];
}

// Cast the worker global to just the bits we use — avoids pulling the
// "webworker" lib (which conflicts with the project's "dom" lib).
const ctx = self as unknown as {
  postMessage: (msg: unknown) => void;
  onmessage: ((ev: MessageEvent<RouteRequest>) => void) | null;
};

let loaded: { graph: RoutingGraph; index: NodeIndex } | null = null;
let loading: Promise<{ graph: RoutingGraph; index: NodeIndex }> | null = null;

function ensureLoaded(): Promise<{ graph: RoutingGraph; index: NodeIndex }> {
  if (loaded) return Promise.resolve(loaded);
  if (!loading) {
    loading = (async () => {
      const res = await fetch(GRAPH_URL);
      if (!res.ok) throw new Error(`graph fetch failed: ${res.status}`);
      const graph = deserializeGraph(await res.arrayBuffer());
      const index = buildNodeIndex(graph, 0.01);
      loaded = { graph, index };
      return loaded;
    })();
  }
  return loading;
}

ctx.onmessage = async (ev) => {
  const { id, start, end } = ev.data;
  try {
    const { graph, index } = await ensureLoaded();
    const s = nearestNode(graph, index, start[0], start[1]);
    const g = nearestNode(graph, index, end[0], end[1]);
    if (s < 0 || g < 0) {
      ctx.postMessage({ id, ok: false, error: s < 0 ? "start-dry" : "end-dry" });
      return;
    }
    const result = findRoute(graph, s, g);
    if (!result) {
      ctx.postMessage({ id, ok: false, error: "no-route" });
      return;
    }
    ctx.postMessage({
      id,
      ok: true,
      coords: result.coords,
      distanceM: result.distanceM,
      corridorLegs: result.corridorLegs,
    });
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: String(err) });
  }
};
