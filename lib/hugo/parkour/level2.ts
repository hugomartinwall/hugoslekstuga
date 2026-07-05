/**
 * Level 2 — "the ride home."
 *
 * NEXT LEVEL drops Hugo from the arcade rooftop to street level,
 * where his moped waits under a streetlight. He rides right through
 * the sleeping phosphor city:
 *
 *   1. the alley        — throttle tutorial, one kind gap, a dumpster
 *                         ramp that teaches ramp = speed→height
 *   2. the boulevard    — full-throttle canal gaps, neon overhead
 *   3. the construction — the anti-boulevard: brake early, tight
 *      site               scaffold landings, a girder lift
 *   4. the big ramp     — a kicker that demands near-max speed to
 *      + the highway      reach the elevated lane (too slow = the
 *                         safe lower lane and a retry ramp, costs
 *                         time not life), then shrinking rooftop hops
 *   5. the harbor       — a slow barge across the water, a
 *                         brake-then-burst pontoon, and the pier
 *                         where LIVE FOREVER hums over black water
 *
 * AUTHORING RULES — measured against stepMoped in physics.ts (deaths
 * restart this level; hard is fine, blind is not):
 *   - runway to full throttle .... 357px from rest (braking: 125px)
 *   - flat-jump reach ............ 117 @ vx3 · 174 @ 4.5 · 231 @ 6 ·
 *                                  285 @ 7.5 (+~45px to an 80px drop)
 *   - jump apex .................. 95px → max step-up 80px
 *   - k0.8 ramp carry @ full ..... ~220px (shallow float)
 *   - k1.5 kicker @ full ......... ~340px carry, apex ~104px above
 *                                  the lip; only ~200px at half
 *                                  throttle — kickers punish timidity
 *   - min platform width ......... 60px (7.5px/step sampling)
 *
 * Authoring space: x from world 0 (no screen 0 here — this level
 * never touches the DOM), yUp above the street line.
 */

import type { Surface } from "./physics";
import {
  KILL_DEPTH,
  type Deco,
  type Level,
  type MoverSpec,
  type RampSpec,
} from "./level";
import type { ToolColor } from "@/lib/tools";

export const LEVEL2_LENGTH = 8000;

type Span = { x: number; w: number };
type Ledge = { id: string; x: number; yUp: number; w: number };

/** Street segments; the gaps between them are canals, pits, water. */
const FLOORS2: Span[] = [
  { x: 0, w: 700 }, //    the alley runway (spawn at 60)
  { x: 790, w: 370 }, //  after the 90px teaching gap
  { x: 1330, w: 570 }, // dumpster-ramp landing → boulevard runway
  { x: 2150, w: 450 }, // canal 1 behind (250 @ full throttle)
  { x: 2860, w: 300 }, // canal 2 behind (260)
  { x: 3400, w: 500 }, // canal 3 behind (240) → brake for the site!
  { x: 4700, w: 760 }, // construction exit → big-ramp runway
  { x: 5600, w: 700 }, // the lower lane under the highway — ends in
  //                      water only the retry kicker crosses
  { x: 6650, w: 350 }, // harbor quay
  { x: 7420, w: 130 }, // the pontoon — land braking or swim
  { x: 7630, w: 370 }, // the pier: LIVE FOREVER
];

/** Scaffolds, highway lane, pontoons. */
const LEDGES2: Ledge[] = [
  // the construction site (pit below spans 3900–4700). scaf-a is
  // deliberately narrow: a full-boulevard-speed jump sails past it —
  // brake before the site or feed the pit. The rest is short-runway
  // precision: every scaffold gives just enough room to build the
  // speed its next gap needs, and no more.
  { id: "scaf-a", x: 3960, yUp: 60, w: 120 },
  { id: "scaf-b", x: 4160, yUp: 120, w: 150 },
  { id: "scaf-b2", x: 4420, yUp: 120, w: 120 },
  { id: "scaf-c", x: 4580, yUp: 60, w: 120 },
  // the elevated highway lane (street runs safely beneath)
  { id: "hwy-a", x: 5750, yUp: 140, w: 160 },
  { id: "hwy-b", x: 6060, yUp: 140, w: 140 },
  { id: "hwy-c", x: 6370, yUp: 140, w: 130 },
];

