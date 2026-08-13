import { describe, expect, it } from "vitest";
import type { Faction, Node } from "../lib/overrun/sim/state";
import { hashState, WORLD_H, WORLD_W } from "../lib/overrun/sim/state";
import { tick, TICK_HZ } from "../lib/overrun/sim/tick";
import { createLevel } from "../lib/overrun/sim/level";
import { AMBER, BALANCED, CRIMSON, VIOLET } from "../lib/overrun/sim/ai";
import {
  FACTORY_PROD_INTERVAL,
  PROD_INTERVAL,
  TURRET_EVERY,
  UPGRADE_COST,
  UPGRADE_TICKS,
} from "../lib/overrun/sim/constants";
import type { Command } from "../lib/overrun/sim/commands";

import { makeState, run } from "./sim-harness";

describe("multi-faction determinism", () => {
  it("3-way and 4-way levels are deterministic over 10k ticks", () => {
    for (const lvl of [7, 12]) {
      const play = (): number => {
        const s = createLevel(lvl);
        const n = s.nodes.length;
        for (let i = 0; i < 10_000 && s.status === "playing"; i++) {
          const cmds: Command[] = [];
          if (i % 90 === 30) cmds.push({ type: "sendUnits", from: 0, to: ((i / 7) | 0) % n });
          if (i % 400 === 100) cmds.push({ type: "upgradeNode", nodeId: 0 });
          tick(s, cmds);
        }
        return hashState(s);
      };
      expect(play(), `level ${lvl}`).toBe(play());
    }
  });

  it("an eliminated faction's in-flight packets still land (and can resurrect it)", () => {
    const s = makeState([
      { x: 20, y: 45, owner: 2, units: 20 }, // AI home, about to fall
      { x: 140, y: 45, owner: 0, units: 1 }, // its distant target
      { x: 26, y: 45, owner: 1, units: 60 }, // player storms the AI home
    ]);
    s.flows.push({ from: 0, to: 1, remaining: 20 }); // AI empties itself
    tick(s, [{ type: "sendUnits", from: 2, to: 0 }]);
    let sawNodelessAlive = false;
    for (let i = 0; i < 600 && s.status === "playing"; i++) {
      tick(s, []);
      const hasNode = s.nodes.some((n) => n.owner === 2);
      const hasPackets = s.packets.some((p) => p.owner === 2);
      if (!hasNode && hasPackets) sawNodelessAlive = true;
    }
    expect(sawNodelessAlive).toBe(true);
    // The AI's stream landed on the far neutral and recaptured a home.
    expect(s.nodes.some((n) => n.owner === 2)).toBe(true);
    expect(s.status).toBe("playing");
  });

  it("player wins only when EVERY rival faction is fully dead", () => {
    const s = makeState(
      [
        { x: 30, y: 45, owner: 1, units: 60 },
        { x: 30, y: 20, owner: 1, units: 60 }, // second army for the second kill
        { x: 60, y: 45, owner: 2, units: 1 },
        { x: 60, y: 20, owner: 3, units: 1 },
      ],
      { ais: [
        { faction: 2, persona: BALANCED, firstMoveTick: 1e6 },
        { faction: 3, persona: BALANCED, firstMoveTick: 1e6 },
      ] },
    );
    tick(s, [{ type: "sendUnits", from: 0, to: 2 }]);
    run(s, 300);
    expect(s.nodes[2]!.owner).toBe(1); // faction 2 dead
    expect(s.status).toBe("playing"); // faction 3 still alive
    tick(s, [{ type: "sendUnits", from: 1, to: 3 }]);
    run(s, 600);
    expect(s.status).toBe("won");
  });
});

