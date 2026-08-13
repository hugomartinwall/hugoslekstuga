import type {
  AbilityCharges,
  FactionCfg,
  Faction,
  GameState,
  LevelCfg,
  Node,
  NodeKind,
  NodeSize,
  Persona,
  Rng,
  ScriptedOpening,
} from "./state";
import {
  KIND_BEACON,
  KIND_CORRUPTER,
  KIND_FACTORY,
  KIND_FORTRESS,
  KIND_NURSERY,
  KIND_RELAY,
  KIND_RIFT,
  KIND_SIPHON,
  KIND_STANDARD,
  KIND_TURRET,
  KIND_VAULT,
  KIND_VOLATILE,
  NEUTRAL,
  PLAYER,
  rngNext,
  WORLD_H,
  WORLD_W,
} from "./state";
import {
  MAP_MARGIN,
  MAP_MARGIN_3WAY,
  MIN_SPACING,
  MIN_SPACING_3WAY,
  NODE_R,
  PROD_INTERVAL,
  UPGRADE_COST,
  UPGRADE_TICKS,
  specialChance,
} from "./constants";
import { AMBER, CRIMSON, MAX_TIER, VIOLET, WARDEN } from "./ai";
import { authoredBoardFor, createAuthoredLevel } from "./authored";
import type { Objective, ObjectiveType } from "./state";

/**
 * Procedural level generation.
 *
 * Two independent inputs, and keeping them independent is the whole design:
 *
 *   - the LEVEL NUMBER picks the difficulty, via `levelParams`;
 *   - the SEED picks the board, via the generators below.
 *
 * This used to be one input. `createLevel` derived its seed from the level
 * number, so a level number named exactly one board, forever — which made a
 * retry replay a board the player had already seen and could learn. That is a
 * real benefit and it is why `defaultSeedFor` still exists and is still the
 * default. But it also meant a player who could not beat one particular board
 * could not get past it by any route at all, and the checkpoint floor sends
 * them straight back to it. Measured, that is not hypothetical: at fixed
 * difficulty the seed alone swings a board between unwinnable and comfortable.
 *
 * So the seed is a parameter. `screenLevel` in ./screen.ts uses that to draw a
 * board that has been *verified* winnable before the player is shown it.
 *
 * Fairness by construction is unchanged: every faction's view of the board is
 * congruent — mirror symmetry for duels, Klein-group reflections for 4-way,
 * true 120° rotation inside the centered disc for 3-way.
 */

/* -------------------------------------------------------- meta-progression */

/** Permanent player boosts folded into the level at creation. */
export interface PlayerBoosts {
  startUnits: number;
  prodInterval: readonly [number, number, number];
  upgradeCost: readonly [number, number];
  upgradeTicks: number;
  /**
   * Ability charges granted per level (tier = charges). Absent = none, and
   * absent keeps the built state byte-identical to pre-ability builds —
   * cfg.abilities stays unset, so hashState mixes nothing new. Like every
   * other boost these only STRENGTHEN the player, so screened boards stay
   * verified (see main.ts boardFor).
   */
  abilities?: AbilityCharges;
}

export const DEFAULT_BOOSTS: PlayerBoosts = {
  startUnits: 0,
  prodInterval: PROD_INTERVAL,
  upgradeCost: UPGRADE_COST,
  upgradeTicks: UPGRADE_TICKS,
};

/* ----------------------------------------------------------- boss levels */

/**
 * Every sixth level from L14 is a boss level: a normal, fully symmetric board
 * — same generator, same fairness guarantees — that debuts one new node kind
 * prominently and hands one named rival a tier the others don't have.
 *
 * Symmetric on purpose. The alternative considered was a fortified asymmetric
 * rival, which would have broken the congruence assertions the whole mapgen is
 * built to satisfy for a difficulty spike that AI tiers deliver anyway.
 *
 * Order is legibility-first, not power-first. Relay is a pure speed buff you
 * feel on your first send; Volatile announces itself with a blast. Siphon ticks
 * damage whether or not you engage, which makes it the hardest to read and the
 * likeliest to move balance, so it lands fourth — after the player is fluent.
 *
 * Every one of these levels is a 4-way board with a contested centre, because
 * factionsForLevel's [4,3,4,2] cycle happens to return 4 at all eight and
 * (nodeCount - 4) % 4 === 1 at each. That is a happy accident worth naming:
 * the fixed point of the Klein group is a free, perfectly symmetric slot to
 * debut a kind in, and bosses reading as the full-cast set-piece is a feature.
 *
 * The schedule and the AI tier curve are coupled and must stay that way: a boss
 * rival fights one tier above its board, so `aiTier` has to stay below MAX_TIER
 * until after the LAST entry here. Adding a ninth kind means extending that
 * curve too, and `tiers.test.ts` fails if it is forgotten.
 */
export const FIRST_BOSS_LEVEL = 14;
export const BOSS_EVERY = 6;
export const BOSS_KINDS: readonly NodeKind[] = [
  KIND_RELAY, // L14 — debut
  KIND_VOLATILE, // L20 — debut
  KIND_BEACON, // L26 — debut
  // From L32 on, the boss kind is FEATURED rather than debuting: the kind
  // compression pass (KIND_DEBUTS below) hands every remaining kind a non-boss
  // debut by L29, so a 60-level game stopped hiding a third of its content
  // behind L38+. The boss set piece keeps its meaning — applyScriptedKinds
  // still saturates the board with the featured kind and the named rival still
  // fights a tier up — it just features a mechanic the player has already met,
  // the way L23's ALL FACTORIES twist features factories.
  KIND_SIPHON, // L32 — featured (debuts L24)
  KIND_VAULT, // L38 — featured (debuts L21)
  KIND_NURSERY, // L44 — featured (debuts L18)
  // The last two are read against kinds the player already knows: a corrupter
  // is the turret that keeps what it hits, and a rift is a relay that has
  // stopped pretending distance matters.
  KIND_CORRUPTER, // L50 — featured (debuts L27)
  KIND_RIFT, // L56 — featured (debuts L29)
];

/** The kinds mapgen may roll at level L, in a stable order. */
const BASE_KINDS: readonly NodeKind[] = [KIND_FACTORY, KIND_FORTRESS, KIND_TURRET];

/**
 * Every special kind's true debut level, in debut order — the single table
 * behind kindsUnlockedAt. Boss levels contribute the L14/L20/L26 rows; the
 * rest are NON-BOSS debuts added by the kind-compression pass so all 12 kinds
 * (these 8, the 3 base kinds, plus standard) are genuinely on the board by
 * L29 instead of L56. Each non-boss debut is staged by applyScriptedKinds
 * (one hand-placed orbit, RNG-free) and announced by introNoteForLevel.
 *
 * Ordering rationale for the inserts: NURSERY first (it is the most legible —
 * a number that visibly climbs), VAULT next as a pure economy read, SIPHON
 * last of the three mid inserts because it ticks damage whether or not you
 * engage (the same reasoning that put it fourth in the old boss order), then
 * the two comparative kinds close the set at L27/L29.
 */
export const KIND_DEBUTS: ReadonlyArray<readonly [number, NodeKind]> = [
  [14, KIND_RELAY], // boss debut
  [18, KIND_NURSERY], // non-boss debut
  [20, KIND_VOLATILE], // boss debut
  [21, KIND_VAULT], // non-boss debut (featured later by the L38 boss)
  [24, KIND_SIPHON], // non-boss debut (featured later by the L32 boss)
  [26, KIND_BEACON], // boss debut
  [27, KIND_CORRUPTER], // non-boss debut (featured later by the L50 boss)
  [29, KIND_RIFT], // non-boss debut (featured later by the L56 boss)
];

/** The non-boss debut staged on level L, if any (applyScriptedKinds reads it). */
const NON_BOSS_DEBUTS: Readonly<Record<number, NodeKind>> = {
  18: KIND_NURSERY,
  21: KIND_VAULT,
  24: KIND_SIPHON,
  27: KIND_CORRUPTER,
  29: KIND_RIFT,
};

/**
 * One-line intro-card announcement for levels that change the game's SHAPE.
 *
 * The two biggest structural events in the schedule — the first 4-way and the
 * first 3-way — used to pass without a word: a player met three rivals at once
 * with no framing at all. Boss levels already announce themselves (the NEW ·
 * KIND lines); this covers the topology debuts, and the twist levels extend it.
 *
 * Lives here rather than in the renderer because it is a statement about the
 * SCHEDULE (factionsForLevel), and the two must move together.
 */
export function introNoteForLevel(L: number): string | null {
  const authored = authoredBoardFor(L);
  if (authored) return authored.intro;
  if (L === 7) return "FIRST BIG MAP — DRAG TO LOOK AROUND";
  if (L === 9) return "FIRST 4-WAY BATTLE";
  if (L === 12) return "FIRST 3-WAY WAR";
  const twist = TWIST_LEVELS[L];
  if (twist) return `TWIST · ${twist}`;
  // Non-boss kind debuts announce themselves the way boss debuts do (the
  // renderer's NEW · KIND card covers bosses; these cover the compression
  // pass's inserts). One line, mechanic first — objective teach text stays
  // out of the intro note entirely: the HUD's objective banner owns it, and
  // two competing instructions on one card teach neither.
  const debutNote: Record<number, string> = {
    18: "NEW · NURSERY — GROWS WHILE UNCLAIMED",
    21: "NEW · VAULT — HOLDS FAR MORE, FILLS SLOWLY",
    24: "NEW · SIPHON — DRAINS THE NEAREST RIVAL",
    27: "NEW · CORRUPTER — STEALS PASSING UNITS",
    29: "NEW · RIFT — RIFT PAIRS SEND INSTANTLY",
  };
  return debutNote[L] ?? null;
}

export function isBossLevel(L: number): boolean {
  if (L < FIRST_BOSS_LEVEL) return false;
  const i = (L - FIRST_BOSS_LEVEL) / BOSS_EVERY;
  return Number.isInteger(i) && i < BOSS_KINDS.length;
}

