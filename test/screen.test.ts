import { describe, expect, it } from "vitest";
import {
  bandFor,
  MAX_CANDIDATES,
  PROBE_COUNTS,
  screenLevel,
  seedSequence,
} from "../lib/overrun/sim/screen";
import { createLevel, defaultSeedFor, DEFAULT_BOOSTS, factionsForLevel } from "../lib/overrun/sim/level";
import { hashState } from "../lib/overrun/sim/state";
import { play } from "../lib/overrun/sim/solver";

/**
 * The board screen, which is the thing standing between a player and a level
 * they cannot beat.
 *
 * The defect it exists for: a level number named exactly one board, and whether
 * that board was winnable was nobody's job. L6 shipped with all four neutrals
 * rolling 14 against a player holding 10 — no opening move existed — and the
 * checkpoint floor sent every lost run straight back to it.
 */

/** Levels cheap enough to sweep in a unit test. Screening costs ~25 ms each. */
const SWEEP = 24;

describe("seed sequence", () => {
  it("hands back the level's historic board first, so good boards are kept", () => {
    // This is most of the value of the change being surgical: a level whose
    // shipped board already measures well keeps that exact board.
    for (const L of [1, 5, 9, 14, 20]) {
      expect(seedSequence(L, 0)(), `L${L}`).toBe(defaultSeedFor(L));
    }
  });

  it("starts somewhere else on a retry — this is the unstick mechanism", () => {
    for (const L of [1, 6, 12, 17]) {
      const first = seedSequence(L, 0)();
      for (const attempt of [1, 2, 3]) {
        expect(seedSequence(L, attempt)(), `L${L} attempt ${attempt}`).not.toBe(first);
      }
    }
  });

  it("gives uncorrelated successive candidates, not neighbours of a failure", () => {
    // A weak step function would retry near-identical boards and burn the whole
    // candidate budget rediscovering the same failure.
    const next = seedSequence(7, 0);
    const seeds = Array.from({ length: MAX_CANDIDATES }, () => next());
    expect(new Set(seeds).size).toBe(seeds.length);
    // And they must produce genuinely different boards, not just different ints.
    const boards = new Set(seeds.map((s) => hashState(createLevel(7, DEFAULT_BOOSTS, s))));
    expect(boards.size).toBe(seeds.length);
  });

  it("is reproducible: a board is named by (level, attempt) and nothing else", () => {
    // No stored seed, no Math.random. A reload mid-level rebuilds the same board,
    // and a bug report names one.
    for (const [L, a] of [[6, 0], [6, 2], [17, 1]] as const) {
      const one = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, a));
      const two = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, a));
      expect(one.seed, `L${L} attempt ${a}`).toBe(two.seed);
      expect(hashState(one.state)).toBe(hashState(two.state));
    }
  });
});

