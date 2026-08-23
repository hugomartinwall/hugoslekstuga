import { describe, expect, it } from "vitest";
import { STAGES, type Element } from "../../lib/greyrot/content";
import { defaultCampaign, discover, discoveredCount } from "../../lib/greyrot/app/save";
import { hasStatus } from "../../lib/greyrot/sim/rt/damage";
import { createRtState, type RtState } from "../../lib/greyrot/sim/rt/state";
import { PICKUP_RADIUS, rtStep, type RtCommand, type RtEvents } from "../../lib/greyrot/sim/rt/step";
import {
  scenarioHeightfieldOptions,
  setupEncounters,
  setupRoad,
  setupVillage,
} from "../../lib/greyrot/sim/scenario";
import { TICK_HZ } from "../../lib/greyrot/sim/tick";
import { createSimWorld, type SimWorld } from "../../lib/greyrot/sim/world";

/**
 * The opening, measured rather than asserted (`CLAUDE.md` §9) — now as a
 * CURRICULUM: the campaign starts with SPORE alone, the road grants WATER,
 * SPARK, THE WEAVE and FIRE at its gates, and each stage teaches the newest
 * power before the next arrives.
 *
 * ## Three pilots, each refusing to learn exactly one thing
 *
 * The discipline this file exists for: a lesson you can ignore and still win
 * is not a lesson, and a lesson you cannot see taught is not taught. Each
 * claim gets an adversary that refuses precisely the skill under test, so a
 * pass is attributable:
 *
 * - **direct** plays the curriculum properly: it closes on the nearest foe
 *   (facing IS aim), keeps its spacing, and casts what the stage taught.
 * - **singles** is direct's twin, refusing exactly one skill: it plays the
 *   same curriculum with the same movement but never composes — every cast is
 *   the mix's primary element alone. Where IT stalls, mixing was genuinely
 *   required, and nothing else differs to blame.
 * - **masher** turns to face things but casts RANDOM unlocked singles in table
 *   order — it does not know what any element does. What it reaches was
 *   taught by placement.
 * - **neverTurns** casts the smartest single available but never steers toward
 *   a foe — it walks the road and stops when something shows up, firing only
 *   dead ahead. Where IT stalls, turning was genuinely required. The smart
 *   cast matters: give it garbage casts too and its failure would be
 *   attributable to either flaw.
 * - **noDouse** is direct's twin refusing exactly the water lesson: it wins
 *   the village fight and then walks to the gate past the burning huts
 *   without ever casting water at one. Where IT stalls, dousing was genuinely
 *   required (round 7) — and its fight-won beat proves the stall is the
 *   fires' alone.
 * - **skipper** is direct's twin refusing exactly the TAKE press: it fights
 *   every fight and crosses every gate but never collects a find. Born from
 *   fun's R3 find-skip soft-lock — a plain held walk past WATER used to
 *   strand the run permanently two stages later, behind the one-way road.
 *
 * ## The recoverability standard (R4, comp's spec)
 *
 * Every refusal claim above now carries a run-still-live half, proven in the
 * SAME driven run: the moment refusal is established the pilot's beats are
 * snapshotted (`Beats.refusal`) and the pilot CONVERTS to compliance — turns,
 * douses, mixes, walks back for the find, exercises the real defeat seam if
 * it died — and the run must then progress past the refused beat. A lesson
 * must be refusable AND survivable: "cannot clear X" may never mean "the run
 * is silently dead".
 *
 * All pilots drive the seam the way the app does — `advanceStage` when the
 * clear fires, nothing more — because the grants ARE the game now, and they
 * are collected by WALKING: each find stands on the road past its gate.
 * Dousing rides the same scaffolding tier as walking and taking: every pilot
 * except noDouse does the chore, so no OTHER pilot's claim collapses into
 * "it never got out of the village".
 */

const SEED = 1337;
const WATER = -1.2;
/**
 * Long enough for a competent run with room to spare — and for a refusal to
 * be established AND recovered from in the same run; a stall must not hang.
 */
const MAX_TICKS = 420 * TICK_HZ;

interface Beats {
  /** Metres per second on the very first tick, with no input at all. */
  openingSpeed: number;
  /** Seconds to the first cast the sim accepted. */
  firstAgency: number;
  /** Seconds to the first foe killed. */
  firstVictory: number;
  /** Seconds to Sella joining. */
  allyJoined: number;
  /** Seconds to the Wet + Lightning chain firing. */
  chainFired: number;
  /** Seconds to each marker clearing, in marker order. -1 for never. */
  clearedAt: number[];
  /** Seconds to each STAGE clearing — every fight won and the exit reached. */
  stageClearedAt: number[];
  /** Seconds to each grant landing, in the order they were granted. */
  grants: string[];
  /** Seconds to the first ignition inside the seeping run. */
  oilIgnitedAt: number;
  /**
   * Seconds to a lightning combo landing on a FOE inside the Old Well — the
   * sopling teach: the direct pilot casts no water before s6 by construction,
   * and the well terrain is dry, so the wetness the combo needs is
   * attributable to the sopling's own trail alone.
   */
  wellComboAt: number;
  /** Seconds to each douse landing, in order — the water lesson's receipts. */
  dousedAt: number[];
  /**
   * Seconds to the first pyre going DARK inside damp_pyres (R4) — the
   * observed half of the anti-synergy row: a wet body reached a bowl and the
   * flame died, in front of a pilot that knows nothing about it.
   */
  pyreOutAt: number;
  /** Seconds to the first relight landing inside damp_pyres. */
  pyreLitAt: number;
  /** Seconds to the boss's phase turn (R4). */
  bossPhaseAt: number;
  /**
   * Seconds to Burning STICKING on a body other than the hero inside the
   * boss stage — dried-lane evidence: the anti-synergy forbids burning on a
   * wet body, so this landing at all means the coat was off.
   */
  bossBurnedAt: number;
  /** Seconds to Shocked landing off-hero in the boss stage — the conductor lane. */
  bossShockedAt: number;
  /** Seconds to a bowl going dark inside the boss stage — its douse observed. */
  bossDousedAt: number;
  /** Did the hero survive? */
  survived: boolean;
  /**
   * The lowest HP the pilot reached inside the required-mix fight — the
   * refusal half's MARGIN, printed because R5 found it was a coin flip.
   * Shipped world: direct 33, singles 0 (it died, which is the claim). After
   * the R5 scatter change, with the fight geometrically identical: direct 42,
   * singles 5 — the claim inverted without anything about the gulch moving.
   * Moving ONE charger 5 cm swings it ~9 HP, so this number belongs in the
   * beats line where a future seat can see the margin rather than infer it
   * from a pass.
   *
   * DOWNED is printed instead of 0, because 0 is not a margin — it is a death
   * sentinel, and a column where 0 means "died" and 5.1 means "lived with 5.1"
   * is two quantities under one heading that the next reader will average
   * (fun's R5 catch).
   */
  gulchMinHp: number;
  /** Ticks the gulch fight ran — the taught lane's envelope (R5, fun's ask). */
  gulchFightTicks: number;
  /**
   * Pack size ON the tick the valve is permitted to open, or −1 if the fight
   * was already over (R5, fun's regime diagnostic). This is the number that
   * distinguishes two failures needing OPPOSITE fixes: below the threshold
   * means the valve never opened and no cadence or budget can reach it; above
   * means it opened and lost a race, where cadence and budget are exactly the
   * levers. Measured across 82 phase samples, the taught pilot is −1 or 1 here
   * and the refuser is 7–11 — the discriminator is a six-body gap in PACK
   * SIZE, not a margin in time, which is why phase cannot move it.
   */
  gulchPackAtGate: number;
  /**
   * The fight tick at which the pack last reached a NEW low — the earliest
   * moment "this is not shrinking" could be read (R5, fun's pedagogy ask).
   * Compared against the fight's total length it says how much of a losing
   * run is teaching and how much is just losing.
   */
  gulchPackFloorTick: number;
  /** The lowest the pack ever got. */
  gulchPackFloor: number;
  /**
   * The most of this fight's bodies to die on a SINGLE tick (R5). Sets the
   * burst-latch threshold: a sweep is many dying together, a grind is one at a
   * time. Must be measured against the refuser's BEST case, not its typical —
   * a single-element blast can kill several stacked bodies, and if a lucky
   * spore latches the valve the escape hatch reopens in a new costume.
   */
  gulchMaxBurst: number;
  /**
   * Reinforcements this pilot actually received in the gulch (R5). THE
   * acceptance number: fun's bar is zero arrivals for a player who composes,
   * not few — and this measures exposure directly instead of inferring it
   * from a pack level or a gate tick.
   */
  gulchArrivals: number;
  /**
   * The fight tick at which this pilot was first credited as composing, or −1
   * if never (R5). The gate must sit ABOVE the slowest of these across the
   * composing pilots — that is the only thing keeping a composer from meeting
   * an arrival before the exemption reaches them.
   */
  gulchComposedTick: number;
  /**
   * Ticks the refuser spent INSIDE the gulch fight before its refusal was
   * established (R5). The readability window: how long a player who will not
   * compose stands in a fight they cannot win. `gulchFightTicks` cannot answer
   * this — a refuser never CLEARS the fight, it dies in it, so that field is
   * −1 for exactly the pilot the question is about.
   */
  gulchRefusalTicks: number;
  /**
   * The moment refusal was ESTABLISHED — a snapshot taken just before a
   * refusenik pilot converts to compliance (the recoverability standard).
   * `null` for pilots that never refuse anything, and for a refusenik that
   * never reached its refusal (which the premise assertions then catch).
   */
  refusal: {
    at: number;
    stageClearedAt: number[];
    clearedAt: number[];
    dousedCount: number;
    /** Pickups taken by the time of refusal — the skipper's must be 0. */
    takenCount: number;
    unlocked: Element[];
    /** Braziers standing dark at refusal — noRelight's premise (R4). */
    darkPyres: number;
    /** The boss stood alive at refusal — noMatrix's premise (R4). */
    bossAlive: boolean;
    /** The refusal's terminus was the defeat seam (singles at the gulch). */
    downed: boolean;
  } | null;
  /** The real defeat seam was exercised (`restartStage`) during recovery. */
  restarted: boolean;
}

type Pilot =
  | "direct"
  | "singles"
  | "oneElement"
  | "masher"
  | "neverTurns"
  | "noDouse"
  | "skipper"
  | "noRelight"
  | "noMatrix";

function build(): { w: SimWorld; s: RtState } {
  const w = createSimWorld({
    seed: SEED,
    waterLevel: WATER,
    heightfield: scenarioHeightfieldOptions(),
  });
  // The campaign's locked start — SPORE alone, a one-element hand — exactly
  // as main.ts creates it. The curriculum is what is under test.
  const s = createRtState(SEED, { unlocked: ["spore"], queueMax: 1 });
  // Same order main.ts uses, and the order is load-bearing.
  setupEncounters(w, s);
  setupVillage(w, s);
  setupRoad(w, s);
  s.autorun = true;
  return { w, s };
}