/** The kind debuting on level L, or null if L is not a boss level. */
export function bossKindForLevel(L: number): NodeKind | null {
  if (!isBossLevel(L)) return null;
  return BOSS_KINDS[(L - FIRST_BOSS_LEVEL) / BOSS_EVERY]!;
}

/**
 * Kinds available to the random neutral roll at level L: the three originals,
 * plus every kind whose debut (boss or non-boss — KIND_DEBUTS is the one
 * table) has already happened. A kind the player has never been introduced to
 * never appears unannounced. Full pool (11 kinds + standard) from L29.
 *
 * Pool ORDER is debut order and is stable within a level, which is all
 * rollKind needs; the L<14 boards are untouched because every KIND_DEBUTS
 * entry is ≥ 14 (rollKind's pre-boss branch never reads this).
 */
export function kindsUnlockedAt(L: number): readonly NodeKind[] {
  const out: NodeKind[] = [...BASE_KINDS];
  for (const [debut, kind] of KIND_DEBUTS) if (L >= debut) out.push(kind);
  return out;
}

/* ------------------------------------------------------------- difficulty */

// `seed` is omitted deliberately: these are the DIFFICULTY knobs, and the seed
// is the one input to a board that difficulty must not depend on. Keeping it
// out of LevelParams is what stops a future knob being derived from it.
interface LevelParams
  extends Omit<
    LevelCfg,
    "ais" | "playerProdInterval" | "playerUpgradeCost" | "playerUpgradeTicks" | "seed"
  > {
  nodeCount: number;
  neutralLo: number;
  neutralHi: number;
  playerStart: number;
  enemyStart: number;
  /** Board half-extents about the fixed centre. Required here (cfg's are optional). */
  worldHx: number;
  worldHy: number;
}

/**
 * Board size bands: the fight's SCALE finally escalates. The teaching band
 * stays the classic one-screen 160×90 (frozen boards, conversion funnel);
 * L7 debuts the first scrolling board; bosses and the L30 capstone are the
 * set-piece 2×. The camera's play zoom owns tap-target legibility at every
 * size — spacing never changes, so no node kind's range needs re-tuning.
 *
 * Topology caps the band, and that was measured, not felt. With packets at
 * proportional speed, a 26-node 2× BOSS quad screens at 11/12 competent
 * probes — politics (the anti-snowball gang-up, rivals brawling each other)
 * gives a vast field its texture. A 1.8× DUEL screens at 0-2/12 even with
 * front-scaled probes: an 18-node 1v1 is a pure macro race, which is the
 * focus-firing, kill-layer-every-tick AI's best game and the player's
 * worst. Big scale belongs to the full-cast spectacles; duels and triads
 * stop at 1.4×.
 *
 * Banded by the TRUE level (board identity), not the triad-capped difficulty
 * level — a late triad earns its big board even though its knobs are capped.
 */
export function worldScaleForLevel(level: number): number {
  if (level <= 6) return 1;
  const cap = factionsForLevel(level) >= 4 ? 2 : 1.4;
  const band = isBossLevel(level) || level === 30 ? 2 : level <= 13 ? 1.4 : 1.8;
  return Math.min(cap, band);
}

/** See the neutralLo/Hi note in levelParams — the early-band wealth discount. */
function wealthDivisor(level: number): number {
  const s = Math.min(1.6, worldScaleForLevel(level));
  return 1 + (s - 1) * Math.max(0, Math.min(1, (16 - level) / 3));
}

/**
 * How many factions (incl. the player) fight on level L.
 *
 * The 3-way board is the hardest topology in the game by a wide margin, and not
 * by design — by geometry. True 120° rotation needs a disc, a disc in a 160×90
 * world is bounded by the SHORT axis, so triads get `DISC_R = 35`: **27% of the
 * board** against 68% for every other topology. At MIN_SPACING_3WAY that fits
 * exactly 7 nodes — 3 starts, one orbit of 3, one contested centre — which is
 * **4 neutrals shared between 3 factions**.
 *
 * Measured over levels ≥57, where every difficulty knob has saturated so the
 * topology is the only variable left:
 *
 *     topology   nodes   neutrals/faction   median win rate   unwinnable
 *     2-way          9         3.50               50%            0 / 21
 *     4-way         13         2.25               19%            8 / 42
 *     3-way          7         1.33                0%           12 / 21
 *
 * Twelve of twenty-one triads could not be won by any of 108 reference-bot
 * policies. This schedule used to debut that topology at **level 6** and then
 * serve it one level in four. Level 6 is exactly where players reported getting
 * stuck, and CLAUDE.md §6 names the first minute as the metric most likely to
 * sink the submission.
 *
 * So: onboarding is duels, each topology debuts alone with quiet levels around
 * it, and triads are occasional rather than routine.
 *
 * The rotation is SEVEN long on purpose. Boss levels arrive every 6 from L14, so
 * a period of 4 or 6 would lock every boss onto one topology forever — at
 * length 4 the old schedule put a 4-way under every single boss. Seven is
 * coprime with six, so bosses walk through all three… which turned out to be
 * the wrong thing to want:
 *
 * **Boss levels force 4-way.** The coprime walk quietly made half the set
 * pieces 1v1s — VOLATILE, SIPHON and CORRUPTER debuted on duels, and the L38
 * VAULT boss landed on a TRIAD, whose difficulty vector is frozen at
 * TRIAD_LEVEL_CAP and whose four neutrals ALL became vaults. A boss level
 * exists to be the full-cast spectacle (that is what BOSS_KINDS' design note
 * always promised); the rotation now provides variety BETWEEN bosses and the
 * bosses themselves stay the biggest board in the game. The rotation still
 * walks for non-boss levels, and the forced 4-ways replace whatever the walk
 * would have served — no reindexing, so every non-boss level keeps its
 * topology (and its screened board) byte-identical.
 */
export function factionsForLevel(L: number): number {
  if (L <= 8) return 2; // onboarding and teaching stay duels
  if (L === 9) return 4; // the 4-way debuts alone...
  if (L <= 11) return 2; // ...with duels either side to breathe
  if (L === 12) return 3; // the 3-way debuts alone, and late enough to survive it
  if (L === 13) return 2;
  if (isBossLevel(L)) return 4; // set pieces are always the full cast
  return [4, 2, 4, 3, 2, 4, 2][(L - 14) % 7]!;
}

/** Persona casting per level — variety and drama, per the design table. */
export function personasForLevel(L: number): Persona[] {
  // Sized to factionsForLevel — one persona per rival. createLevel falls back to
  // personas[0] for any rival this table is short of, so a mismatch degrades
  // quietly into a level where two rivals share a personality; keeping the two
  // tables in step is what stops that.
  const CAST: Record<number, Persona[]> = {
    6: [CRIMSON], // the teaching duels get personalities before they get company
    7: [AMBER], // amber turtles, which is what shows off the turret debut
    8: [CRIMSON],
    9: [CRIMSON, AMBER, VIOLET], // full-cast 4-way poster level
    10: [VIOLET],
    11: [CRIMSON],
    12: [AMBER, VIOLET], // gentlest possible 3-way intro
    13: [CRIMSON],
    14: [AMBER, AMBER, VIOLET],
    15: [AMBER],
    16: [CRIMSON, CRIMSON, AMBER],
    17: [CRIMSON, AMBER], // crimson grabs the turret and shreds amber on camera
    18: [VIOLET],
    // L19 is a HOLD level and faction 2 is the hill-keeper: on a Klein board
    // all four homes are equidistant from the centre hill, so "the faction
    // whose home is nearest the hill" resolves by the lowest-id tie-break to
    // faction 2 — the WARDEN digs in on the hill while the violets brawl.
    19: [WARDEN, VIOLET, VIOLET],
    20: [CRIMSON, AMBER, VIOLET], // boss levels are 4-way set pieces now
    26: [VIOLET, CRIMSON, AMBER],
    21: [CRIMSON, AMBER, VIOLET],
    22: [AMBER],
    23: [AMBER, VIOLET, VIOLET],
    24: [VIOLET, VIOLET],
    25: [CRIMSON],
  };
  if (CAST[L]) return CAST[L]!;
  const k = factionsForLevel(L);
  const pool = [CRIMSON, AMBER, VIOLET];
  // HOLD levels cast the WARDEN as faction 2 — the hill-keeper slot (its home
  // ties nearest the hill on every symmetric topology; ties break to the
  // lowest faction id, exactly as L19's hand cast documents).
  const hold = objectiveTypeForLevel(L) === "hold";
  if (k === 2) {
    // Late duels used to fall back to BALANCED — a personality-free rival on
    // every second late level. A deterministic single-persona rotation gives
    // each one an identity instead; hold duels get the WARDEN, since the sole
    // rival IS the hill contest.
    return [hold ? WARDEN : pool[L % 3]!];
  }
  // Deterministic rotation for 26+ multi-faction boards.
  const out: Persona[] = [];
  for (let i = 0; i < k - 1; i++) out.push(pool[(L + i) % 3]!);
  if (hold) out[0] = WARDEN;
  return out;
}

/* -------------------------------------------------------------- objectives */

/**
 * Which objective archetype level L plays — the schedule's TYPE column.
 * `null` is annihilation, the game's home key.
 *
 * Ground rules, each load-bearing:
 *  - L1–5 are the frozen teaching band: no objective, ever. The conversion
 *    funnel is one rule ("take everything") taught five times.
 *  - Bosses and twists stay annihilation — they are already a set piece, and
 *    stacking a second gimmick on them teaches neither.
 *  - The hand-authored band (L6–25) maps archetypes onto the EXISTING
 *    topology schedule (factionsForLevel is untouched — the triad windows and
 *    boss cast depend on it): crown/hold/outlast debut on duels where one
 *    rival keeps the story legible, claim debuts on the L16 4-way where a
 *    quota race against three rivals is actually a race.
 *  - From L27 a fixed 6-rotation takes over. The rotation is indexed by the
 *    raw level, and its two annihilation slots are placed so that one of them
 *    ((L−27) % 6 === 5) absorbs every boss level — bosses fall at L ≡ 2
 *    (mod 6), i.e. exactly that slot. The spec's original ordering put
 *    OUTLAST there, which would have deleted outlast from the entire post-L25
 *    game; rotating the list costs nothing and keeps all four archetypes in
 *    circulation. Measured over L27–60: 41% annihilation (14/34), crown ×6,
 *    hold ×6, outlast ×5, claim ×3 — inside the 40–50% annihilation target.
 *  - `claim` only lands on 4-way boards (a quota race needs a crowd); on any
 *    other topology its slot plays annihilation. With the current topology
 *    cycle that yields claim at L30/42/54.
 */
