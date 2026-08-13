/**
 * A competent reference player, for measuring winnability.
 *
 * Unlike the greedy bot in balance.test.ts this one:
 *   - keeps a garrison (cancels its own stream once the source hits a floor)
 *   - prices targets the way the AI does (effDef, fortress armour, growth in flight)
 *   - reinforces a node that is about to fall
 *   - upgrades safe rich nodes
 *   - focus-fires with two sources when one is not enough
 *
 * The player's sendUnits always drains 100%, so "garrison" has to be implemented
 * as cancelling the stream (send-to-self), which is exactly what a human does.
 *
 * The crude greedy bot in balance.test.ts is a useful fixed reference point, but
 * it loses to "hard" and "impossible" alike, so every assertion built on it
 * alone is satisfied by making the game UNWINNABLE. That is exactly what shipped
 * in Phase 3A.4. A floor needs a bot that can tell the two apart.
 *
 * This used to live in test/, because measuring winnability was something we did
 * offline. It ships now: ./screen.ts runs it at level start to verify a board is
 * winnable BEFORE the player is shown it, which is what lets boards be drawn
 * from an open-ended seed space instead of one-per-level. It is a few KB against
 * a 2 MB budget, and it is the only thing in the codebase that can tell a hard
 * board from an impossible one.
 */
import type { GameState, Node } from "./state";
import { NEUTRAL, PLAYER, KIND_FORTRESS, KIND_NURSERY, KIND_FACTORY, KIND_BEACON, KIND_RELAY, KIND_TURRET, KIND_VAULT, KIND_VOLATILE, KIND_SIPHON, KIND_CORRUPTER, KIND_RIFT } from "./state";
import { tick, TICK_HZ, dist, prodInterval, travelTicks } from "./tick";
import { createLevel, type PlayerBoosts, DEFAULT_BOOSTS, defaultSeedFor } from "./level";
import type { Command } from "./commands";
import {
  EMIT_EVERY,
  MIN_SPACING,
  NURSERY_NEUTRAL_INTERVAL,
  VOLATILE_RADIUS,
  VOLATILE_DAMAGE,
  SIPHON_RANGE,
} from "./constants";

export interface BotOpts {
  /** ticks between strategic decisions */
  period: number;
  /** phase offset, for sampling variance */
  phase: number;
  /** ticks between stream-cancel checks */
  cancelPeriod: number;
  /** extra units over the computed kill cost */
  margin: number;
  /** garrison kept on a node with a hostile within FRONT_DIST */
  frontGarrison: number;
  /** garrison kept on a safe node */
  rearGarrison: number;
  upgrades: boolean;
  gangUp: boolean;
  /** a hostile within this many world units makes a node "front line" */
  frontDist: number;
  /**
   * A hostile this close blocks an upgrade.
   *
   * Separate from `frontDist` on purpose: frontDist answers "should this node
   * keep a garrison", this answers "is this node quiet enough to spend 15 units
   * and 3 seconds on". Sharing one number meant the portfolio's 40–80 wu
   * garrison sweep silently doubled as an upgrade policy.
   *
   * Splitting them did NOT change the upgrade count — see the note on
   * upgradePass for what actually stops it, which is arithmetic, not a gate.
   */
  upgradeSafeDist: number;
  /** never leave a node below this fraction of its current units */
  garrisonFrac: number;
  /** max simultaneous outgoing player streams */
  maxFronts: number;
  /** attacks issued per strategy cycle */
  perCycle: number;
  /** extra score for neutral targets (expansion preference) */
  neutralBias: number;
  /** if true, never attack a rival-owned node unless no neutral is affordable */
  neutralFirst: boolean;
}

export const DEFAULT_BOT: BotOpts = {
  period: 9,
  phase: 0,
  cancelPeriod: 3,
  margin: 2,
  frontGarrison: 10,
  rearGarrison: 3,
  upgrades: true,
  gangUp: true,
  frontDist: 60,
  upgradeSafeDist: MIN_SPACING * 1.5, // 30 wu — "no hostile within a hop and a half"
  garrisonFrac: 0.25,
  maxFronts: 2,
  perCycle: 2,
  neutralBias: 0,
  neutralFirst: false,
};

