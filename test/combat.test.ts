import { describe, expect, it } from "vitest";
import { buildSendCommand } from "../lib/overrun/sim/commands";
import type { Faction, GameState, Node } from "../lib/overrun/sim/state";
import { hashState } from "../lib/overrun/sim/state";
import { tick } from "../lib/overrun/sim/tick";
import { BALANCED } from "../lib/overrun/sim/ai";
import { PROD_INTERVAL, UPGRADE_COST, UPGRADE_TICKS } from "../lib/overrun/sim/constants";

/**
 * Minimal hand-built state: nodes at given positions, AI asleep.
 * `sentinel` appends a passive far-corner enemy — without at least one enemy
 * piece the sim (correctly) declares an instant win and freezes, so tests
 * that use only player/neutral nodes need it to keep the clock running.
 */
function makeState(
  nodes: Array<Pick<Node, "x" | "y" | "owner" | "units">>,
  sentinel = false,
  aiFirstMoveTick = 1_000_000,
): GameState {
  if (sentinel) nodes = [...nodes, { x: 146, y: 76, owner: 2, units: 1 }];
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
  for (let i = 0; i < ticks; i++) tick(state, []);
}

const count = (state: GameState, owner: Faction) =>
  state.nodes.filter((n) => n.owner === owner).length;

describe("combat and capture", () => {
  it("captures a weaker neutral with the remainder surviving", () => {
    // 10 units vs 5 defenders over 20 wu: 5 spent breaking, 1 flips, 4 reinforce.
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 5 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
    expect(s.nodes[1]!.owner).toBe(1);
    expect(s.nodes[1]!.units).toBeGreaterThanOrEqual(5); // 5 landed + production since flip
  });

  it("attack fails against a stronger defender, shaving its units", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 5 },
        { x: 60, y: 45, owner: 0, units: 20 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 300);
    expect(s.nodes[1]!.owner).toBe(0);
    expect(s.nodes[1]!.units).toBe(15);
  });

  it("a friendly stream toward a node that flips mid-flight becomes an attack", () => {
    // Player reinforces its far node; enemy packets flip it first; the tail of
    // the player stream must then fight the new enemy owner, not reinforce it.
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 30 },
      { x: 120, y: 45, owner: 1, units: 1 },
      { x: 130, y: 45, owner: 2, units: 10 },
    ]);
    // Enemy attacks the weak player node (adjacent, arrives fast and flips it),
    // player simultaneously reinforces from far away (arrives after the flip).
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    s.flows.push({ from: 2, to: 1, remaining: 10 });
    run(s, 1000);
    // The 30-unit player wave (arriving over ~4s) must overwhelm ~10 enemy.
    expect(s.nodes[1]!.owner).toBe(1);
  });

  it("simultaneous opposing arrivals resolve deterministically", () => {
    const s = makeState([
      { x: 30, y: 45, owner: 1, units: 12 },
      { x: 80, y: 45, owner: 0, units: 0 },
      { x: 130, y: 45, owner: 2, units: 12 },
    ]);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    s.flows.push({ from: 2, to: 1, remaining: 12 });
    run(s, 400);
    // Equal, symmetric waves into an empty node: someone holds it with few units;
    // determinism is what matters (checked by re-running).
    const rerun = makeState([
      { x: 30, y: 45, owner: 1, units: 12 },
      { x: 80, y: 45, owner: 0, units: 0 },
      { x: 130, y: 45, owner: 2, units: 12 },
    ]);
    tick(rerun, [{ type: "sendUnits", from: 0, to: 1 }]);
    rerun.flows.push({ from: 2, to: 1, remaining: 12 });
    run(rerun, 400);
    expect(s.nodes[1]!.owner).toBe(rerun.nodes[1]!.owner);
    expect(s.nodes[1]!.units).toBe(rerun.nodes[1]!.units);
  });

  it("deposits may exceed the production cap", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 60 },
        { x: 60, y: 45, owner: 1, units: 49 }, // medium cap = 50
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 600);
    expect(s.nodes[1]!.units).toBeGreaterThan(50);
  });

  it("capturing a node kills its outgoing flow", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 3 }, // dribbles toward the neutral
      { x: 140, y: 45, owner: 0, units: 50 },
      { x: 30, y: 45, owner: 2, units: 40 }, // storms the player node
    ]);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    s.flows.push({ from: 2, to: 0, remaining: 40 });
    run(s, 100);
    expect(s.nodes[0]!.owner).toBe(2);
    expect(s.flows.some((f) => f.from === 0)).toBe(false);
  });

  it("redirect replaces the flow without losing unsent units", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 20 },
        { x: 60, y: 45, owner: 0, units: 5 },
        { x: 40, y: 70, owner: 0, units: 5 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 4); // a few packets leave toward node 1
    const inFlight = s.packets.length;
    expect(inFlight).toBeGreaterThan(0);
    tick(s, [{ type: "sendUnits", from: 0, to: 2 }]); // redirect
    expect(s.flows).toHaveLength(1);
    expect(s.flows[0]!.to).toBe(2);
    run(s, 400);
    // Both targets got hit: early packets to 1, the rest to 2 — nothing vanished.
    expect(s.nodes[2]!.owner).toBe(1);
  });

  it("cancel (send to self) stops the stream", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 20 },
        { x: 60, y: 45, owner: 0, units: 19 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 2);
    tick(s, [{ type: "sendUnits", from: 0, to: 0 }]);
    expect(s.flows).toHaveLength(0);
  });

  it("win only when enemy nodes AND packets are gone; in-flight units keep you alive", () => {
    const s = makeState([
      { x: 40, y: 45, owner: 1, units: 30 },
      { x: 120, y: 45, owner: 2, units: 2 },
    ]);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(s, 60); // enemy sole node not yet flipped
    expect(s.status).toBe("playing");
    run(s, 1000);
    expect(s.status).toBe("won");
  });

  it("losing the last node while a stream is mid-air is not a loss", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 1, units: 30 },
      { x: 140, y: 45, owner: 0, units: 1 },
      { x: 25, y: 45, owner: 2, units: 60 },
    ]);
    // Player sends EVERYTHING across the map, then the enemy flips the empty home.
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    s.flows.push({ from: 2, to: 0, remaining: 60 });
    let sawHomeless = false;
    for (let i = 0; i < 1000 && s.status === "playing"; i++) {
      tick(s, []);
      if (!s.nodes.some((n) => n.owner === 1) && s.packets.some((p) => p.owner === 1))
        sawHomeless = true;
    }
    expect(sawHomeless).toBe(true); // the scenario actually occurred
    expect(count(s, 1)).toBeGreaterThan(0); // stream recaptured a home
  });
});

