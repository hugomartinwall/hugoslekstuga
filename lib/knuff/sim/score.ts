/**
 * Score: the chain, its carry, cushions, and a launch's total (spec §7).
 *
 * A pop scores points × chain × cushions × coin. The chain is counted
 * inside one launch; a launch released while he is still hot after a
 * launch that popped something starts one step higher. Cushions touched
 * before the pop multiply it, and a rattle in a corner is one cushion.
 * After a Coin slot plate in the launch, its pops pay `coinFactor` times.
 */
import { KINDS } from "../content/kinds";
import type { LaunchState, State, Thing, Tune } from "./types";

/**
 * The chain a new launch starts with. 0 for a launch released while he is
 * landed. A launch released while he is hot, after a launch that popped at
 * least one thing, carries one step more than that launch did, up to
 * `carryMax`. `before` is the launch it follows.
 */
export function carryFor(hot: boolean, before: LaunchState, tune: Tune): number {
  if (!hot || !before.active || !before.popped) return 0;
  return Math.min(tune.carryMax, before.carry + 1);
}

/**
 * He touched a cushion. One touched within `cushionMergeTicks` of the last
 * cushion touched, counted or not, does not count again. The first of a
 * launch always counts: there is no last one yet.
 */
export function countCushion(s: State, tune: Tune): void {
  const l = s.launch;
  if (l.lastCushionTick < 0 || s.tick - l.lastCushionTick > tune.cushionMergeTicks) l.cushions++;
  l.lastCushionTick = s.tick;
}

/** The chain multiplier of the launch's next pop, which is its `n`th. */
export function chainFor(n: number, carry: number, tune: Tune): number {
  return Math.min(tune.chainCap, n + carry);
}

/** The cushion multiplier of a pop made after `cushions` counted cushions. */
export function cushionsFor(cushions: number, tune: Tune): number {
  return Math.min(tune.cushionCap, 1 + cushions);
}

export type PopScore = { n: number; chain: number; cushions: number; coin: number; points: number };

/**
 * Book a pop by his body (`body`) or by Spark's ring: count it in the
 * launch, score it, and raise the best shot if this launch's total now
 * beats it. Both count in the chain; only his body's count toward the pip
 * refund. Returns what it scored.
 */
export function scorePop(s: State, d: Thing, tune: Tune, body: boolean): PopScore {
  const l = s.launch;
  l.pops++;
  if (body) l.bodyPops++;
  l.popped = true;
  const chain = chainFor(l.pops, l.carry, tune);
  const cushions = cushionsFor(l.cushions, tune);
  const coin = l.coin ? tune.coinFactor : 1;
  // A dust bunny of the boss's hour is worth nothing: still a pop, for the chain and the pip.
  const points = (d.worth0 ? 0 : KINDS[d.kind].points) * chain * cushions * coin;
  l.points += points;
  s.score += points;
  // The best shot is the largest total one launch has made. A total only
  // grows, so it is kept as it is made.
  if (l.points > s.bestShot) s.bestShot = l.points;
  return { n: l.pops, chain, cushions, coin, points };
}

/**
 * An envelope popped by his body or Spark's ring is counted toward its V.
 * The fifth of one V in one launch pays `vBonus`, flat, into the launch's
 * total (a blast pop does not count, and a V the cap cut cannot reach
 * five). Returns what it paid: `vBonus`, or 0.
 */
export function scoreV(s: State, d: Thing, tune: Tune): number {
  if (d.kind !== "envelope" || d.v < 0) return 0;
  const l = s.launch;
  l.vPops.push(d.v);
  let n = 0;
  for (let i = 0; i < l.vPops.length; i++) if (l.vPops[i] === d.v) n++;
  if (n !== 5) return 0;
  l.points += tune.vBonus;
  s.score += tune.vBonus;
  if (l.points > s.bestShot) s.bestShot = l.points;
  return tune.vBonus;
}
