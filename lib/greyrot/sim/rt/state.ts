/**
 * Real-time combat state.
 *
 * Plain JSON-serialisable objects only, exactly as `sim/state.ts` requires —
 * no class instances, no functions, no Maps. `hashRt` is this system's
 * determinism oracle, in the same spirit as `hashState` and `hashCombat`.
 *
 * Deliberately kept as its OWN state rather than bolted onto `SimState` for
 * now. The two merge when the turn engine is deleted; until the feel is signed
 * off, `SimState` and its 137 green tests stay untouched.
 *
 * Every duration in here is in TICKS. There is not a single second, and there
 * is not a single wall-clock read — the architecture test enforces both.
 */

import { CASTABLES, QUEUE_MAX, type Element } from "../../content";
import {
  CAST_COOLDOWN_TICKS,
  HERO_MAX_HP,
  HERO_SELF_DAMAGE,
  SELF_FORM_POWER,
} from "../constants";
import { Stream, type StreamSnapshot } from "../rng";
import type { ActiveStatus } from "./damage";
import type { FieldPatch } from "./field";

export interface RtBody {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing as a unit vector — angles are not IEEE-exact across platforms. */
  fx: number;
  fz: number;
}

/** The hero. One caster, all six elements, no class and no resource bar. */
export interface RtHero extends RtBody {
  hp: number;
  maxHp: number;
  statuses: ActiveStatus[];
  /** Elements queued but not yet cast. Length ≤ QUEUE_MAX. */
  queue: Element[];
  /** Ticks left of the current cast's wind-up; 0 when not casting. */
  castTicks: number;
  /** The mix committed at cast time. Snapshotted, so the queue stays editable. */
  casting: { elements: Element[]; form: "aimed" | "self"; aimX: number; aimZ: number } | null;
  /**
   * A cast pressed during a root, applied the tick the root ends. Last press
   * wins; consumed or discarded when the running cast launches, so it needs no
   * timer. The aim payload is kept from press time rather than recomputed:
   * facing is frozen during a root, so they are equal — and recomputing would
   * be a second aim path, which is how aim bugs happen here.
   */
  buffered: { form: "aimed" | "self"; aimX: number; aimZ: number } | null;
  /**
   * Ticks of recovery after a cast LAUNCHES before the next may commit (the
   * third playtest: "I should not be able to spam d-space"). A press during
   * recovery buffers exactly like a press during the root, so mashing paces
   * casts at the recovery rate and loses nothing. Hashed: two states
   * differing only here accept different casts next tick.
   */
  castCd: number;
  /** Accumulated fractional status damage, so a 6-per-turn burn deals 6. */
  statusDebt: number;
  /** Ticks of invulnerability after taking a hit. Prevents chip-death. */
  iframes: number;
  /**
   * Ticks left of the down window; 0 when on their feet.
   *
   * Before this existed `rtStep` ended with `hero.hp = Math.max(0, hero.hp)`
   * and nothing else, so a dead hero sat at 0 HP being hit forever — there was
   * no losing, which also means §8's revive slot (their second-highest-value
   * placement) had nothing to hang on.
   *
   * A downed hero is not a victim: they cannot be hit, chained to, afflicted
   * or burned down further, and they issue no commands. The window is the OFFER
   * window — `CLAUDE.md` §8's 5 seconds — not a stagger.
   */
  downTicks: number;
  /**
   * The down window elapsed and nobody revived them. Terminal until a `revive`
   * or `restartStage` command.
   *
   * Separate from `downTicks === 0` on purpose: zero also means "upright", and
   * a single field would make "alive" and "finally dead" indistinguishable to
   * every reader including the hash.
   */
  defeated: boolean;
}

