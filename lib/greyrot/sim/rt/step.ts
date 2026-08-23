/**
 * rtStep() — advance the real-time simulation exactly one 30 Hz tick.
 *
 * Deterministic by construction, same rules as `sim/step.ts`: fixed per-tick
 * constants, no wall clock, no `Math.random`, no trig in anything that decides
 * behaviour. Aim vectors arrive as command payloads already quantised by the
 * app, so the sim never calls `atan2` and a replay is bit-exact.
 *
 * ## Order per tick — fixed, because order IS behaviour
 *
 *   1. hero commands: queue edits, cast commitment, move intent
 *   2. hero movement, under the field's friction
 *   3. the cast timer; a finished cast launches
 *   4. projectiles advance and collide
 *   5. foes: AI, movement, telegraphed attacks
 *   6. bystanders: recovery
 *   7. the field: fire spreads, patches age, the floor afflicts what stands on it
 *   8. statuses tick, the dead are cleared, tick++
 *
 * Casting resolves at step 3 rather than at step 1 so a cast committed this
 * tick still spends its wind-up — otherwise a one-element mix would fire on
 * the same tick it was pressed and there would be no telegraph on the hero
 * either, which is what makes a fight readable to a spectator.
 */

import {
  ELEMENT_PROFILE,
  PATCH_TICKS,
  QUEUE_MAX,
  type CastForm,
  type Element,
  type PatchKind,
  type StatusId,
} from "../../content";
import { foeKind, type FoeKind } from "../../content/foes";
import {
  ALLY_ACCEL,
  ALLY_FOLLOW_DISTANCE,
  ALLY_JOIN_RADIUS,
  ALLY_SPEED,
  CORRIDOR_HALF,
  CORRIDOR_PULL,
  DOWN_TICKS,
  HERO_RADIUS,
  HERO_TURN_RATE,
  LEASH_RADIUS,
  LEASH_RELEASE,
  CROSS_PERSIST_TICKS,
  FLANK_DOT,
  FLANK_STALK_RANGE,
  MAX_SPEED,
  REVIVE_GRACE_TICKS,
  REVIVE_HP_FRACTION,
  ROAD_CROSS_RADIUS,
} from "../constants";
import {
  faceVelocity,
  integrate,
  pushApart,
  pushOutOfBlockers,
  turnToward,
} from "../motion";
import { TICK_HZ } from "../tick";
import { isWetAt, type SimWorld } from "../world";
import {
  addStatus,
  applyElement,
  hasStatus,
  removeStatus,
  speedMultiplier,
  statusIds,
  tickStatuses,
  type ActiveStatus,
} from "./damage";
import {
  addPatch,
  elementOnField,
  fieldSlipAt,
  fieldStatusesAt,
  stepField,
  type FieldPatch,
} from "./field";
import { Stream } from "../rng";
import { PROJECTILE_SPEED, PROJECTILE_TICKS, resolveMix } from "./spell";
import type {
  RtBody,
  RtBystander,
  RtFoe,
  RtPickup,
  RtSceneryFire,
  RtState,
} from "./state";

/* --------------------------------------------------------------- commands */

export type RtCommand =
  | { type: "move"; dx: number; dz: number }
  | { type: "queue"; element: Element }
  | { type: "clear" }
  | { type: "cast"; form: CastForm; aimX: number; aimZ: number }
  // `markerId` is optional so free spawns — sandbox waves, the debug handle —
  // stay one-liners and, correctly, own no marker and clear nothing.
  | { type: "spawn"; kindId: string; x: number; z: number; markerId?: number }
  | { type: "spawnBystander"; x: number; z: number; name: string }
  /**
   * Get up. The rewarded-ad revive and the free countdown-expiry path both
   * arrive here.
   *
   * A COMMAND rather than an exported mutator, and that is the whole point: a
   * revive changes hp, statuses, invulnerability and the down flag, so if the
   * app reached in and set them the replay would show a hero who died and
   * stayed dead. Everything that decides the future goes through the tick.
   */
  | { type: "revive" }
  /** The seam has been shown and dismissed; the next stage becomes live. */
  | { type: "advanceStage" }
  /**
   * The non-ad path out of defeat (§8 requires one). Wipes the current stage's
   * fights back to untriggered and puts the hero on its entry point.
   */
  | { type: "restartStage"; x: number; z: number }
  /**
   * Walk the whole road again from the top. The camp's way out when there is
   * no next chapter yet.
   *
   * Shares `restartStage`'s body over a wider set, rather than being the app
   * rebuilding `RtState` — which is the tempting version and the wrong one:
   * `setupVillage` pushes hut blockers and wet zones into the world and is not
   * idempotent, so a re-setup would double the village every time.
   */
  | { type: "newRun"; x: number; z: number }
  /**
   * Power is found. Grants an element, or THE WEAVE (the second queue slot —
   * mixing itself). A COMMAND for the same reason revive is: an unlock decides
   * every future cast, so if the app reached in and pushed onto `unlocked`
   * the replay would show a hero casting an element they never found.
   */
  | { type: "grant"; element?: Element; weave?: boolean }
  /**
   * Take the find you are standing at (third playtest: "let me walk up to
   * the item" — found means TAKEN, not brushed against). Collects the
   * nearest eligible pickup within PICKUP_RADIUS; a no-op anywhere else.
   */
  | { type: "take" };

/* ----------------------------------------------------------------- events */

/** What happened this tick — presentation input, derived, never state. */
export interface RtEvents {
  /**
   * The hero committed a cast this tick — the ROOT begins now; `casts` below
   * is the launch. The presentation's anticipation (gather pose, hand glow)
   * hangs on this: before it existed the wind-up animation could only start at
   * launch, which put the anticipation AFTER the bolt.
   */
  castCommitted: { elements: Element[]; form: CastForm; ticks: number } | null;
  /** A cast left the hero. `fizzled` means the mix cancelled to nothing. */
  casts: { name: string; element: Element; x: number; z: number; fizzled: boolean }[];
  /**
   * Every detonation POINT, whether or not a body was hit. `impacts` is per
   * victim, so a bolt bursting on empty ground used to emit nothing at all —
   * the most common outcome of a cast, invisible. `sourceX/Z` give the render
   * a direction (one tick back along the flight, or the biter's position).
   */
  detonations: {
    x: number;
    z: number;
    element: Element;
    radius: number;
    fromHero: boolean;
    sourceX: number;
    sourceZ: number;
  }[];
  /** Something was struck. One entry per body hit. */
  impacts: {
    x: number;
    z: number;
    element: Element;
    damage: number;
    combo: string | null;
    chained: boolean;
    /**
     * Where a chained hit jumped FROM — the previous body in the chain.
     * `null` on direct hits. The render draws the hop as an arc between the
     * two bodies; without it a chain was two disconnected bursts, and the
     * fourth playtest could not see the jump at all.
     */
    source: { x: number; z: number } | null;
    onHero: boolean;
  }[];
  /** A status landed. Drives the status FX vocabulary. */
  statuses: { x: number; z: number; status: StatusId }[];
  /** A patch was laid or transformed. */
  patches: { x: number; z: number; r: number; kind: PatchKind; ignited: boolean }[];
  deaths: { x: number; z: number }[];
  /**
   * Damage the hero took this tick, from any source. Drives shake.
   *
   * ⚠️ IT DOES NOT ATTRIBUTE, AND `detonations` BESIDE IT DOES NOT EITHER.
   * A melee bite runs through the same `detonate`/`land` path as a spell —
   * see `shoveFrom`'s note below, *"a melee bite has detonated at the
   * victim's centre since it was written"* — so **being eaten looks exactly
   * like hitting yourself** in a sampled event stream: `heroDamage: 9`
   * co-occurring with `detonations: 1`. That reading cost a seat a whole
   * false finding in R5 (a Conduction "self-damage tax" that was twelve
   * rotling bites; `FOES.rotling.damage` is 9).
   *
   * THE ATTRIBUTION IS ALREADY IN THE PAYLOAD — use it rather than the
   * co-occurrence: a self-hit is a detonation with **`fromHero: true`** and
   * an impact with **`onHero: true`**. A bite is `fromHero: false`,
   * `onHero: true`. Driven no-cast control on the gulch, hero standing in
   * twelve bodies: five damage ticks, `fromHero` **0** on every one.
   * `test/rt.test.ts` pins both directions.
   */
  heroDamage: number;
  /** A bystander was knocked down. The joke landing. */
  bystanderDown: { x: number; z: number; name: string }[];
  /**
   * A foe began a telegraphed attack. `element` is the foe kind's attack
   * element and `melee` its delivery, so the telegraph FX can be honest about
   * what is coming — data-driven off the attack, never off the foe kind.
   */
  windups: {
    id: number;
    /** The foe kind, so per-kind tells (the flanker's eyes-off cue) need no state lookup. */
    kindId: string;
    x: number;
    z: number;
    element: Element;
    melee: boolean;
  }[];
  /** The queue changed, so the HUD re-previews. */
  queueChanged: boolean;
  /**
   * A queue press that could NOT land, and why (R6, fun's binding ruling).
   *
   * The two gates below — an unfound element, a queue already at `queueMax` —
   * used to reject in silence: the queue unchanged, `queueChanged` false, and
   * every other field of this object empty, so a refused press was
   * indistinguishable from a press that never happened. Measured in the
   * browser on the built entry, pressing a second element at `queueMax: 1`.
   *
   * That is the mechanism behind the WEAVE-skip's *"nothing ever tells the
   * player why"*, and it is not gulch plumbing: it is every locked-element
   * press in the opening thirty seconds, where a new player is mashing keys
   * precisely to find out what they hold.
   *
   * `locked` beats `full` when both apply — an unfound element is a road
   * problem and a full queue is a Tab away, so the reason a cue should show is
   * the one the player can act on.
   */
  queueRefused: { element: Element; reason: "locked" | "full" }[];
  /** Marker ids whose fight just spawned. */
  markersTriggered: number[];
  /** Marker ids whose fight is now won. A seam (`CLAUDE.md` §8). */
  markersCleared: number[];
  /**
   * A reinforcement arrived (R5's valve). Derived, not hashed — the render
   * layer's arrival cue hangs off this, and fun's readability condition is
   * binding: a body the player does not see coming reads as the game adding
   * enemies rather than as the pack refusing to shrink.
   */
  reinforced: { x: number; z: number; kindId: string }[];
  /** A captive was freed and now follows. */
  rescued: { x: number; z: number; name: string }[];
  /** A scenery fire was put out with water. Steam, a banner, a small reward. */
  hutDoused: { x: number; z: number }[];
  /**
   * A brazier came back alight (R4, damp_pyres) — a fire cast reached a dark
   * bowl. The relight ceremony: flame burst, ember flare, the objective chip
   * counting itself down. Extinguishes ride `hutDoused` (steam is steam).
   */
  pyreLit: { x: number; z: number }[];
  /**
   * The boss turned a phase this tick (R4, the Sodden Thornback). The
   * render keys its one silhouette change (the thorn-crest flare) and any
   * phase sting off this; the sim keys nothing off it that `RtFoe.phase`
   * does not already carry.
   */
  bossPhase: { id: number; kindId: string; phase: number; x: number; z: number } | null;
  /**
   * THE DRY WINDOW OPENED (R4 recut): a boss kind lost its Wet coat while a
   * lit bowl held the re-wet cadence paused — from here until something
   * re-soaks it, fire sticks and the soak beats are silent. gfx keys the
   * steam-off burst and the standing matte-coat read off this; fun's binding
   * watch-item is that this moment is LOUD at 800×450. An event, not a state
   * sample, for the `events()` reason: the strip and a same-tick kill are
   * invisible to a driver polling state.
   */
  bossDried: { id: number; kindId: string; x: number; z: number } | null;
  /**
   * A soak beat (R4 recut): the boss's re-wet cadence fired and HEALED it —
   * `boss.soakRegen × boss.rewetTicks` hp in one attributable pulse (gfx's
   * co-design: a discrete beat the HP bar can pulse with; a per-tick trickle
   * is exactly what reads as an invisible heal). `resoaked` is true when the
   * beat also re-applied the coat — the dry window CLOSING — false on a
   * refresh of a coat that never left.
   */
  bossSoaked: {
    id: number;
    kindId: string;
    x: number;
    z: number;
    healed: number;
    resoaked: boolean;
  } | null;
  /** Elements found this tick. The ceremony: a new button enters the arc. */
  granted: Element[];
  /** THE WEAVE was found — the queue grew and mixing exists from here on. */
  wove: boolean;
  /**
   * A pickup was collected this tick — WHERE the find stood, for the burst at
   * the spot. `granted`/`wove` above still fire (they carry the banner and
   * the arc flash); this is the world-side half of the same ceremony.
   */
  pickedUp: { x: number; z: number; kind: Element | "weave" }[];
  /** The hero went down this tick. The offer window has opened. */
  heroDown: boolean;
  /** The window ran out. Terminal until a revive or a stage restart. */
  heroDefeated: boolean;
  /** The hero is back on their feet, with grace ticks running. */
  heroRevived: boolean;
  /**
   * A stage index that cleared this tick — every fight in it won AND the exit
   * reached. THE seam (`CLAUDE.md` §8): the most frequent offer point we have.
   */
  stageCleared: number;
  /**
   * The corridor clamp stopped a BACKWARD walk this tick — the nearest road
   * anywhere was behind the last crossed gate (the road is one-way, round 6).
   * Presentation only: Sella's "we go forward" line rides the first one.
   */
  roadBlocked: boolean;
}

function noEvents(): RtEvents {
  return {
    castCommitted: null,
    casts: [],
    detonations: [],
    impacts: [],
    statuses: [],
    patches: [],
    deaths: [],
    heroDamage: 0,
    bystanderDown: [],
    windups: [],
    queueChanged: false,
    queueRefused: [],
    markersTriggered: [],
    markersCleared: [],
    reinforced: [],
    rescued: [],
    hutDoused: [],
    pyreLit: [],
    bossPhase: null,
    bossDried: null,
    bossSoaked: null,
    granted: [],
    wove: false,
    pickedUp: [],
    heroDown: false,
    heroDefeated: false,
    heroRevived: false,
    stageCleared: -1,
    roadBlocked: false,
  };
}

/* ---------------------------------------------------------------- tuning */

/** Ticks of invulnerability after a direct hit. Stops three foes chip-killing. */
const IFRAME_TICKS = 12;
/** Knockback at or above this is a SHOVE and staggers (R6a). */
const SHOVE_STAGGER_KB = 2.0;
/** The stagger: the shoved foe's recover floor — space bought stays bought. */
const SHOVE_STAGGER_TICKS = 10;
/**
 * Foe spacing — the playtest's "they keep a little distance at least".
 * Mechanics shared by every archetype, so they live here with `IFRAME_TICKS`
 * rather than per-foe in `content/foes.ts`.
 */