describe("the screen", () => {
  it("finds a board inside the band for every level, without falling back", () => {
    // `accepted: false` means the budget ran out and the player is being handed
    // a best-of. It should not happen on the levels most players ever see.
    const fallbacks: string[] = [];
    const misses: string[] = [];
    for (let L = 1; L <= SWEEP; L++) {
      const r = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 0));
      const band = bandFor(L);
      if (!r.accepted) fallbacks.push(`L${L}`);
      if (r.wins < band.minWins) misses.push(`L${L}: ${r.wins}/${band.minWins} wins`);
      if (r.carelessWins > band.maxCarelessWins) {
        misses.push(`L${L}: ${r.carelessWins} careless > ${band.maxCarelessWins}`);
      }
    }
    expect(fallbacks, `best-of fallbacks: ${fallbacks.join(",")}`).toEqual([]);
    expect(misses, `accepted a board outside its band: ${misses.join("; ")}`).toEqual([]);
  });

  it("keeps some historic boards and replaces others", () => {
    // Both halves matter. All-kept would mean the screen never fires; all-new
    // would mean it re-rolled a game that was mostly fine.
    let kept = 0;
    let replaced = 0;
    for (let L = 1; L <= SWEEP; L++) {
      const r = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 0));
      if (r.seed === defaultSeedFor(L)) kept++;
      else replaced++;
    }
    expect(kept, "the screen replaced every board — it is not surgical").toBeGreaterThan(5);
    expect(replaced, "the screen replaced nothing — it never fired").toBeGreaterThan(2);
  });

  it("makes the teaching levels winnable by EVERY probe, not just the band", () => {
    // CLAUDE.md §6: 80% of players must still be playing one minute in, and a
    // first-timer is worse than every policy in the probe set.
    for (const L of [1, 2, 3]) {
      const r = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 0));
      expect(r.wins, `L${L}`).toBe(PROBE_COUNTS.competent);
    }
  });

  it("a retry board is a different board, and still a winnable one", () => {
    // The actual answer to "I can't get past level 6": losing hands you another
    // verified board rather than the wall you just failed.
    for (const L of [6, 12, 17]) {
      const first = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 0));
      const retry = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 1));
      expect(retry.seed, `L${L} retry drew the same board`).not.toBe(first.seed);
      expect(hashState(retry.state)).not.toBe(hashState(first.state));
    }
  });

  it("never hands over an unwinnable board, on any level or any attempt", () => {
    /**
     * The floor the whole feature exists to provide, asserted over the retry
     * path too — a guarantee that only held on first attempts would miss exactly
     * the players it is for.
     *
     * Two of the 120 screens below exhaust the budget and return a best-of
     * rather than a pass (both on L12, the 3-way debut, which is the most
     * starved topology at its least-boosted level). That is why this asserts
     * WINNABLE rather than `accepted` — a best-of is allowed, an unwinnable
     * board is not. Measured, the worst board in the sweep wins 2 of 12 probes
     * and 11% of the independent 108-policy portfolio; the levels this replaces
     * shipped at 3-4%.
     */
    const floor: string[] = [];
    for (let L = 1; L <= SWEEP; L++) {
      for (let attempt = 0; attempt <= 4; attempt++) {
        const r = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, attempt));
        if (r.wins < 2) floor.push(`L${L} attempt ${attempt}: ${r.wins}/12`);
      }
    }
    expect(floor, `boards below the winnability floor: ${floor.join("; ")}`).toEqual([]);
  });

  it("verifies with the bot that actually plays it — checked independently", () => {
    // Guards against the screen reporting a pass it cannot back up: replay the
    // chosen board with a policy that is NOT in the probe set and require a win.
    // DEFAULT_BOT's shape (margin 2, maxFronts 2, frontGarrison 10) appears in
    // no COMPETENT entry, so this cannot be the screen marking its own homework.
    const outsider = { frontDist: 60, frontGarrison: 10, margin: 2, garrisonFrac: 0.25, maxFronts: 2, perCycle: 2, phase: 5 };
    const lost: string[] = [];
    for (const L of [1, 2, 3, 4, 5]) {
      const r = screenLevel(L, DEFAULT_BOOSTS, seedSequence(L, 0));
      if (play(L, 150, outsider, () => {}, DEFAULT_BOOSTS, r.seed).status !== "won") lost.push(`L${L}`);
    }
    expect(lost, `an unseen policy lost a teaching board: ${lost.join(",")}`).toEqual([]);
  });

  it("never returns fewer than one candidate, whatever the budget", () => {
    const r = screenLevel(9, DEFAULT_BOOSTS, seedSequence(9, 0), 0);
    expect(r.candidates).toBeGreaterThanOrEqual(1);
    expect(r.state.nodes.length).toBeGreaterThan(0);
  });
});

describe("difficulty bands", () => {
  it("never gets easier as levels rise, within a topology", () => {
    // Per topology, not globally: the 3-way board carries a lower floor for a
    // structural reason (4 neutrals for 3 factions), so a global sweep would be
    // asserting that triads never follow duels — which is a schedule fact, not a
    // difficulty one.
    for (const way of [2, 3, 4]) {
      let prev = Infinity;
      for (let L = 4; L <= 200; L++) {
        if (factionsForLevel(L) !== way) continue;
        const m = bandFor(L).minWins;
        expect(m, `${way}-way L${L}`).toBeLessThanOrEqual(prev);
        prev = m;
      }
    }
  });

  it("gives the 3-way board a lower floor than its neighbours, and only the 3-way", () => {
    // The exemption is structural and must stay narrow. If it ever widened to
    // duels, the screen would quietly stop doing its job on 3/5 of the game.
    for (let L = 9; L <= 60; L++) {
      const expected = factionsForLevel(L) === 3;
      const neighbourFloor = L <= 20 ? 5 : 4;
      expect(bandFor(L).minWins < neighbourFloor, `L${L} (${factionsForLevel(L)}-way)`).toBe(
        expected,
      );
    }
  });

  it("stays inside the probe sets it is measured against", () => {
    // A floor above the probe count is unsatisfiable and would make every level
    // a best-of fallback; a ceiling above it is a no-op that silently disables
    // the careless check.
    for (let L = 1; L <= 200; L++) {
      const b = bandFor(L);
      expect(b.minWins, `L${L} floor`).toBeGreaterThan(0);
      expect(b.minWins, `L${L} floor`).toBeLessThanOrEqual(PROBE_COUNTS.competent);
      expect(b.maxCarelessWins, `L${L} ceiling`).toBeLessThanOrEqual(PROBE_COUNTS.careless);
    }
  });
});
