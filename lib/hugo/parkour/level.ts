/**
 * Hugo's parkour — the authored world. "Closing time at the arcade."
 *
 * Screen 0 is the live homepage (swarm orbs + wordmark letters); past
 * its right edge the arcade's back rooms continue for ~5 screens:
 *
 *   1. behind the marquee   — girders and tight gaps, teaches the rhythm
 *   2. the cabinet graveyard — retired tools stacked as a climbing wall
 *   3. the vents             — fan pits and a lifting grate
 *   4. the service ducts     — piston platforms over the lava trench
 *   5. the neon rooftop      — signage-letter jumps, the earned finale
 *
 * and at the end: NEXT LEVEL.
 *
 * AUTHORING RULES (measured empirically by scripts/playtest-parkour.ts
 * against lib/hugo/parkour/physics.ts — re-run it after any physics
 * change. Deaths restart the whole run, so every jump must be readable
 * and fair):
 *   - jump apex ............. 126px  → max step-up 110px
 *   - single running jump ... clears 156px → max single gap 140px
 *   - best double jump ...... clears 288px → max double gap 245px (use once)
 *
 * Units: `x` is px past screen 0's right edge; `yUp` is px above the
 * floor line (positive up) and always names a platform TOP. buildLevel
 * bakes absolutes against the live viewport at run start.
 */

import type { Surface } from "./physics";
import type { ToolColor } from "@/lib/tools";

/** Total authored px past screen 0. */
export const LEVEL_LENGTH = 6500;
/** Sink this far into a pit hazard (lava, water) and the run is
 *  over — shallow enough that death reads as touching the hazard,
 *  not as falling off the world. */
export const KILL_DEPTH = 30;

type Span = { x: number; w: number };
type Ledge = { id: string; x: number; yUp: number; w: number };

export type LevelMechanic = "foot" | "moped";

/** An authored ramp (level-2 vocabulary): ascends left→right from a
 *  base top `yUp` to a lip at `yUp + rise`; `k` is the launch factor
 *  (see physics.ts RAMP_MIN_LAUNCH / RAMP_MAX_VY). */
export type RampSpec = {
  id: string;
  x: number;
  yUp: number;
  w: number;
  rise: number;
  k: number;
};

export type MoverSpec = {
  id: string;
  /** Patrol centre. */
  x: number;
  yUp: number;
  w: number;
  axis: "x" | "y";
  /** Peak-to-peak travel. */
  range: number;
  /** Steps per full cycle (60 = 1s). */
  period: number;
  /** Cycle offset, 0..1. */
  phase: number;
};

export type Deco =
  | { kind: "signback"; x: number; yUp: number }
  | { kind: "girderline"; x: number; yUp: number; w: number }
  | { kind: "deadcab"; x: number; yUp: number; cell: number; slug: string }
  | { kind: "fan"; x: number; yUp: number; r: number }
  | { kind: "duct"; x: number; w: number; yUp: number }
  | { kind: "skyline"; x: number; w: number }
  | { kind: "label"; x: number; yUp: number; text: string; color: ToolColor }
  // level-2 street dressing
  | { kind: "streetlight"; x: number; yUp: number }
  | { kind: "parkedcar"; x: number; yUp: number };

/** A pit hazard filling a gap between floor spans — derived, never
 *  authored (see deriveHazards). Both kinds kill on contact via the
 *  killY line; they differ only in what the painter makes of them. */
export type HazardSpan = { x: number; w: number; kind: "lava" | "water" };

/** Every gap between floor spans (plus the trailing gap to `end`) is
 *  a pit hazard: lava, unless a water zone claims it. Zones split
 *  gaps mid-span — a pit can drain from lava into water (the tunnel
 *  mouth in level 2 does). Derived at build time so re-authored
 *  floors can never leave an invisible pit behind. */
