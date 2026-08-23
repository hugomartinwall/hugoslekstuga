/**
 * A modelling DSL for authoring meshes in code.
 *
 * There is no 3D artist on this project (CLAUDE.md §2) — every mesh in the game
 * is a function. This file is the chisel. It has to be pleasant enough to
 * sculpt twelve bosses with, so it favours a fluent, chainable API over
 * anything clever.
 *
 * Representation is an editable polygon mesh (n-gons, not just triangles) so
 * that Catmull-Clark subdivision works properly. Triangulation happens once, at
 * `toGeometry()`.
 *
 * Everything here is deterministic: `noise()` takes a seed, and nothing calls
 * Math.random. The mesh regression check screenshots each generator at a fixed
 * camera, so a refactor in here cannot silently deform the roster.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type RGB = [number, number, number];

/* ------------------------------------------------------------------ vectors */

const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3): number => Math.sqrt(dot(a, a));
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0];
};

/**
 * Authored colours are picked by eye, which means they are sRGB. The renderer
 * works in linear space and gamma-encodes on output, so handing it sRGB values
 * directly makes everything wash out pale — which is exactly what the first
 * terrain pass looked like. Convert at the authoring/render boundary.
 */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Deterministic PRNG and value noise now live in src/sim/math/noise.ts (the
 * sim owns world ground truth and may not import render — so the shared pure
 * math lives on the sim side). Re-exported here so mesh generators keep their
 * one-stop import. Values are identical; the mesh manifest proves it.
 */
import { valueNoise } from "../../sim/math/noise";
export { mulberry32 as rng, valueNoise } from "../../sim/math/noise";

/* --------------------------------------------------------------------- Mesh */

/**
 * An editable polygon mesh. Faces are index lists of any length; quads survive
 * until triangulation so subdivision behaves.
 *
 * Methods mutate and return `this` — chain freely. Use `.clone()` when you need
 * a branch (e.g. before mirroring).
 */
export class Mesh {
  positions: Vec3[] = [];
  faces: number[][] = [];
  /** Per-face colour. Undefined entries fall back to `defaultColor`. */
  faceColors: (RGB | undefined)[] = [];
  defaultColor: RGB = [0.8, 0.8, 0.82];

  static empty(): Mesh {
    return new Mesh();
  }

  clone(): Mesh {
    const m = new Mesh();
    m.positions = this.positions.map((p) => [...p] as Vec3);
    m.faces = this.faces.map((f) => [...f]);
    m.faceColors = this.faceColors.map((c) => (c ? ([...c] as RGB) : undefined));
    m.defaultColor = [...this.defaultColor] as RGB;
    return m;
  }

  /** Append another mesh's geometry into this one. */
  merge(...others: Mesh[]): this {
    for (const o of others) {
      const offset = this.positions.length;
      for (const p of o.positions) this.positions.push([...p] as Vec3);
      o.faces.forEach((f, i) => {
        this.faces.push(f.map((idx) => idx + offset));
        this.faceColors.push(o.faceColors[i] ?? ([...o.defaultColor] as RGB));
      });
    }
    return this;
  }

  /* ----------------------------------------------------------- transforms */

  translate(x: number, y: number, z: number): this {
    for (const p of this.positions) {
      p[0] += x;
      p[1] += y;
      p[2] += z;
    }
    return this;
  }

  scaleBy(x: number, y = x, z = x): this {
    for (const p of this.positions) {
      p[0] *= x;
      p[1] *= y;
      p[2] *= z;
    }
    // A negative scale flips winding; keep normals outward.
    if (x * y * z < 0) this.flip();
    return this;
  }

  /** Euler rotation in radians, XYZ order. */
  rotate(x: number, y: number, z: number): this {
    const m = new Matrix4().makeRotationFromEuler(new Euler(x, y, z, "XYZ"));
    return this.applyMatrix(m);
  }

  applyMatrix(m: Matrix4): this {
    const v = new Vector3();
    for (const p of this.positions) {
      v.set(p[0], p[1], p[2]).applyMatrix4(m);
      p[0] = v.x;
      p[1] = v.y;
      p[2] = v.z;
    }
    return this;
  }

