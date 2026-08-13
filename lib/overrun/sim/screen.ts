import {
  createLevel,
  defaultSeedFor,
  DEFAULT_BOOSTS,
  factionsForLevel,
  worldScaleForLevel,
  type PlayerBoosts,
} from "./level";
import { play, type BotOpts } from "./solver";
import { authoredBoardFor } from "./authored";
import type { GameState } from "./state";

/**
 * Draw a board the player can actually win.
 *
 * The problem this exists for, measured rather than assumed: difficulty used to
 * be a formula, and whether a *particular board* produced by that formula was
 * winnable was nobody's job. Over 108 reference-bot policies per level, the
 * shipped L1-14 curve ran, in percent:
 *
 *     L1-5   100  100  100   96   69
 *     L6-10   20   56   69   18    4      <- L6 is where players report sticking
 *     L11-14   4   46    7   52
 *
 * Level 6 was not tuned to be hard; its four neutrals all happened to roll 14
 * against a player holding 10, so the board had no opening move at all.
 *
 * Worse, a level number named exactly one board, so a player who could not beat
 * that board could not get past it by any route — and `checkpointLevel` sends a
 * lost run straight back to it.
 *
 * So: generate candidates, play each one, and only show the player a board that
 * a competent reference player has demonstrably won. Difficulty stops being a
 * formula's hope and becomes a measured property of the specific board.
 *
 * ## Why two bots
 *
 * The lesson `assets-src/balance/README.md` paid for: the competent bot is the
 * FLOOR ("is this winnable at all"), the crude one is the CEILING ("is careless
 * play still punished"). Screening on the competent bot alone would accept a
 * board that is trivial, and screening on the crude bot alone is satisfied by a
 * board that is impossible. Neither is enough on its own.
 *
 * ## Cost
 *
 * A full playout is 0.5-1.6 ms. A candidate costs twelve competent probes, plus
 * three careless ones only when it has already cleared the floor — so a passing
 * candidate is ~15 playouts and a failing one is ~12, less whatever the early
 * abort in `screenLevel` saves.
 *
 * Measured in the browser on the production build, timing the whole of
 * `startLevel` (screen + setContent + clone): **56 ms average, 94 ms worst**
 * across L1-24. A 4 GB Chromebook is roughly 4x slower, so budget ~220-380 ms.
 *
 * That is a one-off at a level transition, not a per-frame cost: the 4x CPU
 * throttle check holds 56 fps average with a 21 ms worst frame during play.
 */

/**
 * Twelve competent policies, spanning the axes that actually decide games.
 *
 * A third of the 36-policy portfolio in `assets-src/balance/bands.ts`, keeping
 * its spread across the knobs that separate winners from losers: how far away a
 * node counts as "front line", how much it garrisons, and how much overkill it
 * insists on. `phase` staggers the decision cycle so twelve policies are twelve
 * different games rather than one game measured twelve times.
 *
 * Sized by measurement, not taste. At six probes the screen was too coarse an
 * instrument: a "2 of 6" floor accepts a board whose true win rate is 7 %,
 * because the six fixed policies are a biased sample rather than six tosses of
 * the same coin — and L13 and L18 duly slipped through. Twelve does not, and
 * costs about 13 ms a level extra.
 */
const COMPETENT: readonly Partial<BotOpts>[] = (() => {
  const out: Partial<BotOpts>[] = [];
  let i = 0;
  for (const frontDist of [40, 60, 80]) {
    for (const frontGarrison of [6, 14]) {
      for (const margin of [1, 3]) {
        out.push({
          frontDist,
          frontGarrison,
          margin,
          garrisonFrac: (i % 2) * 0.25,
          maxFronts: 2 + (i % 2),
          perCycle: 2,
          phase: (i * 3) % 9,
        });
        i++;
      }
    }
  }
  return out;
})();