/** Unit step toward a point, or null when already there. */
function toward(
  from: { x: number; z: number },
  to: { x: number; z: number },
  stop = 0.4,
): RtCommand | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d <= stop) return null;
  return { type: "move", dx: dx / d, dz: dz / d };
}

/**
 * Where the route says to go next: the captive, then the next fight, then the
 * way out. Only the ACTIVE stage's fights are reachable.
 */
function routeGoal(s: RtState): { x: number; z: number } | null {
  const next = s.markers.find((m) => !m.cleared && m.stage === s.stageIndex);
  const sella = s.bystanders.find((b) => b.ai === "captive");
  // Sella stands on the walk to the village fight; the road detours via her,
  // so no pilot has to know she is worth collecting. Keyed by stage, not by
  // flat marker id — the id key broke when a stage was inserted ahead of her.
  if (sella && next && next.stage >= VILLAGE_STAGE) return { x: sella.x, z: sella.z };
  if (next) return { x: next.x, z: next.z };
  const stage = s.stages[s.stageIndex];
  return stage && !stage.cleared ? { x: stage.exitX, z: stage.exitZ } : null;
}

/**
 * The direct pilot's cast, per stage — the curriculum, played as taught:
 * SPORE until the pool demonstrates the chain, the new SPARK from there,
 * Conduction once the weave is found and the gulch demands it, FIRE through
 * the burnable back half. The sim drops anything not yet granted, so a script
 * error here shows up as a silent stall, not a cheat.
 */
const DIRECT_CASTS: Element[][] = [
  ["spore"], // s1 the corridor
  ["spore"], // s2 the mossy bend
  ["spore"], // s3 the village — water's beat is the douse, not damage
  ["lightning"], // s4 the pool — the chain, one stage after Sella shares it
  ["lightning"], // s5 the old well
  ["water", "lightning"], // s6 the gulch — Conduction, REQUIRED
  ["water", "lightning"], // s7 the ashen rise
  ["fire"], // s8 the seeping run — the first ignition
  ["fire"], // s9 the char hollow
  ["lightning"], // damp_pyres — spark the WET walkers (s5's lesson); FIRE is the relight chore
  ["water", "lightning"], // s10 the camp gate
  ["fire"], // sodden_hollow — the boss: lit bowls keep it dry, and dry it BURNS
];

/** The village's stage index — where facing is REQUIRED and neverTurns stalls. */
const VILLAGE_STAGE = STAGES.findIndex((st) => st.id === "s3");
/** The gulch — where mixing is REQUIRED and singles dies. */
const GULCH_STAGE = STAGES.findIndex((st) => st.id === "s6");
/**
 * THE ARRIVAL-PHASE SHAKE (R5, fun's refusal-test law).
 *
 * Every "the pilot cannot clear X" row must publish its margin AND its
 * sensitivity, and the sensitivity that matters is not spawn geometry — the
 * R5 bisect showed geometry innocent (3 cm of entry position, a thousandth of
 * a facing) while ARRIVAL PHASE moved the verdict: thirteen ticks of extra
 * simulation re-weave twelve jukes off the combat stream.
 *
 * Driven by `PHASE=n npm test`. The hold must land while a fight is LIVE:
 * the stream only advances when foes draw, so holding between fights consumes
 * nothing and shifts nothing (measured — `gulchMargin` came back bit-identical
 * across n, which is what an inert instrument looks like from the outside).
 *
 * Measured across n = 0/13/27/40: five of six refusenik rows hold their
 * verdict and only their timing moves; the BOSS row — whose discriminator is a
 * flat trendline rather than a race — is immune, which is the positive control
 * that proves this instrument distinguishes rather than merely passes. The
 * gulch row is the one that flips, in both directions.
 */
const PHASE_TICKS = Number(process.env.PHASE ?? 0);
/** The seeping run — where the Seepers' oil burns. */
const SEEP_STAGE = STAGES.findIndex((st) => st.id === "s8");
/** The old well — where the sopling carries the conductor (round 5, item 3). */
const WELL_STAGE = STAGES.findIndex((st) => st.id === "s5");
/** The damp pyres — where the anti-synergy is the objective (R4). */
const PYRE_STAGE = STAGES.findIndex((st) => st.id === "damp_pyres");
/** The boss — the taught lessons recombined against the player (R4). */
const BOSS_STAGE = STAGES.findIndex((st) => st.id === "sodden_hollow");

