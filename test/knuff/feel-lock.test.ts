import { describe, expect, it } from "vitest";
import * as toy from "../fixtures/knuff/toy-sim";
import { DEFAULT_TUNE, TOY, TOY_SETTINGS } from "../../lib/knuff/content/tune";
import { hotSpeed } from "../../lib/knuff/sim/physics";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Launch, SimEvent, Tune } from "../../lib/knuff/sim/types";

/**
 * The feel lock. The owner set how the mascot moves by hand, in a toy.
 * `test/fixtures/knuff/toy-sim.ts` is that toy's simulation, copied
 * untouched. This suite runs it beside the game's and asks for the same
 * positions and speeds on every tick: not close, the same numbers to the
 * last bit.
 *
 * Step 0: the game's simulation IS the toy's, so the two agree for whole
 * flights, dummies and all, until something respawns. (The toy picks its
 * respawn spots and its ringed dummy from one generator. The game has no
 * ring, so the spots cannot be the same, and respawns are pushed out of
 * the window on both sides.) From step 1 he lands where the toy slides on,
 * and the lock holds only while he is hot.
 *
 * How the two are set side by side, as the spec has it: the room's edges
 * are set to the toy's (`start.room`: 0, 0, 360, 480; the toy has no
 * cushion thickness), the toy runs with the tune its shell hands it (pips
 * off), and the toy's mascot is moved to the game's start, (180, 374),
 * before the first launch (the toy's own is (180, 374.4)).
 */

// ── The toy, set up as its shell sets it up ──────────────────────────

/** The toy's shell is page code and cannot be imported here; these are its `dragFromGlide` and `tuneFrom`. */
function toyShellTune(settings: { power: number; glide: number }): toy.Tune {
  const dragK = 2.4 * Math.pow(0.45 / 2.4, settings.glide / 100);
  return { ...toy.DEFAULT_TUNE, maxSpeed: settings.power, dragK, pipMax: 99, pipRefillTicks: 1 };
}

const NEVER = 1_000_000_000;
const TOY_TUNE: toy.Tune = { ...toyShellTune({ power: 900, glide: 50 }), respawnTicks: NEVER };
/** The toy has no cushion thickness: its floor is the whole 360 × 480. */
const TOY_ROOM = { left: 0, top: 0, right: toy.FIELD_W, bottom: toy.FIELD_H };

// ── Scripts ───────────────────────────────────────────────────────────

/** A launch at `degrees` anticlockwise from straight right (90 is straight up the room). */
function at(degrees: number, power: number): Launch {
  const a = (degrees * Math.PI) / 180;
  return { dx: Math.cos(a), dy: -Math.sin(a), power };
}

/** The speed that one tick of slowing (drag, then friction) brings down to `target`. */
function speedThatSlowsTo(target: number, dragK: number, friction: number): number {
  return (target + friction * toy.DT) / Math.exp(-dragK * toy.DT);
}

/** How close to a rest speed the "only just" scripts go, u/s. */
const REST_MARGIN = 5e-4;

/** The toy's four cushions: a point on each, and the way into the room from it. */
const CUSHIONS: { name: string; at: [number, number]; inward: [number, number] }[] = [
  { name: "left", at: [0, 240], inward: [1, 0] },
  { name: "right", at: [360, 240], inward: [-1, 0] },
  { name: "top", at: [180, 0], inward: [0, 1] },
  { name: "bottom", at: [180, 480], inward: [0, -1] },
];

type Scenario = {
  name: string;
  /** Launches by tick. */
  script: Record<number, Launch>;
  ticks: number;
  /** Where he is put before the first tick. Without it both start at the game's start. */
  him?: [number, number];
  /** Where the dummies are put. Without it, the toy's opening rack. */
  things?: [number, number][];
  /** A speed each dummy starts with, in the order of `things`. (In play only he sets them moving.) */
  moving?: [number, number][];
  empty?: boolean;
  /** A launch speed for both sides, where a script needs one the game never reaches. */
  maxSpeed?: number;
};

