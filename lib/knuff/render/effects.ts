/**
 * Juice: particles, the trail, shake, squash, his blink, and the marks
 * that say what just happened (the thump ring, the wave of a lost heart,
 * floating numbers, the pips turning coral). All of it is fed
 * by SimEvents and by the State after a tick; none of it reaches back into
 * the simulation. Random numbers here are the built-in ones on purpose:
 * this is drawing, and no outcome hangs on it.
 */
import { hotSpeed } from "../sim/physics";
import type { Side, SimEvent, State, Tune } from "../sim/types";
import { C } from "./palette";

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
export type TrailDot = { x: number; y: number; hot: boolean };
/** A landing's ring on the floor. It closes over the daze, in ticks: the ring is the timer. */
export type Thump = { x: number; y: number; tick: number };
/** The wave of a lost heart: one ring growing to its reach. */
export type Wave = { x: number; y: number; life: number; max: number };
/** A number that floats up from where it was made: a multiplier, or a launch's total. */
export type Float = { x: number; y: number; text: string; life: number; max: number; big: boolean };

/** Afterimages kept, as in the toy. */
const TRAIL_LENGTH = 16;
const MAX_PARTICLES = 220;
/** A freeze on the first pop of a launch and on its fifth, in seconds. None on the others. */
const FREEZE_FIRST_POP_S = 0.028;
const FREEZE_FIFTH_POP_S = 0.06;
/** A refused launch: the pips are coral this long, in seconds. */
const REFUSED_S = 0.2;
/** The ring's eight squares fly off this long when he lands, in seconds. */
const FRAGMENT_S = 0.15;
const WAVE_S = 0.35;
const FLOAT_S = 0.8;
const MAX_FLOATS = 12;

export type Effects = {
  readonly particles: Particle[];
  readonly trail: TrailDot[];
  readonly thumps: Thump[];
  readonly waves: Wave[];
  readonly floats: Float[];
  /** Seconds left of the pips drawn in coral after a refused launch. */
  refused: number;
  /** Squash and stretch of his body, and the cushion it is anchored at ("" for a launch). */
  squashX: number;
  squashY: number;
  squashSide: Side | "";
  /** 1 facing right, -1 facing left. */
  facing: 1 | -1;
  /** How hard the picture shakes now, px. */
  shake: number;
  /** Is he blinking at `now`? */
  blinking(now: number): boolean;
  /** Take in one event of a tick. Returns the freeze it asks for, in seconds. */
  onEvent(e: SimEvent): number;
  /** After every tick: the trail and which way he faces. */
  afterTick(s: State): void;
  /** Once a frame. `scaledDt` slows with the room, so sparks slow with it. */
  update(realDt: number, scaledDt: number, now: number): void;
  /** Motion reduced: no shake, no trail, no squash, a third of the particles. */
  setReduced(reduced: boolean): void;
  reset(): void;
};