export function objectiveTypeForLevel(L: number): ObjectiveType | null {
  if (L <= 5) return null; // frozen teaching band
  if (isBossLevel(L) || TWIST_LEVELS[L]) return null; // set pieces stay annihilation
  const AUTHORED: Record<number, ObjectiveType> = {
    6: "crown", // decapitation debut: one duel, one marked home each
    8: "hold", // the first big-map duel gets a centrepiece to fight over
    11: "outlast", // the siege: relentless rival, the timer is the exit
    16: "claim", // 4-way land race
    19: "hold", // 4-way king-of-the-hill, WARDEN keeps it
    22: "crown", // mirror assassination — both crowns exposed
    25: "outlast", // the long siege before the L26 boss
  };
  if (L < 27) return AUTHORED[L] ?? null;
  // [crown, annihilation, hold, claim*, outlast, annihilation] — see above.
  const ROTATION: ReadonlyArray<ObjectiveType | null> = [
    "crown",
    null,
    "hold",
    "claim",
    "outlast",
    null, // the slot every boss level lands on
  ];
  const slot = ROTATION[(L - 27) % 6]!;
  if (slot === "claim" && factionsForLevel(L) !== 4) return null;
  return slot;
}

/**
 * Resolve the level's objective against the GENERATED board: target node ids
 * depend on where mapgen put things, so this must run post-generation, inside
 * createLevel — after applyScriptedKinds and the twist mutator, so screening
 * probes play exactly the dressed board the player gets.
 *
 * Consumes ZERO RNG draws (all selection is node-id/geometry-deterministic),
 * so adding or retuning an objective can never re-roll any other level's
 * board — the same contract applyScriptedKinds and TWIST_LEVELS honour.
 * Board dressing (garrison bumps, the hill's fortress kind) lives here too,
 * for the same reason the twists live inside createLevel: a dressed board
 * that screening never saw could ship unwinnable.
 */
function applyObjective(nodes: Node[], level: number): Objective | undefined {
  const type = objectiveTypeForLevel(level);
  if (!type) return undefined;

  switch (type) {
    case "crown": {
      // Faction 2's home is the marked crown, the player's home is theirs.
      // Home nodes, not arbitrary picks: both already read as "the seat".
      const rival = nodes.find((n) => n.owner === 2)!;
      const own = nodes.find((n) => n.owner === PLAYER)!;
      // A small standing garrison bump so the crown reads DEFENDED from the
      // first glance (tryGarrisonObjective handles live defence). L22 skips
      // it by design — the mirror assassination wants both crowns exposed.
      if (level !== 22) rival.units += 4;
      return { type, targetNodeId: rival.id, playerCrownId: own.id };
    }
    case "hold": {
      // The hill is the NEUTRAL node nearest the world centre; ties break to
      // the lowest id (strict < over ascending ids). Neutral-only so a
      // degenerate roll can never crown a faction's home as the hill.
      let hill: Node | null = null;
      let best = Infinity;
      for (const n of nodes) {
        if (n.owner !== NEUTRAL) continue;
        const d = Math.hypot(n.x - CX, n.y - CY);
        if (d < best) {
          best = d;
          hill = n;
        }
      }
      if (!hill) return undefined; // no neutral at all — degenerate board, play it straight
      // Defensive centrepiece: a plain hill becomes a fortress. Deliberately
      // the single node rather than its orbit — the hill is already the one
      // asymmetric thing on the board (only the player's ring fills), and its
      // armor is part of what makes holding it feel like holding something.
      if (hill.kind === KIND_STANDARD) hill.kind = KIND_FORTRESS;
      // 600 ticks (20 s) for the L8 teach, 900 (30 s) from L19 on.
      return { type, targetNodeId: hill.id, requiredTicks: level === 8 ? 600 : 900 };
    }
    case "outlast": {
      // L11 is the authored siege: every rival node starts +40% heavy, so the
      // board READS as unwinnable-by-force and the timer reads as the exit
      // (annihilation stays a win path for the player who breaks the siege
      // anyway).
      //
      // The bump was specified at +60% and backed off on measurement: a 60 s
      // timer compresses the difficulty band (everyone who survives wins), so
      // the floor and ceiling sit close together. At 1.6, ~1 in 3 retry
      // seed-streams exhausted the 32-candidate screen below the 5/12 floor
      // (attempts 2/3 fell back at 3-4/12); at 1.5 one stream still fell
      // back; at 1.4 attempts 0-9 all accept while the careless ceiling
      // holds (≤2/3 on every stream) — the scripted opening at 2 s is what
      // keeps punishing careless play, measured: softening IT to 0.35
      // instead let 3/3 careless probes survive the timer.
      //
      // The rotated late outlasts skip the bump entirely — their AI tiers
      // already carry the pressure.
      if (level === 11) {
        for (const n of nodes) {
          if (n.owner !== NEUTRAL && n.owner !== PLAYER) n.units = Math.round(n.units * 1.4);
        }
      }
      // 1800 ticks (60 s) as the standard siege; L25's pre-boss siege runs
      // 2400 (80 s) — long enough that sitting still is not a plan.
      return { type, requiredTicks: level === 25 ? 2400 : 1800 };
    }
    case "claim": {
      // Quota: just over half the board, simultaneously. ceil(n·0.55) puts
      // L16's 25-node board at 14 — measured winnable-but-racy (screen finds
      // an in-band board; see schedule.test.ts).
      return { type, quota: Math.ceil(nodes.length * 0.55) };
    }
    case "gauntlet":
      // Gauntlets are authored boards (dailies/specials), never scheduled.
      return undefined;
  }
}

/**
 * Difficulty ceiling for 3-way boards.
 *
 * A triad stops getting harder past this level. That is a compensation for a
 * structural deficit, not a mercy: the 3-way board is 7 nodes inside a disc
 * that is 27% of the world — 4 neutrals shared between 3 factions, against 7
 * for 2 factions on a duel — and no knob in this file can widen it.
 *
 * Measured, and this is what forced it. Sampling 60 candidate boards per level
 * and scoring each with 12 reference policies, mean wins out of 12:
 *
 *     duels   L20 5.7   L27 5.4
 *     quads   L19 3.4   L26 5.5   L33 2.7
 *     triads  L12 0.5   L17 1.3   L24 1.3   L31 0.3   L38 0.8   L45 0.8   L52 0.2
 *
 * At L31 and L52 *not one* of 60 boards reached 5 of 12. Good late triad boards
 * do not exist to be found, so screening harder only spends time discovering
 * that — which is why `screenLevel` gives triads a lower band, and why the fix
 * has to be here, in the supply.
 *
 * A systematic cap rather than knob-by-knob tuning, deliberately: single-lever
 * sweeps on this topology are chaotic. Cutting `enemyStart` on a duel took L27
 * from 100% to 0%, and the response was non-monotonic in every direction — the
 * boards are knife-edge, so one number moved reshuffles the whole game tree.
 * Freezing the whole difficulty vector at a level that measurably works is the
 * only move that behaves predictably.
 */
export const TRIAD_LEVEL_CAP = 20;

/**
 * Difficulty FLOOR for 3-way boards — the other end of the same window.
 *
 * `playerStart` is pinned at 10 through L16 while `neutralLo` climbs to 15, so
 * L12 and L16 have no affordable opening move at all: the cheapest neutral on
 * the board costs more than the player is holding. That is precisely the defect
 * that made level 6 a wall, one band later, and the pin is a deliberate,
 * documented choice for duels (see `playerStart` below) that a triad cannot
 * absorb — with only two distinct neutral prices on a 7-node board, "nothing is
 * affordable" has no second reading.
 *
 * L12 is the only triad below this floor, so this moves exactly one level. It
 * reads backwards — the DEBUT gets a later level's knobs, including a higher AI
 * tier — but the trade is +7 starting units against +1 tier, and the boards it
 * produces are measurably better: mean wins over 60 candidates 0.5 -> 1.1, and
 * the share reaching 3 of 12 goes 3% -> 10%. That is what took the screen's last
 * best-of fallback (L12 on a retry) to zero across L1-60.
 *
 * Left alone for duels and quads, where the pin still buys what it was measured
 * to buy: careless play punished in the band that has to clear the conversion
 * funnel.
 */
export const TRIAD_LEVEL_FLOOR = 17;

