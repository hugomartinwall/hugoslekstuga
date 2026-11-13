/**
 * The probe: the one look-ahead player, and its five settings (§13.1).
 *
 * It knows nothing about any intruder. To choose a shot it copies the
 * State, tries 36 directions at full power, runs the real `step` 70 ticks
 * for each with no further input, and counts hearts lost and points
 * scored. It takes the best and then adds aim error. It asks the
 * simulation; it has no rule of its own about what a dust bunny does.
 *
 * Every bound of the balance table was set with these players as they
 * stand: the choices below are the spec's, to the last one, and they are
 * the ones the stand-in simulator ran. Change one and the table no longer
 * measures what its bounds were written for.
 *
 *   - Best is fewest hearts lost, then most points; ties at random.
 *   - Not launching is one of the choices, tried over the same 70 ticks.
 *     The probe launches only if a direction beats it.
 *   - The choice is made on the release tick: fire what the line showed.
 *   - Aim error is added after the choice: Gaussian, the stated degrees
 *     its standard deviation.
 *   - Before the first launch nothing moves and no clock runs, so the
 *     first shot is taken at once: straight up if nothing is better.
 *   - Every draw comes from the player's own stream, never the State's.
 *
 * A player's times are in real milliseconds. The driver hands it a clock
 * in sixtieths of a second of real time (a normal tick adds 1, a slowed
 * tick 5), so slow motion gives a player the time it gives a person.
 */
import { KINDS } from "../content/kinds";
import { insertCentre } from "../sim/charms";
import { intruders } from "../sim/night";
import { cloneState } from "../sim/state";
import { step } from "../sim/step";
import type { Input, Launch, SimEvent, State, Tune } from "../sim/types";

/** A player's own random numbers, in [0, 1). */
export type Rand = () => number;

/** What the driver tells a player besides the State. */
export type Now = {
  /** Real time since the first launch, in sixtieths of a second. */
  clock: number;
  /** The tick of his last landing; -1 before the first. */
  landedTick: number;
};

/**
 * A player: asked once before every tick. `aimingAt`, if it has one, says
 * which offered thing (its place in `state.offer.items`) the launch it has
 * just handed over was aimed at; -1 for a launch aimed at the room.
 */
export type Bot = { act(s: State, tune: Tune, now: Now): Input; aimingAt?: () => number };

export const NO_INPUT: Input = { launch: null, pullHeld: false };
export const HOLD: Input = { launch: null, pullHeld: true };

/** Milliseconds as the clock counts them. Every time of §13.1 comes out whole. */
export function ms(n: number): number {
  return Math.round((n * 60) / 1000);
}

export function gauss(r: Rand): number {
  let u = 0;
  while (u < 1e-12) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

export function aimed(angle: number, power: number): Launch {
  return { dx: Math.cos(angle), dy: Math.sin(angle), power };
}

/**
 * Has this thing landed, as a player sees it between two ticks? A thing
 * lands inside the tick that equals its `landTick`, so before that tick is
 * taken it is still announced (and not yet dazed, if it will land close).
 */
export function isDown(s: State, d: { landTick: number }): boolean {
  return d.landTick < s.tick;
}

/**
 * The nearest landed intruder (an offer's tile is not one): how far, and
 * which way. `hurts`: only one that can cost him a heart (not gum, and not
 * a battery that is his).
 */
export function nearestLanded(s: State, hurts = false): { d: number; a: number } | null {
  let best = 1e18;
  let angle = 0;
  let any = false;
  for (const d of s.things) {
    if (!isDown(s, d) || d.kind === "pickup" || d.kind === "heart") continue;
    if (hurts && (!KINDS[d.kind].hurts || d.mine)) continue;
    const dd = (d.x - s.him.x) * (d.x - s.him.x) + (d.y - s.him.y) * (d.y - s.him.y);
    if (dd < best) {
      best = dd;
      angle = Math.atan2(d.y - s.him.y, d.x - s.him.x);
      any = true;
    }
  }
  return any ? { d: Math.sqrt(best), a: angle } : null;
}

// ── Look-ahead: the real step on a copy ───────────────────────────────

/** `took`: the offered thing the launch took, as its place in the offer's items; -1 for none. */
export type Outcome = { points: number; hearts: number; x: number; y: number; took: number };

/**
 * The copy a player looks ahead on. A player plays the room as if nothing
 * were offered unless `offer` says otherwise: its look-ahead does not see
 * the offer at all, so it never values a charm (Coin slot's points, Thick
 * skin's heart) and never takes one on purpose. What it takes, it takes by
 * accident. Only the search for a named offered thing sees the offer.
 */
function lookAheadCopy(s: State, offer: boolean): State {
  const c = cloneState(s);
  if (!offer && c.offer.open) {
    c.offer = { open: false, openTick: -1, armedTick: -1, items: [] };
    c.things = c.things.filter((d) => d.kind !== "pickup");
  }
  return c;
}

/** Which of `s`'s offered things the copy `c`, a launch later, has taken; -1 for none. */
function takenIn(s: State, c: State): number {
  if (!s.offer.open || c.offer.open) return -1;
  const items = s.offer.items;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "plate" ? c.plates[it.plate].charm === it.charm : c.charms.length > s.charms.length && c.charms[s.charms.length] === it.charm) return i;
  }
  return -1;
}