/**
 * Three careless policies: no garrison, over-committed on too many fronts, no
 * upgrades. This is a player who empties their home node and gets sniped, and
 * it must keep losing as levels rise — if it starts winning, the level is not
 * hard, it is just long.
 */
const CARELESS: readonly Partial<BotOpts>[] = [
  { frontDist: 40, frontGarrison: 0, margin: 1, garrisonFrac: 0, perCycle: 3, maxFronts: 4, upgrades: false, phase: 0 },
  { frontDist: 80, frontGarrison: 0, margin: 1, garrisonFrac: 0, perCycle: 4, maxFronts: 4, upgrades: false, phase: 4 },
  { frontDist: 60, frontGarrison: 0, margin: 1, garrisonFrac: 0, perCycle: 3, maxFronts: 4, upgrades: false, phase: 2 },
];

export interface DifficultyBand {
  /** Minimum COMPETENT probes that must win for the board to be shown. */
  minWins: number;
  /** Maximum CARELESS probes allowed to win before the board is too soft. */
  maxCarelessWins: number;
}

/**
 * The target band per level, as integer probe counts rather than rates — there
 * is no float comparison to get wrong, and the numbers say what they mean.
 *
 * Calibrated against the levels that already measure correctly: L1-4 near 100 %,
 * L5 69 %, L8 69 %, L14 52 %. The curve we screen for is the curve the game
 * already demonstrates on its good levels.
 *
 * The teaching band demands ALL TWELVE. A first-time player is worse than every
 * policy here, and the first minute is a conversion funnel — L1-3 have no
 * business being interesting.
 *
 * The mid and late floors are 5 and 4 rather than 4 and 2, and that was measured
 * too: the looser pair left L21/L22/L24 at 16/11/14 % and produced best-of
 * fallbacks, while the tighter pair lands the whole of L1-30 at 16 % or better
 * with no fallback at all, for 3 ms a level.
 *
 * ## Why the 3-way board gets a lower floor
 *
 * Not to make a red test green — for the same structural reason the large-node
 * check in level.test.ts gives triads their own bar. A 3-way board is 7 nodes:
 * three starts and a contested centre, leaving **4 neutrals for 3 factions**,
 * inside a disc that is 27 % of the world. It cannot supply boards as winnable
 * as a duel's, and asking it to is not a standard, it is a wish.
 *
 * Measured: against the shared floor, triads exhausted the candidate budget on
 * **33 %** of screens (9.3 candidates average) while duels and quads never did.
 * A budget exhaustion returns `accepted: false` and hands over a best-of whose
 * difficulty is unbounded — strictly worse for the player than an honest lower
 * floor that the generator can actually hit.
 *
 * **The size of the discount depends on the supply, so re-measure it whenever
 * the generator changes.** This was `-2` and is now `-1`, and both were correct
 * at the time. At `-1` against the old supply: 8 % fallbacks, 5.0 candidates,
 * and no quality gain — so `-2` won. After `TRIAD_LEVEL_FLOOR`/`_CAP` gave
 * triads a difficulty window their geometry can support, the same `-1` took
 * L59 from 11 % to 66 %, L12 from 29 % to 42 % and L24 from 27 % to 39 %, for
 * one fallback in 240 screens. Re-running the old experiment on the new supply
 * is what found that; keeping the old answer would have left a level at 11 %.
 */
export function bandFor(level: number): DifficultyBand {
  if (level <= 3) return { minWins: COMPETENT.length, maxCarelessWins: CARELESS.length };
  const base =
    level <= 8
      ? { minWins: 6, maxCarelessWins: CARELESS.length }
      : level <= 20
        ? { minWins: 5, maxCarelessWins: 2 }
        : { minWins: 4, maxCarelessWins: 1 };
  if (factionsForLevel(level) === 3) return { ...base, minWins: Math.max(3, base.minWins - 1) };
  return base;
}

