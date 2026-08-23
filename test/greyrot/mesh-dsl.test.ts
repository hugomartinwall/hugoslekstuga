import { describe, expect, it } from "vitest";
import {
  Mesh,
  box,
  cone,
  cylinder,
  lathe,
  loft,
  sphere,
  spline,
  tube,
  type Vec3,
} from "../../lib/greyrot/render/mesh/dsl";

/**
 * The mesh DSL is pure geometry — no GPU, no DOM — so unlike the renderer it is
 * worth testing. A topology bug here deforms every creature in the game and
 * would only be noticed by eye, late.
 */

/** Every edge in a closed manifold is shared by exactly two faces. */
function openEdges(m: Mesh): number {
  const count = new Map<string, number>();
  for (const f of m.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i]!;
      const b = f[(i + 1) % f.length]!;
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of count.values()) if (n !== 2) open++;
  return open;
}

/** Signed volume via the divergence theorem. Positive = outward winding. */
function signedVolume(m: Mesh): number {
  let v = 0;
  for (const f of m.faces) {
    for (let i = 1; i < f.length - 1; i++) {
      const a = m.positions[f[0]!]!;
      const b = m.positions[f[i]!]!;
      const c = m.positions[f[i + 1]!]!;
      v +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) -
          a[1] * (b[0] * c[2] - b[2] * c[0]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
    }
  }
  return v;
}

describe("primitives", () => {
  it("box is a closed manifold with outward winding", () => {
    const m = box(2, 2, 2);
    expect(m.positions).toHaveLength(8);
    expect(m.faces).toHaveLength(6);
    expect(m.triangleCount()).toBe(12);
    expect(openEdges(m)).toBe(0);
    expect(signedVolume(m)).toBeCloseTo(8, 5);
  });

  it("sphere puts every vertex on the radius", () => {
    const r = 1.5;
    const m = sphere(r, 2);
    for (const p of m.positions) {
      const d = Math.hypot(p[0], p[1], p[2]);
      expect(d).toBeCloseTo(r, 5);
    }
    expect(openEdges(m)).toBe(0);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });

  it("cylinder and cone are closed", () => {
    expect(openEdges(cylinder(0.5, 2, 10))).toBe(0);
    expect(openEdges(cone(0.5, 1, 10))).toBe(0);
    expect(signedVolume(cylinder(0.5, 2, 24))).toBeGreaterThan(0);
    expect(signedVolume(cone(0.5, 1, 24))).toBeGreaterThan(0);
  });
});

describe("builders", () => {
  it("loft rejects mismatched ring lengths", () => {
    const a: Vec3[] = [[0, 0, 0], [1, 0, 0]];
    const b: Vec3[] = [[0, 1, 0]];
    expect(() => loft([a, b])).toThrow(/ring length mismatch/);
  });

  it("tube along a straight path is closed and has volume", () => {
    const m = tube(
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
      ],
      0.3,
      8,
    );
    expect(openEdges(m)).toBe(0);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });

  it("tube follows a bent path without collapsing", () => {
    const path = spline(
      [
        [0, 0, 0],
        [1, 1, 0],
        [2, 1, 1],
        [3, 0, 2],
      ],
      20,
    );
    const m = tube(path, 0.2, 8);
    expect(openEdges(m)).toBe(0);
    // Every ring should keep roughly its radius — a broken transport frame
    // shows up as collapsed or exploded rings.
    const b = m.bounds();
    expect(b.size[0]).toBeGreaterThan(2.5);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });

  it("lathe closes a revolved profile", () => {
    const m = lathe(
      [
        [0, 0],
        [0.5, 0.2],
        [0.4, 0.8],
        [0, 1],
      ],
      12,
    );
    expect(openEdges(m)).toBe(0);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });
});