/** Fraction of a foe's attack range it steers to while closing. INSIDE its
 *  own range, so a charger still crosses the attack line at full tilt and the
 *  windup — not a new mechanic — is the commit. */
const FOE_STANDOFF = 0.85;
/** Metres beyond attack range a foe holds while recovering, so the one that
 *  just bit steps back out of your face instead of walking through you.
 *  Additive, not a multiplier — the ashcap must not retreat metres per recover. */
const FOE_RECOVER_PAD = 0.5;
/** The spitter's band, as a fraction of its range. Replaces the bang-bang
 *  0.6× flip, which oscillated; the tapered radial holds smoothly. */
const SPITTER_BAND = 0.75;
/** Metres over which approach speed tapers to zero at the standoff ring. */
const FOE_ARRIVE_BAND = 0.9;
/** Minimum speed fraction at the ring, so a holding foe strafes on its juke
 *  — reads as circling prey, not as a statue. */
const FOE_RING_DRIFT = 0.35;
/** Metres a chain jumps between wet bodies. */
const CHAIN_RADIUS = 4.5;
/** Bystanders take this fraction of incoming damage (§9's conversion bar). */
const BYSTANDER_DAMAGE = 0.35;
/** Ticks a knocked-down bystander spends on the floor before standing up. */
const BYSTANDER_DOWN_TICKS = 90;
/** A bystander's pool. Lower than the hero's — they go down sooner, and live. */
const BYSTANDER_MAX_HP = 60;
/** Radius within which a spell's `spreads` interaction carries. */
const SPREAD_RADIUS = 3.0;
/** Spores for putting out a scenery fire. A gesture, not an income. */
const DOUSE_SPORES = 3;

/* -------------------------------------------------------------- utilities */

interface Victim {
  body: RtBody;
  statuses: ActiveStatus[];
  /**
   * Apply damage, softened for whoever this is, and return what actually
   * landed.
   *
   * It returns the applied figure because the IMPACT EVENT has to report it.
   * The event used to carry `impact.damage` — the raw matrix output before any
   * softening — which was harmless while the only softened victim was a
   * bystander nobody read a number off, and became a lie the moment the hero
   * could be caught by their own cast at a reduced rate. One value, computed
   * once, used by both the state and the presentation.
   */
  hurt: (amount: number) => number;
  id: number;
  kind: "hero" | "foe" | "bystander";
}

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Pull a body back inside the lock ring, killing only its outward velocity —
 * a soft edge rather than a wall, which reads as running into something
 * rather than as a rubber band. Shared by the hero clamp (2.) and the foe
 * pass (5c.): the ring is the fight for everybody.
 */
function clampToRing(
  b: { x: number; z: number; vx: number; vz: number },
  lock: { x: number; z: number; r: number },
): void {
  const dx = b.x - lock.x;
  const dz = b.z - lock.z;
  const d = Math.hypot(dx, dz);
  if (d <= lock.r || d < 1e-6) return;
  b.x = lock.x + (dx / d) * lock.r;
  b.z = lock.z + (dz / d) * lock.r;
  // Only the outward component. Killing all velocity would freeze a body
  // running along the boundary, which is a normal and useful thing to do.
  const outward = b.vx * (dx / d) + b.vz * (dz / d);
  if (outward > 0) {
    b.vx -= outward * (dx / d);
    b.vz -= outward * (dz / d);
  }
}

/** Nearest sample of the whole road to a point, or -1 with no road. */
function nearestRoadSample(world: SimWorld, x: number, z: number): number {
  let best = Infinity;
  let bi = -1;
  for (let i = 0; i < world.roadPath.length; i++) {
    const p = world.roadPath[i]!;
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bi = i;
    }
  }
  return bi;
}

/**
 * ARC-ORDER CROSSING (R1). The exit discs and the rescue disc span the ROAD
 * SURFACE (r 2.4 / 3.0) while the corridor clamp grants 4.5 m of lateral
 * freedom, so a verge walk could pass a gate unclosed, pass Sella
 * un-rescued, and reach a post-gate gem whose take then silently refused —
 * three symptoms, one hole, all found in R1's baseline play. A thing ON the
 * road is crossed when the hero's nearest LEGAL road sample (the one-way
 * wall's own window) sits at or past the thing's sample — and only within
 * ROAD_CROSS_RADIUS of that sample, so a winding road can never fire a
 * crossing across a hedge. Setup-derived road, no new hashed state.
 *
 * INSTANTANEOUS test only — the callers debounce it. At a hairpin the same
 * (x, z) can mean "approaching the gate" or "walking the return leg", and no
 * positional rule tells them apart: a nearest-sample flip fired one tick
 * before the disc for the beats pilot (stride 45 → 44), and an inbound
 * half-plane rejected a gem standing 3.5 m past a turning gate. Only HISTORY
 * separates the two, so the flip must HOLD for CROSS_PERSIST_TICKS before it
 * counts (`RtState.gateCrossTicks`, `RtBystander.crossTicks`): a real
 * crossing keeps the flip for tens of ticks (the guard window is ±metres at
 * walking speed), while the approach artifact keeps it for one — and the
 * disc, which owns every approach, resolves that tick first.
 */
function roadArcFlipped(world: SimWorld, s: RtState, x: number, z: number, idx: number): boolean {
  const at = idx >= 0 ? world.roadPath[idx] : undefined;
  if (!at) return false;
  // Local only — the guard before the scan, because it usually says no.
  const gdx = x - at.x;
  const gdz = z - at.z;
  if (gdx * gdx + gdz * gdz > ROAD_CROSS_RADIUS * ROAD_CROSS_RADIUS) return false;
  // Nearest LEGAL sample (the one-way wall's own window) at or past the
  // thing's sample.
  const from = s.stageIndex > 0 ? (world.gateIndices[s.stageIndex - 1] ?? 0) : 0;
  let best = Infinity;
  let bi = -1;
  for (let i = from; i < world.roadPath.length; i++) {
    const p = world.roadPath[i]!;
    const dx = x - p.x;
    const dz = z - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      bi = i;
    }
  }
  return bi >= idx;
}

/* ------------------------------------------------------------------ step */

