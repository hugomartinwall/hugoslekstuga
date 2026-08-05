import type { GameState, Node } from "./state";
import { rngNext } from "./state";
import { dist, startFlow } from "./tick";
import { EMIT_EVERY, PACKET_SPEED, PROD_INTERVAL } from "./constants";

/**
 * The enemy AI. Pure sim logic: deterministic given state, randomness only
 * through state.rng, acts through the same startFlow() as the player's
 * command handler. Difficulty comes from state.cfg knobs and the structural
 * TIERS table below — the AI never cheats on production.
 *
 * Two layers:
 *  - KILL layer: detects that the player is finishable (whole-board finisher)
 *    or that a player node is defenseless (snipe) and commits, ignoring the
 *    usual caution knobs. Certainty (cfg.aiKillCertainty) is the only brake.
 *    This is what makes the AI "go for the kill" instead of farming neutrals
 *    while the player's emptied home sits open.
 *  - NORMAL layer: expansion/attack scoring at the wake cadence.
 */

interface Tier {
  /** Kill-layer cadence in ticks; 0 = only at the normal wake-up. */
  killCheckTicks: number;
  /** Attack/reinforce decisions per wake-up. */
  maxDecisions: number;
  /** Snipe any player node at or below this effective defense (-1 = last node only). */
  snipeMaxDef: number;
  /** Two sources may combine on one target when neither clears it alone. */
  focusFire: boolean;
  /** Kill layer may redirect an existing flow toward the kill. */
  redirectForKill: boolean;
  /** Send fraction used for kill commits (normal attacks use cfg.aiSendFraction). */
  killSend: number;
}

const TIERS: Record<number, Tier> = {
  1: { killCheckTicks: 0, maxDecisions: 1, snipeMaxDef: -1, focusFire: false, redirectForKill: false, killSend: 0.9 },
  2: { killCheckTicks: 30, maxDecisions: 2, snipeMaxDef: 2, focusFire: false, redirectForKill: false, killSend: 0.9 },
  3: { killCheckTicks: 15, maxDecisions: 3, snipeMaxDef: 3, focusFire: true, redirectForKill: true, killSend: 1.0 },
  4: { killCheckTicks: 1, maxDecisions: 4, snipeMaxDef: 4, focusFire: true, redirectForKill: true, killSend: 1.0 },
};

/** Defenders at arrival ≈ current units + friendly inbound − hostile inbound. */
function effectiveDefense(state: GameState, target: Node): number {
  let d = target.units;
  for (const p of state.packets) {
    if (p.to !== target.id) continue;
    if (p.owner === target.owner) d += 1;
    else if (p.owner === "enemy") d -= 1; // our own wave already en route
  }
  return d;
}

/** Ticks for a wave of `units` from src to land on dst (travel + drain time). */
function waveTicks(src: Node, dst: Node, units: number): number {
  return Math.ceil(dist(src, dst) / PACKET_SPEED) + units * EMIT_EVERY;
}

/**
 * Units needed to take `n` with a wave from `src`: defenders at arrival,
 * production that lands while the wave is en route, plus the capture unit.
 */
function killCost(state: GameState, n: Node, src: Node, waveSize: number): number {
  const prodDuringTravel =
    n.owner === "neutral" ? 0 : Math.ceil(waveTicks(src, n, waveSize) / PROD_INTERVAL[n.size]);
  return Math.max(0, effectiveDefense(state, n)) + prodDuringTravel + 1;
}

function hasFlow(state: GameState, nodeId: number): boolean {
  return state.flows.some((f) => f.from === nodeId);
}

/* -------------------------------------------------------------- kill layer */

/** Try to end the game outright: cover every player node with a lethal wave. */
function tryFinisher(state: GameState, tier: Tier): boolean {
  const playerNodes = state.nodes.filter((n) => n.owner === "player");
  if (playerNodes.length === 0) return false;

  const sources = state.nodes.filter(
    (n) => n.owner === "enemy" && n.units >= 2 && (tier.redirectForKill || !hasFlow(state, n.id)),
  );
  if (!sources.length) return false;

  let strayPackets = 0;
  for (const p of state.packets) if (p.owner === "player") strayPackets++;

  const force = sources.reduce((s, n) => s + n.units, 0) * tier.killSend;
  // Approximate total cost using each target's nearest source for travel time.
  let totalCost = strayPackets;
  for (const t of playerNodes) {
    let best = Infinity;
    for (const s of sources) {
      const c = killCost(state, t, s, Math.floor(s.units * tier.killSend));
      if (c < best) best = c;
    }
    totalCost += best;
  }
  if (force < state.cfg.aiKillCertainty * totalCost) return false;

  // Commit: assign each player node its nearest capable free source; leftovers
  // pile onto the biggest target.
  const used = new Set<number>();
  for (const t of playerNodes) {
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
    // Everything else joins the hunt on the strongest player node.
    let big: Node | null = null;
    for (const t of playerNodes) if (!big || t.units > big.units) big = t;
    if (big) {
      startFlow(state, s.id, big.id, tier.killSend);
      fired = true;
    }
  }
  return fired;
}