export interface RtFoe extends RtBody {
  id: number;
  kindId: string;
  /**
   * The marker that spawned this foe, or -1 for a free spawn (sandbox waves,
   * the debug handle).
   *
   * Ownership, not decoration: a marker clears when ITS foes are gone, and a
   * road carries several markers, so two fights can be live at once. -1 rather
   * than null so the hash stays a plain number mix.
   */
  markerId: number;
  hp: number;
  maxHp: number;
  statuses: ActiveStatus[];
  /** Counts down to the blow landing. 0 = not winding up. */
  windup: number;
  /** Counts down before it may act again. */
  recover: number;
  /** Weeper drip timer. */
  drip: number;
  /**
   * Flanker stalk counter (R2): consecutive ticks spent in the hero's facing
   * blind arc within stalk range. The commit gate — a flanker may not begin
   * its windup until this reaches its kind's `flankTicks` — which makes the
   * readability contract's pre-tell sim-enforced rather than hoped, and gives
   * the render layer a legal head start for the eyes-off cue. Always 0 for
   * non-flanker kinds. Behaviour-deciding (it gates a windup), so hashed.
   */
  flank: number;
  /**
   * Lateral wander, in [-1, 1], applied along the perpendicular of the seek
   * direction. Re-drawn from the `combat` RNG stream every `jukeTicks`.
   *
   * A sine wave would be the obvious implementation and is banned here: `sin`
   * is not IEEE-exact across platforms, so a replay would eventually diverge
   * (`sim/state.ts` refuses angles for the same reason). The RNG stream is
   * exact, seeded, and already part of the hash.
   */
  juke: number;
  /** Ticks until `juke` is re-drawn. */
  jukeLeft: number;
  statusDebt: number;
  alive: boolean;
  /**
   * Given up the chase and walking back to the fight it belongs to.
   *
   * State rather than a per-tick distance test because the leash has
   * hysteresis, and hysteresis is memory by definition. Free spawns
   * (`markerId === -1`) never set it — they have no home to return to.
   */
  leashed: boolean;
  /**
   * A DOUSER (R4, damp_pyres): while any lit brazier stands, this foe walks
   * its wet body at the nearest one instead of hunting the hero, and never
   * attacks. Authored per-spawn (`StageFoe.douser`), inert false for every
   * other foe — and flipped ON by the boss's phase-2 turn, whose bowl-walk
   * reuses exactly this steering. Two states differing only here steer the
   * same body at different targets next tick — hashed.
   */
  douser: boolean;
  /**
   * Boss phase (R4, the Sodden Thornback): 0 until the HP threshold, 1
   * after. Gates the douser walk, the adds, and the render's silhouette
   * turn. Inert 0 for every non-boss kind, like `flank`. Two states
   * differing only here run different behaviour next tick — hashed.
   */
  phase: number;
  /**
   * Ticks until the boss re-wets its own coat (the sodden cadence), counted
   * only while no lit brazier stands within its kind's `dryRadius`. Inert 0
   * for non-boss kinds. Two states differing only here apply Wet on
   * different ticks — hashed.
   */
  rewet: number;
}

/**
 * A non-hostile in the field — the friendly-fire target.
 *
 * `CLAUDE.md` §9's 80%-conversion bar is why these take full STATUS and reduced
 * damage, and are knocked down rather than killed. The joke has to land without
 * a stranger losing someone in their first minute.
 */
export interface RtBystander extends RtBody {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  statuses: ActiveStatus[];
  statusDebt: number;
  /** Ticks spent on the floor. Stands back up; never dies. */
  down: number;
  /**
   * `captive` until the hero reaches them, `following` afterwards.
   *
   * Rescue by proximity, with no dialog and no menu — `PEDAGOGY.md`'s rule
   * that the party grows by *doing* rather than by choosing from a list.
   */
  ai: "captive" | "following";
  /**
   * Consecutive ticks the hero has held an arc-order crossing of this
   * captive's road sample (R1). At a hairpin the same spot can mean
   * "approaching" or "walked past" — only persistence tells them apart, so
   * the rescue-by-crossing fires only after the flip HOLDS. Meaningless once
   * `following`. Behaviour-deciding (two states differing only here rescue
   * on different ticks), so it is hashed.
   */
  crossTicks: number;
  /**
   * The stage index this follower will not walk into (−1 = follows anywhere).
   * Compiled at build from the captive's `holdBiome` (R4.5, fun's binding
   * ruling): at or past it she stops FOLLOWING and takes up her post at that
   * stage's entry gate — `stages[holdStage - 1]`'s exit, which the sim
   * already carries and the validator already proves standable.
   *
   * Behaviour-deciding in the strongest sense: two states differing only here
   * steer her to different points on the very next tick. Hashed.
   */
  holdStage: number;
  /**
   * Where this body was PLACED at build — her authored spot on the road.
   *
   * `newRun` makes every captive captive again but used to leave the body
   * wherever the last run ended, so run 2's rescue happened at that spot
   * instead of on her road. Harmless while she trailed the hero; fatal once
   * she has a post to stand at, because the post is at the far end of the
   * chapter and the village's whole arc has no speaker without her. Stored
   * rather than re-derived because `applyResume`'s rule holds here too: the
   * sim has no world to ask, and this point was validated once at build.
   *
   * Hashed: two states differing only here put her in different places the
   * tick a `newRun` command arrives.
   */
  homeX: number;
  homeZ: number;
}

