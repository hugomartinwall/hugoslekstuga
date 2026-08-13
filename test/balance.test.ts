import { describe, expect, it } from "vitest";
import type { GameState } from "../lib/overrun/sim/state";
import { tick, TICK_HZ, dist } from "../lib/overrun/sim/tick";
import { createLevel, levelParams } from "../lib/overrun/sim/level";
import type { Command } from "../lib/overrun/sim/commands";
import { play, type BotOpts } from "../lib/overrun/sim/solver";

/**
 * Balance bots — the cheap insurance CLAUDE.md §10 asks for. These encode the
 * Basic Launch funnel as assertions: if a tuning tweak makes level 1 hostile
 * to a beginner or the AI toothless at level 10, CI screams before players do.
 *
 * TWO bots, and the pairing is the point.
 *
 * The crude greedy bot below empties its home and gets sniped. It is a fixed
 * reference point for "did careless play get punished more", and it is a
 * CEILING: it must not start winning.
 *
 * `src/sim/solver.ts` is a competent player, and it is the FLOOR: it answers "can a
 * good player win this at all". Without it every assertion in this file was
 * satisfiable by making the game unwinnable — which is precisely what happened.
 * Phase 3A.4 shipped a curve on which a competent bot scored 0 wins in 1,116
 * attempts over L30–60, and the crude bot's win rate falling to 0% read as the
 * difficulty curve finally climbing. One-sided guards fail one-sidedly.
 */

/**
 * Greedy scripted player: every 2 s, pick the cheapest capturable target and
 * commit every idle node whose units *together* can take it.
 *
 * The combined-force part matters. An earlier version attacked from the single
 * strongest node and required `src.units > target.units + 2`, which is
 * unsatisfiable once both sides sit at the same unit cap — so the bot could
 * hold 6 of 7 nodes and stall forever against the last one. That deadlock was a
 * property of the bot, not of the level, and it made the funnel assertions
 * sensitive to which size a single node happened to roll. Real players
 * converge streams from several nodes at once; so does this now.
 */
function greedyCommands(state: GameState, tickNo: number): Command[] {
  if (tickNo % 60 !== 0) return [];
  const idle = state.nodes.filter(
    (n) => n.owner === 1 && n.units >= 3 && !state.flows.some((f) => f.from === n.id),
  );
  if (idle.length === 0) return [];
  const strongest = idle.reduce((a, b) => (b.units > a.units ? b : a));

  const cheapest = (canTake: (target: { units: number }) => boolean) => {
    let target = null;
    let best = Infinity;
    for (const n of state.nodes) {
      if (n.owner === 1) continue;
      const cost = n.units + dist(strongest, n) / 8;
      if (cost < best && canTake(n)) {
        best = cost;
        target = n;
      }
    }
    return target;
  };

  // Default: one node at a time, never overcommitting. Draining every node into
  // one attack leaves nothing at home and just feeds the counter-attack.
  const solo = cheapest((n) => strongest.units > n.units + 2);
  if (solo) return [{ type: "sendUnits", from: strongest.id, to: solo.id }];

  // Deadlock escape: at equal unit caps no single node can ever satisfy the
  // margin above, so a bot holding six of seven nodes would stall forever
  // against the last one. Real players converge streams; so does this.
  //
  // Gated on already dominating the board. Ganging up while behind means
  // emptying every node into one attack and losing the counter — which is a
  // real mistake, just not the one this escape exists to avoid.
  const mine = state.nodes.filter((n) => n.owner === 1).length;
  if (mine * 2 <= state.nodes.length) return [];
  const available = idle.reduce((sum, n) => sum + n.units, 0);
  const ganged = cheapest((n) => available > n.units + 2);
  if (!ganged) return [];
  return [...idle]
    .sort((a, b) => dist(a, ganged) - dist(b, ganged))
    .map((src) => ({ type: "sendUnits", from: src.id, to: ganged.id }) as Command);
}

function playGreedy(level: number, maxSeconds: number): { status: string; seconds: number } {
  const state = createLevel(level);
  const maxTicks = maxSeconds * TICK_HZ;
  let i = 0;
  for (; i < maxTicks && state.status === "playing"; i++) tick(state, greedyCommands(state, i));
  return { status: state.status, seconds: i / TICK_HZ };
}

function playIdle(level: number, maxSeconds: number): { status: string; seconds: number } {
  const state = createLevel(level);
  const maxTicks = maxSeconds * TICK_HZ;
  let i = 0;
  for (; i < maxTicks && state.status === "playing"; i++) tick(state, []);
  return { status: state.status, seconds: i / TICK_HZ };
}

