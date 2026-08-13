import type { Faction } from "../sim/state";

/**
 * Faction sigils: the colour-independent half of faction identity.
 *
 * They no longer ride inside the balls — Hugo's call (2026-08-10): colour is
 * the ball's identity, the in-sphere mark read as noise. The sigils remain
 * the faction's shape-name everywhere else: the ticker badge (fx.ts
 * drawSigilBadge), the intro-card faction legend, the elimination death
 * mark, alongside the share bar's hatch textures. The accepted cost is that
 * the one near-metameric CVD pair (player blue vs Vulture violet under
 * deuteranopia, pinned in test/sigil.test.ts) has no per-ball fallback.
 *
 * Keyed ONLY on faction id. NOT on persona and NOT on tier: personas are cast
 * by slot per level (level.ts personasForLevel), so on L6 faction 2 plays
 * AMBER, and on L13 two differently-coloured factions run the identical
 * persona. `tier` marks the boss rival and changes board to board. A mark
 * keyed on either would change its colour-to-shape binding between levels,
 * which is precisely what this module exists to make stable.
 *
 * ── The in-ball geometry, kept as a guarded contract ─────────────────────
 * The band/clearance constants below and their tests describe the one
 * placement that FITS inside a node (numeral clearance, fullness-ring
 * daylight, dark-limb contrast). Nothing draws there today, but the tests
 * stay green and cost nothing — if the in-ball mark ever returns (e.g.
 * behind a colorblind setting), the geometry is still proven:
 *
 *  1. The radial budget there is ~5 CSS px at the worst-case 42.7 px node,
 *     but the TANGENTIAL budget across the lower hemisphere is ~30 px. So the
 *     marks vary in count, angle and spread — never in radial edge profile.
 *  2. The numeral's clearance is asymmetric. `textBaseline = "middle"` puts
 *     the digits at roughly y ∈ [-0.37r, +0.22r], so the LOWER extent is only
 *     ~0.22r — that asymmetry is why a bottom-hemisphere mark fits, and the
 *     dark limb there is what clears the 3:1 WCAG bar for the badge ink too.
 *
 * Polygons only, no curves: the Vulture's hook is a shear on a quad rather
 * than a bezier. At badge size nobody can tell, and it lets the test
 * rasterise with a 20-line even-odd scan instead of flattening beziers.
 *
 * Pure and DOM-free — vitest runs in node with no canvas, and every rule
 * above is asserted directly in test/sigil.test.ts.
 */

/** Inner radius of the mark band, in node radii. */
export const SIGIL_R0 = 0.6;
/**
 * Outer radius. Derived, not chosen: the fullness ring sits at world r - 0.6,
 * which on the smallest node (NODE_R[0] = 6.7) is 0.910r, and its stroke
 * reaches inward to about 0.858r. 0.84 leaves a hair of daylight.
 */
export const SIGIL_R1 = 0.84;
/** Minimum tangential width, in node radii — the legibility floor. */
export const SIGIL_MIN_W = 0.13;
/** Conservative model of how far the unit numeral reaches below centre. */
export const NUMERAL_LOW = 0.32;
/** Half-width of a three-digit numeral (a vault at cap), in node radii. */
export const NUMERAL_HALF_W = 0.72;

/**
 * One radial wedge. `phi` is measured from screen-down, positive toward
 * screen-right; widths are tangential half-widths in node radii; `shear`
 * displaces the outer edge tangentially, which is what makes a hook.
 */
export interface Wedge {
  phi: number;
  wIn: number;
  wOut: number;
  rIn?: number;
  rOut?: number;
  shear?: number;
}

export type Point = readonly [number, number];
export type Poly = readonly Point[];

export interface Sigil {
  readonly name: string;
  readonly wedges: readonly Wedge[];
  readonly polys: readonly Poly[];
}

const D = Math.PI / 180;

/** A wedge becomes one 4-vertex polygon in the (screen-right, screen-down) basis. */
function wedgePoly(w: Wedge): Poly {
  const rIn = w.rIn ?? SIGIL_R0;
  const shear = w.shear ?? 0;
  // Pull the outer edge in so its CORNERS land on the bound rather than its
  // midpoint: a flat chord at radius R1 has corners at hypot(R1, offset),
  // which pushed KEEL out to 0.8415 against a 0.84 ceiling and would have
  // crept toward the fullness ring.
  const rOutWanted = w.rOut ?? SIGIL_R1;
  const maxOff = Math.abs(shear) + w.wOut;
  const rOut = Math.sqrt(Math.max(0, rOutWanted * rOutWanted - maxOff * maxOff));
  // Radial unit vector at phi (from screen-down), and its tangent.
  const rx = Math.sin(w.phi);
  const ry = Math.cos(w.phi);
  const tx = Math.cos(w.phi);
  const ty = -Math.sin(w.phi);
  const at = (r: number, off: number): Point => [rx * r + tx * off, ry * r + ty * off];
  return [
    at(rIn, -w.wIn),
    at(rIn, w.wIn),
    at(rOut, shear + w.wOut),
    at(rOut, shear - w.wOut),
  ];
}

function buildSigil(name: string, wedges: readonly Wedge[]): Sigil {
  return Object.freeze({ name, wedges, polys: Object.freeze(wedges.map(wedgePoly)) });
}

/**
 * The set. Chosen for distinct SILHOUETTE CLASS rather than internal detail,
 * because at 42.7 px only the coarse reading survives:
 *
 *   YOU     one solid centred mass
 *   WARLORD two, close together, tapering to points, gap at bottom-centre
 *   BUILDER three, evenly spaced, parallel-sided
 *   VULTURE two, spread wide, hooked inward
 *
 * The pair worth worrying about is WARLORD vs VULTURE — both "two marks" — and
 * they separate on a 1.7x difference in spread (11 px vs 19 px apart at worst
 * case) plus the shear, which is a far stronger discriminator than any 3 px
 * edge profile would have been.
 *
 * Neutral gets nothing: absence is the mark, and it matches FACTION_NAMES[0]
 * already being "".
 */
export const SIGILS: Record<Faction, Sigil | null> = {
  0: null,
  1: buildSigil("KEEL", [{ phi: 0, wIn: 0.13, wOut: 0.26 }]),
  // Tucked in from ±26° to ±18°: FANGS and TALONS are the one pair that could
  // read alike (both "two marks"), and separating their SPREAD is what pulls
  // them apart — a 1.7x difference in how far apart the marks sit is far more
  // legible at 42 px than any difference in their edge profile would be.
  2: buildSigil("FANGS", [
    { phi: -18 * D, wIn: 0.14, wOut: 0.05 },
    { phi: 18 * D, wIn: 0.14, wOut: 0.05 },
  ]),
  3: buildSigil("COURSE", [
    { phi: -36 * D, wIn: 0.09, wOut: 0.09 },
    { phi: 0, wIn: 0.09, wOut: 0.09 },
    { phi: 36 * D, wIn: 0.09, wOut: 0.09 },
  ]),
  // Widened from the first pass: a skewed quad's PERPENDICULAR width is its
  // nominal width times cos(lean), so 0.085 at shear 0.26 measured only
  // 2.3 CSS px on a worst-case node despite looking wide enough on paper.
  // ±44° is also as far out as they can swing — past that the inner corner on
  // the far side drops into the three-digit numeral's box.
  4: buildSigil("TALONS", [
    { phi: -44 * D, wIn: 0.115, wOut: 0.115, shear: 0.2 },
    { phi: 44 * D, wIn: 0.115, wOut: 0.115, shear: -0.2 },
  ]),
};
