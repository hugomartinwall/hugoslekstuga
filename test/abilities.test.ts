import { describe, expect, it } from "vitest";
import type { AbilityCharges, GameState, Node, Objective } from "../lib/overrun/sim/state";
import { hashState, PLAYER } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { BALANCED } from "../lib/overrun/sim/ai";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";
import { createLevel } from "../lib/overrun/sim/level";
import type { Command } from "../lib/overrun/sim/commands";

/**
 * Player abilities: validation, the three micro-proofs (each on a board where
 * WITH the ability the player provably achieves what WITHOUT it they provably
 * do not — the tiers.test.ts pattern), and the hashing contract that keeps
 * every ability-free level byte-identical to the pre-ability build.
 */

function makeState(
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units"> & Partial<Pick<Node, "kind" | "size">>>,
  opts: { abilities?: AbilityCharges; objective?: Objective; aiFirstMoveTick?: number } = {},
): GameState {
  const aiFirstMoveTick = opts.aiFirstMoveTick ?? 1_000_000;
  return {
    tick: 0,
    rng: { s: 42 },
    status: "playing",
    cfg: {
      level: 1,
      seed: 0, // hand-built board
      aiFirstMoveTick,
      aiIntervalTicks: 60,
      aiMinUnits: 5,
      aiOverkillMargin: 2,
      aiTier: 1,
      aiKillCertainty: 99, // behavior-neutral: kill layer effectively off
      aiSendFraction: 0.65,
      aiNeutralBonus: 25,
      aiKillPlayerBias: 1,
      factionCount: 2,
      ais: [{ faction: 2, persona: BALANCED, firstMoveTick: aiFirstMoveTick }],
      objective: opts.objective,
      playerProdInterval: PROD_INTERVAL,
      playerUpgradeCost: UPGRADE_COST,
      playerUpgradeTicks: UPGRADE_TICKS,
      ...(opts.abilities ? { abilities: opts.abilities } : {}),
    },
    nodes: nodes.map((n, id) => ({
      id,
      size: 1 as const,
      kind: 0 as const,
      guard: 0,
      upgrading: 0,
      selected: false,
      ...n,
    })),
    flows: [],
    packets: [],
    nextAiTick: [0, 0, aiFirstMoveTick, 0, 0],
    firstSendDone: true,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
    ...(opts.abilities ? { abilityCharges: { ...opts.abilities } } : {}),
    effects: { overcharge: [], stasis: [] },
  };
}

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks && state.status === "playing"; i++) tick(state, []);
}

const NONE: AbilityCharges = { overcharge: 0, stasis: 0, recall: 0 };

describe("useAbility validation — a charge is consumed on success only", () => {
  it("rejects without a charge, and without abilityCharges at all", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 80, y: 45, owner: 2, units: 10 },
      ],
      { abilities: { ...NONE } },
    );
    tick(s, [{ type: "useAbility", ability: "stasis", nodeId: 1 }]);
    expect(s.effects!.stasis).toEqual([]);

    // A hand-built state that predates abilities (no charges record) is a
    // no-op, never a crash.
    const bare = makeState([
      { x: 40, y: 45, owner: 1, units: 10 },
      { x: 80, y: 45, owner: 2, units: 10 },
    ]);
    delete bare.abilityCharges;
    tick(bare, [{ type: "useAbility", ability: "overcharge", nodeId: 0 }]);
    expect(bare.effects!.overcharge).toEqual([]);
  });

  it("enforces target legality: overcharge OWN, stasis NON-OWN — charge kept on refusal", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 80, y: 45, owner: 2, units: 10 },
      ],
      { abilities: { overcharge: 1, stasis: 1, recall: 0 } },
    );
    tick(s, [
      { type: "useAbility", ability: "overcharge", nodeId: 1 }, // enemy: illegal
      { type: "useAbility", ability: "stasis", nodeId: 0 }, // own: illegal
    ]);
    expect(s.effects!.overcharge).toEqual([]);
    expect(s.effects!.stasis).toEqual([]);
    expect(s.abilityCharges).toEqual({ overcharge: 1, stasis: 1, recall: 0 });

    // Legal use consumes exactly one and lands the effect.
    tick(s, [{ type: "useAbility", ability: "overcharge", nodeId: 0 }]);
    expect(s.abilityCharges!.overcharge).toBe(0);
    expect(s.effects!.overcharge).toEqual([{ node: 0, until: 1 + 300 }]);
  });

  it("recall with nothing in flight keeps its charge", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 80, y: 45, owner: 2, units: 10 },
      ],
      { abilities: { overcharge: 0, stasis: 0, recall: 1 } },
    );
    tick(s, [{ type: "useAbility", ability: "recall" }]);
    expect(s.abilityCharges!.recall).toBe(1);
  });

  it("expired effects are pruned and stop applying", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 80, y: 45, owner: 2, units: 10 },
      ],
      { abilities: { overcharge: 0, stasis: 1, recall: 0 } },
    );
    tick(s, [{ type: "useAbility", ability: "stasis", nodeId: 1 }]);
    expect(s.effects!.stasis.length).toBe(1);
    run(s, 155); // past until = 1 + 150
    expect(s.effects!.stasis).toEqual([]);
  });
});