  /** Reverse face winding (and therefore normals). */
  flip(): this {
    for (const f of this.faces) f.reverse();
    return this;
  }

  /* ------------------------------------------------------------ deformers */

  /** Arbitrary per-vertex warp. The escape hatch for everything else. */
  warp(fn: (p: Vec3, i: number) => Vec3): this {
    this.positions = this.positions.map((p, i) => fn([...p] as Vec3, i));
    return this;
  }

  /**
   * Scale cross-sections along `axis` by `fn(t)`, where t is 0..1 across the
   * mesh's extent on that axis. The workhorse for limbs and torsos.
   */
  taper(axis: "x" | "y" | "z", fn: (t: number) => number): this {
    const ai = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const [lo, hi] = this.extent(ai);
    const span = hi - lo || 1;
    const [o0, o1] = [0, 1, 2].filter((i) => i !== ai) as [number, number];
    for (const p of this.positions) {
      const s = fn((p[ai] - lo) / span);
      p[o0] = p[o0]! * s;
      p[o1] = p[o1]! * s;
    }
    return this;
  }

  /** Bend around `axis` by `angle` radians across the mesh's extent. */
  bend(axis: "x" | "y" | "z", angle: number): this {
    const ai = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const [lo, hi] = this.extent(ai);
    const span = hi - lo || 1;
    // Bend in the plane of the two non-axis components.
    const a = (ai + 1) % 3;
    const b = (ai + 2) % 3;
    for (const p of this.positions) {
      const t = (p[ai] - lo) / span;
      const th = angle * t;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const pa = p[a]!;
      const pb = p[b]!;
      p[a] = pa * c - pb * s;
      p[b] = pa * s + pb * c;
    }
    return this;
  }

  /** Twist around `axis` by `angle` radians across the mesh's extent. */
  twist(axis: "x" | "y" | "z", angle: number): this {
    const ai = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const [lo, hi] = this.extent(ai);
    const span = hi - lo || 1;
    const a = (ai + 1) % 3;
    const b = (ai + 2) % 3;
    for (const p of this.positions) {
      const th = angle * ((p[ai] - lo) / span);
      const c = Math.cos(th);
      const s = Math.sin(th);
      const pa = p[a]!;
      const pb = p[b]!;
      p[a] = pa * c - pb * s;
      p[b] = pa * s + pb * c;
    }
    return this;
  }

  /** Displace vertices along their own direction from origin by value noise. */
  noise(amp: number, freq = 1, seed = 1): this {
    const n = valueNoise(seed);
    for (const p of this.positions) {
      const d = norm(p);
      const k = n([p[0] * freq, p[1] * freq, p[2] * freq]);
      p[0] += d[0] * k * amp;
      p[1] += d[1] * k * amp;
      p[2] += d[2] * k * amp;
    }
    return this;
  }

  /* ---------------------------------------------------------- topology ops */

  /**
   * Catmull-Clark subdivision. Turns blocky primitives into organic forms —
   * the single most useful operation in here for creature work.
   * Boundary edges use the crease rule so open meshes don't pinch shut.
   */
  subdivide(iterations = 1): this {
    for (let it = 0; it < iterations; it++) this.subdivideOnce();
    return this;
  }

