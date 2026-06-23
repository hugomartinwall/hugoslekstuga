/**
 * A* over the baked CSR routing graph (see graph-format.ts), plus the
 * snapping index that turns a dropped pin (any lng/lat) into a start/goal
 * node. Isomorphic — the bake-time harness and the in-browser Web Worker
 * both import this unchanged.
 *
 * Cost model: each edge costs its great-circle length times a multiplier
 * that depends on edge kind. Vetted corridors are cheaper than open water,
 * so a route rides a nearby marked channel when one exists but can still
 * cut across open water when that is genuinely shorter. The heuristic uses
 * the *minimum* multiplier (corridor) so it never overestimates — A* stays
 * admissible and the path stays optimal under this cost.
 */

import { haversineMeters } from "../geo";
import type { RoutingGraph } from "./graph-format";

/** Open-water edges are penalised relative to vetted corridors. */
export const CORRIDOR_COST_MULT = 1.0;
export const WATER_COST_MULT = 1.4;

function edgeMult(edgeType: number): number {
  return edgeType === 1 ? CORRIDOR_COST_MULT : WATER_COST_MULT;
}

export interface RouteResult {
  /** Node indices from start to goal, inclusive. */
  nodes: number[];
  /** The route polyline as [lon, lat] pairs. */
  coords: [number, number][];
  /** True travelled distance in metres (sum of leg lengths, no multiplier). */
  distanceM: number;
  /** A* path cost (distance × multipliers) — for diagnostics/tuning. */
  cost: number;
  /** How many nodes A* expanded — a feel for query effort. */
  expanded: number;
  /** How many legs run along a vetted corridor (vs open water). */
  corridorLegs: number;
}

/** Binary min-heap of (nodeId) keyed by f-score; lazy-deletion friendly. */
class MinHeap {
  private node: number[] = [];
  private key: number[] = [];

  get size(): number {
    return this.node.length;
  }