describe("STASIS micro-proof: freezing the siege source is the difference between losing and winning", () => {
  /**
   * A lethal 12-unit stream is already committed at the player's only ball,
   * under an OUTLAST-160-ticks objective. Untouched, the wave lands around
   * t40 and the run is lost. Frozen for its 150 ticks, the emission cannot
   * even finish before the clock runs out — same board, same commands
   * otherwise, opposite verdict.
   */
  const board = (abilities?: AbilityCharges) => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 4 },
        { x: 70, y: 45, owner: 2, units: 20 },
      ],
      { objective: { type: "outlast", requiredTicks: 160 }, ...(abilities ? { abilities } : {}) },
    );
    s.flows.push({ from: 1, to: 0, remaining: 12 });
    return s;
  };

  it("WITHOUT stasis the player is overrun before the timer", () => {
    const s = board();
    run(s, 400);
    expect(s.status).toBe("lost");
  });

  it("WITH stasis the source freezes and the timer wins the level", () => {
    const s = board({ overcharge: 0, stasis: 1, recall: 0 });
    tick(s, [{ type: "useAbility", ability: "stasis", nodeId: 1 }]);
    // Frozen: no packet leaves the source while the effect lives.
    run(s, 100);
    expect(s.packets.length).toBe(0);
    expect(s.flows.length, "the flow survives the freeze — paused, not cancelled").toBe(1);
    run(s, 300);
    expect(s.status).toBe("won");
  });
});

describe("OVERCHARGE micro-proof: quartered production wins a race flat production loses", () => {
  /**
   * One player ball racing to crack a 30-unit neutral under a CLAIM-2
   * objective. The scripted play is identical — hoard for 300 ticks, then
   * send everything — and only the overcharge changes the answer: at the
   * stock 30-tick interval the ball banks ~20 units (short), overcharged to
   * an 8-tick interval it banks ~40 (capture).
   */
  const board = (abilities?: AbilityCharges) =>
    makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 70, y: 45, owner: 0, units: 30 },
        { x: 150, y: 85, owner: 2, units: 1 }, // a live rival so nothing auto-wins
      ],
      { objective: { type: "claim", quota: 2 }, ...(abilities ? { abilities } : {}) },
    );

  const hoardThenStrike = (s: GameState, useOvercharge: boolean): void => {
    tick(
      s,
      useOvercharge ? [{ type: "useAbility", ability: "overcharge", nodeId: 0 }] : [],
    );
    for (let i = 1; i < 300 && s.status === "playing"; i++) tick(s, []);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
  };

  it("WITHOUT overcharge the strike bounces", () => {
    const s = board();
    hoardThenStrike(s, false);
    expect(s.status).toBe("playing");
    expect(s.nodes[1]!.owner).toBe(0); // the neutral stands
  });

  it("WITH overcharge the same play captures and wins", () => {
    const s = board({ overcharge: 1, stasis: 0, recall: 0 });
    hoardThenStrike(s, true);
    expect(s.status).toBe("won");
    expect(s.nodes[1]!.owner).toBe(PLAYER);
  });
});

describe("RECALL micro-proof: turning an overcommitted wave around saves the home it left", () => {
  /**
   * Twenty player units are mid-flight toward a 60-unit fortress they can
   * only feed (a lost cause), while a 15-unit counterwave heads for the
   * 2-unit home they left behind. Without recall the home falls and the run
   * ends; recalled at t50, the wave lands home at t100 — before the enemy
   * arrivals finish — and the board holds.
   */
  const board = (abilities?: AbilityCharges) => {
    const s = makeState(
      [
        { x: 30, y: 45, owner: 1, units: 2 },
        { x: 130, y: 45, owner: 2, units: 60 },
      ],
      abilities ? { abilities } : {},
    );
    for (let i = 0; i < 20; i++) {
      s.packets.push({ owner: 1, from: 0, to: 1, departTick: 0, arriveTick: 100 });
    }
    s.flows.push({ from: 1, to: 0, remaining: 15 });
    return s;
  };

  it("WITHOUT recall the wave feeds the fortress and the home falls", () => {
    const s = board();
    run(s, 400);
    expect(s.status).toBe("lost");
  });

  it("WITH recall the wave flies home from where it was and defends", () => {
    const s = board({ overcharge: 0, stasis: 0, recall: 1 });
    run(s, 50);
    tick(s, [{ type: "useAbility", ability: "recall" }]);
    expect(s.abilityCharges!.recall).toBe(0);
    // Rebuilt around the floating origin: at t50 the wave sat halfway
    // (x = 80), 50 wu from home, so every PLAYER packet now flies 0 <- (80,45),
    // departing t50 and arriving t100. Exact, not approximate — recall is
    // sim arithmetic, and these are the numbers hashState signs. The enemy's
    // own packets (also in flight toward node 0) must be untouched.
    const mine = s.packets.filter((p) => p.owner === PLAYER);
    expect(mine.length).toBe(20);
    for (const p of mine) {
      expect(p.to).toBe(0);
      expect(p.departTick).toBe(50);
      expect(p.arriveTick).toBe(100);
      expect(p.fx).toBe(80);
      expect(p.fy).toBe(45);
    }
    expect(s.packets.some((p) => p.owner !== PLAYER && p.fx !== undefined)).toBe(false);
    run(s, 350);
    expect(s.status).toBe("playing");
    expect(s.nodes[0]!.owner).toBe(PLAYER);
  });
});

