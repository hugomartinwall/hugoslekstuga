import { describe, expect, it } from "vitest";
import * as toy from "../fixtures/knuff/toy-sim";
import { DARK_PLATES } from "../../lib/knuff/content/charms";
import { KINDS } from "../../lib/knuff/content/kinds";
import { DEFAULT_TUNE, TOY, TOY_SETTINGS } from "../../lib/knuff/content/tune";
import { hotSpeed } from "../../lib/knuff/sim/physics";
import { createState } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Launch, SimEvent, State, Tune } from "../../lib/knuff/sim/types";

/**
 * The feel lock. The owner set how the mascot moves by hand, in a toy.
 * `test/fixtures/knuff/toy-sim.ts` is that toy's simulation, copied
 * untouched. This suite runs it beside the game's and asks for the same
 * positions and speeds: not close, the same numbers to the last bit.
 *
 * The game departs from the toy in one way on purpose: there is no cool
 * slide. The moment he is not hot he lands, where the toy slides on. So
 * the lock holds for every tick he is hot in the game, and on the tick he
 * lands the two must agree that he has just stopped being a weapon. After
 * that they part: before a launch from rest the toy's mascot is set down
 * where the game's stands, and the next flight is held to the toy again.
 *
 * How the two are set side by side, as the spec has it: an empty room
 * (`start.empty`: nothing arrives) with all ten plates dark
 * (`start.plates`: with the starting plates lit, the Bumper on plate 0
 * would kick him where the toy does nothing) and nothing offered
 * (`start.offers`: an offer's tiles would lie on the floor, and a charm
 * taken would change him), the room's edges set to the
 * toy's (`start.room`: 0, 0, 360, 480; the toy has no cushion thickness), the toy
 * run with the tune its shell hands it (pips off), and the toy's mascot
 * moved to the game's start, (180, 374), before the first launch (the
 * toy's own is (180, 374.4)).
 *
 * Some scripts put things in the room by hand. They are dust bunnies that
 * do not walk (`bunnySpeed` 0) and have a speed of their own, as the wave
 * of a lost heart gives them: such a thing slows and bounces exactly as
 * one of the toy's dummies does, and popping it costs him what popping a
 * dummy costs. The toy's dummies are given the dust bunny's radius.
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
const HOT_AT = toy.hotSpeed(TOY_TUNE);

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

/** How close to a line the "only just" scripts go, u/s. */
const MARGIN = 5e-4;

type Put = { at: [number, number]; v?: [number, number] };

type Scenario = {
  name: string;
  /** Launches by tick. Every script launches on tick 0: nothing in the game moves until the first launch. */
  script: Record<number, Launch>;
  ticks: number;
  /** Where he is put before the first tick. Without it both start at the game's start. */
  him?: [number, number];
  /** Things put in the room by hand, with a speed of their own. Without it the room is empty. */
  things?: Put[];
  /** A launch speed for both sides, where a script needs one the game never reaches. */
  maxSpeed?: number;
  /** Knobs of the game's own half that the script needs. The toy has no such knob. */
  game?: Partial<Tune>;
  /** His last pop is said to have come on this tick, so that `popHotTicks` holds him hot from the start. */
  contactAt?: number;
  /** The script is over when he lands: after that the things in the room go their own two ways. */
  untilLanding?: boolean;
};