const SCENARIOS: Scenario[] = [
  {
    // The five launches the spec names, in an empty room.
    name: "five launches in an empty room",
    empty: true,
    ticks: 900,
    script: {
      0: at(90, 1), // full power straight up
      200: at(37, 1), // full power at 37 degrees
      400: at(135, 0.7), // 70% into a corner
      600: at(250, 0.5), // 50%
      620: at(20, 1), // a relaunch 20 ticks into a flight
    },
  },
  {
    // A break shot into the toy's rack, then mopping up: pops, cushions,
    // relaunches while hot, slow bumps, dummies knocking dummies.
    name: "the rack",
    ticks: 1500,
    script: {
      0: at(90, 1),
      150: at(70, 0.8),
      300: at(200, 0.6),
      450: at(120, 1),
      470: at(300, 0.9),
      650: at(45, 0.5),
      800: at(160, 0.75),
      1000: at(100, 0.4),
      1200: at(270, 1),
    },
  },
  {
    // Never hot (30% is under the hot line): he shoves one dummy into the
    // top cushion and into another dummy.
    name: "a soft push into a cushion",
    him: [180, 120],
    things: [
      [180, 40],
      [160, 22],
    ],
    ticks: 400,
    script: { 0: at(90, 0.3), 200: at(80, 0.2) },
  },
  {
    // Dead into the top-left corner: two cushions in one substep.
    name: "into a corner",
    empty: true,
    ticks: 300,
    script: { 0: { dx: 13 - 180, dy: 13 - 374, power: 1 }, 150: at(315, 0.8) },
  },
  {
    // The shortest shot the toy fires (35%) is hot for a tick or two; then
    // a long glide to rest, the part of a flight the others cut short.
    name: "minimum power, and a glide to rest",
    empty: true,
    ticks: 500,
    script: { 0: { dx: 0.4, dy: -1, power: 0.35 }, 250: at(182, 0.35) },
  },
  {
    // A launch at exactly the hot share of the launch speed, with a dummy
    // 2 u ahead: he reaches it in his first tick, at exactly the hot
    // speed, and it pops. One hair slower and it would be a bump.
    name: "a pop exactly at the hot line",
    him: [180, 374],
    things: [[180, 374 - 13 - 12 - 2]],
    ticks: 120,
    script: { 0: { dx: 0, dy: -1, power: 0.33 } },
  },
  {
    // Two centres closer than a millionth of a unit give a push no
    // direction, and it takes a fixed one. On the far side of that line:
    // a dummy 3e-6 u from his centre, and two dummies 3e-6 u apart.
    name: "closer than a hair",
    him: [180, 374],
    things: [
      [180 + 3e-6, 374],
      [100, 100],
      [100, 100 + 3e-6],
    ],
    ticks: 90,
    script: { 40: at(45, 0.5) },
  },
  {
    // And on the near side of it: 5e-7 u.
    name: "closer than a hair, the near side",
    him: [180, 374],
    things: [
      [180 + 5e-7, 374],
      [260, 100],
      [260, 100 + 5e-7],
    ],
    ticks: 90,
    script: { 40: at(45, 0.5) },
  },
  {
    // Faster than the game ever goes. Above 3,600 u/s a tick would take
    // more than ten substeps, and the cap binds: this is the only place
    // that number can be seen.
    name: "faster than the game ever goes",
    empty: true,
    maxSpeed: 6000,
    ticks: 300,
    script: { 0: at(63, 1), 70: at(200, 0.9), 140: at(301, 1) },
  },
  {
    // One hair under the hot line: the same shot a billionth softer is a
    // bump, not a pop.
    name: "a hair under the hot line",
    him: [180, 374],
    things: [[180, 374 - 13 - 12 - 2]],
    ticks: 120,
    script: { 0: { dx: 0, dy: -1, power: 0.33 - 1e-9 } },
  },
  {
    // The substeps of a tick are sized for the fastest mover, and that is
    // not always him: a dummy crossing the room at 800 u/s while he stands.
    name: "a dummy faster than he is",
    him: [60, 440],
    things: [[100, 100]],
    moving: [[700, 390]],
    ticks: 200,
    script: { 120: at(60, 0.5) },
  },
  // Coming to rest. A body stops when a tick's slowing leaves it under its
  // rest speed: each of these is slowed, in its first tick, to a twentieth
  // of a percent over that speed or under it.
  ...[1, -1].map((side): Scenario => {
    const speed = speedThatSlowsTo(TOY_TUNE.restSpeed + side * REST_MARGIN, TOY_TUNE.dragK, TOY_TUNE.friction);
    return {
      name: `he is slowed to just ${side > 0 ? "over" : "under"} his rest speed`,
      empty: true,
      ticks: 12,
      script: { 0: { dx: 3, dy: -4, power: speed / TOY_TUNE.maxSpeed } },
    };
  }),
  ...[1, -1].map((side): Scenario => {
    // 2.4 a second, 50 u/s² and 6 u/s: how a knocked dummy slows in the toy.
    const speed = speedThatSlowsTo(6 + side * REST_MARGIN, 2.4, 50);
    return {
      name: `a dummy is slowed to just ${side > 0 ? "over" : "under"} its rest speed`,
      him: [60, 440],
      things: [[180, 200]],
      moving: [[speed * 0.6, speed * 0.8]],
      ticks: 12,
      script: {},
    };
  }),
  // Pressed against a cushion. A contact can push a body through a
  // cushion; it is put back, and stopped if it was heading in. Once for
  // each cushion, for a dummy (he leans on it, slowly) and for him (a
  // dummy is thrown at him where he stands).
  ...CUSHIONS.flatMap(({ name, at: [wx, wy], inward: [nx, ny] }): Scenario[] => [
    {
      name: `a dummy pressed into the ${name} cushion`,
      him: [wx + nx * 60, wy + ny * 60],
      things: [[wx + nx * 12, wy + ny * 12]],
      ticks: 90,
      script: { 0: { dx: -nx, dy: -ny, power: 0.3 } },
    },
    {
      name: `he is shoved into the ${name} cushion`,
      him: [wx + nx * 13, wy + ny * 13],
      things: [[wx + nx * 73, wy + ny * 73]],
      moving: [[-nx * 500, -ny * 500]],
      ticks: 90,
      script: {},
    },
  ]),
];