export function createEffects(tuneNow: () => Tune): Effects {
  const particles: Particle[] = [];
  const trail: TrailDot[] = [];
  const thumps: Thump[] = [];
  const waves: Wave[] = [];
  const floats: Float[] = [];
  let reduced = false;
  let blinkAt = -1;
  let blinkUntil = 0;

  function burst(x: number, y: number, n: number, speed: number, color: string, size: number): void {
    if (reduced) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.35 + Math.random() * 0.65);
      const max = 0.25 + Math.random() * 0.3;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color, size });
    }
    if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
  }

  function float(x: number, y: number, text: string, big: boolean): void {
    floats.push({ x, y, text, life: FLOAT_S, max: FLOAT_S, big });
    if (floats.length > MAX_FLOATS) floats.shift();
  }

  const fx: Effects = {
    particles,
    trail,
    thumps,
    waves,
    floats,
    refused: 0,
    squashX: 1,
    squashY: 1,
    squashSide: "",
    facing: 1,
    shake: 0,

    blinking(now) {
      return now < blinkUntil;
    },

    onEvent(e) {
      const tune = tuneNow();
      switch (e.type) {
        case "launch":
          if (!reduced) {
            fx.squashX = 1.18;
            fx.squashY = 0.84;
            fx.squashSide = "";
          }
          return 0;
        case "cushion": {
          const s01 = Math.min(1, Math.max(0, e.speed / tune.maxSpeed));
          if (e.speed >= hotSpeed(tune)) {
            burst(e.x, e.y, 4, 90 + 160 * s01, C.ink, 2);
            if (!reduced) fx.shake = Math.max(fx.shake, 1.2 + 2.2 * s01);
          }
          // Squash against the cushion he hit.
          if (!reduced) {
            const side = e.side === "left" || e.side === "right";
            fx.squashX = side ? 0.78 : 1.16;
            fx.squashY = side ? 1.16 : 0.78;
            fx.squashSide = e.side;
          }
          return 0;
        }
        case "pop": {
          burst(e.x, e.y, 12, 190, e.kind === "token" ? C.acid : C.ash, 3);
          burst(e.x, e.y, 5, 110, C.ink, 2);
          if (!reduced) fx.shake = Math.max(fx.shake, 2.5 + Math.min(4, e.n));
          const times = e.chain * e.cushions;
          if (times > 1) float(e.x, e.y - 10, `x${times}`, false);
          // Reduced motion keeps the freeze: it is a pause, not motion.
          return e.n === 1 ? FREEZE_FIRST_POP_S : e.n === 5 ? FREEZE_FIFTH_POP_S : 0;
        }
        case "land": {
          thumps.push({ x: e.x, y: e.y, tick: e.tick });
          if (thumps.length > 4) thumps.shift();
          // The ring breaks into eight squares that fly off.
          if (!reduced) {
            const ringR = tune.himRadius + 4;
            for (let i = 0; i < 8; i++) {
              const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
              particles.push({
                x: e.x + Math.cos(a) * ringR,
                y: e.y + Math.sin(a) * ringR,
                vx: Math.cos(a) * 150,
                vy: Math.sin(a) * 150,
                life: FRAGMENT_S,
                max: FRAGMENT_S,
                color: C.ink,
                size: 2.4,
              });
            }
          }
          return 0;
        }
        case "launchEnd":
          if (e.pops >= 3) float(e.x, e.y - tune.himRadius - 14, String(e.total), true);
          return 0;
        case "hurt":
          waves.push({ x: e.x, y: e.y, life: WAVE_S, max: WAVE_S });
          burst(e.x, e.y, 14, 230, C.coral, 3);
          if (!reduced) fx.shake = Math.max(fx.shake, 7);
          return 0;
        case "refused":
          fx.refused = REFUSED_S;
          return 0;
        case "arrive":
          // The outline snaps solid, with four dust squares.
          burst(e.x, e.y, reduced ? 3 : 4, 70, e.kind === "token" ? C.acid : C.ash, 2);
          return 0;
        default:
          return 0;
      }
    },

    afterTick(s) {
      const dazeTicks = tuneNow().dazeTicks;
      while (thumps.length > 0 && s.tick - thumps[0].tick >= dazeTicks) thumps.shift();
      const h = s.him;
      const sp = Math.hypot(h.vx, h.vy);
      if (sp > 40) {
        if (!reduced) {
          trail.push({ x: h.x, y: h.y, hot: h.hot });
          if (trail.length > TRAIL_LENGTH) trail.shift();
        }
        // The facing changes only while he is clearly moving sideways: a
        // shot straight up the room must not flip him.
        if (Math.abs(h.vx) > 30) fx.facing = h.vx > 0 ? 1 : -1;
      } else if (trail.length > 0) {
        trail.shift();
      }
    },

    update(realDt, scaledDt, now) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= scaledDt;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.x += p.vx * scaledDt;
        p.y += p.vy * scaledDt;
        p.vx *= 1 - Math.min(1, scaledDt * 3);
        p.vy *= 1 - Math.min(1, scaledDt * 3);
      }
      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i].life -= scaledDt;
        if (waves[i].life <= 0) waves.splice(i, 1);
      }
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.life -= realDt;
        if (f.life <= 0) {
          floats.splice(i, 1);
          continue;
        }
        if (!reduced) f.y -= 26 * realDt;
      }
      fx.refused = Math.max(0, fx.refused - realDt);
      fx.shake = Math.max(0, fx.shake - realDt * 26);
      fx.squashX += (1 - fx.squashX) * Math.min(1, realDt * 16);
      fx.squashY += (1 - fx.squashY) * Math.min(1, realDt * 16);
      if (blinkAt < 0) blinkAt = now + 2500;
      if (now > blinkAt) {
        blinkUntil = now + 120;
        blinkAt = now + 2200 + Math.random() * 2600;
      }
    },

    setReduced(next) {
      reduced = next;
      if (reduced) {
        trail.length = 0;
        fx.shake = 0;
        fx.squashX = 1;
        fx.squashY = 1;
        fx.squashSide = "";
      }
    },

    reset() {
      particles.length = 0;
      trail.length = 0;
      thumps.length = 0;
      waves.length = 0;
      floats.length = 0;
      fx.refused = 0;
      fx.shake = 0;
      fx.squashX = 1;
      fx.squashY = 1;
      fx.squashSide = "";
      fx.facing = 1;
    },
  };
  return fx;
}