/** Things scattered beside a launch's line, each off to one side of it and moving its own way. */
function beside(from: [number, number], degrees: number, n: number): Put[] {
  const a = (degrees * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = -Math.sin(a);
  const out: Put[] = [];
  for (let k = 1; k <= n; k++) {
    // Off the line by 7 to 16 u, on alternate sides: he clips each one, and the knock has a share along both axes.
    const off = (k % 2 === 0 ? 1 : -1) * (4 + 3 * k);
    const along = 46 * k;
    out.push({
      at: [from[0] + ux * along - uy * off, from[1] + uy * along + ux * off],
      v: [(k % 2 === 0 ? -1 : 1) * (18 + 7 * k), (k % 3 === 0 ? -1 : 1) * (11 + 5 * k)],
    });
  }
  return out;
}

const SCENARIOS: Scenario[] = [
  {
    // The launches the spec names, in an empty room. The last two are one
    // flight: a full-power launch, and a relaunch 20 ticks into it.
    name: "five launches in an empty room",
    ticks: 1000,
    script: {
      0: at(90, 1), // full power straight up
      200: at(37, 1), // full power at 37 degrees
      400: at(135, 0.7), // 70% into a corner
      600: at(250, 0.5), // 50%: the shortest shot the game fires
      800: at(300, 1),
      820: at(20, 1), // a relaunch 20 ticks into a flight
    },
  },
  {
    // The two flights the spec gives figures for, with no cushion in the
    // way: a full-power launch is hot for 51 ticks and 474 u.
    name: "a full launch in the open",
    him: [30, 450],
    ticks: 60,
    script: { 0: { dx: 300, dy: -420, power: 1 } },
  },
  {
    // And the shortest shot the game fires, 50%, for 18 ticks and 112 u.
    name: "the shortest shot in the open",
    ticks: 30,
    script: { 0: at(90, 0.5) },
  },
  {
    // Dead into the top-left corner: two cushions in one substep.
    name: "into a corner",
    ticks: 300,
    script: { 0: { dx: 13 - 180, dy: 13 - 374, power: 1 }, 150: at(315, 0.8) },
  },
  {
    // Faster than the game ever goes. Above 3,600 u/s a tick would take
    // more than ten substeps, and the cap binds: this is the only place
    // that number can be seen.
    name: "faster than the game ever goes",
    maxSpeed: 6000,
    ticks: 300,
    script: { 0: at(63, 1), 70: at(200, 0.9), 140: at(301, 1) },
  },
  // The hot line. He is hot while his speed is at or above a third of the
  // launch speed: each of these is slowed, in its first tick, to a
  // twentieth of a percent over that speed or under it. Over, he flies on
  // for a tick more; under, he lands at once. (No launch in the game is
  // this soft: the script lowers the game's minimum power to fire it.)
  ...[1, -1].map((side): Scenario => {
    const speed = speedThatSlowsTo(HOT_AT + side * MARGIN, TOY_TUNE.dragK, TOY_TUNE.friction);
    return {
      name: `he is slowed to just ${side > 0 ? "over" : "under"} the hot line`,
      ticks: 6,
      game: { minPower: 0.01 },
      script: { 0: { dx: 3, dy: -4, power: speed / TOY_TUNE.maxSpeed } },
    };
  }),
  {
    // A launch at exactly the hot share of the launch speed, with a thing
    // 2 u ahead: he reaches it in his first tick at exactly the hot speed,
    // and it pops. The knock takes him under the line, and he lands there.
    name: "a pop exactly at the hot line",
    things: [{ at: [180, 374 - 13 - 8 - 2] }],
    ticks: 6,
    game: { minPower: 0.01 },
    untilLanding: true,
    script: { 0: { dx: 0, dy: -1, power: 0.33 } },
  },
  {
    // One hair under the line he is no weapon: nothing pops, in the toy or
    // in the game. (In the toy he bumps it. In the game he never flew.)
    name: "a hair under the hot line",
    things: [{ at: [180, 374 - 13 - 8 - 2] }],
    ticks: 6,
    game: { minPower: 0.01 },
    untilLanding: true,
    script: { 0: { dx: 0, dy: -1, power: 0.33 - 1e-9 } },
  },
  // Oblique pops. He clips things that stand to one side of his line and
  // move their own way, so every knock has a share along x and a share
  // along y, and a closing speed that is not his own speed.
  ...[30, 45, 60].map(
    (degrees): Scenario => ({
      name: `oblique pops at ${degrees} degrees`,
      him: [40, 440],
      things: beside([40, 440], degrees, 5),
      ticks: 120,
      game: { bunnySpeed: 0 },
      untilLanding: true,
      script: { 0: at(degrees, 1) },
    }),
  ),
  {
    // A relaunch while hot, into more of them: the chain goes on.
    name: "oblique pops, and a relaunch into more",
    him: [40, 440],
    things: [...beside([40, 440], 52, 3), { at: [150, 262], v: [-20, 30] }, { at: [158, 186], v: [15, -25] }],
    ticks: 120,
    game: { bunnySpeed: 0 },
    untilLanding: true,
    script: { 0: at(52, 1), 9: at(71, 1) },
  },
  // A thing with a speed of its own slows as the toy's dummies do, and
  // comes to rest when a tick's slowing leaves it under 6 u/s: each of
  // these is slowed, in its first tick, to just over that speed or under.
  ...[1, -1].map((side): Scenario => {
    const speed = speedThatSlowsTo(6 + side * MARGIN, 2.4, 50);
    return {
      name: `a thing is slowed to just ${side > 0 ? "over" : "under"} its rest speed`,
      him: [60, 440],
      things: [{ at: [180, 200], v: [speed * 0.6, speed * 0.8] }],
      ticks: 12,
      game: { bunnySpeed: 0 },
      script: { 0: at(180, 0.5) },
    };
  }),
  {
    // The substeps of a tick are sized for the fastest mover, and that is
    // not always him: a thing crossing the room at 800 u/s and off a
    // cushion, while he flies at half that and then stands.
    name: "a thing faster than he is",
    him: [60, 440],
    things: [{ at: [100, 100], v: [700, 390] }],
    ticks: 200,
    game: { bunnySpeed: 0 },
    script: { 0: at(180, 0.5) },
  },
  // `popHotTicks` above 0: after a pop he stays hot whatever his speed, and
  // slides as the toy slides. There the toy's rest speed still acts: the
  // tick its slowing stops him is his landing. Each of these says his last
  // pop came on tick 0 and is slowed, in its first tick, to just over the
  // rest speed or under it.
  ...[1, -1].map((side): Scenario => {
    const speed = speedThatSlowsTo(TOY_TUNE.restSpeed + side * MARGIN, TOY_TUNE.dragK, TOY_TUNE.friction);
    return {
      name: `kept hot by a pop, he is slowed to just ${side > 0 ? "over" : "under"} his rest speed`,
      ticks: 5,
      game: { popHotTicks: 15, minPower: 0.001 },
      contactAt: 0,
      script: { 0: { dx: 3, dy: -4, power: speed / TOY_TUNE.maxSpeed } },
    };
  }),
  {
    // The same from a real pop: a thing thrown at him takes nearly all his
    // speed, and he crawls on inside the window until the slowing stops him.
    name: "kept hot by a pop, he crawls to rest",
    things: [{ at: [180, 374 - 13 - 8 - 2], v: [0, 800] }],
    ticks: 40,
    game: { popHotTicks: 15, minPower: 0.01, bunnySpeed: 0 },
    untilLanding: true,
    script: { 0: { dx: 0, dy: -1, power: 0.34 } },
  },
];

// ── The comparison ────────────────────────────────────────────────────

type Tally = {
  pops: number;
  /** Pops whose knock changed his speed along both axes. */
  obliquePops: number;
  /** His speed at the slowest pop; -1 with none. */
  slowestPop: number;
  cushions: number;
  corners: number;
  /** Landings, and how each came: after the tick's slowing, at a cushion, or on a pop. */
  landings: number;
  landedAtCushion: number;
  landedOnPop: number;
  /** Landings where the toy's slowing had stopped him dead: he lands standing still. */
  landedAtRest: number;
  /** Launches too soft to be hot at all: he never left the spot. */
  neverFlew: number;
  thingOffCushion: number;
  hotTicks: number;
  /** Ticks he was hot in the game while slower than the hot line (only inside the `popHotTicks` window). */
  hotUnderTheLine: number;
  hotRelaunches: number;
  /** The most substeps the toy's rule asks for in a tick, before the cap. */
  mostSubstepsAsked: number;
};

type Outcome = {
  mismatch: string | null;
  tally: Tally;
  /** The tick of each landing. */
  landedAt: number[];
  /** How far from where the script began he stood at his first landing, u. */
  firstFlight: number;
  /** After the first tick: his speed in the toy, and the first thing's (-1 with none). */
  firstSpeed: { him: number; thing: number };
};

function putThing(e: State, x: number, y: number, vx: number, vy: number): void {
  e.things.push({ id: e.nextId++, kind: "bunny", x, y, px: x, py: y, vx, vy, wx: 0, wy: 0, hp: 1, landTick: -1, dazedUntil: 0, phase: 0 });
}

/** Run one scenario on both simulations. Stops at the first value that differs. */
function follow(sc: Scenario, engineTune: Tune): Outcome {
  const count = sc.things ? sc.things.length : 0;
  const speed = sc.maxSpeed === undefined ? {} : { maxSpeed: sc.maxSpeed };
  const toyTune: toy.Tune = { ...TOY_TUNE, dummyCount: count, ...speed };
  const tune: Tune = { ...engineTune, ...sc.game, ...speed };

  const t = toy.createState(20261111, toyTune);
  const e = createState(20261111, tune, { room: TOY_ROOM, empty: true, plates: DARK_PLATES, offers: false });
  // The toy's mascot is moved to the game's start (or both to the script's).
  if (sc.him) [e.him.x, e.him.y] = sc.him;
  t.hugo.x = e.him.x;
  t.hugo.y = e.him.y;
  if (sc.contactAt !== undefined) e.him.lastContactTick = sc.contactAt;
  sc.things?.forEach(({ at: [x, y], v }, i) => {
    const [vx, vy] = v ?? [0, 0];
    putThing(e, x, y, vx, vy);
    const d = t.dummies[i];
    d.x = x;
    d.y = y;
    d.vx = vx;
    d.vy = vy;
    d.r = KINDS.bunny.radius;
  });

  const tally: Tally = {
    pops: 0,
    obliquePops: 0,
    slowestPop: -1,
    cushions: 0,
    corners: 0,
    landings: 0,
    landedAtCushion: 0,
    landedOnPop: 0,
    landedAtRest: 0,
    neverFlew: 0,
    thingOffCushion: 0,
    hotTicks: 0,
    hotUnderTheLine: 0,
    hotRelaunches: 0,
    mostSubstepsAsked: 0,
  };
  const landedAt: number[] = [];
  const from = { x: e.him.x, y: e.him.y };
  const out = { firstFlight: -1 };
  const firstSpeed = { him: 0, thing: -1 };
  const events: SimEvent[] = [];
  const differs = (tick: number, what: string, engine: unknown, toyValue: unknown): Outcome => ({
    mismatch: `${sc.name}, tick ${tick}: ${what} is ${String(engine)} in the game and ${String(toyValue)} in the toy`,
    tally,
    landedAt,
    firstFlight: out.firstFlight,
    firstSpeed,
  });
  /** Cushions the game has counted since the last launch, one per cushion touched. */
  let cushionsThisLaunch = 0;
  /** Does anything in the room still follow the toy? Once he has landed among things, they go two ways. */
  let thingsFollow = true;

  for (let k = 0; k < sc.ticks; k++) {
    const launch = sc.script[k] ?? null;
    if (launch) {
      if (e.him.hot) tally.hotRelaunches++;
      else {
        // A launch from rest. The toy has slid on since he landed: its
        // mascot is set down where the game's stands.
        t.hugo.x = e.him.x;
        t.hugo.y = e.him.y;
        t.hugo.vx = 0;
        t.hugo.vy = 0;
      }
    }
    const before = { x: e.him.x, y: e.him.y, vx: e.him.vx, vy: e.him.vy };
    const vBefore = t.dummies.map((d) => [d.vx, d.vy]);
    toy.step(t, { launch }, toyTune);
    events.length = 0;
    step(e, { launch, pullHeld: false }, tune, events);
    if (k === 0) {
      firstSpeed.him = Math.hypot(t.hugo.vx, t.hugo.vy);
      if (t.dummies.length > 0) firstSpeed.thing = Math.hypot(t.dummies[0].vx, t.dummies[0].vy);
    }

    if (e.tick !== t.tick) return differs(k, "the tick", e.tick, t.tick);
    if (e.launch.id !== t.flight.id) return differs(k, "the launch count", e.launch.id, t.flight.id);
    if (events.some((ev) => ev.type === "launch")) cushionsThisLaunch = 0;
    const cushions = events.filter((ev) => ev.type === "cushion").length;
    cushionsThisLaunch += cushions;
    tally.cushions += cushions;
    if (cushions >= 2) tally.corners++;
    const landing = events.find((ev) => ev.type === "land");

    // The same pops, in the same order, at the same speed: up to the
    // landing. (After a pop that lands him the toy flies on, slow.)
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
    tally.pops += pops.length;

    if (e.him.hot) {
      // He is hot in the game: the same place and the same speed as in the
      // toy. Equal as numbers: the game does not keep the sign of a zero
      // speed (step.ts, "close up"), the toy does, and no rule can tell.
      if (e.him.x !== t.hugo.x) return differs(k, "his x", e.him.x, t.hugo.x);
      if (e.him.y !== t.hugo.y) return differs(k, "his y", e.him.y, t.hugo.y);
      if (e.him.vx !== t.hugo.vx) return differs(k, "his vx", e.him.vx, t.hugo.vx);
      if (e.him.vy !== t.hugo.vy) return differs(k, "his vy", e.him.vy, t.hugo.vy);
      if (cushionsThisLaunch !== t.flight.walls) return differs(k, "cushions this launch", cushionsThisLaunch, t.flight.walls);
      tally.hotTicks++;
      if (Math.hypot(e.him.vx, e.him.vy) < hotSpeed(tune)) tally.hotUnderTheLine++;
      if (pops.length > 0 && e.him.vx !== before.vx && e.him.vy !== before.vy && !launch) tally.obliquePops += pops.length;
    } else if (landing) {
      // The tick he lands. His speed is gone, and he is where he stopped.
      if (e.him.vx !== 0 || e.him.vy !== 0) return differs(k, "his speed after he landed", `${e.him.vx}, ${e.him.vy}`, "0, 0");
      tally.landings++;
      landedAt.push(k);
      if (out.firstFlight < 0) out.firstFlight = Math.hypot(e.him.x - from.x, e.him.y - from.y);
      const atCushion = cushions > 0 && events.indexOf(landing) > events.findIndex((ev) => ev.type === "cushion");
      const onPop = pops.length > 0;
      // A launch under the hot line is no flight: he lands where he stood.
      const neverFlew = launch !== null && e.him.x === before.x && e.him.y === before.y;
      if (neverFlew) tally.neverFlew++;
      else if (onPop) tally.landedOnPop++;
      else if (atCushion) tally.landedAtCushion++;
      else {
        // He landed after the tick's slowing: the whole tick's flight was
        // the toy's, so he stands exactly where the toy's mascot is.
        if (e.him.x !== t.hugo.x) return differs(k, "his x as he lands", e.him.x, t.hugo.x);
        if (e.him.y !== t.hugo.y) return differs(k, "his y as he lands", e.him.y, t.hugo.y);
        if (t.hugo.vx === 0 && t.hugo.vy === 0) tally.landedAtRest++;
      }
    }
    // The line itself. While only speed keeps him hot, the two agree on
    // every tick about whether he is a weapon: the tick the game lands is
    // the tick the toy calls him cool.
    if (tune.popHotTicks === 0 && e.him.hot !== t.hugo.hot) return differs(k, "hot", e.him.hot, t.hugo.hot);
    // Inside the `popHotTicks` window the game holds him hot under the
    // line. He lands when the toy's slowing stops him, and not a tick
    // sooner: a game that says he has landed while the toy's mascot still
    // moves has stopped him early.
    if (tune.popHotTicks > 0 && landing && !pops.length && cushions === 0 && sc.contactAt !== undefined) {
      if (t.hugo.vx !== 0 || t.hugo.vy !== 0) return differs(k, "his speed as he lands inside the window", "0, 0", `${t.hugo.vx}, ${t.hugo.vy}`);
    }

    // Every thing, slot by slot, for as long as the room follows the toy.
    // On the tick he lands among things it no longer does: the toy's mascot
    // slides on and shoves what the game's, standing still, leaves alone.
    if (landing && sc.untilLanding) thingsFollow = false;
    if (thingsFollow) {
      let slot = 0;
      for (let i = 0; i < t.dummies.length; i++) {
        const b = t.dummies[i];
        if (!b.alive) continue;
        const a = e.things[slot++];
        if (!a || a.id !== b.id) return differs(k, `thing ${i}`, a ? a.id : "gone", b.id);
        if (a.x !== b.x) return differs(k, `thing ${i} x`, a.x, b.x);
        if (a.y !== b.y) return differs(k, `thing ${i} y`, a.y, b.y);
        if (a.vx !== b.vx) return differs(k, `thing ${i} vx`, a.vx, b.vx);
        if (a.vy !== b.vy) return differs(k, `thing ${i} vy`, a.vy, b.vy);
        // A thing that turned round at a cushion (for the tally only).
        const [vx0, vy0] = vBefore[i];
        const atEdge = b.x <= b.r + 1 || b.x >= toy.FIELD_W - b.r - 1 || b.y <= b.r + 1 || b.y >= toy.FIELD_H - b.r - 1;
        if (atEdge && (vx0 * b.vx < 0 || vy0 * b.vy < 0)) tally.thingOffCushion++;
      }
      if (slot !== e.things.length) return differs(k, "the number of things", e.things.length, slot);
    }
    const asked = Math.ceil((Math.hypot(t.hugo.vx, t.hugo.vy) * toy.DT) / 6);
    if (asked > tally.mostSubstepsAsked) tally.mostSubstepsAsked = asked;

    if (landing && sc.untilLanding) break;
  }
  return { mismatch: null, tally, landedAt, firstFlight: out.firstFlight, firstSpeed };
}

describe("feel lock: while he is hot the game moves as the toy moves", () => {
  const results = SCENARIOS.map((sc) => ({ sc, out: follow(sc, DEFAULT_TUNE) }));

  for (const { sc, out } of results) {
    it(`${sc.name}: every hot tick equals the toy's`, () => {
      expect(out.mismatch).toBeNull();
    });
  }

  it("both start where the game starts: (180, 374), not the toy's (180, 374.4)", () => {
    const e = createState(1, DEFAULT_TUNE, { room: TOY_ROOM, empty: true, plates: DARK_PLATES, offers: false });
    expect([e.him.x, e.him.y]).toEqual([180, 374]);
    expect(e.things).toEqual([]);
    const t = toy.createState(1, TOY_TUNE);
    expect(t.hugo.x).toBe(180);
    expect(t.hugo.y).toBeCloseTo(374.4, 9);
  });

  it("the scripts hold what they are there to lock", () => {
    // Without this a script that never touched a cushion would lock nothing.
    const by = (name: string) => results.find((r) => r.sc.name === name)!.out;
    const five = by("five launches in an empty room");
    expect(five.tally.cushions).toBeGreaterThanOrEqual(5);
    expect(five.tally.hotTicks).toBeGreaterThan(150);
    // Five flights, five landings: the relaunch is the same flight going on.
    expect(five.tally.landings).toBe(5);
    expect(five.tally.hotRelaunches).toBe(1);
    // Where the toy slid on for a second and more, the game stands still.
    expect(five.tally.landedAtRest).toBe(0);
    expect(five.tally.landedAtCushion + five.tally.landedOnPop).toBeLessThan(5);

    // The spec's two figures: a full-power launch in the open is hot for
    // 51 ticks and 474 u, a 50% launch for 18 ticks and 112 u. (He lands at
    // the end of the last of them: ticks are counted from 0.)
    const full = by("a full launch in the open");
    expect(full.tally.cushions).toBe(0);
    expect(full.landedAt).toEqual([50]);
    expect(full.firstFlight).toBeCloseTo(474.29, 2);
    const short = by("the shortest shot in the open");
    expect(short.tally.cushions).toBe(0);
    expect(short.landedAt).toEqual([17]);
    expect(short.firstFlight).toBeCloseTo(111.55, 2);

    expect(by("into a corner").tally.corners).toBeGreaterThanOrEqual(1);

    // The cap on substeps is ten, and only this script asks for more.
    expect(by("faster than the game ever goes").tally.mostSubstepsAsked).toBeGreaterThan(10);
    for (const r of results) {
      if (r.sc.maxSpeed === undefined) expect(r.out.tally.mostSubstepsAsked, r.sc.name).toBeLessThanOrEqual(3);
    }

    // The hot line after the tick's slowing. Only just over it he is still
    // hot when the tick ends, and lands a tick later; only just under, he
    // lands in his first tick.
    const over = by("he is slowed to just over the hot line");
    expect(over.firstSpeed.him).toBeGreaterThan(HOT_AT);
    expect(over.firstSpeed.him).toBeLessThan(HOT_AT + 2 * MARGIN);
    expect(over.landedAt).toEqual([1]);
    const under = by("he is slowed to just under the hot line");
    expect(under.firstSpeed.him).toBeLessThan(HOT_AT);
    expect(under.firstSpeed.him).toBeGreaterThan(HOT_AT - 2 * MARGIN);
    expect(under.landedAt).toEqual([0]);

    // The hot line at a contact: one pop, at the hot speed to the last
    // bit, and the knock lands him. A hair under it nothing pops.
    const line = by("a pop exactly at the hot line");
    expect(line.tally.pops).toBe(1);
    expect(line.tally.slowestPop).toBe(hotSpeed(DEFAULT_TUNE));
    expect(line.tally.slowestPop).toBe(HOT_AT);
    expect(line.tally.landedOnPop).toBe(1);
    expect(line.landedAt).toEqual([0]);
    const hair = by("a hair under the hot line");
    expect(hair.tally.pops).toBe(0);
    expect(hair.tally.hotTicks).toBe(0);
    expect(hair.tally.neverFlew).toBe(1);
    expect(hair.firstFlight).toBe(0);
    // In the toy the same shot is a bump: the dummy is knocked on.
    expect(hair.firstSpeed.thing).toBeGreaterThan(100);

    // Oblique pops: several a script, each changing his speed along both
    // axes, and he is still hot after them.
    for (const degrees of [30, 45, 60]) {
      const oblique = by(`oblique pops at ${degrees} degrees`).tally;
      expect(oblique.pops, `${degrees}`).toBeGreaterThanOrEqual(3);
      expect(oblique.obliquePops, `${degrees}`).toBeGreaterThanOrEqual(3);
      expect(oblique.hotTicks, `${degrees}`).toBeGreaterThan(10);
    }
    const chain = by("oblique pops, and a relaunch into more").tally;
    expect(chain.hotRelaunches).toBe(1);
    expect(chain.pops).toBeGreaterThanOrEqual(4);

    // Only just over its rest speed a thing is still moving after the tick; only just under, it has stopped.
    expect(by("a thing is slowed to just over its rest speed").firstSpeed.thing).toBeGreaterThan(6);
    expect(by("a thing is slowed to just over its rest speed").firstSpeed.thing).toBeLessThan(6 + 2 * MARGIN);
    expect(by("a thing is slowed to just under its rest speed").firstSpeed.thing).toBe(0);

    // The fast thing needs three substeps a tick where he, at half the launch speed, needs two.
    expect(Math.ceil((Math.hypot(700, 390) * toy.DT) / 6)).toBe(3);
    expect(Math.ceil((450 * toy.DT) / 6)).toBe(2);
    expect(by("a thing faster than he is").tally.thingOffCushion).toBeGreaterThanOrEqual(1);

    // Kept hot by a pop: only just over the rest speed he is still moving
    // after the tick, under the line and hot; only just under, he has
    // landed, standing still.
    const restOver = by("kept hot by a pop, he is slowed to just over his rest speed");
    expect(restOver.firstSpeed.him).toBeGreaterThan(TOY_TUNE.restSpeed);
    expect(restOver.firstSpeed.him).toBeLessThan(TOY_TUNE.restSpeed + 2 * MARGIN);
    expect(restOver.tally.hotUnderTheLine).toBe(1);
    expect(restOver.landedAt).toEqual([1]);
    expect(restOver.tally.landedAtRest).toBe(1);
    const restUnder = by("kept hot by a pop, he is slowed to just under his rest speed");
    expect(restUnder.firstSpeed.him).toBe(0);
    expect(restUnder.landedAt).toEqual([0]);
    expect(restUnder.tally.landedAtRest).toBe(1);

    // And from a real pop: he crawls on for some ticks, hot and far under the line, and lands at rest inside the window.
    const crawl = by("kept hot by a pop, he crawls to rest");
    expect(crawl.tally.pops).toBe(1);
    expect(crawl.tally.hotUnderTheLine).toBeGreaterThanOrEqual(8);
    expect(crawl.tally.landedAtRest).toBe(1);
    expect(crawl.landedAt[0]).toBeLessThan(15);
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

  it("covers every motion knob of the copied half, both ways", () => {
    // A knob added to the copied half must be put on one of these two
    // lists, and one that moves him must get its nudges above. (The knobs
    // the game adds are not the toy's and are not listed here.)
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
    ];
    for (const knob of MOTION) {
      const tried = NUDGES.filter(([k]) => k === knob).map(([, v]) => v);
      const now = DEFAULT_TUNE[knob] as number;
      expect(tried.some((v) => v > now), `${knob} is never nudged up`).toBe(true);
      expect(tried.some((v) => v < now), `${knob} is never nudged down`).toBe(true);
    }
    expect(Object.keys(TOY).sort()).toEqual([...MOTION, ...NOT_MOTION].sort());
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

  it("the tick is the toy's: 60 a second", () => {
    expect(toy.TICK_HZ).toBe(60);
    expect(toy.DT).toBe(1 / 60);
  });

  it("the default table is the two halves and nothing else", () => {
    expect(DEFAULT_TUNE.maxSpeed).toBe(TOY.maxSpeed);
    expect(DEFAULT_TUNE.dragK).toBe(TOY.dragK);
  });
});