const KIND_VALUE: Record<number, number> = {
  0: 0,
  [KIND_FACTORY]: 8,
  [KIND_FORTRESS]: 2,
  [KIND_TURRET]: 5,
  [KIND_RELAY]: 5,
  [KIND_VOLATILE]: -3,
  [KIND_BEACON]: 8,
  [KIND_SIPHON]: 7,
  [KIND_VAULT]: 3,
  [KIND_NURSERY]: 4,
  [KIND_CORRUPTER]: 6,
  [KIND_RIFT]: 2,
};

export class Bot {
  private keep = new Map<number, number>(); // srcId -> cancel when units <= this
  constructor(private o: BotOpts = DEFAULT_BOT) {}

  commands(s: GameState, t: number): Command[] {
    const out: Command[] = [];
    if (t % this.o.cancelPeriod === 0) this.cancels(s, out);
    if ((t + this.o.phase) % this.o.period === 0) this.strategy(s, out);
    return out;
  }

  private cancels(s: GameState, out: Command[]): void {
    for (const f of s.flows) {
      const src = s.nodes[f.from]!;
      if (src.owner !== PLAYER) continue;
      const k = this.keep.get(f.from);
      if (k === undefined) continue;
      if (src.units <= k) out.push({ type: "sendUnits", from: f.from, to: f.from });
    }
  }