/** L1–5 are hand-tuned for onboarding; formulas take over from L6. */
export function levelParams(level: number): LevelParams {
  const factionCount = factionsForLevel(level);
  // The DIFFICULTY level, which is the real level everywhere except on triads.
  // `factionCount` is read from the true level first — capping before that would
  // turn a late triad into a duel.
  const L =
    factionCount === 3
      ? Math.min(TRIAD_LEVEL_CAP, Math.max(TRIAD_LEVEL_FLOOR, level))
      : level;
  // Hand-tuned through L5, not L3. The formula's aiFirstMoveTick drops to 90
  // ticks at L4 and 60 at L5, so the AI's opening attack went 8 s → 3 s → 2 s
  // across the teaching levels — a cliff right where the game is still showing
  // the player what a factory and a fortress are. The greedy balance bot lost
  // L5 in 45 s; a first-time player has no chance at all.
  //
  // The node counts here were lowered again in Phase 3A. Phase 1 had raised
  // them because "five nodes in a 160×90 field looks like a diagram" — true at
  // the old radii, but the nodes are now ~49% wider, so five of them fill the
  // opening screen better than seven small ones ever did. They also have to
  // come down: at MIN_SPACING = 20 the sampler cannot place 11 or 13 in a
  // duel's rect, and over-asking silently produces crowded, demoted nodes.
  const tuned: Record<number, Partial<LevelParams>> = {
    // L1/L2 also slow the AI's *expansion*, not just its first move. A denser
    // board gives it more neutrals to snowball through, and the metric that
    // matters here is a confused first-timer still being alive at 60 s.
    //
    // aiMinUnits/aiOverkillMargin came down (18/10 → 10/4, 16/8 → 12/5) after
    // the second rejection: at the old values the L1 bot's first wakes always
    // failed the `wave > need` check — enemyStart 8 against a minimum commit
    // of 18 — so a passive opening was a bot standing MUTE for ninety seconds,
    // straight into the all-capped standoff. The scripted opening (OPENINGS)
    // gives it visible life at 8 s; these floors let the normal layer follow
    // through instead of vetoing every move it considers. Player-favored
    // margins (playerStart 20 vs enemyStart 8) are untouched — the conversion
    // funnel keeps its cushion, the bot just stops playing dead.
    // aiKillCertainty is raised where the margins came down: the finisher is
    // what actually ends a passive game, and at certainty 3.0 it assembled
    // enough force by ~66 s — inside seed variance of the 60 s cushion. 4.5 /
    // 3.8 buys the confused first-timer ~90 s of life while the cap-stall
    // nudge talks to them; a bot that visibly expands but doesn't execute the
    // helpless is exactly the L1 the conversion funnel wants.
    1: { nodeCount: 5, neutralLo: 2, neutralHi: 4, playerStart: 20, enemyStart: 8,
         aiFirstMoveTick: 450, aiIntervalTicks: 330, aiMinUnits: 10, aiOverkillMargin: 4,
         aiKillCertainty: 3.0 },
    2: { nodeCount: 7, neutralLo: 3, neutralHi: 6, playerStart: 15, enemyStart: 10,
         aiFirstMoveTick: 300, aiIntervalTicks: 255, aiMinUnits: 12, aiOverkillMargin: 5,
         aiKillCertainty: 3.8 },
    3: { nodeCount: 7, neutralLo: 4, neutralHi: 8, playerStart: 12, enemyStart: 12,
         aiFirstMoveTick: 240, aiIntervalTicks: 180, aiMinUnits: 12, aiOverkillMargin: 7 },
    4: { nodeCount: 9, neutralLo: 5, neutralHi: 10, playerStart: 12, enemyStart: 12,
         aiFirstMoveTick: 210, aiIntervalTicks: 165, aiMinUnits: 12, aiOverkillMargin: 6 },
    5: { nodeCount: 9, neutralLo: 6, neutralHi: 12, playerStart: 12, enemyStart: 12,
         aiFirstMoveTick: 180, aiIntervalTicks: 150, aiMinUnits: 11, aiOverkillMargin: 5 },
    // L7/L8 are the FIRST BIG MAP band — the novelty IS the scrolling board,
    // and it lands inside the reviewer's conversion window, so the opponent
    // eases off while the player learns to look around. Without these rows
    // the formula knobs (first move 1.5 s, margin 4) on a 14-node field
    // dropped careless play's early-band win rate from 57% to 14%.
    7: { aiFirstMoveTick: 270, aiIntervalTicks: 240, aiMinUnits: 11, aiOverkillMargin: 7,
         aiKillCertainty: 2.4 },
    8: { aiFirstMoveTick: 180, aiIntervalTicks: 170, aiMinUnits: 10, aiOverkillMargin: 5,
         aiKillCertainty: 2.4 },
    // L9 is the full-cast 4-way debut on a 20-node board — three rivals with
    // formula knobs opened at 1.5 s and a careless player was dead in six
    // seconds. The spectacle needs a beat to read before it starts swinging.
    9: { aiFirstMoveTick: 150, aiIntervalTicks: 150 },
    // L10 closes the gentle ramp out of the big-map band: at pure formula
    // knobs it was an 18-second slaughter sitting between two winnable
    // neighbours, and the early careless funnel (L6-12) fell under the 25%
    // conversion floor without it.
    10: { aiFirstMoveTick: 120, aiIntervalTicks: 140, aiMinUnits: 9, aiOverkillMargin: 4,
          aiKillCertainty: 2.2 },
    // The objective levels' knob rows (the objective TYPE lives in
    // objectiveTypeForLevel; these are the difficulty knobs that give each
    // archetype its intended texture). aiKillPlayerBias is the kill-layer
    // brake against the PLAYER specifically — above 1 the finisher/snipe
    // demands more certainty before executing them, which is what keeps a
    // siege survivable without making the AI passive.
    //
    // L11 OUTLAST: relentless cadence (wake at 1.5 s, every 2 s) against a
    // +40%-garrisoned rival (see applyObjective for the measured back-off
    // from the +60% draft) — the pressure is constant, but the 1.5 brake
    // keeps the kill layer from simply deleting the player before the 60 s
    // timer means anything.
    11: { aiFirstMoveTick: 45, aiIntervalTicks: 60, aiKillPlayerBias: 1.5 },
    // L16 CLAIM: the wake is pushed to 5 s (L9's 4-way-debut treatment) so the
    // land race READS as a race before the punches start; the scripted
    // openings at 60/90/120 keep the rivals visibly racing in that window.
    // Bias 0.8 makes the kill layer bolder against a player who over-extends
    // — a quota race where over-claiming is safe is not a race.
    16: { aiFirstMoveTick: 150, aiKillPlayerBias: 0.8 },
    // L22 CROWN: both crowns exposed (no garrison bump), so the mild 1.2
    // brake is what keeps the mirror assassination from being decided by
    // whichever kill layer blinks first — the player is meant to win the
    // race, not survive a coin flip.
    22: { aiKillPlayerBias: 1.2 },
    // L25 OUTLAST: the 80 s pre-boss siege. No garrison bump at this depth —
    // tier 6 pressure carries it — and the strongest brake in the schedule,
    // because 80 s is a long time to be one mistake from the finisher.
    25: { aiKillPlayerBias: 1.6 },
  };
  const base: LevelParams = {
    // The TRUE level, not the capped difficulty level: this is the board's
    // identity — biome, boss schedule, HUD label — and only the knobs below
    // read `L`.
    level,
    // Node budget, capped by what the sampler can actually place at
    // MIN_SPACING — not by a number picked for difficulty.
    //
    // This used to climb to 21 (15 on triads), which at the old 16 wu spacing
    // put node diameter at 27.5 CSS px on a phone against a 44 px tap target.
    // Raising NODE_R fixed the diameter; the spacing that has to come with it
    // is what caps the count. Measured capacity at MIN_SPACING = 23: duels
    // place 11, quads 13, triads 10 in their disc. Asking for more does not
    // fail loudly — `place()` returns its best effort and the crowding pass
    // demotes the losers — so over-asking silently produces a board of small
    // nodes, which is the exact failure we are removing.
    //
    // Difficulty past this point comes from node kinds, boss levels and AI
    // capability. See Phase 3A in the plan: a bigger screen was never going to
    // be the answer, so the board stops trying to grow.
    // Triads are capped hardest, and by geometry rather than by taste. Their
    // nodes live in a centred disc — 3-fold rotational symmetry does not fit
    // any other shape — whose radius is bounded by the world's SHORT axis, and
    // which must also stay inside the world so the camera's content box does
    // not crop it. That leaves room for exactly 7 at MIN_SPACING_3WAY: three
    // starts, one orbit of three, and the contested centre. Trying for 10 drops
    // the achieved gap to 16.6 wu, at which point the crowding pass demotes
    // almost every large node — the same 1.1%-large-nodes regression Phase 2.5
    // fixed, reintroduced from the other direction.
    // Quads are 13 from their debut — the ramp from 9 is gone.
    //
    // The knee used to sit at L14, and the note justifying it had already found
    // the defect without naming it: a 9-node quad "had exactly one non-centre
    // neutral orbit", which made L14 the EASIEST level in its band. The same
    // arithmetic says the harder thing. Four starts and a forced centre leave
    // 5 neutrals for 4 factions — 1.25 each, which is triad-grade starvation,
    // and neutrals-per-faction is the single strongest predictor of whether a
    // board can be won at all (measured: 1.33 -> 5%, 2.25 -> 21%, 3.50 -> 44%).
    //
    // At 13 the quad gets 9 neutrals, i.e. 2.25 each, which is the number that
    // measured 21%. 13 is also the sampler's measured capacity at MIN_SPACING,
    // so this asks for exactly what can be placed and no more.
    // Counts scale with the band's AREA headroom, still comfortably inside
    // the sampler's measured capacity at MIN_SPACING (capacity grows ~1.96×
    // at the 1.4 band, ~3.24× at 1.8). The one-screen counts are unchanged.
    nodeCount:
      factionCount === 3
        ? worldScaleForLevel(level) >= 1.8
          ? 13
          : worldScaleForLevel(level) >= 1.4
            ? 10
            : 7
        : factionCount === 4
          ? worldScaleForLevel(level) >= 1.8
            ? 26
            : worldScaleForLevel(level) >= 1.4
              ? 20
              : 13
          : worldScaleForLevel(level) >= 1.8
            ? 18
            : worldScaleForLevel(level) >= 1.4
              ? 14
              : Math.min(9, 5 + 2 * Math.floor((L - 1) / 3)),
    worldHx: (WORLD_W / 2) * worldScaleForLevel(level),
    worldHy: (WORLD_H / 2) * worldScaleForLevel(level),
    // Packets fly proportionally faster on big boards, so the felt tempo —
    // and every travel-time intuition the balance was built on — survives
    // the scale. Measured without it: 0-2 of 12 competent probes win a 1.8×
    // board; the game collapses into growth-during-travel turtling.
    packetSpeedMul: worldScaleForLevel(level),
    /**
     * Neutral garrison, ramped OUT of the hand-tuned L5 values rather than
     * resuming at whatever the formula happens to say there.
     *
     * This was `min(15, 4+L)` / `min(30, 8+2L)`, which at L6 is 10-20 against
     * L5's tuned 6-12 — a 67% jump in what a node costs, landing on the same
     * level as the 3-way debut, on a board with only four neutrals, while
     * `playerStart` DROPS from 12 to 10. A player holding 10 units could not
     * afford a single node on the board. The competent bot scored 3% on L6
     * against 69% on L5.
     *
     * Same shape of defect Phase 1 fixed for `aiFirstMoveTick` and in the same
     * place: the tuned table ends at L5 and the formula picks up from a value
     * it was never continuous with. Ramping reaches the same 15/30 caps at L14
     * instead of L11 — the late game does not move at all, measured.
     *
     * Ablation is what found this. Of the six things that step at L5->L6, the
     * neutral cost is the one carrying the cliff: ramping the AI's opening
     * attack out of its 6.0s -> 1.5s jump made L6 *worse*, not better.
     */
    // Big-board neutral wealth, and it cuts BOTH ways — measured twice:
    // full-price neutrals on the early 1.4× boards carry ~2× the classic
    // mass, expansion starves, and the careless funnel collapses to 14%;
    // but CHEAP neutrals from L14 on hand the land-grab race to the tier-5+
    // AI (maxDecisions 4-6 fronts exploits a cheap field far better than any
    // careful player) and L14/L15 fell to 1/12 screens. So the discount
    // covers the teaching-adjacent band only and tapers out by L16, back to
    // the full-price regime the L14+ sweep measured healthy (5-11/12). The
    // 1.6 saturation keeps the per-node step between a 2× boss and its 1.4×
    // neighbours inside the knob-continuity bound.
    neutralLo: Math.max(
      2,
      Math.round(Math.min(15, L + 1) / wealthDivisor(level)),
    ),
    neutralHi: Math.max(
      4,
      Math.round(Math.min(30, 2 * L + 2) / wealthDivisor(level)),
    ),
    /**
     * Never below the cheapest neutral on the board, plus a margin.
     *
     * This was a flat 10 forever, while `neutralLo` reaches 15 at L11 — so from
     * L11 the player could not afford a single neutral on the board and their
     * home was the CHEAPEST node on it, which is what every rival's first wake
     * converged on. Combined with the enemyStart growth below that made L30-60
     * unwinnable rather than hard: a competent reference bot scored 0 wins in
     * 1,116 attempts, median time-to-loss 4 s.
     *
     * Capping the rival start alone does not fix it — it leaves the player with
     * no opening move, and 3-way boards (the tightest topology, 4 neutrals for
     * 3 factions) stayed a wall: 1 of 9 late triads solvable. Raising this to
     * neutralLo + 2 takes that to 6 of 9. Verified with a second, independent
     * agent — ai.ts itself driving the player slot — which agrees to within one
     * level on duels and triads.
     *
     * Still pinned at 10 through L16, and now that is a measured choice rather
     * than deferred work. Raising it there fixes nothing the neutral ramp above
     * has not already fixed, and it costs: the crude greedy bot's win rate over
     * L6-12 falls 43% -> 29%, i.e. careless play gets punished HARDER in the
     * one band that has to survive the conversion funnel. The player's opening
     * problem was what a node COSTS, not what they were holding.
     */
    playerStart: L <= 16 ? 10 : Math.min(17, 4 + L),
    /**
     * Pinned at 14 through L16 — that band is calibrated and must not move —
     * then grows to a 24 cap by L36.
     *
     * Deliberately a VISIBLE lever: a bigger number printed on the rival's home
     * node, not a hidden production multiplier the player can only infer from
     * losing.
     *
     * The cap came down from 26, but only to 24, and that number is a ceiling
     * as much as a floor. Capping harder (18, 20, 22 were all measured) hands
     * the late game to the CRUDE greedy bot — at 22 it wins 50% of L41-60
     * against 13% of L17-24, i.e. careless play gets punished LESS as levels
     * rise. Both bots have to be read together; reading only the competent one
     * is the same mistake that produced the original defect, one level up.
     *
     * L6-L8 are eased (12/13/13) because L6 is the 3-WAY DEBUT, and enemyStart
     * is per rival — so the player's opposition doubles from 12 to 28 units at
     * that boundary without any knob changing value. The same easing was tried
     * on `playerStart` instead and rejected: it helps the competent bot equally
     * and costs the crude one 14 points of win rate, which is the wrong side of
     * the conversion funnel to spend.
     */
    enemyStart:
      L >= 6 && L <= 8
        ? Math.round(14 - (2 * (9 - L)) / 3) // 12, 13, 13 across the 3-way debut
        : L <= 16
          ? Math.min(14, 10 + L)
          : Math.min(24, 14 + Math.floor((L - 16) / 2)),
    aiFirstMoveTick: Math.max(45, 210 - 30 * L),
    aiIntervalTicks: Math.max(45, 195 - 12 * L),
    aiMinUnits: Math.max(6, 16 - L),
    aiOverkillMargin: Math.max(2, Math.round(10 - 0.8 * L)),
    // Tiers 5+ are new capabilities, not faster reflexes — tier 4 already
    // checks for a kill every tick, so there was nothing left to accelerate.
    //
    // The top of this curve is set by the boss promotion, not by taste. A boss
    // rival fights one tier above its board, so the base tier must stay below
    // MAX_TIER for as long as boss levels keep arriving — otherwise
    // `min(MAX_TIER, aiTier + 1)` promotes nobody and the set piece has no
    // boss, which is exactly what L38 and L44 shipped as. The last boss is
    // L56, so the base reaches the ceiling at L57 and not before.
    // `bossTierIsAboveBase` in tiers.test.ts asserts this for every boss level
    // rather than trusting the two curves to stay in step by inspection.
    aiTier:
      L <= 3 ? 1
        : L <= 7 ? 2
          : L <= 12 ? 3
            : L <= 17 ? 4
              : L <= 24 ? 5
                : L <= 32 ? 6
                  : L <= 44 ? 7
                    : L <= 56 ? 8
                      : 9,
    aiKillCertainty: L <= 3 ? 3.0 : Math.max(1.25, 3.0 - 0.2 * (L - 3)),
    aiSendFraction: Math.min(0.85, 0.65 + 0.015 * Math.max(0, L - 3)),
    aiNeutralBonus: Math.max(6, 25 - 2 * Math.max(0, L - 3)),
    aiKillPlayerBias: 1.0,
    factionCount,
  };
  return { ...base, ...tuned[L] };
}