export function rtStep(
  world: SimWorld,
  s: RtState,
  commands: readonly RtCommand[],
): RtEvents {
  const ev = noEvents();
  const hero = s.hero;
  const nextId = (): number => s.nextId++;
  /**
   * Down or out. Read in eight places, so it is computed once and named.
   *
   * A downed hero is not a body in the world as far as harm is concerned: not
   * a victim, not a chain hop, not something the floor can afflict, and not
   * something a foe winds up at. Being killed twice is not a mechanic.
   */
  const heroOut = (): boolean => hero.downTicks > 0 || hero.defeated;
  // The `combat` stream, restored from state and written back at the end so
  // its position survives a save and a replay reproduces every draw. Only the
  // foe weave consumes it today; anything else that needs randomness takes its
  // own stream rather than sharing this one (`sim/rng.ts`).
  const rng = Stream.restore(s.rng);

  /**
   * Every body a spell can touch, in a stable order. Rebuilt per use.
   *
   * `heroScale` is FRIENDLY FIRE (`GAME_DESIGN.md` §3.2). The hero was
   * previously immune to their own casts outright, which meant the ground
   * field — the system the whole game is arranged around — could never once be
   * turned against the person laying it. Now it can, at
   * `s.selfDamage` (seeded from `HERO_SELF_DAMAGE`, dialable in the sandbox
   * during a feel playtest), and the scaling happens HERE rather than before
   * `applyElement` so the STATUS lands at full strength: light your own oil and
   * you are genuinely Burning, you simply do not evaporate.
   *
   * The hero stays at index 0 whether or not they can be harmed, because the
   * self-cast path indexes `all[0]` to put a status on its own caster.
   */
  const victims = (heroScale = 1): Victim[] => {
    const out: Victim[] = [];
    out.push({
      body: hero,
      statuses: hero.statuses,
      id: 0,
      kind: "hero",
      hurt: (n) => {
        const taken = n * heroScale;
        hero.hp -= taken;
        ev.heroDamage += taken;
        return taken;
      },
    });
    for (const f of s.foes) {
      if (!f.alive) continue;
      out.push({
        body: f,
        statuses: f.statuses,
        id: f.id,
        kind: "foe",
        hurt: (n) => {
          f.hp -= n;
          return n;
        },
      });
    }
    for (const b of s.bystanders) {
      out.push({
        body: b,
        statuses: b.statuses,
        id: b.id,
        kind: "bystander",
        hurt: (n) => {
          if (!s.friendlyFire) return 0;
          const taken = n * BYSTANDER_DAMAGE;
          b.hp -= taken;
          return taken;
        },
      });
    }
    return out;
  };

  /**
   * Land one element on one victim, through the matrix, with chaining.
   *
   * `chained` guards the single recursion here for the same reason the turn
   * engine's did: lightning across a soaked field would otherwise never
   * terminate.
   *
   * `struck` guards something subtler that a first pass got wrong and the
   * tests initially hid: with two Wet foes inside one blast, each took a DIRECT
   * hit and then a CHAIN from the other's detonation — double damage, from a
   * combo that is supposed to spread the same hit rather than repeat it. One
   * detonation may touch any body exactly once, across the radius pass, the
   * conduction pass and every chain hop.
   *
   * `hitsHero` has to come all the way down here, and that is the whole point.
   * `detonate`'s two top-level loops honoured it and the chain and spread
   * recursions below did not, so the hero was immune to their own blast at the
   * point of impact and fair game to the same blast one hop later. It only
   * fires when the hero happens to be Wet next to a Wet target — which is
   * precisely the village trough, where standing in the water is the lesson.
   * The signature teaching cast would have electrocuted the player for getting
   * it right.
   */
  function land(
    v: Victim,
    element: Element,
    damage: number,
    ownStatus: StatusId | null,
    chained: boolean,
    all: Victim[],
    struck: Set<number>,
    hitsHero: boolean,
    hopFrom: { x: number; z: number } | null,
    /**
     * `hitsHero`'s mirror, and it has to come down here for exactly the same
     * reason (R2): `detonate`'s top-level loops honoured it while the chain
     * and spread recursions did not. Unreachable until the Stormling — no
     * foe carried a chaining element — and then a wet hero would have
     * chained the Stormling's own bolt into its wet packmates, the precise
     * §10 confound where MORE foes make a fight EASIER.
     */
    hitsFoes = true,
  ): void {
    // Ids are unique across hero (0), foes and bystanders — see `victims()`.
    if (struck.has(v.id)) return;
    struck.add(v.id);

    const impact = applyElement(damage, element, statusIds(v.statuses), ownStatus);

    for (const r of impact.removes) {
      const had = removeStatus(v.statuses, r);
      // THE DRY WINDOW OPENS BY HAND (R4 recut): fire or frost stripping the
      // boss's coat while a lit bowl holds the re-wet cadence paused is the
      // player CASHING the window they earned — announce it. A strip beside
      // dark bowls stays silent: the coat is back within `rewetTicks`, and a
      // tell on a 1.5 s micro-window would teach the loud moment to lie.
      if (had && r === "wet" && v.kind === "foe") {
        const bf = v.body as RtFoe;
        const bk = foeKind(bf.kindId).boss;
        if (
          bk &&
          s.hutFires.some((hf) => hf.keepLit && hf.lit && dist(bf, hf) <= bk.dryRadius)
        ) {
          ev.bossDried = { id: bf.id, kindId: bf.kindId, x: bf.x, z: bf.z };
        }
      }
    }
    if (impact.damage > 0) {
      const applied = v.hurt(impact.damage);
      // What actually landed, not what the matrix produced. A hero caught by
      // their own blast is reported at the rate they took it.
      if (applied > 0) {
        // THE MATRIX EXPRESSING COUNTS AS COMPOSING (R5, fun's live ruling).
        // A combo or a chain IS the lesson: water on the ground and a spark
        // into it is exactly what the Mire Pool teaches, with Sella's question
        // attached — and a player who learned stage 4 and applies it at stage
        // 6 was being classed a refuser for doing it in two casts instead of
        // one. The claim this fight makes is that the MATRIX is required; the
        // weave's reward is efficiency, not permission.
        if ((impact.combo !== null || chained) && v.kind !== "hero") {
          for (const mk of s.markers) {
            if (mk.triggered && !mk.cleared) mk.composed = true;
          }
        }
        ev.impacts.push({
          x: v.body.x,
          z: v.body.z,
          element,
          damage: applied,
          combo: impact.combo,
          chained,
          source: hopFrom,
          onHero: v.kind === "hero",
        });
      }
    }
    if (impact.applies && addStatus(v.statuses, impact.applies)) {
      ev.statuses.push({ x: v.body.x, z: v.body.z, status: impact.applies });
    }

    if (impact.spreads && impact.applies) {
      for (const other of all) {
        if (other === v || dist(other.body, v.body) > SPREAD_RADIUS) continue;
        if (other.kind === "hero" && !hitsHero) continue;
        if (other.kind === "foe" && !hitsFoes) continue;
        if (addStatus(other.statuses, impact.applies)) {
          ev.statuses.push({
            x: other.body.x,
            z: other.body.z,
            status: impact.applies,
          });
        }
      }
    }

    if (!chained && impact.chainOn) {
      for (const other of all) {
        if (other === v || !hasStatus(other.statuses, impact.chainOn)) continue;
        if (dist(other.body, v.body) > CHAIN_RADIUS) continue;
        if (other.kind === "hero" && !hitsHero) continue;
        if (other.kind === "foe" && !hitsFoes) continue;
        // A chain hop is a hit like any other, so it spends the hero's
        // invulnerability window rather than sneaking under it.
        if (other.kind === "hero" && hero.iframes > 0) continue;
        land(
          other,
          element,
          damage,
          ownStatus,
          true,
          all,
          struck,
          hitsHero,
          {
            x: v.body.x,
            z: v.body.z,
          },
          hitsFoes,
        );
        if (other.kind === "hero" && damage > 0) hero.iframes = IFRAME_TICKS;
      }
    }
  }

  /** Shove a body directly away from a point. */
  function shove(b: RtBody, fromX: number, fromZ: number, metres: number): void {
    if (metres <= 0) return;
    const dx = b.x - fromX;
    const dz = b.z - fromZ;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return;
    // Applied as velocity, so the shove obeys terrain and blockers like
    // everything else rather than teleporting a body through a tree.
    b.vx += (dx / d) * (metres / TICK_HZ);
    b.vz += (dz / d) * (metres / TICK_HZ);
  }

  /**
   * An impact at a point: field reaction, conduction, then every body in range.
   */
  function detonate(
    x: number,
    z: number,
    element: Element,
    damage: number,
    status: StatusId | null,
    patch: PatchKind | null,
    radius: number,
    knockback: number,
    hitsHeroArg: boolean,
    excludeIds: readonly number[] = [],
    /** 1 for anything the world does to you; `s.selfDamage` for your own. */
    heroScale = 1,
    /**
     * False for FOE attacks: a Rotling biting the hero must not chunk its own
     * packmates. This confound has now distorted three separate measurements —
     * the determinism pack stabilised at 45 hp with the swarm dead around the
     * hero, the perf pilot's inferno emptied itself, and the Dry Gulch cleared
     * for a singles-only pilot because five converging chargers killed each
     * other — and worse than any measurement, it inverts §10: MORE foes made a
     * fight EASIER. Foe-versus-foe harm still exists where it is designed to:
     * the player's ground fires burn whoever stands in them.
     */
    hitsFoes = true,
    /**
     * Where the blast CAME from, for the presentation — one tick back along a
     * projectile's flight, the biter's own position for a melee. Null keeps
     * hand-built test calls terse; the event then points at itself.
     */
    source: { x: number; z: number; fromHero: boolean } | null = null,
    /**
     * Multiplier on the LAID patch's radius and lifetime, never the blast
     * (R6a — Deluge). 1 for everything without a patch identity.
     */
    patchScale = 1,
    /**
     * Fallback shove origin for a victim standing AT the blast centre (R4
     * Phase A, comp's audit catch): the edge-hit fix detonates a bolt ON its
     * victim, which made "away from the blast" no direction at all and
     * silently deleted the primary victim's knockback — spore's 1.4 shove
     * identity gone on every direct hit. The projectile body-hit path passes
     * its previous flight position here, restoring the pre-fix flight-line
     * shove. Deliberately NOT defaulted from `source`: a melee bite has
     * detonated at the victim's centre since it was written, and waking a
     * hero-shove on every bite in the game is a feel change, not a bug fix.
     */
    shoveFrom: { x: number; z: number } | null = null,
  ): void {
    // The point itself is an event even when nobody is standing in it — a
    // bolt bursting on empty ground is the most common outcome of a cast.
    ev.detonations.push({
      x,
      z,
      element,
      radius,
      fromHero: source?.fromHero ?? false,
      sourceX: source?.x ?? x,
      sourceZ: source?.z ?? z,
    });
    // A downed hero is not in the world. Folded into the existing flag rather
    // than bolted on as a fourth guard, because `hitsHero` already threads
    // through `land`'s two recursions and a second flag would have to as well —
    // which is exactly the shape of the bug where the chain honoured it at the
    // point of impact and ignored it one hop later.
    const hitsHero = hitsHeroArg && !heroOut();
    const all = victims(heroScale);
    /** One detonation touches each body once. See `land`. */
    const struck = new Set<number>();

    // Scenery fires answer water. The first playtest cast water at a burning
    // hut and the world ignored them — the flames were pure presentation. Now
    // any water detonation close enough puts the fire out, pays a few spores
    // (a success, and sim-side so a replay pays it too), and reports the
    // moment for the steam burst.
    if (element === "water") {
      for (const hf of s.hutFires) {
        if (!hf.lit) continue;
        if (dist({ x, z }, hf) > hf.r + radius) continue;
        // A KEPT flame answers the world's water only when the blast lands
        // ON the bowl (R4 recut): the boss's douse SLAM detonates at the
        // bowl itself and still kills it; a stray lob bursting on a hero
        // DEFENDING their flame does not — measured, the collateral splash
        // re-doused the anchored fight's bowl every 2.7 s and the earned
        // window never opened, the artillery deleting the bowl counter-play
        // as a side effect. The player's own water keeps full splash reach
        // both ways: dousing your own objective bowl by fighting sloppy
        // beside it stays a mistake you can make (damp_pyres' whole point).
        if ((source?.fromHero ?? false) === false && hf.keepLit && dist({ x, z }, hf) > hf.r) {
          continue;
        }
        hf.lit = false;
        // A brazier douse pays nothing (R4): a bowl the player can cycle
        // wet/dry must never be a loot pump — and putting out your own
        // objective is not a success in the first place.
        if (!hf.keepLit) s.loot += DOUSE_SPORES;
        ev.hutDoused.push({ x: hf.x, z: hf.z });
      }
    }
    // And braziers answer fire (R4): the douse mirrored. Only keepLit fires
    // relight — a fire cast must never re-ignite a doused hut and re-shut
    // the village gate behind the lesson the player already finished.
    if (element === "fire") {
      for (const hf of s.hutFires) {
        if (!hf.keepLit || hf.lit) continue;
        if (dist({ x, z }, hf) > hf.r + radius) continue;
        hf.lit = true;
        ev.pyreLit.push({ x: hf.x, z: hf.z });
      }
    }

    // The floor reacts first, so a target standing in oil that just became
    // fire is already Burning when the direct hit resolves.
    const { conducted, ignited } = elementOnField(s.patches, nextId, element, x, z, radius);
    for (const p of ignited) {
      ev.patches.push({ x: p.x, z: p.z, r: p.r, kind: p.kind, ignited: true });
    }

    if (patch) {
      const laid = addPatch(
        s.patches,
        nextId,
        patch,
        x,
        z,
        Math.max(1.1, radius) * patchScale,
        Math.round(PATCH_TICKS[patch] * patchScale),
      );
      ev.patches.push({ x: laid.x, z: laid.z, r: laid.r, kind: laid.kind, ignited: false });
    }

    // Lightning into water: everything standing in that pool takes it, whether
    // or not it was anywhere near the point of impact. This is the single most
    // chaotic rule in the game and it applies to the hero too.
    for (const pool of conducted) {
      for (const v of all) {
        if (v.kind === "hero" && !hitsHero) continue;
        if (v.kind === "foe" && !hitsFoes) continue;
        if (dist(v.body, pool) > pool.r) continue;
        if (excludeIds.includes(v.id) && v.kind !== "hero") continue;
        if (v.kind === "hero" && hero.iframes > 0) continue;
        land(v, element, damage, status, false, all, struck, hitsHero, null, hitsFoes);
        if (v.kind === "hero" && damage > 0) hero.iframes = IFRAME_TICKS;
      }
    }

    for (const v of all) {
      if (v.kind === "hero" && !hitsHero) continue;
      if (v.kind === "foe" && !hitsFoes) continue;
      if (excludeIds.includes(v.id)) continue;
      if (dist(v.body, { x, z }) > radius) continue;
      if (v.kind === "hero" && hero.iframes > 0) continue;
      const before = struck.size;
      land(v, element, damage, status, false, all, struck, hitsHero, null, hitsFoes);
      // Knockback only for bodies this detonation actually caught — a body
      // already struck by conduction is not shoved a second time. A victim
      // AT the blast centre (the edge-hit fix's primary) shoves from the
      // flight-line fallback instead — see `shoveFrom`.
      if (struck.size > before) {
        const degenerate = shoveFrom !== null && dist(v.body, { x, z }) < 1e-6;
        shove(v.body, degenerate ? shoveFrom.x : x, degenerate ? shoveFrom.z : z, knockback);
        // THE SHOVE STAGGERS (R6a). fun's sandbox trials: every shove nova
        // bought ~1.2 m of space and ZERO safety — the standoff AI re-closed
        // inside one bite interval, so casting Steam Vent measured identical
        // hpLost to not casting at all. A shove-strength hit (>= 2.0 — Steam
        // Vent 3.0, Mudshot 3.6, spore² 2.8; bolt taps at 0.3-0.4 stay free)
        // floors the victim's recover, so the space BOUGHT is space KEPT for
        // a beat. Recover only — a committed windup still lands (§10: a read
        // telegraph is a promise), and `recover` is already hashed.
        if (v.kind === "foe" && knockback >= SHOVE_STAGGER_KB) {
          const f = v.body as RtFoe;
          f.recover = Math.max(f.recover, SHOVE_STAGGER_TICKS);
        }
      }
      if (v.kind === "hero" && damage > 0) hero.iframes = IFRAME_TICKS;
    }
  }

  /**
   * Commit a mix: snapshot the queue, start the root, face the aim. Shared by
   * the `cast` command and the buffered follow-up consumed when a root ends,
   * so a chained cast is the same code path as a pressed one.
   */
  function commitCast(form: CastForm, aimX: number, aimZ: number): void {
    const elements = [...hero.queue];
    const spell = resolveMix(elements, form);
    hero.casting = { elements, form, aimX, aimZ };
    hero.castTicks = spell.castTicks;
    hero.queue.length = 0;
    ev.queueChanged = true;
    // The root begins now; the launch is `ev.casts`, castTicks later.
    ev.castCommitted = { elements: [...elements], form, ticks: spell.castTicks };
    // Face the cast. A caster who fires sideways reads as broken.
    if (form === "aimed") {
      const dx = aimX - hero.x;
      const dz = aimZ - hero.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) turnToward(hero, dx / d, dz / d, HERO_TURN_RATE);
    }
  }

  /* ------------------------------------------------- 1. hero commands */

  let ix = 0;
  let iz = 0;
  let takeRequested = false;
  for (const c of commands) {
    // On the floor, the hero does nothing. Movement, queue edits and casts are
    // all dropped — not buffered — so a player mashing through the countdown
    // does not come back up mid-cast with a queue they composed while dead.
    // The three recovery commands below are the exceptions and they are
    // deliberately the ONLY exceptions.
    const recovery =
      c.type === "revive" ||
      c.type === "restartStage" ||
      c.type === "newRun" ||
      c.type === "advanceStage" ||
      // A grant arrives from the stage-clear seam, which can be dismissed
      // while the hero is having a bad time. Power found is power found.
      c.type === "grant";
    if (heroOut() && !recovery) continue;
    switch (c.type) {
      case "grant":
        if (c.weave) applyGrant(s, ev, "weave");
        if (c.element) applyGrant(s, ev, c.element);
        break;
      case "move":
        ix = c.dx;
        iz = c.dz;
        break;
      case "revive": {
        if (!heroOut()) break;
        hero.downTicks = 0;
        hero.defeated = false;
        hero.hp = hero.maxHp * REVIVE_HP_FRACTION;
        // Standing back up inside the fire that killed you is not a revive.
        hero.statuses.length = 0;
        hero.statusDebt = 0;
        hero.queue.length = 0;
        hero.casting = null;
        hero.castTicks = 0;
        hero.buffered = null;
        hero.castCd = 0;
        // §8's 2–3 s spawn invulnerability, spent through the ordinary iframe
        // field so there is exactly one way in this sim to be untouchable.
        hero.iframes = REVIVE_GRACE_TICKS;
        ev.heroRevived = true;
        ev.queueChanged = true;
        break;
      }
      case "newRun":
      case "restartStage": {
        // The non-ad path §8 requires, and the camp's way back to the top.
        // Every fight in scope goes back to untriggered, its foes are removed,
        // the lock lifts, and the hero is put on the entry point, upright.
        const whole = c.type === "newRun";
        const inScope = (stage: number): boolean => whole || stage === s.stageIndex;
        for (const m of s.markers) {
          if (!inScope(m.stage)) continue;
          m.triggered = false;
          m.cleared = false;
          // THE VALVE RE-ARMS WITH THE FIGHT (R5, fun's binding rider). A
          // latch tripped on attempt one, a spent budget, or a clock already
          // past the gate would all make attempt two silently different from
          // attempt one — the worst thing a retry can do, because the player
          // has no way to see it and no way to ask. The fight comes back as
          // the fight, not as its own aftermath.
          m.composed = false;
          m.fightTicks = 0;
          m.reinforceLeft = m.reinforce?.budget ?? 0;
        }
        s.foes = s.foes.filter((f) => {
          const m = s.markers.find((k) => k.id === f.markerId);
          return !m || !inScope(m.stage);
        });
        if (whole) {
          for (const st of s.stages) st.cleared = false;
          s.stageIndex = 0;
          // The captives are captive again — the road is the road, and Sella is
          // pinned on it. Anything else means a second run with no rescue in it.
          // ON their road (R4.5): the flag alone left the BODY wherever run 1
          // ended, so run 2's rescue fired at that spot. With a post at the far
          // end of the chapter that stops being untidy and becomes fatal — the
          // village would open with nobody standing on the road to ask for the
          // douse, thank the player for it, or plant the pool's question.
          for (const b of s.bystanders) {
            b.ai = "captive";
            b.x = b.homeX;
            b.z = b.homeZ;
            b.vx = 0;
            b.vz = 0;
            b.crossTicks = 0;
            b.down = 0;
            b.hp = b.maxHp;
            b.statuses.length = 0;
            b.statusDebt = 0;
          }
          // And the village burns again. Walking the road again means the
          // road AS AUTHORED (`lit0`): damp_pyres' bowls stand alight, the
          // boss arena's stand dark — a blanket relight would hand the boss
          // room its earned windows for free on every second run. A stage
          // RETRY still inherits fire state (pinned by test — a douse
          // survives a retry, and a dark pyre does too; FIRE is provably in
          // hand by damp_pyres, the gate's own find conjunct guarantees it,
          // so a dark-pyre retry is never stranded).
          for (const hf of s.hutFires) hf.lit = hf.lit0;
          // The elements go back too. The road IS the curriculum — walking it
          // again with the full arc would be the sandbox with scenery, and a
          // player who wants that has the grimoire ahead of them instead.
          // Campaign semantics; the sandbox resets by recreating state.
          s.unlocked = ["spore"];
          s.queueMax = 1;
          hero.queue.length = 0;
          ev.queueChanged = true;
          // And the finds stand back up on the road, waiting to be found again.
          for (const p of s.pickups) p.taken = false;
          // Walking it again begins the way the game began: already running
          // (R4, fun's R3 note — the second run opened on a hero standing
          // dead still at the lake, where the first run's whole identity is
          // arriving in motion). Sim-side, so it replays and it is hashed.
          s.autorun = true;
        }
        if (!whole) {
          // THE PINATA PATH, closed (R4 recut, fun's fairness bar: phase
          // pressure on EVERY entry path, the death-retry included). A stage
          // RETRY inherits OBJECTIVE fire state — a douse survives, a dark
          // pyre does too; both pinned, both correct: that state is the
          // player's earned progress toward the gate. The boss arena's
          // TACTICAL bowls (`gates: false`, the stage −1 convention) are not
          // progress, they are the fight — and the fight respawns. A bowl
          // lit on attempt one must not hand every retry a pre-dried,
          // regen-free boss, so they re-arm to authored state with the foes.
          for (const hf of s.hutFires) {
            if (hf.stage === -1 && hf.keepLit && hf.stage0 === s.stageIndex) hf.lit = hf.lit0;
          }
        }
        // THE FLOOR RE-ARMS WITH THE FIGHT (R5, fun's live catch). The block
        // above brings the marker back — foes, `composed`, the clock, the
        // budget — and projectiles are cleared here, but the GROUND was not:
        // a water pool laid in the last seconds of a failed attempt was still
        // burning when the retried fight triggered, and one spark single into
        // it fired Chain!, set `composed`, and exempted the whole attempt for
        // free. The fight came back as the fight and the floor came back as
        // its own aftermath.
        //
        // The window is wide rather than a knife-edge: water lives ~285 ticks
        // against a ~63-tick walk from the stage entry to the trigger, so
        // anything laid in the last seven seconds survives. And it lands on
        // exactly the population the row is about — a player who dies here is
        // by construction a player who was trying things.
        //
        // Scoped through `inScope`, the same predicate the marker re-arm uses,
        // so a retry and a `newRun` cannot drift apart. `arena + p.r` because a
        // pool centred outside the ring still floods into it. Patches on open
        // road belong to no fight and are deliberately left: they expire on
        // their own, and wiping them would make the retry differ from attempt
        // one in a second place rather than one fewer (fun's ruling).
        s.patches = s.patches.filter(
          (p) => !s.markers.some((m) => inScope(m.stage) && dist(p, m) <= m.arena + p.r),
        );
        s.projectiles.length = 0;
        s.lock = null;
        hero.downTicks = 0;
        hero.defeated = false;
        hero.hp = hero.maxHp;
        hero.statuses.length = 0;
        hero.statusDebt = 0;
        hero.queue.length = 0;
        hero.casting = null;
        hero.castTicks = 0;
        hero.buffered = null;
        hero.castCd = 0;
        hero.iframes = REVIVE_GRACE_TICKS;
        hero.x = c.x;
        hero.z = c.z;
        hero.vx = 0;
        hero.vz = 0;
        ev.heroRevived = true;
        ev.queueChanged = true;
        break;
      }
      case "advanceStage":
        // Only ever forward, and only off a cleared stage — a stray command
        // must not be able to skip a fight.
        if (s.stages[s.stageIndex]?.cleared && s.stageIndex < s.stages.length - 1) {
          s.stageIndex++;
          // The crossing debounce belongs to ONE gate; the next stage starts
          // its own count from zero.
          s.gateCrossTicks = 0;
          // THE GATE IS A REST. Without this the chapter runs on one health
          // bar and every stage inherits the last one's attrition — the funnel
          // measured the correct-play pilot arriving at stage 4 too worn to
          // survive a fight it beat comfortably when fresh. Difficulty must be
          // the stage's own composition (§10), not the tour's accumulated
          // damage; healing at the seam makes each stage self-contained,
          // testable, and honest about what killed you.
          hero.hp = hero.maxHp;
          hero.statuses.length = 0;
          hero.statusDebt = 0;
        }
        break;
      case "queue":
        // The queue is editable DURING a root: the committed mix was
        // snapshotted into `hero.casting` at commit, so edits here compose the
        // NEXT cast — which is exactly what the HUD preview shows. The old
        // mid-cast lock predated that snapshot; dropping it is what lets a
        // player chain mixes without dead air.
        //
        // The two remaining gates are the progression (`GAME_DESIGN.md` §3.1):
        // an element you have not FOUND cannot be queued, and the queue holds
        // one element until THE WEAVE is found. Enforced here, in the sim, so
        // a replay and a hand-crafted command stream obey the same curriculum
        // the HUD shows — the HUD hiding a button is presentation, this is
        // the rule.
        if (!s.unlocked.includes(c.element)) {
          // Not found yet. Reported rather than swallowed (R6) — see
          // `queueRefused`. Order matters: `locked` is checked first because a
          // player missing the element and missing the slot should be told the
          // half they can do something about on the road.
          ev.queueRefused.push({ element: c.element, reason: "locked" });
        } else if (hero.queue.length >= s.queueMax) {
          ev.queueRefused.push({ element: c.element, reason: "full" });
        } else {
          hero.queue.push(c.element);
          ev.queueChanged = true;
        }
        break;
      case "clear":
        if (hero.queue.length > 0) {
          hero.queue.length = 0;
          ev.queueChanged = true;
        }
        break;
      case "cast": {
        if (hero.casting || hero.castCd > 0) {
          // A press during the root OR the recovery is not discarded: it
          // becomes the follow-up, applied when both have run out. Last
          // press wins. Recovery buffering is what makes mashing PACE casts
          // (third playtest) instead of losing them.
          hero.buffered = { form: c.form, aimX: c.aimX, aimZ: c.aimZ };
          break;
        }
        if (hero.queue.length === 0) break;
        commitCast(c.form, c.aimX, c.aimZ);
        break;
      }
      case "take":
        takeRequested = true;
        break;
      case "spawn":
        spawnFoe(s, c.kindId, c.x, c.z, c.markerId ?? -1);
        break;
      case "spawnBystander":
        addBystander(s, c.x, c.z, c.name);
        break;
    }
  }

  /* -------------------------------------------------- 2. hero movement */

  // The opening run-in (§9). The hero is already moving when the player
  // arrives, and the moment they steer for themselves the script lets go for
  // good. Checked BEFORE integrating, so the very first tick already has them
  // in motion.
  if (ix !== 0 || iz !== 0) {
    s.autorun = false;
  } else if (s.autorun) {
    // The active stage only. A run-in that steered at a fight two stages up
    // the road would walk the hero straight through the stage boundary it is
    // supposed to stop at.
    const target = s.markers.find((m) => !m.cleared && m.stage === s.stageIndex);
    if (target) {
      const dx = target.x - hero.x;
      const dz = target.z - hero.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.1) {
        ix = dx / d;
        iz = dz / d;
      }
    } else {
      s.autorun = false;
    }
  }

  const heroSlip = fieldSlipAt(s.patches, hero.x, hero.z);
  const heroSpeed = MAX_SPEED * speedMultiplier(hero.statuses);
  // Casting roots you. This is the core tension of the whole system: a
  // three-element mix is powerful and it plants your feet while it resolves.
  // Being down roots you rather more thoroughly.
  const rooted = hero.castTicks > 0 || heroOut();
  integrate(
    world,
    hero,
    rooted ? 0 : ix,
    rooted ? 0 : iz,
    heroSpeed,
    heroSpeed / 5,
    heroSlip,
  );
  pushOutOfBlockers(world, hero, HERO_RADIUS);
  // The hero turns at their own, faster rate: casts fire along facing, so
  // turn rate IS aim responsiveness (§12's sanctioned dial). Facing follows
  // velocity only under INPUT — a knockback is velocity the player never
  // asked for, and letting it steer the facing meant every bite spun the
  // hero's aim away from the biter. You keep aiming where you aimed while
  // being shoved. (Autorun counts as input: it writes ix/iz above.)
  if (!rooted && (ix !== 0 || iz !== 0)) faceVelocity(hero, HERO_TURN_RATE);
  if (hero.iframes > 0) hero.iframes--;

  // THE ARENA LOCK. Applied after `pushOutOfBlockers`, because that can
  // itself shove a body out of the ring. Foes get the same ring at 5c.
  if (s.lock) clampToRing(hero, s.lock);

  /* ------------------------------------------- 2b. did we walk into a fight? */
  // Checked immediately after the hero moves, so an encounter opens on the
  // tick the player crossed the line. Unlike the turn-based build this does
  // NOT freeze anything — the foes simply arrive, and the fight is already
  // under way in a world that never stopped.
  /** A marker-owned fight is unresolved somewhere. */
  const fightLive = s.markers.some((m) => m.triggered && !m.cleared);

  for (const m of s.markers) {
    if (m.triggered) {
      // THE VALVE (R5). Runs before the clear test, because an arrival keeps
      // the fight alive and a fight cleared on the same tick a body was owed
      // would be a race the player could not see.
      if (!m.cleared && m.reinforce) {
        m.fightTicks++;

        // Open only while the pack is still at strength: one mass-clear takes
        // it under the threshold and shuts this for the rest of the fight,
        // which is why taught play never meets it. Single-target play removes
        // one body at a time and cannot get under the line — its progress is
        // a SIGN, and dice do not move signs.
        const since = m.fightTicks - m.reinforce.after;
        if (
          m.reinforceLeft > 0 &&
          // Composing exempts you, permanently, from the tick you do it —
          // which is also what makes the lesson legible: the tide stops the
          // instant you mix.
          !m.composed &&
          since >= 0 &&
          since % m.reinforce.every === 0
        ) {
          // THE FAR SIDE (R5, gfx's catch). A fixed rotation through the ring
          // points put a body two metres from the hero — the entry was exactly
          // on the rim as authored, but the FIGHT had drifted to that rim, and
          // a rim the pack is standing on is not a distinct place any more.
          // Measured before this: an arrival gathering 0.0 m from the hero.
          //
          // Points fixed relative to the MARKER cannot stay away from a fight
          // that moves, so the choice is made relative to the player instead:
          // the authored point furthest from the hero, every time. Still the
          // same eight authored, validated positions; still no RNG. Ties keep
          // the earlier index, so it stays deterministic.
          //
          // It also reads better than the rotation did: "they come in from the
          // far side" is a rule a player can learn in one arrival, and a body
          // that never appears in the melee cannot be read as spawning on top
          // of them however loud the cue is.
          // ACROSS THE FAR SIDE, not from one point on it (R5, fun's live
          // read). A single farthest point emits every body along the same
          // path: eight foes measured at 1.9 · 2.7 · 3.6 · 4.6 · 5.7 · 6.8 ·
          // 7.6 · 8.7 m, evenly spaced on one bearing — a conga line filing in
          // from a spawner, not a flank arriving. Same rule and same fairness
          // (still away from the player, still authored points, still no RNG);
          // the arrivals just rotate across the far ARC so they read as a
          // pincer instead of a queue.
          const ranked = m.reinforce.from
            .map((e, i) => ({
              e,
              i,
              d: (m.x + e.dx - hero.x) ** 2 + (m.z + e.dz - hero.z) ** 2,
            }))
            // Farthest first; ties keep authored order, so it stays
            // deterministic.
            .sort((a, b) => b.d - a.d || a.i - b.i);
          const ARC = 3;
          const at = ranked[m.reinforceLeft % Math.min(ARC, ranked.length)]!.e;
          m.reinforceLeft--;
          spawnFoe(s, m.reinforce.kindId, m.x + at.dx, m.z + at.dz, m.id);
          // The render layer's cue hangs off this: an arrival the player does
          // not see coming reads as the game adding enemies, which is the one
          // way this mechanic fails even when the sign is right.
          ev.reinforced.push({ x: m.x + at.dx, z: m.z + at.dz, kindId: m.reinforce.kindId });
        }
      }
      // Cleared once every foe THIS marker spawned is gone. Progression, so it
      // is hashed. The global `s.foes.length === 0` test this replaced was
      // invisible in a sandbox with one wave and wrong the moment a road
      // carries three fights: winning either of two live fights cleared both.
      if (!m.cleared && !s.foes.some((f) => f.alive && f.markerId === m.id)) {
        m.cleared = true;
        ev.markersCleared.push(m.id);
        s.lock = null; // the ring opens; walk on
      }
      continue;
    }
    // ONE FIGHT AT A TIME. Two markers 6.9 m apart on this road means an arena
    // lock around either one contains the other's trigger circle, so without
    // this the lock itself would spawn the next fight into the current one.
    // It is also just what a stage IS: a sequence, not a pile.
    if (fightLive) continue;
    // A dormant stage's fights do not wake up. This is the stage boundary, and
    // it is the whole of it — no load, no mode, no second state machine.
    if (m.stage !== s.stageIndex) continue;
    if (Math.hypot(hero.x - m.x, hero.z - m.z) > m.radius) continue;
    m.triggered = true;
    s.autorun = false; // the run-in has done its job; the rest is the player's
    s.lock = { x: m.x, z: m.z, r: m.arena };
    for (const f of m.foes) spawnFoe(s, f.kindId, m.x + f.dx, m.z + f.dz, m.id, f.douser);
    ev.markersTriggered.push(m.id);
    break; // one this tick; the next needs this one won
  }

  /* ------------------------------------------------- 2c. the stage boundary */
  // THE SEAM (`CLAUDE.md` §8). Every fight in this stage won AND every fire
  // this stage gates on doused AND the exit reached. The fires are the third
  // conjunct (round 7): the village is the WATER lesson, and a lesson you can
  // walk past is not a lesson — the gate stays shut while a bound hut burns.
  // The fight's arena lock still opens on the last kill; only the SEAM waits.
  const stage = s.stages[s.stageIndex];
  // Debounce the arc-order crossing (see roadArcFlipped): the flip must HOLD
  // before it counts, so a hairpin approach's one-tick artifact can never
  // pre-empt the disc.
  if (stage && !stage.cleared) {
    s.gateCrossTicks = roadArcFlipped(
      world,
      s,
      hero.x,
      hero.z,
      world.gateIndices[s.stageIndex] ?? -1,
    )
      ? s.gateCrossTicks + 1
      : 0;
  }
  if (
    stage &&
    !stage.cleared &&
    !heroOut() &&
    s.markers.every((m) => m.stage !== s.stageIndex || m.cleared) &&
    // A hut fire holds the gate while LIT; a brazier holds it while DARK
    // (R4, damp_pyres — the same grammar, inverted by `keepLit`).
    s.hutFires.every(
      (hf) => hf.stage !== s.stageIndex || (hf.keepLit ? hf.lit : !hf.lit),
    ) &&
    // ONE DEFINITION, TWO CONSUMERS (R6). This conjunct and the HUD's
    // objective chip are the same question — "is a find standing on the road
    // behind the player?" — and they had drifted into two inline predicates
    // with different answers: the gate held the run open while the chip stayed
    // silent, which is how a player reached the Dry Gulch without THE WEAVE
    // and was never told why. `leftBehindFind` is that question, once.
    // A gate never closes behind an untaken find (R4 — fun's find-skip
    // soft-lock). A pickup with `stage < stageIndex` stands BEHIND this gate:
    // its own stage is cleared (stageIndex only advances off a cleared
    // stage), so it is takeable, and the corridor's one-way boundary still
    // sits at the PREVIOUS gate — the walk back to it is legal exactly
    // because this seam has not fired. Without this conjunct a plain held
    // walk past WATER crossed here, `advanceStage` moved the one-way
    // boundary past the gem, and the village — which REQUIRES water — was
    // unreachable forever, with the autosave at this very seam poisoning
    // reload too. The douse-gate pattern pointed backward: a lesson you can
    // walk past is not a lesson, and power the curriculum builds on cannot
    // be abandoned on the road. Take stays a PRESS — the seam waits, it
    // never collects. (R7 note: loot drops joining `pickups` must be exempt
    // — leaving loot is a choice; only grants gate.)
    leftBehindFind(s) === null &&
    // The disc for the road-following walk (every measured timing keeps its
    // tick), OR the HELD arc-order crossing for the verge walk (R1: the disc
    // is road-surface-sized, the corridor is 4.5 m — the seam must span
    // everywhere the clamp lets the hero walk).
    (Math.hypot(hero.x - stage.exitX, hero.z - stage.exitZ) <= stage.exitR ||
      s.gateCrossTicks >= CROSS_PERSIST_TICKS)
  ) {
    stage.cleared = true;
    s.gateCrossTicks = 0;
    ev.stageCleared = s.stageIndex;
  }

  /* ------------------------------------------------------- 2d. the finds */
  // Power is found by TAKING it (third playtest — contact alone collected,
  // and the ceremony vanished into a walk): the find stands on the road past
  // its stage's gate, the prompt appears in range, and the `take` command
  // collects the nearest eligible one. Still gated on the stage being
  // cleared, so a runner who slips past a gate cannot hold power the seam
  // never announced — the gem waits, visibly, until the gate has opened.
  if (takeRequested && !heroOut()) {
    let best: (typeof s.pickups)[number] | null = null;
    let bestD = PICKUP_RADIUS;
    for (const p of s.pickups) {
      if (p.taken || !s.stages[p.stage]?.cleared) continue;
      const d = Math.hypot(hero.x - p.x, hero.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      best.taken = true;
      applyGrant(s, ev, best.kind);
      ev.pickedUp.push({ x: best.x, z: best.z, kind: best.kind });
    }
  }

  /* ---------------------------------------------------- 3. the cast fires */

  if (hero.casting) {
    if (hero.castTicks > 0) hero.castTicks--;
    if (hero.castTicks === 0) {
      const c = hero.casting;
      hero.casting = null;
      // Recovery starts the moment the spell leaves — the spam ceiling, and
      // the window the HUD's recharge bar draws. The duration is sim state
      // (`s.castCooldown`) so the sandbox can dial the pacing live.
      hero.castCd = s.castCooldown;
      const spell = resolveMix(c.elements, c.form);
      // COMPOSED (R5). Two or more elements is a mix, and casting one in a
      // live fight exempts the player from that fight's reinforcement for
      // good. Recorded on the fight rather than on the hero: it is a property
      // of this encounter, and a retry re-arms it with the marker.
      // COMBINATION, not repetition (R5, fun's live blocker). The two-slot
      // queue turns impatience into a spell: pressing one element twice fills
      // it with [spore, spore] and fires a two-element cast. Crediting length
      // alone exempted a fight after six presses of one key — and that is the
      // MODAL refuser, because a player who has not learned to compose mashes
      // their favourite element rather than casting neatly-spaced singles. The
      // scripted refuser's clean spacing never doubles its queue, which is why
      // 82 phase samples passed over it.
      //
      // THE CALL, made explicitly rather than inherited: a DOUBLE — Deluge is
      // water² — does not count as composing here. Two reasons, and the second
      // is the one that decides it. First, this stage's lesson is the matrix:
      // pressing one key twice teaches nothing about combination. Second, and
      // decisively, a deliberate double is UNOBSERVABLE from an impatient
      // mash — same queue, same cast, same everything — so a predicate that
      // credits one credits the other. A rule that cannot distinguish intent
      // must exclude both.
      //
      // Known cost, recorded rather than hidden: a player who lays Deluge and
      // then sparks it IS working the matrix, in two casts instead of one, and
      // is not credited here. If live play finds that player, the escalation
      // is to also credit a cast that fires a matrix combo — not to loosen
      // this back to counting elements.
      const distinct = c.elements.some((e, i) => i > 0 && e !== c.elements[0]);
      if (distinct) {
        for (const mk of s.markers) {
          if (mk.cleared) continue;
          // Composed AT THIS FIGHT, attributed by where the cast goes rather
          // than by when it was thrown. A live fight counts however the mix is
          // aimed; a fight not yet woken counts if the mix lands inside its
          // ring — which is the player who lays the pool in the dry hollow and
          // walks the pack into it (fun's R5 catch: the smartest reading of
          // the stage, and it was being booked as refusal).
          //
          // Spatial rather than a time window on the hero, because a window
          // wide enough to cover the walk-in also lets a mix thrown at the
          // PREVIOUS fight vouch for this one — the gulch opens about seventy
          // ticks after the well is won.
          // The EFFECT reaching the ring, not the centre landing in it: a
          // Conduction pool laid at the lip still floods into the fight, and
          // testing the impact point alone would book that player a refuser by
          // ten centimetres. Boundaries are where knife-edges live, so this one
          // is deliberately generous — over-crediting costs only the
          // throwaway-mix weakness already accepted, while under-crediting
          // lands on the player who read the stage best.
          const reach =
            Math.hypot(c.aimX - mk.x, c.aimZ - mk.z) <= mk.arena + spell.radius;
          const at = mk.triggered || reach;
          if (at) mk.composed = true;
        }
      }
      ev.casts.push({
        name: spell.name,
        element: spell.primary,
        x: hero.x,
        z: hero.z,
        fizzled: spell.fizzled,
      });

      if (!spell.fizzled) {
        if (c.form === "self") {
          // Self-cast is the cleanse and the set-up, not a suicide button.
          // It novas everything AROUND the hero, applies the element to the
          // hero with no damage — which is how Water puts you out — and lays
          // the patch under your own feet, where it is your problem.
          //
          // The one deliberate exception to friendly fire, and it survives the
          // change rather than being overlooked by it: `hitsHero` stays false
          // here so the nova cannot damage the body at its own centre. The
          // patch it leaves underfoot is where the cost lives — self-cast fire
          // still sets the floor you are standing on alight, and step 7 bills
          // you for that at the full rate like anyone else.
          detonate(
            hero.x,
            hero.z,
            spell.primary,
            // The nova dial (R2 → R6): self-form damage scales by
            // `selfPower`, so "aim-free full damage" stops being free once
            // the sitting prices it. Status, patch and the cleanse stay at
            // full strength — the dial is on the DAMAGE, the utility is the
            // form's identity.
            spell.damage * s.selfPower,
            spell.status,
            spell.patch,
            Math.max(2.2, spell.radius * 1.6),
            spell.knockback,
            false,
            [],
            1,
            true,
            { x: hero.x, z: hero.z, fromHero: true },
            spell.patchScale,
          );
          const all = victims();
          // The self-cast's own status, at zero damage — `hitsHero` is true
          // because landing it on yourself is the entire point of a self-cast.
          land(all[0]!, spell.primary, 0, spell.status, false, all, new Set(), true, null);
        } else {
          const dx = c.aimX - hero.x;
          const dz = c.aimZ - hero.z;
          const d = Math.hypot(dx, dz) || 1;
          // Range CLAMPS the flight, never rescales it outward — a spell
          // detonates at the point it was aimed at, and a short-ranged one
          // (spore's puff, oil's lob) bursts early on the same line.
          const reach = Math.min(d, spell.range);
          s.projectiles.push({
            id: nextId(),
            x: hero.x + (dx / d) * 0.55,
            z: hero.z + (dz / d) * 0.55,
            // `spell.speed` is an identity, not a stat: Flashfire is THE fast
            // bolt and everything else flies at 1.
            vx: (dx / d) * PROJECTILE_SPEED * spell.speed,
            vz: (dz / d) * PROJECTILE_SPEED * spell.speed,
            targetX: hero.x + (dx / d) * reach,
            targetZ: hero.z + (dz / d) * reach,
            ticksLeft: PROJECTILE_TICKS,
            fromHero: true,
            element: spell.primary,
            damage: spell.damage,
            radius: spell.radius,
            knockback: spell.knockback,
            pierces: spell.pierces,
            hitIds: [],
            status: spell.status,
            patch: spell.patch,
            patchScale: spell.patchScale,
            name: spell.name,
          });
        }
      }

      // With the recovery dialled to ZERO (sandbox feel tests), the buffered
      // follow-up keeps its original same-tick replay — otherwise it would
      // strand in a recovery branch that never runs.
      if (hero.castCd === 0) {
        const next = hero.buffered;
        hero.buffered = null;
        if (next && hero.queue.length > 0 && !heroOut()) {
          commitCast(next.form, next.aimX, next.aimZ);
        }
      }
    }
  } else if (hero.castCd > 0) {
    // Recovery. The buffered follow-up fires the tick it runs out — it used
    // to fire on the launch tick itself ("a chain with no dead air"), and
    // moving it here is the whole point: a chain now breathes at the
    // recovery rate, which is the pacing the third playtest asked for.
    // Discarded if there is nothing queued to cast (or the hero is down).
    hero.castCd--;
    if (hero.castCd === 0) {
      const next = hero.buffered;
      hero.buffered = null;
      if (next && hero.queue.length > 0 && !heroOut()) {
        commitCast(next.form, next.aimX, next.aimZ);
      }
    }
  }

  /* ------------------------------------------------- 4. projectiles */

  for (let i = s.projectiles.length - 1; i >= 0; i--) {
    const p = s.projectiles[i]!;
    p.x += p.vx;
    p.z += p.vz;

    let spent = false;
    // Arrived? Passing the aim point means the velocity now points away from
    // it — a dot-product test, so it cannot be skipped over at any speed.
    const arrived =
      (p.targetX - p.x) * p.vx + (p.targetZ - p.z) * p.vz <= 0;
    const expired = --p.ticksLeft <= 0 || arrived;

    if (expired) {
      // A spell that reaches the end of its flight DETONATES THERE. It does
      // not evaporate.
      //
      // This is not a detail. The first version simply deleted an expired
      // projectile, which meant a cast that hit nobody did nothing at all —
      // and so oiling empty ground was impossible. Preparing the floor before
      // the enemy arrives is the most important tactical move the system has;
      // silently dropping it made the whole ground-field layer unusable
      // except by accident. Found by casting oil at an empty arena and
      // watching the patch count stay at zero.
      detonate(
        p.x,
        p.z,
        p.element,
        p.damage,
        p.status as StatusId | null,
        p.patch as PatchKind | null,
        p.radius,
        p.knockback,
        // Your own blast reaches you now. It used to pass `!p.fromHero`, so a
        // cast could not touch its caster under any circumstance — which made
        // the ground field a thing that happened exclusively to other people.
        true,
        p.hitIds,
        p.fromHero ? s.selfDamage : 1,
        p.fromHero, // an Ashcap's spit must not soften its own pack
        { x: p.x - p.vx, z: p.z - p.vz, fromHero: p.fromHero },
        p.patchScale,
      );
      spent = true;
    }

    if (!spent) {
      // A LIT scenery fire intercepts hero projectiles the way a body does.
      // Without this, forward-fire's fixed 9 m aim point means a water bolt
      // flies THROUGH the burning building and detonates behind it, and
      // dousing only works from one magic distance — the exact shape of
      // frustration the playtest hit. Non-water bolts simply detonate against
      // the flames. (Projectiles still pass through UNLIT huts: making every
      // building block shots changes the village fight's staging, and that is
      // an M2 question, not a corner of this one.)
      // Muzzle grace: the bolt must clear the caster before the flames can
      // catch it. Without this, standing inside a fire's (invisible) catch
      // radius made every cast detonate at your own arm — measured on the
      // funnel pilot, which fought beside the burning hut at stage 1's exit
      // and electrocuted itself for 17.5 a cast.
      if (p.fromHero && dist(p, hero) > 1.2) {
        for (const hf of s.hutFires) {
          // A lit fire catches any bolt — the douse mechanism, unchanged.
          if (!hf.lit) continue;
          if (dist(p, hf) > hf.r + 0.32) continue;
          detonate(
            p.x,
            p.z,
            p.element,
            p.damage,
            p.status as StatusId | null,
            p.patch as PatchKind | null,
            p.radius,
            p.knockback,
            true,
            p.hitIds,
            s.selfDamage,
            true,
            { x: p.x - p.vx, z: p.z - p.vz, fromHero: true },
            p.patchScale,
          );
          spent = true;
          break;
        }
      }
    }

    if (!spent) {
      // A projectile detonates on the first body it can hurt — ON the body,
      // not at the bolt's own point (the melee branch's precedent; landed at
      // the boss sitting's Phase A, red-first, with the gulch recalibrated
      // in the same window). The bolt CATCHES at `body radius + 0.32`, and
      // for a big body that reach exceeds the blast radius: the r-0.95
      // thornback measured edge-hits that REGISTERED and dealt ZERO
      // (fire@(0.2,5.7), boss centre 1.20 m away, blast 1.1 — nothing
      // landed). Every 0.4-radius common hid it for four rounds. The hero's
      // own shots pass through the hero; enemy shots pass through enemies.
      for (const v of victims()) {
        if (p.fromHero && v.kind === "hero") continue;
        if (!p.fromHero && v.kind === "foe") continue;
        if (p.hitIds.includes(v.id)) continue;
        const k = v.kind === "foe" ? foeKind((v.body as RtFoe).kindId).radius : HERO_RADIUS;
        if (dist(p, v.body) > k + 0.32) continue;

        detonate(
          v.body.x,
          v.body.z,
          p.element,
          p.damage,
          p.status as StatusId | null,
          p.patch as PatchKind | null,
          p.radius,
          p.knockback,
          true,
          p.pierces ? p.hitIds : [],
          p.fromHero ? s.selfDamage : 1,
          // A foe's spit bursting on the hero must not soften its own pack —
          // the expiry path already said so and this path had missed it.
          p.fromHero,
          { x: p.x - p.vx, z: p.z - p.vz, fromHero: p.fromHero },
          p.patchScale,
          // The primary victim sits at the blast centre now — shove it along
          // the flight line, as the pre-fix geometry always did.
          { x: p.x - p.vx, z: p.z - p.vz },
        );
        p.hitIds.push(v.id);
        if (!p.pierces) spent = true;
        break;
      }
    }

    // A DARK brazier catches a FIRE bolt (R4) — the relight-from-range
    // mechanism, mirroring the douse interception. AFTER the body pass,
    // deliberately: the first cut ran it before, and the boss fight measured
    // the consequence — a boss camping the bowl it had just doused was
    // UNHITTABLE with fire, every bolt eaten by the dark bowl and the DPS
    // ping-ponged into relights the boss immediately undid. Bodies eat
    // first; a stray bolt still relights, which by then is a favour.
    if (!spent && p.fromHero && p.element === "fire" && dist(p, hero) > 1.2) {
      for (const hf of s.hutFires) {
        if (hf.lit || !hf.keepLit) continue;
        if (dist(p, hf) > hf.r + 0.32) continue;
        detonate(
          p.x,
          p.z,
          p.element,
          p.damage,
          p.status as StatusId | null,
          p.patch as PatchKind | null,
          p.radius,
          p.knockback,
          true,
          p.hitIds,
          s.selfDamage,
          true,
          { x: p.x - p.vx, z: p.z - p.vz, fromHero: true },
          p.patchScale,
        );
        spent = true;
        break;
      }
    }

    if (spent) s.projectiles.splice(i, 1);
  }

  /* ------------------------------------------------------------ 5. foes */

  // The walking trail, for any kind that sheds one (`FoeKind.drip` — the
  // seeper's oil, the sopling's water). Guarded on the CONTENT field, not the
  // archetype: the weeper AI is the gait, the drip is what it sheds. The
  // countdown only runs for dripping kinds, exactly as the old ai-guard
  // short-circuited it, so existing kinds keep their RNG and stream order.
  const foeDrip = (f: RtFoe, k: FoeKind): void => {
    const d = k.drip;
    if (!d || --f.drip > 0) return;
    f.drip = d.ticks;
    const laid = addPatch(s.patches, nextId, d.kind, f.x, f.z, d.r);
    ev.patches.push({ x: laid.x, z: laid.z, r: laid.r, kind: d.kind, ignited: false });
  };

  for (const f of s.foes) {
    if (!f.alive) continue;
    const k = foeKind(f.kindId);
    const speed = (k.speed / TICK_HZ) * speedMultiplier(f.statuses);
    const toHero = dist(f, hero);

    // R2: the flanker's blind-arc reading, shared by the stalk accounting,
    // the commit gate and the steering. Hero→foe direction against the
    // hero's facing: +1 dead ahead, −1 dead behind. Dot products only — the
    // sim has no trig (§4).
    const ux = toHero > 1e-6 ? (f.x - hero.x) / toHero : 1;
    const uz = toHero > 1e-6 ? (f.z - hero.z) / toHero : 0;
    const facingDot = hero.fx * ux + hero.fz * uz;
    const inBlind = facingDot <= FLANK_DOT && toHero <= FLANK_STALK_RANGE;
    // The stalk counter is the readability contract's enforceable half: it
    // accrues only while genuinely stalking, resets the moment the hero
    // faces the foe (turning to look IS the counter-play), and the commit
    // below is gated on it. Inert for every other kind, like `drip`.
    if (k.ai === "flanker") f.flank = inBlind && !heroOut() ? f.flank + 1 : 0;

    if (f.recover > 0) f.recover--;

    /* -------------------------------------- the boss layer (R4, thornback) */
    const kb = k.boss;
    if (kb) {
      // THE SODDEN COAT: self-applied Wet on a cadence, THROUGH the matrix —
      // so a re-wet lands exactly like a water hit, and in particular it
      // EXTINGUISHES a Burning the player just paid for. A lit brazier
      // within dryRadius pauses the cadence; the standing Wet then runs out
      // on its own, and the dried window is where fire finally sticks. The
      // dry-out is the damp_pyres habit cashed in as tactical terrain — no
      // chip, no objective, just a fight that rewards the taught play.
      const dried = s.hutFires.some(
        (hf) => hf.keepLit && hf.lit && dist(f, hf) <= kb.dryRadius,
      );
      if (!dried && --f.rewet <= 0) {
        f.rewet = kb.rewetTicks;
        const impact = applyElement(0, "water", statusIds(f.statuses), "wet");
        for (const r of impact.removes) removeStatus(f.statuses, r);
        let resoaked = false;
        if (impact.applies && addStatus(f.statuses, impact.applies)) {
          ev.statuses.push({ x: f.x, z: f.z, status: impact.applies });
          resoaked = true;
        }
        // THE SOAK BEAT (R4 recut, the anti-kite discriminator): the sodden
        // coat HEALS — `soakRegen × rewetTicks` hp in ONE attributable pulse
        // per cadence, never a per-tick trickle (gfx's co-design for fun's
        // watch-item: "it got soaked again, it healed" must be a moment the
        // HP bar can pulse with, or the regen reads as an invisible heal).
        // Raw single-element chip can no longer out-race the coat; drying it
        // (the bowls) or out-damaging it through the matrix (the wet-read)
        // are the taught answers, and both were taught by s10. Content on
        // one kind — §10's multiplier ban is about the difficulty path, and
        // no dial here scales with anything but this fight's own design.
        const healed = Math.min(kb.soakRegen * kb.rewetTicks, k.maxHp - f.hp);
        if (healed > 0) f.hp += healed;
        if (healed > 0 || resoaked) {
          ev.bossSoaked = { id: f.id, kindId: f.kindId, x: f.x, z: f.z, healed, resoaked };
        }
      }
      // THE PHASE TURN: behaviour changes, never stats (§10). The boss
      // becomes a DOUSER — the exact steering the player learned to
      // intercept one stage ago — and brings wet company that stands inside
      // its own chain radius. One event for the render's silhouette turn.
      if (f.phase === 0 && f.hp <= k.maxHp * kb.phaseAt) {
        f.phase = 1;
        f.douser = true;
        ev.bossPhase = { id: f.id, kindId: f.kindId, phase: 1, x: f.x, z: f.z };
        for (let a = 0; a < kb.addCount; a++) {
          spawnFoe(s, kb.addKind, f.x + (a === 0 ? -2.2 : 2.2), f.z + 1.4, f.markerId);
        }
      }
    }

    // THE LEASH (`CLAUDE.md` §10 — AI and positioning, never a stat).
    //
    // A player could outrun fight 1 north into fight 2 and arrive with five
    // foes. That is not difficulty; it is the absence of encounter design, and
    // it makes every downstream fight's composition a lie.
    //
    // Free spawns own no marker and never leash — the sandbox waves and the
    // debug handle have no home to be sent back to.
    const home = f.markerId >= 0 ? s.markers.find((m) => m.id === f.markerId) : undefined;
    if (home) {
      // A hero clamped inside a ring no bigger than the leash cannot actually
      // flee — which is the only thing the leash exists to answer. Without
      // this, a hero pinned at the edge of a ring whose radius EQUALS
      // LEASH_RADIUS (the village: both 9.0) tripped it on float noise at
      // the clamped boundary, and the whole pack walked home from a player
      // who could not follow. A ring with real room beyond the leash (the
      // debug/test 1000 m arena) keeps the tether — a fight must still not
      // be draggable across a big clearing.
      const fleeable = !s.lock || s.lock.r > LEASH_RADIUS + 0.5;
      if (!fleeable) {
        f.leashed = false;
      } else {
        // How far the PLAYER is from this fight — see LEASH_RADIUS for why it
        // is not how far the foe has strayed. Hysteresis on the band so a hero
        // loitering on the boundary does not make the whole pack flicker.
        const heroFromHome = Math.hypot(hero.x - home.x, hero.z - home.z);
        if (!f.leashed && heroFromHome > LEASH_RADIUS) f.leashed = true;
        else if (f.leashed && heroFromHome < LEASH_RELEASE) f.leashed = false;
      }
    }
    // Walking back, or standing over a body: either way, not attacking.
    const disengaged = f.leashed || heroOut();
    if (disengaged) {
      // Drop a committed wind-up rather than landing it on nothing.
      f.windup = 0;
      const tx = f.leashed && home ? home.x : f.x;
      const tz = f.leashed && home ? home.z : f.z;
      const dx = tx - f.x;
      const dz = tz - f.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.4) {
        integrate(world, f, dx / d, dz / d, speed, speed / 4, 1);
        pushOutOfBlockers(world, f, k.radius);
        faceVelocity(f);
      } else {
        integrate(world, f, 0, 0, speed, speed / 4, 1);
      }
      foeDrip(f, k);
      continue;
    }

    // THE DOUSER'S WALK (R4, damp_pyres). While any lit brazier stands, a
    // douser is not fighting — it carries its wet body at the nearest one,
    // full stride, no standoff ring, no windup, no juke draw (a walker the
    // player must intercept has to hold a READABLE line; and this branch
    // never enters the seek branch below, so no RNG stream order changes for
    // anyone else). The quench itself is the generic wet-body rule at 5d —
    // the douser only supplies the wetness and the walk. With every bowl
    // dark it falls through and is an ordinary foe again.
    // The boss interleaves: bowls only when its slam is READY, the hero the
    // rest of the time. Measured under a red demo before this guard existed:
    // a phase-2 boss spent whole recover windows commuting between bowls, a
    // spore-only pilot ground out a 260 HP kill against a boss that never
    // looked at it, and "the matrix is required" became a retry away from
    // false. A sopling douser has no such recover economy — its walk IS its
    // whole behaviour.
    if (f.douser && f.windup === 0 && !(k.boss && f.recover > 0)) {
      let bowl: RtSceneryFire | null = null;
      let bowlD = Infinity;
      for (const hf of s.hutFires) {
        if (!hf.keepLit || !hf.lit) continue;
        // OF ITS STAGE — the `StageFoe.douser` contract ("walks at the
        // nearest LIT brazier of its stage"), now actually enforced. The
        // unscoped scan sent the P2 boss marching at damp_pyres' pair TWO
        // STAGES back: 30 m away, through the arena clamp, where it stood
        // wedged against the ring at full hp forever while the whole fight
        // deadlocked (measured, the recut probe). A douser with a home
        // hunts its home's bowls; a free-spawned douser (sandbox) keeps the
        // global scan — it has no stage to be scoped to.
        if (home && hf.stage0 !== home.stage) continue;
        const d = dist(f, hf);
        if (d < bowlD) {
          bowlD = d;
          bowl = hf;
        }
      }
      if (bowl) {
        // THE BOSS'S DOUSE SLAM (R4): a sopling douser quenches by contact
        // (its wet body, rule 5d); the boss's body is too big to reach the
        // flame past the bowl's blocker, so its douse is a TELEGRAPHED water
        // slam — committed here, landed by the windup machinery below at the
        // bowl rather than the hero. Same wu, same tint rule (water), same
        // step-out-of-it decision for anyone standing at the bowl.
        if (k.boss && f.recover === 0 && bowlD <= k.range + 0.9) {
          f.windup = k.windupTicks;
          ev.windups.push({
            id: f.id,
            kindId: f.kindId,
            x: f.x,
            z: f.z,
            element: k.attackElement,
            melee: true,
          });
        } else {
          const dx = bowl.x - f.x;
          const dz = bowl.z - f.z;
          const d = Math.hypot(dx, dz) || 1;
          integrate(world, f, dx / d, dz / d, speed, speed / 4, 1);
          pushOutOfBlockers(world, f, k.radius);
          faceVelocity(f);
          foeDrip(f, k);
          continue;
        }
      }
    }

    if (f.windup > 0) {
      // Committed. A telegraphed attack lands whether or not the target is
      // still there — that is what makes stepping out of it a real decision
      // rather than a formality (§10: telegraph windows are a difficulty knob).
      f.windup--;
      integrate(world, f, 0, 0, speed, speed / 4, 1);
      if (f.windup === 0) {
        // The BOWL SLAM outranks the spit (R4): a douser boss that walked to
        // a lit bowl and wound up is slamming THE BOWL — with the boss now
        // on the spitter grammar, checking the spit first would turn every
        // committed douse into a bolt at the hero and the bowls would never
        // go dark again.
        let bowlSlam: RtSceneryFire | null = null;
        if (k.boss && f.douser) {
          let bd = Infinity;
          for (const hf of s.hutFires) {
            if (!hf.keepLit || !hf.lit) continue;
            // Same stage scope as the walk above — one contract, both scans.
            if (home && hf.stage0 !== home.stage) continue;
            const d2 = dist(f, hf);
            if (d2 < bd && d2 <= k.range + 0.9) {
              bd = d2;
              bowlSlam = hf;
            }
          }
        }
        if (bowlSlam) {
          detonate(
            bowlSlam.x,
            bowlSlam.z,
            "water",
            k.damage,
            null,
            null,
            1.4,
            0.5,
            true,
            [],
            1,
            false,
            { x: f.x, z: f.z, fromHero: false },
          );
        } else if (k.ai === "spitter") {
          const dx = hero.x - f.x;
          const dz = hero.z - f.z;
          const d = Math.hypot(dx, dz) || 1;
          s.projectiles.push({
            id: nextId(),
            x: f.x + (dx / d) * 0.5,
            z: f.z + (dz / d) * 0.5,
            vx: (dx / d) * PROJECTILE_SPEED * 0.6,
            vz: (dz / d) * PROJECTILE_SPEED * 0.6,
            targetX: hero.x,
            targetZ: hero.z,
            ticksLeft: PROJECTILE_TICKS,
            fromHero: false,
            element: k.attackElement,
            damage: k.damage,
            radius: 0.9,
            knockback: 0.3,
            pierces: false,
            hitIds: [],
            status: null,
            // The rimecap's ice (R2): a kind may lay its element's ground
            // where the bolt lands — the same projectile field the player's
            // patch-laying mixes use, so the render and the field rules come
            // wholesale. Status stays null: the matrix decides interactions.
            patch: k.attackPatch ?? null,
            patchScale: 1,
            name: k.name,
          });
        } else if (toHero <= k.range + 0.6) {
          // hitsFoes false: a bite aimed at the hero does not chunk packmates.
          detonate(hero.x, hero.z, k.attackElement, k.damage, null, null, 0.9, 0.6, true, [], 1, false, {
            x: f.x,
            z: f.z,
            fromHero: false,
          });
        }
        f.recover = k.recoverTicks;
      }
    } else if (
      f.recover === 0 &&
      toHero <= k.range &&
      speed > 0 &&
      // The flanker's commit gate (R2 readability contract): only from the
      // blind arc, and only after a full sim-enforced stalk phase. A hero
      // who turns to face it resets the count — looking IS the counter-play.
      (k.ai !== "flanker" || (inBlind && f.flank >= (k.flankTicks ?? 0)))
    ) {
      f.windup = k.windupTicks;
      ev.windups.push({
        id: f.id,
        kindId: f.kindId,
        x: f.x,
        z: f.z,
        element: k.attackElement,
        melee: k.ai !== "spitter",
      });
    } else {
      // Seek — toward a STANDOFF RING around the hero, not the hero's centre.
      // Straight-line steering by design; no pathfinding in this game.
      //
      // The first playtest's words were "they try to run into the middle of
      // me all the time". The old branch steered a full-speed unit vector at
      // the hero's centre, and it also ran through the whole recover window,
      // so a foe that had just bitten walked straight through the hero. Now
      // each phase has a ring: closing foes head for a point just inside
      // their own attack range (the windup still triggers at `k.range`, so a
      // charger commits at full tilt before the taper ever binds), recovering
      // foes hold a pace OUTSIDE it, and the spitter's band replaces its old
      // bang-bang flip.
      const dx = hero.x - f.x;
      const dz = hero.z - f.z;
      const d = Math.hypot(dx, dz) || 1;
      const stop =
        f.recover > 0
          ? k.range + FOE_RECOVER_PAD
          : k.ai === "spitter"
            ? k.range * SPITTER_BAND
            : k.range * FOE_STANDOFF;
      // Signed and tapered: +1 well outside the ring, 0 at it, negative
      // inside — a foe the hero walks toward backs off instead of hugging.
      const gap = toHero - stop;
      const radial = Math.max(-1, Math.min(1, gap / FOE_ARRIVE_BAND));

      // THE WEAVE. Without it, aiming is a formality: a foe running dead at
      // you is intercepted by any shot fired in its direction, so "lead your
      // target" is advice with nothing behind it. A lateral bias re-drawn every
      // `jukeTicks` makes the lead a genuine estimate.
      //
      // Drawn from the `combat` stream rather than a sine, because `sin` is not
      // IEEE-exact across platforms and would drift a replay apart. Only
      // committed here — never while winding up, so a telegraph the player has
      // already read still lands where they read it. The draw stays
      // unconditional on this branch: its ORDER in the stream is part of the
      // replay, and making it depend on `radial` would desync one.
      if (--f.jukeLeft <= 0) {
        f.jukeLeft = k.jukeTicks;
        f.juke = k.juke > 0 ? rng.next() * 2 - 1 : 0;
      }
      if (k.ai === "flanker") {
        // THE FLANK ARC (R2). Not a beeline at a behind-point — that walks
        // through the hero's body and turns "circling" into a shoving match
        // with the separation pass. Decomposed instead: hold the standoff
        // ring RADIALLY while walking TANGENTIALLY around it toward the
        // blind arc. The tangent's side is picked by which direction
        // reduces `facingDot` — pure dot products, and it re-picks itself
        // live when the hero turns, which is what makes a facing duel
        // between player and flanker an actual duel.
        const rerr = toHero - stop;
        const rIntent = Math.max(-1, Math.min(1, rerr / FOE_ARRIVE_BAND));
        // Left-hand tangent at the foe's bearing; s flips it to whichever
        // way around the ring moves the foe out of the hero's view.
        const t1x = -uz;
        const t1z = ux;
        const der = hero.fx * t1x + hero.fz * t1z;
        const sgn = der < 0 ? 1 : -1;
        // Hurry the arc while seen; settle to a drift once in the blind arc
        // (the stalk phase reads as a prowl, not a sprint), and keep the
        // juke as a slight wobble along the tangent so the arc is not
        // machine-perfect.
        const tw = inBlind ? FOE_RING_DRIFT : 1;
        const jx = -ux * rIntent + t1x * sgn * tw + t1x * f.juke * k.juke * 0.5;
        const jz = -uz * rIntent + t1z * sgn * tw + t1z * f.juke * k.juke * 0.5;
        const jl = Math.hypot(jx, jz) || 1;
        const cap = speed * Math.max(Math.abs(rIntent), tw, FOE_RING_DRIFT);
        integrate(world, f, jx / jl, jz / jl, cap, speed / 4, 1);
        pushOutOfBlockers(world, f, k.radius);
        faceVelocity(f);
        foeDrip(f, k);
        continue;
      }
      // Perpendicular to the seek direction. Left-hand normal; the sign of
      // `juke` picks the side.
      const px = -dz / d;
      const pz = dx / d;
      const jx = (dx / d) * radial + px * f.juke * k.juke;
      const jz = (dz / d) * radial + pz * f.juke * k.juke;
      const jl = Math.hypot(jx, jz) || 1;

      // Arrival taper through the SPEED CAP, not the intent — `integrate`
      // accumulates any nonzero intent up to maxSpeed, so sub-unit intent
      // does not arrive gently, it just gets there late. The drift floor
      // keeps the juke alive at the ring.
      const cap = speed * Math.max(Math.abs(radial), FOE_RING_DRIFT);
      integrate(world, f, jx / jl, jz / jl, cap, speed / 4, 1);
      pushOutOfBlockers(world, f, k.radius);
      faceVelocity(f);
    }

    foeDrip(f, k);
  }

  /* --------------------------------------------------- 5b. separation */
  // Bodies are not ghosts. Before this pass nothing pushed one foe out of
  // another — any number could co-locate on one point, which is half of the
  // playtest's "they run into the middle of me". Position-based and relaxed
  // over a few ticks, in the `pushOutOfBlockers` idiom; ordered after the foe
  // moves and before the field bills whoever stands where.
  //
  // Two deliberate asymmetries: a winding-up foe is IMMOVABLE (a committed
  // telegraph the player has read must not slide sideways after they read
  // it), and the hero is NEVER displaced — aim is footwork, and a shoved
  // caster is a missed cast the player didn't miss. Foes are pushed off the
  // hero, one-sidedly. Iteration order is array order = spawn order, so the
  // pass is deterministic by construction.
  for (let i = 0; i < s.foes.length; i++) {
    const a = s.foes[i]!;
    if (!a.alive) continue;
    const ra = foeKind(a.kindId).radius;
    let moved = false;
    for (let j = i + 1; j < s.foes.length; j++) {
      const b = s.foes[j]!;
      if (!b.alive) continue;
      const wa = a.windup > 0 ? 0 : 1;
      const wb = b.windup > 0 ? 0 : 1;
      if (wa + wb === 0) continue;
      if (pushApart(a, b, ra + foeKind(b.kindId).radius, wa / (wa + wb), wb / (wa + wb))) {
        moved = true;
      }
    }
    if (!heroOut() && a.windup === 0) {
      if (pushApart(a, hero, ra + HERO_RADIUS, 1, 0)) moved = true;
    }
    // Separation must not have shoved a body into a tree.
    if (moved) pushOutOfBlockers(world, a, ra);
  }

  /* ---------------------------------------------- 5c. the lock holds foes */
  // The other half of the arena lock (2. hero movement). The ring is the
  // fight for EVERYBODY: without this the spitter's band (measured from a
  // hero who may stand at the ring edge), the recover back-off and a
  // knockback could each carry a foe onto the hillside outside the ring,
  // where a hero clamped to it cannot follow (fourth playtest — an ashcap
  // kited up a hill, unreachable). Ordered after every foe mover this tick —
  // seek (5), separation and its blocker fix-up (5b) — and it catches a
  // same-tick shove, because every knockback is written before the foe
  // integrates. Winding foes included: the clamp is radial-inward-only, so
  // it truncates a knockback rather than sliding a read telegraph. Every
  // live foe, marker-owned or not — a free spawn dropped into a locked
  // fight is part of that fight.
  if (s.lock) {
    for (const f of s.foes) {
      if (f.alive) clampToRing(f, s.lock);
    }
  }

  /* -------------------------------- 5d. wet bodies quench the pyres (R4) */
  // The Burning+Wet anti-synergy, walked into the world: a WET FOE standing
  // in a lit brazier's flame puts it out — the douser's whole threat.
  // Positions are settled (after 5b/5c), so the contact is the tick's true
  // geometry. keepLit fires only: a burning hut is a roof, not an open
  // bowl, and a wet foe shoved past one must never douse the village's
  // lesson for free. No spores, ever — same reason as the water-detonation
  // branch. FOES ONLY, deliberately: the first cut also quenched on the
  // HERO's wet body, and the funnel measured a 29-cycle douse–relight loop —
  // a hero damp from the walkers' own trails put the bowl out just WALKING
  // PAST toward the gate, re-lit it because the chip asked, and doused it
  // again on the way out. An accidental, repeating setback is grief, not a
  // lesson; the hero's anti-synergy is their own aimed WATER, which is a
  // decision (the detonation branch above).
  for (const hf of s.hutFires) {
    if (!hf.keepLit || !hf.lit) continue;
    // NON-BOSS wet foes only. The sodden boss brushing a bowl used to
    // quench it passively — every bowl the player lit died, invisibly, the
    // moment the chasing boss drifted past, and the funnel measured a
    // literally unwinnable bowl war (phase never turned, regen never
    // stopped). The boss's douse is its telegraphed SLAM, or nothing —
    // §11: an invisible passive quench reads as a bug, a wound-up slam
    // reads as a boss.
    if (
      s.foes.some(
        (f) =>
          f.alive &&
          !foeKind(f.kindId).boss &&
          hasStatus(f.statuses, "wet") &&
          dist(f, hf) <= hf.r,
      )
    ) {
      hf.lit = false;
      ev.hutDoused.push({ x: hf.x, z: hf.z });
    }
  }

  /* ------------------------------------------------------ 6. bystanders */

  for (const b of s.bystanders) {
    if (b.down > 0) {
      b.down--;
      if (b.down === 0) b.hp = b.maxHp;
      continue;
    }
    // On fire? Run. Not from danger in general — from FIRE, which is both
    // correct behaviour and the funniest possible reaction. It outranks
    // everything else, including following.
    if (hasStatus(b.statuses, "burning")) {
      const dx = b.x - hero.x;
      const dz = b.z - hero.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = MAX_SPEED * 0.8;
      integrate(world, b, dx / d, dz / d, sp, sp / 4, 1);
      pushOutOfBlockers(world, b, HERO_RADIUS);
      faceVelocity(b);
      continue;
    }

    if (b.ai === "captive") {
      // Rescue by proximity — no dialog, no menu (`PEDAGOGY.md`: the party
      // grows by doing, not by choosing from a list). OR by having WALKED
      // PAST (R1): the join disc spans the road surface, the corridor is
      // wider, and a rescue a verge walk can miss takes the douse ask, the
      // SPARK thanks and the pool's question with it. Crossing the captive's
      // road sample in arc order counts as reaching them — the same rule the
      // gates follow, with the same local guard.
      b.crossTicks = roadArcFlipped(world, s, hero.x, hero.z, nearestRoadSample(world, b.x, b.z))
        ? b.crossTicks + 1
        : 0;
      // THE JOIN WAITS FOR CALM (R4, fun's Q5 ruling). Their R3 run: a live
      // pack chased the hero through the rescue radius, the join fired
      // mid-combat, and freed-Sella followed into the fight. The intro was
      // already calm-gated; the join is now too. LEASHED foes do not defer
      // — a pack that gave up and walked home must never hold a rescue
      // hostage — and the crossing counter above keeps counting, so the
      // deferred join fires on the first calm tick even if the hero has
      // moved on.
      const embattled = s.foes.some((f) => f.alive && !f.leashed);
      if (
        !embattled &&
        (Math.hypot(b.x - hero.x, b.z - hero.z) <= ALLY_JOIN_RADIUS ||
          b.crossTicks >= CROSS_PERSIST_TICKS)
      ) {
        b.ai = "following";
        ev.rescued.push({ x: b.x, z: b.z, name: b.name });
      }
      continue; // captives stand their ground until freed
    }

    // THE POST (R4.5, fun's binding ruling; `STORY.md` beat 5). A follower
    // with a `holdStage` walks the road only as far as that stage's entry
    // gate: at or past it she steers to the gate instead of to the hero and
    // stands there. Sella is a Tidecap and Tidecaps stop at the ash line —
    // the ch1 boss's composed exam is never diluted by a companion, her
    // down-state joke never plays inside a boss fight, and a chain hopping
    // through an ally in the drowned arena cannot be misread as the boss's
    // doing.
    //
    // No new geometry: the post is `stages[holdStage - 1]`'s exit, already in
    // sim state and already proven standable by the validator (V5). That
    // validator rule is LOAD-BEARING FOR THIS LINE, not just for authoring —
    // `holdStage - 1` is a safe index only because V5 rejects a hold at or
    // before the stage that frees her (comp's R4.5 note: say it where the sim
    // reads it, so nobody weakens the rule without meeting what it protects).
    //
    // And the ruling and the R4 bug are the same point — her follow AI wedged
    // reproducibly at the fen/ash gate, which is exactly where she is now
    // authored to stop.
    const post =
      b.holdStage >= 0 && s.stageIndex >= b.holdStage ? s.stages[b.holdStage - 1] : undefined;
    // Follow: steer to a point behind the hero, and stop when close enough.
    const gx = post ? post.exitX : hero.x - hero.fx * ALLY_FOLLOW_DISTANCE;
    const gz = post ? post.exitZ : hero.z - hero.fz * ALLY_FOLLOW_DISTANCE;
    const dx = gx - b.x;
    const dz = gz - b.z;
    const d = Math.hypot(dx, dz);
    const sp = ALLY_SPEED;
    // A post is a spot, not a leash slot: she settles ON it rather than at
    // the follow distance, so the gate she is standing at reads as chosen.
    if (d > (post ? 0.25 : 0.8)) integrate(world, b, dx / d, dz / d, sp, ALLY_ACCEL, 1);
    else integrate(world, b, 0, 0, sp, ALLY_ACCEL, 1);
    pushOutOfBlockers(world, b, HERO_RADIUS);
    faceVelocity(b);
  }

  /* ----------------------------------------------------------- 7. field */

  for (const p of stepField(s.patches)) {
    ev.patches.push({ x: p.x, z: p.z, r: p.r, kind: p.kind, ignited: true });
  }

  /** The floor afflicts whatever stands on it — hero included, at full rate. */
  const afflict = (body: RtBody, statuses: ActiveStatus[]): void => {
    const ids = fieldStatusesAt(s.patches, body.x, body.z);
    // TERRAIN WATER. Troughs, puddles and the shallows soak you exactly as a
    // spell-made water patch does. The turn engine did this once per fight, in
    // `encounter.ts`'s `applyTerrainStatuses`, against a rank layout that no
    // longer exists — so without this the village Wet+Lightning teach has no
    // route into the real-time sim at all and the pool fight is just a fight.
    //
    // Asked every tick instead of once, which is both simpler and more honest:
    // a Rotling that walks out of the pool dries off, and one that walks in
    // gets soaked. Deterministic and trig-free — `isWetAt` is a bilinear
    // heightfield sample plus squared-distance circle tests.
    //
    // Terrain water deliberately does NOT conduct as a pool the way a water
    // patch does (`field.ts`'s `elementOnField` reads `s.patches` only). It
    // does not need to: the chain travels body-to-body through `land`, and two
    // foes standing in one trough are well inside `CHAIN_RADIUS`. Making it
    // conduct means threading a second, read-only patch list through
    // `detonate` for a beat that already works.
    if (!ids.includes("wet") && isWetAt(world, body.x, body.z)) ids.push("wet");
    for (const id of ids) {
      // Through the matrix, so standing in water while burning puts you out
      // exactly as a water spell would. One rule, two routes to it.
      const impact = applyElement(0, patchElement(id), statusIds(statuses), id);
      for (const r of impact.removes) removeStatus(statuses, r);
      if (impact.applies && addStatus(statuses, impact.applies)) {
        ev.statuses.push({ x: body.x, z: body.z, status: impact.applies });
      }
    }
  };
  // A downed hero is not standing in anything. The floor stops asking.
  if (!heroOut()) afflict(hero, hero.statuses);
  for (const f of s.foes) if (f.alive) afflict(f, f.statuses);
  for (const b of s.bystanders) if (b.down === 0) afflict(b, b.statuses);

  /* ------------------------------------------- 8. statuses, deaths, tick */

  if (!heroOut()) {
    hero.statusDebt += tickStatuses(hero.statuses);
    if (hero.statusDebt >= 1) {
      const whole = Math.floor(hero.statusDebt);
      hero.statusDebt -= whole;
      hero.hp -= whole;
      ev.heroDamage += whole;
    }
  }

  for (const f of s.foes) {
    if (!f.alive) continue;
    // THE DRY WINDOW OPENS BY PATIENCE (R4 recut): with a lit bowl pausing
    // the cadence, the standing coat simply runs out — the other way the
    // window opens, and it must announce itself the same way the stripped
    // one does. Undried expiry cannot happen in practice (the cadence
    // refreshes faster than Wet runs out) and stays silent if it ever does.
    const fbk = foeKind(f.kindId).boss;
    const coatOn = fbk !== undefined && hasStatus(f.statuses, "wet");
    f.statusDebt += tickStatuses(f.statuses);
    if (coatOn && !hasStatus(f.statuses, "wet")) {
      if (s.hutFires.some((hf) => hf.keepLit && hf.lit && dist(f, hf) <= fbk!.dryRadius)) {
        ev.bossDried = { id: f.id, kindId: f.kindId, x: f.x, z: f.z };
      }
    }
    if (f.statusDebt >= 1) {
      const whole = Math.floor(f.statusDebt);
      f.statusDebt -= whole;
      f.hp -= whole;
    }
    if (f.hp <= 0) {
      f.alive = false;
      s.kills++;
      s.loot += foeKind(f.kindId).loot;
      ev.deaths.push({ x: f.x, z: f.z });
    }
  }

  for (const b of s.bystanders) {
    if (b.down > 0) continue;
    b.statusDebt += tickStatuses(b.statuses);
    if (b.statusDebt >= 1) {
      const whole = Math.floor(b.statusDebt);
      b.statusDebt -= whole;
      b.hp -= whole * BYSTANDER_DAMAGE;
    }
    if (b.hp <= 0) {
      // Knocked down, never killed (§9). They get up, and they are fine.
      b.down = BYSTANDER_DOWN_TICKS;
      b.statuses.length = 0;
      ev.bystanderDown.push({ x: b.x, z: b.z, name: b.name });
    }
  }

  for (let i = s.foes.length - 1; i >= 0; i--) {
    if (!s.foes[i]!.alive) s.foes.splice(i, 1);
  }

  /* --------------------------------------------- 8b. the hard world bound */
  // Terrain and blockers stop a body almost everywhere, but "almost" is not a
  // guarantee — walk due east long enough and the grade cap lets you off the
  // edge of the heightfield, where `heightAt()` extrapolates nonsense. Ported
  // from the exploration sim, which had it and which this replaces.
  //
  // Clamped LAST, after every mover: the hero, foes and bystanders can each
  // end a tick outside it, and `pushOutOfBlockers` can put a body outside it
  // after its mover already ran. Projectiles are deliberately not clamped —
  // they expire on their own and a clamped one would detonate on the boundary
  // instead of in the air.
  const bound = world.obstacles.bound;
  const clampToWorld = (b: RtBody): void => {
    const cx = Math.max(-bound, Math.min(bound, b.x));
    const cz = Math.max(-bound, Math.min(bound, b.z));
    // Zero the clamped axis too. Velocity left pointing into the wall makes
    // `faceVelocity` turn the body to stare off the edge of the world for as
    // long as the player holds the key.
    if (cx !== b.x) {
      b.x = cx;
      b.vx = 0;
    }
    if (cz !== b.z) {
      b.z = cz;
      b.vz = 0;
    }
  };
  clampToWorld(hero);
  for (const f of s.foes) clampToWorld(f);
  for (const b of s.bystanders) clampToWorld(b);

  /* ------------------------------------------ 8b². the corridor soft clamp */
  // The road is the game (§12's free-roam ban, made physical after the second
  // playtest). The treeline (`scenario.ts` plantWalls) is what the player
  // SEES stop them; this is the guarantee behind whatever gap the jitter
  // left, sitting at CORRIDOR_HALF — just past the treeline, so a body that
  // threads two trunks is stopped inside the forest edge, never on open
  // ground (§11: an invisible wall on open ground reads as broken movement).
  //
  // Hero only: foes leash, Sella follows the hero. Yields entirely to the
  // arena lock — a locked brawl may drift wider than the corridor, and two
  // clamps fighting over one body is a stutter. The pull is eased (capped per
  // tick) rather than a snap, for the moment a lock lifts with the hero
  // beyond the corridor. Setup-derived road, no new hashed state; a world
  // with no road (the sandbox arena) has no corridor.
  //
  // THE ROAD IS ONE-WAY (round 6: the player ran from mid-chapter back to
  // the starting lake). Samples before the previous stage's gate stop
  // counting as road, so the same clamp that fences the verges also runs
  // out of corridor ~CORRIDOR_HALF behind the last crossed gate. Arc order
  // is what makes this survive the s3 doubleback: the walk back to SPARK is
  // FORWARD along the polyline even though it is south-west in space. Entry
  // teleports (restart/resume/debug) land exactly ON the boundary sample —
  // legal by construction, no special case.
  if (!s.lock && world.roadPath.length > 0) {
    const from = s.stageIndex > 0 ? (world.gateIndices[s.stageIndex - 1] ?? 0) : 0;
    let bestD2 = Infinity;
    let bx = 0;
    let bz = 0;
    // Nearest sample over the WHOLE path too — when the closest road is
    // behind the boundary, the clamp is answering a backward walk, and the
    // presentation gets to say so (Sella's line rides ev.roadBlocked).
    let anyD2 = Infinity;
    for (let i = 0; i < world.roadPath.length; i++) {
      const p = world.roadPath[i]!;
      const dx = hero.x - p.x;
      const dz = hero.z - p.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < anyD2) anyD2 = d2;
      if (i >= from && d2 < bestD2) {
        bestD2 = d2;
        bx = p.x;
        bz = p.z;
      }
    }
    const d = Math.sqrt(bestD2);
    if (d > CORRIDOR_HALF) {
      const nx = (hero.x - bx) / d;
      const nz = (hero.z - bz) / d;
      const pull = Math.min(d - CORRIDOR_HALF, CORRIDOR_PULL);
      hero.x -= nx * pull;
      hero.z -= nz * pull;
      // Kill only the OUTWARD velocity component: sliding along the boundary
      // is normal movement, the same rule the arena lock follows.
      const out = hero.vx * nx + hero.vz * nz;
      if (out > 0) {
        hero.vx -= nx * out;
        hero.vz -= nz * out;
      }
      if (anyD2 < bestD2 - 1e-9) ev.roadBlocked = true;
    }
  }

  /* --------------------------------------------------- 8c. going down */
  // This used to be `hero.hp = Math.max(0, hero.hp)` and nothing else: you sat
  // at 0 HP being hit forever, so the game had no losing condition and §8's
  // revive — their second-highest-value placement — had nothing to hang on.
  hero.hp = Math.max(0, hero.hp);
  if (!heroOut() && hero.hp <= 0) {
    hero.downTicks = DOWN_TICKS;
    hero.casting = null;
    hero.castTicks = 0;
    hero.queue.length = 0;
    // Statuses go with them. A hero who stood up still Burning would take the
    // fire that killed them into the grace period, which makes the grace a lie.
    hero.statuses.length = 0;
    hero.statusDebt = 0;
    hero.vx = 0;
    hero.vz = 0;
    s.autorun = false;
    ev.heroDown = true;
    ev.queueChanged = true;
  } else if (hero.downTicks > 0) {
    // The OFFER window (§8's five seconds), not a stagger. It runs down whether
    // or not anyone is looking, and the app decides what to put on screen
    // during it — but the countdown itself is sim-side, so it is the same five
    // seconds in a replay, on a phone, and at 165 Hz.
    hero.downTicks--;
    if (hero.downTicks === 0) {
      hero.defeated = true;
      ev.heroDefeated = true;
    }
  }

  s.rng = rng.snapshot();
  s.tick++;
  return ev;
}

