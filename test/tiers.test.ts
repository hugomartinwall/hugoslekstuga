import { describe, expect, it } from "vitest";
import type { Faction } from "../lib/overrun/sim/state";
import { KIND_VOLATILE, KIND_SIPHON, NEUTRAL } from "../lib/overrun/sim/state";

import { BALANCED, MAX_TIER } from "../lib/overrun/sim/ai";
import {
  createLevel,
  factionsForLevel,
  isBossLevel,
  levelParams,
  TRIAD_LEVEL_CAP,
} from "../lib/overrun/sim/level";
import { PROD_INTERVAL, UPGRADE_COST } from "../lib/overrun/sim/constants";
import { fires, makeState, run } from "./sim-harness";

/**
 * Phase 3A.4: AI capability past tier 4.
 *
 * Tier 4 already runs its kill check every tick, so tiers 5–7 add powers, not
 * speed. Each new power gets a board where a lower tier demonstrably does NOT
 * do the thing and the higher tier does — a same-board pair, so the assertion
 * is about the capability and not about the scenario being winnable.
 */

const ai = (tier: number, faction: Faction = 2) => ({
  ais: [{ faction, persona: BALANCED, firstMoveTick: 0, tier }],
  tier,
  interval: 30,
});

describe("tier lookup", () => {
  it("an out-of-range tier clamps to the TOP tier, not down to tier 1", () => {
    // Regression: this was `TIERS[cfg.aiTier] ?? TIERS[1]`, so the moment a
    // tier past 4 was assigned the AI silently became the weakest in the game.
    // Behavioural proxy: tier 99 must play at least as actively as tier 7.
    const activity = (tier: number): number => {
      const s = makeState(
        [
          { x: 20, y: 45, owner: 2 as Faction, units: 60 },
          { x: 60, y: 45, owner: NEUTRAL, units: 5 },
          { x: 100, y: 45, owner: NEUTRAL, units: 5 },
          { x: 140, y: 45, owner: 1, units: 10 },
        ],
        ai(tier),
      );
      let sends = 0;
      let seen = 0;
      for (let i = 0; i < 600 && s.status === "playing"; i++) {
        run(s, 1);
        if (s.flows.length !== seen) sends++;
        seen = s.flows.length;
      }
      return sends;
    };
    expect(activity(99)).toBeGreaterThanOrEqual(activity(MAX_TIER) * 0.9);
    // And the top tier is meaningfully more active than tier 1.
    expect(activity(MAX_TIER)).toBeGreaterThan(activity(1));
  });
});

describe("tier 5: reinforce a node that is about to fall", () => {
  it("tier 5 saves a doomed node where tier 4 keeps attacking", () => {
    /**
     * Faction 2 holds a rich rear node and a thin frontline node that a big
     * player wave is already committed to. Tier 4's only defensive move is the
     * no-safe-attack fallback, which never fires while a juicy neutral exists;
     * tier 5 reinforces first.
     */
    /**
     * Asserts the CAPABILITY — "does it ever send to its own threatened node" —
     * not a downstream outcome like who owns the node at tick N.
     *
     * Outcome assertions do not survive here: every tier from 3 to 7 loses this
     * node at t64 and retakes it, so "is it ours at tick N" flips answer with N
     * (tier 4 reads as failing at 200–900 ticks and succeeding at 1500) and
     * "was it ever lost" is false for all of them. Reinforcing is the thing
     * tier 5 can do and tier 4 cannot; measure that.
     */
    const reinforcesAt = (tier: number): number => {
      const s = makeState(
        [
          { x: 30, y: 45, owner: 2 as Faction, units: 60 }, // rich rear
          { x: 70, y: 45, owner: 2 as Faction, units: 4 }, // thin frontline
          { x: 120, y: 45, owner: 1, units: 40 }, // attacker
          { x: 30, y: 15, owner: NEUTRAL, units: 3 }, // tempting cheap neutral
        ],
        ai(tier),
      );
      // The player commits everything at the thin node on tick 0.
      for (let i = 0; i < 400 && s.status === "playing"; i++) {
        run(s, 1, () => (i === 0 ? [{ type: "sendUnits", from: 2, to: 1 }] : []));
        if (
          s.nodes[1]!.owner === 2 &&
          s.flows.some((f) => f.to === 1 && s.nodes[f.from]!.owner === 2)
        ) {
          return i;
        }
      }
      return -1;
    };
    // Tiers 3 and 4 have no defensive branch but the no-safe-attack fallback,
    // which never fires while a cheap neutral is on the board.
    expect(reinforcesAt(3)).toBe(-1);
    expect(reinforcesAt(4)).toBe(-1);
    expect(reinforcesAt(5)).toBeGreaterThanOrEqual(0);
    expect(reinforcesAt(7)).toBeGreaterThanOrEqual(0);
  });
});