describe("node kinds", () => {
  it("factory produces on the faster interval", () => {
    const s = makeState([
      { x: 30, y: 45, owner: 1, units: 1, kind: 1 }, // factory, medium
      { x: 130, y: 45, owner: 2, units: 1 }, // standard, medium
    ]);
    const window = FACTORY_PROD_INTERVAL[1] * 6;
    run(s, window + 1);
    const factory = s.nodes[0]!.units;
    const standard = s.nodes[1]!.units;
    // Production also fires at tick 0 (0 % interval === 0), hence the +1s.
    expect(factory).toBe(1 + 6 + 1);
    expect(standard).toBe(1 + Math.floor(window / PROD_INTERVAL[1]) + 1);
    expect(factory).toBeGreaterThan(standard);
  });

  it("fortress: two hostile packets per defender, flip on the packet after zero", () => {
    const s = makeState([
      { x: 40, y: 45, owner: 1, units: 25 },
      { x: 60, y: 45, owner: 0, units: 10, kind: 2 }, // fortress with 10 defenders
      { x: 146, y: 76, owner: 2, units: 1 }, // sentinel keeps the game alive
    ]);
    tick(s, [{ type: "sendUnits", from: 0, to: 1 }]);
    // 25 packets over ~50 emit ticks + 25 travel: all landed by ~tick 100.
    // 20 kill the 10 defenders (2:1), the 21st flips, 4 deposit.
    run(s, 110);
    expect(s.nodes[1]!.owner).toBe(1);
    expect(s.nodes[1]!.units).toBeGreaterThanOrEqual(5);
    expect(s.nodes[1]!.units).toBeLessThanOrEqual(9); // 5 landed + a few produced post-flip
  });

  it("owned turret thins a passing stream; neutral turret is dormant", () => {
    // A long-haul player stream to an empty neutral passes next to a turret.
    // Same board, same timings — the only difference is who owns the turret,
    // so the deposited-unit gap is exactly the zap count.
    const build = (turretOwner: Faction) =>
      makeState([
        { x: 20, y: 45, owner: 1, units: 20 },
        { x: 140, y: 45, owner: 0, units: 0 },
        { x: 80, y: 50, owner: turretOwner, units: 5, kind: 3 }, // on the flight path
        { x: 146, y: 76, owner: 2, units: 1 }, // sentinel keeps the game alive
      ]);
    const zapped = build(2);
    tick(zapped, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(zapped, 300);
    const dormant = build(0);
    tick(dormant, [{ type: "sendUnits", from: 0, to: 1 }]);
    run(dormant, 300);
    expect(dormant.nodes[1]!.owner).toBe(1);
    // Turret cadence is every TURRET_EVERY ticks — several packets must die.
    const gap = dormant.nodes[1]!.units - zapped.nodes[1]!.units;
    expect(gap).toBeGreaterThanOrEqual(Math.floor(60 / TURRET_EVERY));
  });
});

describe("in-run upgrades", () => {
  it("validates, drains cost, and completes on schedule", () => {
    const s = makeState([
      { x: 30, y: 45, owner: 1, units: 20, size: 0 },
      { x: 130, y: 45, owner: 2, units: 5 },
    ]);
    tick(s, [{ type: "upgradeNode", nodeId: 0 }]);
    // Cost drained up front; +1 because production also fires on tick 0.
    expect(s.nodes[0]!.units).toBe(20 - UPGRADE_COST[0] + 1);
    expect(s.nodes[0]!.upgrading).toBe(0 + UPGRADE_TICKS);
    expect(s.nodes[0]!.size).toBe(0);
    run(s, UPGRADE_TICKS);
    expect(s.nodes[0]!.size).toBe(1);
    expect(s.nodes[0]!.upgrading).toBe(0);
  });

  it("rejects non-owner, poor, max-size, and double upgrades", () => {
    const s = makeState([
      { x: 30, y: 45, owner: 2, units: 50, size: 0 }, // not the player's
      { x: 50, y: 45, owner: 1, units: 5, size: 0 }, // too poor
      { x: 70, y: 45, owner: 1, units: 50, size: 2 }, // already max
      { x: 90, y: 45, owner: 1, units: 50, size: 0 }, // valid — then double
    ]);
    tick(s, [
      { type: "upgradeNode", nodeId: 0 },
      { type: "upgradeNode", nodeId: 1 },
      { type: "upgradeNode", nodeId: 2 },
      { type: "upgradeNode", nodeId: 3 },
      { type: "upgradeNode", nodeId: 3 }, // second attempt same tick
    ]);
    expect(s.nodes[0]!.upgrading).toBe(0);
    expect(s.nodes[1]!.upgrading).toBe(0);
    expect(s.nodes[2]!.upgrading).toBe(0);
    expect(s.nodes[3]!.upgrading).toBe(UPGRADE_TICKS);
    expect(s.nodes[3]!.units).toBe(50 - UPGRADE_COST[0]); // charged exactly once
  });

  it("capture cancels a construction in progress", () => {
    const s = makeState([
      { x: 30, y: 45, owner: 1, units: 20, size: 0 },
      { x: 40, y: 45, owner: 2, units: 40 },
    ]);
    tick(s, [{ type: "upgradeNode", nodeId: 0 }]);
    s.flows.push({ from: 1, to: 0, remaining: 40 });
    run(s, 60); // capture lands well before the 90-tick completion
    expect(s.nodes[0]!.owner).toBe(2);
    expect(s.nodes[0]!.upgrading).toBe(0);
    run(s, 120);
    expect(s.nodes[0]!.size).toBe(0); // never completed
  });
});

describe("mapgen fairness", () => {
  it("3-way boards: every faction sees congruent distances to every orbit", () => {
    for (const lvl of [12, 17, 24]) {
      const s = createLevel(lvl);
      const starts = [1, 2, 3].map((f) => s.nodes.find((n) => n.owner === f)!);
      const neutrals = s.nodes.filter((n) => n.owner === 0);
      const view = (start: Node) =>
        neutrals
          .map((n) => Math.round(Math.hypot(n.x - start.x, n.y - start.y) * 10) / 10)
          .sort((a, b) => a - b)
          .join(",");
      // The multiset of distances to all neutrals must match across factions
      // (up to fp rounding) — congruent views by rotational construction.
      expect(view(starts[1]!), `level ${lvl} f2`).toBe(view(starts[0]!));
      expect(view(starts[2]!), `level ${lvl} f3`).toBe(view(starts[0]!));
    }
  });

  it("4-way boards: one start per quadrant, orbit quads share stats", () => {
    const s = createLevel(9);
    const starts = [1, 2, 3, 4].map((f) => s.nodes.find((n) => n.owner === f)!);
    expect(starts.filter((n) => n.x < WORLD_W / 2 && n.y < WORLD_H / 2)).toHaveLength(1);
    expect(starts.filter((n) => n.x > WORLD_W / 2 && n.y < WORLD_H / 2)).toHaveLength(1);
    expect(starts.filter((n) => n.x < WORLD_W / 2 && n.y > WORLD_H / 2)).toHaveLength(1);
    expect(starts.filter((n) => n.x > WORLD_W / 2 && n.y > WORLD_H / 2)).toHaveLength(1);
    for (const f of [2, 3, 4]) expect(starts[f - 1]!.units).toBe(starts[1]!.units);
  });

  it("teaching kinds land: L4 factory, L5 fortress, L7 turret far from player", () => {
    const l4 = createLevel(4);
    expect(l4.nodes.some((n) => n.kind === 1 && n.owner === 0)).toBe(true);
    const l5 = createLevel(5);
    expect(l5.nodes.some((n) => n.kind === 2 && n.units === 12)).toBe(true);
    const l7 = createLevel(7);
    const player = l7.nodes.find((n) => n.owner === 1)!;
    const crimson = l7.nodes.find((n) => n.owner === 2)!;
    const turrets = l7.nodes.filter((n) => n.kind === 3);
    // The demo turret is placed across its whole symmetry orbit — one in each
    // faction's sphere — so the orbit size follows the topology rather than
    // being hardcoded. It used to be applied to a single node, which handed one
    // faction a mechanic the others lacked; that is the regression here, not the
    // count. L7 is a duel now (onboarding is duels all the way to L8), so the
    // orbit is a mirror pair.
    expect(turrets).toHaveLength(l7.cfg.factionCount);
    const nearCrimson = turrets.reduce((a, b) =>
      Math.hypot(a.x - crimson.x, a.y - crimson.y) < Math.hypot(b.x - crimson.x, b.y - crimson.y) ? a : b,
    );
    // The one the player watches sits in CRIMSON's sphere, out of their lanes.
    // Stated as a comparison rather than a magic radius: "nearer its owner than
    // the player" is the property that matters and it survives a topology change.
    const toPlayer = Math.hypot(nearCrimson.x - player.x, nearCrimson.y - player.y);
    const toCrimson = Math.hypot(nearCrimson.x - crimson.x, nearCrimson.y - crimson.y);
    expect(toPlayer).toBeGreaterThan(35);
    expect(toCrimson).toBeLessThan(toPlayer);
  });
});

describe("personas", () => {
  it("CRIMSON commits far more units to attacks than AMBER on the same board", () => {
    // Proxy: distinct flow snapshots ≈ wave emissions ≈ units committed away
    // from home. The brawler's higher send fraction + lower margins should
    // roughly double the turtle's activity (probe: 67 vs 26).
    const activity = (persona: typeof CRIMSON): number => {
      const s = makeState(
        [
          { x: 30, y: 45, owner: 1, units: 15 },
          { x: 130, y: 45, owner: 2, units: 15 },
          { x: 80, y: 30, owner: 0, units: 6 },
          { x: 80, y: 60, owner: 0, units: 6 },
        ],
        { ais: [{ faction: 2, persona, firstMoveTick: 0 }], tier: 2, interval: 60, certainty: 99 },
      );
      const seen = new Set<string>();
      for (let i = 0; i < 900 && s.status === "playing"; i++) {
        tick(s, []);
        for (const f of s.flows) {
          if (s.nodes[f.from]!.owner !== 2) continue;
          seen.add(`${f.from}>${f.to}@${f.remaining}`);
        }
      }
      return seen.size;
    };
    expect(activity(CRIMSON)).toBeGreaterThan(activity(AMBER) * 1.5);
  });

  it("VIOLET (opportunist) targets the weakest rival in a 3-way", () => {
    const s = makeState(
      [
        { x: 30, y: 45, owner: 1, units: 40 }, // strong player
        { x: 130, y: 45, owner: 2, units: 4 }, // weak rival
        { x: 80, y: 20, owner: 3, units: 20 }, // violet
      ],
      {
        ais: [
          { faction: 2, persona: BALANCED, firstMoveTick: 1e6 },
          { faction: 3, persona: VIOLET, firstMoveTick: 0 },
        ],
        tier: 2,
        interval: 60,
        certainty: 99,
      },
    );
    // Violet's first flow should aim at the weak faction-2 node, not the
    // strong player and not a snowballing leader.
    let firstTarget = -1;
    for (let i = 0; i < 300 && firstTarget === -1; i++) {
      tick(s, []);
      const flow = s.flows.find((f) => s.nodes[f.from]!.owner === 3);
      if (flow) firstTarget = flow.to;
    }
    expect(firstTarget).toBe(1);
  });
});

describe("multi-faction funnel", () => {
  it("idle player survives at least 45 s on L6 (first 3-way)", () => {
    const s = createLevel(6);
    run(s, 45 * TICK_HZ);
    expect(s.nodes.some((n) => n.owner === 1)).toBe(true);
  });
});
