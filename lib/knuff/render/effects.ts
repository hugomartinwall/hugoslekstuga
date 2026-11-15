/**
 * Juice: particles, the trail, shake, squash, his blink, and the marks
 * that say what just happened (the thump ring, the wave of a lost heart,
 * floating numbers, the pips turning coral). All of it is fed
 * by SimEvents and by the State after a tick; none of it reaches back into
 * the simulation. Random numbers here are the built-in ones on purpose:
 * this is drawing, and no outcome hangs on it.
 */
import { DT, hotSpeed } from "../sim/physics";
import type { Side, SimEvent, State, Tune } from "../sim/types";
import { C, charmColor } from "./palette";

export type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
export type TrailDot = { x: number; y: number; hot: boolean };
/** A landing's ring on the floor. It closes over the daze, in ticks: the ring is the timer. */
export type Thump = { x: number; y: number; tick: number };
/** The wave of a lost heart: one ring growing to its reach. */
export type Wave = { x: number; y: number; life: number; max: number };
/** A number that floats up from where it was made: a multiplier, or a launch's total. */
export type Float = { x: number; y: number; text: string; life: number; max: number; big: boolean };
/** A battery going off: a ring of squares growing to its reach. `mine`: his (amber), or not (coral). */
export type Blast = { x: number; y: number; life: number; max: number; mine: boolean };
/** A token the thump turned away (decision 31): its id and the tick, for the flick drawn on it. */
export type Flick = { id: number; tick: number };
/** A token the money bag let out, gone where it stood: its ring fades. */
export type Ghost = { x: number; y: number; life: number; max: number };
/** A pickup taken: its tile flies to him and shrinks. */
export type Jump = { x: number; y: number; charm: string; life: number; max: number };
/** The clock turning to a new hour: the hour it turns from, and how far it is. */
export type ClockTurn = { from: number; life: number; max: number };
/** A stretch of floor the polisher has just passed over, and the tick it did: its sheen fades from there. */
export type Sheen = { x0: number; y0: number; x1: number; y1: number; tick: number };

/** The polisher's sheen lasts this long on the floor, in ticks (5 s). */
export const SHEEN_TICKS = 300;
/** A stretch of sheen is laid every this many ticks. */
const SHEEN_EVERY = 6;

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
const BLAST_S = 0.3;
const MAX_FLOATS = 12;
const GHOST_S = 0.45;
const JUMP_S = 0.24;
const CLOCK_TURN_S = 0.3;
/** A plate that fires flashes this long, s. */
const PLATE_FLASH_S = 0.16;
/** How long a token the thump turned shows the way it now rolls, in ticks (0.4 s). */
export const FLICK_TICKS = 24;