describe("tier 6: builds economy under pressure", () => {
  it("upgrades with a hostile nearby, where tier 4 waits for quiet", () => {
    const upgraded = (tier: number): boolean => {
      const s = makeState(
        [
          // Rich enough to afford it, with a hostile 30 wu away — inside tier
          // 4's 56 wu safety radius, outside tier 6's 19.6 wu one.
          //
          // The hostile is deliberately fat: at 5 units it would be a legal
          // snipe target, and the kill layer returns BEFORE tryUpgrade ever
          // runs, so the test would have measured sniping rather than building.
          { x: 60, y: 45, owner: 2 as Faction, units: 60, size: 0 },
          { x: 90, y: 45, owner: 1, units: 40 },
        ],
        ai(tier),
      );
      run(s, 300);
      return s.nodes[0]!.size > 0 || s.nodes[0]!.upgrading !== 0;
    };
    expect(upgraded(4)).toBe(false);
    expect(upgraded(6)).toBe(true);
  });

  it("tier 6 starts two upgrades in one wake where tier 5 starts one", () => {
    const started = (tier: number): number => {
      const s = makeState(
        [
          { x: 30, y: 20, owner: 2 as Faction, units: 60, size: 0 },
          { x: 30, y: 70, owner: 2 as Faction, units: 60, size: 0 },
          // Far away, and far too big to attack even with focus fire — at 40
          // units the pair would gang up on it, and both sources then have an
          // outgoing flow, which tryUpgrade skips. The test would have measured
          // focus fire instead of upgrades.
          { x: 150, y: 45, owner: 1, units: 200 },
        ],
        ai(tier),
      );
      run(s, 1); // exactly one wake
      return [s.nodes[0]!, s.nodes[1]!].filter((n) => n.upgrading !== 0).length;
    };
    expect(started(5)).toBe(1);
    expect(started(6)).toBe(2);
  });
});

