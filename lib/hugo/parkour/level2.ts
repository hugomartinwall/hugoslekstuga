/**
 * Level 2 — "the ride home."
 *
 * NEXT LEVEL drops Hugo from the arcade rooftop to street level,
 * where his moped waits under a streetlight. He rides right through
 * the sleeping phosphor city:
 *
 *   1. the alley        — throttle tutorial, one kind gap, a dumpster
 *                         ramp that teaches ramp = speed→height
 *   2. the boulevard    — full-throttle roadworks trenches (lava —
 *                         the crews dug deep), neon overhead
 *   3. the construction — the anti-boulevard: brake early, tight
 *      site               scaffold landings
 *   4. the big ramp     — a kicker that demands near-max speed to
 *      + the highway      reach the elevated lane (too slow = the
 *                         safe lower lane and a retry ramp, costs
 *                         time not life), then shrinking rooftop hops
 *   5. the tunnel       — a speed-discipline chicane (enter hot and
 *                         feed the lava), then FULL GAS into a tiered
 *                         kicker pair out over the harbor mouth
 *   6. the harbor       — a slow barge across the water, a
 *                         brake-then-burst pontoon, and the pier
 *                         where YOU'RE INVITED hums over black water
 *
 * AUTHORING RULES — measured empirically by scripts/playtest-parkour.ts
 * against stepMoped in physics.ts; re-run it after any physics change.
 * (Deaths restart this level; hard is fine, blind is not.)
 *   - runway to full throttle .... 357px from rest (brake 7.5→0: 124px)
 *   - flat-jump reach ............ 124 @ vx3 · 179 @ 4.5 · 235 @ 6 ·
 *     (up + throttle held)         278 @ 7.5 → max gap per tier
 *                                  100 / 150 / 205 / 250
 *   - jump apex .................. 95px → max step-up 80px
 *   - k0.8 ramp carry @ full ..... ~195px to the street (shallow float)
 *   - k1.0 ramp carry @ full ..... ~233px to the street, ~190px to a
 *                                  lip-height landing
 *   - k1.5 kicker @ full ......... ~330px carry to 60px below the lip;
 *                                  only ~107px at half throttle —
 *                                  kickers punish timidity
 *   - min platform width ......... 60px (7.5px/step sampling)
 *
 * Authoring space: x from world 0 (no screen 0 here — this level
 * never touches the DOM), yUp above the street line.
 */

import type { Surface } from "./physics";
import {
  deriveHazards,
  KILL_DEPTH,
  type Deco,
  type Level,
  type MoverSpec,
  type RampSpec,
} from "./level";
import type { ToolColor } from "@/lib/tools";

export const LEVEL2_LENGTH = 10600;

type Span = { x: number; w: number };
type Ledge = { id: string; x: number; yUp: number; w: number };

/** Street segments; the gaps between them are the pits — lava unless
 *  a WATER_ZONES entry claims them (the harbor). */
const FLOORS2: Span[] = [
  { x: 0, w: 700 }, //    the alley runway (spawn at 60)
  { x: 800, w: 360 }, //  after the 100px teaching gap
  { x: 1330, w: 570 }, // dumpster-ramp landing → boulevard runway
  { x: 2145, w: 455 }, // trench 1 behind (245 @ full throttle)
  { x: 2850, w: 310 }, // trench 2 behind (250)
  { x: 3400, w: 500 }, // trench 3 behind (240) → brake for the site!
  { x: 4700, w: 760 }, // construction exit → big-ramp runway
  { x: 5600, w: 700 }, // the lower lane under the highway — ends in
  //                      a 300px lava cut only the retry kicker crosses
  { x: 6650, w: 400 }, // the merge — both lanes land here; slow down
  { x: 7200, w: 110 }, // chicane isle 1 (gap 150 — enter ≤ mid throttle)
  { x: 7475, w: 120 }, // chicane isle 2 (gap 165)
  { x: 7750, w: 440 }, // the FULL GAS straight, ends at the kicker lip
  { x: 9020, w: 350 }, // harbor quay (across the 310px harbor mouth)
  { x: 9790, w: 130 }, // the pontoon — land braking or swim
  { x: 10000, w: 600 }, // the pier: YOU'RE INVITED
];

/** Where the pits are water, not lava — the harbor only. The tunnel
 *  trench drains into the first zone mid-gap (deriveHazards splits). */