// ── The comparison ────────────────────────────────────────────────────

type Tally = {
  pops: number;
  /** His speed at the slowest pop; -1 with none. */
  slowestPop: number;
  cushions: number;
  corners: number;
  bumps: number;
  rests: number;
  dummyOffCushion: number;
  hotTicks: number;
  coolMovingTicks: number;
  /** The most substeps the toy's rule asks for in a tick, before the cap. */
  mostSubstepsAsked: number;
};

type Outcome = {
  mismatch: string | null;
  tally: Tally;
  /** Where he was after the first tick. */
  first: { x: number; y: number };
  /** After the first tick: his speed, and the first dummy's (-1 with none). */
  firstSpeed: { him: number; thing: number };
  /** Was a body ever put back from beyond a cushion and stopped: him, a dummy. */
  stoppedAtCushion: { him: boolean; thing: boolean };
};

/** Run one scenario on both simulations. Stops at the first value that differs. */
function follow(sc: Scenario, engineTune: Tune): Outcome {
  const count = sc.things ? sc.things.length : sc.empty ? 0 : 6;
  const speed = sc.maxSpeed === undefined ? {} : { maxSpeed: sc.maxSpeed };
  const toyTune: toy.Tune = { ...TOY_TUNE, dummyCount: count, ...speed };
  const tune: Tune = { ...engineTune, dummyCount: count, dummyRespawnTicks: NEVER, ...speed };

  const t = toy.createState(20261111, toyTune);
  const e = createState(20261111, tune, { room: TOY_ROOM, empty: count === 0 });
  // The toy's mascot is moved to the game's start (or both to the script's).
  if (sc.him) [e.him.x, e.him.y] = sc.him;
  t.hugo.x = e.him.x;
  t.hugo.y = e.him.y;
  sc.things?.forEach(([x, y], i) => {
    t.dummies[i].x = x;
    t.dummies[i].y = y;
    e.things[i].x = x;
    e.things[i].y = y;
  });
  sc.moving?.forEach(([vx, vy], i) => {
    t.dummies[i].vx = vx;
    t.dummies[i].vy = vy;
    e.things[i].vx = vx;
    e.things[i].vy = vy;
  });

  const tally: Tally = {
    pops: 0,
    slowestPop: -1,
    cushions: 0,
    corners: 0,
    bumps: 0,
    rests: 0,
    dummyOffCushion: 0,
    hotTicks: 0,
    coolMovingTicks: 0,
    mostSubstepsAsked: 0,
  };
  const first = { x: e.him.x, y: e.him.y };
  const firstSpeed = { him: 0, thing: -1 };
  const stoppedAtCushion = { him: false, thing: false };
  const events: SimEvent[] = [];
  const differs = (tick: number, what: string, engine: unknown, toyValue: unknown): Outcome => ({
    mismatch: `${sc.name}, tick ${tick}: ${what} is ${String(engine)} in the game and ${String(toyValue)} in the toy`,
    tally,
    first,
    firstSpeed,
    stoppedAtCushion,
  });
  /** On a cushion's line with no speed into or out of it: put back and stopped, not bounced. */
  const stopped = (b: { x: number; y: number; vx: number; vy: number; r: number }) =>
    ((b.x === b.r || b.x === toy.FIELD_W - b.r) && b.vx === 0 && b.vy === 0) ||
    ((b.y === b.r || b.y === toy.FIELD_H - b.r) && b.vy === 0 && b.vx === 0);

  for (let k = 0; k < sc.ticks; k++) {
    const launch = sc.script[k] ?? null;
    const vBefore = t.dummies.map((d) => [d.vx, d.vy]);
    toy.step(t, { launch }, toyTune);
    events.length = 0;
    step(e, { launch, pullHeld: false }, tune, events);
    if (k === 0) {
      first.x = e.him.x;
      first.y = e.him.y;
      firstSpeed.him = Math.hypot(t.hugo.vx, t.hugo.vy);
      if (t.dummies.length > 0) firstSpeed.thing = Math.hypot(t.dummies[0].vx, t.dummies[0].vy);
    }
    if (k < 30 && stopped(t.hugo)) stoppedAtCushion.him = true;
    if (k < 30 && t.dummies.some((d) => d.alive && stopped(d))) stoppedAtCushion.thing = true;

    // Him. Equal as numbers: the game does not keep the sign of a zero
    // speed (step.ts, "close up"), the toy does, and no rule can tell.
    if (e.him.x !== t.hugo.x) return differs(k, "his x", e.him.x, t.hugo.x);
    if (e.him.y !== t.hugo.y) return differs(k, "his y", e.him.y, t.hugo.y);
    if (e.him.vx !== t.hugo.vx) return differs(k, "his vx", e.him.vx, t.hugo.vx);
    if (e.him.vy !== t.hugo.vy) return differs(k, "his vy", e.him.vy, t.hugo.vy);
    if (e.him.hot !== t.hugo.hot) return differs(k, "hot", e.him.hot, t.hugo.hot);
    if (e.tick !== t.tick) return differs(k, "the tick", e.tick, t.tick);
    if (e.launch.id !== t.flight.id) return differs(k, "the launch count", e.launch.id, t.flight.id);
    if (e.launch.cushions !== t.flight.walls) return differs(k, "cushions this launch", e.launch.cushions, t.flight.walls);

    // Every dummy, slot by slot.
    if (e.things.length !== t.dummies.length) return differs(k, "the number of things", e.things.length, t.dummies.length);
    for (let i = 0; i < t.dummies.length; i++) {
      const a = e.things[i];
      const b = t.dummies[i];
      if (a.alive !== b.alive) return differs(k, `thing ${i} alive`, a.alive, b.alive);
      if (!b.alive) continue;
      if (a.x !== b.x) return differs(k, `thing ${i} x`, a.x, b.x);
      if (a.y !== b.y) return differs(k, `thing ${i} y`, a.y, b.y);
      if (a.vx !== b.vx) return differs(k, `thing ${i} vx`, a.vx, b.vx);
      if (a.vy !== b.vy) return differs(k, `thing ${i} vy`, a.vy, b.vy);
      // A dummy that turned round at a cushion (for the tally only).
      const [vx0, vy0] = vBefore[i];
      const atCushion = b.x <= b.r + 1 || b.x >= toy.FIELD_W - b.r - 1 || b.y <= b.r + 1 || b.y >= toy.FIELD_H - b.r - 1;
      if (atCushion && (vx0 * b.vx < 0 || vy0 * b.vy < 0)) tally.dummyOffCushion++;
    }

    // What happened: the same pops, in the same order, at the same speed.
    const toyPops = t.events.filter((ev) => ev.t === "pop");
    const pops = events.filter((ev) => ev.type === "pop");
    if (pops.length !== toyPops.length) return differs(k, "pops this tick", pops.length, toyPops.length);
    for (let i = 0; i < pops.length; i++) {
      const a = pops[i];
      const b = toyPops[i];
      if (a.type !== "pop" || b.t !== "pop") continue;
      if (a.id !== b.id) return differs(k, "the id of what popped", a.id, b.id);
      if (a.speed !== b.speed) return differs(k, "his speed at the pop", a.speed, b.speed);
      if (tally.slowestPop < 0 || b.speed < tally.slowestPop) tally.slowestPop = b.speed;
    }

    tally.pops += toyPops.length;
    for (const ev of events) {
      if (ev.type === "cushion") tally.cushions++;
    }
    if (events.filter((ev) => ev.type === "cushion").length >= 2) tally.corners++;
    for (const ev of t.events) {
      if (ev.t === "bump") tally.bumps++;
      if (ev.t === "rest") tally.rests++;
    }
    if (t.hugo.hot) tally.hotTicks++;
    else if (t.hugo.vx !== 0 || t.hugo.vy !== 0) tally.coolMovingTicks++;
    const asked = Math.ceil((Math.hypot(t.hugo.vx, t.hugo.vy) * toy.DT) / 6);
    if (asked > tally.mostSubstepsAsked) tally.mostSubstepsAsked = asked;
  }
  return { mismatch: null, tally, first, firstSpeed, stoppedAtCushion };
}