  private subdivideOnce(): void {
    const P = this.positions;
    const F = this.faces;

    // Face points.
    const facePoints: Vec3[] = F.map((f) => {
      let s: Vec3 = [0, 0, 0];
      for (const i of f) s = add(s, P[i]!);
      return scale(s, 1 / f.length);
    });

    // Edge -> adjacent faces.
    const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeFaces = new Map<string, number[]>();
    F.forEach((f, fi) => {
      for (let i = 0; i < f.length; i++) {
        const k = edgeKey(f[i]!, f[(i + 1) % f.length]!);
        const arr = edgeFaces.get(k);
        if (arr) arr.push(fi);
        else edgeFaces.set(k, [fi]);
      }
    });

    // Edge points.
    const edgePoints = new Map<string, Vec3>();
    for (const [k, fs] of edgeFaces) {
      const [a, b] = k.split("_").map(Number) as [number, number];
      const mid = scale(add(P[a]!, P[b]!), 0.5);
      if (fs.length === 1) {
        edgePoints.set(k, mid); // boundary: plain midpoint
      } else {
        let s: Vec3 = add(P[a]!, P[b]!);
        for (const fi of fs) s = add(s, facePoints[fi]!);
        edgePoints.set(k, scale(s, 1 / (2 + fs.length)));
      }
    }

    // Updated original vertices.
    const vertFaces: number[][] = P.map(() => []);
    F.forEach((f, fi) => {
      for (const i of f) vertFaces[i]!.push(fi);
    });
    const vertEdges: string[][] = P.map(() => []);
    const boundaryVert = new Set<number>();
    for (const [k, fs] of edgeFaces) {
      const [a, b] = k.split("_").map(Number) as [number, number];
      vertEdges[a]!.push(k);
      vertEdges[b]!.push(k);
      if (fs.length === 1) {
        boundaryVert.add(a);
        boundaryVert.add(b);
      }
    }

    const newVerts: Vec3[] = P.map((p, i) => {
      if (boundaryVert.has(i)) {
        // Crease rule: average of the two boundary edge midpoints and P.
        let s: Vec3 = [0, 0, 0];
        let c = 0;
        for (const k of vertEdges[i]!) {
          if (edgeFaces.get(k)!.length !== 1) continue;
          const [a, b] = k.split("_").map(Number) as [number, number];
          s = add(s, scale(add(P[a]!, P[b]!), 0.5));
          c++;
        }
        return c === 2 ? scale(add(scale(p, 2), s), 0.25) : p;
      }
      const n = vertFaces[i]!.length;
      if (n === 0) return p;
      let fAvg: Vec3 = [0, 0, 0];
      for (const fi of vertFaces[i]!) fAvg = add(fAvg, facePoints[fi]!);
      fAvg = scale(fAvg, 1 / n);
      let rAvg: Vec3 = [0, 0, 0];
      for (const k of vertEdges[i]!) {
        const [a, b] = k.split("_").map(Number) as [number, number];
        rAvg = add(rAvg, scale(add(P[a]!, P[b]!), 0.5));
      }
      rAvg = scale(rAvg, 1 / vertEdges[i]!.length);
      return scale(add(add(fAvg, scale(rAvg, 2)), scale(p, n - 3)), 1 / n);
    });

    // Rebuild: each n-gon becomes n quads.
    const out: Vec3[] = [...newVerts];
    const facePointIndex = facePoints.map((fp) => out.push(fp) - 1);
    const edgePointIndex = new Map<string, number>();
    for (const [k, ep] of edgePoints) edgePointIndex.set(k, out.push(ep) - 1);

    const newFaces: number[][] = [];
    const newColors: (RGB | undefined)[] = [];
    F.forEach((f, fi) => {
      const col = this.faceColors[fi];
      for (let i = 0; i < f.length; i++) {
        const prev = f[(i - 1 + f.length) % f.length]!;
        const cur = f[i]!;
        const next = f[(i + 1) % f.length]!;
        newFaces.push([
          cur,
          edgePointIndex.get(edgeKey(cur, next))!,
          facePointIndex[fi]!,
          edgePointIndex.get(edgeKey(prev, cur))!,
        ]);
        newColors.push(col ? ([...col] as RGB) : undefined);
      }
    });

    this.positions = out;
    this.faces = newFaces;
    this.faceColors = newColors;
  }

  /** Laplacian smoothing — cheaper than subdivision, keeps the poly count. */
  smooth(iterations = 1, strength = 0.5): this {
    for (let it = 0; it < iterations; it++) {
      const neighbours: Set<number>[] = this.positions.map(() => new Set());
      for (const f of this.faces) {
        for (let i = 0; i < f.length; i++) {
          const a = f[i]!;
          const b = f[(i + 1) % f.length]!;
          neighbours[a]!.add(b);
          neighbours[b]!.add(a);
        }
      }
      this.positions = this.positions.map((p, i) => {
        const ns = neighbours[i]!;
        if (ns.size === 0) return p;
        let s: Vec3 = [0, 0, 0];
        for (const j of ns) s = add(s, this.positions[j]!);
        const avg = scale(s, 1 / ns.size);
        return add(p, scale(sub(avg, p), strength));
      });
    }
    return this;
  }

