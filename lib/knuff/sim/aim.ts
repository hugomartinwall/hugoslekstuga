/**
 * The aim line: where a launch would take him.
 *
 * STEP 0: this is the feel toy's preview, moved as it is. It runs his own
 * path through `tune.aimCushions` cushions with the things frozen where
 * they are now, and stops at the first thing he would touch. It is built
 * from the same pieces as `step` (physics.ts), so what the dotted line
 * shows is what the simulation does while nothing else moves.
 *
 * Step 1 replaces the body of `aimLine` with the real `step` run on a copy
 * of the State, so that moving things are shown where they will be when he
 * gets there. The signature and what comes back stay.
 */
import { BOTTOM, DT, LEFT, RIGHT, TOP, applyLaunch, collideWalls, hotSpeed, slow, substepsFor } from "./physics";
import type { Him, Launch, State, Tune } from "./types";

export type AimLine = {
  /** x0, y0, x1, y1, ...: his centre, one point per tick, then where the line ends. */
  pts: number[];
  /** Index into the pairs of `pts` where each cushion was touched. */
  cushions: number[];
  /** Why it stops: a thing in the way, the cushion after the last one shown, he would cool, or time. */
  end: "thing" | "cushion" | "cool" | "time";
  /** The thing he reaches first, or -1. */
  hitId: number;
  /** Would he be fast enough to pop it? */
  hitHot: boolean;
};

/** How far ahead the line looks, in ticks. */
export const AIM_TICKS = 120;

export function aimLine(s: State, launch: Launch, tune: Tune, maxTicks = AIM_TICKS): AimLine {
  const h: Him = { ...s.him };
  const out: AimLine = { pts: [h.x, h.y], cushions: [], end: "time", hitId: -1, hitHot: false };
  if (applyLaunch(h, launch, tune) === 0) return out;
  const hotAt = hotSpeed(tune);
  const r = tune.himRadius;
  let walls = 0;
  for (let t = 0; t < maxTicks; t++) {
    const n = substepsFor(Math.hypot(h.vx, h.vy), tune);
    const sub = DT / n;
    for (let i = 0; i < n; i++) {
      h.x += h.vx * sub;
      h.y += h.vy * sub;
      const touched = collideWalls(h, r, s.room, tune.wallRestitution);
      if (touched !== 0) {
        // A corner is two cushions.
        walls += (touched & (LEFT | RIGHT) ? 1 : 0) + (touched & (TOP | BOTTOM) ? 1 : 0);
        out.cushions.push(out.pts.length / 2);
        if (walls > tune.aimCushions) {
          out.pts.push(h.x, h.y);
          out.end = "cushion";
          return out;
        }
      }
      for (const d of s.things) {
        if (!d.alive) continue;
        if (Math.hypot(d.x - h.x, d.y - h.y) < r + d.r) {
          out.pts.push(h.x, h.y);
          out.end = "thing";
          out.hitId = d.id;
          out.hitHot = Math.hypot(h.vx, h.vy) >= hotAt;
          return out;
        }
      }
    }
    const speed = slow(h, tune.dragK, tune.friction, tune.restSpeed);
    out.pts.push(h.x, h.y);
    if (speed < hotAt) {
      out.end = "cool";
      return out;
    }
  }
  return out;
}