describe("hashing contract — ability-free levels stay byte-identical", () => {
  /** The determinism.test.ts scripted player, on a screened mid-game level. */
  const runLevel = (ticks: number): GameState => {
    const state = createLevel(7);
    const nodeCount = state.nodes.length;
    for (let i = 0; i < ticks; i++) {
      const commands: Command[] = [];
      if (i % 47 === 0) commands.push({ type: "selectNode", nodeId: i % nodeCount });
      if (i % 90 === 30) commands.push({ type: "sendUnits", from: 0, to: (i / 7) % nodeCount | 0 });
      tick(state, commands);
    }
    return state;
  };

  it("an ability-free sim is deterministic run-vs-run, and its new fields are hash-invisible", () => {
    const a = runLevel(500);
    const b = runLevel(500);
    expect(hashState(a)).toBe(hashState(b));
    // The golden guard: cfg.abilities is absent and no effect ever formed, so
    // stripping the new fields entirely must not move the hash — which is the
    // executable statement that every hash recorded before abilities existed
    // (the marketing demo's pinned values included) is still valid.
    const stripped = structuredClone(a);
    delete stripped.abilityCharges;
    delete stripped.effects;
    expect(hashState(stripped)).toBe(hashState(a));
    // And empty-vs-absent effects are indistinguishable by construction.
    const emptied = structuredClone(a);
    emptied.effects = { overcharge: [], stasis: [] };
    expect(hashState(emptied)).toBe(hashState(a));
  });

  it("charges are hashed exactly when the level granted abilities", () => {
    const nodes = [
      { x: 40, y: 45, owner: 1 as const, units: 10 },
      { x: 80, y: 45, owner: 2 as const, units: 10 },
    ];
    // No grant: corrupt/foreign charge counts are invisible to the hash.
    const plain = makeState(nodes);
    const drifted = structuredClone(plain);
    drifted.abilityCharges = { overcharge: 7, stasis: 7, recall: 7 };
    expect(hashState(drifted)).toBe(hashState(plain));

    // Granted: spending a charge is a state change the hash must see.
    const granted = makeState(nodes, { abilities: { overcharge: 1, stasis: 0, recall: 0 } });
    const spent = structuredClone(granted);
    spent.abilityCharges!.overcharge = 0;
    expect(hashState(spent)).not.toBe(hashState(granted));
  });

  it("live effects and floating origins change the hash; expiry restores nothing", () => {
    const nodes = [
      { x: 40, y: 45, owner: 1 as const, units: 10 },
      { x: 80, y: 45, owner: 2 as const, units: 10 },
    ];
    const base = makeState(nodes);
    const withEffect = structuredClone(base);
    withEffect.effects!.stasis.push({ node: 1, until: 100 });
    expect(hashState(withEffect)).not.toBe(hashState(base));

    const withPacket = structuredClone(base);
    withPacket.packets.push({ owner: 1, from: 0, to: 1, departTick: 0, arriveTick: 30 });
    const withOrigin = structuredClone(withPacket);
    withOrigin.packets[0]!.fx = 55;
    withOrigin.packets[0]!.fy = 45;
    expect(hashState(withOrigin)).not.toBe(hashState(withPacket));
  });

  it("ability sims are deterministic: same board, same commands, same hash", () => {
    const play = (): GameState => {
      const s = makeState(
        [
          { x: 30, y: 45, owner: 1, units: 12 },
          { x: 70, y: 45, owner: 0, units: 8 },
          { x: 130, y: 45, owner: 2, units: 30 },
        ],
        { abilities: { overcharge: 1, stasis: 1, recall: 1 }, aiFirstMoveTick: 20 },
      );
      tick(s, [{ type: "useAbility", ability: "overcharge", nodeId: 0 }]);
      for (let i = 1; i < 60; i++) tick(s, []);
      tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
      for (let i = 0; i < 20; i++) tick(s, []);
      tick(s, [{ type: "useAbility", ability: "recall" }]);
      tick(s, [{ type: "useAbility", ability: "stasis", nodeId: 2 }]);
      for (let i = 0; i < 300 && s.status === "playing"; i++) tick(s, []);
      return s;
    };
    const a = play();
    const b = play();
    expect(hashState(a)).toBe(hashState(b));
    expect(a.status).toBe(b.status);
  });
});
