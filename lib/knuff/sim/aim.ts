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
 * plate that is its first cushion.
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
   * Why it stops: on the first thing he would pop or hit (the polisher's
   * plug is thing 0); on the polisher, where he would bounce off its casing;
   * on its pad, which throws him and costs a heart; at the cushion after the
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
};

/** How far ahead the line looks, in ticks. */
export const AIM_TICKS = 120;

const NO_INPUT: Input = { launch: null, pullHeld: false };

/**
 * The line for `launch` from this State. It runs through `tune.aimCushions`
 * cushions and stops at the next. The State is left as it was.
 */
export function aimLine(s: State, launch: Launch, tune: Tune, maxTicks = AIM_TICKS): AimLine {
  const out: AimLine = { pts: [s.him.x, s.him.y], cushions: [], cushionPts: [], end: "time", hitId: -1, takes: -1, plate: -1, charm: "" };
  const copy = cloneState(s);
  // With no pip the real step refuses the launch, and the grey line of an
  // empty hand would have nothing to show: the copy is given one.
  if (copy.pips <= 0) copy.pips = 1;
  const launches = copy.launch.id;
  const events: SimEvent[] = [];
  for (let t = 0; t < maxTicks; t++) {
    events.length = 0;
    step(copy, t === 0 ? { launch, pullHeld: false } : NO_INPUT, tune, events);
    // No launch came of it (it has no direction, or the night is over): there is no line.
    if (copy.launch.id === launches) return out;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.type === "offerTaken") {
        out.takes = e.item;
        out.charm = e.charm;
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
          return out;
        }
      } else if (e.type === "pop") {
        out.pts.push(e.hx, e.hy);
        out.end = "thing";
        out.hitId = e.id;
        return out;
      } else if (e.type === "hit") {
        out.pts.push(e.x, e.y);
        out.end = "thing";
        out.hitId = e.id;
        return out;
      } else if (e.type === "bossBounce") {
        out.pts.push(e.x, e.y);
        out.end = "polisher";
        return out;
      } else if (e.type === "bossThrow") {
        out.pts.push(e.x, e.y);
        out.end = "pad";
        return out;
      } else if (e.type === "land") {
        out.pts.push(e.x, e.y);
        out.end = "land";
        return out;
      }
    }
    out.pts.push(copy.him.x, copy.him.y);
    // The night ended under him (morning came): the line stops where he was.
    if (copy.phase === "over") return out;
  }
  return out;
}
