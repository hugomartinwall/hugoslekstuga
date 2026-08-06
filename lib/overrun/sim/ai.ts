import type { FactionCfg, Faction, GameState, Node, Persona } from "./state";
import { NEUTRAL, PLAYER, KIND_FORTRESS } from "./state";
import { rngNext } from "./state";
import { applyUpgrade, dist, prodInterval, startFlow } from "./tick";
import { EMIT_EVERY, PACKET_SPEED, UPGRADE_COST } from "./constants";

/**
 * The rival AIs. Pure sim logic: deterministic given state, randomness only
 * through state.rng, acting through the same startFlow()/applyUpgrade() the
 * player's commands use. Free-for-all: every faction fights every other.
 *
 * Difficulty comes from cfg knobs + the structural TIERS table; FLAVOR comes
 * from personas (pure multipliers — BALANCED reproduces the classic 1v1 math
 * exactly, which is what keeps all historical calibration valid).
 *
 * Two layers per faction:
 *  - KILL layer: finisher (eliminate a whole faction when certain) and snipe
 *    (take any defenseless rival node). Certainty is the only brake.
 *  - NORMAL layer: expansion/attack scoring at the wake cadence, with an
 *    anti-snowball threat term so the board gangs up on a runaway leader.
 */

export const BALANCED: Persona = { aggression: 1, expansion: 1, opportunism: 1, turtle: 1 };
export const CRIMSON: Persona = { aggression: 1.5, expansion: 0.8, opportunism: 0.8, turtle: 0.85 };
export const AMBER: Persona = { aggression: 0.7, expansion: 1.2, opportunism: 0.7, turtle: 1.3 };
export const VIOLET: Persona = { aggression: 1.0, expansion: 1.0, opportunism: 1.6, turtle: 1.0 };

interface Tier {
  killCheckTicks: number; // 0 = only at the normal wake-up
  maxDecisions: number;
  snipeMaxDef: number; // -1 = last-node-only snipes
  focusFire: boolean;
  redirectForKill: boolean;
  killSend: number;
  upgrades: boolean;
}

const TIERS: Record<number, Tier> = {
  1: { killCheckTicks: 0, maxDecisions: 1, snipeMaxDef: -1, focusFire: false, redirectForKill: false, killSend: 0.9, upgrades: false },
  2: { killCheckTicks: 30, maxDecisions: 2, snipeMaxDef: 2, focusFire: false, redirectForKill: false, killSend: 0.9, upgrades: false },
  3: { killCheckTicks: 15, maxDecisions: 3, snipeMaxDef: 3, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true },
  4: { killCheckTicks: 1, maxDecisions: 4, snipeMaxDef: 4, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true },
};

/* --------------------------------------------------------- shared scratch */

// Reused per aiDecideFaction call — zero allocation in steady state.
const inboundFriendly: number[] = [];
const inboundHostile: number[] = [];
const material = [0, 0, 0, 0, 0];

/** One O(N+P) pass: per-node inbound tallies + per-faction material totals. */
function precompute(state: GameState): void {
  const n = state.nodes.length;
  inboundFriendly.length = n;
  inboundHostile.length = n;
  inboundFriendly.fill(0);
  inboundHostile.fill(0);
  material.fill(0);
  for (const node of state.nodes) material[node.owner]! += node.units;
  for (const p of state.packets) {
    material[p.owner]! += 1;
    const target = state.nodes[p.to]!;
    if (p.owner === target.owner) inboundFriendly[p.to]!++;
    else inboundHostile[p.to]!++;
  }
}

/** Defenders at arrival ≈ current units + friendly inbound − hostile inbound. */
function effDef(n: Node): number {
  return n.units + inboundFriendly[n.id]! - inboundHostile[n.id]!;
}

function factionsAlive(state: GameState): number {
  let count = 0;
  for (let f = 1; f <= 1 + state.cfg.ais.length; f++) if (material[f]! > 0) count++;
  return count;
}

/** Ticks for a wave of `units` from src to land on dst (travel + drain time). */
function waveTicks(src: Node, dst: Node, units: number): number {
  return Math.ceil(dist(src, dst) / PACKET_SPEED) + units * EMIT_EVERY;
}

/**
 * Units needed to take `n` with a wave from `src`: defenders at arrival
 * (doubled behind fortress armor), production landing during travel, plus
 * the capture unit.
 */
function killCost(state: GameState, n: Node, src: Node, waveSize: number): number {
  const def = Math.max(0, effDef(n)) * (n.kind === KIND_FORTRESS ? 2 : 1);
  const prodDuringTravel =
    n.owner === NEUTRAL ? 0 : Math.ceil(waveTicks(src, n, waveSize) / prodInterval(state, n));
  return def + prodDuringTravel + 1;
}

function hasFlow(state: GameState, nodeId: number): boolean {
  return state.flows.some((f) => f.from === nodeId);
}

function certaintyFor(state: GameState, victim: Faction): number {
  const c = state.cfg.aiKillCertainty;
  return victim === PLAYER ? c * state.cfg.aiKillPlayerBias : c;
}

