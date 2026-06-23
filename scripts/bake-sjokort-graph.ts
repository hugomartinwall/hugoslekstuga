/**
 * Offline bake for the sjökort routing graph (Phase A spike + pipeline).
 *
 * Pipeline:
 *   1. Fetch OSM water polygons (ODbL) once, cache locally. Default source is
 *      the FULL-resolution set (real archipelago coastline); the SIMPLIFIED
 *      set is available for a quick low-fidelity run.
 *   2. Keep the polygons covering the Stockholm + archipelago bbox (reproject
 *      Web-Mercator → lng/lat for the 3857 source). Cache the bbox clip so
 *      re-bakes skip the slow global scan.
 *   3. Sample a coarse grid of water nodes; connect 8-neighbours whose leg
 *      stays in water (interior-sampled) → the general land-avoidance layer.
 *   4. Splice in hand-vetted deep-water corridors (lib/sjokort/corridors.geojson)
 *      as low-cost edges; join them to nearby grid nodes.
 *   5. Serialise to a compact CSR binary → public/sjokort/graph.v1.bin.
 *   6. Harness: round-trip the artifact, snap + route the canonical pair
 *      (Karlbergskanalen → Sandhamn) and an open-water pair, and report
 *      node/edge counts, bytes, A* timing, and an in-water sanity check.
 *
 * Run:  npx tsx scripts/bake-sjokort-graph.ts            (full source, 450 m)
 *       SOURCE=simplified npx tsx scripts/bake-sjokort-graph.ts
 *       SPACING=350 CORRIDORS=0 PROBE=1 npx tsx scripts/bake-sjokort-graph.ts
 *       REBUILD=1 npx tsx scripts/bake-sjokort-graph.ts   (re-scan, ignore clip cache)
 *
 * Build-time tooling: fetches from the network at AUTHOR time and emits a
 * static artifact. Nothing here ships to the browser.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import * as shapefile from "shapefile";

import { haversineMeters } from "../lib/geo";
import {
  serializeGraph,
  deserializeGraph,
  type RoutingGraph,
} from "../lib/sjokort/graph-format";
import { buildNodeIndex, findRoute, nearestNode } from "../lib/sjokort/astar";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CACHE = join(ROOT, ".sjokort-cache");

type SourceKind = "full" | "simplified";
const SOURCE = (process.env.SOURCE ?? "full") as SourceKind;
const SOURCES: Record<
  SourceKind,
  { zip: string; dir: string; crs: 4326 | 3857 }
> = {
  full: { zip: "water-polygons-split-4326.zip", dir: "water-polygons-split-4326", crs: 4326 },
  simplified: {
    zip: "simplified-water-polygons-split-3857.zip",
    dir: "simplified-water-polygons-split-3857",
    crs: 3857,
  },
};
const SRC = SOURCES[SOURCE];
const ZIP = join(CACHE, SRC.zip);
const SHP_DIR = join(CACHE, SRC.dir);
const ZIP_URL = `https://osmdata.openstreetmap.de/download/${SRC.zip}`;
const CLIP_CACHE = join(CACHE, `water-bbox-${SOURCE}.json`);

const OUT_DIR = join(ROOT, "public", "sjokort");
const OUT = join(OUT_DIR, "graph.v1.bin");
const CORRIDORS = join(ROOT, "lib", "sjokort", "corridors.geojson");

const BBOX = { minLon: 16.5, minLat: 58.6, maxLon: 20.2, maxLat: 60.2 };
const SPACING_M = Number(process.env.SPACING ?? 450);
const CORRIDOR_STEP_M = 150;
const USE_CORRIDORS = process.env.CORRIDORS !== "0";
const MID_LAT = (BBOX.minLat + BBOX.maxLat) / 2;

// Canonical + open-water test pairs (lon, lat).
const KARLBERG: [number, number] = [18.018, 59.337];
const SANDHAMN: [number, number] = [18.913, 59.288];
const OPEN_A: [number, number] = [18.45, 59.42]; // Trälhavet-ish
const OPEN_B: [number, number] = [18.74, 59.33]; // Kanholmsfjärden-ish

// Inland water (Lake Mälaren etc.) is NOT in the coastline-derived sea
// polygons — it's freshwater behind the Slussen locks. Pull it from Overpass
// over a tight inner-Stockholm window so the route's Mälaren half exists.
const INLAND_QBBOX = { s: 59.27, w: 17.8, n: 59.42, e: 18.25 };
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const INLAND_CACHE = join(CACHE, "inland-bbox.json");
const USE_INLAND = process.env.INLAND !== "0";

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const MERC_R = 6378137;
function merc2lonlat(x: number, y: number): [number, number] {
  const lon = (x / MERC_R) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / MERC_R)) - Math.PI / 2) * (180 / Math.PI);
  return [lon, lat];
}

type Ring = number[][]; // [ [lon,lat], ... ]
interface Poly {
  bbox: [number, number, number, number]; // minLon,minLat,maxLon,maxLat
  rings: Ring[]; // [0] outer, rest holes
}

function ringBbox(rings: Ring[]): [number, number, number, number] {
  let mnLon = Infinity,
    mnLat = Infinity,
    mxLon = -Infinity,
    mxLat = -Infinity;
  for (const r of rings)
    for (const [lon, lat] of r) {
      if (lon < mnLon) mnLon = lon;
      if (lat < mnLat) mnLat = lat;
      if (lon > mxLon) mxLon = lon;
      if (lat > mxLat) mxLat = lat;
    }
  return [mnLon, mnLat, mxLon, mxLat];
}

function bboxesOverlap(
  a: [number, number, number, number],
  b: { minLon: number; minLat: number; maxLon: number; maxLat: number },
): boolean {
  return !(a[0] > b.maxLon || a[2] < b.minLon || a[1] > b.maxLat || a[3] < b.minLat);
}

type LngLat = [number, number];

/** Minimal binary min-heap (node id keyed by f-score) for the bake's fine A*. */
class FlatHeap {
  private n: number[] = [];
  private k: number[] = [];
  get size(): number {
    return this.n.length;
  }
  push(node: number, key: number): void {
    const n = this.n;
    const k = this.k;
    let i = n.length;
    n.push(node);
    k.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [n[p], n[i]] = [n[i], n[p]];
      i = p;
    }
  }
  pop(): number {
    const n = this.n;
    const k = this.k;
    const top = n[0];
    const ln = n.pop() as number;
    const lk = k.pop() as number;
    if (n.length) {
      n[0] = ln;
      k[0] = lk;
      let i = 0;
      const L = n.length;
      for (;;) {
        let s = i;
        const l = 2 * i + 1;
        const r = l + 1;
        if (l < L && k[l] < k[s]) s = l;
        if (r < L && k[r] < k[s]) s = r;
        if (s === i) break;
        [k[s], k[i]] = [k[i], k[s]];
        [n[s], n[i]] = [n[i], n[s]];
        i = s;
      }
    }
    return top;
  }
}