/**
 * A fight standing on the map, waiting to be walked into.
 *
 * Encounters are visible and discrete — no random battles. In the turn-based
 * build this froze the world and opened a separate mode; in real time there is
 * no mode to enter, so a marker is simply **a trigger that spawns its foes**
 * into a simulation that was already running. That is strictly less machinery,
 * and it is why promoting real-time into the campaign shrinks `main.ts` rather
 * than growing it.
 */
export interface RtMarker {
  id: number;
  /** Index into `RtState.stages`. Only the ACTIVE stage's markers can fire. */
  stage: number;
  x: number;
  z: number;
  /** Metres at which walking closer spawns the fight. */
  radius: number;
  /**
   * The arena lock: metres from the centre neither the hero nor its foes may
   * leave while this fight is live.
   *
   * A fight you can simply walk away from is not a fight, it is scenery — and
   * §8's stage-clear seam is worth nothing if a stage can be jogged past. It is
   * a CIRCLE, not a mode: the world keeps running, the sim keeps one clock, and
   * the only thing that changed is that the clearing has edges. Re-introducing
   * a combat state machine here is precisely what Phase 3 deleted.
   */
  arena: number;
  /**
   * Foes to spawn, at offsets from the marker centre. `douser` (R4) marks a
   * brazier-walker; optional so the many hand-built fixtures stay terse —
   * the spawned foe's own `douser` field is required and hashed.
   */
  foes: { kindId: string; dx: number; dz: number; douser?: boolean }[];
  /** Has it fired? */
  triggered: boolean;
  /** Fired, and everything it spawned is dead. Progression — it is hashed. */
  cleared: boolean;
  /**
   * The valve (R5): conditional reinforcement, compiled from the stage
   * declaration. Null for every fight that does not declare it — which is all
   * of them but one.
   */
  reinforce: {
    after: number;
    every: number;
    /** Authored arrival budget, kept so a retry can re-arm from the marker
     * itself rather than reaching back into the content table by index. */
    budget: number;
    kindId: string;
    from: { dx: number; dz: number }[];
  } | null;
  /**
   * The player has cast a MIX in this fight, and is exempt from arrivals for
   * the rest of it.
   *
   * This is a predicate on player ACTION, and that is the whole point. Every
   * earlier version measured a quantity — pack level, then rate of decline —
   * and each was defeated by the spread of the population it had to survive:
   * a level cannot tell a pack not yet swept from one never swept, and a
   * burst threshold puts the modal new player (composing constantly, killing
   * in twos and threes) on the wrong side of it. A gate on TIME fared worse
   * still: the feasibility window between scripted pilots was ~70 ticks, and
   * the spread between a competent human and a competent bot in the SAME lane
   * is ~90. No fixed tick could be human-robust.
   *
   * Composing exempts you at any speed, with any burst size, at any pack
   * level. Refusing to compose exempts you never. Nothing here is a rate, so
   * nothing here has a distribution to be wrong about.
   *
   * Per FIGHT — a retry re-arms it with the marker, so attempt two is never
   * silently different from attempt one. Behaviour-deciding, so hashed.
   */
  composed: boolean;
  /**
   * Ticks this fight has been live. Drives the valve's `after` gate and its
   * cadence, so the arrival schedule is derivable rather than a second timer.
   * Behaviour-deciding — two states differing only here spawn on different
   * ticks — so it is hashed.
   */
  fightTicks: number;
  /**
   * Arrivals still available. Counts down; zero means the valve is spent, and
   * it can never refill. Hashed: two states differing only here reinforce
   * differently on the very next tick.
   */
  reinforceLeft: number;
}

