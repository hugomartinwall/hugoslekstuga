/**
 * On-disk format for the baked sjökort routing graph.
 *
 * The graph is a compressed-sparse-row (CSR) adjacency structure over water
 * nodes. It is baked offline by `scripts/bake-sjokort-graph.ts` and shipped
 * as a single static binary (`public/sjokort/graph.vN.bin`) that the routing
 * Web Worker loads once and runs A* over. No routing server, no per-query
 * fetch — the artifact is our own same-origin asset.
 *
 * Layout (all little-endian; every section starts 4-byte aligned so the
 * reader can take zero-copy typed-array views straight onto the buffer):
 *
 *   header (56 bytes)
 *     u32  magic   = 0x314b4a53  ("SJK1")
 *     u32  version = 1
 *     u32  nodeCount  (N)
 *     u32  edgeCount  (E, directed)
 *     f64  bbox[4]    minLon, minLat, maxLon, maxLat
 *   f32  coords[2N]   lon,lat interleaved
 *   i32  xadj[N+1]    offsets into adj (CSR row pointers)
 *   i32  adj[E]       neighbour node indices
 *   u8   edgeType[E]  0 = open water, 1 = vetted corridor
 *
 * Little-endian is assumed — every platform we target (browsers, the bake
 * machine) is LE, so typed-array views over the buffer are correct as-is.
 */

export interface RoutingGraph {
  nodeCount: number;
  /** Directed edge count (each undirected link is stored both ways). */
  edgeCount: number;
  /** 2·N floats: [lon0, lat0, lon1, lat1, …] */
  coords: Float32Array;
  /** N+1 CSR row pointers into `adj`. */
  xadj: Int32Array;
  /** E neighbour node indices. */
  adj: Int32Array;
  /** E edge kinds: 0 = open water, 1 = vetted corridor. */
  edgeType: Uint8Array;
  /** [minLon, minLat, maxLon, maxLat] */
  bbox: [number, number, number, number];
}

const MAGIC = 0x314b4a53;
const VERSION = 1;
const HEADER_BYTES = 4 + 4 + 4 + 4 + 8 * 4; // 56

export function serializeGraph(g: RoutingGraph): ArrayBuffer {
  const { nodeCount: N, edgeCount: E } = g;

  const coordsOff = HEADER_BYTES;
  const xadjOff = coordsOff + N * 2 * 4;
  const adjOff = xadjOff + (N + 1) * 4;
  const edgeTypeOff = adjOff + E * 4;
  const total = edgeTypeOff + E * 1;

  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, N, true);
  dv.setUint32(12, E, true);
  for (let i = 0; i < 4; i++) dv.setFloat64(16 + i * 8, g.bbox[i], true);

  new Float32Array(buf, coordsOff, N * 2).set(g.coords);
  new Int32Array(buf, xadjOff, N + 1).set(g.xadj);
  new Int32Array(buf, adjOff, E).set(g.adj);
  new Uint8Array(buf, edgeTypeOff, E).set(g.edgeType);

  return buf;
}

export function deserializeGraph(buf: ArrayBuffer): RoutingGraph {
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`sjökort graph: bad magic 0x${magic.toString(16)}`);
  }
  const version = dv.getUint32(4, true);
  if (version !== VERSION) {
    throw new Error(`sjökort graph: unsupported version ${version}`);
  }
  const N = dv.getUint32(8, true);
  const E = dv.getUint32(12, true);
  const bbox: [number, number, number, number] = [
    dv.getFloat64(16, true),
    dv.getFloat64(24, true),
    dv.getFloat64(32, true),
    dv.getFloat64(40, true),
  ];

  const coordsOff = HEADER_BYTES;
  const xadjOff = coordsOff + N * 2 * 4;
  const adjOff = xadjOff + (N + 1) * 4;
  const edgeTypeOff = adjOff + E * 4;

  return {
    nodeCount: N,
    edgeCount: E,
    coords: new Float32Array(buf, coordsOff, N * 2),
    xadj: new Int32Array(buf, xadjOff, N + 1),
    adj: new Int32Array(buf, adjOff, E),
    edgeType: new Uint8Array(buf, edgeTypeOff, E),
    bbox,
  };
}