const RAMPS2: RampSpec[] = [
  // the dumpster (alley tutorial): shallow float over the first canal
  { id: "ramp-dumpster", x: 1040, yUp: 0, w: 100, rise: 40, k: 0.8 },
  // THE BIG ONE: near-max speed or you drop to the lower lane
  { id: "ramp-kicker", x: 5460, yUp: 0, w: 140, rise: 60, k: 1.5 },
  // the lower lane's own kicker over the harbor mouth — missing the
  // big one costs time, not the skill: this one needs full throttle
  // too, and the lane gives exactly enough runway to rebuild. Its
  // last 40px overhang the water like a jetty.
  { id: "ramp-retry", x: 6200, yUp: 0, w: 140, rise: 60, k: 1.5 },
];

const MOVERS2: MoverSpec[] = [
  // the night barge — wide, slow, the only way across the harbor
  { id: "barge", x: 7190, yUp: 0, w: 140, axis: "x", range: 220, period: 520, phase: 0.5 },
];

const DECOS2: Deco[] = [
  { kind: "skyline", x: 0, w: LEVEL2_LENGTH },
  { kind: "streetlight", x: 130, yUp: 0 },
  { kind: "parkedcar", x: 380, yUp: 0 },
  { kind: "streetlight", x: 620, yUp: 0 },
  { kind: "label", x: 1090, yUp: 130, text: "RAMP", color: "orange" },
  { kind: "parkedcar", x: 1500, yUp: 0 },
  { kind: "streetlight", x: 1760, yUp: 0 },
  { kind: "label", x: 2260, yUp: 240, text: "OPEN ALL NIGHT", color: "pink" },
  { kind: "water", x: 1900, yUp: 0, w: 250 },
  { kind: "water", x: 2600, yUp: 0, w: 260 },
  { kind: "water", x: 3160, yUp: 0, w: 240 },
  { kind: "streetlight", x: 3500, yUp: 0 },
  { kind: "label", x: 3700, yUp: 200, text: "SLOW", color: "tomato" },
  { kind: "label", x: 4300, yUp: 220, text: "BYGGE", color: "yellow" },
  { kind: "streetlight", x: 4900, yUp: 0 },
  { kind: "label", x: 5530, yUp: 170, text: "FULL GAS", color: "orange" },
  { kind: "streetlight", x: 6100, yUp: 0 },
  { kind: "label", x: 6800, yUp: 210, text: "HAMN", color: "blue" },
  { kind: "water", x: 6300, yUp: 0, w: 350 },
  { kind: "water", x: 7000, yUp: 0, w: 420 },
  { kind: "water", x: 7550, yUp: 0, w: 80 },
  { kind: "streetlight", x: 6700, yUp: 0 },
];

export function buildLevel2(w: number, floorY: number): Level {
  const surfaces: Surface[] = [];
  const floorSpans: { x: number; w: number }[] = [];

  // Ramps land before floors so touching a ramp's slope wins.
  const ramps = RAMPS2.map((r) => {
    surfaces.push({
      kind: "ramp",
      id: r.id,
      x: r.x,
      y: floorY - r.yUp,
      w: r.w,
      rise: r.rise,
      k: r.k,
    });
    return { ...r, wx: r.x, baseY: floorY - r.yUp };
  });

  for (const l of LEDGES2) {
    surfaces.push({ kind: "rect", id: l.id, x: l.x, y: floorY - l.yUp, w: l.w });
  }

  for (const f of FLOORS2) {
    floorSpans.push({ x: f.x, w: f.w });
    surfaces.push({ kind: "rect", id: `floor:${f.x}`, x: f.x, y: floorY, w: f.w });
  }

  const movers = MOVERS2.map((m) => ({
    ...m,
    baseX: m.x,
    baseY: floorY - m.yUp,
  }));

  const decos = DECOS2.map((d) => ({
    ...d,
    wx: d.x,
    wy: floorY - ("yUp" in d ? d.yUp : 0),
  }));

  // YOU'RE INVITED — at the end of the pier, over black water.
  const goal = {
    x: 7860 - 70,
    y: floorY - 96,
    w: 140,
    h: 96,
    big: "YOU'RE",
    small: "INVITED",
    color: "green" as ToolColor,
    final: true,
  };

  return {
    worldW: Math.max(LEVEL2_LENGTH, w),
    killY: floorY + KILL_DEPTH,
    mechanic: "moped",
    // The moped waits under the first streetlight; the beam sets
    // Hugo down onto the saddle.
    spawn: { x: 60, y: floorY - 60 },
    homeScreen: false,
    surfaces,
    movers,
    ramps,
    decos,
    cabinets: [],
    goal,
    floorY,
    floorSpans,
  };
}