function playOpening(pilot: Pilot): Beats {
  const { w, s } = build();
  const beats: Beats = {
    openingSpeed: 0,
    firstAgency: -1,
    firstVictory: -1,
    allyJoined: -1,
    chainFired: -1,
    clearedAt: s.markers.map(() => -1),
    stageClearedAt: s.stages.map(() => -1),
    grants: [],
    oilIgnitedAt: -1,
    wellComboAt: -1,
    dousedAt: [],
    pyreOutAt: -1,
    pyreLitAt: -1,
    bossPhaseAt: -1,
    bossBurnedAt: -1,
    bossShockedAt: -1,
    bossDousedAt: -1,
    survived: true,
    gulchMinHp: 999,
    gulchFightTicks: -1,
    gulchPackAtGate: -1,
    gulchPackFloorTick: -1,
    gulchPackFloor: 99,
    gulchMaxBurst: 0,
    gulchArrivals: 0,
    gulchComposedTick: -1,
    gulchRefusalTicks: -1,
    refusal: null,
    restarted: false,
  };

  const isRefusenik =
    pilot === "singles" ||
    pilot === "oneElement" ||
    pilot === "neverTurns" ||
    pilot === "noDouse" ||
    pilot === "skipper" ||
    pilot === "noRelight" ||
    pilot === "noMatrix";
  /** Marker ids for the refusal predicates, resolved against the built world. */
  const villageMarkerId = s.markers.find((m) => m.stage === VILLAGE_STAGE)?.id ?? -1;
  const bendMarkerId = s.markers.find((m) => m.stage === 1)?.id ?? -1;
  const pyreMarkerId = s.markers.find((m) => m.stage === PYRE_STAGE)?.id ?? -1;
  const bossMarkerId = s.markers.find((m) => m.stage === BOSS_STAGE)?.id ?? -1;
  let villageTriggeredAt = -1;
  let bendClearedAt = -1;
  let pyreFightClearedAt = -1;
  let bossTriggeredAt = -1;
  let restarts = 0;
  let pendingRestart: { x: number; z: number } | null = null;

  let mash = 0;
  let castCooldown = 0;
  /** Seam driving, exactly as the app's "Onward" does it. */
  let pendingAdvance: number | null = null;

  /** Shift every downstream fight's arrival phase; see PHASE_TICKS. */
  let phaseDone = false;
  /** Pack size on the previous tick, for the burst measurement. */
  let prevPack = -1;
  for (let t = 0; t < MAX_TICKS; t++) {
    const cmds: RtCommand[] = [];
    const secs = t / TICK_HZ;
    // The stream only advances when FOES draw (juke redraws), so the hold
    // must happen while a fight is live or it consumes nothing — measured:
    // holding between fights left gulchMargin bit-identical across N.
    if (!phaseDone && PHASE_TICKS > 0 && s.foes.some((f) => f.alive)) {
      phaseDone = true;
      for (let k = 0; k < PHASE_TICKS; k++) rtStep(w, s, []);
    }
    /**
     * What the pilot is BEING right now: itself until refusal is established,
     * then a compliant player. Every refusing branch below keys on `mode`,
     * so the conversion flips all of them at once.
     */
    const mode: Pilot | "comply" = beats.refusal ? "comply" : pilot;

    if (pendingAdvance !== null) {
      cmds.push({ type: "advanceStage" });
      // No grant command: the app stopped pushing one too. The find stands on
      // the road past the gate and is TAKEN with a press — which means every
      // grant a pilot holds was walked to and taken, and the grant order the
      // beats record proves the road delivers the curriculum.
      pendingAdvance = null;
    }
    if (pendingRestart) {
      // The real defeat seam, exactly as main.ts's "Try again" issues it.
      cmds.push({ type: "restartStage", ...pendingRestart });
      pendingRestart = null;
    }

    // Every pilot presses take when standing at an eligible find — taking is
    // not the skill under test for any of the OTHER refuseniks, the same way
    // walking is not. The skipper is the pilot that refuses THIS: it holds
    // SPORE alone, and what its refusal strands is what the R4 fix repairs.
    if (
      mode !== "skipper" &&
      s.pickups.some(
        (p) =>
          !p.taken &&
          s.stages[p.stage]?.cleared &&
          Math.hypot(s.hero.x - p.x, s.hero.z - p.z) <= PICKUP_RADIUS,
      )
    ) {
      cmds.push({ type: "take" });
    }

    // THE FIRE CHORES. Douse (round 7): once this stage's fight is won, a
    // lit hut fire holds the gate shut, so the pilot walks to it and casts
    // WATER. Relight (R4): a DARK brazier holds it shut the same way, and
    // the answer is FIRE. Scaffolding like walking and taking — every pilot
    // does both except the one whose whole job is refusing that exact chore.
    const choreReady =
      !s.autorun &&
      s.foes.length === 0 &&
      s.markers.every((m) => m.stage !== s.stageIndex || m.cleared);
    const douseTarget =
      // `oneElement` refuses the CHORES too, and that is the whole point of it
      // (R5): every other pilot is handed water for a douse and fire for a
      // relight regardless of its own element policy, so a "one key" pilot was
      // silently being given three more. A pilot that presses one key presses
      // one key everywhere.
      mode !== "noDouse" && mode !== "oneElement" && choreReady
        ? (s.hutFires.find((hf) => hf.lit && !hf.keepLit && hf.stage === s.stageIndex) ?? null)
        : null;
    const relightTarget =
      mode !== "noRelight" && mode !== "oneElement" && choreReady
        ? (s.hutFires.find((hf) => !hf.lit && hf.keepLit && hf.stage === s.stageIndex) ?? null)
        : null;
    const choreTarget = douseTarget ?? relightTarget;

    // Boss-stage shared intent (R4), read by movement AND casting:
    // THE MID-FIGHT RELIGHT — the damp_pyres habit carried into the boss
    // room. The bowls start DARK (the dry window is earned); while every
    // bowl near the fight is dark, a compliant pilot walks its facing onto
    // the nearest one and casts FIRE — the bolt lighting the bowl IS the
    // play. The refuseniks refuse exactly this along with the rest.
    const bossFoe =
      s.stageIndex === BOSS_STAGE
        ? s.foes.find((f) => f.kindId === "thornback" && f.alive)
        : undefined;
    let bossRelightGoal: { x: number; z: number } | null = null;
    if (bossFoe && mode !== "noMatrix" && mode !== "noRelight") {
      // The bowls of THIS arena — the damp_pyres pair stands lit two stages
      // back and must not satisfy "a bowl is lit" from 30 m away (the
      // boss's own dryRadius asks the same nearby question).
      const bowls = s.hutFires.filter(
        (hf) => hf.keepLit && Math.hypot(hf.x - s.hero.x, hf.z - s.hero.z) <= 14,
      );
      if (bowls.length > 0 && bowls.every((hf) => !hf.lit)) {
        bossRelightGoal = bowls.reduce<(typeof bowls)[number] | null>(
          (a, b) =>
            a === null ||
            Math.hypot(b.x - s.hero.x, b.z - s.hero.z) <
              Math.hypot(a.x - s.hero.x, a.z - s.hero.z)
              ? b
              : a,
          null,
        );
      }
    }
    // DEFEND THE FLAME (the recut's positioning lesson, measured before
    // modelled): a lit bowl only dries the boss within `dryRadius` 11, and a
    // spitter boss holding its band off a ROAMING hero can park 13+ m from
    // any lit bowl inside the 10 m ring — a permanent wet sanctuary where
    // the coat drank 63 hp a beat back forever (the probe's 120↔300 yo-yo).
    // The counter-play the geometry teaches: STAND at the bowl you lit. The
    // band couples the boss to the hero, so a hero anchored at the flame
    // drags the boss inside the drying radius — the fight happens AT the
    // bowl, which is also exactly where phase 2's douse walk arrives.
    let bossAnchor: { x: number; z: number } | null = null;
    if (bossFoe && mode !== "noMatrix" && !bossRelightGoal) {
      const litNear = s.hutFires.filter(
        (hf) =>
          hf.keepLit &&
          hf.lit &&
          hf.stage === -1 &&
          Math.hypot(hf.x - s.hero.x, hf.z - s.hero.z) <= 14,
      );
      const bowl = litNear.reduce<(typeof litNear)[number] | null>(
        (a, b) =>
          a === null ||
          Math.hypot(b.x - s.hero.x, b.z - s.hero.z) <
            Math.hypot(a.x - s.hero.x, a.z - s.hero.z)
            ? b
            : a,
        null,
      );
      if (bowl) {
        // Stand BOWL-SIDE-TOWARD-THE-BOSS, flame at your back: a lit bowl
        // intercepts your own bolts (the douse rule's honest physics — a
        // real player reads the burst on the flames and steps around), so
        // the anchor is a point 2.4 m from the bowl along the bowl→boss
        // line, recomputed live as the boss orbits. The band still couples
        // the boss to the hero, so the boss stays inside the drying radius.
        const bx = bossFoe.x - bowl.x;
        const bz = bossFoe.z - bowl.z;
        const bd = Math.hypot(bx, bz) || 1;
        bossAnchor = { x: bowl.x + (bx / bd) * 2.4, z: bowl.z + (bz / bd) * 2.4 };
      }
    }

    /* ----------------------------------------------------------- movement */
    // No pilot steers while the run-in is driving — that keeps "first agency"
    // honest; the moment anyone steers, `autorun` surrenders for good.
    const steppingOut = false;
    if (!s.autorun) {
      const nearest = s.foes.reduce<(typeof s.foes)[number] | null>(
        (a, b) =>
          a === null ||
          Math.hypot(b.x - s.hero.x, b.z - s.hero.z) < Math.hypot(a.x - s.hero.x, a.z - s.hero.z)
            ? b
            : a,
        null,
      );
      // THE RECOVERY WALK-BACK: a compliant player answers the refusal chip
      // by returning for the find left standing — the goal is the gem, the
      // PRESS still comes only from the standing take block above (the fix
      // must never auto-grant; an assertion below pins that).
      const missedFind =
        mode === "comply"
          ? (s.pickups.find((p) => !p.taken && s.stages[p.stage]?.cleared) ?? null)
          : null;
      // THE neverTurns DIFFERENCE, and it is only about FACING: it walks the
      // road when the road is clear and STOPS when something shows up — the
      // least a startled player does — firing wherever it already pointed.
      // The others close on the nearest foe, which turns them to face it —
      // and KEEP nudging toward it at a tight stop, because foes hold a
      // standoff ring and strafe: facing follows input only (§10.6), so
      // tracking a circling target is footwork, and a pilot parked at 3.8 m
      // fired at where the foe used to be until the foe wore it down.
      // THE KITE (noMatrix at the boss — fun's live refuser, modelled
      // honestly): back straight out when the boss closes, hold the band
      // and face-and-cast otherwise. If even THIS raw play fails, the
      // matrix was required; a weaker scripted refuser proved nothing
      // (fun's catch — the named failure mode pointed at the funnel).
      // ⚠️ PILOT-MODEL CHECKPOINT (the boss sitting owns what replaces
      // this): the boundary window built and measured kite/step-out/rhythm
      // layers for the boss fight and backed them out unconverged with the
      // boss retune itself — the full probe record is in the R4 boundary
      // report. What stands is the R4-close model comp audited green.
      {
      const goal =
        mode === "neverTurns"
          ? s.foes.length > 0
            ? null
            : (choreTarget ?? routeGoal(s))
          : (bossRelightGoal ?? bossAnchor ?? nearest ?? missedFind ?? choreTarget ?? routeGoal(s));
      // 1.0, not 1.6: a melee foe's standoff ring sits just inside its own
      // 1.25-1.4 m range, so at 1.6 the survivors of a pack settled INSIDE
      // the stop and the pilot froze — no move command, facing never
      // updated, and it fired its stale bearing for ten seconds while being
      // eaten from behind. The nudge must stay live at the ring, which is
      // the comment above's whole intent.
      // 5.0 against the boss (re-measured against the recut, same verdict
      // the boundary probe reached): at a 2.6 stop the pilot's own spark
      // CHAINED BACK through its trail-soaked body (the pool's
      // chain-to-wet-hero rule, ×1.5 on the wet caster) while every lob
      // landed point-blank — hp 100→0 across P1+P2 with the boss at SIX hp.
      // 5.0 clears the 4.5 chain radius and the blast both. Everything else
      // keeps the tight 1.0 nudge.
      const bossFight = nearest?.kindId === "thornback";
      if (mode === "noMatrix" && bossFight && nearest) {
        // THE KITE (fun's live refuser, modelled at full capability — the
        // standing rule: a funnel refuser at least as capable as a real
        // player, and this one is a shade MORE capable, which only
        // strengthens the refusal half: its casts aim at the boss's LIVE
        // body while it back-pedals, where a real player must face to
        // fire). It holds the spore band — spore²'s own 5.4 m range cap
        // forces it inside the 6.5 m artillery envelope, which is the
        // fight's geometry doing the pricing — backs straight out when the
        // boss closes, and strafes the arena ring when the wall is at its
        // back instead of cornering itself.
        const kdx = s.hero.x - nearest.x;
        const kdz = s.hero.z - nearest.z;
        const kd = Math.hypot(kdx, kdz) || 1;
        if (kd < 4.6) {
          let mx = kdx / kd;
          let mz = kdz / kd;
          const L = s.lock;
          if (L) {
            const lx = s.hero.x - L.x;
            const lz = s.hero.z - L.z;
            const ld = Math.hypot(lx, lz);
            if (ld > L.r - 1.5 && ld > 0) {
              const tx = -lz / ld;
              const tz = lx / ld;
              const sgn = tx * mx + tz * mz >= 0 ? 1 : -1;
              mx = sgn * tx;
              mz = sgn * tz;
            }
          }
          cmds.push({ type: "move", dx: mx, dz: mz });
        } else if (kd > 5.2) {
          cmds.push({ type: "move", dx: -kdx / kd, dz: -kdz / kd });
        }
      } else {
        const stop =
          mode === "neverTurns"
            ? 0.4
            : goal === bossAnchor
              ? 0.6
              : goal === nearest && nearest
                ? (bossFight ? 5.0 : 1.0)
                : 2.2;
        const move = goal ? toward(s.hero, goal, stop) : null;
        if (move) cmds.push(move);
      }
      }
    }

    /* ------------------------------------------------------------ casting */
    if (castCooldown > 0) castCooldown--;
    if (
      s.foes.length > 0 &&
      !steppingOut &&
      castCooldown === 0 &&
      s.hero.castTicks === 0 &&
      !s.hero.casting
    ) {
      let mix: Element[];
      if (pilot === "masher") {
        // Random unlocked singles in table order. It does not know what any
        // element does and it NEVER mixes — where it stalls, mixing was
        // genuinely required.
        mix = [s.unlocked[mash % s.unlocked.length]!];
        mash++;
      } else if (mode === "oneElement") {
        // THE ROW'S TRUE REFUSENIK (R5, fun's live find). Every other pilot
        // that looked like a refuser casts DIFFERENT elements one at a time,
        // which fires cross-element combos — so under the matrix-credit rule
        // they are composers who happen to be slow, and the row's evidence was
        // gathered on them for its whole existence. This one presses ONE key:
        // never a mix, never a combo, never the matrix. It is the only pilot
        // that actually refuses what the gulch claims to require.
        mix = ["spore"];
      } else if (mode === "singles") {
        // Direct's script with every pair flattened to its primary — the same
        // curriculum, minus exactly the one skill under test.
        const script = DIRECT_CASTS[Math.min(s.stageIndex, DIRECT_CASTS.length - 1)]!;
        mix = [script[script.length - 1]!];
      } else if (mode === "noMatrix") {
        // The boss-row refusenik, upgraded to fun's live standard: it plays
        // the whole curriculum honestly (direct's script to the letter),
        // then refuses the matrix at the boss with the strongest raw play a
        // real player found — SPORE-DOUBLE, kiting (the movement section
        // gives it the kite, and its casts aim at the boss's live body).
        // Where THIS stalls, the recombination was genuinely required. (The
        // red demo hands it direct's FULL behaviour including the wet-read
        // — fire alone is NOT the tool: measured, a fire-only pilot dies to
        // the sodden coat exactly like a spore one.)
        mix =
          s.stageIndex >= BOSS_STAGE
            ? ["spore", "spore"]
            : DIRECT_CASTS[Math.min(s.stageIndex, DIRECT_CASTS.length - 1)]!;
      } else if (mode === "neverTurns") {
        // The smartest single it holds, so a failure is about facing alone.
        // Lightning once found, else SPORE — the hardest-hitting opener.
        // (NOT "last unlocked": after the WATER find that picked water, whose
        // damage is a soak, and the pilot died at the fight-only bend for
        // want of a weapon rather than for refusing to turn.)
        mix = [s.unlocked.includes("lightning") ? "lightning" : "spore"];
      } else {
        mix = DIRECT_CASTS[Math.min(s.stageIndex, DIRECT_CASTS.length - 1)]!;
        // THE RECOMBINATION READ (R4): at the boss the curriculum pilot
        // reads the coat the way a player reads the wet glow (taught since
        // the pool) — FIRE into a dry boss, SPARK into a wet one and its wet
        // court. The probe measured why this is the lesson and not a
        // nicety: in phase 2 the adds' own trails keep the boss sodden,
        // fire collapses to a third of its dry rate, and a pilot that keeps
        // pressing the same button dies with the boss at 19 hp. While the
        // relight walk is on (bowls dark — they START dark now, the window
        // is earned), the cast is FIRE regardless: the bolt lighting the
        // bowl IS the play.
        if (s.stageIndex === BOSS_STAGE) {
          const boss = s.foes.find((f) => f.kindId === "thornback");
          // The DOUBLE, not the single (the recut): the weave has been in
          // hand since s6 and the coat now out-drinks single-bolt spark —
          // the curriculum player's wet-read at the boss is l², 51 a cast
          // through the ×1.5 conductor, the exact execute the road taught.
          // EXCEPT while the hero is itself Wet: the causeway walk in soaks
          // you, and the pool taught this precise lesson on the player's own
          // body at 22.4 s — a spark into a wet body chains to every wet
          // body near it, yours included. Measured before modelled: the
          // unguarded pilot killed the boss and ITSELF with the same six
          // casts (17.8 a chain-back, both dead at 81.5 s — the whole fight
          // fit inside the crossing's 4.5 s wet tail). A distance guard
          // races the bolt's flight against a closing boss and loses, so
          // the model is the lesson at full strength: NEVER spark while
          // soaked. Soaked → the fire lane (strip, burn); dry → the spark
          // lane. The floor picks your answer — §10.2, working.
          const sparkSafe = !hasStatus(s.hero.statuses, "wet");
          if (bossRelightGoal) mix = ["fire"];
          else if (boss && hasStatus(boss.statuses, "wet") && sparkSafe) {
            mix = ["lightning", "lightning"];
          }
        }
      }
      for (const e of mix) cmds.push({ type: "queue", element: e });
      // Facing-projected, like a real forward-fire player. The kiting
      // refuser is the one exception: it aims at the boss's live body while
      // back-pedalling (see the kite comment) — over-capability that only
      // strengthens the refusal half.
      let aimX = s.hero.x + s.hero.fx * 9;
      let aimZ = s.hero.z + s.hero.fz * 9;
      if (mode === "noMatrix" && bossFoe) {
        aimX = bossFoe.x;
        aimZ = bossFoe.z;
      } else if (bossRelightGoal) {
        // The mid-fight relight aims AT the bowl — the chore-cast precedent
        // below. Facing-projected aim deadlocked here (the recut probe): a
        // pilot parked inside its stop stops moving, its facing goes stale,
        // and it cast fire at nothing for three hundred seconds while a
        // dark bowl stood two metres away.
        aimX = bossRelightGoal.x;
        aimZ = bossRelightGoal.z;
      } else if (s.stageIndex === BOSS_STAGE && bossFoe) {
        // Anchored at the flame the pilot stops walking, so facing-projected
        // aim goes stale against an orbiting spitter. Body-aim here models
        // FACE-TRACKING (the micro-taps a holding player makes to keep the
        // boss in front), not cursor aim — the aim skill itself is verified
        // where it always is, in the browser harness against real input.
        aimX = bossFoe.x;
        aimZ = bossFoe.z;
      }
      cmds.push({ type: "cast", form: "aimed", aimX, aimZ });
      castCooldown = 14;
    } else if (
      choreTarget &&
      castCooldown === 0 &&
      s.hero.castTicks === 0 &&
      !s.hero.casting &&
      Math.hypot(s.hero.x - choreTarget.x, s.hero.z - choreTarget.z) <= 7
    ) {
      // WATER at the burning hut, FIRE at the dark bowl. The catching fire
      // (lit, or dark-and-keepLit for a fire bolt) intercepts from any range
      // past the muzzle grace, so precision is not what is under test.
      cmds.push({ type: "queue", element: choreTarget === douseTarget ? "water" : "fire" });
      cmds.push({ type: "cast", form: "aimed", aimX: choreTarget.x, aimZ: choreTarget.z });
      castCooldown = 14;
    }

    const ev: RtEvents = rtStep(w, s, cmds);


    /* ------------------------------------------------------------- beats */
    if (t === 0) beats.openingSpeed = Math.hypot(s.hero.vx, s.hero.vz) * TICK_HZ;
    if (beats.firstAgency < 0 && ev.casts.length > 0) beats.firstAgency = secs;
    if (beats.firstVictory < 0 && ev.deaths.length > 0) beats.firstVictory = secs;
    if (beats.allyJoined < 0 && ev.rescued.length > 0) beats.allyJoined = secs;
    if (beats.chainFired < 0 && ev.impacts.some((i) => i.chained)) beats.chainFired = secs;
    for (const id of ev.markersCleared) {
      if (beats.clearedAt[id] === -1) beats.clearedAt[id] = secs;
    }
    for (const g of ev.granted) beats.grants.push(`${g}@${secs.toFixed(1)}`);
    if (ev.wove) beats.grants.push(`weave@${secs.toFixed(1)}`);
    for (let i = 0; i < ev.hutDoused.length; i++) beats.dousedAt.push(secs);
    if (ev.stageCleared >= 0) {
      if (beats.stageClearedAt[ev.stageCleared] === -1) {
        beats.stageClearedAt[ev.stageCleared] = secs;
      }
      pendingAdvance = ev.stageCleared;
    }
    // The seeping run's attribution is now enforced by the SIM itself: no
    // pilot can hold OIL in chapter 1 — it is not granted — so any ignition
    // here proves the Seepers drew the hazard and the pilot lit it.
    if (
      beats.oilIgnitedAt < 0 &&
      s.stageIndex === SEEP_STAGE &&
      ev.patches.some((p) => p.ignited)
    ) {
      beats.oilIgnitedAt = secs;
    }
    // The well's attribution mirrors it: `combo`, not `chained` — the combo
    // fires the moment the spark meets the wet body (placement-deterministic);
    // a chained hop needs a packmate on the trail and would be luck.
    if (
      beats.wellComboAt < 0 &&
      s.stageIndex === WELL_STAGE &&
      ev.impacts.some((i) => i.element === "lightning" && i.combo !== null && !i.onHero)
    ) {
      beats.wellComboAt = secs;
    }
    /* --------------------------------------- refusal → recovery (R4) */
    if (villageTriggeredAt < 0 && ev.markersTriggered.includes(villageMarkerId)) {
      villageTriggeredAt = secs;
    }
    if (bendClearedAt < 0 && ev.markersCleared.includes(bendMarkerId)) bendClearedAt = secs;
    if (pyreFightClearedAt < 0 && ev.markersCleared.includes(pyreMarkerId)) {
      pyreFightClearedAt = secs;
    }
    if (s.stageIndex === PYRE_STAGE) {
      if (beats.pyreOutAt < 0 && ev.hutDoused.length > 0) beats.pyreOutAt = secs;
      if (beats.pyreLitAt < 0 && ev.pyreLit.length > 0) beats.pyreLitAt = secs;
    }
    if (bossTriggeredAt < 0 && ev.markersTriggered.includes(bossMarkerId)) {
      bossTriggeredAt = secs;
    }
    if (s.stageIndex === BOSS_STAGE) {
      if (beats.bossPhaseAt < 0 && ev.bossPhase !== null) beats.bossPhaseAt = secs;
      if (beats.bossDousedAt < 0 && ev.hutDoused.length > 0) beats.bossDousedAt = secs;
      // The matrix touching a body that is not the hero. Burning is
      // dried-lane evidence by construction (it cannot land on a wet body);
      // Shocked is conductor-lane evidence (the wet-read pilot sparking the
      // coat). Which lane a run takes is emergent — a stray Conduction pool
      // from the Camp Gate fight once soaked the boss on spawn and the
      // whole fight legitimately ran on the spark lane.
      for (const st of ev.statuses) {
        if (Math.hypot(st.x - s.hero.x, st.z - s.hero.z) <= 1) continue;
        if (beats.bossBurnedAt < 0 && st.status === "burning") beats.bossBurnedAt = secs;
        if (beats.bossShockedAt < 0 && st.status === "shocked") beats.bossShockedAt = secs;
      }
    }
    // Establish the refusal: each budget is a generous multiple of the
    // compliant pilot's own time through the same beat, so the snapshot is
    // evidence of a stall, not of impatience. singles' terminus is its death.
    /**
     * THE PHASE GUARD (R5, fun's standing rule). Every refusenik refuses and
     * then CONVERTS, so any per-fight instrument that keeps reading past the
     * refusal records the compliant attempt and reports it as the refuser's.
     * Four instruments carried this bug — burst, floor, first-compose and
     * fight duration — and each was found only after producing a number one of
     * us had already reasoned from. The rule that retires the class: a
     * per-fight instrument is phase-scoped by DEFAULT, and its test includes a
     * converted-attempt case.
     */
    const refusing = beats.refusal === null;
    {
      const mk = refusing ? s.markers.find((k) => k.stage === GULCH_STAGE) : undefined;
      if (mk?.triggered && !mk.cleared) {
        const n = s.foes.filter((f) => f.alive && f.markerId === mk.id).length;
        if (prevPack >= 0 && prevPack - n > beats.gulchMaxBurst) {
          beats.gulchMaxBurst = prevPack - n;
        }
        prevPack = n;
      } else {
        prevPack = -1;
      }
    }
    {
      const mk = refusing ? s.markers.find((k) => k.stage === GULCH_STAGE) : undefined;
      if (mk?.triggered && !mk.cleared) {
        const n = s.foes.filter((f) => f.alive && f.markerId === mk.id).length;
        if (n < beats.gulchPackFloor) {
          beats.gulchPackFloor = n;
          beats.gulchPackFloorTick = mk.fightTicks;
        }
      }
    }
    if (refusing && s.stageIndex === GULCH_STAGE) beats.gulchArrivals += ev.reinforced.length;
    if (beats.gulchComposedTick < 0 && refusing) {
      const gm = s.markers.find((k) => k.stage === GULCH_STAGE);
      if (gm?.composed && gm.triggered) beats.gulchComposedTick = gm.fightTicks;
    }
    // THE REGIME DIAGNOSTIC (fun's R5 ask): the pack size on the exact tick
    // the valve is allowed to open. Below the threshold here means the valve
    // never opened at all, and cadence/budget cannot fix that at any value —
    // a dial disconnected from the failure.
    {
      const mk = refusing ? s.markers.find((k) => k.stage === GULCH_STAGE) : undefined;
      if (mk?.reinforce && mk.triggered && !mk.cleared && mk.fightTicks === mk.reinforce.after) {
        beats.gulchPackAtGate = s.foes.filter((f) => f.alive && f.markerId === mk.id).length;
      }
    }
    // How long the gulch fight RAN. The valve's gate must clear this with
    // headroom for every pilot who composes, or a slow-but-correct run is
    // punished for being unhurried (fun's R5 catch — my first gate cleared the
    // scripted pilot's slow end by zero, which is one pilot's number standing
    // in for a population).
    if (refusing) {
      for (const id of ev.markersCleared) {
        const mk = s.markers.find((k) => k.id === id);
        if (mk && mk.stage === GULCH_STAGE) beats.gulchFightTicks = mk.fightTicks;
      }
    }
    // The refusal margin, sampled every tick the pilot is in the gulch.
    if (s.stageIndex === GULCH_STAGE) {
      beats.gulchMinHp = Math.min(beats.gulchMinHp, s.hero.hp);
    }
    if (isRefusenik && beats.refusal === null) {
      const stalled =
        s.hero.defeated ||
        // neverTurns: the village fight has been live for 60 s — a turner
        // ends it in under five seconds of fight time.
        (pilot === "neverTurns" &&
          villageTriggeredAt >= 0 &&
          secs - villageTriggeredAt >= 60 &&
          !s.stages[VILLAGE_STAGE]?.cleared) ||
        // noDouse: the pre-R4 stall budget, unchanged — three times the
        // direct pilot's whole-village time.
        (pilot === "noDouse" && secs >= 90) ||
        // skipper, either epoch: the gate has refused for 30 s past the won
        // bend fight (the fixed tree), or the crossing SUCCEEDED and the
        // soft-lock premise is established (the pre-fix tree — the recovery
        // below is then the half that goes red).
        (pilot === "skipper" &&
          (s.stageIndex >= 2 ||
            (s.stageIndex === 1 &&
              bendClearedAt >= 0 &&
              secs - bendClearedAt >= 30 &&
              !s.stages[1]?.cleared))) ||
        // noRelight: the pyre gate has refused for 30 s past the won fight
        // with a bowl standing dark — the direct pilot's whole relight chore
        // takes under five.
        (pilot === "noRelight" &&
          s.stageIndex === PYRE_STAGE &&
          pyreFightClearedAt >= 0 &&
          secs - pyreFightClearedAt >= 30 &&
          !s.stages[PYRE_STAGE]?.cleared) ||
        // noMatrix: the boss has survived sixty seconds of raw spore — the
        // taught play ends it in well under ten of fight time. (Its death,
        // the likelier terminus, is caught by the shared defeated clause.)
        (pilot === "noMatrix" &&
          bossTriggeredAt >= 0 &&
          secs - bossTriggeredAt >= 60 &&
          !s.stages[BOSS_STAGE]?.cleared);
      if (stalled) {
        {
          const gm = s.markers.find((k) => k.stage === GULCH_STAGE);
          if (gm?.triggered && !gm.cleared) beats.gulchRefusalTicks = gm.fightTicks;
        }
        beats.refusal = {
          at: secs,
          stageClearedAt: [...beats.stageClearedAt],
          clearedAt: [...beats.clearedAt],
          dousedCount: beats.dousedAt.length,
          takenCount: s.pickups.filter((p) => p.taken).length,
          unlocked: [...s.unlocked],
          darkPyres: s.hutFires.filter((hf) => hf.keepLit && !hf.lit).length,
          bossAlive: s.foes.some((f) => f.alive && f.kindId === "thornback"),
          downed: s.hero.defeated,
        };
      }
    }
    if (s.hero.defeated) {
      // A refusenik's death is part of the experiment: the refusal was
      // established above this tick, and clause 1 of the recoverability
      // standard — "downed, with the defeat seam exercisable" — is proven by
      // EXERCISING it: the real restartStage, then compliant play.
      if (isRefusenik && beats.refusal !== null && restarts < 2) {
        const entry = s.stageIndex > 0 ? s.stages[s.stageIndex - 1] : null;
        pendingRestart = { x: entry?.exitX ?? 0, z: entry?.exitZ ?? 0 };
        restarts++;
        beats.restarted = true;
      } else {
        beats.survived = false;
        break;
      }
    }
    if (s.stages.every((st) => st.cleared)) break;
    // A recovered refusenik has proven its half the moment the refused beat
    // clears; the rest of the chapter is the direct pilot's job.
    if (beats.refusal !== null) {
      const target =
        pilot === "singles"
          ? GULCH_STAGE
          : pilot === "noRelight"
            ? PYRE_STAGE
            : pilot === "noMatrix"
              ? BOSS_STAGE
              : VILLAGE_STAGE;
      if (beats.stageClearedAt[target]! > 0) break;
    }
  }

  return beats;
}