const MASK_NB8: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// Rasterised water mask. Point-in-polygon over the full-detail coastline
// polygons (some with 100k+ vertices) is the bake bottleneck, so instead we
// scanline-fill every polygon into a bitmap once (even-odd per polygon, then
// union) and answer isWater() with an O(1) lookup. Mask resolution is finer
// than the routing grid so node/edge classification stays accurate.
const MASK_CELL_M = 70;
interface WaterMask {
  cols: number;
  rows: number;
  dLon: number;
  dLat: number;
  data: Uint8Array;
}

function buildMask(polys: Poly[]): WaterMask {
  const dLat = MASK_CELL_M / 111320;
  const dLon = MASK_CELL_M / (111320 * Math.cos((MID_LAT * Math.PI) / 180));
  const cols = Math.ceil((BBOX.maxLon - BBOX.minLon) / dLon);
  const rows = Math.ceil((BBOX.maxLat - BBOX.minLat) / dLat);
  const data = new Uint8Array(cols * rows);

  const rowX: number[][] = Array.from({ length: rows }, () => []);
  const touched: number[] = [];
  const touchFlag = new Uint8Array(rows);

  for (const poly of polys) {
    for (const ring of poly.rings) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        let x0 = ring[i][0],
          y0 = ring[i][1];
        let x1 = ring[(i + 1) % n][0],
          y1 = ring[(i + 1) % n][1];
        if (y0 === y1) continue; // horizontal edge contributes nothing
        if (y0 > y1) {
          const tx = x0;
          x0 = x1;
          x1 = tx;
          const ty = y0;
          y0 = y1;
          y1 = ty;
        }
        let r0 = Math.ceil((y0 - BBOX.minLat) / dLat - 0.5);
        let r1 = Math.floor((y1 - BBOX.minLat) / dLat - 0.5);
        if (r0 < 0) r0 = 0;
        if (r1 > rows - 1) r1 = rows - 1;
        for (let r = r0; r <= r1; r++) {
          const yc = BBOX.minLat + (r + 0.5) * dLat;
          if (yc < y0 || yc >= y1) continue; // half-open: avoids double-count at vertices
          const x = x0 + ((x1 - x0) * (yc - y0)) / (y1 - y0);
          rowX[r].push((x - BBOX.minLon) / dLon);
          if (!touchFlag[r]) {
            touchFlag[r] = 1;
            touched.push(r);
          }
        }
      }
    }
    // Even-odd fill the touched rows for this polygon, then reset.
    for (const r of touched) {
      const xs = rowX[r];
      xs.sort((a, b) => a - b);
      const base = r * cols;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let cs = Math.ceil(xs[k] - 0.5);
        let ce = Math.floor(xs[k + 1] - 0.5);
        if (cs < 0) cs = 0;
        if (ce > cols - 1) ce = cols - 1;
        for (let c = cs; c <= ce; c++) data[base + c] = 1;
      }
      xs.length = 0;
      touchFlag[r] = 0;
    }
    touched.length = 0;
  }

  return { cols, rows, dLon, dLat, data };
}