/* ---------------------------------------------------------------- geometry */

const CX = WORLD_W / 2;
const CY = WORLD_H / 2;

/**
 * Point-mirror about the fixed centre. Written in centre form (2·C − p, which
 * IS WORLD_W − p on the classic board) so it is extent-independent: bigger
 * boards extend around the same centre and reflect exactly the same way.
 */
function mirror(p: { x: number; y: number }): { x: number; y: number } {
  return { x: 2 * CX - p.x, y: 2 * CY - p.y };
}

function rotate(p: { x: number; y: number }, k: number, n: number): { x: number; y: number } {
  const a = (2 * Math.PI * k) / n;
  const dx = p.x - CX;
  const dy = p.y - CY;
  return {
    x: CX + dx * Math.cos(a) - dy * Math.sin(a),
    y: CY + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

/**
 * Nudge a sample out of a forbidden disc around the board centre, along the ray
 * from the centre.
 *
 * Every generator pushes its odd "contested centre" node last, at exactly
 * (CX, CY), without a place() check — so nothing stops an earlier seed from
 * landing on top of it. Each symmetry group also relates a seed's distance from
 * the centre to how far its own images sit from that node. Clamping the sample
 * is cheaper than rejection and consumes no extra draws, which keeps the RNG
 * sequence intact.
 */
function pushOutOfCenter(x: number, y: number, minGap: number): { x: number; y: number } {
  if (minGap <= 0) return { x, y };
  const dx = x - CX;
  const dy = y - CY;
  const d = Math.hypot(dx, dy);
  if (d >= minGap) return { x, y };
  if (d === 0) return { x: CX + minGap, y: CY };
  const k = minGap / d;
  return { x: CX + dx * k, y: CY + dy * k };
}

/**
 * Hard floor for the spacing relaxation below. Two large nodes have radii
 * summing to 15, so anything under this draws them physically overlapping and
 * makes their unit counts unreadable.
 */
const SPACING_FLOOR = NODE_R[2] * 2 + 1;

/**
 * Rejection-sample a point at least `spacing` from all placed nodes.
 *
 * The budget is generous because the densest boards are feasible but tight, and
 * giving up after 40 draws is what used to force the old relaxation path into
 * accepting overlapping nodes. Only samples that would previously have relaxed
 * are affected, so levels that never relaxed — including the frozen L1–5, which
 * consume 10–30 draws for the entire level — are byte-identical.
 *
 * If the budget is exhausted the roomiest candidate seen wins. Callers pass a
 * spacing at or above SPACING_FLOOR, so a fallback is genuinely a crowded board
 * rather than a soft failure, and `shrinkCrowdedNodes` cleans up after it.
 */
function place(
  placed: readonly { x: number; y: number }[],
  sample: () => { x: number; y: number },
  spacing: number,
): { x: number; y: number } {
  // No early-out on the first violation: the exact minimum is what ranks the
  // fallback candidates, and a truncated value would pick the wrong one.
  const clearance = (p: { x: number; y: number }) => {
    let m = Infinity;
    for (const q of placed) {
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < m) m = d;
    }
    return m;
  };

  let best = sample();
  let bestClearance = clearance(best);
  if (bestClearance >= spacing) return best;
  for (let attempt = 1; attempt < PLACE_ATTEMPTS; attempt++) {
    const p = sample();
    const c = clearance(p);
    if (c >= spacing) return p;
    // NaN-safe: a NaN clearance never wins, so `best` stays a real point.
    if (c > bestClearance) {
      bestClearance = c;
      best = p;
    }
  }
  return best;
}

/**
 * Sampling budget per node. Raised from 4000 in Phase 3A: at MIN_SPACING = 20
 * the rect and the triad disc are genuinely tight, so the hard seeds are the
 * ones that matter and 4000 draws left ~0.22% of pairs short of target. Easy
 * seeds still resolve in tens of draws — this only buys attempts where they
 * are actually needed, and createLevel runs once per level start.
 */
const PLACE_ATTEMPTS = 30000;

function rollSize(rng: Rng): NodeSize {
  const r = rngNext(rng);
  return r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
}

/**
 * Roll a neutral orbit's kind. Exactly two RNG draws when the gate passes, one
 * when it doesn't — the SAME counts as before this phase, which is what keeps
 * every board below the first boss level byte-identical. Changing the number of
 * draws here re-rolls every later level, so the pre-L14 branch is kept verbatim
 * rather than expressed as a special case of the general one: uniform thirds
 * (0.333/0.667) are not the historic 0.34/0.67, and a draw in that narrow band
 * would have quietly changed L9–L13.
 */
function rollKind(rng: Rng, level: number): NodeKind {
  if (level < 9) return KIND_STANDARD; // teaching levels hand-place kinds
  if (rngNext(rng) >= specialChance(level)) return KIND_STANDARD;
  const r = rngNext(rng);
  if (level < FIRST_BOSS_LEVEL) {
    return r < 0.34 ? KIND_FACTORY : r < 0.67 ? KIND_FORTRESS : KIND_TURRET;
  }
  const pool = kindsUnlockedAt(level);
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]!;
}