/** The element a patch behaves as when it afflicts whatever stands in it. */
function patchElement(status: StatusId): Element {
  switch (status) {
    case "wet":
      return "water";
    case "burning":
      return "fire";
    case "oiled":
      return "oil";
    default:
      return "spore";
  }
}

/**
 * Put a foe in the world.
 *
 * The one construction site — the `spawn` command, the marker trigger, the
 * tests and the debug handle all come through here, so a new field on `RtFoe`
 * cannot be forgotten in one of four copies.
 *
 * `markerId` is ownership: -1 for a free spawn (sandbox waves, the debug
 * handle), otherwise the marker that is waiting for this foe to die.
 */
export function spawnFoe(
  s: RtState,
  kindId: string,
  x: number,
  z: number,
  markerId = -1,
  douser = false,
): void {
  const k = foeKind(kindId);
  s.foes.push({
    id: s.nextId++,
    kindId: k.id,
    markerId,
    x,
    z,
    vx: 0,
    vz: 0,
    fx: 0,
    fz: -1,
    hp: k.maxHp,
    maxHp: k.maxHp,
    statuses: [],
    windup: 0,
    recover: 0,
    // Inert 0 for kinds that shed nothing — the countdown only ever runs
    // behind the `k.drip` guard, but the field is hashed for everyone.
    drip: k.drip?.ticks ?? 0,
    // Inert 0 for every kind but the flanker, same idiom as `drip`.
    flank: 0,
    juke: 0,
    jukeLeft: 0,
    statusDebt: 0,
    alive: true,
    leashed: false,
    douser,
    phase: 0,
    // BORN SODDEN (R4 recut, fun's fairness bar): 1, not `rewetTicks`, for a
    // boss kind — the coat applies on its first standing tick, so the fight
    // opens with the anti-synergy already ON and the first fire cast teaches
    // the extinguish instead of banking a free dry-spawn burn window. Beside
    // an already-lit bowl the cadence is paused and the birth stays dry —
    // the drying rule, from tick one. Inert 0 for everyone else — the `drip`
    // idiom.
    rewet: k.boss ? 1 : 0,
  });
}