  private strategy(s: GameState, out: Command[]): void {
    const n = s.nodes.length;
    const inF = new Array(n).fill(0);
    const inH = new Array(n).fill(0);
    for (const p of s.packets) {
      const tgt = s.nodes[p.to]!;
      if (p.owner === tgt.owner) inF[p.to]++;
      else inH[p.to]++;
    }
    const mine = s.nodes.filter((x) => x.owner === PLAYER);
    if (!mine.length) return;
    const hostiles = s.nodes.filter((x) => x.owner !== PLAYER && x.owner !== NEUTRAL);

    const nearestHostile = (x: Node) => {
      let d = Infinity;
      for (const h of hostiles) d = Math.min(d, dist(x, h));
      return d;
    };
    const garrison = (x: Node) => {
      const base =
        hostiles.length && nearestHostile(x) < this.o.frontDist
          ? this.o.frontGarrison
          : this.o.rearGarrison;
      return Math.max(base, Math.ceil(x.units * this.o.garrisonFrac));
    };

    const effDef = (x: Node) => x.units + inF[x.id]! - inH[x.id]!;
    // Objective pull: the bot must PURSUE a marked node or the screen measures
    // the wrong game — a crown probe that ignores the crown reports a level as
    // unwinnable when it is merely long. Mirrors objectiveLure in ai.ts.
    const obj = s.cfg.objective;
    const objBias = (tgt: Node) =>
      (obj?.type === "crown" || obj?.type === "hold") && obj.targetNodeId === tgt.id ? 15 : 0;
    const growth = (tgt: Node, src: Node, wave: number) => {
      const ticks = travelTicks(s, src, tgt) + wave * EMIT_EVERY;
      if (tgt.owner !== NEUTRAL) return Math.ceil(ticks / prodInterval(s, tgt));
      if (tgt.kind === KIND_NURSERY) return Math.ceil(ticks / NURSERY_NEUTRAL_INTERVAL);
      return 0;
    };
    const cost = (tgt: Node, src: Node, wave: number) =>
      Math.max(0, effDef(tgt)) * (tgt.kind === KIND_FORTRESS ? 2 : 1) + growth(tgt, src, wave) + 1;

    const busy = new Set(s.flows.filter((f) => s.nodes[f.from]!.owner === PLAYER).map((f) => f.from));

    /* ---- 1. reinforce a node about to fall ---- */
    let doomed: Node | null = null;
    let worst = 0;
    for (const x of mine) {
      const deficit = inH[x.id]! - x.units - inF[x.id]!;
      if (deficit > worst) {
        worst = deficit;
        doomed = x;
      }
    }
    if (doomed) {
      const already = s.flows.some((f) => f.to === doomed!.id && s.nodes[f.from]!.owner === PLAYER);
      if (!already) {
        let src: Node | null = null;
        let bd = Infinity;
        for (const x of mine) {
          if (x.id === doomed.id) continue;
          if (x.units - this.o.rearGarrison <= worst) continue;
          const d = dist(x, doomed);
          if (d < bd) {
            bd = d;
            src = x;
          }
        }
        if (src) {
          out.push({ type: "sendUnits", from: src.id, to: doomed.id });
          this.keep.set(src.id, Math.max(this.o.rearGarrison, src.units - (worst + 3)));
          busy.add(src.id);
        }
      }
    }

    /* ---- 2. attack ---- */
    for (let cycle = 0; cycle < this.o.perCycle; cycle++) {
    let anyAffordableNeutral = false;
    if (this.o.neutralFirst) {
      for (const src of mine) {
        if (busy.has(src.id)) continue;
        const spare = src.units - garrison(src);
        for (const tgt of s.nodes)
          if (tgt.owner === NEUTRAL && cost(tgt, src, Math.min(spare, 40)) + this.o.margin <= spare)
            anyAffordableNeutral = true;
      }
    }
    if (busy.size >= this.o.maxFronts) {
      break;
    }
    let bestScore = -Infinity;
    let bestSrc: Node | null = null;
    let bestTgt: Node | null = null;
    let bestNeed = 0;
    for (const src of mine) {
      if (busy.has(src.id)) continue;
      const spare = src.units - garrison(src);
      if (spare < 2) continue;
      for (const tgt of s.nodes) {
        if (tgt.owner === PLAYER) continue;
        if (this.o.neutralFirst && tgt.owner !== NEUTRAL && anyAffordableNeutral) continue;
        const need = cost(tgt, src, Math.min(spare, 40)) + this.o.margin;
        if (need > spare) continue;
        let v =
          (tgt.owner === NEUTRAL ? 14 + this.o.neutralBias : 10) +
          4 * tgt.size +
          (KIND_VALUE[tgt.kind] ?? 0) +
          objBias(tgt) +
          60 / (1 + dist(src, tgt) / 25) -
          need * 0.8;
        // don't take a volatile that would shred our own cluster
        if (tgt.kind === KIND_VOLATILE) {
          for (const m of mine)
            if (m.id !== tgt.id && dist(m, tgt) <= VOLATILE_RADIUS)
              v -= Math.min(VOLATILE_DAMAGE, m.units) * 0.6;
        }
        // a hostile siphon next door makes a node worth less
        for (const m of s.nodes)
          if (m.kind === KIND_SIPHON && m.owner !== NEUTRAL && m.owner !== PLAYER && dist(m, tgt) <= SIPHON_RANGE)
            v -= 6;
        if (v > bestScore) {
          bestScore = v;
          bestSrc = src;
          bestTgt = tgt;
          bestNeed = need;
        }
      }
    }
    if (bestSrc && bestTgt) {
      out.push({ type: "sendUnits", from: bestSrc.id, to: bestTgt.id });
      this.keep.set(bestSrc.id, Math.max(0, bestSrc.units - bestNeed));
      busy.add(bestSrc.id);
    } else if (this.o.gangUp) {
      /* ---- 2b. focus fire: two sources on one target ---- */
      let gs = -Infinity;
      let ga: Node | null = null;
      let gb: Node | null = null;
      let gt: Node | null = null;
      let gneed = 0;
      const free = mine.filter((x) => !busy.has(x.id) && x.units - garrison(x) >= 2);
      for (const tgt of s.nodes) {
        if (tgt.owner === PLAYER) continue;
        for (let i = 0; i < free.length; i++)
          for (let j = i + 1; j < free.length; j++) {
            const a = free[i]!;
            const b = free[j]!;
            const wave = a.units - garrison(a) + (b.units - garrison(b));
            const need = cost(tgt, a, Math.min(wave, 40)) + this.o.margin;
            if (need > wave) continue;
            const v =
              (tgt.owner === NEUTRAL ? 14 + this.o.neutralBias : 10) +
              4 * tgt.size +
              (KIND_VALUE[tgt.kind] ?? 0) +
              objBias(tgt) +
              60 / (1 + Math.min(dist(a, tgt), dist(b, tgt)) / 25) -
              need * 0.8;
            if (v > gs) {
              gs = v;
              ga = a;
              gb = b;
              gt = tgt;
              gneed = need;
            }
          }
      }
      if (ga && gb && gt) {
        const share = Math.ceil(gneed / 2);
        out.push({ type: "sendUnits", from: ga.id, to: gt.id });
        out.push({ type: "sendUnits", from: gb.id, to: gt.id });
        this.keep.set(ga.id, Math.max(0, ga.units - share - 1));
        this.keep.set(gb.id, Math.max(0, gb.units - share - 1));
        busy.add(ga.id);
        busy.add(gb.id);
      } else break;
    }
    }

    /* ---- 3. upgrade ---- */
    this.upgradePass(s, out, mine, busy, garrison, nearestHostile, hostiles.length > 0);
  }

