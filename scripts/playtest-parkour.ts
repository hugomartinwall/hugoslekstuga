/**
 * Headless playtest harness for Hugo's parkour.
 *
 *   npx tsx scripts/playtest-parkour.ts
 *
 * Author-time only — never imported by app code, never shipped. Three
 * sections, all running the real steppers from physics.ts:
 *
 *   A. MEASURE — empirical jump-reach tables for both mechanics; the
 *      printed block is the source for the AUTHORING RULES headers in
 *      level.ts / level2.ts. Re-run after any physics change.
 *   B. LINT — recompute every gap/step-up from the built levels and
 *      assert each against its class maximum, so authoring drift
 *      fails loudly instead of shipping an uncrossable pit.
 *   C. DRIVE — waypoint bots play both levels start→goal to prove
 *      completability (level 1 headless = authored zones only, no DOM
 *      orbs — stricter than a real run).
 *
 * Exits non-zero if any lint assertion or bot run fails.
 */

import {
  createPlayer,
  stepMoped,
  stepPlayer,
  JUMP_BUFFER_STEPS,
  MAX_RUN,
  MOPED_MAX,
  PLAYER_HALF,
  RAMP_MAX_VY,
  type InputState,
  type PlayerState,
  type Surface,
  type WorldBounds,
} from "../lib/hugo/parkour/physics";
import { buildLevel, moverPos, moverSurfaces, type Level } from "../lib/hugo/parkour/level";
import { buildLevel2 } from "../lib/hugo/parkour/level2";

const FLOOR_Y = 400;
const WORLD: WorldBounds = { floorY: FLOOR_Y, minX: -1e9, maxX: 1e9 };
const idle = (): InputState => ({
  left: false,
  right: false,
  upHeld: false,
  jumpCut: false,
});
let failures = 0;
const fail = (msg: string) => {
  failures += 1;
  console.error(`  ✗ ${msg}`);
};
const ok = (msg: string) => console.log(`  ✓ ${msg}`);

/* ── A. MEASURE ─────────────────────────────────────────────────── */

/** A grounded runner at speed `vx` on an infinite floor. */
function groundedFoot(vx: number): PlayerState {
  const p = createPlayer(0, FLOOR_Y - 16);
  p.grounded = true;
  p.vx = vx;
  return p;
}

/** Flight stats from takeoff (grounded → air) to landing back at the
 *  same floor. `airJumpAt` fires the air jump that many steps into
 *  the flight (-1 = never). Full-hold jump: upHeld the whole way. */
function footFlight(
  airJumpAt: number,
  dropTo = 0,
): { dist: number; apex: number } {
  const p = groundedFoot(MAX_RUN);
  const world: WorldBounds = { ...WORLD, floorY: FLOOR_Y + dropTo };
  const input = idle();
  input.right = true;
  input.upHeld = true;
  p.jumpBuffer = JUMP_BUFFER_STEPS;
  const takeoffX = p.x;
  let apex = 0;
  for (let step = 0; step < 600; step++) {
    if (airJumpAt >= 0 && step === airJumpAt) {
      p.jumpBuffer = JUMP_BUFFER_STEPS;
    }
    stepPlayer(p, input, [], world);
    apex = Math.max(apex, FLOOR_Y - 16 - p.y);
    if (step > 0 && p.grounded) break;
  }
  return { dist: p.x - takeoffX, apex };
}

/** Widest same-height gap a full-hold running jump crosses. The
 *  landing floor is a real rect so the 4px lip grace counts, exactly
 *  like a real pit edge. */