describe("partial sends (the fraction field)", () => {
  it("commits floor(units * fraction) and keeps the rest home", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 11 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1, fraction: 0.5 }]);
    // floor(11 * 0.5) = 5 committed; tick 0 is an emit tick, so one packet
    // has already left by the time we look.
    expect(s.flows[0]!.remaining).toBe(4);
    // And the rest actually stayed home. Units leave the node per EMISSION,
    // not up front — a mutant that vaporised the committed half on send
    // passed this whole file without this line. 11 − 1 emitted + 1 produced
    // (tick 0 is a production tick too) = 11.
    expect(s.nodes[0]!.units).toBe(11);
  });

  it("a partial send that floors below one unit is a no-op, not a cancel", () => {
    // startFlow's `remaining < 1` floor guard. Without it, a tiny-fraction
    // send REPLACES the source's active flow with a dead one — which the
    // emitter splices immediately, i.e. it silently cancels the stream. The
    // "clamps garbage" test cannot see that (its dead flow disappears either
    // way); this one pins the active-flow case the guard actually protects.
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    expect(s.flows.length).toBe(1);
    tick(s, [{ type: "sendUnits", from: 0, to: 1, fraction: 0.05 }]);
    expect(s.flows.length).toBe(1); // the original stream survives untouched
  });

  it("an absent fraction and fraction: 1 replay byte-identically", () => {
    // THE replay-compatibility guarantee: every command log recorded before
    // the field existed must keep producing the same states, or the marketing
    // demo (and any future replay feature) silently desyncs.
    const build = () =>
      makeState(
        [
          { x: 40, y: 45, owner: 1, units: 14 },
          { x: 70, y: 45, owner: 0, units: 5 },
          { x: 100, y: 45, owner: 1, units: 9 },
        ],
        true,
      );
    const a = build();
    const b = build();
    tick(a, [{ type: "sendUnits", from: 0, to: 1 }]);
    tick(b, [{ type: "sendUnits", from: 0, to: 1, fraction: 1 }]);
    for (let i = 0; i < 300; i++) {
      tick(a, []);
      tick(b, []);
    }
    expect(hashState(a)).toBe(hashState(b));
  });

  it("clamps garbage fractions instead of trusting input", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      true,
    );
    // Over 1 behaves as 1...
    tick(s, [{ type: "sendUnits", from: 0, to: 1, fraction: 7 }]);
    expect(s.flows[0]!.remaining).toBe(9); // all 10 committed, 1 already emitted
    // ...and negative creates no flow (clamped to 0, floored below 1 unit).
    const s2 = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 10 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      true,
    );
    tick(s2, [{ type: "sendUnits", from: 0, to: 1, fraction: -1 }]);
    expect(s2.flows.length).toBe(0);
  });

  it("a fractional self-send still cancels the stream outright", () => {
    const s = makeState(
      [
        { x: 40, y: 45, owner: 1, units: 20 },
        { x: 60, y: 45, owner: 0, units: 3 },
      ],
      true,
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    expect(s.flows.length).toBe(1);
    tick(s, [{ type: "sendUnits", from: 0, to: 0, fraction: 0.5 }]);
    expect(s.flows.length).toBe(0); // cancel is whole, never partial
  });

  it("input builds full sends WITHOUT the fraction field", () => {
    // The other half of the replay guarantee. The hash test above proves the
    // sim treats absent and 1 identically — which is exactly why no sim test
    // can catch input starting to WRITE `fraction: 1`: the states would match
    // while the command logs (what replays actually store) diverge. The
    // omission itself is the contract, so it is asserted directly.
    expect(buildSendCommand(0, 1, 1)).not.toHaveProperty("fraction");
    expect(buildSendCommand(0, 1, 2)).not.toHaveProperty("fraction");
    expect(buildSendCommand(0, 1, 0.5)).toEqual({ type: "sendUnits", from: 0, to: 1, fraction: 0.5 });
  });

  it("two same-tick sends from different sources converge as two flows", () => {
    // The multi-ball gesture is N commands in one tick; the sim must hold one
    // flow per source, not merge or drop them.
    const s = makeState(
      [
        { x: 30, y: 45, owner: 1, units: 8 },
        { x: 110, y: 45, owner: 1, units: 8 },
        { x: 70, y: 45, owner: 0, units: 12 },
      ],
      true,
    );
    tick(s, [
      { type: "sendUnits", from: 0, to: 2, fraction: 0.5 },
      { type: "sendUnits", from: 1, to: 2 },
    ]);
    expect(s.flows.length).toBe(2);
    expect(s.flows[0]!.remaining).toBe(3); // floor(8 * 0.5) - 1 emitted
    expect(s.flows[1]!.remaining).toBe(7); // 8 - 1 emitted
  });
});