  /**
   * Mirror across a plane and weld. Creature symmetry in one call — build one
   * side, mirror, done.
   */
  mirror(axis: "x" | "y" | "z" = "x", weldEpsilon = 1e-4): this {
    const ai = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    const other = this.clone();
    for (const p of other.positions) p[ai] = -p[ai];
    other.flip();
    this.merge(other);
    // Welding alone leaves the seam wall behind as an interior face, so every
    // edge along it ends up touching four faces. Drop the doubled pair.
    return this.weld(weldEpsilon).dropDoubledFaces();
  }

  /**
   * Remove pairs of faces that occupy the same vertices — interior walls left
   * behind when two solids are welded together. Both faces in a pair go; a
   * face with no twin is untouched.
   */
  dropDoubledFaces(): this {
    const key = (f: number[]): string => [...f].sort((a, b) => a - b).join("_");
    const seen = new Map<string, number[]>();
    this.faces.forEach((f, i) => {
      const k = key(f);
      const arr = seen.get(k);
      if (arr) arr.push(i);
      else seen.set(k, [i]);
    });
    const drop = new Set<number>();
    for (const idxs of seen.values()) {
      if (idxs.length < 2) continue;
      // Drop in pairs so an odd count leaves one face standing.
      for (let i = 0; i + 1 < idxs.length; i += 2) {
        drop.add(idxs[i]!);
        drop.add(idxs[i + 1]!);
      }
    }
    if (drop.size === 0) return this;
    const faces: number[][] = [];
    const colors: (RGB | undefined)[] = [];
    this.faces.forEach((f, i) => {
      if (drop.has(i)) return;
      faces.push(f);
      colors.push(this.faceColors[i]);
    });
    this.faces = faces;
    this.faceColors = colors;
    return this;
  }

  /** Merge coincident vertices and drop degenerate faces. */
  weld(epsilon = 1e-4): this {
    const q = 1 / epsilon;
    const map = new Map<string, number>();
    const remap: number[] = [];
    const out: Vec3[] = [];
    this.positions.forEach((p) => {
      const k = `${Math.round(p[0] * q)}_${Math.round(p[1] * q)}_${Math.round(p[2] * q)}`;
      const hit = map.get(k);
      if (hit === undefined) {
        map.set(k, out.length);
        remap.push(out.length);
        out.push(p);
      } else {
        remap.push(hit);
      }
    });
    const faces: number[][] = [];
    const colors: (RGB | undefined)[] = [];
    this.faces.forEach((f, i) => {
      const nf: number[] = [];
      for (const idx of f) {
        const r = remap[idx]!;
        if (nf[nf.length - 1] !== r) nf.push(r);
      }
      if (nf.length > 2 && nf[0] !== nf[nf.length - 1]) {
        faces.push(nf);
        colors.push(this.faceColors[i]);
      } else if (nf.length > 3) {
        nf.pop();
        faces.push(nf);
        colors.push(this.faceColors[i]);
      }
    });
    this.positions = out;
    this.faces = faces;
    this.faceColors = colors;
    return this;
  }

  /* --------------------------------------------------------------- colour */

  /** Paint every face by a function of its centroid. */
  paint(fn: (centroid: Vec3, faceIndex: number) => RGB): this {
    this.faceColors = this.faces.map((f, i) => {
      let s: Vec3 = [0, 0, 0];
      for (const idx of f) s = add(s, this.positions[idx]!);
      return fn(scale(s, 1 / f.length), i);
    });
    return this;
  }

  /** Flat colour for the whole mesh. */
  color(c: RGB): this {
    this.defaultColor = [...c] as RGB;
    this.faceColors = this.faces.map(() => [...c] as RGB);
    return this;
  }

  /* ---------------------------------------------------------------- utils */