const direct = playOpening("direct");
const singles = playOpening("singles");
const oneElement = playOpening("oneElement");
const masher = playOpening("masher");
const neverTurns = playOpening("neverTurns");
const noDouse = playOpening("noDouse");
const skipper = playOpening("skipper");
const noRelight = playOpening("noRelight");
const noMatrix = playOpening("noMatrix");

for (const [name, b] of [
  ["direct", direct],
  ["singles", singles],
  ["oneElement", oneElement],
  ["masher", masher],
  ["neverTurns", neverTurns],
  ["noDouse", noDouse],
  ["skipper", skipper],
  ["noRelight", noRelight],
  ["noMatrix", noMatrix],
] as const) {
  // Printed so the doc tables in CLAUDE.md §9 and PEDAGOGY.md are transcribed
  // from a measurement rather than from a hope.
  console.log(
    `[opening:${name}] speed ${b.openingSpeed.toFixed(1)}m/s · agency ${b.firstAgency}s · ` +
      `victory ${b.firstVictory}s · ally ${b.allyJoined}s · chain ${b.chainFired}s · ` +
      `cleared [${b.clearedAt.map((x) => (x < 0 ? "-" : x.toFixed(1))).join(", ")}] · ` +
      `stages [${b.stageClearedAt.map((x) => (x < 0 ? "-" : x.toFixed(1))).join(", ")}] · ` +
      `grants [${b.grants.join(", ")}] · doused [${b.dousedAt.map((x) => x.toFixed(1)).join(", ")}] · ` +
      `ignite ${b.oilIgnitedAt.toFixed(1)}s · ` +
      `wellCombo ${b.wellComboAt.toFixed(1)}s · pyre out/lit ${b.pyreOutAt.toFixed(1)}/${b.pyreLitAt.toFixed(1)}s · ` +
      `boss ph/burn/shock/douse ${b.bossPhaseAt.toFixed(1)}/${b.bossBurnedAt.toFixed(1)}/${b.bossShockedAt.toFixed(1)}/${b.bossDousedAt.toFixed(1)}s · ` +
      `gulchFight ${b.gulchFightTicks} gate ${b.gulchPackAtGate} floor ${b.gulchPackFloor}@${b.gulchPackFloorTick} burst ${b.gulchMaxBurst} arrivals ${b.gulchArrivals} composedAt ${b.gulchComposedTick} refusalIn ${b.gulchRefusalTicks} · gulchMargin ${b.gulchMinHp === 0 ? "DOWNED" : b.gulchMinHp.toFixed(1)} · survived ${b.survived} · ` +
      `refusal ${b.refusal ? `${b.refusal.at.toFixed(1)}s` : "-"} · restarted ${b.restarted}`,
  );
}