export type Effects = {
  readonly particles: Particle[];
  readonly trail: TrailDot[];
  readonly thumps: Thump[];
  readonly waves: Wave[];
  readonly floats: Float[];
  readonly blasts: Blast[];
  /** Tokens the thump has just turned: each shows the way it now rolls (`FLICK_TICKS`). */
  readonly flicks: Flick[];
  /** Where the polisher has been in the last `SHEEN_TICKS`: drawn on the floor, it changes nothing. */
  readonly sheen: Sheen[];
  /** Tokens from the money bag that faded: each ring fades where it stood. */
  readonly ghosts: Ghost[];
  /** Pickups taken: each tile flying to him. */
  readonly jumps: Jump[];
  /** The clock turning to the hour that has just begun, or null (none with reduced motion). */
  clock: ClockTurn | null;
  /** Seconds left of the pips drawn in coral after a refused launch. */
  refused: number;
  /** How far plate `i` is into its flash: 1 as it fires, 0 when it is over (none with reduced motion). */
  plateFlash(i: number): number;
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
  /**
   * The tick the marks timed in ticks (the thump rings, the turned
   * tokens' flicks) are drawn at, given the picture's `tickNow`. While a
   * night runs, `tickNow`. Once it is over the simulation has stopped and
   * its ticks with it, so they go on by the picture's clock: the tick it
   * ended on, and the real time since, in ticks. A ring that was closing
   * as he won finishes closing under the lights, and is gone; frozen half
   * closed, it was the one thing in the picture that looked paused.
   */
  markTick(tickNow: number): number;
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

/** `radiusNow` is his radius after charms in the State the events came from: Wide makes it larger. */
/** The colour a kind's squares fly in when it pops or lands. */
function kindColor(kind: string): string {
  switch (kind) {
    case "token":
      return C.acid;
    case "gum":
      return C.magenta;
    case "battery":
      return C.amber;
    case "envelope":
      return C.paper;
    case "bag":
      return C.mint;
    case "heart":
      return C.coral;
    default:
      return C.ash;
  }
}

export function createEffects(tuneNow: () => Tune, radiusNow: () => number = () => tuneNow().himRadius): Effects {
  const particles: Particle[] = [];
  const trail: TrailDot[] = [];
  const thumps: Thump[] = [];
  const waves: Wave[] = [];
  const floats: Float[] = [];
  const blasts: Blast[] = [];
  const flicks: Flick[] = [];
  /** Seconds left of each plate's flash. */
  const flashes = new Array<number>(10).fill(0);
  const sheen: Sheen[] = [];
  const ghosts: Ghost[] = [];
  const jumps: Jump[] = [];
  /** Where each offered pickup lies, by its thing's id: it has left the room by the time its taking is heard. */
  const pickups = new Map<number, { x: number; y: number }>();
  /** The lane run the sheen is being laid along: where its last stretch ended. */
  let run: { lane: number; dir: number; x: number; tick: number } | null = null;
  let reduced = false;
  /** The tick the night ended on, -1 while it runs; and the real time since, in ticks (`markTick`). */
  let endTick = -1;
  let sinceEnd = 0;
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

  /**
   * A number floating up from (x, y). Two that would overlap do not: a new
   * one is stacked over the ones still in the air, so 'x4' over '13' never
   * reads 'x413' (the play check of steps 4 and 5). Boxes in units, from the
   * face's width at about 1 px a unit.
   */
  function float(x: number, y: number, text: string, big: boolean): void {
    const w = text.length * (big ? 13 : 10) + 4;
    const h = big ? 24 : 19;
    let fy = y;
    for (let tries = 0; tries < 6; tries++) {
      const clash = floats.some((f) => {
        const fw = f.text.length * (f.big ? 13 : 10) + 4;
        const fh = f.big ? 24 : 19;
        return Math.abs(f.x - x) < (w + fw) / 2 && Math.abs(f.y - fy) < (h + fh) / 2;
      });
      if (!clash) break;
      fy -= h;
    }
    floats.push({ x, y: fy, text, life: FLOAT_S, max: FLOAT_S, big });
    if (floats.length > MAX_FLOATS) floats.shift();
  }

  const fx: Effects = {
    particles,
    trail,
    thumps,
    waves,
    floats,
    blasts,
    flicks,
    sheen,
    ghosts,
    jumps,
    clock: null,
    refused: 0,
    squashX: 1,
    squashY: 1,
    squashSide: "",
    facing: 1,
    shake: 0,

    blinking(now) {
      return now < blinkUntil;
    },

    markTick(tickNow) {
      return endTick >= 0 ? endTick + sinceEnd : tickNow;
    },

    plateFlash(i) {
      return Math.max(0, Math.min(1, (flashes[i] ?? 0) / PLATE_FLASH_S));
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
          // A plate that fired says so in its colour, and its segment flashes.
          if (e.charm !== "") {
            burst(e.x, e.y, 10, 170, charmColor(e.charm), 3);
            if (!reduced && e.plate >= 0 && e.plate < flashes.length) flashes[e.plate] = PLATE_FLASH_S;
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
          burst(e.x, e.y, 12, 190, kindColor(e.kind), 3);
          // A blast's pops: no freeze, no multiplier (they are flat), the squares only.
          if (e.source === "blast") return 0;
          burst(e.x, e.y, 5, 110, C.ink, 2);
          if (!reduced) fx.shake = Math.max(fx.shake, 2.5 + Math.min(4, e.n));
          const times = e.chain * e.cushions * e.coin;
          if (times > 1) float(e.x, e.y - 10, `x${times}`, false);
          // Reduced motion keeps the freeze: it is a pause, not motion.
          return e.n === 1 ? FREEZE_FIRST_POP_S : e.n === 5 ? FREEZE_FIFTH_POP_S : 0;
        }
        case "land": {
          thumps.push({ x: e.x, y: e.y, tick: e.tick });
          if (thumps.length > 4) thumps.shift();
          // The ring breaks into eight squares that fly off, from where it is drawn: 4 u outside his circle.
          if (!reduced) {
            const ringR = radiusNow() + 4;
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
        case "tokenTurned":
          // The thump turned it away: a flick of acid squares off it, and its new way drawn on it for a moment.
          flicks.push({ id: e.id, tick: e.tick });
          if (flicks.length > 12) flicks.shift();
          // With reduced motion no squares fly: the way it rolls, drawn on it, holds (§9.5).
          if (!reduced) burst(e.x, e.y, 4, 80, C.acid, 2);
          return 0;
        case "launchEnd":
          // A ring above him (his radius and 20 u), rising: not over him or what he landed by.
          if (e.pops >= 3) float(e.x, e.y - radiusNow() - 20, String(e.total), true);
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
          burst(e.x, e.y, reduced ? 3 : 4, 70, kindColor(e.kind), 2);
          return 0;
        case "hit":
          if (e.kind === "bag") {
            // The money bag: mint squares, and what the hit paid.
            burst(e.x, e.y, e.left > 0 ? 10 : 24, 180, C.mint, 3);
            if (!reduced) fx.shake = Math.max(fx.shake, e.two ? 5 : 3);
            float(e.x, e.y - 14, String(e.points), e.two);
            return 0;
          }
          if (e.kind === "gum") {
            // Gum: magenta squares, and what it paid. A stop is a landing too (its own ring follows).
            burst(e.x, e.y, e.left > 0 ? 8 : 14, 160, C.magenta, 3);
            if (!reduced) fx.shake = Math.max(fx.shake, e.stop ? 3 : 2);
            float(e.x, e.y - 14, String(e.points), false);
            return 0;
          }
          // A hit on the plug: what it paid floats where he met it.
          burst(e.x, e.y, 16, 220, C.ink, 3);
          if (!reduced) fx.shake = Math.max(fx.shake, e.two ? 6 : 4);
          float(e.x, e.y - 14, String(e.points), e.two);
          return 0;
        case "knock":
          // A knock: a spray of amber where they met, along the way it flies.
          burst(e.x, e.y, 10, 180, C.amber, 3);
          if (!reduced) fx.shake = Math.max(fx.shake, 3);
          return 0;
        case "burst":
          // A blast: a ring of squares to its reach, and what it paid, if it was his.
          blasts.push({ x: e.x, y: e.y, life: BLAST_S, max: BLAST_S, mine: e.mine });
          if (blasts.length > 6) blasts.shift();
          burst(e.x, e.y, 24, 320, e.mine ? C.amber : C.coral, 3);
          burst(e.x, e.y, 8, 160, C.ink, 2);
          if (!reduced) fx.shake = Math.max(fx.shake, 6);
          if (e.mine && e.points > 0) float(e.x, e.y - 16, String(e.points), e.points >= 100);
          return 0;
        case "bounce":
          // Off the money bag with no hit: it has had this launch's.
          burst(e.x, e.y, 4, 100, C.mint, 2);
          if (!reduced) fx.shake = Math.max(fx.shake, 1.5);
          return 0;
        case "vBonus":
          // All five of a V in one launch.
          burst(e.x, e.y, 16, 220, C.paper, 3);
          float(e.x, e.y - 18, `V ${e.points}`, true);
          return 0;
        case "bagToken":
          burst(e.x, e.y, 6, 120, C.acid, 2);
          return 0;
        case "fade":
          // A token from the bag stops and fades: its ring fades where it stood, not gone at once.
          ghosts.push({ x: e.x, y: e.y, life: GHOST_S, max: GHOST_S });
          if (ghosts.length > 8) ghosts.shift();
          burst(e.x, e.y, 4, 50, C.acid, 2);
          return 0;
        case "offerTaken": {
          // A plate lights (and flashes); a pickup's tile jumps to him.
          if (e.kind === "plate") {
            if (!reduced && e.plate >= 0 && e.plate < flashes.length) flashes[e.plate] = PLATE_FLASH_S;
          } else {
            const it = e.items[e.item];
            const at = it ? pickups.get(it.thingId) : undefined;
            if (at) jumps.push({ x: at.x, y: at.y, charm: e.charm, life: JUMP_S, max: JUMP_S });
          }
          return 0;
        }
        case "hour":
          // The clock turns to the new hour (the first, at the first launch, has nothing to turn from).
          if (!reduced && e.hour > 0) fx.clock = { from: e.hour - 1, life: CLOCK_TURN_S, max: CLOCK_TURN_S };
          return 0;
        case "heartTaken":
          burst(e.x, e.y, 16, 200, C.coral, 3);
          float(e.x, e.y - 18, "+1", true);
          return 0;
        case "heartGone":
          burst(e.x, e.y, 6, 60, C.coral, 2);
          return 0;
        case "bossBounce":
          burst(e.x, e.y, 4, 100, C.inkMuted, 2);
          if (!reduced) fx.shake = Math.max(fx.shake, 1.5);
          return 0;
        case "bossThrow":
          burst(e.x, e.y, 10, 200, C.coral, 3);
          return 0;
        case "bossArrive":
          burst(e.x, e.y, reduced ? 4 : 12, 140, C.casing, 3);
          if (!reduced) fx.shake = Math.max(fx.shake, 3);
          return 0;
        case "bossDown":
          burst(e.x, e.y, 30, 260, C.ink, 3);
          if (!reduced) fx.shake = Math.max(fx.shake, 8);
          return 0;
        case "over":
          // The simulation stops here: the marks timed in ticks go on by the picture's clock (`markTick`).
          endTick = e.tick;
          sinceEnd = 0;
          return 0;
        default:
          return 0;
      }
    },

    afterTick(s) {
      const dazeTicks = tuneNow().dazeTicks;
      while (thumps.length > 0 && s.tick - thumps[0].tick >= dazeTicks) thumps.shift();
      while (flicks.length > 0 && s.tick - flicks[0].tick >= FLICK_TICKS) flicks.shift();
      // The polisher's sheen: a stretch of floor behind its trailing end every few ticks, while it runs along a lane.
      const b = s.boss;
      if (b.present && b.mode === "lane") {
        const tx = b.x - b.dir * 60;
        if (run && run.lane === b.lane && run.dir === b.dir) {
          if (s.tick - run.tick >= SHEEN_EVERY) {
            sheen.push({ x0: Math.min(run.x, tx), y0: b.y - 30, x1: Math.max(run.x, tx), y1: b.y + 30, tick: s.tick });
            run.x = tx;
            run.tick = s.tick;
          }
        } else run = { lane: b.lane, dir: b.dir, x: tx, tick: s.tick };
      } else if (!b.present || b.mode === "down") run = null;
      while (sheen.length > 0 && s.tick - sheen[0].tick >= SHEEN_TICKS) sheen.shift();
      // Where the offered pickups lie, for the tile that jumps to him when one is taken.
      if (s.offer.open) {
        for (const d of s.things) if (d.kind === "pickup") pickups.set(d.id, { x: d.x, y: d.y });
      } else if (pickups.size > 0) pickups.clear();
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
      // After the end no tick comes to let the thump rings and the flicks go: they go here, on their time.
      if (endTick >= 0) {
        sinceEnd += realDt / DT;
        const at = endTick + sinceEnd;
        const dazeTicks = tuneNow().dazeTicks;
        while (thumps.length > 0 && at - thumps[0].tick >= dazeTicks) thumps.shift();
        while (flicks.length > 0 && at - flicks[0].tick >= FLICK_TICKS) flicks.shift();
      }
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
      for (let i = blasts.length - 1; i >= 0; i--) {
        blasts[i].life -= scaledDt;
        if (blasts[i].life <= 0) blasts.splice(i, 1);
      }
      for (let i = ghosts.length - 1; i >= 0; i--) {
        ghosts[i].life -= realDt;
        if (ghosts[i].life <= 0) ghosts.splice(i, 1);
      }
      for (let i = jumps.length - 1; i >= 0; i--) {
        jumps[i].life -= realDt;
        if (jumps[i].life <= 0) jumps.splice(i, 1);
      }
      if (fx.clock) {
        fx.clock.life -= realDt;
        if (fx.clock.life <= 0) fx.clock = null;
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
      for (let i = 0; i < flashes.length; i++) if (flashes[i] > 0) flashes[i] = Math.max(0, flashes[i] - realDt);
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
      blasts.length = 0;
      flicks.length = 0;
      flashes.fill(0);
      sheen.length = 0;
      run = null;
      ghosts.length = 0;
      jumps.length = 0;
      pickups.clear();
      fx.clock = null;
      fx.refused = 0;
      fx.shake = 0;
      fx.squashX = 1;
      fx.squashY = 1;
      fx.squashSide = "";
      fx.facing = 1;
      endTick = -1;
      sinceEnd = 0;
    },
  };
  return fx;
}