describe("balance: the onboarding funnel as unit tests", () => {
  it("greedy player wins level 1 within 90 s", () => {
    const r = playGreedy(1, 90);
    expect(r.status).toBe("won");
  });

  it("greedy player wins levels 2–3 within 3 min", () => {
    for (const lvl of [2, 3]) {
      const r = playGreedy(lvl, 180);
      expect(r.status, `level ${lvl}`).toBe("won");
    }
  });

  it("the teaching levels stay winnable — the whole L1–5 ramp", () => {
    // L4 and L5 used to inherit the general formula, which drops the AI's
    // opening attack to 3 s then 2 s. The bot lost L5 in 45 s while the game
    // was still introducing factories and fortresses. These are the levels a
    // first-time player meets, so they are hand-tuned and asserted as a set.
    for (const lvl of [1, 2, 3, 4, 5]) {
      expect(playGreedy(lvl, 180).status, `level ${lvl}`).toBe("won");
    }
  });

  it("difficulty ramps rather than spikes across the teaching levels", () => {
    // Each level may be harder than the last, but never by a cliff. Time-to-win
    // is the proxy; the failure this guards is one level being several times
    // harder than its neighbour.
    const times = [1, 2, 3, 4, 5].map((l) => playGreedy(l, 180).seconds);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!, `L${i + 1} vs L${i}`).toBeLessThan(times[i - 1]! * 3 + 20);
    }
  });

  it("do-nothing player survives at least 60 s on level 1 (conversion bar)", () => {
    const r = playIdle(1, 60);
    expect(r.status).toBe("playing");
  });

  it("do-nothing player loses level 10 within 5 min (AI actually threatens)", () => {
    // L11, not L10: L10 became an authored gauntlet with no rival at all —
    // an idle player there CANNOT lose, which is the puzzle's design, not a
    // toothless AI. L11 is the outlast siege: the sharpest possible sample.
    const r = playIdle(11, 300);
    expect(r.status).toBe("lost");
  });

  /**
   * Share of levels in [lo, hi] the crude greedy bot can still win.
   *
   * A BAND, not a single level, because outcomes are near-binary and dominated
   * by board luck: measured level by level the signal swings 0–100% between
   * neighbours. Aggregating twelve or more levels turns that into something a
   * threshold can be set against honestly.
   */
  const greedyWinRate = (lo: number, hi: number): number => {
    let wins = 0;
    let n = 0;
    for (let L = lo; L <= hi; L++) {
      n++;
      if (playGreedy(L, 240).status === "won") wins++;
    }
    return wins / n;
  };

  it("careless play never gets EASIER as levels rise (crude-bot ceiling)", () => {
    /**
     * The ceiling half. Rewritten, not relaxed.
     *
     * The previous version asserted `late <= 0.15` and `veryLate <= 0.05` on
     * this same crude bot. Those passed — because the late game was
     * unwinnable, for anyone. An assertion a bug satisfies is not a guard, and
     * raising these is not "lowering a threshold to match a bug": the numbers
     * they replace were measuring the bug.
     *
     * Measured on the shipped curve: 42.9% | 16.7% | 31.3% | 25.0%.
     *
     * The ceilings below are not decoration. During the fix, a rival-start cap
     * of 22 measured 50% at L41–60 against 13% at L17–24 — careless play
     * getting *rewarded* for reaching the late game. That candidate fails
     * `veryLate <= 0.40`, which is why the shipped cap is 24.
     */
    const early = greedyWinRate(6, 12);
    const mid = greedyWinRate(13, 24);
    const late = greedyWinRate(25, 40);
    const veryLate = greedyWinRate(41, 60);

    const label = `early=${early} mid=${mid} late=${late} veryLate=${veryLate}`;

    expect(early, label).toBeGreaterThan(0.25); // the funnel stays winnable
    expect(mid, label).toBeLessThan(early); // real step up after the teaching arc
    // Absolute, NOT a chain anchored on another band. A chain inverts: `mid`
    // is 2/12 and rides on a couple of levels, so making one of them harder —
    // the direction this test wants — would fail every downstream `<= mid`.
    expect(late, label).toBeLessThanOrEqual(0.45);
    expect(veryLate, label).toBeLessThanOrEqual(0.4);
    expect(veryLate, label).toBeLessThan(early); // never a walkover by the end
  });

  /* ------------------------------------------------- the winnability floor */

  /**
   * Eight parameterisations × three decision phases = 24 attempts per level.
   *
   * A level counts as *solved* if any attempt wins, which is the right question
   * for this game: levels are deterministic, so a retry replays the identical
   * board and a real player retries. Solved-count is also the honest metric
   * here — mean win rate is NOT monotone in how good the balance is. Raising
   * `playerStart` took L13–24 from 75% to 100% solved while its mean win rate
   * fell 30.6% → 27.2%, because the player's home stops being the cheapest
   * target and rivals expand into neutrals instead of converging on it. Fewer
   * coin flips, more puzzles.
   *
   * The research harness in assets-src/balance runs 108 attempts at a 300 s
   * cap; this is the suite-sized subset. ~510 ms. Nothing decides after 120 s
   * (median time-to-win late is 39 s), so the shorter cap costs no signal.
   */
  const SUITE_PORTFOLIO: Partial<BotOpts>[] = [];
  for (const frontDist of [40, 80])
    for (const frontGarrison of [6, 14])
      for (const garrisonFrac of [0, 0.25])
        SUITE_PORTFOLIO.push({ frontDist, frontGarrison, garrisonFrac, margin: 2, perCycle: 2, maxFronts: 3 });
  const SUITE_PHASES = [0, 3, 6];

  const solvedRate = (lo: number, hi: number): number => {
    let solved = 0;
    let n = 0;
    for (let L = lo; L <= hi; L++) {
      n++;
      search: for (const cfg of SUITE_PORTFOLIO)
        for (const phase of SUITE_PHASES)
          if (play(L, 120, { ...cfg, phase }).status === "won") {
            solved++;
            break search;
          }
    }
    return solved / n;
  };

  it("a competent player can still win every band — hard, not impossible", () => {
    /**
     * The assertion this file was missing, and the one that would have caught
     * Phase 3A.4 on the day it landed.
     *
     * Measured, shipped curve vs `d0e8124` (the unwinnable one):
     *   L6-12   71% / 71%   ← untouched band, and it must stay untouched
     *   L13-24  67% / 42%
     *   L25-40  63% / 19%
     *   L41-60  55% /  0%
     *
     * Floors sit ~3–5 levels below the measured value per band. All three late
     * floors fail on `d0e8124`; verified, not assumed.
     */
    const early = solvedRate(6, 12);
    const mid = solvedRate(13, 24);
    const late = solvedRate(25, 40);
    const veryLate = solvedRate(41, 60);
    const label = `early=${early} mid=${mid} late=${late} veryLate=${veryLate}`;

    expect(early, label).toBeGreaterThanOrEqual(0.55);
    expect(mid, label).toBeGreaterThanOrEqual(0.5);
    expect(late, label).toBeGreaterThanOrEqual(0.4);
    expect(veryLate, label).toBeGreaterThanOrEqual(0.3);
  });

  it("the player's home is never the cheapest node on the board (past L16)", () => {
    /**
     * The mechanism itself, asserted directly and without simulating anything.
     *
     * `playerStart` was a flat 10 while `neutralLo` climbs to 15 by L11, so the
     * player could not afford a single neutral AND was the cheapest target on
     * the board — which is what every rival's first wake converged on. That is
     * the whole of the unwinnable late game, in one comparison.
     *
     * L6–16 is allowed a gap, and it is a MEASURED allowance rather than debt.
     * Closing it there by raising `playerStart` costs the crude greedy bot 14
     * points of win rate over L6–12 — careless play punished harder in the one
     * band that has to survive the conversion funnel — and buys nothing the
     * neutral ramp does not already buy. What the player holds was never the
     * problem in that band; what a node cost was.
     */
    for (let L = 17; L <= 200; L++) {
      const p = levelParams(L);
      expect(p.playerStart, `L${L}`).toBeGreaterThanOrEqual(p.neutralLo);
    }
    for (let L = 6; L <= 16; L++) {
      const p = levelParams(L);
      expect(p.neutralLo - p.playerStart, `L${L}`).toBeLessThanOrEqual(5);
    }
  });

  it("no difficulty knob jumps where the hand-tuned table hands over to the formula", () => {
    /**
     * L1–5 are hand-tuned and L6+ is formula. Twice now the formula has picked
     * up from a value it was never continuous with, and both times it cost a
     * band of levels:
     *
     *  - Phase 1: `aiFirstMoveTick` fell 8 s → 3 s → 2 s across L3–L5, so the
     *    AI's opening attack accelerated while the game was still teaching what
     *    a factory was. Fixed by hand-tuning L1–5.
     *  - This pass: the fix stopped at L5, so `neutralLo`/`neutralHi` resumed at
     *    10–20 against L5's tuned 6–12 — a 67% jump in what a node costs, landing
     *    on the 3-way debut, on a 7-node board, while `playerStart` dropped 12 →
     *    10. The competent bot scored **3% on L6 against 69% on L5**.
     *
     * So: assert continuity itself, at the boundary and along the ramp. Fails
     * on the pre-fix curve, where neutralLo stepped 6 → 10 at L6.
     *
     * The bound is "2 units, or 35%, whichever is kinder", not a bare ratio.
     * These knobs start at 2 and 4, where a one-unit step is a 50% step and
     * means nothing; a ratio-only rule would have to be loosened to ~1.6 to
     * clear L1→L2, at which point it no longer catches the 1.67× jump it exists
     * for.
     */
    const step = (a: number, b: number) => b - a <= Math.max(2, 0.35 * a);
    for (let L = 2; L <= 20; L++) {
      const lo = levelParams(L - 1);
      const hi = levelParams(L);
      expect(step(lo.neutralLo, hi.neutralLo), `neutralLo L${L - 1}→L${L}: ${lo.neutralLo}→${hi.neutralLo}`).toBe(true);
      expect(step(lo.neutralHi, hi.neutralHi), `neutralHi L${L - 1}→L${L}: ${lo.neutralHi}→${hi.neutralHi}`).toBe(true);
      expect(step(lo.enemyStart, hi.enemyStart), `enemyStart L${L - 1}→L${L}: ${lo.enemyStart}→${hi.enemyStart}`).toBe(true);
    }
  });
});