describe.each([
  ["direct", direct],
  ["singles", singles],
  ["masher", masher],
  ["neverTurns", neverTurns],
])("the opening funnel — %s pilot", (_name, b: Beats) => {
  it("has the hero already running on the very first tick", () => {
    // §9: the player arrives in motion. No pilot issued a command here.
    expect(b.openingSpeed).toBeGreaterThan(0);
  });

  it("offers first agency within 10 seconds", () => {
    expect(b.firstAgency).toBeGreaterThan(0);
    expect(b.firstAgency).toBeLessThanOrEqual(10);
  });

  it("pays a first victory within 60 seconds", () => {
    expect(b.firstVictory).toBeGreaterThan(0);
    expect(b.firstVictory).toBeLessThanOrEqual(60);
  });

  it("clears the corridor — one element, one lit button, taught by placement", () => {
    expect(b.clearedAt[0], "the corridor").toBeGreaterThan(0);
  });
});

/**
 * ⚑ THE §9 TABLE, ASSERTED (R7).
 *
 * `CLAUDE.md` §9 states, in the sentence directly under the table: *"Every
 * timing below is measured by `test/opening.test.ts` and re-measured by
 * driving `index.html` in a real browser. None of it is estimated."*
 *
 * **That was literally true and structurally misleading.** This file MEASURED
 * every one of those times and ASSERTED three of them — `firstAgency <= 10`,
 * `firstVictory <= 60`, and the douse-before-gate ordering. The rest were
 * printed to a console line. **Measured is not asserted**, and a number that
 * only gets printed drifts in silence — under the one table in the document
 * that argues we clear the platform's 80% one-minute conversion bar.
 *
 * It had already happened. When this block was written, **THE WEAVE was 2.4 s
 * off its published time** and nothing in the repo could say so.
 *
 * ── THE TOLERANCE, AND WHY IT IS ONE NUMBER ──
 *
 * ±1.0 s, flat. Wide enough that retuning a fight or nudging a marker does not
 * red the build; narrow enough that a beat sliding a second does. A tolerance
 * that grows with elapsed time was the tempting alternative and it is the
 * wrong shape: the beats that matter most to the funnel are the early ones,
 * and a scheme that forgives the late ones most is forgiving exactly where a
 * ten-minute session is decided.
 *
 * **CALIBRATED AGAINST A REAL CHANGE, not a planted one.** Pulling s2's gate
 * back down the road and MEASURING where it starts to bite: 2.5 m is absorbed
 * (every beat inside 1.0 s), **5 m reds two rows**, 8 m reds six. That is the
 * trade this tolerance buys — a fight retune or a marker nudge passes, a stage
 * boundary genuinely moving does not. *The first perturbation came back GREEN
 * at 2.5 m, and a red-proof that fails to red is indistinguishable from a check
 * with no teeth; the break has to be measured, never designed.*
 *
 * ── WHAT THIS BLOCK DELIBERATELY DOES NOT CLAIM ──
 *
 * Two §9 rows — **22.4 s "The Mire Pool"** and **29.5 s "The Old Well"** — sat
 * between this file's two candidate measurements for them when the block was
 * written (the fight clearing and the stage clearing: 21.1/23.0 and 28.7/29.7,
 * both since shifted by the R7 hut move), and nothing in the table says which
 * basis it was transcribed on. **The rest of the table is not
 * consistent about it either** — 39.2 s matches a STAGE clear to the tick and
 * 71.1 s matches a MARKER clear to the tick. Rather than pick the reading that
 * makes the number pass, both are pinned as raw drift guards below and their
 * §9 correspondence is recorded as unattributed. *Choosing the basis that
 * fits is how a check comes to measure its own assumption.*
 *
 * ── CURRENT STATE ── GREEN, with **six pinned doc-drift rows** — one that
 * predates this block and five the R7 camera-sleeve fix created; see
 * `KNOWN_DOC_DRIFT` below for both the reason and the replacement numbers §9
 * owes. Red-proven four ways: a published time moved past tolerance, a stale
 * row corrected, a row deleted from the table, and **a real 5 m change to s2's
 * gate**, which is the one that counts.
 */