describe("tier 5+: reads the board's node kinds", () => {
  it("declines a volatile that would blast its own cluster, and takes the twin that would not", () => {
    /**
     * Two identical volatile neutrals equidistant from the attacker. One sits
     * beside three of the AI's own nodes; the other sits alone. Only a
     * kind-aware tier can tell them apart — to tier 4 they are the same node.
     */
    const targetOf = (tier: number): number => {
      const s = makeState(
        [
          { x: 80, y: 45, owner: 2 as Faction, units: 60 }, // attacker
          { x: 40, y: 45, owner: NEUTRAL, units: 5, kind: KIND_VOLATILE }, // near own cluster
          { x: 120, y: 45, owner: NEUTRAL, units: 5, kind: KIND_VOLATILE }, // isolated
          { x: 32, y: 35, owner: 2 as Faction, units: 20 },
          { x: 32, y: 55, owner: 2 as Faction, units: 20 },
          { x: 45, y: 30, owner: 2 as Faction, units: 20 },
          { x: 80, y: 85, owner: 1, units: 10 },
        ],
        ai(tier),
      );
      run(s, 3);
      const f = s.flows.find((x) => x.from === 0);
      return f ? f.to : -1;
    };
    expect(targetOf(5)).toBe(2); // the isolated one
    expect(targetOf(4)).toBe(1); // blind to the blast, takes the nearer one
  });

  it("avoids parking next to a hostile siphon", () => {
    const targetOf = (tier: number): number => {
      const s = makeState(
        [
          { x: 80, y: 45, owner: 2 as Faction, units: 60 }, // attacker
          { x: 40, y: 45, owner: NEUTRAL, units: 5 }, // in a hostile siphon's reach
          { x: 120, y: 45, owner: NEUTRAL, units: 5 }, // clear
          { x: 30, y: 52, owner: 1, units: 20, kind: KIND_SIPHON },
          { x: 80, y: 85, owner: 1, units: 10 },
        ],
        ai(tier),
      );
      run(s, 3);
      const f = s.flows.find((x) => x.from === 0);
      return f ? f.to : -1;
    };
    expect(targetOf(5)).toBe(2);
    expect(targetOf(4)).toBe(1);
  });

  it("but still takes the siphon ITSELF — that is the counter, not a hazard", () => {
    /**
     * The proximity penalty must skip the siphon node when the siphon IS the
     * candidate. Without that skip it penalised itself, netting −1 against
     * KIND_LURE's +5, and the kind-aware tiers walked past the very node
     * draining them while tier 4 happily took it. Two identical player nodes
     * at equal distance; only the kind differs.
     */
    const targetOf = (tier: number): number => {
      const s = makeState(
        [
          { x: 80, y: 45, owner: 2 as Faction, units: 60 }, // attacker
          { x: 40, y: 45, owner: 1, units: 5, kind: KIND_SIPHON },
          { x: 120, y: 45, owner: 1, units: 5 }, // identical but plain
          { x: 80, y: 85, owner: 1, units: 10 },
        ],
        ai(tier),
      );
      run(s, 3);
      const f = s.flows.find((x) => x.from === 0);
      return f ? f.to : -1;
    };
    // Every tier prefers the siphon: KIND_LURE ranks it above a plain node.
    expect(targetOf(4)).toBe(1);
    expect(targetOf(5)).toBe(1);
    expect(targetOf(7)).toBe(1);
  });
});

describe("tier 9: three sources on one target", () => {
  it("cracks a node no pair of its nodes could take", () => {
    /**
     * A 40-unit neutral against three rivals holding 30 each. Each raises
     * floor(0.65 × 30) = 19, and focus fire commits when the wave beats
     * need + margin = 48. Any PAIR raises 38 and is permanently short; three
     * raise 57. The node is not "hard" for tiers 3–8, it is unreachable, for
     * as long as they care to sit there.
     */
    const takes = (tier: number): boolean => {
      const s = makeState(
        [
          { x: 30, y: 25, owner: 2 as Faction, units: 30 },
          { x: 30, y: 65, owner: 2 as Faction, units: 30 },
          { x: 55, y: 45, owner: 2 as Faction, units: 30 },
          { x: 80, y: 45, owner: NEUTRAL, units: 40 },
          { x: 150, y: 45, owner: 1, units: 30 },
        ],
        { ...ai(tier), minUnits: 15 },
      );
      run(s, 200);
      return s.nodes[3]!.owner === 2;
    };
    expect(takes(9), "tier 9 converges three").toBe(true);
    expect(takes(8), "tier 8 can only pair up").toBe(false);
  });
});

