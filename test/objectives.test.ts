import { describe, expect, it } from "vitest";
import type { GameState, Node, Objective } from "../lib/overrun/sim/state";
import { hashState, NEUTRAL, PLAYER } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { BALANCED } from "../lib/overrun/sim/ai";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";

/**
 * Objective archetypes: the win/lose dispatch, progress counters, and the AI's
 * objective behaviours. Boards are hand-built (the combat.test.ts pattern) —
 * the schedule that assigns objectives to real levels is tested in level.test.ts.
 */

function makeState(
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units"> & Partial<Pick<Node, "kind" | "size">>>,
  objective?: Objective,
  aiFirstMoveTick = 1_000_000,
): GameState {
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
      objective,
      playerProdInterval: PROD_INTERVAL,
      playerUpgradeCost: UPGRADE_COST,
      playerUpgradeTicks: UPGRADE_TICKS,
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
    firstSendDone: false,
    halfSendDone: false,
    holdTicks: 0,
    sendsUsed: 0,
  };
}

function run(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks && state.status === "playing"; i++) tick(state, []);
}

describe("crown", () => {
  it("capturing the crowned node wins instantly, even while behind on material", () => {
    // Rival is far richer; the player only has the spear for the crown.
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 12 },
        { x: 60, y: 45, owner: 2, units: 4 }, // the crown, lightly held
        { x: 120, y: 45, owner: 2, units: 60 }, // the empire the player ignores
      ],
      { type: "crown", targetNodeId: 1, playerCrownId: 0 },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
    expect(s.status).toBe("won");
    expect(s.nodes[2]!.owner).toBe(2); // the empire still stands — decapitation, not annihilation
  });

  it("losing the player's crowned home loses instantly, even with other nodes alive", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 2 }, // the crown, exposed
        { x: 20, y: 80, owner: 1, units: 40 }, // a healthy second node that cannot save it
        { x: 60, y: 45, owner: 2, units: 10 },
      ],
      { type: "crown", targetNodeId: 2, playerCrownId: 0 },
    );
    s.flows.push({ from: 2, to: 0, remaining: 10 });
    run(s, 300);
    expect(s.status).toBe("lost");
    expect(s.nodes[1]!.owner).toBe(1); // the loss was the crown, not the material
  });

  it("taking the rival crown on the tick your own falls is a win — won checks first", () => {
    // Both crowns flip on the same arrival tick: equidistant single packets.
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 0 }, // player crown, empty
        { x: 60, y: 45, owner: 2, units: 0 }, // rival crown, empty
      ],
      { type: "crown", targetNodeId: 1, playerCrownId: 0 },
    );
    // Both crowns produce one unit at tick 0, so each side needs a chip packet
    // before its capture packet; both captures land on the same tick.
    s.packets.push({ owner: 1, from: 0, to: 1, departTick: 0, arriveTick: 2 });
    s.packets.push({ owner: 1, from: 0, to: 1, departTick: 0, arriveTick: 3 });
    s.packets.push({ owner: 2, from: 1, to: 0, departTick: 0, arriveTick: 2 });
    s.packets.push({ owner: 2, from: 1, to: 0, departTick: 0, arriveTick: 3 });
    run(s, 10);
    expect(s.status).toBe("won");
  });
});

describe("hold", () => {
  it("the ring fills while held, drains while lost, and floors at zero", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 30 },
        { x: 80, y: 45, owner: 1, units: 1 }, // the hill, held
        { x: 140, y: 80, owner: 2, units: 1 },
      ],
      { type: "hold", targetNodeId: 1, requiredTicks: 1_000_000 },
    );
    run(s, 10);
    expect(s.holdTicks).toBe(10);
    s.nodes[1]!.owner = 2; // hill lost
    run(s, 4);
    expect(s.holdTicks).toBe(6); // drains, not resets
    run(s, 20);
    expect(s.holdTicks).toBe(0); // floors at zero
  });

  it("wins when cumulative held ticks reach the requirement", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 30 },
        { x: 80, y: 45, owner: 1, units: 5 },
        { x: 140, y: 80, owner: 2, units: 1 },
      ],
      { type: "hold", targetNodeId: 1, requiredTicks: 30 },
    );
    run(s, 40);
    expect(s.status).toBe("won");
  });

  it("annihilation stays a win path under a hold objective", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 30 },
        { x: 80, y: 45, owner: 0, units: 50 }, // the hill, never taken
        { x: 60, y: 45, owner: 2, units: 1 },
      ],
      { type: "hold", targetNodeId: 1, requiredTicks: 1_000_000 },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 2 }]);
    run(s, 300);
    expect(s.status).toBe("won"); // wiped the rival instead — still a win
  });
});

describe("outlast", () => {
  it("surviving to the tick wins", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 140, y: 80, owner: 2, units: 40 },
      ],
      { type: "outlast", requiredTicks: 50 },
    );
    run(s, 60);
    expect(s.status).toBe("won");
  });

  it("dying before the timer is still a loss", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 1 },
        { x: 60, y: 45, owner: 2, units: 40 },
      ],
      { type: "outlast", requiredTicks: 1_000_000 },
    );
    s.flows.push({ from: 1, to: 0, remaining: 30 });
    run(s, 600);
    expect(s.status).toBe("lost");
  });
});

describe("claim", () => {
  it("owning the quota simultaneously wins with rivals still alive", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 20 },
        { x: 60, y: 45, owner: 0, units: 3 },
        { x: 140, y: 80, owner: 2, units: 40 },
      ],
      { type: "claim", quota: 2 },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
    expect(s.status).toBe("won");
    expect(s.nodes[2]!.owner).toBe(2);
  });
});