describe("feel lock: the game moves as the toy moves", () => {
  const results = SCENARIOS.map((sc) => ({ sc, out: follow(sc, DEFAULT_TUNE) }));

  for (const { sc, out } of results) {
    it(`${sc.name}: every tick equals the toy's`, () => {
      expect(out.mismatch).toBeNull();
    });
  }

  it("both start where the game starts: (180, 374), not the toy's (180, 374.4)", () => {
    const e = createState(1, DEFAULT_TUNE, { room: TOY_ROOM, empty: true });
    expect([e.him.x, e.him.y]).toEqual([180, 374]);
    const t = toy.createState(1, TOY_TUNE);
    expect(t.hugo.x).toBe(180);
    expect(t.hugo.y).toBeCloseTo(374.4, 9);
  });

  it("the scripts hold what they are there to lock", () => {
    // Without this a script that never touched a cushion would lock nothing.
    const by = (name: string) => results.find((r) => r.sc.name === name)!.out;
    const five = by("five launches in an empty room").tally;
    expect(five.cushions).toBeGreaterThanOrEqual(4);
    expect(five.rests).toBeGreaterThanOrEqual(3);
    expect(five.hotTicks).toBeGreaterThan(100);
    // The toy slides on after he cools, and step 0 slides with it.
    expect(five.coolMovingTicks).toBeGreaterThan(100);

    const rack = by("the rack").tally;
    expect(rack.pops).toBeGreaterThanOrEqual(5);
    expect(rack.cushions).toBeGreaterThanOrEqual(5);
    expect(rack.bumps).toBeGreaterThanOrEqual(1);

    const push = by("a soft push into a cushion").tally;
    expect(push.pops).toBe(0);
    expect(push.bumps).toBeGreaterThanOrEqual(2);
    expect(push.dummyOffCushion).toBeGreaterThanOrEqual(1);

    expect(by("into a corner").tally.corners).toBeGreaterThanOrEqual(1);

    const soft = by("minimum power, and a glide to rest").tally;
    expect(soft.hotTicks).toBeGreaterThanOrEqual(1);
    expect(soft.hotTicks).toBeLessThan(10);
    expect(soft.rests).toBe(2);

    // The pop at the line: one pop, and his speed at it is the hot speed to the last bit.
    const line = by("a pop exactly at the hot line").tally;
    expect(line.pops).toBe(1);
    expect(line.slowestPop).toBe(hotSpeed(DEFAULT_TUNE));
    expect(line.slowestPop).toBe(toy.hotSpeed(TOY_TUNE));

    // Closer than a hair, far side: the push follows the line between the
    // two centres (he is shoved left). Near side: it has no line to follow
    // and takes the fixed one (he is shoved down).
    const far = by("closer than a hair").first;
    expect(far.x).toBeLessThan(180);
    expect(far.y).toBe(374);
    const near = by("closer than a hair, the near side").first;
    expect(near.x).toBe(180);
    expect(near.y).toBeGreaterThan(374);

    // The cap on substeps is ten, and only this script asks for more.
    expect(by("faster than the game ever goes").tally.mostSubstepsAsked).toBeGreaterThan(10);
    for (const r of results) {
      if (r.sc.maxSpeed === undefined) expect(r.out.tally.mostSubstepsAsked, r.sc.name).toBeLessThanOrEqual(3);
    }

    // A hair under the line it is a bump: nothing pops, and the dummy is knocked on.
    const under = by("a hair under the hot line");
    expect(under.tally.pops).toBe(0);
    expect(under.firstSpeed.thing).toBeGreaterThan(100);

    // The fast dummy needs three substeps a tick where he, standing, needs one.
    expect(Math.ceil((Math.hypot(700, 390) * toy.DT) / 6)).toBe(3);
    expect(by("a dummy faster than he is").tally.dummyOffCushion).toBeGreaterThanOrEqual(1);

    // Only just over the rest speed he is still moving after the tick; only just under, he has stopped.
    expect(by("he is slowed to just over his rest speed").firstSpeed.him).toBeGreaterThan(TOY_TUNE.restSpeed);
    expect(by("he is slowed to just over his rest speed").firstSpeed.him).toBeLessThan(TOY_TUNE.restSpeed + 2 * REST_MARGIN);
    expect(by("he is slowed to just under his rest speed").firstSpeed.him).toBe(0);
    expect(by("a dummy is slowed to just over its rest speed").firstSpeed.thing).toBeGreaterThan(6);
    expect(by("a dummy is slowed to just over its rest speed").firstSpeed.thing).toBeLessThan(6 + 2 * REST_MARGIN);
    expect(by("a dummy is slowed to just under its rest speed").firstSpeed.thing).toBe(0);

    // At every cushion a dummy was put back and stopped, and so was he.
    for (const { name } of CUSHIONS) {
      expect(by(`a dummy pressed into the ${name} cushion`).stoppedAtCushion.thing, name).toBe(true);
      expect(by(`a dummy pressed into the ${name} cushion`).tally.pops, name).toBe(0);
      expect(by(`he is shoved into the ${name} cushion`).stoppedAtCushion.him, name).toBe(true);
    }
  });
});