/** Punish a defenseless player node — the emptied-home scenario. */
function trySnipe(state: GameState, tier: Tier): boolean {
  const playerNodes = state.nodes.filter((n) => n.owner === "player");
  if (!playerNodes.length) return false;

  let target: Node | null = null;
  let targetDef = Infinity;
  for (const n of playerNodes) {
    const def = effectiveDefense(state, n);
    // Tier 1 only ever snipes the player's LAST node (guaranteed-loss states);
    // higher tiers snipe any sufficiently open node.
    if (tier.snipeMaxDef < 0 && playerNodes.length > 1) continue;
    if (def > Math.max(tier.snipeMaxDef, tier.snipeMaxDef < 0 ? 2 : -1)) continue;
    if (def < targetDef) {
      target = n;
      targetDef = def;
    }
  }
  if (!target) return false;

  let src: Node | null = null;
  let srcDist = Infinity;
  for (const n of state.nodes) {
    if (n.owner !== "enemy" || hasFlow(state, n.id)) continue;
    const cost = killCost(state, target, n, Math.floor(n.units * tier.killSend));
    if (n.units * tier.killSend >= state.cfg.aiKillCertainty * cost && dist(n, target) < srcDist) {
      src = n;
      srcDist = dist(n, target);
    }
  }
  if (!src) return false;
  startFlow(state, src.id, target.id, tier.killSend);
  return true;
}

/* ------------------------------------------------------------ normal layer */

function scoreTarget(state: GameState, src: Node, n: Node, waveSize: number): number {
  const prodDuringTravel =
    n.owner === "neutral" ? 0 : Math.ceil(waveTicks(src, n, waveSize) / PROD_INTERVAL[n.size]);
  return (
    60 / (1 + dist(src, n) / 20) +
    (n.owner === "neutral" ? state.cfg.aiNeutralBonus : 8) +
    4 * n.size -
    effectiveDefense(state, n) -
    prodDuringTravel
  );
}

function normalDecision(state: GameState, tier: Tier, decided: Set<number>): boolean {
  const { cfg } = state;

  let src: Node | null = null;
  for (const n of state.nodes) {
    if (n.owner !== "enemy" || n.units < cfg.aiMinUnits || decided.has(n.id)) continue;
    if (hasFlow(state, n.id)) continue;
    if (!src || n.units > src.units) src = n;
  }
  if (!src) return false;
  decided.add(src.id);

  const wave = Math.floor(src.units * cfg.aiSendFraction);
  let best: Node | null = null;
  let bestScore = -Infinity;
  for (const n of state.nodes) {
    if (n.owner === "enemy") continue;
    const score = scoreTarget(state, src, n, wave);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (!best) return false;

  const need = effectiveDefense(state, best) + cfg.aiOverkillMargin;
  if (wave > need) {
    startFlow(state, src.id, best.id, cfg.aiSendFraction);
    return true;
  }

  // Focus fire: pair with a second free node when the prize is worth it.
  if (tier.focusFire) {
    let ally: Node | null = null;
    for (const n of state.nodes) {
      if (n.owner !== "enemy" || n.id === src.id || decided.has(n.id)) continue;
      if (hasFlow(state, n.id) || n.units < cfg.aiMinUnits / 2) continue;
      if (!ally || n.units > ally.units) ally = n;
    }
    if (ally && wave + Math.floor(ally.units * cfg.aiSendFraction) > need + cfg.aiOverkillMargin) {
      decided.add(ally.id);
      startFlow(state, src.id, best.id, cfg.aiSendFraction);
      startFlow(state, ally.id, best.id, cfg.aiSendFraction);
      return true;
    }
  }

  // No safe attack: shore up the frontline (enemy node closest to any player node).
  let front: Node | null = null;
  let frontDist = Infinity;
  for (const n of state.nodes) {
    if (n.owner !== "enemy" || n.id === src.id) continue;
    for (const p of state.nodes) {
      if (p.owner !== "player") continue;
      const d = dist(n, p);
      if (d < frontDist) {
        frontDist = d;
        front = n;
      }
    }
  }
  if (front && front.units < src.units / 2) {
    startFlow(state, src.id, front.id, cfg.aiSendFraction);
    return true;
  }
  return false;
}

/* -------------------------------------------------------------- entry point */

export function aiDecide(state: GameState): void {
  const { cfg } = state;
  if (state.tick < cfg.aiFirstMoveTick) return;
  const tier = TIERS[cfg.aiTier] ?? TIERS[1]!;

  // Kill layer: faster cadence than the wake-up at higher tiers.
  const killDue =
    tier.killCheckTicks > 0
      ? state.tick % tier.killCheckTicks === 0
      : state.tick >= state.nextAiTick;
  if (killDue) {
    if (tryFinisher(state, tier)) return;
    if (trySnipe(state, tier)) return;
  }

  if (state.tick < state.nextAiTick) return;
  // Reschedule first so every exit path keeps the cadence (rng jitter,
  // deterministic via sim rng).
  state.nextAiTick =
    state.tick + cfg.aiIntervalTicks + Math.floor(rngNext(state.rng) * cfg.aiIntervalTicks * 0.4);

  const decided = new Set<number>();
  for (let i = 0; i < tier.maxDecisions; i++) {
    if (!normalDecision(state, tier, decided)) break;
  }
}
