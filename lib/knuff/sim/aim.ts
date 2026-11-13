/**
 * The aim line: where a launch would take him.
 *
 * It is the real `step` run on a copy of the State: copy, apply the
 * launch, and step with no further input. So moving things are shown
 * where they will be when he gets there, and there is no second motion
 * loop to keep in step with the first. The copy's events say what
 * happened; then the copy and the events are thrown away.
 *
 * It also says which charm the top bar names while the pull is held
 * (§4.2, §9.3): the offered thing the launch would take, or else the lit
 * plate that is its first cushion. The words come before the choice, so
 * the copy is run on past the line's end to the end of the launch (within
 * the same 120 ticks): a launch that pops a dust bunny and then takes the
 * plate behind it is named as well. On that same run it learns whether the
 * launch meets the polisher's pad after the line has ended, which will
 * cost a heart: the end is then marked in coral, as the pad's own is.
 *
 * When the first thing is a battery (he knocks it), the copy is stepped on
 * until that battery bursts: its path is the second line, and where it
 * bursts the broken ring of its blast (§4.2).
 */
import { cloneState } from "./state";
import { step } from "./step";
import type { Input, Launch, SimEvent, State, Tune } from "./types";

export type AimLine = {
  /** x0, y0, x1, y1, ...: his centre, one point per tick, then where the line ends. */
  pts: number[];
  /** Index into the pairs of `pts` of the point that follows each cushion touched. */
  cushions: number[];
  /** Where he touched each cushion, as x, y pairs, in order. The last is where the line ends when `end` is "cushion". */
  cushionPts: number[];
  /**
   * Why it stops: on the first thing he would pop, hit, knock, be stopped
   * by or bounce off (the money bag; the polisher's plug is thing 0); on the polisher, where he would bounce off its casing;
   * on its pad, which costs a heart and throws him (on his last heart the
   * night ends there, and nothing throws him); at the cushion after the
   * last one it runs through; where he would land; or after `maxTicks`.
   */
  end: "thing" | "polisher" | "pad" | "cushion" | "land" | "time";
  /** The thing he reaches first (0 for the polisher's plug), or -1. He is always hot when he reaches it. */
  hitId: number;
  /** The offered thing the launch would take, as its place in `state.offer.items`; -1 for none. */
  takes: number;
  /** The plate of its first cushion; -1 if the line ends before one. */
  plate: number;
  /**
   * The charm the top bar names: the offered one it would take, or else
   * the one on the lit plate that is its first cushion; "" for none.
   */
  charm: string;
  /** The launch meets the pad after the line has ended (within the 120 ticks), and that will cost a heart: his last one too. */
  padAfter: boolean;
  /**
   * The line ends on a battery he knocks: its centre from the knock, one
   * point a tick, to where it bursts (x0, y0, x1, y1, ...). Empty for any
   * other line.
   */
  battery: number[];
  /** Where that battery bursts, as [x, y]: the middle of the second line's ring. Empty if it does not burst inside the look. */
  burst: number[];
};

/** How far ahead the line looks, in ticks. */
export const AIM_TICKS = 120;

const NO_INPUT: Input = { launch: null, pullHeld: false };

/**
 * The line for `launch` from this State. It runs through `tune.aimCushions`
 * cushions and stops at the next. The State is left as it was.
 */