describe("topology operations", () => {
  it("subdivide turns each n-gon into n quads and stays closed", () => {
    const m = box(1, 1, 1);
    const before = m.faces.length;
    m.subdivide(1);
    expect(m.faces).toHaveLength(before * 4);
    expect(m.faces.every((f) => f.length === 4)).toBe(true);
    expect(openEdges(m)).toBe(0);
  });

  it("subdivide converges toward a limit surface and keeps winding", () => {
    // Catmull-Clark contracts hard on a cube — the corner rule sends (1,1,1)
    // to (5/9,5/9,5/9) on the first pass — so the meaningful property is not
    // "stays close to the original volume" but "converges": each iteration
    // must move the surface less than the one before it.
    const vols = [0, 1, 2, 3].map((n) => signedVolume(box(2, 2, 2).subdivide(n)));
    expect(vols.every((v) => v > 0)).toBe(true); // winding survives
    for (let i = 1; i < vols.length; i++) {
      expect(vols[i]!).toBeLessThan(vols[i - 1]!);
    }
    const deltas = vols.slice(1).map((v, i) => vols[i]! - v);
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]!).toBeLessThan(deltas[i - 1]!);
    }
    // And it converges to something, not to nothing.
    expect(vols[3]!).toBeGreaterThan(vols[0]! * 0.25);
  });

  it("mirror welds the seam instead of leaving a doubled wall", () => {
    // Half a box, open on the -x side.
    const half = box(1, 1, 1).translate(0.5, 0, 0);
    const mirrored = half.clone().mirror("x");
    expect(openEdges(mirrored)).toBe(0);
    expect(signedVolume(mirrored)).toBeCloseTo(2, 5);
  });

  it("weld collapses coincident vertices", () => {
    const m = box(1, 1, 1);
    m.merge(box(1, 1, 1));
    expect(m.positions).toHaveLength(16);
    m.weld();
    expect(m.positions).toHaveLength(8);
  });

  it("smooth does not tear topology", () => {
    const m = sphere(1, 2).smooth(3, 0.5);
    expect(openEdges(m)).toBe(0);
  });
});

describe("deformers", () => {
  it("taper scales cross-sections", () => {
    const m = cylinder(1, 2, 12).taper("y", (t) => 1 - 0.5 * t);
    const top = m.positions.filter((p) => p[1] > 0.9);
    const bottom = m.positions.filter((p) => p[1] < -0.9);
    const radius = (ps: Vec3[]): number =>
      Math.max(...ps.map((p) => Math.hypot(p[0], p[2])));
    expect(radius(top)).toBeLessThan(radius(bottom) * 0.75);
  });

  it("twist preserves the axis extent", () => {
    const m = cylinder(0.5, 2, 12);
    const before = m.extent(1);
    m.twist("y", Math.PI / 2);
    expect(m.extent(1)).toEqual(before);
  });

  it("noise is deterministic for a given seed", () => {
    const a = sphere(1, 2).noise(0.2, 2, 42).positions;
    const b = sphere(1, 2).noise(0.2, 2, 42).positions;
    const c = sphere(1, 2).noise(0.2, 2, 43).positions;
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});

describe("toGeometry", () => {
  it("emits matched, triangulated attribute buffers", () => {
    const m = sphere(1, 2);
    const g = m.toGeometry({ flat: true });
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    const col = g.getAttribute("color");
    expect(pos.count).toBe(m.triangleCount() * 3);
    expect(nrm.count).toBe(pos.count);
    expect(col.count).toBe(pos.count);
  });

  it("flat normals point outward on a convex solid", () => {
    const g = sphere(1, 2).toGeometry({ flat: true });
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      const d =
        pos.getX(i) * nrm.getX(i) + pos.getY(i) * nrm.getY(i) + pos.getZ(i) * nrm.getZ(i);
      expect(d).toBeGreaterThan(0);
    }
  });

  it("smooth normals are unit length", () => {
    const g = sphere(1, 2).toGeometry({ flat: false });
    const nrm = g.getAttribute("normal");
    for (let i = 0; i < nrm.count; i++) {
      const l = Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      expect(l).toBeCloseTo(1, 4);
    }
  });

  it("carries per-face colour through triangulation", () => {
    const m = box(1, 1, 1).paint((c) => (c[1] > 0 ? [1, 0, 0] : [0, 0, 1]));
    const col = m.toGeometry({ flat: true }).getAttribute("color");
    let red = 0;
    let blue = 0;
    for (let i = 0; i < col.count; i++) {
      if (col.getX(i) === 1) red++;
      if (col.getZ(i) === 1) blue++;
    }
    expect(red).toBeGreaterThan(0);
    expect(blue).toBeGreaterThan(0);
    expect(red + blue).toBe(col.count);
  });
});

describe("determinism", () => {
  it("the same generator produces byte-identical geometry twice", () => {
    const gen = (): Mesh =>
      sphere(1, 2).noise(0.15, 3, 7).taper("y", (t) => 1 - 0.3 * t).subdivide(1);
    const a = gen().toGeometry().getAttribute("position").array as Float32Array;
    const b = gen().toGeometry().getAttribute("position").array as Float32Array;
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