export function deriveHazards(
  spans: { x: number; w: number }[],
  start: number,
  end: number,
  waterZones: { x: number; w: number }[] = [],
): HazardSpan[] {
  const sorted = [...spans].sort((a, b) => a.x - b.x);
  const gaps: { x: number; w: number }[] = [];
  let edge = start;
  for (const s of sorted) {
    if (s.x > edge) gaps.push({ x: edge, w: s.x - edge });
    edge = Math.max(edge, s.x + s.w);
  }
  if (edge < end) gaps.push({ x: edge, w: end - edge });

  const out: HazardSpan[] = [];
  for (const g of gaps) {
    let x = g.x;
    const gEnd = g.x + g.w;
    const zones = waterZones
      .filter((z) => z.x < gEnd && z.x + z.w > g.x)
      .sort((a, b) => a.x - b.x);
    for (const z of zones) {
      const zEnd = Math.min(gEnd, z.x + z.w);
      const zStart = Math.max(x, z.x);
      if (zStart > x) out.push({ x, w: zStart - x, kind: "lava" });
      if (zEnd > zStart) out.push({ x: zStart, w: zEnd - zStart, kind: "water" });
      x = Math.max(x, zEnd);
    }
    if (x < gEnd) out.push({ x, w: gEnd - x, kind: "lava" });
  }
  return out;
}

/** A climbable stack of retired arcade cabinets: solid top + visuals. */
type CabinetStack = { id: string; x: number; yUp: number; stack: number; slugs: string[] };

const CAB_CELL = 5; // drawCabinet cell → 95×105px per cabinet

// ── Zone 1 · behind the marquee (0–1500) ──────────────────────────
// Three lava pits widening 120 → 128 → 133; girders overhead as
// flavour hops; a hanging cable-platform patrols over the last
// (widest) gap as an aid for the cautious.
// ── Zone 2 · the cabinet graveyard (1500–2620) ────────────────────
// The trench. Stacked dead cabinets climb 100px at a time, then a
// dolly patrols the long gap to the ledge. Missing it is the run.
// ── Zone 3 · the vents (2620–3740) ────────────────────────────────
// Fan pits on a tightening rhythm, then the grate lifts you to the
// ducts. The floor runs under the grate — missing it is safe.
// ── Zone 4 · the service ducts (3740–5100) ────────────────────────
// The last stretch of back-of-house: narrow duct ledges and two
// antiphase piston platforms over one long lava trench. Board the
// first piston, transfer at the crossover — there is no floor again
// until the credits.
// ── Zone 5 · the neon rooftop (5100–6500) ─────────────────────────
// Signage-letter platforms over the lava, then the one authored
// double-jump gap onto the final roof. NEXT LEVEL hums at the end.

/** Floor segments (tops at the floor line). The home floor
 *  [0, w+240] is added by buildLevel. Gaps between spans are pits. */
const FLOORS: Span[] = [
  { x: 360, w: 240 }, //  360–600   (gap 120 before)
  { x: 728, w: 252 }, //  728–980   (gap 128 before)
  { x: 1113, w: 667 }, // 1113–1780 (gap 133 before, cable aid above)
  { x: 2620, w: 440 }, // 2620–3060 (after the trench)
  { x: 3188, w: 142 }, // 3188–3330 (fan pit 128 before)
  { x: 3460, w: 280 }, // 3460–3740 (fan pit 130 before; runs under the grate)
];

/** Static platforms. */
const LEDGES: Ledge[] = [
  { id: "girder-a", x: 470, yUp: 96, w: 110 },
  { id: "girder-b", x: 640, yUp: 192, w: 100 },
  { id: "trench-out", x: 2470, yUp: 260, w: 150 },
  // the service ducts — see the piston movers for the middle stretch.
  // Mover hops are short (≤80px): you board and leave them from a
  // near-standstill, and a cold jump only carries ~85px.
  { id: "duct-in", x: 3740, yUp: 220, w: 140 },
  { id: "duct-a", x: 4010, yUp: 240, w: 90 },
  { id: "duct-b", x: 4230, yUp: 230, w: 80 },
  { id: "duct-out", x: 4620, yUp: 250, w: 120 },
  { id: "duct-exit", x: 4870, yUp: 260, w: 100 },
  // the rooftop
  { id: "roof-in", x: 5100, yUp: 280, w: 140 },
  { id: "sign-l", x: 5360, yUp: 330, w: 60 },
  { id: "sign-e", x: 5535, yUp: 300, w: 60 },
  { id: "sign-k", x: 5715, yUp: 350, w: 60 },
  { id: "roof-final", x: 6000, yUp: 260, w: 500 },
];