describe("the lock bites: one changed motion number and the two part", () => {
  /** Every motion number, nudged a little each way where that makes sense. */
  const NUDGES: [keyof Tune, number][] = [
    ["maxSpeed", 901],
    ["maxSpeed", 899],
    ["dragK", DEFAULT_TUNE.dragK * 1.001],
    ["dragK", DEFAULT_TUNE.dragK * 0.999],
    ["friction", 141],
    ["friction", 139],
    ["hotFrac", 0.334],
    ["hotFrac", 0.326],
    ["restSpeed", 15],
    ["restSpeed", 13],
    ["wallRestitution", 0.85],
    ["wallRestitution", 0.83],
    ["bodyRestitution", 0.61],
    ["bodyRestitution", 0.59],
    ["popImpulseScale", 0.56],
    ["popImpulseScale", 0.54],
    ["himRadius", 13.5],
    ["himRadius", 12.5],
    ["maxSubstepTravel", 5.5],
    ["maxSubstepTravel", 6.5],
    ["maxSubsteps", 9],
    ["maxSubsteps", 11],
    ["lightMass", 0.36],
    ["lightMass", 0.34],
    ["lightDragK", 2.5],
    ["lightDragK", 2.3],
    ["lightFriction", 51],
    ["lightFriction", 49],
    ["lightRestSpeed", 7],
    ["lightRestSpeed", 5],
    ["lightWallRestitution", 0.56],
    ["lightWallRestitution", 0.54],
  ];

  for (const [knob, value] of NUDGES) {
    it(`${knob} ${DEFAULT_TUNE[knob]} → ${Math.round(value * 10000) / 10000}`, () => {
      const tune = { ...DEFAULT_TUNE, [knob]: value };
      const parted = SCENARIOS.some((sc) => follow(sc, tune).mismatch !== null);
      expect(parted, `the game with ${knob} = ${value} still follows the toy`).toBe(true);
    });
  }

  it("covers every motion knob of the table, both ways", () => {
    // A knob added to the motion half must get its nudges above.
    const MOTION: (keyof Tune)[] = [
      "maxSpeed",
      "dragK",
      "friction",
      "hotFrac",
      "restSpeed",
      "wallRestitution",
      "bodyRestitution",
      "popImpulseScale",
      "himRadius",
      "maxSubstepTravel",
      "maxSubsteps",
      "lightMass",
      "lightDragK",
      "lightFriction",
      "lightRestSpeed",
      "lightWallRestitution",
    ];
    const NOT_MOTION: (keyof Tune)[] = [
      "pullFullPx",
      "slowShare",
      "pullDir",
      "aimCushions",
      "noShotPx",
      "minPower",
      "lineShowsPx",
      "dummyCount",
      "dummyRespawnTicks",
    ];
    for (const knob of MOTION) {
      const tried = NUDGES.filter(([k]) => k === knob).map(([, v]) => v);
      const now = DEFAULT_TUNE[knob] as number;
      expect(tried.some((v) => v > now), `${knob} is never nudged up`).toBe(true);
      expect(tried.some((v) => v < now), `${knob} is never nudged down`).toBe(true);
    }
    expect(Object.keys(DEFAULT_TUNE).sort()).toEqual([...MOTION, ...NOT_MOTION].sort());
  });
});

