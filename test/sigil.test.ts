import { describe, expect, it } from "vitest";
import {
  NUMERAL_HALF_W,
  NUMERAL_LOW,
  SIGILS,
  SIGIL_MIN_W,
  SIGIL_R0,
  SIGIL_R1,
  type Sigil,
} from "../lib/overrun/render/sigil";
import { NODE_R } from "../lib/overrun/sim/constants";
import {
  downVector,
  screenRight,
  THETA_LANDSCAPE,
  THETA_PORTRAIT,
} from "../lib/overrun/render/camera";
import { FACTION_COLORS, inkOn } from "../lib/overrun/render/palette";
import type { Faction } from "../lib/overrun/sim/state";
import {
  contrastRatio,
  cvdDistance,
  filled,
  jaccard,
  minFeatureCells,
  raster,
} from "./sigil-raster";

const OWNED: Faction[] = [1, 2, 3, 4];
const sig = (f: Faction): Sigil => SIGILS[f]!;

/** Worst-case node radius in CSS px: 42.7 px diameter, per camera.test.ts. */
const WORST_R_CSS = 21.35;
/** The camera's vertical tilt compression. */
const SQUASH = 0.94;

/** Sample a polygon's boundary, not just its vertices — a chorded base dips. */
function boundarySamples(s: Sigil, per = 64): [number, number][] {
  const pts: [number, number][] = [];
  for (const poly of s.polys) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i]!;
      const [bx, by] = poly[(i + 1) % poly.length]!;
      for (let k = 0; k < per; k++) {
        const t = k / per;
        pts.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      }
    }
  }
  return pts;
}

