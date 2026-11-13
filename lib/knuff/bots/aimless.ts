/**
 * The players who do not aim (§13.1), all at full power.
 *
 * They never hold a pull, so they get no slow motion and their delays are
 * plain ticks. They are in the table as ceilings: a night that one of
 * them gets through is a night that asks nothing of a player.
 *
 * Two kiters. The table's Kiter flees: it launches away from the nearest
 * thing that hurts. The tie-break studies' kiter flung at random; the
 * script prints it beside the other, with no bound.
 */
import { KINDS } from "../content/kinds";
import { DT } from "../sim/physics";
import { cloneState } from "../sim/state";
import { step } from "../sim/step";
import type { State, Tune } from "../sim/types";
import { NO_INPUT, aimed, isDown, nearestLanded, type Bot, type Rand } from "./probe";

const anywhere = (r: Rand, power: number) => ({ launch: aimed(r() * Math.PI * 2, power), pullHeld: false });

/** One launch in a random direction, then nothing. */
export function onceBot(r: Rand): Bot {
  let done = false;
  return {
    act() {
      if (done) return NO_INPUT;
      done = true;
      return anywhere(r, 1);
    },
  };
}

/** A random direction on the tick a pip is there. */
export function spamBot(r: Rand, power = 1): Bot {
  return {
    act(s) {
      if (s.pips <= 0) return NO_INPUT;
      return anywhere(r, power);
    },
  };
}

/** A random direction whenever he is about to land, so he never lands while pips last. */
export function flickerBot(r: Rand, power = 1): Bot {
  return {
    act(s, tune) {
      if (s.pips <= 0) return NO_INPUT;
      if (s.phase === "waiting" || !s.him.hot) return anywhere(r, power);
      const c = cloneState(s);
      step(c, NO_INPUT, tune, []);
      if (!c.him.hot) return anywhere(r, power);
      return NO_INPUT;
    },
  };
}

/** A random direction every `period` ticks (0.7 s), if a pip is there. */
export function rhythmBot(r: Rand, period = 42, power = 1): Bot {
  let next = 0;
  return {
    act(s) {
      if (s.phase === "waiting") {
        next = period;
        return anywhere(r, power);
      }
      if (s.tick < next) return NO_INPUT;
      next += period;
      if (s.pips <= 0) return NO_INPUT;
      return anywhere(r, power);
    },
  };
}

/** Will a rolling token touch him within `ticks` if he stays where he is? Its real path, cushions included. */
export function tokenOnCourse(s: State, tune: Tune, ticks: number): boolean {
  const room = s.room;
  const r = KINDS.token.radius;
  const reach = s.stats.radius + r;
  for (const d of s.things) {
    if (d.kind !== "token" || !isDown(s, d)) continue;
    let x = d.x;
    let y = d.y;
    let vx = d.vx;
    let vy = d.vy;
    const wait = Math.max(0, d.dazedUntil - s.tick);
    for (let i = wait; i < ticks; i++) {
      x += vx * DT;
      y += vy * DT;
      if (x < room.left + r) {
        x = room.left + r;
        vx = -vx;
      } else if (x > room.right - r) {
        x = room.right - r;
        vx = -vx;
      }
      if (y < room.top + r) {
        y = room.top + r;
        vy = -vy;
      } else if (y > room.bottom - r) {
        y = room.bottom - r;
        vy = -vy;
      }
      const dx = x - s.him.x;
      const dy = y - s.him.y;
      if (dx * dx + dy * dy < reach * reach) return true;
    }
  }
  return false;
}

export type Kite = {
  /** It reacts when something that hurts is this close, dazed or not, u. */
  trigger: number;
  /** Or when a token is this many ticks from hitting him. */
  tokenTicks: number;
  /** And launches this long after. Clock units; it holds no pull, so they are ticks. */
  react: number;
  power: number;
  /** "away": from the nearest thing that hurts, within 20 degrees either side. "random": anywhere. */
  mode: "random" | "away";
};

/** The table's Kiter. */
export const KITER: Kite = { trigger: 55, tokenTicks: 48, react: 15, power: 1, mode: "away" };
/** The tie-break studies' kiter. */
export const KITER_RANDOM: Kite = { ...KITER, mode: "random" };

/**
 * One launch to start, in a random direction. Then it sits until
 * something that hurts is within 55 u, or a token is 48 ticks from hitting
 * him, and 250 ms later launches.
 */
export function kiterBot(r: Rand, o: Kite = KITER): Bot {
  let fireAt = -1;
  return {
    act(s: State, tune: Tune, now) {
      if (s.phase === "waiting") return anywhere(r, o.power);
      if (fireAt >= 0) {
        if (now.clock < fireAt || s.pips <= 0) return NO_INPUT;
        fireAt = -1;
        let a = r() * Math.PI * 2;
        if (o.mode === "away") {
          const near = nearestLanded(s);
          // 0.7 rad across: 20 degrees either side of straight away.
          if (near) a = near.a + Math.PI + (r() - 0.5) * 0.7;
        }
        return { launch: aimed(a, o.power), pullHeld: false };
      }
      if (s.him.hot) return NO_INPUT;
      const near = nearestLanded(s);
      if ((near && near.d <= o.trigger) || tokenOnCourse(s, tune, o.tokenTicks)) fireAt = now.clock + o.react;
      return NO_INPUT;
    },
  };
}