describe("the copied half of the table holds the toy's numbers", () => {
  const shell = toyShellTune({ power: TOY_SETTINGS.power, glide: TOY_SETTINGS.glide });

  it("what the toy's shell hands its simulation", () => {
    expect(TOY.maxSpeed).toBe(shell.maxSpeed);
    expect(TOY.dragK).toBe(shell.dragK);
    expect(TOY.friction).toBe(shell.friction);
    expect(TOY.hotFrac).toBe(shell.hotFrac);
    expect(TOY.restSpeed).toBe(shell.restSpeed);
    expect(TOY.wallRestitution).toBe(shell.wallRestitution);
    expect(TOY.bodyRestitution).toBe(shell.bodyRestitution);
    expect(TOY.popImpulseScale).toBe(shell.popImpulseScale);
  });

  it("the glide slider sets the drag: 1.039 at the default, not the toy's bare 1.0", () => {
    expect(TOY.dragK).not.toBe(toy.DEFAULT_TUNE.dragK);
    expect(TOY.dragK).toBeCloseTo(1.0392, 4);
  });

  it("his radius and a light thing's mass", () => {
    const t = toy.createState(1, TOY_TUNE);
    expect(TOY.himRadius).toBe(t.hugo.r);
    expect(TOY.lightMass).toBe(t.dummies[0].m);
  });

  it("the toy's dummies", () => {
    expect(TOY.dummyCount).toBe(toy.DEFAULT_TUNE.dummyCount);
    expect(TOY.dummyRespawnTicks).toBe(toy.DEFAULT_TUNE.respawnTicks);
  });

  it("the tick is the toy's: 60 a second", () => {
    expect(toy.TICK_HZ).toBe(60);
    expect(toy.DT).toBe(1 / 60);
  });

  it("the default table is the two halves and nothing else", () => {
    expect(DEFAULT_TUNE.maxSpeed).toBe(TOY.maxSpeed);
    expect(DEFAULT_TUNE.dragK).toBe(TOY.dragK);
  });
});