/* ---------------------------------------------------------------- builders */

interface Builder {
  pts: { x: number; y: number }[];
  nodes: Node[];
  /**
   * Symmetry-orbit id per node, parallel to `nodes`. Every image pushed from
   * the same seed shares an id, so downstream passes can treat an orbit as one
   * unit instead of inferring symmetry from geometry. Never enters GameState —
   * `hashState` and the save schema are untouched.
   */
  orbits: number[];
  nextOrbit: number;
}

const newBuilder = (): Builder => ({ pts: [], nodes: [], orbits: [], nextOrbit: 0 });

/** Start a new symmetry orbit; every `push` until the next call joins it. */
function beginOrbit(b: Builder): void {
  b.nextOrbit++;
}

function push(
  b: Builder,
  pos: { x: number; y: number },
  owner: Faction,
  units: number,
  size: NodeSize,
  kind: NodeKind,
): void {
  b.pts.push(pos);
  b.orbits.push(b.nextOrbit);
  // node.id === array index — startFlow and packets rely on this
  b.nodes.push({
    id: b.nodes.length,
    x: pos.x,
    y: pos.y,
    owner,
    units,
    size,
    kind,
    guard: 0,
    upgrading: 0,
    selected: false,
  });
}

/**
 * Classic duel: point-mirror symmetry. Byte-identical to the historic path on
 * default-extent boards: with worldHx/Hy at 80/45 every expression below
 * reduces to the exact pre-band arithmetic, so the frozen L1–5 fixtures (and
 * every screened one-screen board) survive the parameterization untouched.
 */