function footGap(double: boolean): number {
  const canCross = (gap: number): boolean => {
    const edge = 300;
    const surfaces: Surface[] = [
      { kind: "rect", id: "a", x: -1e6, y: FLOOR_Y, w: 1e6 + edge },
      { kind: "rect", id: "b", x: edge + gap, y: FLOOR_Y, w: 1e6 },
    ];
    const world: WorldBounds = { ...WORLD, floorY: Number.POSITIVE_INFINITY };
    const jumpAt = (jx: number, airAt: number): boolean => {
      const p = groundedFoot(MAX_RUN);
      p.x = 0;
      p.stand = { id: "a", lastX: -1e6, lastY: FLOOR_Y };
      const input = idle();
      input.right = true;
      input.upHeld = true;
      let jumped = false;
      let flight = 0;
      for (let step = 0; step < 900; step++) {
        if (!jumped && p.x >= jx) {
          p.jumpBuffer = JUMP_BUFFER_STEPS;
          jumped = true;
        }
        if (jumped && !p.grounded) {
          flight += 1;
          if (airAt >= 0 && flight === airAt) p.jumpBuffer = JUMP_BUFFER_STEPS;
        }
        stepPlayer(p, input, surfaces, world);
        if (p.y > FLOOR_Y + 40) return false;
        if (jumped && flight > 2 && p.grounded) return p.x > edge + gap - 4;
      }
      return false;
    };
    // Try takeoff points across the edge (coyote included) and, for
    // doubles, a spread of air-jump timings.
    for (let jx = edge - 24; jx <= edge + 8; jx += 2) {
      if (!double && jumpAt(jx, -1)) return true;
      if (double) {
        for (let airAt = 6; airAt <= 40; airAt += 2) {
          if (jumpAt(jx, airAt)) return true;
        }
      }
    }
    return false;
  };
  let lo = 60;
  let hi = 400;
  while (hi - lo > 1) {
    const mid = Math.round((lo + hi) / 2);
    if (canCross(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** A grounded moped at speed `vx` on an infinite floor. */
function groundedMoped(vx: number): PlayerState {
  const p = createPlayer(0, FLOOR_Y - 16);
  p.grounded = true;
  p.vx = vx;
  return p;
}

/** Moped jump flight from speed `vx`. `trim` holds throttle in the
 *  air; upHeld always held (best case — guardrails author against
 *  the player's best inputs). */
function mopedFlight(vx: number, trim: boolean): { dist: number; apex: number } {
  const p = groundedMoped(vx);
  const input = idle();
  input.right = trim;
  input.upHeld = true;
  p.jumpBuffer = JUMP_BUFFER_STEPS;
  const takeoffX = p.x;
  let apex = 0;
  for (let step = 0; step < 600; step++) {
    stepMoped(p, input, [], WORLD);
    apex = Math.max(apex, FLOOR_Y - 16 - p.y);
    if (step > 0 && p.grounded) break;
  }
  return { dist: p.x - takeoffX, apex };
}

/** Ramp-launch carry: airborne off a lip `rise` above the street at
 *  speed `vx` with vy = -k·vx (clamped), best inputs held, measured
 *  to the street-level landing. */
function rampCarry(vx: number, k: number, rise: number): number {
  const p = createPlayer(0, FLOOR_Y - rise - 16);
  p.vx = vx;
  p.vy = Math.max(-RAMP_MAX_VY, -k * vx);
  const input = idle();
  input.right = true;
  input.upHeld = true;
  const startX = p.x;
  for (let step = 0; step < 600; step++) {
    stepMoped(p, input, [], WORLD);
    if (p.grounded) break;
  }
  return p.x - startX;
}

function mopedBrakeDistance(): number {
  const p = groundedMoped(MOPED_MAX);
  const input = idle();
  input.left = true;
  const startX = p.x;
  for (let step = 0; step < 600 && p.vx > 0.3; step++) {
    stepMoped(p, input, [], WORLD);
  }
  return p.x - startX;
}

function mopedRunway(): number {
  const p = groundedMoped(0);
  const input = idle();
  input.right = true;
  const startX = p.x;
  for (let step = 0; step < 900 && p.vx < MOPED_MAX - 0.01; step++) {
    stepMoped(p, input, [], WORLD);
  }
  return p.x - startX;
}

const r = (n: number) => Math.round(n);

type Measured = {
  footApex: number;
  footSingle: number;
  footDouble: number;
  footDrop80: number;
  mopedApex: number;
  mopedTier: Record<string, { trim: number; noTrim: number }>;
  carry: Record<string, { full: number; half: number }>;
  brake: number;
  runway: number;
};

function measure(): Measured {
  console.log("── A. MEASURE ──────────────────────────────────────");
  const single = footFlight(-1);
  const drop80 = footFlight(-1, 80);
  const footSingle = footGap(false);
  const footDouble = footGap(true);
  console.log("on foot (stepPlayer, full hold, running):");
  console.log(`  jump apex ............. ${r(single.apex)}px`);
  console.log(`  single running jump ... crosses gap ${footSingle}px (flight ${r(single.dist)}px)`);
  console.log(`  best double jump ...... crosses gap ${footDouble}px`);
  console.log(`  reach to 80px drop .... ${r(drop80.dist)}px`);

  const tiers = [3, 4.5, 6, MOPED_MAX];
  const mopedTier: Measured["mopedTier"] = {};
  for (const v of tiers) {
    mopedTier[String(v)] = {
      trim: mopedFlight(v, true).dist,
      noTrim: mopedFlight(v, false).dist,
    };
  }
  const mopedApex = mopedFlight(MOPED_MAX, true).apex;
  const carry: Measured["carry"] = {
    "k0.8": { full: rampCarry(MOPED_MAX, 0.8, 40), half: rampCarry(MOPED_MAX / 2, 0.8, 40) },
    "k1.0": { full: rampCarry(MOPED_MAX, 1.0, 40), half: rampCarry(MOPED_MAX / 2, 1.0, 40) },
    "k1.5": { full: rampCarry(MOPED_MAX, 1.5, 60), half: rampCarry(MOPED_MAX / 2, 1.5, 60) },
  };
  const brake = mopedBrakeDistance();
  const runway = mopedRunway();
  console.log("moped (stepMoped, up held; trim = throttle held in air):");
  console.log(`  jump apex ............. ${r(mopedApex)}px`);
  for (const v of tiers) {
    const t = mopedTier[String(v)];
    console.log(
      `  flat jump @ vx ${String(v).padEnd(4)} ... ${r(t.trim)}px (no trim ${r(t.noTrim)}px)`,
    );
  }
  for (const [k, c] of Object.entries(carry)) {
    console.log(`  ${k} carry ........... full ${r(c.full)}px · half ${r(c.half)}px`);
  }
  console.log(`  brake 7.5→0.3 ......... ${r(brake)}px`);
  console.log(`  runway 0→7.5 .......... ${r(runway)}px`);
  return {
    footApex: single.apex,
    footSingle,
    footDouble,
    footDrop80: drop80.dist,
    mopedApex,
    mopedTier,
    carry,
    brake,
    runway,
  };
}

/* ── B. LINT ────────────────────────────────────────────────────────
 * Static gap audit against the measured table. Gaps with a ledge,
 * mover, cabinet, or ramp overlapping them are "routed" — a designed
 * path exists and the bot (section C) proves it; plain gaps must fit
 * a straight jump. Ramp-launched gaps measure from the lip. */

const FOOT_MAX_GAP = 140;
const MOPED_MAX_GAP = 250;
const CARRY_BY_K: Record<string, number> = { "0.8": 195, "1": 233, "1.5": 330 };
const MIN_PLATFORM = 60;

function lintLevel(name: string, level: Level): void {
  console.log(`\nlint ${name}:`);
  const spans = [...level.floorSpans].sort((a, b) => a.x - b.x);
  const ledges = level.surfaces.filter(
    (s): s is Surface & { kind: "rect" } =>
      s.kind === "rect" && !s.id.startsWith("floor:"),
  );
  const moped = level.mechanic === "moped";

  for (let i = 0; i + 1 < spans.length; i++) {
    const g0 = spans[i].x + spans[i].w;
    const g1 = spans[i + 1].x;
    const gap = g1 - g0;
    if (gap <= 0) continue;

    const routed =
      ledges.some((l) => l.x < g1 && l.x + l.w > g0) ||
      level.movers.some(
        (m) => m.baseX + m.w / 2 + m.range / 2 > g0 && m.baseX - m.w / 2 - m.range / 2 < g1,
      ) ||
      level.cabinets.some((c) => Math.abs(c.wx - (g0 + g1) / 2) < gap / 2 + 60);
    if (routed) {
      ok(`gap ${g0}→${g1} (${gap}px): routed — bot proves it`);
      continue;
    }

    // A ramp whose lip sits at/just before the gap launches across it.
    const ramp = level.ramps.find(
      (rp) => rp.wx + rp.w >= g0 - 60 && rp.wx + rp.w <= g0 + 1,
    );
    if (moped && ramp) {
      const eff = g1 - (ramp.wx + ramp.w);
      const carry = CARRY_BY_K[String(ramp.k)] ?? 195;
      if (eff <= carry) ok(`gap ${g0}→${g1}: ${eff}px off ${ramp.id} lip ≤ carry ${carry}`);
      else fail(`gap ${g0}→${g1}: ${eff}px off ${ramp.id} lip > carry ${carry}`);
      continue;
    }

    const limit = moped ? MOPED_MAX_GAP : FOOT_MAX_GAP;
    if (gap <= limit) ok(`gap ${g0}→${g1}: ${gap}px ≤ ${limit}`);
    else fail(`gap ${g0}→${g1}: ${gap}px > ${limit} and no route over it`);
  }

  for (const s of [...spans, ...ledges.map((l) => ({ x: l.x, w: l.w }))]) {
    if (s.w < MIN_PLATFORM) {
      fail(`platform at ${s.x} only ${s.w}px wide (< ${MIN_PLATFORM})`);
    }
  }
}

/* ── C. DRIVE — waypoint bots ───────────────────────────────────────
 * Each waypoint holds a controller (what to press) and a completion
 * predicate; the runner turns controllers into InputState with real
 * key-edge semantics (jump buffers on the press edge, jumpCut on
 * release), steps the real physics, and asserts survival + arrival. */

type Ctl = { left?: boolean; right?: boolean; up?: boolean };
type Waypoint = {
  label: string;
  ctl: (p: PlayerState, tick: number) => Ctl;
  until: (p: PlayerState, tick: number) => boolean;
};

/** run right until x. */
const runTo = (x: number): Waypoint => ({
  label: `runTo ${x}`,
  ctl: () => ({ right: true }),
  until: (p) => p.x >= x,
});

/** walk back left until x (re-centering on a platform). */
const runLeftTo = (x: number): Waypoint => ({
  label: `runLeftTo ${x}`,
  ctl: () => ({ left: true }),
  until: (p) => p.x <= x,
});

/** Run right, jump once past x, hold through the apex, land. */
const jumpAt = (x: number): Waypoint[] => [
  runTo(x),
  {
    label: `jump @${x}`,
    ctl: () => ({ right: true, up: true }),
    until: (p) => !p.grounded,
  },
  {
    label: `flight @${x}`,
    ctl: (p) => ({ right: true, up: p.vy < 1 }),
    until: (p) => p.grounded,
  },
];

/** Foot only: single jump at x1, air jump once past x2. */
const doubleJumpAt = (x1: number, x2: number): Waypoint[] => [
  runTo(x1),
  {
    label: `jump @${x1}`,
    ctl: () => ({ right: true, up: true }),
    until: (p) => !p.grounded,
  },
  {
    label: `glide to ${x2}`,
    ctl: () => ({ right: true, up: false }),
    until: (p) => p.x >= x2 || p.grounded,
  },
  {
    label: `air jump @${x2}`,
    ctl: () => ({ right: true, up: true }),
    until: (p) => !p.airJump || p.grounded,
  },
  {
    label: `flight 2 @${x2}`,
    ctl: (p) => ({ right: true, up: p.vy < 1 }),
    until: (p) => p.grounded,
  },
];

/** Stand still until a condition holds (mover timing). */
const waitUntil = (
  label: string,
  pred: (p: PlayerState, tick: number) => boolean,
): Waypoint => ({ label, ctl: () => ({}), until: pred });

/** Let friction kill leftover run speed before a precision hop. */
const settle = (): Waypoint =>
  waitUntil("settle", (p) => Math.abs(p.vx) < 0.3);

/** Jump right now (from standstill or while running). Covers ~85px
 *  from a cold start on foot. */
const jumpNow = (label: string): Waypoint[] => [
  {
    label: `${label} (press)`,
    ctl: () => ({ right: true, up: true }),
    until: (p) => !p.grounded,
  },
  {
    label: `${label} (flight)`,
    ctl: (p) => ({ right: true, up: p.vy < 1 }),
    until: (p) => p.grounded,
  },
];

/** Jump straight up (no drift) — boarding a low mover overhead. */
const jumpUpNow = (label: string): Waypoint[] => [
  {
    label: `${label} (press)`,
    ctl: () => ({ up: true }),
    until: (p) => !p.grounded,
  },
  {
    label: `${label} (fall)`,
    ctl: (p) => ({ up: p.vy < 1 }),
    until: (p) => p.grounded,
  },
];

/** Moped: brake until at or below vx. */
const brakeTo = (v: number): Waypoint => ({
  label: `brakeTo ${v}`,
  ctl: () => ({ left: true }),
  until: (p) => p.vx <= v,
});

/** Moped: feather the throttle — hold right only below v — until x. */
const cruiseTo = (x: number, v: number): Waypoint => ({
  label: `cruiseTo ${x} @${v}`,
  ctl: (p) => ({ right: p.vx < v }),
  until: (p) => p.x >= x,
});

/** Moped: cruise at v, jump once past x (speed-precise jumps). */
const cruiseJumpAt = (x: number, v: number): Waypoint[] => [
  cruiseTo(x, v),
  {
    label: `cruise-jump @${x}`,
    ctl: (p) => ({ right: p.vx < v, up: true }),
    until: (p) => !p.grounded,
  },
  {
    label: `flight @${x}`,
    ctl: (p) => ({ right: true, up: p.vy < 1 }),
    until: (p) => p.grounded,
  },
];

function runBot(
  name: string,
  level: Level,
  start: { x: number; y: number },
  waypoints: Waypoint[],
  maxSteps = 60 * 180,
): void {
  const player = createPlayer(start.x, start.y);
  const input: InputState = { left: false, right: false, upHeld: false, jumpCut: false };
  const world: WorldBounds = {
    floorY: Number.POSITIVE_INFINITY,
    minX: PLAYER_HALF,
    maxX: level.worldW - PLAYER_HALF,
  };
  let wi = 0;
  let prevUp = false;
  for (let tick = 1; tick <= maxSteps; tick++) {
    const wp = waypoints[Math.min(wi, waypoints.length - 1)];
    const ctl = wp.ctl(player, tick);
    input.left = !!ctl.left;
    input.right = !!ctl.right;
    const up = !!ctl.up;
    if (up && !prevUp) player.jumpBuffer = JUMP_BUFFER_STEPS;
    if (!up && prevUp) input.jumpCut = true;
    input.upHeld = up;
    prevUp = up;

    const surfaces = [...moverSurfaces(level, tick), ...level.surfaces];
    if (level.mechanic === "moped") stepMoped(player, input, surfaces, world);
    else stepPlayer(player, input, surfaces, world);

    if (player.y > level.killY) {
      fail(
        `${name}: died at x=${r(player.x)} (waypoint "${wp.label}", step ${tick})`,
      );
      return;
    }
    if (process.env.DEBUG && wi < waypoints.length && wp.until(player, tick)) {
      console.log(
        `    · ${wp.label} done @x=${r(player.x)} y=${r(player.y)} vx=${player.vx.toFixed(1)} stand=${player.stand?.id ?? "-"} t=${tick}`,
      );
    }
    const g = level.goal;
    if (
      player.x > g.x - 6 &&
      player.x < g.x + g.w + 6 &&
      player.y > g.y - 6 &&
      player.y < g.y + g.h + 10
    ) {
      ok(`${name}: reached ${g.big} ${g.small} in ${tick} steps (${r(tick / 60)}s)`);
      return;
    }
    if (wi < waypoints.length && wp.until(player, tick)) wi += 1;
  }
  fail(
    `${name}: timed out at x=${r(player.x)} (waypoint "${
      waypoints[Math.min(wi, waypoints.length - 1)].label
    }")`,
  );
}

/** Mover y as "yUp above the floor" at a tick (for boarding preds). */
function moverYUp(level: Level, id: string, tick: number): number {
  const m = level.movers.find((q) => q.id === id)!;
  return level.floorY - moverPos(m, tick).y;
}
function moverX(level: Level, id: string, tick: number): number {
  const m = level.movers.find((q) => q.id === id)!;
  return moverPos(m, tick).x;
}

function driveLevel1(): void {
  const W = 1280;
  const FLOOR = 710;
  const level = buildLevel(W, FLOOR);
  const x0 = W;
  const a = (x: number) => x0 + x; // authored → absolute

  const waypoints: Waypoint[] = [
    // zone 1 — the three pits (120/128/133), floor-level jumps
    ...jumpAt(a(228)),
    ...jumpAt(a(588)),
    ...jumpAt(a(974)),
    // zone 2 — up the cabinet stacks (stop short of each edge; the
    // skid from a full run slides ~15px)
    runTo(a(1755)),
    ...jumpNow("onto cab-1"),
    runTo(a(1875)),
    ...jumpNow("onto cab-2"),
    runTo(a(2010)),
    ...jumpNow("onto cab-3"),
    runTo(a(2150)),
    settle(),
    // the dolly: wait on cab-3 until it swings near, hop on, ride
    // right, hop off to trench-out
    waitUntil("dolly near left", (p, t) => moverX(level, "dolly", t) < a(2300)),
    ...jumpNow("onto dolly"),
    waitUntil(
      "ride dolly right",
      (p, t) => p.stand?.id !== "dolly" || moverX(level, "dolly", t) > a(2405),
    ),
    ...jumpNow("off dolly to trench-out"),
    // drop from trench-out to the vents floor and cross the fan pits
    runTo(a(2640)),
    ...jumpAt(a(3048)),
    ...jumpAt(a(3318)),
    // the grate: stand under it, board with a straight-up jump while
    // it's low, ride high, hop off to duct-in
    runTo(a(3655)),
    settle(),
    waitUntil("grate low", (p, t) => moverYUp(level, "grate", t) < 55),
    ...jumpUpNow("onto grate"),
    waitUntil(
      "grate high",
      (p, t) => p.stand?.id === "grate" && moverYUp(level, "grate", t) > 250,
    ),
    ...jumpNow("off grate to duct-in"),
    // zone 4 — the ducts
    ...jumpAt(a(3868)),
    ...jumpAt(a(4088)),
    runTo(a(4268)),
    settle(),
    // piston-a: board near duct-b height, then re-center (a cold hop
    // carries ~117px — landing drifts toward the far edge)
    waitUntil("piston-a level", (p, t) => {
      const y = moverYUp(level, "piston-a", t);
      return y > 215 && y < 245;
    }),
    ...jumpNow("onto piston-a"),
    runLeftTo(a(4390)),
    settle(),
    waitUntil(
      "pistons crossing",
      (p, t) =>
        p.stand?.id === "piston-a" &&
        Math.abs(moverYUp(level, "piston-a", t) - moverYUp(level, "piston-b", t)) < 24,
    ),
    ...jumpNow("across to piston-b"),
    runTo(a(4515)),
    settle(),
    waitUntil(
      "piston-b high",
      (p, t) => p.stand?.id === "piston-b" && moverYUp(level, "piston-b", t) > 258,
    ),
    ...jumpNow("off to duct-out"),
    ...jumpAt(a(4736)),
    ...jumpAt(a(4966)),
    // zone 5 — the rooftop signs, then the double jump
    ...jumpAt(a(5228)),
    ...jumpAt(a(5408)),
    ...jumpAt(a(5583)),
    ...doubleJumpAt(a(5763), a(5860)),
    runTo(a(6230)),
  ];

  runBot("level 1 (foot)", level, { x: x0 - 100, y: FLOOR - 40 }, waypoints);
}

function driveLevel2(): void {
  const W = 1280;
  const FLOOR = 710;
  const level = buildLevel2(W, FLOOR);

  const waypoints: Waypoint[] = [
    // the alley: full throttle, hop the teaching gap, ride the
    // dumpster ramp (driving over the lip launches by itself)
    ...jumpAt(688),
    runTo(1400), // mounts the ramp, flies, lands on the boulevard
    // the boulevard: three full-throttle trenches
    ...jumpAt(1888),
    ...jumpAt(2588),
    ...jumpAt(3148),
    // the construction site: brake early, feather the throttle so
    // each hop stays in its speed window
    runTo(3650),
    brakeTo(3.0),
    ...cruiseJumpAt(3888, 3.0),
    ...cruiseJumpAt(4048, 3.4),
    ...cruiseJumpAt(4298, 3.8),
    ...cruiseJumpAt(4528, 3.0),
    // drive off scaf-c, rebuild to full, mount THE BIG ONE — the lip
    // launch carries onto the highway lane
    runTo(5700),
    // the highway hops
    ...jumpAt(5898),
    ...jumpAt(6203),
    ...jumpAt(6508),
    // the merge → chicane: brake to the mid tier
    brakeTo(5),
    ...cruiseJumpAt(7038, 5),
    ...cruiseJumpAt(7298, 5),
    ...cruiseJumpAt(7583, 5.5),
    // FULL GAS: ramp-a → deck → ramp-b → over the harbor mouth to
    // the quay (runTo holds throttle through both launches)
    runTo(9100),
    // the harbor: stop on the quay, board the barge as it swings in
    brakeTo(0.2),
    waitUntil("barge inbound", (p, t) => {
      const bx = moverX(level, "barge", t);
      return bx < 9490 && bx < moverX(level, "barge", t - 1);
    }),
    ...cruiseJumpAt(9350, 3),
    // stop rolling — a moped coasts, and the barge edge is close
    brakeTo(0.2),
    waitUntil(
      "ride barge",
      (p, t) => p.stand?.id === "barge" && moverX(level, "barge", t) > 9640,
    ),
    ...cruiseJumpAt(9720, 3),
    brakeTo(2.2),
    ...cruiseJumpAt(9902, 3),
    runTo(10330),
  ];

  runBot("level 2 (moped)", level, { x: 60, y: FLOOR - 60 }, waypoints);
}

/* ── run ────────────────────────────────────────────────────────── */

measure();

console.log("\n── B. LINT ─────────────────────────────────────────");
{
  const l1 = buildLevel(1280, 710);
  const l2 = buildLevel2(1280, 710);
  lintLevel("level 1 (foot)", l1);
  lintLevel("level 2 (moped)", l2);
}

console.log("\n── C. DRIVE ────────────────────────────────────────");
driveLevel1();
driveLevel2();

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nall green.");