describe("tier 8: evacuates a node it cannot hold", () => {
  it("walks the garrison out instead of donating it to the attacker", () => {
    /**
     * Faction 2's frontline node holds 8 against 30 already in the air — lost
     * on packets that have departed, not on a guess. There is no rescue: the
     * rear node holds too little to cover the deficit, so tier 8's reinforce
     * branch finds no source and leaves the units to be captured.
     *
     * Asserted on the DECISION, not on an outcome at a chosen horizon. Both
     * tiers lose the node — that is the premise — and counting the rear node's
     * units later measures the wrong thing: the evacuated units arrive, push
     * the rear node over aiMinUnits sooner, and it spends them attacking, so
     * the tier that saved MORE material reads as having less. Phase 2.5 caught
     * the identical trap in the tier-5 reinforce test.
     */
    const evacuates = (tier: number): boolean => {
      const s = makeState(
        [
          { x: 40, y: 45, owner: 2 as Faction, units: 8 }, // doomed frontline
          { x: 20, y: 20, owner: 2 as Faction, units: 6 }, // rear, too poor to rescue
          { x: 150, y: 45, owner: 1, units: 60 },
        ],
        ai(tier),
      );
      s.flows.push({ from: 2, to: 0, remaining: 30 });
      // 40 ticks, not 4. The threat is counted in PACKETS, so at the tick-0
      // wake the flow has emitted nothing and inboundHostile is still 0 —
      // there is nothing to retreat from yet. Tier 8 pulls out at t37, on the
      // first wake where the wave is actually in the air; the node falls at
      // t136, so this is well inside the window rather than at the end of it.
      run(s, 40);
      const out = s.flows.find((f) => f.from === 0);
      return out !== undefined && s.nodes[out.to]!.owner === 2;
    };
    expect(evacuates(8), "tier 8 must pull out").toBe(true);
    expect(evacuates(7), "tier 7 must stand and lose the units").toBe(false);
  });

  it("does not abandon a node that a rescue is already reaching", () => {
    // The race this branch could easily lose: tryReinforce sends help, then
    // tryEvacuate empties the node the help was for. Run past t37 — the tick
    // the test above shows the retreat firing on the identical board minus the
    // rescue — so a pass here means the guard held, not that nothing ran yet.
    const s = makeState(
      [
        { x: 40, y: 45, owner: 2 as Faction, units: 8 },
        { x: 55, y: 45, owner: 2 as Faction, units: 40 }, // able to rescue
        { x: 150, y: 45, owner: 1, units: 60 },
      ],
      ai(8),
    );
    s.flows.push({ from: 2, to: 0, remaining: 12 });
    run(s, 60);
    expect(s.nodes[0]!.owner, "node 0 is meant to be held, not lost").toBe(2);
    const outbound = s.flows.find((f) => f.from === 0);
    expect(outbound, "node 0 must not be evacuating while help is inbound").toBeUndefined();
  });
});