/**
 * A stage: a stretch of road, the fights standing on it, and the point that
 * ends it.
 *
 * `CLAUDE.md` §8's whole economic argument rests on seam DENSITY, and a stage
 * boundary is the seam. It is not a level load and it is not a mode — the world
 * is continuous, the sim never stops, and a stage is simply which fights are
 * currently allowed to wake up plus where you walk to when they are all won.
 * That is what lets §12's free-roam ban and a linear chain coexist honestly.
 */
export interface RtStage {
  id: string;
  /** The gate. Reached with every fight in this stage won, the stage clears. */
  exitX: number;
  exitZ: number;
  exitR: number;
  cleared: boolean;
}

export interface RtProjectile {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /**
   * Where this was aimed. The projectile detonates on ARRIVAL here, not only
   * on hitting a body or expiring — otherwise "oil that patch of ground" is
   * impossible to express and the whole ground-field layer is unreachable
   * except by accidentally hitting someone.
   */
  targetX: number;
  targetZ: number;
  ticksLeft: number;
  /** True when the hero cast it — decides who it can hurt. */
  fromHero: boolean;
  element: Element;
  damage: number;
  radius: number;
  knockback: number;
  pierces: boolean;
  /** Ids already hit, so a piercing shot cannot hit the same body twice. */
  hitIds: number[];
  /** Serialised spell fields needed at impact. */
  status: string | null;
  patch: string | null;
  /**
   * Laid-patch radius/lifetime multiplier (R6a — Deluge). Two states
   * differing only here lay different ground at the same impact — hashed.
   */
  patchScale: number;
  name: string;
}

/**
 * A fire burning on world scenery — today, the village's burning huts.
 *
 * Sim-side because the first playtest CAST WATER AT ONE: the player reached
 * for the game's own centre — water answers fire — and the world ignored them,
 * because the flames were pure presentation. A fire you can see but not affect
 * is a broken promise in a game about elemental cause and effect.
 */
export interface RtSceneryFire {
  id: number;
  x: number;
  z: number;
  /** Metres within which a water detonation puts it out. */
  r: number;
  /** Still burning? Progression-adjacent and behaviour-deciding — hashed. */
  lit: boolean;
  /**
   * The stage whose GATE this fire holds shut while lit (−1 = decorative,
   * never gates). Round 7: dousing the village is the WATER lesson, required
   * the way the fight is — the stage seam waits for both. Behaviour-deciding
   * (the clear predicate reads it), so it is hashed beside `lit`.
   */
  stage: number;
  /**
   * A BRAZIER (R4, damp_pyres): the gate logic inverts — the stage's seam
   * waits until this fire is LIT, not until it is out. Fire relights it, a
   * wet body brushing the bowl quenches it, and a douse of it pays no
   * spores (a bowl you can cycle wet/dry must never be a loot pump). Two
   * states differing only here clear (or refuse) the same seam on the same
   * tick and answer the same fire bolt differently — hashed.
   */
  keepLit: boolean;
  /**
   * The AUTHORED lit state, restored by `newRun` (R4: the boss bowls start
   * DARK — the dry window is earned — while damp_pyres' start alight; a
   * blanket relight would hand the boss room its windows for free on every
   * second run). Two states differing only here diverge at the next
   * `newRun` — hashed.
   */
  lit0: boolean;
  /**
   * The stage this fire was AUTHORED into — which `stage` above stopped
   * recording the moment the −1 never-gates convention arrived. Exists for
   * the retry re-arm (R4 recut, the pinata path): a `restartStage` restores
   * tactical bowls (`stage === -1 && keepLit`) of exactly the retried stage
   * to `lit0`, and "the retried stage" is this field. Two states differing
   * only here re-arm different bowls on the same retry command — hashed.
   */
  stage0: number;
}

