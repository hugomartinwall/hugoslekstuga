/**
 * Knuff — the feel-toy simulation.
 *
 * Pure and deterministic: a fixed 60 Hz step over plain data, a seeded
 * generator kept inside the state, no DOM, no clock, no Math.random.
 * The same state + the same inputs give the same state, bit for bit —
 * which is what lets a pilot bot stand in for a hand later, and what
 * lets the aim preview be the simulation itself run on a copy.
 *
 * The toy has one room, Hugo, and a handful of dummies that pop when a
 * fast Hugo hits them and respawn a moment later. Slow motion is NOT
 * in here: the shell simply feeds fewer ticks per second while a pull
 * is held, so dt never changes.
 *
 * Units: field units ("u"). The room is 360 x 480 u on every device.
 */

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const FIELD_W = 360;
export const FIELD_H = 480;

/** Every number a hand might want to change lives here. */
export type Tune = {
  /** Launch speed at a full pull, u/s. */
  maxSpeed: number;
  /** Launch speed at the shortest pull that counts, as a share of maxSpeed. */
  minPowerFrac: number;
  /** Exponential drag on Hugo, 1/s. Higher = he loses speed sooner. */
  dragK: number;
  /** Constant deceleration on Hugo, u/s^2 — what actually brings him to rest. */
  friction: number;
  /** Share of maxSpeed above which Hugo is the weapon ("hot"). */
  hotFrac: number;
  /** Below this speed Hugo is at rest, u/s. */
  restSpeed: number;
  wallRestitution: number;
  bodyRestitution: number;
  /** Share of the collision impulse Hugo feels when the thing he hit pops. */
  popImpulseScale: number;
  pipMax: number;
  pipRefillTicks: number;
  dummyCount: number;
  respawnTicks: number;
};

export const DEFAULT_TUNE: Tune = {
  maxSpeed: 900,
  minPowerFrac: 0.35,
  dragK: 1.0,
  friction: 140,
  hotFrac: 0.33,
  restSpeed: 14,
  wallRestitution: 0.84,
  bodyRestitution: 0.6,
  popImpulseScale: 0.55,
  pipMax: 3,
  pipRefillTicks: 66,
  dummyCount: 6,
  respawnTicks: 80,
};

export type Hugo = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  /** Fast enough to be the weapon. */
  hot: boolean;
  /** Ticks spent at rest (0 while moving). */
  restTicks: number;
};

export type Dummy = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
  alive: boolean;
  /** Ticks until it comes back (only while !alive). */
  respawnIn: number;
  /** Tick it last appeared — the renderer scales it in from this. */
  bornTick: number;
};

/** One launch and what came of it. */
export type Flight = {
  id: number;
  startTick: number;
  /** The ringed dummy when the launch happened, or -1. */
  targetAtLaunch: number;
  /** Has the called-shot verdict for this launch been given yet? */
  resolved: boolean;
  /** Cushions touched since launch. */
  walls: number;
  /**
   * Was the line on the ringed dummy at release: would this launch, as
   * fired, pop it before anything else (within two cushions, while hot)?
   */
  aimTrue: boolean;
};

export type SimEvent =
  /** `counted`: this launch is scored as a called shot (the ringed dummy was reachable in a straight line and the launch was at it or close beside it). */
  | {
      t: "launch";
      x: number;
      y: number;
      power: number;
      counted: boolean;
      /** Distance to the ringed dummy at release, in units; -1 with no ring. */
      ringDist: number;
      /** Launch direction minus the bearing to the ringed dummy, degrees, signed; 0 with no ring. */
      aimErr: number;
      /** His speed just before this launch (0 = from rest). */
      speedBefore: number;
    }
  | { t: "wall"; x: number; y: number; speed: number; hot: boolean }
  | { t: "bump"; x: number; y: number; speed: number }
  | { t: "pop"; x: number; y: number; id: number; chain: number; target: boolean; speed: number }
  | { t: "cool"; x: number; y: number }
  | { t: "rest"; x: number; y: number }
  | { t: "spawn"; id: number; x: number; y: number }
  | { t: "called"; hit: boolean; flight: number }
  | { t: "pip"; pips: number };