describe("level curves keep climbing", () => {
  it("aiTier rises past 4 and reaches the ceiling", () => {
    expect(levelParams(13).aiTier).toBe(4);
    expect(levelParams(17).aiTier).toBe(4);
    expect(levelParams(18).aiTier).toBe(5);
    expect(levelParams(25).aiTier).toBe(6);
    expect(levelParams(33).aiTier).toBe(7);
    expect(levelParams(200).aiTier).toBe(MAX_TIER);
  });

  it("the aggression knobs never regress, within a topology, swept to L60", () => {
    /**
     * Per topology, not globally — and that is a real weakening of this test, so
     * it is worth saying why.
     *
     * Triads freeze their whole difficulty vector at TRIAD_LEVEL_CAP, because
     * the 3-way board is structurally starved (4 neutrals for 3 factions inside
     * 27% of the world) and past that cap essentially no seed produces a board a
     * competent player can win — measured over 60 candidates a level. So a late
     * triad is genuinely less hostile than the quad before it, and a global
     * sweep would be asserting that topologies never alternate, which is a
     * schedule fact rather than a difficulty one.
     *
     * What still has to hold, and does: each topology's own curve climbs.
     */
    for (const way of [2, 3, 4]) {
      let lo: ReturnType<typeof levelParams> | null = null;
      for (let L = 2; L <= 60; L++) {
        if (factionsForLevel(L) !== way) continue;
        const hi = levelParams(L);
        if (lo) {
          const tag = `${way}-way L${L}`;
          expect(hi.aiTier, tag).toBeGreaterThanOrEqual(lo.aiTier);
          expect(hi.aiKillCertainty, tag).toBeLessThanOrEqual(lo.aiKillCertainty);
          expect(hi.aiSendFraction, tag).toBeGreaterThanOrEqual(lo.aiSendFraction);
          expect(hi.aiNeutralBonus, tag).toBeLessThanOrEqual(lo.aiNeutralBonus);
          expect(hi.enemyStart, tag).toBeGreaterThanOrEqual(lo.enemyStart);
        }
        lo = hi;
      }
    }
  });

  it("freezes the 3-way difficulty vector at the cap, and only the 3-way", () => {
    // The compensation must be exactly as narrow as the deficit. If it ever
    // leaked to duels or quads, the late game would quietly stop climbing.
    const capped = levelParams(TRIAD_LEVEL_CAP);
    for (let L = TRIAD_LEVEL_CAP + 1; L <= 120; L++) {
      const p = levelParams(L);
      if (factionsForLevel(L) === 3) {
        expect(p.aiTier, `L${L}`).toBe(capped.aiTier);
        expect(p.enemyStart, `L${L}`).toBe(capped.enemyStart);
        expect(p.aiSendFraction, `L${L}`).toBe(capped.aiSendFraction);
        // The board still knows which level it is — biome, boss schedule and the
        // HUD label all read this, and only the knobs are capped.
        expect(p.level, `L${L}`).toBe(L);
      } else {
        expect(p.enemyStart, `L${L} must not be capped`).toBeGreaterThanOrEqual(capped.enemyStart);
      }
    }
    // The freeze must reach the SHIPPED cfg, not just levelParams: a late
    // triad's board plays at the capped tier while keeping its true level as
    // its identity. (An earlier version asserted `cfg.level === 80`, which is
    // a verbatim copy of the argument and could not fail.)
    const lateTriad = createLevel(80);
    expect(factionsForLevel(80)).toBe(3);
    expect(lateTriad.cfg.aiTier).toBe(capped.aiTier);
    expect(lateTriad.cfg.level).toBe(80);
  });

  it("promotes exactly one rival a tier above the board on a boss level", () => {
    // The L38/L44 regression: `min(MAX_TIER, aiTier + 1)` promoted nobody once
    // aiTier hit the ceiling, so the set piece had no boss. Bosses force
    // 4-way, so every boss board has three rivals — exactly one is promoted,
    // and the promotion is real (strictly above the board tier).
    for (const L of [14, 38, 44, 56]) {
      const board = createLevel(L);
      const promoted = board.cfg.ais.filter((a) => a.tier !== undefined);
      expect(promoted.length, `L${L}`).toBe(1);
      const boardTier = levelParams(L).aiTier;
      expect(promoted[0]!.tier!, `L${L}`).toBe(Math.min(MAX_TIER, boardTier + 1));
      expect(promoted[0]!.tier!, `L${L}`).toBeGreaterThan(boardTier);
    }
  });

  it("enemyStart eases across the 3-way debut, holds at 14, then grows to a 24 cap", () => {
    // L1–5 are hand-tuned overrides (8/10/12/12/12); the formula owns L6 up.
    // L6–L8 are eased because enemyStart is PER RIVAL, so the player's total
    // opposition doubles at the 3-way debut without any knob changing value.
    expect([6, 7, 8].map((L) => levelParams(L).enemyStart)).toEqual([12, 13, 13]);
    for (let L = 9; L <= 16; L++) expect(levelParams(L).enemyStart, `L${L}`).toBe(14);
    expect(levelParams(17).enemyStart).toBe(14);
    expect(levelParams(20).enemyStart).toBe(16);
    expect(levelParams(36).enemyStart).toBe(24); // 2-way, so the curve runs free
    expect(levelParams(60).enemyStart).toBe(24); // capped at 24
    // L80 is a TRIAD, so it is frozen at the L20 vector instead — that is the
    // structural compensation, not the 24 cap. Asserted here because this test
    // used to read L80 as evidence for the cap and would have gone on passing
    // for the wrong reason if the topology under it changed again.
    expect(factionsForLevel(80)).toBe(3);
    expect(levelParams(80).enemyStart).toBe(levelParams(TRIAD_LEVEL_CAP).enemyStart)
  });

  it("the start gap stops widening — it used to reach 16 and end games in 4 s", () => {
    // enemyStart is PER RIVAL, so the aggregate deficit already scales with
    // faction count. Letting the per-rival gap grow on top of that is what made
    // L30–60 unwinnable rather than hard.
    for (let L = 6; L <= 200; L++) {
      const p = levelParams(L);
      expect(p.enemyStart - p.playerStart, `L${L}`).toBeLessThanOrEqual(7);
    }
  });

  it("the AI still pays base upgrade cost — meta boosts stay player-only", () => {
    const s = makeState(
      [
        { x: 60, y: 45, owner: 2 as Faction, units: UPGRADE_COST[0] + 8, size: 0 },
        { x: 150, y: 45, owner: 1, units: 200 }, // too big to attack or snipe
      ],
      ai(6),
    );
    run(s, 5);
    expect(s.nodes[0]!.upgrading).not.toBe(0);
    // Base cost deducted, plus whatever the node produced in those 5 ticks
    // (production runs after the AI within the same tick, so tick 0 counts).
    expect(s.nodes[0]!.units).toBe(8 + fires(5, PROD_INTERVAL[0]));
  });
});