  /**
   * This bot never buys a single in-run node upgrade, and that is correct play,
   * not a blind spot. Worth recording, because the zero was once written up as
   * evidence that two meta-progression tracks were worthless.
   *
   * Measured over L41–60: 28,228 "can't afford it" rejections, zero upgrades,
   * and the richest player node across 240 games held 30 units against a
   * 31-unit bar. Two things were tried to move it and BOTH changed nothing:
   * giving the safety check its own distance (`upgradeSafeDist`, above — the
   * unsafe branch rejected exactly 0 times), and running this pass before the
   * attack pass so it had first claim on the units.
   *
   * The reason is arithmetic. A size 0→1 upgrade costs 15 units to gain
   * 1/30 − 1/45 units per tick: **45 seconds to pay for itself**. Size 1→2 is
   * 100 seconds. Median time-to-win on a late board is 39 s and median
   * time-to-loss is 13 s. The upgrade cannot pay back inside the game it is
   * bought in, so a bot that spends the same units attacking wins more.
   *
   * Which makes UPGRADE DISCOUNT and RAPID DEPLOY cheap multipliers on a
   * mechanic that does not pay — a design finding about the meta tracks, not a
   * measurement artifact. Same discipline as `denyCaptures` in ai.ts: the thing
   * that changed no outcome was removed, and why is written down here so it is
   * not "obviously" re-added.
   */
  private upgradePass(
    s: GameState,
    out: Command[],
    mine: Node[],
    busy: Set<number>,
    garrison: (x: Node) => number,
    nearestHostile: (x: Node) => number,
    anyHostile: boolean,
  ): void {
    if (!this.o.upgrades) return;
    for (const x of mine) {
      if (x.size >= 2 || x.upgrading !== 0 || busy.has(x.id)) continue;
      const c = s.cfg.playerUpgradeCost[x.size as 0 | 1]!;
      if (x.units < c + garrison(x) + 6) continue;
      if (anyHostile && nearestHostile(x) < this.o.upgradeSafeDist) continue;
      out.push({ type: "upgradeNode", nodeId: x.id });
      // Reserve it. Commands are applied by tick() after this returns, so the
      // node's units have NOT dropped yet — without this the attack pass would
      // commit the very units the upgrade is about to spend, and the upgrade
      // would be rejected by applyUpgrade's `units < cost` check.
      busy.add(x.id);
      break;
    }
  }
}

export interface Result {
  status: string;
  seconds: number;
}

export function play(
  level: number,
  maxSeconds: number,
  opts: Partial<BotOpts> = {},
  mutate: (s: GameState) => void = () => {},
  boosts: PlayerBoosts = DEFAULT_BOOSTS,
  seed: number = defaultSeedFor(level),
): Result {
  const s = createLevel(level, boosts, seed);
  mutate(s);
  const bot = new Bot({ ...DEFAULT_BOT, ...opts });
  const maxTicks = maxSeconds * TICK_HZ;
  let i = 0;
  for (; i < maxTicks && s.status === "playing"; i++) tick(s, bot.commands(s, i));
  return { status: s.status, seconds: i / TICK_HZ };
}