/**
 * An element (or THE WEAVE) standing on the road, waiting to be picked up.
 * `taken` decides every future cast the player can make, so it is hashed.
 */
export interface RtPickup {
  id: number;
  /** The stage whose gate this find sits beyond. */
  stage: number;
  kind: Element | "weave";
  x: number;
  z: number;
  taken: boolean;
}

export interface RtState {
  tick: number;
  seed: number;
  hero: RtHero;
  foes: RtFoe[];
  bystanders: RtBystander[];
  projectiles: RtProjectile[];
  patches: FieldPatch[];
  /** Fights standing on the map, waiting to be walked into. */
  markers: RtMarker[];
  /** The authored chain. Only `stages[stageIndex]` is live. */
  stages: RtStage[];
  /** Fires burning on scenery. Water puts them out; `newRun` relights them. */
  hutFires: RtSceneryFire[];
  /**
   * The finds, standing in the world. Power is found, not chosen — and after
   * the second playtest, found LITERALLY: each element (and THE WEAVE) is a
   * physical thing on the road past its stage's gate, collected by walking
   * into it. The stage-clear panel promises it; the road delivers it. Only
   * collectible once its stage is cleared, so a runner who slips past a gate
   * cannot hold power the seam never announced.
   */
  pickups: RtPickup[];
  /**
   * The elements the player has FOUND. Power is found, not chosen
   * (`GAME_DESIGN.md` §3.1, made real by the alpha reset): the campaign
   * starts with SPORE alone — Pim's own nature — and the rest are granted at
   * the road's action places. A `queue` command for an element not in this
   * list is dropped.
   *
   * Both this and `queueMax` decide what the player can do next tick, so both
   * are hashed. The sandbox creates its state with everything unlocked — it is
   * the feel harness, not the curriculum.
   */
  unlocked: Element[];
  /**
   * How many elements one cast may hold. 1 until THE WEAVE is found; 2 after.
   * The design's ceiling is `QUEUE_MAX` (2 for now — a third slot is reserved
   * as a future Act's power spike, deliberately unbuilt).
   */
  queueMax: number;
  /**
   * Which stage is running. Advanced by the `advanceStage` command, never by
   * the sim on its own — the seam between two stages is where the app shows an
   * offer (§8), and a sim that walked straight through it would give the player
   * no seam at all.
   */
  stageIndex: number;
  /**
   * Consecutive ticks the hero has held an arc-order crossing of the CURRENT
   * stage's gate sample (R1). Same persistence rule as the captive's
   * `crossTicks`: a real crossing holds the flip for tens of ticks, the
   * hairpin approach artifact holds it for one, and the disc resolves that
   * one first. Reset on stage advance. Hashed — the seam tick depends on it.
   */
  gateCrossTicks: number;
  /**
   * The active arena lock, or null. Binds the hero and its foes alike. Copied
   * from the marker that triggered it rather than referenced, so the clamps
   * are one comparison and need no lookup.
   */
  lock: { x: number; z: number; r: number } | null;
  /**
   * The opening run-in: the hero moves on their own toward the first fight.
   *
   * `CLAUDE.md` §9 requires the player to arrive already in motion — a hero
   * standing still on an empty road is a title screen with extra steps. It is
   * sim-side, not a camera trick, so it replays and it is testable. It
   * surrenders permanently the instant the player steers for themselves.
   */
  autorun: boolean;
  nextId: number;
  /** Friendly fire on bystanders. Off is a debug convenience, never a default. */
  friendlyFire: boolean;
  /**
   * Fraction of the hero's OWN cast damage that reaches the hero.
   *
   * Seeded from `HERO_SELF_DAMAGE`, which stays the single authored default —
   * this field exists so the sandbox can dial the number at runtime during a
   * feel playtest, exactly as `friendlyFire` above already works for
   * bystanders. It decides future behaviour, so it is hashed.
   */
  selfDamage: number;
  /**
   * Multiplier on the SELF form's nova damage (R2 → R6). fun's baseline
   * found the nova dominant against melee — full aimed damage with no aim
   * requirement and no self-chip — and the converged dial is a self-form
   * damage multiplier < 1, making self the utility/setup form and aimed the
   * damage form. Seeded from `SELF_FORM_POWER` (which stays 1.0 until the R2
   * sandbox sitting prices it provisionally; R6 revalidates inside the full
   * matrix pass and owns the final number). The no-self-chip exception is
   * untouched: this scales what the nova does to OTHERS. Hashed — two states
   * differing only here deal different damage on the next self-cast.
   */
  selfPower: number;
  /**
   * Ticks of post-cast recovery. Seeded from `CAST_COOLDOWN_TICKS` — same
   * pattern as `selfDamage`: the constant stays the authored default, the
   * field exists so the sandbox can dial the pacing live. Hashed: it decides
   * when the next cast may fire.
   */
  castCooldown: number;
  kills: number;
  /**
   * Spores carried. Sim-side and hashed, for the same reason `marker.cleared`
   * is: it is progression, it must survive a replay, and §7 saves decisions
   * rather than derived state.
   */
  loot: number;
  rng: StreamSnapshot;
}