/* -------------------------------------------------------------- kill layer */

/** Try to eliminate `victim` outright: cover every node they own. */
function tryFinisher(state: GameState, self: Faction, tier: Tier, victim: Faction): boolean {
  const victimNodes = state.nodes.filter((n) => n.owner === victim);
  if (victimNodes.length === 0) return false;

  const sources = state.nodes.filter(
    (n) => n.owner === self && n.units >= 2 && (tier.redirectForKill || !hasFlow(state, n.id)),
  );
  if (!sources.length) return false;

  let strayPackets = 0;
  for (const p of state.packets) if (p.owner === victim) strayPackets++;

  const force = sources.reduce((s, n) => s + n.units, 0) * tier.killSend;
  let totalCost = strayPackets;
  for (const t of victimNodes) {
    let best = Infinity;
    for (const s of sources) {
      const c = killCost(state, t, s, Math.floor(s.units * tier.killSend));
      if (c < best) best = c;
    }
    totalCost += best;
  }
  if (force < certaintyFor(state, victim) * totalCost) return false;

  const used = new Set<number>();
  for (const t of victimNodes) {
    let pick: Node | null = null;
    let pickDist = Infinity;
    for (const s of sources) {
      if (used.has(s.id)) continue;
      const c = killCost(state, t, s, Math.floor(s.units * tier.killSend));
      if (s.units * tier.killSend >= c && dist(s, t) < pickDist) {
        pick = s;
        pickDist = dist(s, t);
      }
    }
    if (pick) {
      used.add(pick.id);
      startFlow(state, pick.id, t.id, tier.killSend);
    }
  }
  let fired = used.size > 0;
  for (const s of sources) {
    if (used.has(s.id)) continue;
    let big: Node | null = null;
    for (const t of victimNodes) if (!big || t.units > big.units) big = t;
    if (big) {
      startFlow(state, s.id, big.id, tier.killSend);
      fired = true;
    }
  }
  return fired;
}

/** Punish any defenseless rival node — the emptied-home scenario. */
function trySnipe(state: GameState, self: Faction, tier: Tier): boolean {
  let target: Node | null = null;
  let targetDef = Infinity;
  for (const n of state.nodes) {
    if (n.owner === self || n.owner === NEUTRAL) continue;
    const def = effDef(n);
    if (tier.snipeMaxDef < 0) {
      // Tier 1 only ever snipes a faction's LAST node (guaranteed-loss states).
      let count = 0;
      for (const m of state.nodes) if (m.owner === n.owner) count++;
      if (count > 1 || def > 2) continue;
    } else if (def > tier.snipeMaxDef) {
      continue;
    }
    if (def < targetDef) {
      target = n;
      targetDef = def;
    }
  }
  if (!target) return false;

  let src: Node | null = null;
  let srcDist = Infinity;
  const certainty = certaintyFor(state, target.owner);
  for (const n of state.nodes) {
    if (n.owner !== self || hasFlow(state, n.id)) continue;
    const cost = killCost(state, target, n, Math.floor(n.units * tier.killSend));
    if (n.units * tier.killSend >= certainty * cost && dist(n, target) < srcDist) {
      src = n;
      srcDist = dist(n, target);
    }
  }
  if (!src) return false;
  startFlow(state, src.id, target.id, tier.killSend);
  return true;
}

/* ------------------------------------------------------------ normal layer */

const KIND_LURE = [0, 6, -2, 4] as const; // standard, factory, fortress, turret

function scoreTarget(
  state: GameState,
  self: Faction,
  persona: Persona,
  alive: number,
  avgMaterial: number,
  src: Node,
  n: Node,
  waveSize: number,
): number {
  const prodDuringTravel =
    n.owner === NEUTRAL ? 0 : Math.ceil(waveTicks(src, n, waveSize) / prodInterval(state, n));
  // Anti-snowball: bias attacks toward the material leader (only meaningful
  // in 3+-faction fights; 1v1 keeps the classic scoring exactly).
  const threat =
    n.owner === NEUTRAL || alive < 3
      ? 0
      : 12 * Math.max(0, material[n.owner]! / avgMaterial - 1) * persona.opportunism;
  return (
    60 / (1 + dist(src, n) / 20) +
    (n.owner === NEUTRAL
      ? state.cfg.aiNeutralBonus * persona.expansion
      : 8 * persona.aggression) +
    4 * n.size +
    KIND_LURE[n.kind] -
    effDef(n) -
    prodDuringTravel +
    threat
  );
}