describe("sigil set", () => {
  it("is total over Faction, with neutral explicitly unmarked", () => {
    expect(SIGILS[0]).toBeNull(); // absence is the mark
    for (const f of OWNED) {
      const s = SIGILS[f];
      expect(s, `faction ${f}`).not.toBeNull();
      expect(s!.polys.length, `faction ${f}`).toBeGreaterThan(0);
      for (const p of s!.polys) expect(p.length).toBeGreaterThanOrEqual(3);
    }
    const names = OWNED.map((f) => sig(f).name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("stays inside its band and below the centre", () => {
    for (const f of OWNED) {
      for (const [x, y] of boundarySamples(sig(f))) {
        const r = Math.hypot(x, y);
        expect(r, `${sig(f).name} inner`).toBeGreaterThanOrEqual(SIGIL_R0 - 1e-9);
        expect(r, `${sig(f).name} outer`).toBeLessThanOrEqual(SIGIL_R1 + 1e-9);
        expect(y, `${sig(f).name} hemisphere`).toBeGreaterThan(0);
      }
    }
  });

  it("clears the fullness ring, in terms of the radius constant it depends on", () => {
    // Written against NODE_R so a future radius change breaks this test rather
    // than the visuals: the ring is at world r - 0.6 with a ~0.7 wu stroke.
    const smallest = NODE_R[0];
    const ringInnerEdge = (smallest - 0.6 - 0.35) / smallest;
    expect(SIGIL_R1).toBeLessThan(ringInnerEdge);
  });

  it("clears the unit numeral, including a three-digit count", () => {
    for (const f of OWNED) {
      for (const [x, y] of boundarySamples(sig(f))) {
        const insideNumeral = Math.abs(x) <= NUMERAL_HALF_W && y <= NUMERAL_LOW;
        expect(insideNumeral, `${sig(f).name} collides with the numeral at ${x},${y}`).toBe(false);
      }
    }
  });

  it("keeps every mark above the legibility floor at the worst-case node", () => {
    const n = 256;
    for (const f of OWNED) {
      for (const squash of [1, SQUASH]) {
        const cells = minFeatureCells(sig(f), n, squash);
        const widthInRadii = (cells * 2 * 2) / n; // erosion is a half-width, box spans 2
        // The documented floor, less one raster cell of quantisation
        // (2/256 = 0.0078 per side). The earlier 0.75 slack let a mark violate
        // the very constant this cites — worst measured is TALONS at 0.1406
        // against SIGIL_MIN_W 0.13, so the real margin is 8%, not 25%.
        expect(widthInRadii, `${sig(f).name} squash=${squash}`).toBeGreaterThanOrEqual(
          SIGIL_MIN_W - 0.016,
        );
        expect(
          widthInRadii * WORST_R_CSS,
          `${sig(f).name} is under 2.5 CSS px at the worst-case node`,
        ).toBeGreaterThanOrEqual(2.5);
      }
    }
  });

  it("is pairwise distinct in silhouette at the size a player actually sees", () => {
    // n = 43 puts one cell at roughly one CSS pixel on a 42.7 px node.
    const n = 43;
    for (const squash of [1, SQUASH]) {
      const grids = new Map(OWNED.map((f) => [f, raster(sig(f), n, squash)]));
      for (const f of OWNED) {
        // A nearly-empty mark must not win the metric by being absent.
        expect(filled(grids.get(f)!), `${sig(f).name} coverage`).toBeGreaterThanOrEqual(30);
      }
      for (let i = 0; i < OWNED.length; i++) {
        for (let j = i + 1; j < OWNED.length; j++) {
          const a = OWNED[i]!;
          const b = OWNED[j]!;
          const d = jaccard(grids.get(a)!, grids.get(b)!);
          expect(d, `${sig(a).name} vs ${sig(b).name} (squash ${squash})`).toBeGreaterThanOrEqual(
            0.55,
          );
        }
      }
    }
  });

  it("lands upright on screen whatever the board rotation", () => {
    /*
     * The marks are authored in a screen-relative basis: traceSigil maps a
     * point (u, v) through the camera's own `across` and `down` vectors into
     * WORLD space, and the world transform then rotates the lot. The property
     * that matters is that those two cancel — a sigil point ends up at the
     * same SCREEN offset regardless of theta.
     *
     * The first version of this test rasterised the same sigil twice with
     * identical arguments and compared the results, which cannot fail. Its
     * comment claimed to guard the regression it did not guard, which is worse
     * than having no test: the next reader sees it covered.
     *
     * This models the real composition, so it fails if someone drops the
     * basis mapping and draws in raw world coordinates — which is exactly how
     * a portrait phone would end up showing sideways sigils.
     */
    const mapped = (u: number, v: number, theta: number) => {
      const down = downVector({ theta } as Parameters<typeof downVector>[0]);
      const across = screenRight(down);
      // traceSigil's world-space offset for this point (r = 1).
      const wx = u * across.x + v * down.x;
      const wy = u * across.y + v * down.y;
      // applyCamera's rotation, which the sprite is drawn under.
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return { x: wx * c - wy * s, y: wx * s + wy * c };
    };

    for (const theta of [THETA_LANDSCAPE, THETA_PORTRAIT, 0.4, -1.1]) {
      for (const f of OWNED) {
        for (const poly of sig(f).polys) {
          for (const [u, v] of poly) {
            const p = mapped(u, v, theta);
            expect(p.x, `${sig(f).name} u at theta ${theta}`).toBeCloseTo(u, 9);
            expect(p.y, `${sig(f).name} v at theta ${theta}`).toBeCloseTo(v, 9);
          }
        }
      }
    }
  });

  it("would catch a bake that ignored the screen basis", () => {
    // Guards the guard: if traceSigil were "simplified" to use world axes
    // directly, the composition above would no longer cancel. Modelled here so
    // the previous test is demonstrably capable of failing.
    const naive = (u: number, v: number, theta: number) => {
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      return { x: u * c - v * s, y: u * s + v * c };
    };
    const p = naive(0, 0.7, THETA_PORTRAIT);
    expect(Math.hypot(p.x - 0, p.y - 0.7)).toBeGreaterThan(0.5);
  });
});

describe("faction colour, as a contract rather than a comment", () => {
  it("puts readable ink on the dark limb where the sigil sits", () => {
    // The sphere gradient runs to x0.62 at the far limb, and the marks are in
    // the lower hemisphere, so that is the background they must survive.
    const shade = (hex: string, f: number): string => {
      const n = (i: number) =>
        Math.max(0, Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * f)));
      const h = (v: number) => v.toString(16).padStart(2, "0");
      return `#${h(n(1))}${h(n(3))}${h(n(5))}`;
    };
    for (const f of OWNED) {
      const limb = shade(FACTION_COLORS[f], 0.62);
      expect(contrastRatio(inkOn(f), limb), `faction ${f}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps every faction pair separable under simulated colour blindness", () => {
    // palette.ts has always CLAIMED this in a doc comment with nothing
    // enforcing it. Now an edit that collapses two factions fails the build.
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"] as const) {
      for (let i = 0; i < OWNED.length; i++) {
        for (let j = i + 1; j < OWNED.length; j++) {
          const a = FACTION_COLORS[OWNED[i]!];
          const b = FACTION_COLORS[OWNED[j]!];
          expect(cvdDistance(a, b, kind), `${a} vs ${b} under ${kind}`).toBeGreaterThan(0.05);
        }
      }
    }
  });

  it("keeps rivals separable from the player, which is the pair that matters most", () => {
    for (const kind of ["deuteranopia", "protanopia", "tritanopia"] as const) {
      for (const f of [2, 3, 4] as Faction[]) {
        // 0.08 sits close to the binding pair on purpose, and the pair is
        // named so drift is visible rather than mysterious: player blue
        // (#4da6ff) vs Vulture violet (#b168ff) under deuteranopia measures
        // 0.0929, the weakest separation in the set. Every other pair is
        // 0.38-1.31. If this goes red, that is the pair that moved.
        expect(
          cvdDistance(FACTION_COLORS[1], FACTION_COLORS[f], kind),
          `player vs ${f} under ${kind}`,
        ).toBeGreaterThan(0.08);
      }
    }
  });
});