/**
 * Copy the State, give it `launch` (or none), and run the real step `ticks`
 * ticks with no further input. Hearts lost are counted as hearts gone, and
 * a heart a charm healed (Thick skin) is not counted as one won back.
 */
export function rollout(s: State, tune: Tune, launch: Launch | null, ticks: number, offer = false): Outcome {
  const c = lookAheadCopy(s, offer);
  const events: SimEvent[] = [];
  step(c, { launch, pullHeld: false }, tune, events);
  for (let i = 1; i < ticks && (c.phase === "night" || c.phase === "boss"); i++) {
    // Landed in a room with no intruder: nothing announced from now on can land and reach him inside the horizon.
    // (While no offer is out and the love heart has not come there is no tile in the room, and every thing is an
    // intruder; a tile cannot be taken by a mascot who is landed.) The polisher can.
    if (!c.him.hot && !c.boss.present && (c.things.length === 0 || ((c.offer.open || c.night.heartSpent) && intruders(c) === 0))) break;
    events.length = 0;
    step(c, NO_INPUT, tune, events);
  }
  const healed = c.stats.maxHearts - s.stats.maxHearts;
  return { points: c.score - s.score, hearts: s.hearts - c.hearts + healed, x: c.him.x, y: c.him.y, took: offer ? takenIn(s, c) : -1 };
}

/** Ticks until he lands if no input arrives. 0 if he is landed. */
export function ticksToLanding(s: State, tune: Tune): number {
  if (!s.him.hot) return 0;
  const c = cloneState(s);
  const events: SimEvent[] = [];
  let n = 0;
  while (c.him.hot && (c.phase === "night" || c.phase === "boss") && n < 200) {
    events.length = 0;
    step(c, NO_INPUT, tune, events);
    n++;
  }
  return n;
}

export type ProbeEval = {
  /** Directions tried, evenly round the circle. Straight up is one of them. */
  dirs: number;
  /** Ticks each is run. */
  horizon: number;
  /** Powers tried. The probe: full power only. */
  powers: readonly number[];
  /** One lost heart weighs this many points: far more than a launch can score, so hearts come first. */
  heartWeight: number;
  /** A shot the player will not take (the Corner). */
  accept?: (o: Outcome, s: State) => boolean;
  /** Something added to a shot's worth (the Corner). */
  bonus?: (o: Outcome, s: State) => number;
};

/** The probe as §13.1 defines it. */
export const PROBE: ProbeEval = { dirs: 36, horizon: 70, powers: [1], heartWeight: 1e6 };

export type Pick = { launch: Launch | null; angle: number; power: number };

/** The probe's choice. `launch` is null when staying put is at least as good as the best shot. */
export function probePick(s: State, tune: Tune, e: ProbeEval, r: Rand): Pick {
  const stayed = rollout(s, tune, null, e.horizon);
  const stay = stayed.points - e.heartWeight * stayed.hearts;
  let best = -Infinity;
  const ties: { a: number; p: number }[] = [];
  for (const p of e.powers) {
    for (let k = 0; k < e.dirs; k++) {
      // Steps of 10 degrees. Counted from the room's +x, so the 28th is straight up (y grows down the room).
      const a = (k / e.dirs) * Math.PI * 2;
      const o = rollout(s, tune, aimed(a, p), e.horizon);
      if (e.accept && !e.accept(o, s)) continue;
      let v = o.points - e.heartWeight * o.hearts;
      if (e.bonus) v += e.bonus(o, s);
      if (v > best + 1e-9) {
        best = v;
        ties.length = 0;
        ties.push({ a, p });
      } else if (v > best - 1e-9) ties.push({ a, p });
    }
  }
  if (ties.length === 0) return { launch: null, angle: 0, power: 1 };
  const pick = ties[Math.floor(r() * ties.length)];
  const worth = best > stay + 1e-9 || s.phase === "waiting";
  return { launch: worth ? aimed(pick.a, pick.p) : null, angle: pick.a, power: pick.p };
}