describe("gauntlet", () => {
  it("a board with no live rival is NOT an instant win", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      { type: "gauntlet", sendBudget: 5 },
    );
    run(s, 5);
    expect(s.status).toBe("playing");
  });

  it("capturing every node wins", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      { type: "gauntlet", sendBudget: 5 },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
    expect(s.status).toBe("won");
    expect(s.sendsUsed).toBe(1);
  });

  it("a targeted gauntlet wins on the target alone", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 }, // the vault
        { x: 120, y: 45, owner: 0, units: 50 }, // scenery it never has to crack
      ],
      { type: "gauntlet", targetNodeId: 1, sendBudget: 5 },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
    expect(s.status).toBe("won");
  });

  it("budget spent, nothing in flight, goal unmet — lost", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 3 },
        { x: 60, y: 45, owner: 0, units: 20 },
      ],
      { type: "gauntlet", sendBudget: 1 },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]); // 3 units at 20 defenders
    run(s, 300);
    expect(s.status).toBe("lost");
  });

  it("cancels and empty sends are free; redirects are not", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 30 },
        { x: 40, y: 70, owner: 0, units: 30 },
        { x: 20, y: 45, owner: 1, units: 0 }, // an empty source
      ],
      { type: "gauntlet", sendBudget: 99 },
    );
    tick(s, [{ type: "sendUnits", from: 3, to: 1 }]); // empty source: free
    expect(s.sendsUsed).toBe(0);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]); // real send: 1
    expect(s.sendsUsed).toBe(1);
    tick(s, [{ type: "sendUnits", from: 0, to: 2 }]); // redirect: 2
    expect(s.sendsUsed).toBe(2);
    tick(s, [{ type: "sendUnits", from: 0, to: 0 }]); // cancel: free
    expect(s.sendsUsed).toBe(2);
  });
});

describe("objective AI behaviour", () => {
  it("the crown owner garrisons its crown from the rear, at every tier", () => {
    const s = makeState(
      [
        { x: 20, y: 45, owner: 1, units: 10 },
        { x: 100, y: 45, owner: 2, units: 2 }, // the crown, under-held (floor is aiMinUnits+4)
        { x: 130, y: 45, owner: 2, units: 30 }, // the rear bank
      ],
      { type: "crown", targetNodeId: 1, playerCrownId: 0 },
      0, // AI awake from tick 0
    );
    run(s, 3);
    expect(s.flows.some((f) => f.from === 2 && f.to === 1)).toBe(true);
  });

  it("the hill lures AI attacks over an otherwise identical target", () => {
    const s = makeState(
      [
        { x: 20, y: 80, owner: 1, units: 5 },
        { x: 80, y: 45, owner: 2, units: 30 },
        { x: 60, y: 45, owner: 0, units: 5 }, // plain neutral, equidistant
        { x: 100, y: 45, owner: 0, units: 5 }, // the hill, equidistant
      ],
      { type: "hold", targetNodeId: 3, requiredTicks: 1_000_000 },
      0,
    );
    run(s, 3);
    expect(s.flows.some((f) => f.from === 1 && f.to === 3)).toBe(true);
  });
});

describe("hashing contract", () => {
  it("objective progress hashes only when an objective is present", () => {
    const plain = makeState([
      { x: 40, y: 45, owner: 1, units: 10 },
      { x: 140, y: 80, owner: 2, units: 10 },
    ]);
    const drifted = structuredClone(plain);
    drifted.sendsUsed = 7;
    drifted.holdTicks = 3;
    // No objective: the counters are invisible — every hash recorded before
    // objectives existed stays valid.
    expect(hashState(drifted)).toBe(hashState(plain));

    const objA = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 140, y: 80, owner: 2, units: 10 },
      ],
      { type: "claim", quota: 99 },
    );
    const objB = structuredClone(objA);
    objB.sendsUsed = 7;
    expect(hashState(objB)).not.toBe(hashState(objA));
  });

  it("objective sims are deterministic: same board, same commands, same hash", () => {
    const build = () =>
      makeState(
        [
          { x: 40, y: 45, owner: 1, units: 20 },
          { x: 80, y: 45, owner: 0, units: 5 },
          { x: 120, y: 45, owner: 2, units: 20 },
        ],
        { type: "hold", targetNodeId: 1, requiredTicks: 200 },
        30,
      );
    const a = build();
    const b = build();
    tick(a, [{ type: "sendUnits", from: 0, to: 1 }]);
    tick(b, [{ type: "sendUnits", from: 0, to: 1 }]);
    for (let i = 0; i < 400; i++) {
      tick(a, []);
      tick(b, []);
    }
    expect(hashState(a)).toBe(hashState(b));
    expect(a.status).toBe(b.status);
  });
});

describe("neutrality of the framework", () => {
  it("a plain annihilation level neither reads nor writes objective state", () => {
    const s = makeState([
      { x: 40, y: 45, owner: 1, units: 10 },
      { x: 60, y: 45, owner: NEUTRAL, units: 3 },
      { x: 140, y: 80, owner: 2, units: 5 },
    ]);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 100);
    expect(s.holdTicks).toBe(0);
    expect(s.sendsUsed).toBe(1); // counted everywhere, read only by gauntlets
    expect(s.status).toBe("playing");
    // Classic rules still decide the game.
    expect(s.nodes.filter((n) => n.owner === PLAYER).length).toBeGreaterThanOrEqual(1);
  });
});
