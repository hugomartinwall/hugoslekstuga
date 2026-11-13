import { KINDS } from "../../lib/knuff/content/kinds";
import { DEFAULT_TUNE, mergeTune } from "../../lib/knuff/content/tune";
import { createState, type StartOptions } from "../../lib/knuff/sim/state";
import { step } from "../../lib/knuff/sim/step";
import type { Input, SimEvent, State, Thing, Tune } from "../../lib/knuff/sim/types";

/**
 * What the rule suites share: a room set up by hand.
 *
 * The rules of a night are checked one at a time, on States made for the
 * purpose: he is put where the case needs him, things are put in the room
 * by hand, and `step` is run for a few ticks. No player is involved, so
 * no case depends on what a bot happens to do.
 */

export const REST: Input = { launch: null, pullHeld: false };
export const HOLD: Input = { launch: null, pullHeld: true };

/** A release, with no pull held on the tick of the release. */
export function shot(dx: number, dy: number, power = 1): Input {
  return { launch: { dx, dy, power }, pullHeld: false };
}

/** The default table with some knobs turned. A pace that is named deals its values, as it does in the game. */
export function tuned(over: Partial<Tune> = {}): Tune {
  return mergeTune(DEFAULT_TUNE, over);
}

/**
 * A night already begun in a room with nothing in it but him: no rack,
 * and nothing arrives unless `start.kinds` says so. He stands at the
 * start, landed, with everything full. (The first launch is what begins a
 * night; here it is begun by hand, so that he need not move.)
 */
export function night(tune: Tune, start: StartOptions = {}, seed = 1): State {
  const s = createState(seed, tune, { empty: true, ...start });
  s.phase = "night";
  return s;
}

/** Put a thing in the room by hand, landed and standing still unless `over` says otherwise. */
export function put(s: State, kind: Thing["kind"], x: number, y: number, over: Partial<Thing> = {}): Thing {
  const d: Thing = {
    id: s.nextId++,
    kind,
    x,
    y,
    px: x,
    py: y,
    vx: 0,
    vy: 0,
    wx: 0,
    wy: 0,
    hp: KINDS[kind].hits,
    landTick: -1,
    dazedUntil: 0,
    phase: 0,
    worth0: false,
    ...over,
  };
  s.things.push(d);
  return d;
}

/** Step `n` ticks with no launch, the pull held or not, and return everything that happened. */
export function run(s: State, tune: Tune, n: number, input: Input = REST): SimEvent[] {
  // The same input goes to every tick: a launch here would be fired again and again.
  if (input.launch !== null) throw new Error("run() repeats its input on every tick: use fire() for a launch");
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) step(s, input, tune, events);
  return events;
}

/** One tick, with any input. */
export function tick(s: State, tune: Tune, input: Input = REST): SimEvent[] {
  const events: SimEvent[] = [];
  step(s, input, tune, events);
  return events;
}

/** A release on the first tick, then `n - 1` ticks with no input. */
export function fire(s: State, tune: Tune, launch: Input, n = 1): SimEvent[] {
  const events = tick(s, tune, launch);
  if (n > 1) events.push(...run(s, tune, n - 1));
  return events;
}

/**
 * Step until `done` says so, and return everything that happened. It
 * gives up after `most` ticks: a rule that is broken must fail a case, not
 * hang it (a State that no longer advances would never reach a tick count).
 */
export function until(s: State, tune: Tune, done: (events: SimEvent[]) => boolean, most = 400, input: Input = REST): SimEvent[] {
  if (input.launch !== null) throw new Error("until() repeats its input on every tick: fire the launch first");
  const events: SimEvent[] = [];
  for (let i = 0; i < most && !done(events); i++) step(s, input, tune, events);
  return events;
}

/** The events of one type. */
export function of<T extends SimEvent["type"]>(events: SimEvent[], type: T): Extract<SimEvent, { type: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

/** How far a thing's centre is from his. */
export function distance(s: State, d: { x: number; y: number }): number {
  return Math.hypot(d.x - s.him.x, d.y - s.him.y);
}

/** His speed. */
export function speedOf(s: State): number {
  return Math.hypot(s.him.vx, s.him.vy);
}

/** A scripted player for the suites that want a whole night: a launch every 20 to 70 ticks, a pull held before each. */
export function scripted(scriptSeed: number): () => Input {
  let state = scriptSeed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  let wait = 0;
  return () => {
    const pullHeld = wait < 10;
    if (wait > 0) {
      wait--;
      return { launch: null, pullHeld };
    }
    wait = 20 + Math.floor(next() * 51);
    const a = next() * Math.PI * 2;
    return { launch: { dx: Math.cos(a), dy: Math.sin(a), power: 0.5 + 0.5 * next() }, pullHeld };
  };
}