describe("the §9 opening table — every published time, asserted", () => {
  const at = (id: string): number => {
    const g = direct.grants.find((x) => x.startsWith(`${id}@`));
    return g ? Number(g.split("@")[1]) : -1;
  };

  /** `[the §9 row, its published second, what this run measured]`. */
  const PUBLISHED: readonly (readonly [string, number, number])[] = [
    ["first agency — press, cast, ONE lit button", 3.3, direct.firstAgency],
    ["first kill — colour comes back into the tile", 4.7, direct.firstVictory],
    ["stage 1 closes at the gate (toast, no panel)", 5.5, direct.stageClearedAt[0]!],
    // ⚠️ MOVED WITH THE DOCUMENT (R7, `f4fedb6`): §9 now carries **5.6**, and
    // this reference moved with it — which is the whole reason the note below
    // was written HERE rather than in a report. It said *"this entry must move
    // with the document"*, and the PM, making that edit one message later, was
    // the person standing in front of it. A warning placed where the change
    // will happen is worth more than the same warning delivered to whoever is
    // listening today.
    //
    // The drift it caught was **pre-existing and stationary**: WATER is taken
    // at 5.6 s, BEFORE the village, so the R7 hut move cannot have caused it —
    // it was 0.4 s adrift before this cycle touched anything, sat inside the
    // ±1.0 s tolerance, and appeared in nobody's list of what changed.
    // **It surfaced only because every row prints its margin.** A check that
    // reported pass/fail could not have shown it, and a drift guard held
    // against last week's MEASUREMENT rather than against the PUBLISHED number
    // would have had exactly that hole. This table compares to §9, so a row
    // that is wrong-and-stationary still reds when it exceeds tolerance.
    ["WATER, taken past the gate", 5.6, at("water")],
    ["the Mossy Bend — WATER's stage to be USED", 10.5, direct.stageClearedAt[1]!],
    ["Sella, freed mid-stretch on the walk in", 11.7, direct.allyJoined],
    ["the village fight won — the charger and the Cinderling", 15.4, direct.clearedAt[2]!],
    ["the first douse — the village breathes", 15.9, direct.dousedAt[0] ?? -1],
    ["the second douse", 16.9, direct.dousedAt[1] ?? -1],
    ["SPARK, taken on the walk back — Sella's thanks", 19.9, at("lightning")],
    ["THE WEAVE at the Old Well's gate — the queue grows to two", 32.6, at("weave")],
    ["the Dry Gulch — mixing is REQUIRED", 39.2, direct.stageClearedAt[5]!],
    ["FIRE, atop the Ashen Rise", 50.3, at("fire")],
    ["the seeping run's oil trails burn", 54.4, direct.oilIgnitedAt],
    ["the camp — the chapter's one real panel", 71.1, direct.clearedAt[9]!],
  ];

  const TOLERANCE = 1.0;

  /**
   * Rows where the PUBLISHED number no longer matches the measurement.
   *
   * **A pin, not a permission.** `CLAUDE.md` is the platform contract and this
   * seat does not edit it; the drift is surfaced here so the PM can correct
   * the document, and **this list reds the day they do.** A row leaving the
   * table is as loud as a row joining it.
   *
   * ⚠️ **THE SECOND VALUE IS THE REPLACEMENT §9 OWES**, so the correction is a
   * transcription and not a re-derivation. Do not treat it as the assertion —
   * the assertion is against the PUBLISHED number above, and this list only
   * says which rows are knowingly stale.
   *
   * ── WHY SIX ROWS ARE PINNED (R7) ──
   *
   * ⚑ **The row that filed this block is no longer on the list, and the way it
   * left is worth keeping.** THE WEAVE was **2.4 s adrift** the day this was
   * written — the single stale row, and the proof that a printed number drifts
   * in silence. The hut move pushed it 30.2 -> 33.5 s, i.e. **toward** its
   * published 32.6, and it fell back inside tolerance on its own. *A drift can
   * be closed by a change that was not aiming at it, which is a good reason to
   * hold the table against the document rather than against last week's
   * measurement.*
   *
   * The six below are the **camera-sleeve fix's honest price**, and it is
   * exactly the cost story and the PM said this change would owe. Three
   * village huts moved 1.9–4.8 m out of the walking lens's path (V13); two of
   * them burn, so the pilot walks further to douse them, and **+1.3 s at the
   * douses propagates to +2.1 s at SPARK, +3.2 s at the Dry Gulch and +2.6 s
   * at FIRE.** The move was ruled by story on the village's shape, by gfx's
   * pixel rig on the frames (six fully-hidden poses recovered, none created)
   * and by fun on the fire's frame cost — **but nobody ruled on this, because
   * until this block existed nobody could see it.** *That is the check paying
   * for itself on the first change that crossed it.*
   *
   * **What did NOT move is the part §9 argues the funnel on:** first agency
   * 3.3 s and first kill 4.7 s are unchanged to the tick, and the camp lands
   * at 71.2 s against a published 71.1 — the later fights are
   * duration-bounded rather than distance-bounded, so the chapter re-converges
   * and the drift is confined to the middle.
   */
  const KNOWN_DOC_DRIFT: readonly (readonly [string, number])[] = [
    ["the first douse — the village breathes", 17.2],
    ["the second douse", 18.2],
    ["SPARK, taken on the walk back — Sella's thanks", 22.0],
    ["the Dry Gulch — mixing is REQUIRED", 42.4],
    ["FIRE, atop the Ashen Rise", 52.9],
    ["the seeping run's oil trails burn", 55.9],
  ];

  it("prints every row's MARGIN — a green at 0.9 s is not a green at 0.1 s", () => {
    // The check cannot otherwise tell you which state you are in, and the
    // difference is the whole health of a row. THE WEAVE is the worked
    // example: it read green the day it was 0.9 s from the edge and green
    // again the day it was 2.4 s past it, because a boolean threw the number
    // away. story's observation, and it costs one console line.
    //
    // ⚠️ It is a REPORT, not a bar. A per-row band keyed on which times §9
    // treats as contract (≤1 click, first agency, the first find, session
    // length) and which describe the superhuman pilot's walk is the right next
    // shape — but §9 marks that split only in TYPOGRAPHY (four bolded times:
    // 3.3, 4.7, 6.0, 71.1), and a checker leaning on bolding is a checker
    // leaning on something nobody has declared. It needs the PM to make the
    // distinction explicit in the document first.
    console.log(
      "[§9] " +
        PUBLISHED.map(([row, published, measured]) => {
          const d = measured - published;
          return `${row.split(" — ")[0]!.split(",")[0]} ${published}->${measured.toFixed(1)} (${d >= 0 ? "+" : ""}${d.toFixed(1)})`;
        }).join(" · "),
    );
    expect(PUBLISHED.every(([, , m]) => m > 0)).toBe(true);
  });

  it("has a measurement for every published row — none is estimated", () => {
    for (const [row, , measured] of PUBLISHED) {
      expect(measured, `${row}: never happened in the direct pilot's run`).toBeGreaterThan(0);
    }
    // A row silently dropped from this list is a row that stops being guarded,
    // which is the failure this whole block exists to end.
    expect(PUBLISHED.length).toBe(15);
  });

  it("every published time matches the run, except the pinned drift", () => {
    const off = PUBLISHED.filter(([, published, measured]) => Math.abs(measured - published) > TOLERANCE);
    expect(
      off.map(([row]) => row),
      off
        .map(([row, published, measured]) => `${row}: §9 says ${published}s, measured ${measured.toFixed(1)}s (${(measured - published).toFixed(1)}s)`)
        .join("\n"),
    ).toEqual(KNOWN_DOC_DRIFT.map(([row]) => row));
  });

  it("the beats stay ORDERED — the curriculum cannot reshuffle inside the tolerance", () => {
    // Absolute times can all drift together under a legitimate change; the
    // ORDER is the claim §9 is really making, and it survives a uniform shift
    // that the tolerances would forgive. Both, or a global slowdown reads as
    // fifteen small ones.
    //
    // ⚑ THIS IS THE ONE CROSS-ROW OPERATION IN THE BLOCK, AND IT IS LEGAL
    // WHERE SUBTRACTION IS NOT. Intervals between §9 rows are unsound —
    // subtracting two rows, or multiplying an interval by a speed, produces a
    // NEW QUANTITY whose value depends on the speed regime between them, and
    // that regime is unknown and varies fourfold (measured over the direct
    // pilot's 2140 ticks: mean 63% of MAX_SPEED, median 70%, p25 24%, full
    // tilt for 43.9%). **A comparison produces no quantity**, so it survives
    // any speed profile.
    //
    // ⚠️ BUT THE INVARIANCE IS CONDITIONAL, AND THE CONDITION IS A DESIGN
    // FACT, NOT A PROPERTY OF COMPARISON (story, R7). It holds because every
    // row below is PROGRESS-TRIGGERED: each one is recorded off a sim event
    // the pilot caused — `ev.casts`, `ev.deaths`, `ev.rescued`,
    // `ev.markersCleared`, `ev.hutDoused`, `ev.stageCleared`, `ev.granted`,
    // `ev.patches[].ignited`. Checked, not assumed: all fifteen, today. You
    // cannot take WATER before clearing s1 because the take is GATED on the
    // clear, and a speed swing cannot reorder two gated events.
    //
    // **A TIMER-TRIGGERED ROW WOULD BREAK IT.** Anything keyed to wall time
    // rather than to progress — a banner on a fixed clock, an ad seam (§8's
    // are time-shaped), a cooldown — can reorder against a progress-triggered
    // row under a speed change, and this guard would then red on a SPEED
    // CHANGE rather than on a defect. Act 2 adds rows; if one of them is
    // timer-triggered, it does not belong in `PUBLISHED` and this guard is
    // where the mystery red would surface.
    //
    // SCOPE: the direct pilot's single run. Whether a human's beats arrive in
    // this order is UNMEASURED, not assumed.
    const measured = PUBLISHED.map(([, , m]) => m);
    for (let i = 1; i < measured.length; i++) {
      expect(
        measured[i]!,
        `${PUBLISHED[i]![0]} now happens before ${PUBLISHED[i - 1]![0]}`,
      ).toBeGreaterThanOrEqual(measured[i - 1]!);
    }
  });

  it("pins the two rows whose §9 basis is UNATTRIBUTED, as raw drift guards", () => {
    // The Mire Pool and the Old Well. Not held against a published number —
    // held against themselves, so they cannot move silently while the question
    // of which basis §9 used stays open.
    //
    // Re-baselined once, in R7, by the camera-sleeve hut move: 21.1 -> 24.6 and
    // 28.7 -> 31.9, the same +2 to +3 s the pinned rows above took. Recorded as
    // a re-baseline WITH ITS CAUSE rather than as a fresh number, because a
    // guard silently retuned to whatever it currently measures is not a guard.
    expect(direct.clearedAt[3]!).toBeGreaterThan(24.6 - TOLERANCE);
    expect(direct.clearedAt[3]!).toBeLessThan(24.6 + TOLERANCE);
    expect(direct.clearedAt[4]!).toBeGreaterThan(31.9 - TOLERANCE);
    expect(direct.clearedAt[4]!).toBeLessThan(31.9 + TOLERANCE);
  });

  it("keeps the two BARS that were always asserted — they are not replaced", () => {
    // §9's platform claims are bars, not points, and a point assertion inside
    // ±1 s is not a bar. Both survive: the table guards drift, the bars guard
    // the funnel.
    expect(direct.firstAgency).toBeLessThanOrEqual(10);
    expect(direct.firstVictory).toBeLessThanOrEqual(60);
  });
});