// ---------------------------------------------------------------------------
// 1–2. Data: download, scan to bbox, cache the clip
// ---------------------------------------------------------------------------

function findShp(): string {
  const f = readdirSync(SHP_DIR).find((n) => n.endsWith(".shp"));
  if (!f) throw new Error(`no .shp in ${SHP_DIR}`);
  return join(SHP_DIR, f);
}

function ensureData(): void {
  if (existsSync(SHP_DIR) && readdirSync(SHP_DIR).some((n) => n.endsWith(".shp")))
    return;
  mkdirSync(CACHE, { recursive: true });
  if (!existsSync(ZIP)) {
    console.log(`· downloading ${SRC.zip} …`);
    execSync(`curl -sSL -o "${ZIP}" "${ZIP_URL}"`, { stdio: "inherit" });
  }
  console.log("· unzipping…");
  execSync(`unzip -o -q "${ZIP}" -d "${CACHE}"`, { stdio: "inherit" });
}

async function loadWaterPolys(): Promise<Poly[]> {
  if (existsSync(CLIP_CACHE) && !process.env.REBUILD) {
    console.log(`· clip cache hit: ${CLIP_CACHE}`);
    return JSON.parse(readFileSync(CLIP_CACHE, "utf8")) as Poly[];
  }
  ensureData();
  const shp = findShp();
  console.log(`· scanning ${SOURCE} shapefile (${shp})…`);
  const reproject =
    SRC.crs === 3857
      ? (x: number, y: number) => merc2lonlat(x, y)
      : (x: number, y: number): [number, number] => [x, y];

  const source = await shapefile.open(shp);
  const polys: Poly[] = [];
  let read = 0;
  for (;;) {
    const { done, value } = await source.read();
    if (done) break;
    read++;
    if (read % 200000 === 0) console.log(`  …scanned ${read} polygons (${polys.length} in bbox)`);
    const geom = value.geometry;
    if (!geom) continue;

    const pushPolygon = (rawRings: number[][][]): void => {
      const rings: Ring[] = rawRings.map((r) => r.map(([x, y]) => reproject(x, y)));
      const bbox = ringBbox(rings);
      if (bboxesOverlap(bbox, BBOX)) polys.push({ bbox, rings });
    };
    if (geom.type === "Polygon") pushPolygon(geom.coordinates as number[][][]);
    else if (geom.type === "MultiPolygon")
      for (const poly of geom.coordinates as number[][][][]) pushPolygon(poly);
  }
  console.log(`  scanned ${read} polygons → ${polys.length} cover the bbox`);
  writeFileSync(CLIP_CACHE, JSON.stringify(polys));
  console.log(`  cached clip → ${CLIP_CACHE} (${(statSync(CLIP_CACHE).size / 1e6).toFixed(1)} MB)`);
  return polys;
}

// --- inland water (Overpass) ---

function isClosedRing(r: Ring): boolean {
  return r.length > 3 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1];
}