/**
 * The one place power is granted: by the `grant` command (the sandbox, the
 * perf harness, the debug handle), by a `take` PRESS at a pickup in range (the
 * campaign — third playtest; walking over a gem has collected nothing since,
 * and this line said otherwise until R6), and by the resume derivation (which
 * passes no events — a reload is not a ceremony). Idempotent — re-granting
 * held power emits nothing, which is what
 * makes every route safe to drive twice.
 */
export function applyGrant(s: RtState, ev: RtEvents | null, kind: Element | "weave" | undefined): void {
  if (kind === "weave") {
    if (s.queueMax < QUEUE_MAX) {
      s.queueMax = QUEUE_MAX;
      if (ev) ev.wove = true;
    }
    return;
  }
  if (kind && !s.unlocked.includes(kind)) {
    s.unlocked.push(kind);
    if (ev) ev.granted.push(kind);
  }
}

/**
 * Metres of contact that put a find's take-prompt in reach. Wider than the
 * road half-width (2.4), so walking the corridor cannot thread past the
 * PROMPT.
 *
 * ⚠️ THIS IS NOT AN UNSKIPPABILITY GUARANTEE, and it said it was until R6.
 * The third playtest made collection a PRESS (`takeRequested`), and from that
 * day the geometry has guaranteed only that the chip is reachable — it says
 * nothing whatever about possession. fun walked the real chain past the weave
 * at (0.2, 59.8) passing **0.16 m** from it with the prompt on screen for
 * 1.17 s, and entered the Dry Gulch at `queueMax: 1`. The sentence that used
 * to stand here was correct for contact-collect and survived its own
 * mechanism's deletion — METHOD law 3, rotting at the instruction while every
 * derivation around it stayed right.
 *
 * What actually guarantees the run stays winnable is `2c`'s pickup conjunct
 * (a gate never closes behind an untaken find), and what tells the player is
 * `leftBehindFind` below.
 */