describe("boss rivals outclass their board", () => {
  // Derived, not listed: a boss level added past the end of the tier curve has
  // to fail the headroom assertion below rather than quietly skip it.
  const BOSS_LEVELS: number[] = [];
  for (let L = 1; L <= 200; L++) if (isBossLevel(L)) BOSS_LEVELS.push(L);

  it("exactly one rival is promoted on a boss level, and none on an ordinary one", () => {
    expect(BOSS_LEVELS.length).toBeGreaterThanOrEqual(6);
    for (const L of BOSS_LEVELS) {
      const cfg = createLevel(L).cfg;
      const promoted = cfg.ais.filter((a) => a.tier !== undefined);
      expect(promoted.length, `L${L}`).toBe(1);
    }
    for (const L of [13, 15, 21, 33, 45]) {
      const cfg = createLevel(L).cfg;
      expect(cfg.ais.every((a) => a.tier === undefined), `L${L}`).toBe(true);
    }
  });

  it("every boss rival really is above its board — the promotion is never a no-op", () => {
    /**
     * This replaces an assertion that pinned the bug in place. It read
     * `expect(promoted.tier).toBe(MAX_TIER)` for L38 and L44 and passed —
     * because base tier was already MAX_TIER there, so `min(MAX_TIER, base+1)`
     * promoted nobody and two of the six bosses had no boss. A test that
     * restates `min(MAX_TIER, base + 1)` cannot notice that the min is biting;
     * only a STRICT comparison against the board can.
     *
     * The fix is in the base tier curve, not here: it now stays below MAX_TIER
     * until after the last boss level, so there is always somewhere to promote
     * to. Which is also why this asserts the property and not the arithmetic —
     * adding a boss level past the end of the curve must fail this.
     */
    for (const L of BOSS_LEVELS) {
      const cfg = createLevel(L).cfg;
      const boss = cfg.ais.find((a) => a.tier !== undefined)!;
      expect(boss.tier, `L${L} boss vs board tier ${cfg.aiTier}`).toBeGreaterThan(cfg.aiTier);
      expect(boss.tier, `L${L}`).toBeLessThanOrEqual(MAX_TIER);
    }
  });
});