/** What the state starts able to cast. The campaign passes the locked-down set. */
export interface RtStateOptions {
  /** Defaults to all six — tests and the sandbox are feel harnesses, not the curriculum. */
  unlocked?: Element[];
  /** Defaults to QUEUE_MAX (2). The campaign starts at 1, pre-weave. */
  queueMax?: number;
}

export function createRtState(seed: number, opts: RtStateOptions = {}): RtState {
  return {
    tick: 0,
    seed,
    hero: {
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      fx: 0,
      fz: 1,
      hp: HERO_MAX_HP,
      maxHp: HERO_MAX_HP,
      statuses: [],
      queue: [],
      castTicks: 0,
      casting: null,
      buffered: null,
      castCd: 0,
      statusDebt: 0,
      iframes: 0,
      downTicks: 0,
      defeated: false,
    },
    foes: [],
    bystanders: [],
    projectiles: [],
    patches: [],
    markers: [],
    stages: [],
    hutFires: [],
    pickups: [],
    unlocked: opts.unlocked ?? CASTABLES.map((c) => c.element),
    queueMax: opts.queueMax ?? QUEUE_MAX,
    stageIndex: 0,
    gateCrossTicks: 0,
    lock: null,
    autorun: false,
    nextId: 1,
    friendlyFire: true,
    selfDamage: HERO_SELF_DAMAGE,
    selfPower: SELF_FORM_POWER,
    castCooldown: CAST_COOLDOWN_TICKS,
    kills: 0,
    loot: 0,
    rng: new Stream(seed).snapshot(),
  };
}

/* ------------------------------------------------------------------- hash */

const Q = 4096; // ~0.25 mm, far below play scale — same quantum as hashState

/**
 * FNV-1a over the quantised state. Same-seed, same-commands ⇒ same hash.
 *
 * Everything that can affect behaviour goes in. Presentation-only fields do
 * not exist in this state, so there is nothing to leave out.
 *
 * That claim used to be false, which is worse than not making it. The first
 * version skipped `hero.casting` (so a state with a committed three-element
 * mix in flight hashed identically to one with an empty hand), every
 * `statusDebt`, `nextId`, `drip`, and the whole projectile payload — all of
 * them pure future behaviour. Two states could hash equal and diverge on the
 * next tick, which is exactly what the oracle exists to rule out. This is the
 * project's named failure mode: a green check that measures nothing.
 */