function genMirror(rng: Rng, b: Builder, p: LevelParams, boosts: PlayerBoosts): void {
  const x0 = CX - p.worldHx;
  const y0 = CY - p.worldHy;
  const sampleLeft = () => ({
    x: x0 + MAP_MARGIN + rngNext(rng) * (2 * p.worldHx * 0.4 - MAP_MARGIN),
    y: y0 + MAP_MARGIN + rngNext(rng) * (2 * p.worldHy - 2 * MAP_MARGIN),
  });
  const playerPos = place(b.pts, sampleLeft, MIN_SPACING);
  beginOrbit(b);
  push(b, playerPos, PLAYER, p.playerStart + boosts.startUnits, 1, KIND_STANDARD);
  push(b, mirror(playerPos), 2, p.enemyStart, 1, KIND_STANDARD);

  const pairs = Math.floor((p.nodeCount - 2) / 2);
  const hasCenter = (p.nodeCount - 2) % 2 === 1;

  // A seed d from the centre puts its mirror image 2d away and sits d from the
  // contested centre node, so d is the binding distance once a centre exists.
  // place() cannot see this: the centre is pushed last and its own clearance is
  // never sampled. Same trap genTriad's minOrbitR and genQuad's guard close.
  const minCenterGap = hasCenter ? MIN_SPACING : 0;
  const sampleHalf = () => {
    const x = x0 + MAP_MARGIN + rngNext(rng) * (p.worldHx - MIN_SPACING / 2 - MAP_MARGIN);
    const y = y0 + MAP_MARGIN + rngNext(rng) * (2 * p.worldHy - 2 * MAP_MARGIN);
    return pushOutOfCenter(x, y, minCenterGap);
  };
  for (let i = 0; i < pairs; i++) {
    const pos = place(b.pts, sampleHalf, MIN_SPACING);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    const kind = rollKind(rng, p.level);
    beginOrbit(b);
    push(b, pos, NEUTRAL, units, size, kind);
    push(b, mirror(pos), NEUTRAL, units, size, kind);
  }
  // Contested centre — the fixed point of the point-mirror, exactly as genTriad
  // and genQuad place theirs. It used to sample a y, which put it at (80, y≠45):
  // NOT a fixed point, so it sat closer to one start than the other and broke
  // the mirror symmetry the rest of the board is built on.
  if (hasCenter) {
    // The two draws the old sampled position consumed are still taken, so the
    // RNG sequence — and therefore every later level — stays in step.
    rngNext(rng);
    rngNext(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    beginOrbit(b);
    push(b, { x: CX, y: CY }, NEUTRAL, units, rollSize(rng), rollKind(rng, p.level));
  }
}

/** 3-way: true 120° rotation inside the centered disc. */
function genTriad(rng: Rng, b: Builder, p: LevelParams, boosts: PlayerBoosts): void {
  // The disc is bounded by the SHORT half-extent — on the classic board this
  // is the historic 35 (WORLD_H/2 − MAP_MARGIN_3WAY); big bands widen it.
  const discR = p.worldHy - MAP_MARGIN_3WAY;
  // Player start in the lower wedge (toward the bottom of the disc).
  const sampleStart = () => {
    const a = Math.PI / 2 + (rngNext(rng) - 0.5) * 0.9; // around "down"
    const r = discR * (0.55 + rngNext(rng) * 0.35);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const playerPos = place(b.pts, sampleStart, MIN_SPACING_3WAY);
  beginOrbit(b);
  push(b, playerPos, PLAYER, p.playerStart + boosts.startUnits, 1, KIND_STANDARD);
  push(b, rotate(playerPos, 1, 3), 2, p.enemyStart, 1, KIND_STANDARD);
  push(b, rotate(playerPos, 2, 3), 3, p.enemyStart, 1, KIND_STANDARD);

  const orbits = Math.floor((p.nodeCount - 3) / 3);
  const hasCenter = (p.nodeCount - 3) % 3 !== 0;

  // place() only checks a seed against *already placed* nodes — it cannot see
  // the seed's own rotational images. A seed near the centre of rotation puts
  // its three 120° twins r·√3 apart, so without a floor here they land on top
  // of each other (this is what drew two large nodes overlapping on L11/17/25).
  // genMirror and genQuad already avoid the same trap by keeping their samples
  // clear of the mirror axes; the triad never got the equivalent guard.
  const minOrbitR = Math.max(
    SPACING_FLOOR / Math.sqrt(3),
    // A contested centre node, when one exists, sits exactly r from every orbit.
    hasCenter ? SPACING_FLOOR : 0,
  );
  const sampleDisc = () => {
    const a = rngNext(rng) * Math.PI * 2;
    // Same two draws as before, remapped into the annulus — the RNG sequence
    // (and therefore every downstream level) stays in step.
    const r = minOrbitR + Math.sqrt(rngNext(rng)) * (discR - 2 - minOrbitR);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  for (let i = 0; i < orbits; i++) {
    const pos = place(b.pts, sampleDisc, MIN_SPACING_3WAY);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    const kind = rollKind(rng, p.level);
    beginOrbit(b);
    for (let k = 0; k < 3; k++) push(b, rotate(pos, k, 3), NEUTRAL, units, size, kind);
  }
  // Contested center (fixed point of the rotation) — a natural fight magnet.
  if (hasCenter) {
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    beginOrbit(b);
    push(b, { x: CX, y: CY }, NEUTRAL, units, 1, p.level >= 9 ? KIND_FACTORY : KIND_STANDARD);
  }
}

/** 4-way: Klein four-group reflections — one start per quadrant. */
function genQuad(rng: Rng, b: Builder, p: LevelParams, boosts: PlayerBoosts): void {
  const x0 = CX - p.worldHx;
  const y0 = CY - p.worldHy;
  // Centre-form reflections (≡ WORLD_W − x on the classic board): the Klein
  // group is about the centre's axes, whatever the board's extent.
  const images = (pos: { x: number; y: number }) => [
    pos,
    { x: 2 * CX - pos.x, y: pos.y },
    { x: pos.x, y: 2 * CY - pos.y },
    { x: 2 * CX - pos.x, y: 2 * CY - pos.y },
  ];
  const orbits = Math.floor((p.nodeCount - 4) / 4);
  const hasCenter = (p.nodeCount - 4) % 4 !== 0;

  // The quadrant sample already keeps seeds clear of both mirror axes, so a
  // seed's own four images can never crowd each other. What it does NOT cover
  // is the contested centre node, which sits exactly |seed − centre| from every
  // image — the same trap genTriad's minOrbitR closes. Without this the designed
  // fight magnet ended up the smallest node on the board (L20, L42, L126).
  const minCenterGap = hasCenter ? MIN_SPACING : 0;
  const sampleQuadrant = () => {
    const x = x0 + MAP_MARGIN + rngNext(rng) * (p.worldHx - MIN_SPACING / 2 - MAP_MARGIN);
    const y = y0 + MAP_MARGIN + rngNext(rng) * (p.worldHy - MIN_SPACING / 2 - MAP_MARGIN);
    return pushOutOfCenter(x, y, minCenterGap);
  };

  // Player bottom-left: sample in the top-left fundamental domain, then take
  // the vertical reflection as the player's start.
  const seed = place(b.pts, sampleQuadrant, MIN_SPACING);
  const starts = images(seed);
  beginOrbit(b);
  push(b, starts[2]!, PLAYER, p.playerStart + boosts.startUnits, 1, KIND_STANDARD); // bottom-left
  push(b, starts[3]!, 2, p.enemyStart, 1, KIND_STANDARD); // bottom-right
  push(b, starts[0]!, 3, p.enemyStart, 1, KIND_STANDARD); // top-left
  push(b, starts[1]!, 4, p.enemyStart, 1, KIND_STANDARD); // top-right

  for (let i = 0; i < orbits; i++) {
    const pos = place(b.pts, sampleQuadrant, MIN_SPACING);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    const kind = rollKind(rng, p.level);
    beginOrbit(b);
    for (const img of images(pos)) push(b, img, NEUTRAL, units, size, kind);
  }
  if (hasCenter) {
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    beginOrbit(b);
    push(b, { x: CX, y: CY }, NEUTRAL, units, 1, KIND_STANDARD);
  }
}

/* ------------------------------------------------------ scripted-kind debuts */

/**
 * L4–L7 and every boss level hand-place their special kinds after generation
 * so each mechanic has a designed debut (zero-text teaching).
 *
 * Every edit applies to a node's whole symmetry orbit, so the hand-placed
 * mechanic appears identically for each faction and the board stays congruent.
 * This used to be a mirror-only helper, which silently left L7's turret on a
 * single node of a 3-fold orbit.
 *
 * Runs after generation and consumes ZERO RNG, which is why a boss debut can
 * be added without disturbing any other level's board.
 */
function applyScriptedKinds(nodes: Node[], orbits: readonly number[], level: number): void {
  const player = nodes.find((n) => n.owner === PLAYER)!;
  const neutrals = nodes.filter((n) => n.owner === NEUTRAL);
  const byDist = (from: Node) =>
    [...neutrals].sort(
      (a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y),
    );
  const setOrbit = (n: Node, mut: (m: Node) => void) => {
    const orbit = orbits[n.id]!;
    for (const m of nodes) if (orbits[m.id] === orbit) mut(m);
  };

  if (level === 4) {
    // Factory debut: nearest neutral to the player start becomes a factory —
    // grab it and FEEL the production difference.
    const near = byDist(player)[0];
    if (near) setOrbit(near, (m) => {
      m.kind = KIND_FACTORY;
      m.size = 1;
      m.units = 6;
    });
  } else if (level === 5) {
    // Fortress debut guarding the short lane + a cheap small node so the
    // upgrade nudge has its moment.
    const sorted = byDist(player);
    if (sorted[0]) setOrbit(sorted[0], (m) => {
      m.kind = KIND_FORTRESS;
      m.size = 1;
      m.units = 12;
    });
    if (sorted[1]) setOrbit(sorted[1], (m) => {
      m.size = 0;
      m.units = 4;
    });
  } else if (level === 7) {
    // Turret demo: the neutral nearest CRIMSON's start (faction 2), far from
    // the player, becomes a cheap turret — the player learns by watching it
    // shred AMBER's streams before ever facing one.
    const crimson = nodes.find((n) => n.owner === 2)!;
    const candidates = neutrals
      .filter((n) => Math.hypot(n.x - player.x, n.y - player.y) > 35)
      .sort(
        (a, b) =>
          Math.hypot(a.x - crimson.x, a.y - crimson.y) -
          Math.hypot(b.x - crimson.x, b.y - crimson.y),
      );
    const pick = candidates[0];
    // The whole rotational orbit becomes a turret, so every faction has one in
    // the same relative spot. The player still learns by watching CRIMSON's
    // turret shred AMBER's streams before their own matters.
    if (pick)
      setOrbit(pick, (m) => {
        m.kind = KIND_TURRET;
        m.size = 0;
        m.units = 3;
      });
  }

  // Non-boss kind debuts (the compression pass): the debut level's roll pool
  // already contains the kind, but a roll is a maybe — one hand-placed orbit
  // makes the debut GUARANTEED visible, the same zero-text teaching contract
  // as the L4 factory. The nearest still-standard neutral orbit to the player
  // start is chosen so the new mechanic sits where the opening minute happens
  // (falling back to the nearest neutral of any kind on a board with no
  // standard orbit left). Whole orbit, so every faction meets it identically —
  // which is also why the contested centre is only a last resort: its orbit is
  // a single node (the symmetry group's fixed point), and a debut staged there
  // alone is one node instead of one per faction (L21's vault hit exactly
  // that before the guard).
  const debut = NON_BOSS_DEBUTS[level];
  if (debut !== undefined) {
    const offCentre = (n: Node) => Math.abs(n.x - CX) > 1e-6 || Math.abs(n.y - CY) > 1e-6;
    const sorted = byDist(player);
    const pick =
      sorted.find((n) => n.kind === KIND_STANDARD && offCentre(n)) ??
      sorted.find(offCentre) ??
      sorted[0];
    if (pick) setOrbit(pick, (m) => (m.kind = debut));
  }

  const boss = bossKindForLevel(level);
  if (boss === null) return;

  // Boss debut. Two placements, both whole orbits, so the board stays congruent:
  //  - the contested centre, which every faction is equidistant from, and
  //  - the neutral orbit nearest the starts, so each player has one in reach.
  //
  // On L14 there is only one non-centre orbit, so this makes EVERY neutral a
  // relay. That is deliberate — the same "grab it and FEEL it" logic as L4's
  // factory, at board scale — and it is the first thing to eyeball if the level
  // reads as monotonous rather than as a set piece.
  const centre = nodes.find(
    (n) => n.owner === NEUTRAL && Math.abs(n.x - CX) < 1e-6 && Math.abs(n.y - CY) < 1e-6,
  );
  if (centre) setOrbit(centre, (m) => (m.kind = boss));

  const nearStart = byDist(player).find((n) => n !== centre);
  if (nearStart) setOrbit(nearStart, (m) => (m.kind = boss));
}

/**
 * Shrink any node whose drawn circle would touch its nearest neighbour.
 *
 * Rotational packing is far more constrained than free packing — only a handful
 * of seeds determine a whole 15-node triad — so on the densest boards the
 * sampler genuinely cannot find room for every node at full size. Rather than
 * let that draw as overlapping circles with unreadable unit counts, the crowded
 * node gets smaller. Crowded regions filling with small nodes also reads well:
 * the board's contested middle looks contested.
 *
 * Symmetry is enforced **structurally**, by taking the tightest clearance
 * across each symmetry orbit and applying one size to the whole orbit. An
 * earlier version instead leaned on the argument that nearest-neighbour
 * distance is constant within an orbit — true only if the point set really is
 * invariant under the group, which duels violated via an off-centre "centre"
 * node. That handed one player a bigger neutral than its mirror twin on 8 of
 * the first 200 levels. Orbits make the invariant hold by construction rather
 * than by geometry.
 *
 * Consumes no RNG.
 */
function shrinkCrowdedNodes(nodes: Node[], orbits: readonly number[]): void {
  // Tightest clearance anywhere in each orbit.
  const orbitBudget = new Map<number, number>();
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    let d = Infinity;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const dj = Math.hypot(n.x - nodes[j]!.x, n.y - nodes[j]!.y);
      if (dj < d) d = dj;
    }
    const o = orbits[i]!;
    orbitBudget.set(o, Math.min(orbitBudget.get(o) ?? Infinity, d));
  }

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    // Both nodes in a touching pair shrink, so each only has to cover its half
    // of the gap, plus a 0.5 wu visual breather.
    const budget = orbitBudget.get(orbits[i]!)! / 2 - 0.5;
    // A faction's home never drops below medium: demoting it costs that player
    // a production tier and a unit-cap tier for the whole level.
    const floor: NodeSize = n.owner === NEUTRAL ? 0 : 1;
    while (n.size > floor && NODE_R[n.size]! > budget) n.size = (n.size - 1) as NodeSize;
  }
}

/* ------------------------------------------------------------ createLevel */

/**
 * The historic level→board binding, kept as the default seed.
 *
 * Callers that want the old "same level ⇒ same map" behaviour get it by not
 * passing a seed. Callers that want variety pass one.
 */
export function defaultSeedFor(level: number): number {
  return (Math.imul(level, 0x9e3779b1) ^ 0xc0ffee) | 0;
}

/**
 * Build the full starting state for a level.
 * @param boosts permanent meta-progression boosts (player only).
 * @param seed board seed; defaults to the level's historic board.
 */