const WATER_ZONES: Span[] = [
  { x: 8710, w: 310 }, // the harbor mouth, under the kicker-b flight
  { x: 9370, w: 420 }, // the barge crossing
  { x: 9920, w: 80 }, //  pontoon → pier
];

/** Scaffolds, highway lane, the tunnel deck. */
const LEDGES2: Ledge[] = [
  // the construction site (lava pit below spans 3900–4700). scaf-a is
  // deliberately narrow: a full-boulevard-speed jump sails past it —
  // brake before the site or feed the pit. The rest is short-runway
  // precision: every scaffold gives just enough room to build the
  // speed its next gap needs, and no more.
  { id: "scaf-a", x: 3960, yUp: 60, w: 100 },
  { id: "scaf-b", x: 4160, yUp: 120, w: 150 },
  { id: "scaf-b2", x: 4420, yUp: 120, w: 120 },
  { id: "scaf-c", x: 4580, yUp: 60, w: 120 },
  // the elevated highway lane (the lower lane runs safely beneath)
  { id: "hwy-a", x: 5750, yUp: 140, w: 160 },
  { id: "hwy-b", x: 6075, yUp: 140, w: 140 },
  { id: "hwy-c", x: 6390, yUp: 140, w: 130 },
  // the tunnel deck — kicker-a lands here at lip height; its far end
  // IS kicker-b. Hesitate and there's no runway left to rebuild.
  { id: "deck", x: 8350, yUp: 40, w: 360 },
];

const RAMPS2: RampSpec[] = [
  // the dumpster (alley tutorial): shallow float over the first trench
  { id: "ramp-dumpster", x: 1040, yUp: 0, w: 100, rise: 40, k: 0.8 },
  // THE BIG ONE: near-max speed or you drop to the lower lane
  { id: "ramp-kicker", x: 5460, yUp: 0, w: 140, rise: 60, k: 1.5 },
  // the lower lane's own kicker over the 300px cut — missing the big
  // one costs time, not the skill: this one needs full throttle too,
  // and the lane gives exactly enough runway to rebuild. Its last
  // 50px overhang the cut like a jetty.
  { id: "ramp-retry", x: 6210, yUp: 0, w: 140, rise: 60, k: 1.5 },
  // the tunnel pair: a k1.0 hop onto the deck (same-height landing —
  // full throttle or the trench), then the k1.5 out over the harbor
  // mouth from the deck's lip.
  { id: "ramp-tunnel-a", x: 8070, yUp: 0, w: 120, rise: 40, k: 1.0 },
  { id: "ramp-tunnel-b", x: 8570, yUp: 40, w: 140, rise: 60, k: 1.5 },
];

const MOVERS2: MoverSpec[] = [
  // the night barge — wide, slow, the only way across the harbor
  { id: "barge", x: 9560, yUp: 0, w: 140, axis: "x", range: 220, period: 520, phase: 0.5 },
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
  { kind: "label", x: 2650, yUp: 200, text: "VAGARBETE", color: "yellow" },
  { kind: "streetlight", x: 3500, yUp: 0 },
  { kind: "label", x: 3700, yUp: 200, text: "SLOW", color: "tomato" },
  { kind: "label", x: 4300, yUp: 220, text: "BYGGE", color: "yellow" },
  { kind: "streetlight", x: 4900, yUp: 0 },
  { kind: "label", x: 5530, yUp: 170, text: "FULL GAS", color: "orange" },
  { kind: "streetlight", x: 6100, yUp: 0 },
  { kind: "parkedcar", x: 6750, yUp: 0 },
  // the tunnel
  { kind: "label", x: 7080, yUp: 200, text: "SAKTA", color: "tomato" },
  { kind: "duct", x: 7050, w: 1660, yUp: 380 },
  { kind: "girderline", x: 7100, yUp: 300, w: 1500 },
  { kind: "label", x: 7300, yUp: 240, text: "TUNNEL", color: "blue" },
  { kind: "label", x: 7900, yUp: 170, text: "GASA", color: "orange" },
  // the harbor
  { kind: "label", x: 9100, yUp: 210, text: "HAMN", color: "blue" },
  { kind: "streetlight", x: 9100, yUp: 0 },
  { kind: "streetlight", x: 10050, yUp: 0 },
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
    x: 10310 - 70,
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
    // Explicit end: on an ultra-wide viewport worldW outruns the
    // authored level — no phantom lava past the pier.
    hazards: deriveHazards(floorSpans, 0, LEVEL2_LENGTH, WATER_ZONES),
  };
}