describe("the curriculum — power is found, and each find is earned", () => {
  it("starts with SPORE alone and finds WATER at the first gate", () => {
    expect(direct.grants[0]).toMatch(/^water@/);
  });

  it("grants in the authored order: water, spark, the weave, fire", () => {
    expect(direct.grants.map((g) => g.split("@")[0])).toEqual([
      "water",
      "lightning",
      "weave",
      "fire",
    ]);
  });

  it("grows the party by rescue on the way to the village fight", () => {
    expect(direct.allyJoined).toBeGreaterThan(0);
    expect(masher.allyJoined).toBeGreaterThan(0);
  });
});

describe("the village — facing is aiming, and it is REQUIRED", () => {
  it("a pilot that turns clears it, even casting garbage", () => {
    expect(
      masher.clearedAt[VILLAGE_STAGE],
      "the masher turns, so it clears",
    ).toBeGreaterThan(0);
  });

  it("a pilot that never turns cannot get past it — with smart casts", () => {
    // The load-bearing half. The Cinderling holds its 7.5 m band off the road
    // axis; a player who will not turn cannot end this fight, however good
    // their single-element play is. The bend before it is deliberately
    // near-axis so the stall is attributable to facing, nothing earlier.
    // Read at the REFUSAL snapshot — the same run recovers afterwards.
    const r = neverTurns.refusal;
    expect(r, "neverTurns never established its refusal — no stall to measure").toBeTruthy();
    expect(
      r!.stageClearedAt[VILLAGE_STAGE - 1],
      "neverTurns died before the village — the stall is no longer about facing",
    ).toBeGreaterThan(0);
    expect(
      r!.stageClearedAt[VILLAGE_STAGE],
      "the never-turning pilot cleared the village — the facing lesson is decorative",
    ).toBe(-1);
  });

  it("…and the refusal state is still alive: turned compliant, the same run clears it", () => {
    // The recoverability half (R4): refusing to turn strands nothing — the
    // moment the pilot starts facing its foes, the fight ends and the road
    // opens. A lesson must be refusable AND survivable.
    expect(
      neverTurns.stageClearedAt[VILLAGE_STAGE],
      "the refusal state could not be played out of — the stall is a trap, not a lesson",
    ).toBeGreaterThan(0);
  });
});

describe("the village — water answers the fires, and it is REQUIRED", () => {
  it("the direct pilot douses every burning hut before the gate opens", () => {
    expect(direct.dousedAt.length, "no douse ever landed").toBeGreaterThanOrEqual(2);
    const gate = direct.stageClearedAt[VILLAGE_STAGE]!;
    for (const d of direct.dousedAt.slice(0, 2)) {
      expect(d, "a douse landed after the gate — the order is wrong").toBeLessThanOrEqual(gate);
    }
  });

  it("a pilot that wins the fight but never douses cannot leave — both halves", () => {
    // The fight-won half makes the stall attributable: noDouse is direct's
    // twin in movement and casts, so the ONLY thing between it and the gate
    // is the fires it refuses to answer. Read at the refusal snapshot.
    const r = noDouse.refusal;
    expect(r, "noDouse never established its refusal — no stall to measure").toBeTruthy();
    expect(
      r!.clearedAt[VILLAGE_STAGE],
      "noDouse never even won the village fight — the stall is not about fires",
    ).toBeGreaterThan(0);
    expect(
      r!.stageClearedAt[VILLAGE_STAGE],
      "the never-dousing pilot cleared the village — the water lesson is decorative",
    ).toBe(-1);
    expect(r!.dousedCount).toBe(0);
  });

  it("…and the refusal state is still alive: the tool was in hand, and using it opens the gate", () => {
    // The recoverability half (R4). Clause 2: WATER was held the whole time —
    // the refusal was a choice, not a deprivation. Clause 3: the same run,
    // converted to dousing, clears the stage; every douse lands after the
    // refusal was established, so the recovery is attributable to compliance.
    const r = noDouse.refusal!;
    expect(r.unlocked, "noDouse lost WATER somewhere — the stall is deprivation").toContain(
      "water",
    );
    expect(
      noDouse.stageClearedAt[VILLAGE_STAGE],
      "the refusal state could not be played out of — the stall is a trap, not a lesson",
    ).toBeGreaterThan(0);
    expect(noDouse.dousedAt.length).toBeGreaterThanOrEqual(2);
    for (const d of noDouse.dousedAt) {
      expect(d, "a douse landed before the refusal — the snapshot is not a refusal").
        toBeGreaterThanOrEqual(r.at);
    }
  });
});

describe("the pool — the world demonstrates the chain", () => {
  it("fires Wet+Lightning even for a pilot casting random singles", () => {
    // The GROUND wets the pack and any lightning cast chains it — placement,
    // not understanding. The masher does not know lightning is special; it
    // reaches the chain anyway. This is the demonstration the weave unlock
    // then builds on.
    expect(masher.chainFired, "the chain never fired for the masher").toBeGreaterThan(0);
    expect(direct.chainFired).toBeGreaterThan(0);
  });
});

describe("the old well — an element foe carries its element", () => {
  it("the spark finds the wet one: the sopling's own trail earns the combo", () => {
    // The direct pilot casts no water before s6 BY CONSTRUCTION
    // (DIRECT_CASTS), and the well terrain is dry — so a lightning combo on
    // a foe inside s5 is attributable to the Sopling's self-laid trail
    // alone. The pilot is doing nothing new: SPARK is s5's scripted cast,
    // proven at the pool one stage back; the encounter LEADS it into the
    // discovery, which is the pedagogy rule. This check can fail: remove
    // the sopling, break its self-wetting, or spawn it off the pilot's path
    // and there is no wet body for the combo to fire on.
    expect(
      direct.wellComboAt,
      "no lightning combo landed in the old well — the sopling teach is dead",
    ).toBeGreaterThan(0);
  });
});

describe("the dry gulch — mixing is REQUIRED, not decorative", () => {
  it("every per-fight instrument reports the REFUSAL, never the converted attempt", () => {
    // THE PHASE-GUARD TEST (R5, fun's standing rule made checkable). Every
    // refusenik refuses, dies, converts, and then plays the same fight
    // compliantly — so an instrument that keeps reading past the refusal
    // records the COMPLIANT attempt and reports it as the refuser's. Six
    // instruments carried that bug in this cycle; four of them produced a
    // number one of us reasoned from before it was caught (a refuser
    // "composing at tick 9", a refuser's fight "lasting 129 ticks", a pack
    // floor of 0 from a converted sweep, a burst of 8 from a converted mix).
    //
    // The rule this pins: a per-fight instrument is phase-scoped by default,
    // and its test includes a converted-attempt case. This IS that case.
    expect(singles.refusal, "premise dead: singles never established a refusal").toBeTruthy();
    // The vacuity guard, and it is the whole point: the converted attempt must
    // EXIST, or there is nothing an unscoped instrument could wrongly record.
    expect(
      singles.clearedAt[GULCH_STAGE],
      "premise dead: singles never cleared the gulch after converting, so no unscoped instrument could have recorded it",
    ).toBeGreaterThan(0);

    // A refuser never composes. It converted and mixed, but not while refusing.
    expect(singles.gulchComposedTick, "recorded the converted attempt's mix").toBe(-1);
    // A refuser never CLEARS this fight — it dies in it. The field is
    // structurally blank for exactly the pilot the question is about, which is
    // why the readability window needed its own measurement rather than a
    // corrected version of this one.
    expect(singles.gulchFightTicks, "recorded the converted attempt's clear").toBe(-1);
    // And the quantity that does answer it: time inside the fight before the
    // refusal was established.
    expect(
      singles.gulchRefusalTicks,
      "the refusal window was never measured",
    ).toBeGreaterThan(0);
  });

  it("the direct pilot clears it with Conduction", () => {
    expect(
      direct.clearedAt[GULCH_STAGE],
      "Conduction should carry the gulch",
    ).toBeGreaterThan(0);
  });

  it("a pilot that never mixes cannot clear it — and it got there fresh", () => {
    // THE required-mix check, and the reason the gulch exists: converging
    // chargers on bone-dry ground, one bolt at a time cannot stop the pack.
    // The singles pilot is direct's twin in movement and curriculum — it
    // REACHES the gulch (asserted, so this can never pass vacuously by dying
    // early) and fails only for refusing to compose. Read at the refusal
    // snapshot, whose terminus is the death itself.
    const r = singles.refusal;
    expect(r, "singles never established its refusal — no failure to measure").toBeTruthy();
    expect(
      r!.stageClearedAt[GULCH_STAGE - 1],
      "the singles pilot never reached the gulch",
    ).toBeGreaterThan(0);
    expect(
      r!.stageClearedAt[GULCH_STAGE],
      "the never-mixing pilot cleared the gulch — mixing is decorative",
    ).toBe(-1);
    expect(r!.downed, "singles survived its refusal — the gulch no longer kills it").toBe(true);
  });

  it("…and the death is not the run's death: the defeat seam retries, and mixing clears it", () => {
    // The recoverability half (R4). Clause 1 proven by exercise: the pilot
    // went down, the REAL restartStage (main.ts's "Try again") stood it back
    // up at the stage entry with its whole kit — the finds survive a defeat —
    // and the same run, now composing, clears the fight that killed it.
    expect(singles.restarted, "the defeat seam was never exercised").toBe(true);
    expect(
      singles.stageClearedAt[GULCH_STAGE],
      "the retried, composing run still cannot clear the gulch — the exam is a wall",
    ).toBeGreaterThan(0);
  });
});