export function hashRt(s: RtState): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n | 0;
    h = Math.imul(h, 0x01000193);
  };
  const mixStr = (str: string): void => {
    for (let i = 0; i < str.length; i++) mix(str.charCodeAt(i));
  };
  const mixBody = (b: RtBody): void => {
    mix(Math.round(b.x * Q));
    mix(Math.round(b.z * Q));
    mix(Math.round(b.vx * Q));
    mix(Math.round(b.vz * Q));
    mix(Math.round(b.fx * Q));
    mix(Math.round(b.fz * Q));
  };
  const mixStatuses = (list: readonly ActiveStatus[]): void => {
    for (const st of list) {
      mixStr(st.id);
      mix(st.ticksLeft);
    }
    mix(list.length);
  };

  mix(s.tick);
  mix(s.seed);

  mixBody(s.hero);
  mix(Math.round(s.hero.hp * Q));
  mixStatuses(s.hero.statuses);
  for (const e of s.hero.queue) mixStr(e);
  mix(s.hero.queue.length);
  mix(s.hero.castTicks);
  // Recovery decides whether the NEXT cast command commits or buffers.
  mix(s.hero.castCd);
  mix(s.hero.iframes);
  mix(Math.round(s.hero.statusDebt * Q));
  // Being down decides whether the hero moves, casts, is hit, burns, or is
  // still in the game at all — about as behaviour-deciding as a field gets.
  mix(s.hero.downTicks);
  mix(s.hero.defeated ? 1 : 0);
  // The committed mix. It is not in `queue` any more and it decides what comes
  // out the other end of the wind-up.
  if (s.hero.casting) {
    for (const e of s.hero.casting.elements) mixStr(e);
    mix(s.hero.casting.elements.length);
    mixStr(s.hero.casting.form);
    mix(Math.round(s.hero.casting.aimX * Q));
    mix(Math.round(s.hero.casting.aimZ * Q));
  } else {
    mix(-1);
  }
  // The buffered follow-up cast: it decides whether a spell fires the tick the
  // current root ends — future behaviour by definition.
  if (s.hero.buffered) {
    mixStr(s.hero.buffered.form);
    mix(Math.round(s.hero.buffered.aimX * Q));
    mix(Math.round(s.hero.buffered.aimZ * Q));
  } else {
    mix(-1);
  }

  mix(s.foes.length);
  for (const f of s.foes) {
    mix(f.id);
    mixStr(f.kindId);
    mix(f.markerId);
    mixBody(f);
    mix(Math.round(f.hp * Q));
    mix(f.windup);
    mix(f.recover);
    mix(f.drip);
    // The flanker's stalk counter gates its windup — two states differing
    // only here commit on different ticks.
    mix(f.flank);
    mix(Math.round(f.juke * Q));
    mix(f.jukeLeft);
    mix(Math.round(f.statusDebt * Q));
    mix(f.alive ? 1 : 0);
    // Which way it is walking, and whether it can attack at all.
    mix(f.leashed ? 1 : 0);
    // Whether it hunts the hero or the braziers (R4).
    mix(f.douser ? 1 : 0);
    // The boss layer (R4): which behaviour set runs, and when the coat
    // re-wets.
    mix(f.phase);
    mix(f.rewet);
    mixStatuses(f.statuses);
  }

  mix(s.bystanders.length);
  for (const b of s.bystanders) {
    mix(b.id);
    mixBody(b);
    mix(Math.round(b.hp * Q));
    mix(b.down);
    mix(Math.round(b.statusDebt * Q));
    mix(b.ai === "following" ? 1 : 0);
    // Two states differing only in a crossing counter rescue on different
    // ticks — the definition of behaviour-deciding.
    mix(b.crossTicks);
    // R4.5: which stage she refuses to enter decides where she steers next
    // tick; where she was placed decides where a `newRun` puts her back.
    mix(b.holdStage);
    mix(Math.round(b.homeX * Q));
    mix(Math.round(b.homeZ * Q));
    mixStatuses(b.statuses);
  }

  // Marker state is PROGRESSION, so it belongs in the hash — the same reason
  // `hashState` mixes encounter cleared-ness.
  mix(s.markers.length);
  for (const m of s.markers) {
    mix(m.id);
    mix(m.stage);
    mix(Math.round(m.x * Q));
    mix(Math.round(m.z * Q));
    mix(m.triggered ? 1 : 0);
    mix(m.cleared ? 1 : 0);
    // R5's valve: how long the fight has run and how many arrivals remain both
    // decide whether a body spawns on the next tick.
    mix(m.fightTicks);
    mix(m.reinforceLeft);
    // The latch: two states differing only here feed or do not feed next tick.
    mix(m.composed ? 1 : 0);
  }

  // Stage progression, and the lock, which decides where the hero may stand.
  mix(s.stages.length);
  for (const st of s.stages) {
    mixStr(st.id);
    mix(Math.round(st.exitX * Q));
    mix(Math.round(st.exitZ * Q));
    mix(st.cleared ? 1 : 0);
  }
  mix(s.stageIndex);
  // The gate-crossing persistence counter decides the seam tick.
  mix(s.gateCrossTicks);
  // What can be queued next tick. Two states differing only in an unlock
  // accept different commands, which is the definition of behaviour-deciding.
  for (const e of s.unlocked) mixStr(e);
  mix(s.unlocked.length);
  mix(s.queueMax);
  // A lit fire intercepts projectiles and can pay out a douse; two states
  // differing only in `lit` behave differently on the next water bolt.
  mix(s.hutFires.length);
  for (const hf of s.hutFires) {
    mix(hf.id);
    mix(Math.round(hf.x * Q));
    mix(Math.round(hf.z * Q));
    mix(Math.round(hf.r * Q));
    mix(hf.lit ? 1 : 0);
    // Two states differing only in which stage a fire gates clear (or don't
    // clear) that stage's seam on the same tick.
    mix(hf.stage);
    // Whether the seam wants it burning or out, and whether a fire bolt can
    // relight it (R4).
    mix(hf.keepLit ? 1 : 0);
    // What the next newRun restores it to.
    mix(hf.lit0 ? 1 : 0);
    // Which stage's retry re-arms it (the pinata-path fix) — two states
    // differing only here answer the same restartStage differently.
    mix(hf.stage0);
  }
  // An untaken pickup grants power on contact; two states differing only in
  // `taken` accept different queue commands two ticks later.
  mix(s.pickups.length);
  for (const p of s.pickups) {
    mix(p.id);
    mix(p.stage);
    mixStr(p.kind);
    mix(Math.round(p.x * Q));
    mix(Math.round(p.z * Q));
    mix(p.taken ? 1 : 0);
  }
  if (s.lock) {
    mix(Math.round(s.lock.x * Q));
    mix(Math.round(s.lock.z * Q));
    mix(Math.round(s.lock.r * Q));
  } else {
    mix(-1);
  }
  mix(s.autorun ? 1 : 0);

  mix(s.projectiles.length);
  for (const p of s.projectiles) {
    mix(p.id);
    mix(Math.round(p.x * Q));
    mix(Math.round(p.z * Q));
    mix(Math.round(p.vx * Q));
    mix(Math.round(p.vz * Q));
    // Where it is going decides when it detonates; the payload decides what
    // that detonation does. Both are future behaviour, so both are hashed.
    mix(Math.round(p.targetX * Q));
    mix(Math.round(p.targetZ * Q));
    mix(p.ticksLeft);
    mixStr(p.element);
    mix(Math.round(p.damage * Q));
    mix(Math.round(p.radius * Q));
    mix(Math.round(p.knockback * Q));
    mix(p.pierces ? 1 : 0);
    mix(p.fromHero ? 1 : 0);
    for (const id of p.hitIds) mix(id);
    mix(p.hitIds.length);
    mixStr(p.status ?? "");
    mixStr(p.patch ?? "");
    // What ground the impact will leave (R6a — Deluge).
    mix(Math.round(p.patchScale * Q));
  }

  mix(s.patches.length);
  for (const p of s.patches) {
    mix(p.id);
    mixStr(p.kind);
    mix(Math.round(p.x * Q));
    mix(Math.round(p.z * Q));
    mix(Math.round(p.r * Q));
    mix(p.ticksLeft);
  }

  mix(s.kills);
  mix(s.loot);
  // `nextId` decides every id the rest of the run hands out, and ids decide
  // `struck`-set identity inside a detonation.
  mix(s.nextId);
  mix(s.friendlyFire ? 1 : 0);
  mix(Math.round(s.selfDamage * Q));
  mix(Math.round(s.selfPower * Q));
  mix(s.castCooldown);
  mix(s.rng.state);
  mix(s.rng.drawn);
  return h >>> 0;
}

export function cloneRtState(s: RtState): RtState {
  return JSON.parse(JSON.stringify(s)) as RtState;
}