  push(node: number, key: number): void {
    const n = this.node;
    const k = this.key;
    let i = n.length;
    n.push(node);
    k.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (k[parent] <= k[i]) break;
      [k[parent], k[i]] = [k[i], k[parent]];
      [n[parent], n[i]] = [n[i], n[parent]];
      i = parent;
    }
  }

  pop(): number {
    const n = this.node;
    const k = this.key;
    const top = n[0];
    const lastNode = n.pop()!;
    const lastKey = k.pop()!;
    if (n.length > 0) {
      n[0] = lastNode;
      k[0] = lastKey;
      let i = 0;
      const len = n.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < len && k[l] < k[smallest]) smallest = l;
        if (r < len && k[r] < k[smallest]) smallest = r;
        if (smallest === i) break;
        [k[smallest], k[i]] = [k[i], k[smallest]];
        [n[smallest], n[i]] = [n[i], n[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export function findRoute(
  g: RoutingGraph,
  startIdx: number,
  goalIdx: number,
): RouteResult | null {
  const { nodeCount: N, coords, xadj, adj, edgeType } = g;
  if (startIdx < 0 || goalIdx < 0 || startIdx >= N || goalIdx >= N) return null;
  if (startIdx === goalIdx) {
    return {
      nodes: [startIdx],
      coords: [[coords[2 * startIdx], coords[2 * startIdx + 1]]],
      distanceM: 0,
      cost: 0,
      expanded: 0,
      corridorLegs: 0,
    };
  }

  const gScore = new Float64Array(N).fill(Infinity);
  const cameFrom = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);

  const goalLon = coords[2 * goalIdx];
  const goalLat = coords[2 * goalIdx + 1];
  const heuristic = (i: number): number =>
    haversineMeters(coords[2 * i], coords[2 * i + 1], goalLon, goalLat) *
    CORRIDOR_COST_MULT;

  const open = new MinHeap();
  gScore[startIdx] = 0;
  open.push(startIdx, heuristic(startIdx));
  let expanded = 0;

  while (open.size > 0) {
    const u = open.pop();
    if (closed[u]) continue;
    if (u === goalIdx) break;
    closed[u] = 1;
    expanded++;

    const uLon = coords[2 * u];
    const uLat = coords[2 * u + 1];
    const start = xadj[u];
    const end = xadj[u + 1];
    for (let e = start; e < end; e++) {
      const v = adj[e];
      if (closed[v]) continue;
      const legM = haversineMeters(uLon, uLat, coords[2 * v], coords[2 * v + 1]);
      const tentative = gScore[u] + legM * edgeMult(edgeType[e]);
      if (tentative < gScore[v]) {
        gScore[v] = tentative;
        cameFrom[v] = u;
        open.push(v, tentative + heuristic(v));
      }
    }
  }

  if (cameFrom[goalIdx] === -1 && goalIdx !== startIdx) return null;

  // Reconstruct.
  const nodes: number[] = [];
  for (let cur = goalIdx; cur !== -1; cur = cameFrom[cur]) {
    nodes.push(cur);
    if (cur === startIdx) break;
  }
  nodes.reverse();
  if (nodes[0] !== startIdx) return null;

  const outCoords: [number, number][] = [];
  let distanceM = 0;
  let corridorLegs = 0;
  for (let i = 0; i < nodes.length; i++) {
    const idx = nodes[i];
    outCoords.push([coords[2 * idx], coords[2 * idx + 1]]);
    if (i > 0) {
      const a = nodes[i - 1];
      distanceM += haversineMeters(
        coords[2 * a],
        coords[2 * a + 1],
        coords[2 * idx],
        coords[2 * idx + 1],
      );
      // Was the a→idx leg a corridor edge?
      for (let e = xadj[a]; e < xadj[a + 1]; e++) {
        if (adj[e] === idx) {
          if (edgeType[e] === 1) corridorLegs++;
          break;
        }
      }
    }
  }

  return { nodes, coords: outCoords, distanceM, cost: gScore[goalIdx], expanded, corridorLegs };
}

/* ---------------------------------------------------------------------- *
 * Snapping: dropped pin (any lng/lat) → nearest graph node.
 * A uniform bucket grid over the graph bbox; lookups expand outward ring
 * by ring until a node is found, then check one more ring to be safe.
 * ---------------------------------------------------------------------- */

export interface NodeIndex {
  cols: number;
  rows: number;
  cellDeg: number;
  minLon: number;
  minLat: number;
  buckets: Int32Array[]; // cols*rows buckets, each a list of node indices
}

export function buildNodeIndex(g: RoutingGraph, cellDeg = 0.01): NodeIndex {
  const [minLon, minLat, maxLon, maxLat] = g.bbox;
  const cols = Math.max(1, Math.ceil((maxLon - minLon) / cellDeg));
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / cellDeg));
  const lists: number[][] = Array.from({ length: cols * rows }, () => []);

  const { coords, nodeCount: N } = g;
  for (let i = 0; i < N; i++) {
    const col = clampInt((coords[2 * i] - minLon) / cellDeg, cols);
    const row = clampInt((coords[2 * i + 1] - minLat) / cellDeg, rows);
    lists[row * cols + col].push(i);
  }

  return {
    cols,
    rows,
    cellDeg,
    minLon,
    minLat,
    buckets: lists.map((l) => Int32Array.from(l)),
  };
}

function clampInt(v: number, n: number): number {
  const i = Math.floor(v);
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Nearest node to a lng/lat, or -1 if nothing is within `maxRings` cells
 * (≈ the pin is on land / outside the routable area).
 */
export function nearestNode(
  g: RoutingGraph,
  index: NodeIndex,
  lon: number,
  lat: number,
  maxRings = 25,
): number {
  const { cols, rows, cellDeg, minLon, minLat, buckets } = index;
  const col = clampInt((lon - minLon) / cellDeg, cols);
  const row = clampInt((lat - minLat) / cellDeg, rows);
  const { coords } = g;

  let best = -1;
  let bestD = Infinity;
  let foundRing = -1;

  for (let r = 0; r <= maxRings; r++) {
    // Once we have a hit, scan one extra ring then stop — the true nearest
    // can sit in an adjacent cell to the first one we found.
    if (foundRing >= 0 && r > foundRing + 1) break;

    for (let dr = -r; dr <= r; dr++) {
      const rr = row + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dc = -r; dc <= r; dc++) {
        // Only the ring boundary at radius r (interior already scanned).
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;
        const cc = col + dc;
        if (cc < 0 || cc >= cols) continue;
        const bucket = buckets[rr * cols + cc];
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          const d = haversineMeters(lon, lat, coords[2 * idx], coords[2 * idx + 1]);
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
    }
    if (best >= 0 && foundRing < 0) foundRing = r;
  }

  return best;
}