/**
 * Candidate seeds for one attempt at a level.
 *
 * Attempt 0 yields the level's historic board FIRST. That is deliberate and it
 * is most of the value here: every level whose shipped board already measures
 * well keeps that exact board, byte for byte, and only the boards that fail the
 * screen get replaced. The change is surgical rather than a re-roll of the whole
 * game.
 *
 * Later attempts start somewhere else entirely, which is what unsticks a player:
 * losing hands them a DIFFERENT verified-winnable board rather than the wall
 * they just failed. Same (level, attempt) always yields the same sequence, so
 * boards stay reproducible from two integers — no stored seed, no Math.random,
 * and `hashState` determinism is untouched.
 */
export function seedSequence(level: number, attempt = 0): () => number {
  let s = defaultSeedFor(level);
  if (attempt > 0) s = (Math.imul(s ^ attempt, 0x9e3779b1) ^ (attempt * 0x85ebca6b)) | 0;
  let first = true;
  return () => {
    if (first) {
      first = false;
      return s;
    }
    // A cheap avalanche step. Successive seeds must be uncorrelated, or nearby
    // candidates produce nearby boards and the screen retries the same failure.
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) ^ 0x9e3779b1) | 0;
    return s;
  };
}

export interface ScreenedBoard {
  state: GameState;
  seed: number;
  /** COMPETENT probes that won, of `COMPETENT.length`. */
  wins: number;
  /** CARELESS probes that won, of `CARELESS.length`. Only measured on boards that cleared the floor. */
  carelessWins: number;
  /** Candidates generated, at least 1. */
  candidates: number;
  /** False when the budget ran out and this is the best-of rather than a pass. */
  accepted: boolean;
}

/**
 * Candidate budget. 16 x ~12 playouts is the worst case, and over L1-30 nothing
 * came close — the deepest search was 10 candidates.
 */
export const MAX_CANDIDATES = 16;

/**
 * Playout cap. This is the dominant cost — a LOSING playout always runs the
 * full cap, while a winning one stops early — so it is the first number you
 * would reach for to make screening cheaper. Don't: it is already at the knee.
 *
 * Measured over 516 winning playouts on screened ONE-SCREEN boards, win
 * durations run p50 37 s, p90 72 s, p99 117 s, max 142 s. Cutting the cap to
 * 110 s would discard 1.9% of real wins and 90 s would discard 4.7% — and a
 * discarded win makes the screen reject a board it should have taken, which
 * costs another candidate. The saving buys back its own cost.
 *
 * Bigger board bands stretch every lane (packets fly 1 wu/tick — crossing a
 * 1.8× board is ~9.6 s against 5.3), so the cap scales with the band or the
 * screen starts truncating REAL wins on big boards and misreads winnable as
 * unwinnable. The band multipliers start proportional-ish to the diagonal;
 * re-measure with the balance harness once the bands settle.
 */
const PROBE_SECONDS = 150;

export function probeSecondsFor(level: number): number {
  const scale = worldScaleForLevel(level);
  return scale >= 1.8 ? 260 : scale >= 1.4 ? 210 : PROBE_SECONDS;
}

/**
 * Candidate budget per band. Big-band board supply is thinner per candidate
 * (more nodes, more ways for a layout to be lopsided), and one measured
 * seed-stream (L22 attempt 4) ran 16 candidates without a pass while
 * candidate 17-32 held a comfortable 6/12 — the boards exist, the old budget
 * just gave up before finding one. Classic boards keep the measured 16.
 */
export function maxCandidatesFor(level: number): number {
  return worldScaleForLevel(level) > 1 ? 32 : MAX_CANDIDATES;
}

const NO_MUTATE = (): void => {};

/**
 * Pick a board for `level` that lands inside its difficulty band.
 *
 * Never fails: if the budget runs out, it returns the best candidate it saw,
 * with `accepted: false` so the caller can tell. Shipping a hard board beats
 * shipping no board, and the caller cannot do anything more useful with a
 * failure than we can.
 */