describe("the find-skip — a gate never closes behind an untaken find (R4)", () => {
  // fun's R3 critical, suite-level twin of comp's held browser red
  // (assets-src/checks/softlock-repro.mjs): a plain held walk past WATER used
  // to cross the s2 gate, the one-way corridor then moved past the gem, and
  // the village — which REQUIRES water — was unreachable forever. The fix is
  // the douse-gate pattern pointed backward: the seam refuses while a find
  // from an earlier stage stands untaken.

  it("the skipping pilot really played: both fights fought, zero takes pressed", () => {
    const r = skipper.refusal;
    expect(r, "the skipper never established its refusal — premise dead").toBeTruthy();
    expect(r!.clearedAt[0], "the corridor fight was skipped — premise dead").toBeGreaterThan(0);
    expect(r!.clearedAt[1], "the bend fight was skipped — premise dead").toBeGreaterThan(0);
    expect(r!.takenCount, "a take slipped into the refusal phase — premise dead").toBe(0);
    expect(r!.unlocked).not.toContain("water");
  });

  it("the gate REFUSES to close behind the untaken find", () => {
    // The fix's shape, pinned. On the pre-fix tree this was red: the crossing
    // succeeded, and the run was already dead without knowing it.
    expect(
      skipper.refusal!.stageClearedAt[1],
      "the gate closed behind an untaken find — the soft-lock is open again",
    ).toBe(-1);
  });

  it("the run is still winnable: walk back, take WATER, clear the village — same run", () => {
    // fun's exact repro, outcome-level. Pre-fix this is the soft-lock: the
    // corridor's one-way boundary has moved past the gem (comp measured the
    // recovery walk stopping 8.79 m short of a 2.6 m take radius) and the
    // village needs WATER the run can never hold again.
    expect(
      skipper.stageClearedAt[VILLAGE_STAGE],
      "the run is dead: the skipped find is unreachable and the village cannot clear",
    ).toBeGreaterThan(0);
  });

  it("the recovery went through a PRESS — the take lesson survives the fix", () => {
    // Guards the rejected fix shape: an auto-take at the gate would grant
    // WATER without a press and turn the take row's lesson into decoration.
    // The grant must land AFTER the refusal was established, via the same
    // take command every other pilot uses.
    const water = skipper.grants.find((g) => g.startsWith("water@"));
    expect(water, "WATER never granted — the recovery did not happen").toBeTruthy();
    expect(
      Number(water!.split("@")[1]),
      "WATER was in hand before the refusal — auto-granted, not taken",
    ).toBeGreaterThan(skipper.refusal!.at);
  });
});

describe("the damp pyres — the anti-synergy is the objective (R4)", () => {
  // PEDOGOGY row 51, both halves plus recoverability. The braziers must be
  // KEPT burning: dousers walk wet bodies at the bowls, the gate refuses
  // while one is dark, and FIRE — three stages proven — is the answer.

  it("a naive pilot OBSERVES the extinguish: a wet body reaches a bowl and the flame dies", () => {
    // The observed half. The near douser spawns a two-second amble from its
    // bowl, so the extinguish happens in front of ANY pilot regardless of
    // skill — placement, not scripting. This can fail: remove the douser
    // flag, slow the walker, or move the bowl out of the arena and no pyre
    // ever goes dark on the direct run.
    expect(
      direct.pyreOutAt,
      "no pyre went dark on the direct run — the anti-synergy was never demonstrated",
    ).toBeGreaterThan(0);
  });

  it("…and the encounter is still winnable after: the relight lands and the stage clears", () => {
    expect(direct.pyreLitAt, "the relight never landed").toBeGreaterThan(direct.pyreOutAt);
    expect(
      direct.stageClearedAt[PYRE_STAGE],
      "the direct pilot could not clear the pyre stage",
    ).toBeGreaterThan(0);
  });

  it("a pilot that never relights cannot leave — with the fight won and a bowl dark", () => {
    // The required half. noRelight is direct's twin refusing exactly the
    // relight chore: it wins the fight (premise), a bowl stands dark
    // (premise), and the gate refuses for its whole stall budget.
    const r = noRelight.refusal;
    expect(r, "noRelight never established its refusal — no stall to measure").toBeTruthy();
    expect(
      r!.clearedAt[PYRE_STAGE],
      "noRelight never won the pyre fight — the stall is not about the bowls",
    ).toBeGreaterThan(0);
    expect(r!.darkPyres, "no bowl was dark at refusal — the stall is not about relighting").
      toBeGreaterThan(0);
    expect(
      r!.stageClearedAt[PYRE_STAGE],
      "the never-relighting pilot cleared the stage — the pyre lesson is decorative",
    ).toBe(-1);
  });

  it("…and the refusal state is still alive: FIRE was in hand, and using it opens the gate", () => {
    // Recoverability (clauses 2 and 3): the tool was held the whole time —
    // the find conjunct guarantees FIRE by here — and the same run,
    // converted to relighting, clears the stage.
    expect(noRelight.refusal!.unlocked).toContain("fire");
    expect(
      noRelight.stageClearedAt[PYRE_STAGE],
      "the refusal state could not be played out of — the pyre stage is a trap",
    ).toBeGreaterThan(0);
    expect(noRelight.pyreLitAt, "recovery cleared the stage without any relight — vacuous").
      toBeGreaterThan(0);
  });
});

describe("the seeping run — the ground draws the hazard, the player lights it", () => {
  it("the direct pilot ignites oil it cannot possibly have laid", () => {
    // Attribution is enforced by the sim: OIL is not granted anywhere in
    // chapter 1, so no pilot can queue it by any route. The only oil in the
    // run is the Seepers' trail.
    expect(direct.oilIgnitedAt, "no ignition in the seeping run").toBeGreaterThan(0);
  });

  it("the direct pilot clears the whole chapter, and lives", () => {
    for (let i = 0; i < direct.stageClearedAt.length; i++) {
      expect(direct.stageClearedAt[i], `stage ${i + 1}`).toBeGreaterThan(0);
    }
    expect(direct.survived).toBe(true);
  });

  it("keeps the whole chain inside a session a stranger would actually play", () => {
    // §9's bar is a 10-minute average play time and §8 models 5–8 stage clears
    // in a 17-minute session. The pilot is superhuman — it walks at full tilt
    // and never window-shops — so its ten-stage time is a floor, not the
    // human estimate. Pinned so the number stays visible.
    expect(direct.stageClearedAt.at(-1)).toBeLessThan(180);
  });
});

describe("the sodden hollow — the taught lessons recombined, never an HP wall (R4)", () => {
  // The ch1 boss (§10): its sodden coat is the Wet status, the arena's
  // braziers dry it, and phase 2 turns it into the douser the player
  // learned to intercept one stage back. No stat multiplier anywhere — the
  // discrimination below is the matrix, priced by cadence and composition.

  it("the curriculum pilot kills it and LIVES — through the matrix, by either lane", () => {
    expect(
      direct.stageClearedAt[BOSS_STAGE],
      "the taught play could not close the chapter",
    ).toBeGreaterThan(0);
    expect(direct.survived, "the boss killed the compliant pilot — fairness broke").toBe(true);
    // The fight has two taught answers and which one a run takes is
    // emergent: burning stuck = the dried lane (bowls lit, coat off); a
    // shocked boss = the conductor lane (the wet-read pilot sparking the
    // coat). One of them MUST have carried the kill — a kill with neither
    // would mean raw damage sufficed and the recombination is decorative.
    // The controlled dried-window proof lives in rt.test.ts, where the coat
    // is isolated from stray pools.
    expect(
      Math.max(direct.bossBurnedAt, direct.bossShockedAt),
      "neither burning nor shock ever touched the boss — the kill was raw damage",
    ).toBeGreaterThan(0);
  });

  it("phase two turns it against the bowls — the douser walk, observed at boss scale", () => {
    expect(direct.bossPhaseAt, "the phase never turned").toBeGreaterThan(0);
    expect(
      direct.bossDousedAt,
      "the boss never doused a bowl — phase 2's threat is fiction",
    ).toBeGreaterThanOrEqual(direct.bossPhaseAt);
  });

  it("a pilot that refuses the matrix cannot end it — having earned the whole road", () => {
    // noMatrix is direct to the letter through eleven stages (premise: it
    // arrives with the chapter cleared behind it), then feeds the boss raw
    // spore. The refusal terminus is usually its death; either way the boss
    // stands.
    const r = noMatrix.refusal;
    expect(r, "noMatrix never established its refusal — no failure to measure").toBeTruthy();
    expect(
      r!.stageClearedAt[BOSS_STAGE - 1],
      "noMatrix never reached the boss — the stall is not about the matrix",
    ).toBeGreaterThan(0);
    expect(r!.bossAlive, "the boss was already dead at refusal — spore sufficed").toBe(true);
    expect(
      r!.stageClearedAt[BOSS_STAGE],
      "the matrix-refusing pilot closed the chapter — the recombination is decorative",
    ).toBe(-1);
  });

  it("…and the refusal state is still alive: the seam retries, the taught play finishes it", () => {
    expect(
      noMatrix.stageClearedAt[BOSS_STAGE],
      "the refusal state could not be played out of — the boss is a trap",
    ).toBeGreaterThan(0);
    // comp's audit pin: when the refusal's terminus was the defeat seam, the
    // recovery must have EXERCISED it — a death that recovered without a
    // restart would mean the assertion measured a different mechanism.
    if (noMatrix.refusal!.downed) {
      expect(
        noMatrix.restarted,
        "died refusing, but the defeat seam was never exercised",
      ).toBe(true);
    }
  });
});

describe("combo discovery — M2's automated half", () => {
  /**
   * A bot mashing element pairs must discover a real spread of mixes in two
   * minutes of sim time. Runs on an ALL-UNLOCKED state (the discovery claim is
   * about the mix space, not the curriculum) and records through the same
   * `discover()` the shipped game uses.
   */
  it("a bot mashing pairs discovers at least 20 of the 27 mixes in two minutes", () => {
    const w = createSimWorld({ seed: SEED, waterLevel: WATER });
    const s = createRtState(SEED); // all six, queue of 2 — the full mix space
    const save = defaultCampaign();
    const els: Element[] = ["water", "fire", "frost", "lightning", "oil", "spore"];
    let k = 0;
    for (let t = 0; t < 120 * TICK_HZ; t++) {
      const cmds: RtCommand[] = [];
      if (t % 20 === 0 && !s.hero.casting && s.hero.castTicks === 0) {
        const a = els[k % els.length]!;
        const b = els[Math.floor(k / els.length) % els.length]!;
        k++;
        cmds.push({ type: "queue", element: a });
        cmds.push({ type: "queue", element: b });
        cmds.push({ type: "cast", form: "aimed", aimX: s.hero.x, aimZ: s.hero.z + 9 });
        discover(save, [a, b]);
      }
      rtStep(w, s, cmds);
    }
    const found = discoveredCount(save);
    console.log(`[combo-discovery] ${found} of 27 mixes in 120 s`);
    expect(found).toBeGreaterThanOrEqual(20);
  });
});