/** The graveyard climbing wall — solid tops AND cabinet visuals. */
const CABINETS: CabinetStack[] = [
  { id: "cab-1", x: 1850, yUp: 100, stack: 1, slugs: ["qr"] },
  { id: "cab-2", x: 1990, yUp: 200, stack: 2, slugs: ["diff", "case"] },
  { id: "cab-3", x: 2140, yUp: 300, stack: 3, slugs: ["pdf", "convert", "read"] },
];

const MOVERS: MoverSpec[] = [
  // Hanging cable platform over zone 1's widest gap.
  { id: "cable", x: 1047, yUp: 130, w: 70, axis: "y", range: 150, period: 260, phase: 0.25 },
  // The graveyard dolly — the only way across the trench.
  { id: "dolly", x: 2350, yUp: 300, w: 78, axis: "x", range: 160, period: 330, phase: 0 },
  // The vent grate — lifts from the floor up to the service ducts.
  // Patrols low (easy hop on) with just enough dwell to board.
  { id: "grate", x: 3660, yUp: 160, w: 80, axis: "y", range: 240, period: 420, phase: 0.5 },
  // The duct pistons — antiphase pair over the lava trench. Ride one
  // up, cross to the other as they trade places.
  { id: "piston-a", x: 4390, yUp: 230, w: 70, axis: "y", range: 120, period: 240, phase: 0 },
  { id: "piston-b", x: 4520, yUp: 230, w: 70, axis: "y", range: 120, period: 240, phase: 0.5 },
];

const DECOS: Deco[] = [
  { kind: "signback", x: 180, yUp: 330 },
  { kind: "girderline", x: 60, yUp: 300, w: 1100 },
  { kind: "girderline", x: 60, yUp: 420, w: 1100 },
  { kind: "label", x: 470, yUp: 150, text: "STAFF ONLY", color: "orange" },
  { kind: "deadcab", x: 1930, yUp: -30, cell: 4, slug: "typing" },
  { kind: "deadcab", x: 2075, yUp: -44, cell: 4, slug: "stretch" },
  { kind: "label", x: 1700, yUp: 190, text: "RETIRED", color: "purple" },
  // The vent fans sit half-sunk in their lava pits now — raised so
  // the blades still read over the glow.
  { kind: "duct", x: 2620, w: 2510, yUp: 430 },
  { kind: "fan", x: 3124, yUp: 10, r: 44 },
  { kind: "fan", x: 3395, yUp: 10, r: 44 },
  { kind: "label", x: 3200, yUp: 120, text: "MIND THE FANS", color: "blue" },
  { kind: "label", x: 4400, yUp: 180, text: "SERVICE", color: "purple" },
  { kind: "skyline", x: 5150, w: 1350 },
];

/** Everything baked to absolute world coordinates for one run. */
export type Level = {
  worldW: number;
  killY: number;
  /** Which step function drives the player. */
  mechanic: LevelMechanic;
  /** Where a run of this level begins (and respawns). */
  spawn: { x: number; y: number };
  /** True only for level 1: the live homepage is the first screen
   *  (swarm orbs + wordmark letters as terrain, camera latched,
   *  crossfade handover). Levels without it are fully authored and
   *  never touch the DOM. */
  homeScreen: boolean;
  /** Static standables in landing-priority order (after orbs+letters). */
  surfaces: Surface[];
  movers: (MoverSpec & { baseX: number; baseY: number })[];
  ramps: (RampSpec & { wx: number; baseY: number })[];
  decos: (Deco & { wx: number; wy: number })[];
  cabinets: (CabinetStack & { wx: number; topY: number })[];
  goal: {
    x: number;
    y: number;
    w: number;
    h: number;
    /** Monument copy: the big word and the small word beneath. */
    big: string;
    small: string;
    color: ToolColor;
    /** True = touching it wins the game; false = it advances a level. */
    final: boolean;
  };
  floorY: number;
  /** Baked floor spans for terrain drawing. */
  floorSpans: { x: number; w: number }[];
  /** Pit hazards filling every floor gap — derived, see deriveHazards. */
  hazards: HazardSpan[];
};