/** Where an offered thing is: a pickup's tile, or the middle of a plate's insert. */
function offeredAt(s: State, item: number): { x: number; y: number } | null {
  const it = s.offer.items[item];
  if (!it) return null;
  if (it.kind === "plate") return insertCentre(s, it.plate);
  const d = s.things.find((t) => t.id === it.thingId);
  return d ? { x: d.x, y: d.y } : null;
}

/**
 * "Takes one" (§13.1): the same look-ahead, asked for a launch that takes
 * offered thing `item`. The probe's 36 directions, and one more straight
 * at it (a tile far across the room can fall between two of the 36), all
 * at full power. Of those that take it, the best: fewest hearts lost, then
 * most points. It is taken only if that costs no more hearts than the
 * player's best shot would; null when no launch takes it, or taking it
 * would cost a heart the room can be spared.
 */
export function takePick(s: State, tune: Tune, e: ProbeEval, item: number, r: Rand): Pick | null {
  const at = offeredAt(s, item);
  if (!at) return null;
  const angles: number[] = [];
  for (let k = 0; k < e.dirs; k++) angles.push((k / e.dirs) * Math.PI * 2);
  angles.push(Math.atan2(at.y - s.him.y, at.x - s.him.x));
  let best = -Infinity;
  let bestHearts = Infinity;
  let safest = Infinity;
  const ties: number[] = [];
  const stayed = rollout(s, tune, null, e.horizon);
  safest = stayed.hearts;
  for (const a of angles) {
    const o = rollout(s, tune, aimed(a, 1), e.horizon, true);
    if (o.hearts < safest) safest = o.hearts;
    if (o.took !== item) continue;
    const v = o.points - e.heartWeight * o.hearts;
    if (v > best + 1e-9) {
      best = v;
      bestHearts = o.hearts;
      ties.length = 0;
      ties.push(a);
    } else if (v > best - 1e-9) ties.push(a);
  }
  if (ties.length === 0 || bestHearts > safest) return null;
  const a = ties[Math.floor(r() * ties.length)];
  return { launch: aimed(a, 1), angle: a, power: 1 };
}

// ── The five settings ─────────────────────────────────────────────────

export type Hands = {
  /** "before": releases 3 ticks before the look-ahead says he will land. "after": starts its pull a while after he lands. */
  timing: "before" | "after";
  /** From the landing to the start of the pull, drawn afresh for each shot between the two. Clock units. */
  delayLo: number;
  delayHi: number;
  /** How long the pull is held before the release. Clock units. */
  hold: number;
  /** Aim error, degrees: the standard deviation. */
  errDeg: number;
  /**
   * "Takes one": when an offer is armed it picks one offered thing evenly
   * at random, once for that offer, and goes after it. Otherwise it plays
   * the room as if nothing were offered.
   */
  takes?: boolean;
  /** Aims straight at the nearest thing and never looks ahead. */
  straight: boolean;
  /** Having waited for a pip, it starts its pull this much later. Clock units. */
  pipWait: number;
  /** A pull that finds nothing worth a launch is dropped; it looks again this much later. Clock units. */
  retry: number;
  eval: ProbeEval;
  /** Power of a straight shot. */
  power: number;
};

export const EXPERT: Hands = { timing: "before", delayLo: ms(50), delayHi: ms(50), hold: ms(150), errDeg: 3, straight: false, pipWait: ms(200), retry: ms(100), eval: PROBE, power: 1 };
export const ORDINARY: Hands = { timing: "after", delayLo: ms(200), delayHi: ms(400), hold: ms(250), errDeg: 3, straight: false, pipWait: ms(200), retry: ms(100), eval: PROBE, power: 1 };
export const CAUTIOUS: Hands = { timing: "after", delayLo: ms(400), delayHi: ms(400), hold: ms(600), errDeg: 6, straight: false, pipWait: ms(200), retry: ms(100), eval: PROBE, power: 1 };
export const STRAIGHT: Hands = { ...ORDINARY, straight: true };

/**
 * The Corner: the Ordinary's hands, but it tries 50% and 70% power only
 * and takes only shots that set him down within `zone` u of his resting
 * place in the lower left corner ((21, 459) in the room as built). From
 * outside the zone it takes the shot that ends nearest it.
 */
export function cornerHands(zone = 110, radius = 13, base: Hands = ORDINARY): Hands {
  const from = (s: State, x: number, y: number) => Math.hypot(x - (s.room.left + radius), y - (s.room.bottom - radius));
  return {
    ...base,
    eval: {
      ...base.eval,
      powers: [0.5, 0.7],
      accept: (o, s) => from(s, s.him.x, s.him.y) > zone || from(s, o.x, o.y) <= zone,
      // From outside the zone: get there. A hundredth of a point per unit nearer, so any heart or pop still counts for more.
      bonus: (o, s) => {
        const far = from(s, o.x, o.y);
        return from(s, s.him.x, s.him.y) > zone ? -far * 0.01 + (far <= zone ? 50 : 0) : -far * 0.001;
      },
    },
  };
}