export type State = {
  tick: number;
  /** mulberry32 state — the only source of randomness. */
  rng: number;
  hugo: Hugo;
  dummies: Dummy[];
  nextId: number;
  pips: number;
  pipTimer: number;
  flight: Flight;
  /** Pops since Hugo last cooled; relaunching while hot keeps it going. */
  chain: number;
  /** The ringed dummy to hit first, or -1 while none is chosen. */
  targetId: number;
  called: { attempts: number; hits: number; last: number[] };
  totals: { launches: number; pops: number };
  /** What happened during the last step — the shell turns these into sound and sparks. */
  events: SimEvent[];
};

/** One discrete action: a direction (need not be unit length) and a power in (0, 1]. */
export type Launch = { dx: number; dy: number; power: number };
export type Input = { launch: Launch | null };

export const NO_INPUT: Input = { launch: null };

const HUGO_R = 13;
const DUMMY_M = 0.35;
const DUMMY_DRAG_K = 2.4;
const DUMMY_FRICTION = 50;
const DUMMY_WALL_RESTITUTION = 0.55;
/** A substep never moves a body further than this, so nothing tunnels. */
const MAX_SUBSTEP_TRAVEL = 6;
const MAX_SUBSTEPS = 10;

// ── Randomness ────────────────────────────────────────────────────────

/** mulberry32: advances the state in place and returns a float in [0, 1). */
function rand(s: State): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ── Setup ─────────────────────────────────────────────────────────────

export function createState(seed: number, tune: Tune): State {
  const s: State = {
    tick: 0,
    rng: seed >>> 0,
    hugo: {
      x: FIELD_W / 2,
      y: FIELD_H * 0.78,
      vx: 0,
      vy: 0,
      r: HUGO_R,
      m: 1,
      hot: false,
      restTicks: 0,
    },
    dummies: [],
    nextId: 1,
    pips: tune.pipMax,
    pipTimer: tune.pipRefillTicks,
    flight: { id: 0, startTick: 0, targetAtLaunch: -1, resolved: true, walls: 0, aimTrue: false },
    chain: 0,
    targetId: -1,
    called: { attempts: 0, hits: 0, last: [] },
    totals: { launches: 0, pops: 0 },
    events: [],
  };
  // The opening picture: a tight triangle straight ahead, apex toward
  // Hugo, so the very first release is a break shot.
  const r = 12;
  const gap = 1;
  const cx = FIELD_W / 2;
  const apexY = FIELD_H * 0.34;
  const rowH = (2 * r + gap) * 0.87;
  let made = 0;
  for (let row = 0; row < 3 && made < tune.dummyCount; row++) {
    for (let i = 0; i <= row && made < tune.dummyCount; i++) {
      s.dummies.push({
        id: s.nextId++,
        x: cx + (i - row / 2) * (2 * r + gap),
        y: apexY - row * rowH,
        vx: 0,
        vy: 0,
        r,
        m: DUMMY_M,
        alive: true,
        respawnIn: 0,
        bornTick: 0,
      });
      made++;
    }
  }
  while (made < tune.dummyCount) {
    // More than six asked for: the rest arrive like any respawn.
    s.dummies.push({
      id: s.nextId++,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: 10 + Math.floor(rand(s) * 4),
      m: DUMMY_M,
      alive: false,
      respawnIn: 1 + made,
      bornTick: 0,
    });
    made++;
  }
  s.targetId = s.dummies.length > 0 ? s.dummies[0].id : -1;
  return s;
}

export function cloneState(s: State): State {
  return {
    tick: s.tick,
    rng: s.rng,
    hugo: { ...s.hugo },
    dummies: s.dummies.map((d) => ({ ...d })),
    nextId: s.nextId,
    pips: s.pips,
    pipTimer: s.pipTimer,
    flight: { ...s.flight },
    chain: s.chain,
    targetId: s.targetId,
    called: { attempts: s.called.attempts, hits: s.called.hits, last: s.called.last.slice() },
    totals: { ...s.totals },
    events: [],
  };
}