export function screenLevel(
  level: number,
  boosts: PlayerBoosts = DEFAULT_BOOSTS,
  nextSeed: () => number = seedSequence(level),
  maxCandidates: number = maxCandidatesFor(level),
): ScreenedBoard {
  // Authored gauntlets are verified by SOLUTION REPLAY (test/authored.test.ts
  // proves the budget wins and the greedy line fails), not by bot playouts —
  // the screening bots cannot solve puzzles and would report a fixed board
  // sixteen times. Reported as a clean pass because it IS one, on the other
  // instrument.
  if (authoredBoardFor(level)) {
    return {
      state: createLevel(level, boosts),
      seed: 0,
      wins: COMPETENT.length,
      carelessWins: 0,
      candidates: 1,
      accepted: true,
    };
  }
  const band = bandFor(level);
  let best: { seed: number; wins: number; carelessWins: number } | null = null;
  const budget = Math.max(1, maxCandidates);

  for (let n = 1; n <= budget; n++) {
    const seed = nextSeed() | 0;

    /**
     * Stop probing a candidate that can no longer do either useful thing: pass
     * the band, or become the best-of we fall back on. Once neither is
     * reachable, nothing the remaining playouts return changes what we do with
     * this board — and a losing playout is the most expensive kind, because it
     * runs the full tick cap instead of ending early.
     *
     * BOTH conditions have to fail. Aborting on "cannot beat best" alone is
     * wrong and cost a level: a candidate that clears the floor but fails the
     * careless ceiling is still recorded as `best`, which pushes the bar above
     * `minWins` — and then a later board that WOULD have passed outright gets
     * abandoned for being merely good enough. L13 fell back to a best-of that
     * way.
     *
     * The first candidate is always measured in full, so `best` is never null.
     */
    let wins = 0;
    let abandoned = false;
    for (let i = 0; i < COMPETENT.length; i++) {
      const ceiling = wins + (COMPETENT.length - i); // best score still reachable
      const canPass = ceiling >= band.minWins;
      const canBeatBest = best === null || ceiling > best.wins;
      if (!canPass && !canBeatBest) {
        abandoned = true;
        break;
      }
      if (play(level, probeSecondsFor(level), COMPETENT[i]!, NO_MUTATE, boosts, seed).status === "won") {
        wins++;
      }
    }
    // Provably neither a pass nor an improvement, so its exact score is not
    // worth the playouts — and must not be recorded as `best`, since it is a
    // partial count.
    if (abandoned) continue;

    // Only price careless play on a board already known to be winnable. Three
    // more playouts cannot rescue a board that failed the floor, so spending
    // them on one is pure cost.
    let carelessWins = 0;
    const clearsFloor = wins >= band.minWins;
    if (clearsFloor) {
      for (const opts of CARELESS) {
        if (play(level, probeSecondsFor(level), opts, NO_MUTATE, boosts, seed).status === "won") carelessWins++;
      }
    }

    // Rank on winnability first. A board that is winnable but soft still beats
    // one nobody can win, so carelessWins is only ever a tie-break.
    if (!best || wins > best.wins || (wins === best.wins && carelessWins < best.carelessWins)) {
      best = { seed, wins, carelessWins };
    }

    if (clearsFloor && carelessWins <= band.maxCarelessWins) {
      return {
        state: createLevel(level, boosts, seed),
        seed,
        wins,
        carelessWins,
        candidates: n,
        accepted: true,
      };
    }
  }

  const b = best!;
  return {
    state: createLevel(level, boosts, b.seed),
    seed: b.seed,
    wins: b.wins,
    carelessWins: b.carelessWins,
    candidates: budget,
    accepted: false,
  };
}

/** Probe-set sizes, exported so tests and tools can express bands in shares. */
export const PROBE_COUNTS = { competent: COMPETENT.length, careless: CARELESS.length } as const;