  extent(axisIndex: number): [number, number] {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of this.positions) {
      const v = p[axisIndex]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return Number.isFinite(lo) ? [lo, hi] : [0, 0];
  }

  bounds(): { min: Vec3; max: Vec3; size: Vec3 } {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of this.positions) {
      for (let i = 0; i < 3; i++) {
        if (p[i]! < min[i]!) min[i] = p[i]!;
        if (p[i]! > max[i]!) max[i] = p[i]!;
      }
    }
    if (!Number.isFinite(min[0])) return { min: v3(), max: v3(), size: v3() };
    return { min, max, size: sub(max, min) };
  }

  /** Triangle count after triangulation — the number that matters for budget. */
  triangleCount(): number {
    return this.faces.reduce((n, f) => n + Math.max(0, f.length - 2), 0);
  }

  /* ------------------------------------------------------------- to three */

  /**
   * Build a BufferGeometry.
   *
   * `flat` (default) duplicates vertices per face and uses face normals — the
   * faceted low-poly look, and the only mode where per-face colour works.
   * `flat: false` averages normals for smooth organic surfaces.
   */
  toGeometry(opts: { flat?: boolean } = {}): BufferGeometry {
    const flat = opts.flat ?? true;
    const geo = new BufferGeometry();
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];

    if (flat) {
      this.faces.forEach((f, fi) => {
        const c = this.faceColors[fi] ?? this.defaultColor;
        // Newell's method: a stable normal for non-planar n-gons.
        let n: Vec3 = [0, 0, 0];
        for (let i = 0; i < f.length; i++) {
          const a = this.positions[f[i]!]!;
          const b = this.positions[f[(i + 1) % f.length]!]!;
          n[0] += (a[1] - b[1]) * (a[2] + b[2]);
          n[1] += (a[2] - b[2]) * (a[0] + b[0]);
          n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        }
        n = norm(n);
        for (let i = 1; i < f.length - 1; i++) {
          for (const idx of [f[0]!, f[i]!, f[i + 1]!]) {
            const p = this.positions[idx]!;
            pos.push(p[0], p[1], p[2]);
            nrm.push(n[0], n[1], n[2]);
            col.push(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
          }
        }
      });
    } else {
      // Smooth: accumulate area-weighted normals per original vertex.
      const acc: Vec3[] = this.positions.map(() => [0, 0, 0]);
      for (const f of this.faces) {
        const a = this.positions[f[0]!]!;
        const b = this.positions[f[1]!]!;
        const c = this.positions[f[2]!]!;
        const fn = cross(sub(b, a), sub(c, a));
        for (const idx of f) acc[idx] = add(acc[idx]!, fn);
      }
      const vn = acc.map(norm);
      this.faces.forEach((f, fi) => {
        const c = this.faceColors[fi] ?? this.defaultColor;
        for (let i = 1; i < f.length - 1; i++) {
          for (const idx of [f[0]!, f[i]!, f[i + 1]!]) {
            const p = this.positions[idx]!;
            const n = vn[idx]!;
            pos.push(p[0], p[1], p[2]);
            nrm.push(n[0], n[1], n[2]);
            col.push(srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]));
          }
        }
      });
    }

    geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(nrm), 3));
    geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
    geo.computeBoundingSphere();
    return geo;
  }
}

/* --------------------------------------------------------------- primitives */

export function box(w = 1, h = 1, d = 1): Mesh {
  const m = new Mesh();
  const [x, y, z] = [w / 2, h / 2, d / 2];
  m.positions = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
  ];
  m.faces = [
    [0, 3, 2, 1], // -z
    [4, 5, 6, 7], // +z
    [0, 1, 5, 4], // -y
    [3, 7, 6, 2], // +y
    [0, 4, 7, 3], // -x
    [1, 2, 6, 5], // +x
  ];
  m.faceColors = m.faces.map(() => undefined);
  return m;
}

/** A quad-sphere: box + subdivision. Rounder topology than a UV sphere. */
export function sphere(radius = 0.5, subdiv = 2): Mesh {
  const m = box(1, 1, 1).subdivide(subdiv);
  for (const p of m.positions) {
    const n = norm(p);
    p[0] = n[0] * radius;
    p[1] = n[1] * radius;
    p[2] = n[2] * radius;
  }
  return m;
}