function normalDecision(
  state: GameState,
  self: Faction,
  persona: Persona,
  tier: Tier,
  decided: Set<number>,
): boolean {
  const { cfg } = state;
  const alive = factionsAlive(state);
  const avgMaterial =
    (material[PLAYER]! + state.cfg.ais.reduce((s, fc) => s + material[fc.faction]!, 0)) /
    Math.max(1, alive);

  let src: Node | null = null;
  for (const n of state.nodes) {
    if (n.owner !== self || n.units < cfg.aiMinUnits || decided.has(n.id)) continue;
    if (hasFlow(state, n.id)) continue;
    if (!src || n.units > src.units) src = n;
  }
  if (!src) return false;
  decided.add(src.id);

  const sendFraction = Math.min(0.95, cfg.aiSendFraction / persona.turtle);
  const wave = Math.floor(src.units * sendFraction);
  let best: Node | null = null;
  let bestScore = -Infinity;
  for (const n of state.nodes) {
    if (n.owner === self) continue;
    const score = scoreTarget(state, self, persona, alive, avgMaterial, src, n, wave);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (!best) return false;

  const margin = Math.ceil(cfg.aiOverkillMargin / persona.aggression);
  const fortressFactor = best.kind === KIND_FORTRESS ? 2 : 1;
  const need = Math.max(0, effDef(best)) * fortressFactor + margin;
  if (wave > need) {
    startFlow(state, src.id, best.id, sendFraction);
    return true;
  }

  // Focus fire: pair with a second free node when the prize is worth it.
  if (tier.focusFire) {
    let ally: Node | null = null;
    for (const n of state.nodes) {
      if (n.owner !== self || n.id === src.id || decided.has(n.id)) continue;
      if (hasFlow(state, n.id) || n.units < cfg.aiMinUnits / 2) continue;
      if (!ally || n.units > ally.units) ally = n;
    }
    if (ally && wave + Math.floor(ally.units * sendFraction) > need + margin) {
      decided.add(ally.id);
      startFlow(state, src.id, best.id, sendFraction);
      startFlow(state, ally.id, best.id, sendFraction);
      return true;
    }
  }

  // No safe attack: shore up the frontline (own node closest to any hostile node).
  let front: Node | null = null;
  let frontDist = Infinity;
  for (const n of state.nodes) {
    if (n.owner !== self || n.id === src.id) continue;
    for (const p of state.nodes) {
      if (p.owner === self || p.owner === NEUTRAL) continue;
      const d = dist(n, p);
      if (d < frontDist) {
        frontDist = d;
        front = n;
      }
    }
  }
  if (front && front.units < src.units / 2) {
    startFlow(state, src.id, front.id, sendFraction);
    return true;
  }
  return false;
}

/** Tier-gated economy move: upgrade the richest safe node, one per wake. */
function tryUpgrade(state: GameState, self: Faction, persona: Persona, tier: Tier): void {
  if (!tier.upgrades && !(tier.killCheckTicks === 30 && persona.expansion >= 1.2)) return;
  let pick: Node | null = null;
  for (const n of state.nodes) {
    if (n.owner !== self || n.size >= 2 || n.upgrading !== 0 || hasFlow(state, n.id)) continue;
    if (n.units < UPGRADE_COST[n.size as 0 | 1] + state.cfg.aiMinUnits) continue;
    // Safety: nothing hostile within 45 wu.
    let safe = true;
    for (const h of state.nodes) {
      if (h.owner === self || h.owner === NEUTRAL) continue;
      if (dist(n, h) < 45) {
        safe = false;
        break;
      }
    }
    if (safe && (!pick || n.units > pick.units)) pick = n;
  }
  if (pick) applyUpgrade(state, pick.id, self);
}

/* -------------------------------------------------------------- entry point */

function aiDecideFaction(state: GameState, fc: FactionCfg): void {
  const { cfg } = state;
  const self = fc.faction;
  if (state.tick < fc.firstMoveTick) return;
  const tier = TIERS[cfg.aiTier] ?? TIERS[1]!;

  // Kill layer: faster cadence than the wake-up at higher tiers; staggered
  // per faction so rivals never commit on the same tick.
  const killDue =
    tier.killCheckTicks > 0
      ? (state.tick + self * 7) % tier.killCheckTicks === 0
      : state.tick >= state.nextAiTick[self]!;
  if (killDue) {
    precompute(state);
    // Cheapest victim first (deterministic tie-break: ascending faction id).
    const victims: Faction[] = [PLAYER];
    for (const other of cfg.ais) if (other.faction !== self) victims.push(other.faction);
    victims.sort((a, b) => material[a]! - material[b]! || a - b);
    for (const v of victims) {
      if (material[v]! === 0) continue;
      if (tryFinisher(state, self, tier, v)) return;
    }
    if (trySnipe(state, self, tier)) return;
  }

  if (state.tick < state.nextAiTick[self]!) return;
  // Reschedule first so every exit path keeps the cadence (rng jitter,
  // deterministic via sim rng).
  state.nextAiTick[self] =
    state.tick + cfg.aiIntervalTicks + Math.floor(rngNext(state.rng) * cfg.aiIntervalTicks * 0.4);

  if (!killDue) precompute(state); // kill layer may not have run this tick
  const decided = new Set<number>();
  for (let i = 0; i < tier.maxDecisions; i++) {
    if (!normalDecision(state, self, fc.persona, tier, decided)) break;
  }
  tryUpgrade(state, self, fc.persona, tier);
}

export function aiDecide(state: GameState): void {
  for (const fc of state.cfg.ais) aiDecideFaction(state, fc);
}
