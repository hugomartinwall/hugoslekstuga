/**
 * Knuff — the simulation's types.
 *
 * The State is plain data: numbers, booleans, strings, and lists and
 * objects of them. No class, no function, no Map, no undefined, no
 * Infinity (-1 means "never"). So one generic walk can copy it, fingerprint
 * it and store it as JSON (see state.ts).
 *
 * Step 0 holds what the feel toy held: the room, him, and the toy's
 * dummies. The night, hearts, pips and the rest of the spec's State join
 * in the steps that build them, under the names the spec gives them.
 */

/** Every number a hand might want to change. One flat table; content/tune.ts fills it. */
export type Tune = {
  // ── Copied from the feel toy: how he moves ──────────────────────────
  /** Launch speed at full power, u/s. */
  maxSpeed: number;
  /** Exponential drag on him, 1/s. */
  dragK: number;
  /** Constant deceleration on him, u/s². What brings him to rest. */
  friction: number;
  /** Share of launch speed at or above which he is the weapon ("hot"). */
  hotFrac: number;
  /** Below this speed he is at rest, u/s. */
  restSpeed: number;
  wallRestitution: number;
  bodyRestitution: number;
  /** Share of the collision impulse he feels when the thing he hit pops. */
  popImpulseScale: number;
  /** His radius, u. */
  himRadius: number;
  /** A substep never moves a body further than this, u, so nothing tunnels. */
  maxSubstepTravel: number;
  maxSubsteps: number;
  /** Mass of a light thing. His mass is 1. */
  lightMass: number;
  /** How a knocked light thing slows: drag, friction and its rest speed. */
  lightDragK: number;
  lightFriction: number;
  lightRestSpeed: number;
  lightWallRestitution: number;

  // ── Copied from the feel toy: the pull ──────────────────────────────
  /** Pull length for full power, CSS px. */
  pullFullPx: number;
  /** Room speed while a pull is held, as a share of normal speed. */
  slowShare: number;
  /** Pull back to launch away from the pull, or push to launch along it. */
  pullDir: "back" | "push";
  /** Cushions the aim line runs through. It stops at the next one. */
  aimCushions: number;
  /** A pull released shorter than this is no shot, CSS px. */
  noShotPx: number;
  /** Power at `noShotPx`, as a share of launch speed. It rises in a straight line to 1 at the full pull. */
  minPower: number;

  // ── The game's own ──────────────────────────────────────────────────
  /** A touch becomes a pull when it has moved this far, CSS px. The band and the aim line start then. */
  lineShowsPx: number;

  // ── Step 0 only: the toy's dummies ──────────────────────────────────
  dummyCount: number;
  dummyRespawnTicks: number;
};

export type Room = { left: number; top: number; right: number; bottom: number };

export type Him = {
  /** Centre. */
  x: number;
  y: number;
  /** Where he was one tick ago: the renderer draws between the two. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Fast enough to be the weapon. */
  hot: boolean;
};

/**
 * A thing in the room. Step 0 knows one kind, the toy's dummy: it pops
 * when he hits it hot and comes back a moment later, in the same slot.
 */
export type Thing = {
  id: number;
  kind: "dummy";
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  alive: boolean;
  /** Ticks until it comes back (only while not alive). */
  respawnIn: number;
  /** Tick it last appeared; -1 = it was there from the start. */
  bornTick: number;
};

export type State = {
  v: 1;
  seed: number;
  tick: number;
  /** mulberry32 states, one per stream (rng.ts). The only source of randomness. */
  rng: { arrivals: number; offers: number; behaviour: number };
  /** The four edges of the floor he moves on. Read from here, never as constants. */
  room: Room;
  him: Him;
  /** The launch in progress, or the last one. `id` counts launches. */
  launch: { id: number; startTick: number; pops: number; cushions: number };
  things: Thing[];
  nextId: number;
};

/** One release: a direction (it need not be unit length) and a power in (0, 1]. */
export type Launch = { dx: number; dy: number; power: number };

/** The aim never enters the simulation. Only a release does. */
export type Input = { launch: Launch | null; pullHeld: boolean };

export type Side = "left" | "right" | "top" | "bottom";

/**
 * What a tick did. `step` writes these into the list its caller hands it;
 * they are not part of the State. Drawing and (later) sound and the bots
 * read the State and these and nothing else.
 */
export type SimEvent =
  | { type: "launch"; tick: number; x: number; y: number; power: number }
  /** One per cushion touched; `speed` is his speed going in. */
  | { type: "cushion"; tick: number; x: number; y: number; side: Side; speed: number }
  /** `x`, `y` is the thing; `n` counts the pops of this launch from 1. */
  | { type: "pop"; tick: number; x: number; y: number; id: number; kind: Thing["kind"]; n: number; speed: number }
  | { type: "arrive"; tick: number; x: number; y: number; id: number; kind: Thing["kind"] };