export const PICKUP_RADIUS = 2.6;

/**
 * The find standing on the road BEHIND the player, and whether the fight in
 * front of them cannot be won without it (R6, fun's ruling on the WEAVE skip).
 *
 * Two consumers, one definition: `2c`'s seam conjunct decides whether the gate
 * may close, and the HUD's objective chip decides whether to name the find.
 * They had drifted into two inline predicates with different answers — the
 * gate held the run open, the chip stayed silent — which is how a player could
 * walk into the Dry Gulch without THE WEAVE, cast bare water at twenty-four
 * rotlings, and never be told why.
 *
 * `blocking` is DERIVED and cannot go stale. `content/stages.ts` documents
 * `reinforce` as the reusable required-mechanic primitive; its only exemption
 * is `composed`; `composed` requires two DISTINCT elements in one cast; and
 * that is unqueueable while `queueMax < QUEUE_MAX`. So `blocking` reads
 * exactly *"this stage has a live fight whose own exemption this hero cannot
 * satisfy, and the find that fixes it is behind them"* — with no stage id, no
 * index and no element named anywhere in it. Any future fight that declares
 * `reinforce` inherits the diagnostic for free.
 *
 * Called from `2c` (the seam may not close while this returns non-null) and
 * from the HUD (which names `pickup` and nags immediately when `blocking`).
 * Pure reads over existing state — it adds no field, writes nothing, and draws
 * no randomness, so it cannot affect the hash.
 */