/** How many ticks a hold of `units` will take, by the meter: a slowed tick is 5 units of the clock, a normal one 1. */
function holdTicks(s: State, tune: Tune, units: number): number {
  const slowed = 1 / tune.slowShare;
  // The room slows while something can hurt him: an intruder, or the polisher.
  let meter = intruders(s) > 0 || s.boss.present ? s.slow.meter : 0;
  let u = 0;
  let n = 0;
  while (u < units) {
    u += meter > 0 ? slowed : 1;
    meter--;
    n++;
  }
  return n;
}

/** A player made of the probe and a pair of hands. */
export function handBot(r: Rand, o: Hands): Bot {
  let pulling = false;
  let pullStart = 0;
  let landSeen = -2;
  let landClock = 0;
  let delay = 0;
  let hadNoPip = false;
  let pipClock = -1e9;
  let retryAt = -1e9;
  let predictedFor = -1;
  let predictedLanding = 0;
  let gaveUpFlight = -1;
  /** The offer it is after (by the tick it opened), the thing in it, and what the last launch was aimed at. */
  let wantFor = -1;
  let want = -1;
  let aimingAt = -1;

  /** The offered thing it is after, if it takes one and an offer is armed; -1 otherwise. */
  const wanted = (s: State): number => {
    if (!o.takes || !s.offer.open || s.offer.armedTick < 0) return -1;
    if (wantFor !== s.offer.openTick) {
      wantFor = s.offer.openTick;
      want = Math.floor(r() * s.offer.items.length);
    }
    return want;
  };

  const choose = (s: State, tune: Tune): Launch | null => {
    let a: number;
    let p: number;
    aimingAt = -1;
    const item = o.straight ? -1 : wanted(s);
    const taking = item >= 0 ? takePick(s, tune, o.eval, item, r) : null;
    if (taking) {
      aimingAt = item;
      a = taking.angle + gauss(r) * ((o.errDeg * Math.PI) / 180);
      return aimed(a, taking.power);
    }
    if (o.straight) {
      const near = nearestLanded(s);
      if (near === null) return null;
      a = near.a;
      p = o.power;
    } else {
      const pick = probePick(s, tune, o.eval, r);
      if (!pick.launch) return null;
      a = pick.angle;
      p = pick.power;
    }
    a += gauss(r) * ((o.errDeg * Math.PI) / 180);
    return aimed(a, p);
  };

  return {
    aimingAt: () => aimingAt,
    act(s, tune, now) {
      const clock = now.clock;
      if (s.phase === "waiting") {
        // Nothing moves until the first launch, so there is no clock to wait on: the first shot is simply taken.
        return { launch: choose(s, tune) ?? aimed(-Math.PI / 2, 1), pullHeld: false };
      }
      if (!s.him.hot && now.landedTick !== landSeen) {
        landSeen = now.landedTick;
        landClock = clock;
        delay = o.delayLo + Math.floor(r() * (o.delayHi - o.delayLo + 1));
      }
      if (s.pips <= 0) {
        // No pip: the line is grey and a release would be refused. It waits for one.
        hadNoPip = true;
        pulling = false;
        return NO_INPUT;
      }
      if (hadNoPip) {
        hadNoPip = false;
        pipClock = clock;
      }
      if (pulling) {
        if (clock - pullStart >= o.hold) {
          pulling = false;
          const l = choose(s, tune);
          if (l) return { launch: l, pullHeld: false };
          retryAt = clock + o.retry;
          if (s.him.hot) gaveUpFlight = s.launch.id;
          return NO_INPUT;
        }
        return HOLD;
      }
      // Nothing to hit, and nothing it is after: it waits. (While the polisher is in the room there is always something.)
      if (intruders(s) === 0 && !s.boss.present && wanted(s) < 0) return NO_INPUT;
      if (clock < retryAt || clock < pipClock + o.pipWait) return NO_INPUT;
      if (s.him.hot) {
        if (o.timing !== "before" || gaveUpFlight === s.launch.id) return NO_INPUT;
        if (predictedFor !== s.launch.id) {
          predictedFor = s.launch.id;
          predictedLanding = s.tick + ticksToLanding(s, tune);
        }
        // Start the pull so that the release falls 3 ticks before the landing.
        if (predictedLanding - s.tick <= 3 + holdTicks(s, tune, o.hold)) {
          pulling = true;
          pullStart = clock;
          return HOLD;
        }
        return NO_INPUT;
      }
      if (clock >= landClock + delay) {
        pulling = true;
        pullStart = clock;
        return HOLD;
      }
      return NO_INPUT;
    },
  };
}