export function buildLevel(w: number, floorY: number): Level {
  const x0 = w; // authored origin = screen 0's right edge
  const surfaces: Surface[] = [];
  const floorSpans: { x: number; w: number }[] = [];

  // The homepage floor, continuing a step past the edge.
  floorSpans.push({ x: 0, w: w + 240 });
  for (const f of FLOORS) floorSpans.push({ x: x0 + f.x, w: f.w });
  for (const f of floorSpans) {
    surfaces.push({ kind: "rect", id: `floor:${f.x}`, x: f.x, y: floorY, w: f.w });
  }

  for (const l of LEDGES) {
    surfaces.push({ kind: "rect", id: l.id, x: x0 + l.x, y: floorY - l.yUp, w: l.w });
  }

  const cabinets = CABINETS.map((c) => {
    const cw = 19 * CAB_CELL;
    const wx = x0 + c.x;
    const topY = floorY - c.yUp;
    surfaces.push({ kind: "rect", id: c.id, x: wx - cw / 2, y: topY, w: cw });
    return { ...c, wx, topY };
  });

  const movers = MOVERS.map((m) => ({
    ...m,
    baseX: x0 + m.x,
    baseY: floorY - m.yUp,
  }));

  const decos = DECOS.map((d) => ({
    ...d,
    wx: x0 + d.x,
    wy: floorY - ("yUp" in d ? d.yUp : 0),
  }));

  // The goal monument — centred on the final roof. Magenta, like
  // another arcade machine pointing deeper in: touching it doesn't
  // win, it opens the city (level 2, "the ride home").
  const goal = {
    x: x0 + 6250 - 70,
    y: floorY - 260 - 96,
    w: 140,
    h: 96,
    big: "NEXT",
    small: "LEVEL",
    color: "pink" as ToolColor,
    final: false,
  };

  const worldW = w + LEVEL_LENGTH;
  return {
    worldW,
    killY: floorY + KILL_DEPTH,
    mechanic: "foot",
    // Spawn = where the corner Hugo lives; gravity does the intro.
    spawn: { x: 46, y: 46 },
    homeScreen: true,
    surfaces,
    movers,
    ramps: [],
    decos,
    cabinets,
    goal,
    floorY,
    floorSpans,
    // All lava here — the trailing gap makes the whole street under
    // the ducts and the rooftop one long lake, on purpose.
    hazards: deriveHazards(floorSpans, 0, worldW),
  };
}

/** Deterministic patrol position at a given simulation step — pure
 *  function of the step counter, so respawns replay identically. */
export function moverPos(
  m: Level["movers"][number],
  step: number,
): { x: number; y: number } {
  const t = Math.sin((step / m.period + m.phase) * Math.PI * 2);
  return {
    x: m.baseX + (m.axis === "x" ? (t * m.range) / 2 : 0),
    y: m.baseY + (m.axis === "y" ? (t * m.range) / 2 : 0),
  };
}

/** The movers as standable surfaces for this step, landing-priority
 *  before the static level (so landing on a mover over a pit wins). */
export function moverSurfaces(level: Level, step: number): Surface[] {
  return level.movers.map((m) => {
    const p = moverPos(m, step);
    return { kind: "rect", id: m.id, x: p.x - m.w / 2, y: p.y, w: m.w };
  });
}