export function aimLine(s: State, launch: Launch, tune: Tune, maxTicks = AIM_TICKS): AimLine {
  const out: AimLine = {
    pts: [s.him.x, s.him.y],
    cushions: [],
    cushionPts: [],
    end: "time",
    hitId: -1,
    takes: -1,
    plate: -1,
    charm: "",
    padAfter: false,
    battery: [],
    burst: [],
  };
  const copy = cloneState(s);
  // With no pip the real step refuses the launch, and the grey line of an
  // empty hand would have nothing to show: the copy is given one.
  if (copy.pips <= 0) copy.pips = 1;
  const launches = copy.launch.id;
  const events: SimEvent[] = [];
  /** The line is still being drawn; once it has ended, the copy runs on only to see what the launch takes. */
  let drawing = true;
  /** The battery the line ended on, followed until it bursts; -1 for none, or once it has. */
  let following = -1;
  // A battery knocked late in the look is followed past it, to its burst: a knock's time is short.
  const most = maxTicks + tune.batteryKnockTicks + 1;
  for (let t = 0; t < most; t++) {
    if (t >= maxTicks && following < 0) break;
    events.length = 0;
    step(copy, t === 0 ? { launch, pullHeld: false } : NO_INPUT, tune, events);
    // No launch came of it (it has no direction, or the night is over): there is no line.
    if (copy.launch.id === launches) return out;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      // Past the look's end only the knocked battery is followed, to its burst.
      if (t >= maxTicks && e.type !== "burst") continue;
      if (e.type === "burst" && e.id === following) {
        out.battery.push(e.x, e.y);
        out.burst.push(e.x, e.y);
        following = -1;
      } else if (e.type === "offerTaken") {
        out.takes = e.item;
        out.charm = e.charm;
      } else if (e.type === "hurt" && e.by === "polisher") {
        // The pad takes a heart. It is read here and not off the throw, because on his last heart
        // the night ends where he stands and nothing throws him: the heart that ends the night is shown too.
        if (drawing) {
          out.pts.push(e.x, e.y);
          out.end = "pad";
          drawing = false;
        } else out.padAfter = true;
      } else if (!drawing) {
        // The line has ended: the copy runs on only to see what the launch takes, and whether the pad takes a heart.
      } else if (e.type === "cushion") {
        if (out.plate < 0) {
          out.plate = e.plate;
          // A plate this launch takes is named for what it takes; any other lit first plate for what it carries.
          if (out.takes < 0) out.charm = copy.plates[e.plate].charm;
        }
        out.cushions.push(out.pts.length / 2);
        out.cushionPts.push(e.x, e.y);
        if (out.cushionPts.length / 2 > tune.aimCushions) {
          out.pts.push(e.x, e.y);
          out.end = "cushion";
          drawing = false;
        }
      } else if (e.type === "pop" || e.type === "hit") {
        // What a blast pops or hits is not what he reaches.
        if (e.source === "blast") continue;
        out.pts.push(e.type === "pop" ? e.hx : e.x, e.type === "pop" ? e.hy : e.y);
        out.end = "thing";
        out.hitId = e.id;
        drawing = false;
      } else if (e.type === "knock") {
        // A battery first: the line ends on it, and the battery's own line begins.
        out.pts.push(e.hx, e.hy);
        out.end = "thing";
        out.hitId = e.id;
        drawing = false;
        following = e.id;
        out.battery.push(e.x, e.y);
      } else if (e.type === "bounce") {
        // Off the money bag with no hit (this launch has hit it already): he bounces off a thing, and the line ends on it.
        out.pts.push(e.x, e.y);
        out.end = "thing";
        out.hitId = e.id;
        drawing = false;
      } else if (e.type === "bossBounce") {
        out.pts.push(e.x, e.y);
        out.end = "polisher";
        drawing = false;
      } else if (e.type === "bossThrow") {
        // The pad throws him and takes no heart: he is invulnerable, hot with padHurtsHot off, or landed where the machine has just put him.
        out.pts.push(e.x, e.y);
        out.end = "pad";
        drawing = false;
      } else if (e.type === "land") {
        out.pts.push(e.x, e.y);
        out.end = "land";
        drawing = false;
      }
    }
    if (drawing) out.pts.push(copy.him.x, copy.him.y);
    if (following >= 0) {
      const b = copy.things.find((d) => d.id === following);
      if (b && b.hp > 0) out.battery.push(b.x, b.y);
      else following = -1;
    }
    // The night ended under him (morning came): the line stops where he was.
    if (copy.phase === "over") return out;
    // The line has ended, and so has the launch (he landed, or the pad threw him: a launch of its own), and its battery has burst.
    if (!drawing && following < 0 && (!copy.launch.active || copy.launch.id !== launches + 1)) return out;
  }
  return out;
}