/**
 * A horizontal ring of `sides` points at height `y`.
 *
 * Winding convention: clockwise in XZ (note the -sin). With rings stacked along
 * +Y, this is the handedness `loft` needs to produce outward-facing normals.
 * Get this backwards and the solid is inside-out — invisible under backface
 * culling and maddening to debug by eye, which is why the DSL test checks
 * signed volume on every primitive.
 */
export function circleRing(radius: number, y: number, sides: number): Vec3[] {
  const ring: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([Math.cos(a) * radius, y, -Math.sin(a) * radius]);
  }
  return ring;
}

export function cylinder(radius = 0.5, height = 1, sides = 12, capped = true): Mesh {
  const rings = [
    circleRing(radius, -height / 2, sides),
    circleRing(radius, height / 2, sides),
  ];
  return loft(rings, { capStart: capped, capEnd: capped, closed: true });
}

export function cone(radius = 0.5, height = 1, sides = 12): Mesh {
  const m = new Mesh();
  for (const p of circleRing(radius, 0, sides)) m.positions.push(p);
  const apex = m.positions.push([0, height, 0]) - 1;
  const base = m.positions.push([0, 0, 0]) - 1;
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    m.faces.push([i, j, apex]);
    m.faces.push([j, i, base]);
  }
  m.faceColors = m.faces.map(() => undefined);
  return m;
}

export function plane(w = 1, d = 1, segsX = 1, segsZ = 1): Mesh {
  const m = new Mesh();
  for (let z = 0; z <= segsZ; z++) {
    for (let x = 0; x <= segsX; x++) {
      m.positions.push([(x / segsX - 0.5) * w, 0, (z / segsZ - 0.5) * d]);
    }
  }
  const idx = (x: number, z: number): number => z * (segsX + 1) + x;
  for (let z = 0; z < segsZ; z++) {
    for (let x = 0; x < segsX; x++) {
      m.faces.push([idx(x, z), idx(x, z + 1), idx(x + 1, z + 1), idx(x + 1, z)]);
    }
  }
  m.faceColors = m.faces.map(() => undefined);
  return m;
}

/* ----------------------------------------------------------------- builders */

/**
 * Revolve a 2D profile around the Y axis. Profile points are [radius, height].
 * Good for pots, pillars, helmets, shoulders, anything turned.
 */
export function lathe(profile: Vec2[], segments = 12): Mesh {
  const rings = profile.map(([r, y]) => circleRing(r, y, segments));
  const startDegenerate = Math.abs(profile[0]![0]) < 1e-6;
  const endDegenerate = Math.abs(profile[profile.length - 1]![0]) < 1e-6;
  const m = loft(rings, {
    closed: true,
    capStart: !startDegenerate,
    capEnd: !endDegenerate,
  });
  return m.weld();
}

/**
 * Connect a sequence of rings with quads. The core of every limb, tail, neck,
 * horn and torso in the game.
 *
 * Rings must have equal length. `closed` connects the last vertex of each ring
 * back to the first (a tube); leave it false for open sheets.
 */
export function loft(
  rings: Vec3[][],
  opts: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {},
): Mesh {
  const closed = opts.closed ?? true;
  const m = new Mesh();
  if (rings.length < 2) return m;
  const n = rings[0]!.length;
  for (const r of rings) {
    if (r.length !== n) throw new Error(`loft: ring length mismatch (${r.length} vs ${n})`);
    for (const p of r) m.positions.push([...p] as Vec3);
  }
  const lim = closed ? n : n - 1;
  for (let s = 0; s < rings.length - 1; s++) {
    for (let i = 0; i < lim; i++) {
      const j = (i + 1) % n;
      const a = s * n + i;
      const b = s * n + j;
      const c = (s + 1) * n + j;
      const d = (s + 1) * n + i;
      m.faces.push([a, b, c, d]);
    }
  }
  if (opts.capStart && closed) {
    m.faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
  }
  if (opts.capEnd && closed) {
    const base = (rings.length - 1) * n;
    m.faces.push(Array.from({ length: n }, (_, i) => base + i));
  }
  m.faceColors = m.faces.map(() => undefined);
  return m;
}