export function leftBehindFind(
  s: RtState,
): { pickup: RtPickup; blocking: boolean } | null {
  const pickup = s.pickups.find((p) => !p.taken && p.stage < s.stageIndex);
  if (!pickup) return null;
  const cannotCompose = s.queueMax < QUEUE_MAX;
  const requiresMechanic = s.markers.some(
    (m) => m.stage === s.stageIndex && !m.cleared && m.reinforce !== null,
  );
  // The find that fixes an uncomposable fight is THE WEAVE specifically — a
  // left-behind element would be named while the actual blocker stood
  // somewhere else, which is a diagnostic that sends the player the wrong way.
  const weaveLeft = s.pickups.some(
    (p) => !p.taken && p.kind === "weave" && p.stage < s.stageIndex,
  );
  return { pickup, blocking: cannotCompose && requiresMechanic && weaveLeft };
}


/**
 * Put a non-hostile in the world, captive until the hero walks up to them.
 *
 * Ids come from the same `nextId` counter as foes and projectiles because
 * `victims()` relies on ids being unique across all three — the hero is 0.
 */
export function addBystander(
  s: RtState,
  x: number,
  z: number,
  name: string,
  holdStage = -1,
): void {
  s.bystanders.push({
    id: s.nextId++,
    name,
    x,
    z,
    homeX: x,
    homeZ: z,
    holdStage,
    vx: 0,
    vz: 0,
    fx: 0,
    fz: 1,
    hp: BYSTANDER_MAX_HP,
    maxHp: BYSTANDER_MAX_HP,
    statuses: [],
    statusDebt: 0,
    down: 0,
    ai: "captive",
    crossTicks: 0,
  });
}

export type { FieldPatch, RtBystander, RtFoe };
export { ELEMENT_PROFILE };