/** A short, stable fingerprint of everything that matters — for determinism checks. */
export function hashState(s: State): string {
  let h = 2166136261 >>> 0;
  const mix = (n: number) => {
    // Quantise so the hash is about the simulation, not about float printing.
    const v = Math.round(n * 1024) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(s.tick);
  mix(s.rng & 0xffff);
  mix(s.hugo.x);
  mix(s.hugo.y);
  mix(s.hugo.vx);
  mix(s.hugo.vy);
  mix(s.pips);
  mix(s.chain);
  mix(s.targetId);
  mix(s.called.attempts);
  mix(s.called.hits);
  for (const d of s.dummies) {
    mix(d.id);
    mix(d.alive ? 1 : 0);
    mix(d.x);
    mix(d.y);
    mix(d.vx);
    mix(d.vy);
  }
  return h.toString(16).padStart(8, "0");
}

// ── The launch curve ──────────────────────────────────────────────────

/** Map a pull (0 = just past the dead zone, 1 = full) to launch power. */
export function powerFromPull(pull01: number, tune: Tune): number {
  const p = pull01 < 0 ? 0 : pull01 > 1 ? 1 : pull01;
  return tune.minPowerFrac + (1 - tune.minPowerFrac) * p;
}

export function hotSpeed(tune: Tune): number {
  return tune.hotFrac * tune.maxSpeed;
}

// ── Shared motion pieces (the step and the preview both use these) ────

type Mover = { x: number; y: number; vx: number; vy: number; r: number };

/** Bounce a circle off the room's four walls. Returns how many walls it touched. */
function collideWalls(b: Mover, restitution: number): number {
  let touched = 0;
  if (b.x < b.r) {
    b.x = b.r;
    if (b.vx < 0) {
      b.vx = -b.vx * restitution;
      touched++;
    }
  } else if (b.x > FIELD_W - b.r) {
    b.x = FIELD_W - b.r;
    if (b.vx > 0) {
      b.vx = -b.vx * restitution;
      touched++;
    }
  }
  if (b.y < b.r) {
    b.y = b.r;
    if (b.vy < 0) {
      b.vy = -b.vy * restitution;
      touched++;
    }
  } else if (b.y > FIELD_H - b.r) {
    b.y = FIELD_H - b.r;
    if (b.vy > 0) {
      b.vy = -b.vy * restitution;
      touched++;
    }
  }
  return touched;
}

/** Keep a circle inside the room after contacts have pushed it: no bounce, no event. */
function contain(b: Mover): void {
  if (b.x < b.r) {
    b.x = b.r;
    if (b.vx < 0) b.vx = 0;
  } else if (b.x > FIELD_W - b.r) {
    b.x = FIELD_W - b.r;
    if (b.vx > 0) b.vx = 0;
  }
  if (b.y < b.r) {
    b.y = b.r;
    if (b.vy < 0) b.vy = 0;
  } else if (b.y > FIELD_H - b.r) {
    b.y = FIELD_H - b.r;
    if (b.vy > 0) b.vy = 0;
  }
}

/** One tick of drag and friction. Returns the new speed. */
function slow(b: Mover, dragK: number, friction: number, restSpeed: number): number {
  const sp = Math.hypot(b.vx, b.vy);
  if (sp === 0) return 0;
  let next = sp * Math.exp(-dragK * DT) - friction * DT;
  if (next < restSpeed) next = 0;
  const k = next / sp;
  b.vx *= k;
  b.vy *= k;
  return next;
}

function substepsFor(speed: number): number {
  const n = Math.ceil((speed * DT) / MAX_SUBSTEP_TRAVEL);
  return n < 1 ? 1 : n > MAX_SUBSTEPS ? MAX_SUBSTEPS : n;
}

function applyLaunch(h: Hugo, l: Launch, tune: Tune): number {
  const len = Math.hypot(l.dx, l.dy);
  if (len === 0) return 0;
  const power = l.power < 0 ? 0 : l.power > 1 ? 1 : l.power;
  const sp = tune.maxSpeed * power;
  h.vx = (l.dx / len) * sp;
  h.vy = (l.dy / len) * sp;
  h.restTicks = 0;
  return power;
}

// ── The step ──────────────────────────────────────────────────────────

/**
 * Give the current launch its called-shot verdict, once.
 *
 * What is being measured is the aim at release, so a launch whose line
 * was on the ringed dummy is a hit whatever happens next: a player who
 * chains (launches again before the first shot lands) must not have every
 * abandoned shot booked as a miss. A launch whose line was off still
 * scores if the ringed one is in fact the first thing it pops.
 */
function resolveCalled(s: State, poppedTarget: boolean) {
  if (s.flight.resolved) return;
  s.flight.resolved = true;
  if (s.flight.targetAtLaunch < 0) return;
  const hit = poppedTarget || s.flight.aimTrue;
  s.called.attempts++;
  if (hit) s.called.hits++;
  s.called.last.push(hit ? 1 : 0);
  if (s.called.last.length > 10) s.called.last.shift();
  s.events.push({ t: "called", hit, flight: s.flight.id });
}

/**
 * Can a straight, full-power launch from where Hugo is now pop this dummy
 * before it touches anything else? Only such a shot is a fair question to
 * put to a thumb: a ringed dummy that is out of hot range, or behind
 * another one, measures the room and not the aim.
 */
export function clearShot(s: State, d: Dummy, tune: Tune): boolean {
  const pv = previewLaunch(s, { dx: d.x - s.hugo.x, dy: d.y - s.hugo.y, power: 1 }, tune, 0);
  return pv.hitId === d.id && pv.hitHot;
}

/** How far outside the dummy's own width a launch may point and still be "at it". Radians. */
const NEAR_MISS = (12 * Math.PI) / 180;

/**
 * Is this launch pointed at the dummy, or close beside it? A launch aimed
 * somewhere else entirely (at another dummy, at a wall for fun) says
 * nothing about whether the thumb can hit the ringed one, so it is not
 * scored. "Close" is the angle the dummy covers plus twelve degrees: wide
 * enough that every real miss is still counted as a miss.
 */
function aimedNear(s: State, d: Dummy, l: Launch): boolean {
  const tx = d.x - s.hugo.x;
  const ty = d.y - s.hugo.y;
  const dist = Math.hypot(tx, ty);
  const len = Math.hypot(l.dx, l.dy);
  if (dist === 0 || len === 0) return false;
  const cos = (tx * l.dx + ty * l.dy) / (dist * len);
  const off = Math.acos(cos > 1 ? 1 : cos < -1 ? -1 : cos);
  const covers = Math.asin(Math.min(1, (s.hugo.r + d.r) / dist));
  return off <= covers + NEAR_MISS;
}

function liveTarget(s: State): Dummy | undefined {
  if (s.targetId < 0) return undefined;
  for (const d of s.dummies) if (d.alive && d.id === s.targetId) return d;
  return undefined;
}

/** A called shot nearer than this is a gimme; further than this the dummy is a few degrees wide. */
const FAIR_NEAR = 120;
const FAIR_FAR = 320;

/** A fair question for a thumb: reachable in a straight line, at a middling distance. */
function fairTarget(s: State, d: Dummy, tune: Tune): boolean {
  const dist = Math.hypot(d.x - s.hugo.x, d.y - s.hugo.y);
  return dist >= FAIR_NEAR && dist <= FAIR_FAR && clearShot(s, d, tune);
}

function pickTarget(s: State, tune: Tune) {
  const live = s.dummies.filter((d) => d.alive);
  if (live.length === 0) {
    s.targetId = -1;
    return;
  }
  // Ring a fair one; failing that, any he can reach in a straight line.
  // With nothing reachable the ring still goes somewhere, and a launch at
  // it does not count (see `targetAtLaunch`).
  const fair = live.filter((d) => fairTarget(s, d, tune));
  const clear = fair.length > 0 ? fair : live.filter((d) => clearShot(s, d, tune));
  const pool = clear.length > 0 ? clear : live;
  s.targetId = pool[Math.floor(rand(s) * pool.length)].id;
}

function tryRespawn(s: State, d: Dummy): boolean {
  const r = 10 + Math.floor(rand(s) * 4);
  for (let attempt = 0; attempt < 12; attempt++) {
    const x = r + 14 + rand(s) * (FIELD_W - 2 * (r + 14));
    const y = r + 14 + rand(s) * (FIELD_H - 2 * (r + 14));
    if (Math.hypot(x - s.hugo.x, y - s.hugo.y) < 96) continue;
    let clear = true;
    for (const o of s.dummies) {
      if (!o.alive) continue;
      if (Math.hypot(x - o.x, y - o.y) < r + o.r + 8) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    d.id = s.nextId++;
    d.x = x;
    d.y = y;
    d.vx = 0;
    d.vy = 0;
    d.r = r;
    d.alive = true;
    d.bornTick = s.tick;
    s.events.push({ t: "spawn", id: d.id, x, y });
    return true;
  }
  return false;
}

/**
 * Advance one tick, in place. `s.events` is replaced with what happened.
 */
export function step(s: State, input: Input, tune: Tune): void {
  s.events = [];
  s.tick++;
  const h = s.hugo;
  const hotAt = hotSpeed(tune);

  // 1. The launch, if one was asked for and a pip is there to pay for it.
  const l = input.launch;
  if (l && s.pips > 0 && l.power > 0 && (l.dx !== 0 || l.dy !== 0)) {
    // A new launch closes the one before it: a hit if its line was true,
    // a miss if not.
    resolveCalled(s, false);
    // This launch is scored as a called shot only when the ringed dummy
    // could be reached in a straight line from here, and only when the
    // launch is at it or close beside it (or its line finds it off a
    // cushion). Read before Hugo's velocity changes.
    const ringed = liveTarget(s);
    let counted = false;
    let aimTrue = false;
    let ringDist = -1;
    let aimErr = 0;
    const speedBefore = Math.hypot(h.vx, h.vy);
    if (ringed !== undefined) {
      ringDist = Math.hypot(ringed.x - h.x, ringed.y - h.y);
      let d = Math.atan2(l.dy, l.dx) - Math.atan2(ringed.y - h.y, ringed.x - h.x);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      aimErr = (d * 180) / Math.PI;
      if (clearShot(s, ringed, tune)) {
        const pv = previewLaunch(s, l, tune, 2);
        aimTrue = pv.hitId === ringed.id && pv.hitHot;
        counted = aimTrue || aimedNear(s, ringed, l);
      }
    }
    const power = applyLaunch(h, l, tune);
    if (s.pips === tune.pipMax) s.pipTimer = tune.pipRefillTicks;
    s.pips--;
    s.totals.launches++;
    s.flight = {
      id: s.flight.id + 1,
      startTick: s.tick,
      targetAtLaunch: counted ? s.targetId : -1,
      resolved: false,
      walls: 0,
      aimTrue,
    };
    s.events.push({ t: "launch", x: h.x, y: h.y, power, counted, ringDist, aimErr, speedBefore });
  }

  // 2. Pips come back on a timer.
  if (s.pips < tune.pipMax) {
    s.pipTimer--;
    if (s.pipTimer <= 0) {
      s.pips++;
      s.pipTimer = tune.pipRefillTicks;
      s.events.push({ t: "pip", pips: s.pips });
    }
  }

  // 3. Move everything, in substeps small enough that nothing tunnels.
  let fastest = Math.hypot(h.vx, h.vy);
  for (const d of s.dummies) {
    if (!d.alive) continue;
    const sp = Math.hypot(d.vx, d.vy);
    if (sp > fastest) fastest = sp;
  }
  const n = substepsFor(fastest);
  const sub = DT / n;
  for (let i = 0; i < n; i++) {
    h.x += h.vx * sub;
    h.y += h.vy * sub;
    const hSpeedBefore = Math.hypot(h.vx, h.vy);
    const walls = collideWalls(h, tune.wallRestitution);
    if (walls > 0) {
      s.flight.walls += walls;
      s.events.push({ t: "wall", x: h.x, y: h.y, speed: hSpeedBefore, hot: hSpeedBefore >= hotAt });
    }
    for (const d of s.dummies) {
      if (!d.alive) continue;
      d.x += d.vx * sub;
      d.y += d.vy * sub;
      collideWalls(d, DUMMY_WALL_RESTITUTION);
    }

    // Hugo against each dummy.
    for (const d of s.dummies) {
      if (!d.alive) continue;
      const dx = d.x - h.x;
      const dy = d.y - h.y;
      const dist = Math.hypot(dx, dy);
      const reach = h.r + d.r;
      if (dist >= reach) continue;
      const nx = dist > 1e-6 ? dx / dist : 0;
      const ny = dist > 1e-6 ? dy / dist : -1;
      const speedNow = Math.hypot(h.vx, h.vy);
      const closing = (h.vx - d.vx) * nx + (h.vy - d.vy) * ny;
      const isHot = speedNow >= hotAt;
      if (isHot) {
        // A fast Hugo: the dummy pops, and he feels only part of the knock.
        // A grazing pass can already be receding when it is sampled; it
        // still pops (the preview rings it), it just costs him nothing.
        if (closing > 0) {
          const j = ((1 + tune.bodyRestitution) * closing) / (1 / h.m + 1 / d.m);
          h.vx -= (j / h.m) * nx * tune.popImpulseScale;
          h.vy -= (j / h.m) * ny * tune.popImpulseScale;
        }
        d.alive = false;
        d.respawnIn = tune.respawnTicks;
        s.chain++;
        s.totals.pops++;
        const wasTarget = d.id === s.targetId;
        s.events.push({ t: "pop", x: d.x, y: d.y, id: d.id, chain: s.chain, target: wasTarget, speed: speedNow });
        resolveCalled(s, d.id === s.flight.targetAtLaunch);
        if (wasTarget) s.targetId = -1;
        // A pop pays for the next launch.
        if (s.pips < tune.pipMax) {
          s.pips++;
          s.events.push({ t: "pip", pips: s.pips });
        }
        continue;
      }
      // A slow Hugo (or a dummy drifting into him): an ordinary bump.
      const overlap = reach - dist;
      const wh = 1 / h.m;
      const wd = 1 / d.m;
      h.x -= nx * overlap * (wh / (wh + wd));
      h.y -= ny * overlap * (wh / (wh + wd));
      d.x += nx * overlap * (wd / (wh + wd));
      d.y += ny * overlap * (wd / (wh + wd));
      if (closing > 0) {
        const j = ((1 + tune.bodyRestitution) * closing) / (wh + wd);
        h.vx -= j * wh * nx;
        h.vy -= j * wh * ny;
        d.vx += j * wd * nx;
        d.vy += j * wd * ny;
        if (closing > 30) s.events.push({ t: "bump", x: h.x + nx * h.r, y: h.y + ny * h.r, speed: closing });
      }
    }

    // Dummies against each other.
    for (let a = 0; a < s.dummies.length; a++) {
      const A = s.dummies[a];
      if (!A.alive) continue;
      for (let b = a + 1; b < s.dummies.length; b++) {
        const B = s.dummies[b];
        if (!B.alive) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const dist = Math.hypot(dx, dy);
        const reach = A.r + B.r;
        if (dist >= reach) continue;
        const nx = dist > 1e-6 ? dx / dist : 1;
        const ny = dist > 1e-6 ? dy / dist : 0;
        const overlap = reach - dist;
        A.x -= nx * overlap * 0.5;
        A.y -= ny * overlap * 0.5;
        B.x += nx * overlap * 0.5;
        B.y += ny * overlap * 0.5;
        const closing = (A.vx - B.vx) * nx + (A.vy - B.vy) * ny;
        if (closing > 0) {
          const j = ((1 + tune.bodyRestitution) * closing) / (1 / A.m + 1 / B.m);
          A.vx -= (j / A.m) * nx;
          A.vy -= (j / A.m) * ny;
          B.vx += (j / B.m) * nx;
          B.vy += (j / B.m) * ny;
          if (closing > 60) s.events.push({ t: "bump", x: A.x + nx * A.r, y: A.y + ny * A.r, speed: closing });
        }
      }
    }

    // Contacts may have pushed something through a wall: put it back.
    contain(h);
    for (const d of s.dummies) if (d.alive) contain(d);
  }

  // 4. Everything loses speed.
  const wasHot = h.hot;
  const speed = slow(h, tune.dragK, tune.friction, tune.restSpeed);
  for (const d of s.dummies) {
    if (!d.alive) continue;
    slow(d, DUMMY_DRAG_K, DUMMY_FRICTION, 6);
  }
  h.hot = speed >= hotAt;
  if (!h.hot) {
    // Not hot ends the chain, and a launch that found nothing is a miss.
    // This runs on every cool tick and not only on the tick he cools: a
    // soft launch is never hot, and one that pops in its first tick and
    // ends that tick cool would otherwise carry its chain into the next.
    s.chain = 0;
    resolveCalled(s, false);
    if (wasHot) s.events.push({ t: "cool", x: h.x, y: h.y });
  }
  if (speed === 0) {
    if (h.restTicks === 0 && s.tick > 1) s.events.push({ t: "rest", x: h.x, y: h.y });
    h.restTicks++;
  } else {
    h.restTicks = 0;
  }

  // 5. Dummies come back, and there is always one ringed.
  for (const d of s.dummies) {
    if (d.alive) continue;
    d.respawnIn--;
    if (d.respawnIn <= 0 && !tryRespawn(s, d)) d.respawnIn = 6;
  }
  // The ring was drawn while he was still flying, from wherever he was
  // then. When he comes to rest, and then every third of a second while
  // he stays there, look again from where he actually is: a ring that is
  // not a fair question moves to one that is, if there is one. (A dummy
  // can also respawn in the way after he stops.) It never hops between
  // two equally poor choices.
  if (h.restTicks > 0 && (h.restTicks - 1) % 20 === 0) {
    const ringed = liveTarget(s);
    if (ringed === undefined || !fairTarget(s, ringed, tune)) {
      const live = s.dummies.filter((d) => d.alive);
      let pool = live.filter((d) => fairTarget(s, d, tune));
      if (pool.length === 0 && (ringed === undefined || !clearShot(s, ringed, tune))) {
        pool = live.filter((d) => clearShot(s, d, tune));
      }
      if (pool.length > 0) s.targetId = pool[Math.floor(rand(s) * pool.length)].id;
    }
  }
  if (s.targetId < 0) pickTarget(s, tune);
}

// ── The aim preview: the same motion, run ahead on a copy ─────────────

export type Preview = {
  /** x0, y0, x1, y1, ... one point per tick. */
  pts: number[];
  /** Index into `pts` pairs where each cushion was touched. */
  bounces: number[];
  /** Why it stopped. */
  end: "body" | "walls" | "cool" | "time";
  /** The dummy it reaches first, or -1. */
  hitId: number;
  /** Would he be fast enough to pop it? */
  hitHot: boolean;
};

/**
 * Where a launch would take Hugo: his own path through `maxWalls`
 * cushions, with the dummies frozen where they are now. It stops at the
 * first dummy he would touch. Built from the same pieces as `step`, so
 * what the dotted line shows is what the simulation does.
 */
export function previewLaunch(s: State, launch: Launch, tune: Tune, maxWalls: number, maxTicks = 120): Preview {
  const h: Hugo = { ...s.hugo };
  const out: Preview = { pts: [h.x, h.y], bounces: [], end: "time", hitId: -1, hitHot: false };
  if (applyLaunch(h, launch, tune) === 0) return out;
  const hotAt = hotSpeed(tune);
  let walls = 0;
  for (let t = 0; t < maxTicks; t++) {
    const n = substepsFor(Math.hypot(h.vx, h.vy));
    const sub = DT / n;
    for (let i = 0; i < n; i++) {
      h.x += h.vx * sub;
      h.y += h.vy * sub;
      const touched = collideWalls(h, tune.wallRestitution);
      if (touched > 0) {
        walls += touched;
        out.bounces.push(out.pts.length / 2);
        if (walls > maxWalls) {
          out.pts.push(h.x, h.y);
          out.end = "walls";
          return out;
        }
      }
      for (const d of s.dummies) {
        if (!d.alive) continue;
        if (Math.hypot(d.x - h.x, d.y - h.y) < h.r + d.r) {
          out.pts.push(h.x, h.y);
          out.end = "body";
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