/**
 * Sweep a circular cross-section along a path with per-point radii.
 * Uses parallel transport so the tube doesn't spin unpredictably at bends —
 * this is what makes tails and horns behave.
 */
export function tube(
  path: Vec3[],
  radii: number | number[],
  sides = 8,
  opts: { capStart?: boolean; capEnd?: boolean } = {},
): Mesh {
  if (path.length < 2) return new Mesh();
  const r = (i: number): number => (typeof radii === "number" ? radii : radii[i] ?? 0);

  // Tangents.
  const tangents: Vec3[] = path.map((_, i) => {
    if (i === 0) return norm(sub(path[1]!, path[0]!));
    if (i === path.length - 1) return norm(sub(path[i]!, path[i - 1]!));
    return norm(sub(path[i + 1]!, path[i - 1]!));
  });

  // Parallel-transport an initial normal along the path so the tube doesn't
  // spin unpredictably through bends.
  const ref: Vec3 = Math.abs(dot(tangents[0]!, [0, 1, 0])) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let nrm = norm(cross(ref, tangents[0]!));
  const rings: Vec3[][] = [];
  for (let i = 0; i < path.length; i++) {
    if (i > 0) {
      // Rotate the previous normal by the tangent-to-tangent rotation.
      const t0 = tangents[i - 1]!;
      const t1 = tangents[i]!;
      const axis = cross(t0, t1);
      const al = len(axis);
      if (al > 1e-8) {
        const angle = Math.atan2(al, dot(t0, t1));
        const q = new Quaternion().setFromAxisAngle(
          new Vector3(...norm(axis)),
          angle,
        );
        const v = new Vector3(...nrm).applyQuaternion(q);
        nrm = norm([v.x, v.y, v.z]);
      }
    }
    const bi = norm(cross(tangents[i]!, nrm));
    const ring: Vec3[] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const c = Math.cos(a) * r(i);
      const d = Math.sin(a) * r(i);
      ring.push([
        path[i]![0] + nrm[0] * c + bi[0] * d,
        path[i]![1] + nrm[1] * c + bi[1] * d,
        path[i]![2] + nrm[2] * c + bi[2] * d,
      ]);
    }
    rings.push(ring);
  }
  return loft(rings, {
    closed: true,
    capStart: opts.capStart ?? true,
    capEnd: opts.capEnd ?? true,
  });
}

/** Extrude a flat polygon (in XZ) upward into a prism. */
export function extrude(polygonXZ: Vec2[], height: number): Mesh {
  const bottom: Vec3[] = polygonXZ.map(([x, z]) => [x, 0, z]);
  const top: Vec3[] = polygonXZ.map(([x, z]) => [x, height, z]);
  return loft([bottom, top], { closed: true, capStart: true, capEnd: true });
}

/* --------------------------------------------------------------- utilities */

/** Sample a smooth path through control points (Catmull-Rom). For tubes. */
export function spline(points: Vec3[], samples = 24): Vec3[] {
  if (points.length < 2) return points.map((p) => [...p] as Vec3);
  const pt = (i: number): Vec3 => points[Math.max(0, Math.min(points.length - 1, i))]!;
  const out: Vec3[] = [];
  const segs = points.length - 1;
  for (let s = 0; s < samples; s++) {
    const u = (s / (samples - 1)) * segs;
    const i = Math.min(segs - 1, Math.floor(u));
    const t = u - i;
    const p0 = pt(i - 1);
    const p1 = pt(i);
    const p2 = pt(i + 1);
    const p3 = pt(i + 2);
    const t2 = t * t;
    const t3 = t2 * t;
    out.push([0, 1, 2].map((k) =>
      0.5 *
      ((2 * p1[k]!) +
        (-p0[k]! + p2[k]!) * t +
        (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * t2 +
        (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * t3),
    ) as Vec3);
  }
  return out;
}