/** Stitch fragmented relation member ways into closed rings by endpoint match. */
function stitchRings(parts: Ring[]): Ring[] {
  const rings: Ring[] = [];
  const used = new Array(parts.length).fill(false);
  const k = (p: number[]) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
  for (let i = 0; i < parts.length; i++) {
    if (used[i] || parts[i].length < 2) continue;
    used[i] = true;
    let ring = parts[i].slice();
    let extended = true;
    while (extended && k(ring[0]) !== k(ring[ring.length - 1])) {
      extended = false;
      for (let j = 0; j < parts.length; j++) {
        if (used[j]) continue;
        const w = parts[j];
        const tail = ring[ring.length - 1];
        const head = ring[0];
        if (k(tail) === k(w[0])) ring = ring.concat(w.slice(1));
        else if (k(tail) === k(w[w.length - 1])) ring = ring.concat(w.slice(0, -1).reverse());
        else if (k(head) === k(w[w.length - 1])) ring = w.slice(0, -1).concat(ring);
        else if (k(head) === k(w[0])) ring = w.slice(1).reverse().concat(ring);
        else continue;
        used[j] = true;
        extended = true;
        break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

interface OverpassEl {
  type: string;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; role: string; geometry?: { lat: number; lon: number }[] }[];
  tags?: Record<string, string>;
}

async function fetchInlandPolys(): Promise<Poly[]> {
  if (existsSync(INLAND_CACHE) && !process.env.REBUILD)
    return JSON.parse(readFileSync(INLAND_CACHE, "utf8")) as Poly[];
  const { s, w, n, e } = INLAND_QBBOX;
  const q = `[out:json][timeout:300];(way["natural"="water"](${s},${w},${n},${e});relation["natural"="water"](${s},${w},${n},${e}););out geom;`;
  console.log("· fetching inland water from Overpass…");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "hugoslekstuga-sjokort-bake/1.0 (+https://hugoslekstuga.com)",
    },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`overpass ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  const json = (await res.json()) as { elements: OverpassEl[] };
  const polys: Poly[] = [];
  for (const el of json.elements) {
    if (el.type === "way" && el.geometry) {
      const ring: Ring = el.geometry.map((g) => [g.lon, g.lat]);
      if (isClosedRing(ring)) polys.push({ bbox: ringBbox([ring]), rings: [ring] });
    } else if (el.type === "relation" && el.members) {
      const outers = el.members
        .filter((m) => m.type === "way" && m.role !== "inner" && m.geometry)
        .map((m): Ring => m.geometry!.map((g) => [g.lon, g.lat]));
      const inners = el.members
        .filter((m) => m.type === "way" && m.role === "inner" && m.geometry)
        .map((m): Ring => m.geometry!.map((g) => [g.lon, g.lat]));
      const rings = [...stitchRings(outers), ...stitchRings(inners)].filter((r) => r.length > 3);
      if (rings.length) polys.push({ bbox: ringBbox(rings), rings });
    }
  }
  writeFileSync(INLAND_CACHE, JSON.stringify(polys));
  console.log(
    `  inland: ${json.elements.length} elements → ${polys.length} polys (cached ${(statSync(INLAND_CACHE).size / 1e6).toFixed(1)} MB)`,
  );
  return polys;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const t0 = performance.now();
  console.log(`· source: ${SOURCE} · spacing ${SPACING_M} m · corridors ${USE_CORRIDORS ? "on" : "off"}`);
  const sea = await loadWaterPolys();
  const inland = USE_INLAND ? await fetchInlandPolys() : [];
  const polys = [...sea, ...inland];
  console.log(`· polys: ${sea.length} sea + ${inland.length} inland`);
  const mask = buildMask(polys);
  console.log(`· water mask: ${mask.cols}×${mask.rows} @ ${MASK_CELL_M} m`);
  function isWater(lon: number, lat: number): boolean {
    const c = Math.floor((lon - BBOX.minLon) / mask.dLon);
    const r = Math.floor((lat - BBOX.minLat) / mask.dLat);
    if (c < 0 || c >= mask.cols || r < 0 || r >= mask.rows) return false;
    return mask.data[r * mask.cols + c] === 1;
  }
  // (leg/chord water checks use chordInWater, defined with the mask A* below.)
  // Pull a hand-drawn corridor vertex onto the nearest water cell (so rough
  // coordinates don't have to be pixel-perfect). Returns null if dry land
  // extends past the search radius.
  function snapToWater(lon: number, lat: number, maxRings = 9): LngLat | null {
    const c0 = Math.floor((lon - BBOX.minLon) / mask.dLon);
    const r0 = Math.floor((lat - BBOX.minLat) / mask.dLat);
    if (c0 >= 0 && c0 < mask.cols && r0 >= 0 && r0 < mask.rows && mask.data[r0 * mask.cols + c0] === 1)
      return [lon, lat];
    for (let ring = 1; ring <= maxRings; ring++) {
      for (let dr = -ring; dr <= ring; dr++)
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const cc = c0 + dc;
          const rr = r0 + dr;
          if (cc < 0 || cc >= mask.cols || rr < 0 || rr >= mask.rows) continue;
          if (mask.data[rr * mask.cols + cc] === 1)
            return [
              BBOX.minLon + (cc + 0.5) * mask.dLon,
              BBOX.minLat + (rr + 0.5) * mask.dLat,
            ];
        }
    }
    return null;
  }

  // --- fine A* over the water mask, so a corridor follows real water between
  //     its sparse via-points (bake-time only; not shipped). ---
  const maskN = mask.cols * mask.rows;
  const mGen = new Int32Array(maskN);
  const mClosed = new Int32Array(maskN);
  const mDist = new Float64Array(maskN);
  const mCame = new Int32Array(maskN);
  let mEpoch = 0;
  const cellCenter = (cell: number): LngLat => {
    const c = cell % mask.cols;
    const r = (cell - c) / mask.cols;
    return [BBOX.minLon + (c + 0.5) * mask.dLon, BBOX.minLat + (r + 0.5) * mask.dLat];
  };
  const snapCell = (lon: number, lat: number, maxRings = 14): number => {
    const c0 = Math.floor((lon - BBOX.minLon) / mask.dLon);
    const r0 = Math.floor((lat - BBOX.minLat) / mask.dLat);
    for (let ring = 0; ring <= maxRings; ring++)
      for (let dr = -ring; dr <= ring; dr++)
        for (let dc = -ring; dc <= ring; dc++) {
          if (ring > 0 && Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const cc = c0 + dc;
          const rr = r0 + dr;
          if (cc < 0 || cc >= mask.cols || rr < 0 || rr >= mask.rows) continue;
          if (mask.data[rr * mask.cols + cc] === 1) return rr * mask.cols + cc;
        }
    return -1;
  };
  function maskRoute(a: LngLat, b: LngLat, maxExpand = 2_500_000): LngLat[] | null {
    const s = snapCell(a[0], a[1]);
    const g = snapCell(b[0], b[1]);
    if (s < 0 || g < 0) return null;
    mEpoch++;
    const [gLon, gLat] = cellCenter(g);
    const heap = new FlatHeap();
    const sC = cellCenter(s);
    mGen[s] = mEpoch;
    mDist[s] = 0;
    mCame[s] = -1;
    heap.push(s, haversineMeters(sC[0], sC[1], gLon, gLat));
    let expanded = 0;
    while (heap.size > 0) {
      const u = heap.pop();
      if (u === g) break;
      if (mClosed[u] === mEpoch) continue;
      mClosed[u] = mEpoch;
      if (++expanded > maxExpand) return null;
      const uc = u % mask.cols;
      const ur = (u - uc) / mask.cols;
      const [uLon, uLat] = cellCenter(u);
      const ug = mDist[u];
      for (const [dc, dr] of MASK_NB8) {
        const cc = uc + dc;
        const rr = ur + dr;
        if (cc < 0 || cc >= mask.cols || rr < 0 || rr >= mask.rows) continue;
        const v = rr * mask.cols + cc;
        if (mask.data[v] !== 1) continue;
        // No diagonal corner-cutting: a diagonal step needs both orthogonal
        // cells to be water, else the straight chord clips a land corner.
        if (
          dc !== 0 &&
          dr !== 0 &&
          (mask.data[ur * mask.cols + cc] !== 1 || mask.data[rr * mask.cols + uc] !== 1)
        )
          continue;
        const [vLon, vLat] = cellCenter(v);
        const tentative = ug + haversineMeters(uLon, uLat, vLon, vLat);
        if (mGen[v] !== mEpoch || tentative < mDist[v]) {
          mGen[v] = mEpoch;
          mDist[v] = tentative;
          mCame[v] = u;
          heap.push(v, tentative + haversineMeters(vLon, vLat, gLon, gLat));
        }
      }
    }
    if (mGen[g] !== mEpoch) return null;
    const cells: number[] = [];
    for (let cur = g; cur !== -1; cur = mCame[cur]) cells.push(cur);
    cells.reverse();
    return cells.map(cellCenter);
  }
  // Densely sample a straight chord to confirm it stays in water.
  const chordInWater = (a: LngLat, b: LngLat): boolean => {
    const d = haversineMeters(a[0], a[1], b[0], b[1]);
    const steps = Math.max(3, Math.ceil(d / 30));
    for (let i = 1; i < steps; i++) {
      const f = i / steps;
      if (!isWater(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)) return false;
    }
    return true;
  };
  // Thin the fine path to ~stepM spacing, but never let a kept chord leave
  // water — so corridor edges don't clip corners on a bend.
  const simplify = (path: LngLat[], stepM: number): LngLat[] => {
    if (path.length < 2) return path;
    const out: LngLat[] = [path[0]];
    let anchor = 0;
    for (let i = 1; i < path.length; i++) {
      if (!chordInWater(path[anchor], path[i])) {
        const keep = i - 1 > anchor ? i - 1 : i;
        out.push(path[keep]);
        anchor = keep;
      } else if (
        haversineMeters(path[anchor][0], path[anchor][1], path[i][0], path[i][1]) >= stepM
      ) {
        out.push(path[i]);
        anchor = i;
      }
    }
    const last = path[path.length - 1];
    const tail = out[out.length - 1];
    if (tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
    return out;
  };

  // ---- 3. grid nodes ----
  const dLat = SPACING_M / 111320;
  const dLon = SPACING_M / (111320 * Math.cos((MID_LAT * Math.PI) / 180));
  const gCols = Math.floor((BBOX.maxLon - BBOX.minLon) / dLon) + 1;
  const gRows = Math.floor((BBOX.maxLat - BBOX.minLat) / dLat) + 1;

  const cellNode = new Int32Array(gCols * gRows).fill(-1);
  const coords: number[] = [];
  const adj: Map<number, number>[] = [];
  const addNode = (lon: number, lat: number): number => {
    const id = adj.length;
    coords.push(lon, lat);
    adj.push(new Map());
    return id;
  };
  const addEdge = (u: number, v: number, type: number): void => {
    if (u === v) return;
    const cur = adj[u].get(v);
    const merged = cur === 1 || type === 1 ? 1 : 0;
    adj[u].set(v, merged);
    adj[v].set(u, merged);
  };

  for (let r = 0; r < gRows; r++) {
    const lat = BBOX.minLat + r * dLat;
    for (let c = 0; c < gCols; c++) {
      const lon = BBOX.minLon + c * dLon;
      if (isWater(lon, lat)) cellNode[r * gCols + c] = addNode(lon, lat);
    }
    if (r % 80 === 0) console.log(`  grid row ${r}/${gRows} (${adj.length} water nodes)`);
  }
  const gridNodeCount = adj.length;

  // grid edges (8-connectivity; leg interior must stay water)
  const neigh: [number, number][] = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
  ];
  for (let r = 0; r < gRows; r++)
    for (let c = 0; c < gCols; c++) {
      const u = cellNode[r * gCols + c];
      if (u < 0) continue;
      const uLon = coords[2 * u],
        uLat = coords[2 * u + 1];
      for (const [dc, dr] of neigh) {
        const nc = c + dc,
          nr = r + dr;
        if (nc < 0 || nc >= gCols || nr < 0 || nr >= gRows) continue;
        const v = cellNode[nr * gCols + nc];
        if (v < 0) continue;
        if (chordInWater([uLon, uLat], [coords[2 * v], coords[2 * v + 1]])) addEdge(u, v, 0);
      }
    }
  const gridEdgePairs = adj.reduce((s, m) => s + m.size, 0) / 2;

  // ---- 4. corridors ----
  let corridorNodes = 0;
  let corridorOffWater = 0;
  interface Feat {
    properties: { name?: string };
    geometry: { type: string; coordinates: number[][] };
  }
  const fc = JSON.parse(readFileSync(CORRIDORS, "utf8")) as { features: Feat[] };
  if (USE_CORRIDORS) {
    const connectRadius = SPACING_M * 1.6;
    const gridCellOf = (lon: number, lat: number): [number, number] => [
      Math.round((lon - BBOX.minLon) / dLon),
      Math.round((lat - BBOX.minLat) / dLat),
    ];
    let corridorFallbacks = 0;
    for (const feat of fc.features) {
      if (feat.geometry.type !== "LineString") continue;
      const vias = feat.geometry.coordinates.map(
        (p) => snapToWater(p[0], p[1]) ?? ([p[0], p[1]] as LngLat),
      );
      // Route each leg over the fine mask so the corridor follows real water
      // (not a straight line that clips islands between the via-points).
      let fine: LngLat[] = [];
      for (let s = 0; s < vias.length - 1; s++) {
        const seg = maskRoute(vias[s], vias[s + 1]);
        if (!seg) corridorFallbacks++;
        const piece = seg ?? [vias[s], vias[s + 1]];
        fine = fine.concat(s > 0 ? piece.slice(1) : piece);
      }
      const line = simplify(fine, CORRIDOR_STEP_M);
      let prevNode = -1;
      for (const [lon, lat] of line) {
        const node = addNode(lon, lat);
        corridorNodes++;
        if (!isWater(lon, lat)) corridorOffWater++;
        if (prevNode >= 0) addEdge(prevNode, node, 1);
        prevNode = node;
        const [gc, gr] = gridCellOf(lon, lat);
        for (let rr = gr - 1; rr <= gr + 1; rr++)
          for (let cc = gc - 1; cc <= gc + 1; cc++) {
            if (cc < 0 || cc >= gCols || rr < 0 || rr >= gRows) continue;
            const gnode = cellNode[rr * gCols + cc];
            if (gnode < 0) continue;
            const gx = coords[2 * gnode];
            const gy = coords[2 * gnode + 1];
            // Only join to the grid where the connector itself stays in water.
            if (haversineMeters(lon, lat, gx, gy) <= connectRadius && chordInWater([lon, lat], [gx, gy]))
              addEdge(node, gnode, 0);
          }
      }
    }
    if (corridorFallbacks)
      console.log(`  corridor: ${corridorFallbacks} legs fell back to straight (mask route failed)`);
  }

  // ---- 5. assemble CSR + serialise ----
  const N = adj.length;
  let E = 0;
  for (const m of adj) E += m.size;
  const xadj = new Int32Array(N + 1);
  const adjArr = new Int32Array(E);
  const edgeType = new Uint8Array(E);
  let p = 0;
  for (let u = 0; u < N; u++) {
    xadj[u] = p;
    for (const [v, t] of adj[u]) {
      adjArr[p] = v;
      edgeType[p] = t;
      p++;
    }
  }
  xadj[N] = p;

  const graph: RoutingGraph = {
    nodeCount: N,
    edgeCount: E,
    coords: Float32Array.from(coords),
    xadj,
    adj: adjArr,
    edgeType,
    bbox: [BBOX.minLon, BBOX.minLat, BBOX.maxLon, BBOX.maxLat],
  };

  const buf = serializeGraph(graph);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, Buffer.from(buf));
  const gz = gzipSync(Buffer.from(buf), { level: 9 });

  // ---- 6. harness ----
  const loaded = deserializeGraph(buf);
  const index = buildNodeIndex(loaded, 0.01);

  function report(label: string, a: [number, number], b: [number, number]): void {
    const sIdx = nearestNode(loaded, index, a[0], a[1]);
    const gIdx = nearestNode(loaded, index, b[0], b[1]);
    if (sIdx < 0 || gIdx < 0) {
      console.log(`  ${label}: ✗ no water node near ${sIdx < 0 ? "start" : "goal"}`);
      return;
    }
    findRoute(loaded, sIdx, gIdx);
    let ms = 0;
    const RUNS = 5;
    let result = null as ReturnType<typeof findRoute>;
    for (let i = 0; i < RUNS; i++) {
      const t = performance.now();
      result = findRoute(loaded, sIdx, gIdx);
      ms += performance.now() - t;
    }
    ms /= RUNS;
    if (!result) {
      console.log(`  ${label}: ✗ no route found`);
      return;
    }
    let offWater = 0;
    for (let i = 1; i < result.coords.length; i++) {
      const [x1, y1] = result.coords[i - 1];
      const [x2, y2] = result.coords[i];
      const steps = Math.max(2, Math.ceil(haversineMeters(x1, y1, x2, y2) / 30));
      let bad = false;
      for (let k = 1; k < steps && !bad; k++) {
        const f = k / steps;
        if (!isWater(x1 + (x2 - x1) * f, y1 + (y2 - y1) * f)) bad = true;
      }
      if (bad) offWater++;
    }
    const straight = haversineMeters(a[0], a[1], b[0], b[1]);
    console.log(
      `  ${label}: ${result.coords.length} pts · ${(result.distanceM / 1852).toFixed(1)} nm ` +
        `(straight ${(straight / 1852).toFixed(1)}, ×${(result.distanceM / straight).toFixed(2)}) · ` +
        `${result.corridorLegs} corridor legs · expanded ${result.expanded} · ${ms.toFixed(1)} ms · ` +
        `off-water ${offWater}`,
    );
  }

  console.log("\n========== SJÖKORT GRAPH — PHASE A SPIKE ==========");
  console.log(`source:      ${SOURCE} (${SRC.crs})`);
  console.log(`grid:        ${gCols}×${gRows} cells, spacing ${SPACING_M} m`);
  console.log(`grid nodes:  ${gridNodeCount.toLocaleString()}`);
  console.log(`corridor:    ${corridorNodes} nodes (${corridorOffWater} off-water vertices)`);
  console.log(`TOTAL nodes: ${N.toLocaleString()}  (target ≤ ~150k)`);
  console.log(`edges:       ${E.toLocaleString()} directed (${gridEdgePairs.toLocaleString()} grid pairs)`);
  console.log(`artifact:    ${(buf.byteLength / 1e6).toFixed(2)} MB raw · ${(gz.byteLength / 1e6).toFixed(2)} MB gzip`);
  console.log(`bake time:   ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log("--- routes ---");
  report("Karlberg→Sandhamn", KARLBERG, SANDHAMN);
  report("open-water A→B   ", OPEN_A, OPEN_B);

  if (process.env.COMPONENTS) {
    const N = loaded.nodeCount;
    const comp = new Int32Array(N).fill(-1);
    const sizes: number[] = [];
    const stack: number[] = [];
    let c = 0;
    for (let s = 0; s < N; s++) {
      if (comp[s] !== -1) continue;
      comp[s] = c;
      let size = 0;
      stack.length = 0;
      stack.push(s);
      while (stack.length) {
        const u = stack.pop() as number;
        size++;
        for (let e = loaded.xadj[u]; e < loaded.xadj[u + 1]; e++) {
          const v = loaded.adj[e];
          if (comp[v] === -1) {
            comp[v] = c;
            stack.push(v);
          }
        }
      }
      sizes.push(size);
      c++;
    }
    const top = sizes
      .map((s, i) => [i, s] as [number, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
    console.log(`--- components: ${c} total; top ${top.map(([i, s]) => `#${i}:${s}`).join(", ")} ---`);
    const named: [string, [number, number]][] = [
      ["Karlberg", KARLBERG],
      ["Sandhamn", SANDHAMN],
      ["open-A (Trälhavet)", OPEN_A],
      ["open-B (Kanholm)", OPEN_B],
      ["Riddarfjärden", [18.055, 59.322]],
      ["Saltsjön", [18.085, 59.323]],
      ["Strömmen", [18.075, 59.325]],
      ["Vaxholm/Oxdjupet", [18.34, 59.4]],
      ["Lilla Värtan", [18.13, 59.35]],
    ];
    for (const [name, p] of named) {
      const idx = nearestNode(loaded, index, p[0], p[1]);
      console.log(
        `  ${name.padEnd(20)}: ${idx < 0 ? "(no node)" : `comp #${comp[idx]} (size ${sizes[comp[idx]]})`}`,
      );
    }
  }

  if (process.env.PROBE) {
    console.log("--- probes ---");
    const probes: [string, number, number, boolean][] = [
      ["open Baltic SE", 19.4, 59.1, true],
      ["Kanholmsfjärden", 18.75, 59.31, true],
      ["Trälhavet", 18.45, 59.42, true],
      ["Saltsjön (city)", 18.105, 59.325, true],
      ["Riddarfjärden (city)", 18.055, 59.322, true],
      ["forest NW (land)", 17.6, 59.7, false],
    ];
    for (const [name, lon, lat, expectWater] of probes) {
      const w = isWater(lon, lat);
      console.log(`  ${name}: ${w ? "water" : "land"} ${w === expectWater ? "✓" : "✗ WRONG"}`);
    }
    console.log("--- corridor vertices off-water ---");
    for (const feat of fc.features)
      feat.geometry.coordinates.forEach(([lon, lat], i) => {
        if (!isWater(lon, lat)) console.log(`  vtx ${i}: ${lon.toFixed(3)},${lat.toFixed(3)} → LAND`);
      });
  }
  console.log("===================================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