export function createLevel(
  level: number,
  boosts: PlayerBoosts = DEFAULT_BOOSTS,
  seed: number = defaultSeedFor(level),
): GameState {
  // Authored gauntlets replace generation wholesale: fixed board, fixed
  // budget, solution-verified in test/authored.test.ts instead of screened.
  // Boosts are deliberately NOT applied — a puzzle whose recorded solution
  // depends on the buyer's meta upgrades is a puzzle with two answers, and
  // every boost is player-positive anyway (extra units only add slack).
  const authored = authoredBoardFor(level);
  if (authored) return createAuthoredLevel(authored);

  const rng: Rng = { s: seed | 0 };
  const p = levelParams(level);
  const b = newBuilder();

  if (p.factionCount === 3) genTriad(rng, b, p, boosts);
  else if (p.factionCount === 4) genQuad(rng, b, p, boosts);
  else genMirror(rng, b, p, boosts);

  applyScriptedKinds(b.nodes, b.orbits, level);
  shrinkCrowdedNodes(b.nodes, b.orbits);
  // Twist levels mutate AFTER generation and INSIDE createLevel — so the
  // mutation consumes no RNG (no other board shifts) and every screening probe
  // plays the twisted board, not the plain one it replaced.
  const twist = TWIST_LEVELS[level];
  if (twist) applyMutator(b.nodes, twist);
  // Objective resolution and dressing, on the same contract as the twists:
  // RNG-free, post-generation, inside createLevel — target ids depend on the
  // generated board, and screening must probe the dressed one.
  const objective = applyObjective(b.nodes, level);

  const personas = personasForLevel(level);
  const ais: FactionCfg[] = [];
  // The boss rival: faction 2 on a boss level fights a tier above the rest of
  // the board. That is what makes "the persona called out by name" mean
  // something on a 4-way — one of them is the threat, not all three equally.
  const bossFaction = isBossLevel(level) ? 2 : -1;
  for (let i = 0; i < p.factionCount - 1; i++) {
    const faction = (2 + i) as Faction;
    ais.push({
      faction,
      persona: personas[i] ?? personas[0]!,
      firstMoveTick: p.aiFirstMoveTick + i * 17, // staggered wakes
      tier: faction === bossFaction ? Math.min(MAX_TIER, p.aiTier + 1) : undefined,
    });
  }

  const cfg: LevelCfg = {
    level,
    seed: seed | 0,
    aiFirstMoveTick: p.aiFirstMoveTick,
    aiIntervalTicks: p.aiIntervalTicks,
    aiMinUnits: p.aiMinUnits,
    aiOverkillMargin: p.aiOverkillMargin,
    aiTier: p.aiTier,
    aiKillCertainty: p.aiKillCertainty,
    aiSendFraction: p.aiSendFraction,
    aiNeutralBonus: p.aiNeutralBonus,
    aiKillPlayerBias: p.aiKillPlayerBias,
    factionCount: p.factionCount,
    ais,
    objective,
    openings: OPENINGS[level],
    worldHx: p.worldHx,
    worldHy: p.worldHy,
    packetSpeedMul: p.packetSpeedMul,
    playerProdInterval: boosts.prodInterval,
    playerUpgradeCost: boosts.upgradeCost,
    playerUpgradeTicks: boosts.upgradeTicks,
    // Conditional spread, not `abilities: boosts.abilities` — an explicit
    // undefined key still changes nothing, but absent-means-absent keeps the
    // cfg shape identical to pre-ability builds.
    ...(boosts.abilities ? { abilities: { ...boosts.abilities } } : {}),
  };

  const nextAiTick = [0, 0, 0, 0, 0];
  for (const fc of ais) nextAiTick[fc.faction] = fc.firstMoveTick;

  return {
    tick: 0,
    rng,
    status: "playing",
    cfg,
    nodes: b.nodes,
    flows: [],
    packets: [],
    nextAiTick,
    firstSendDone: false,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
    // Live counts start at the grant; hashed only when cfg.abilities is set.
    abilityCharges: { ...(boosts.abilities ?? { overcharge: 0, stasis: 0, recall: 0 }) },
    effects: { overcharge: [], stasis: [] },
  };
}

/* -------------------------------------------------------------------- daily */

export const DAILY_MUTATORS = [
  "ALL FACTORIES",
  "FORTIFIED",
  "TURRET GRID",
  "RICH START",
  "SWARM",
] as const;

export type MutatorName = (typeof DAILY_MUTATORS)[number];

/**
 * Apply a board-wide mutator. Shared by the daily challenge and the twist
 * levels — the daily's switch used to be inline, which would have meant a
 * second copy of each rule the moment twists reused them.
 *
 * Deterministic and RNG-free, so applying one after generation cannot shift
 * any other board.
 */
export function applyMutator(nodes: Node[], mutator: MutatorName): void {
  switch (mutator) {
    case "ALL FACTORIES":
      for (const n of nodes) if (n.owner === NEUTRAL) n.kind = KIND_FACTORY;
      break;
    case "FORTIFIED":
      for (const n of nodes) if (n.owner === NEUTRAL) n.kind = KIND_FORTRESS;
      break;
    case "TURRET GRID":
      for (const n of nodes) if (n.owner === NEUTRAL && n.id % 2 === 0) n.kind = KIND_TURRET;
      break;
    case "RICH START":
      for (const n of nodes) if (n.owner !== NEUTRAL) n.units += 10;
      break;
    case "SWARM":
      for (const n of nodes) if (n.owner === NEUTRAL) n.units = Math.max(1, n.units >> 1);
      break;
  }
}

/**
 * Scripted openings per level: authored first moves in the window where the
 * decision layers are still asleep (see runOpenings in ai.ts).
 *
 * L1/L2 exist to kill the mute-bot opening: the rival visibly grabs its
 * nearest neutral — activity the player can watch and learn from, and on a
 * mirror board usually a ball on its own side. The one exception is the
 * centre (the mirror's fixed point, equidistant to both): when that is the
 * nearest neutral the opening CONTESTS it, which resolves player-positive —
 * the L1 force margins mean the player retakes it with room to spare, and a
 * first-timer watches a capture, a recapture, and a live opponent inside the
 * first thirty seconds. Screening plays the opening, so every shipped board
 * stays all-12 winnable with it. Later levels add entries in the schedule
 * pass; keep every tick here BELOW the level's aiFirstMoveTick or the
 * opening is just a louder wake.
 */
export const OPENINGS: Readonly<Record<number, ScriptedOpening[]>> = {
  1: [{ faction: 2, tick: 240, to: "nearNeutral", fraction: 0.5 }],
  2: [{ faction: 2, tick: 210, to: "nearNeutral", fraction: 0.6 }],
  // L3's natural wake at 240 is real but its margin-7 veto can keep the first
  // wakes silent past the 12 s gate — the opening guarantees the move.
  3: [{ faction: 2, tick: 240, to: "nearNeutral", fraction: 0.6 }],
  // L11 OUTLAST: the siege announces itself — a wave straight at the player at
  // 2 s, AFTER the normal wake (45) on purpose, which is the outlast
  // exception to the below-firstMove rule: the normal layer's first move is
  // usually a neutral grab, and the siege's first image must be the player's
  // border turning hostile. Half-strength, so it pressures rather than ends.
  11: [{ faction: 2, tick: 60, to: "playerNearest", fraction: 0.5 }],
  // L13 decompresses after the 3-way debut; the opening keeps its first
  // seconds alive. Tick 30, not the schedule draft's 90 — L13's normal wake
  // is 45, and an opening after the wake is just a louder wake.
  13: [{ faction: 2, tick: 30, to: "nearNeutral", fraction: 0.6 }],
  // L16 CLAIM: the land race made visible. Each rival grabs its nearest
  // neutral in a stagger while the decision layers sleep (wake pushed to 150
  // in the tuned rows), so the player watches the quota race start before
  // anyone throws a punch.
  16: [
    { faction: 2, tick: 60, to: "nearNeutral", fraction: 0.6 },
    { faction: 3, tick: 90, to: "nearNeutral", fraction: 0.6 },
    { faction: 4, tick: 120, to: "nearNeutral", fraction: 0.6 },
  ],
};

/**
 * Twist levels: a daily-style mutator on two fixed mid-run levels.
 *
 * The inter-boss stretches are the emptiest content in the game — L15–19 is
 * ~7 minutes with nothing new, sitting exactly where a 10-minute average
 * session has to become a 17-minute one. A twist is pure content reuse: the
 * mutators exist, the intro card names them, and because the mutation runs
 * INSIDE createLevel it is part of the board the screen verifies — a twisted
 * board can never ship unwinnable.
 *
 * L17 gets SWARM (a triad's four neutrals at half price turns the cramped
 * topology into a land-grab sprint — a twist that plays EASIER, placed right
 * after the first boss). L23 gets ALL FACTORIES on a 4-way, the daily's most
 * popular chaos. Both sit mid-gap between bosses.
 */
export const TWIST_LEVELS: Readonly<Record<number, MutatorName>> = {
  17: "SWARM",
  23: "ALL FACTORIES",
};

/**
 * Daily challenge: one 4-way full-cast board (L12-grade knobs) seeded by the
 * UTC date, plus one board-wide mutator. Same map worldwide, all day.
 */
export function createDailyLevel(
  seed: number,
  boosts: PlayerBoosts = DEFAULT_BOOSTS,
): { state: GameState; mutator: string } {
  const rng: Rng = { s: seed | 0 };
  const p = levelParams(12); // full-cast 4-way, tier-3 knobs
  const b = newBuilder();
  const mutatorIdx = Math.floor(rngNext(rng) * DAILY_MUTATORS.length);

  genQuad(rng, b, p, boosts);

  applyMutator(b.nodes, DAILY_MUTATORS[mutatorIdx]!);

  const personas = [CRIMSON, AMBER, VIOLET];
  const ais: FactionCfg[] = personas.map((persona, i) => ({
    faction: (2 + i) as Faction,
    persona,
    firstMoveTick: p.aiFirstMoveTick + i * 17,
  }));

  const cfg: LevelCfg = {
    level: 12,
    seed: seed | 0,
    aiFirstMoveTick: p.aiFirstMoveTick,
    aiIntervalTicks: p.aiIntervalTicks,
    aiMinUnits: p.aiMinUnits,
    aiOverkillMargin: p.aiOverkillMargin,
    aiTier: 3,
    aiKillCertainty: p.aiKillCertainty,
    aiSendFraction: p.aiSendFraction,
    aiNeutralBonus: p.aiNeutralBonus,
    aiKillPlayerBias: p.aiKillPlayerBias,
    factionCount: 4,
    ais,
    worldHx: p.worldHx,
    worldHy: p.worldHy,
    packetSpeedMul: p.packetSpeedMul,
    playerProdInterval: boosts.prodInterval,
    playerUpgradeCost: boosts.upgradeCost,
    playerUpgradeTicks: boosts.upgradeTicks,
    // Same contract as createLevel: abilities ride the boosts, absent = absent.
    ...(boosts.abilities ? { abilities: { ...boosts.abilities } } : {}),
  };

  const nextAiTick = [0, 0, 0, 0, 0];
  for (const fc of ais) nextAiTick[fc.faction] = fc.firstMoveTick;

  return {
    state: {
      tick: 0,
      rng,
      status: "playing",
      cfg,
      nodes: b.nodes,
      flows: [],
      packets: [],
      nextAiTick,
      firstSendDone: true, // no hint arrow on dailies
      halfSendDone: false,
      holdTicks: 0,
      sendsUsed: 0,
      abilityCharges: { ...(boosts.abilities ?? { overcharge: 0, stasis: 0, recall: 0 }) },
      effects: { overcharge: [], stasis: [] },
    },
    mutator: DAILY_MUTATORS[mutatorIdx]!,
  };
}
