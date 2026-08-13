import type { FactionCfg, Faction, GameState, Node, NodeKind, Persona } from "./state";
import {
  NEUTRAL,
  PLAYER,
  KIND_STANDARD,
  KIND_FACTORY,
  KIND_FORTRESS,
  KIND_TURRET,
  KIND_RELAY,
  KIND_VOLATILE,
  KIND_BEACON,
  KIND_SIPHON,
  KIND_VAULT,
  KIND_NURSERY,
  KIND_CORRUPTER,
  KIND_RIFT,
} from "./state";
import { rngNext } from "./state";
import { applyUpgrade, dist, prodInterval, startFlow, travelTicks } from "./tick";
import {
  EMIT_EVERY,
  MIN_SPACING,
  NURSERY_NEUTRAL_INTERVAL,
  SIPHON_RANGE,
  UPGRADE_COST,
  VOLATILE_DAMAGE,
  VOLATILE_RADIUS,
  unitCap,
} from "./constants";

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
// The three original personas were sharpened for the objective schedule pass
// (aggression 1.5→1.9, turtle 1.3→1.6, opportunism 1.6→2.2): the late duels now
// draw their identity from a single persona instead of BALANCED, so the
// contrast between them has to carry a whole level. Measured against the full
// gate set (screen sweep L1-24 attempts 0-4, both balance funnels, aggression
// and persona-contrast tests): all green at these values, so no back-off was
// needed — the measured limits are AT or beyond these numbers, not below them.
export const CRIMSON: Persona = { aggression: 1.9, expansion: 0.8, opportunism: 0.8, turtle: 0.85 };
export const AMBER: Persona = { aggression: 0.7, expansion: 1.2, opportunism: 0.7, turtle: 1.6 };
export const VIOLET: Persona = { aggression: 1.0, expansion: 1.0, opportunism: 2.2, turtle: 1.0 };
/**
 * The hill-keeper, added for HOLD objectives: modest aggression, healthy
 * expansion, and a turtle factor that keeps roughly twice the garrison of
 * BALANCED — so once it takes the marked hill (objectiveLure pulls every
 * faction there) it visibly digs in, and tryGarrisonObjective has a persona
 * whose send fraction leaves something to garrison WITH. Cast by
 * personasForLevel on hold levels (faction 2, the slot whose home ties nearest
 * the hill on symmetric boards).
 */
export const WARDEN: Persona = { aggression: 0.7, expansion: 0.9, opportunism: 0.8, turtle: 2.0 };

/**
 * Structural capability by tier.
 *
 * Tiers 1–4 are reflexes: how often the kill layer runs, how many fronts, how
 * deep a snipe. Tier 4 already checks for a kill EVERY tick, so there is
 * nothing left to accelerate — tiers 5+ therefore add *powers* instead of
 * bigger numbers. Past L16 the enemy has to get cleverer, because node count is
 * capped by phone legibility and every scalar knob in levelParams is pinned.
 *
 * ── READ THIS BEFORE ADDING TIER 10 ──────────────────────────────────────────
 *
 * The ladder is close to exhausted, and the numbers are not close. Measured
 * against the competent reference bot over L45–104, 6,480 games per variant,
 * as the player's win rate (lower = the AI is stronger):
 *
 *   tier 4  27.42%  ── no phase-3A capability at all
 *   tier 7  25.96%  ── reinforce + kind-awareness + upgrades under pressure
 *   tier 8  24.95%  ── + evacuate
 *   tier 9  25.17%  ── + a third focus-fire source
 *
 * Five tiers of added capability buy about **2 percentage points**, and every
 * step's confidence interval straddles zero. Solved levels tell the same story:
 * 46/60 → 42 → 41 → 41.
 *
 * The reason is structural, not a shortage of good ideas. A late game is
 * decided in a median of 39 s when won and 13 s when lost, during which each
 * faction wakes perhaps two or three times. Decision *quality* has almost no
 * room to compound — the board is settled before it can. Difficulty that has to
 * come from somewhere should come from the shape of the fight (objectives,
 * board, economy), not from another row in this table.
 *
 * Two capabilities were built and cut on this evidence; both write-ups are
 * below, and both are more useful than the tier they would have been.
 */
interface Tier {
  /** Tier number. Present so nothing has to sniff a tier by a field value. */
  id: number;
  killCheckTicks: number; // 0 = only at the normal wake-up
  maxDecisions: number;
  snipeMaxDef: number; // -1 = last-node-only snipes
  focusFire: boolean;
  redirectForKill: boolean;
  killSend: number;
  upgrades: boolean;
  /** Node upgrades started per wake. */
  upgradesPerWake: number;
  /** Scales UPGRADE_SAFE_DIST — below 1 means building under pressure. */
  upgradeSafeMul: number;
  /** Reinforce a node that is about to fall, instead of only as a fallback. */
  reinforceThreatened: boolean;
  /** Read the board's node kinds: value relays/beacons, respect blasts. */
  kindAware: boolean;
  /**
   * Pull the garrison off a node that is certainly lost.
   *
   * The reinforce branch (tier 5+) saves what can be saved; this is what to do
   * with what cannot. Below this tier the units sit and are donated to the
   * attacker, because a captured node keeps the surplus of whatever took it.
   */
  evacuate: boolean;
  /**
   * How many sources may converge on one target. 2 is the historic focus-fire
   * pair; 3 puts nodes in reach that the AI simply could not crack before.
   */
  focusSources: number;
}

/**
 * A second capability built, measured, and cut — the same fate as
 * `denyCaptures` above, and for a better reason than "it did nothing".
 *
 * `preciseCommit` had tier 8 send exactly what a capture costs (`need + 1`)
 * instead of a flat `aiSendFraction`, on the reasoning that the surplus spends
 * the trip in the air defending nothing. Measured over 6,480 games on L45–104
 * it made the AI **worse**: the player's win rate went 25.96% → 28.06%, a 2.1pp
 * gift, against a ±1.1pp interval.
 *
 * The reasoning was wrong in a way worth writing down. The surplus is not
 * overspend — it is the *garrison of the node being captured*. Arriving with
 * exactly enough leaves the new node holding 1 unit on a contested frontier,
 * where the previous owner takes it straight back. "Overkill" was buying a
 * defensible position, and pricing it out was pricing out the position.
 */

/**
 * A capability that was built, measured, and cut: `denyCaptures`, meant to let
 * high tiers spoil a neutral the player had committed to.
 *
 * It never changed a single decision. `effDef` is `units + inboundFriendly −
 * inboundHostile`, so a neutral the player is already streaming at ALREADY
 * scores as cheap, and the ordinary attack path pounces on it unprompted —
 * measured on both a distance-dominated board and a value-dominated one, the
 * first AI flow at the contested node landed on the identical tick with the
 * branch on and off. Shipping it would have been a tier bullet-point that does
 * nothing. Recorded here so it does not get "re-added" as an obvious idea.
 */

const TIERS: Record<number, Tier> = {
  1: { id: 1, killCheckTicks: 0, maxDecisions: 1, snipeMaxDef: -1, focusFire: false, redirectForKill: false, killSend: 0.9, upgrades: false, upgradesPerWake: 1, upgradeSafeMul: 1, reinforceThreatened: false, kindAware: false, evacuate: false, focusSources: 2 },
  2: { id: 2, killCheckTicks: 30, maxDecisions: 2, snipeMaxDef: 2, focusFire: false, redirectForKill: false, killSend: 0.9, upgrades: false, upgradesPerWake: 1, upgradeSafeMul: 1, reinforceThreatened: false, kindAware: false, evacuate: false, focusSources: 2 },
  3: { id: 3, killCheckTicks: 15, maxDecisions: 3, snipeMaxDef: 3, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 1, upgradeSafeMul: 1, reinforceThreatened: false, kindAware: false, evacuate: false, focusSources: 2 },
  4: { id: 4, killCheckTicks: 1, maxDecisions: 4, snipeMaxDef: 4, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 1, upgradeSafeMul: 1, reinforceThreatened: false, kindAware: false, evacuate: false, focusSources: 2 },
  // 5: stops feeding nodes it is about to lose, and reads the board's kinds.
  5: { id: 5, killCheckTicks: 1, maxDecisions: 4, snipeMaxDef: 5, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 1, upgradeSafeMul: 0.6, reinforceThreatened: true, kindAware: true, evacuate: false, focusSources: 2 },
  // 6: builds economy under pressure — two upgrades a wake, and it will start
  //    one with a hostile 20 wu away where tier 4 waits for 56 wu of quiet.
  6: { id: 6, killCheckTicks: 1, maxDecisions: 5, snipeMaxDef: 6, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 2, upgradeSafeMul: 0.35, reinforceThreatened: true, kindAware: true, evacuate: false, focusSources: 2 },
  // 7: six fronts and a snipe threshold most nodes never clear.
  7: { id: 7, killCheckTicks: 1, maxDecisions: 6, snipeMaxDef: 8, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 2, upgradeSafeMul: 0.35, reinforceThreatened: true, kindAware: true, evacuate: false, focusSources: 2 },
  // 8: the only tier that knows how to LOSE a node. It walks the garrison out
  //    of one it cannot hold rather than handing it over as the new owner's.
  //    Worth 1.0pp against tier 7 (CI [-0.5, 2.5]) — the largest single step in
  //    the table, which says more about the table than about evacuating.
  8: { id: 8, killCheckTicks: 1, maxDecisions: 6, snipeMaxDef: 8, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 2, upgradeSafeMul: 0.35, reinforceThreatened: true, kindAware: true, evacuate: true, focusSources: 2 },
  // 9: the ceiling. Three sources on one target, so a node garrisoned beyond
  //    any PAIR of the AI's nodes stops being a safe place to stand — a real
  //    capability (tiers.test.ts holds a board tier 8 provably cannot crack)
  //    that is nonetheless worth -0.2pp in aggregate, i.e. nothing. It is here
  //    because the boss promotion needs a rung above tier 8 for L50 and L56,
  //    and because a capability that changes decisions is not `denyCaptures`.
  //    Do not read it as evidence that a tier 10 would be worth building.
  9: { id: 9, killCheckTicks: 1, maxDecisions: 6, snipeMaxDef: 8, focusFire: true, redirectForKill: true, killSend: 1.0, upgrades: true, upgradesPerWake: 2, upgradeSafeMul: 0.35, reinforceThreatened: true, kindAware: true, evacuate: true, focusSources: 3 },
};

export const MAX_TIER = 9;

/**
 * Clamp to the top tier rather than falling back to tier 1.
 *
 * This used to be `TIERS[cfg.aiTier] ?? TIERS[1]!`, which turned any
 * out-of-range tier into the *weakest* AI in the game. Silent, and precisely
 * backwards for the one case that would ever hit it.
 */
function tierFor(n: number): Tier {
  return TIERS[Math.max(1, Math.min(MAX_TIER, Math.floor(n)))]!;
}

/**
 * The AI's two absolute distance calibrations, in world units.
 *
 * Both are expressed as multiples of MIN_SPACING rather than as bare numbers,
 * because that is what they actually mean: "about one hop away" and "about two
 * hops of clear air". When node spacing grew from 16 to 23 the literals 20 and
 * 45 would have quietly shrunk the AI's effective neighbourhood — it would have
 * valued near targets less and thought itself unsafe far more often — which is
 * a difficulty change disguised as a layout change.
 */
const DIST_FALLOFF = MIN_SPACING * 1.25;
const UPGRADE_SAFE_DIST = MIN_SPACING * 2.8;

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

/**
 * Ticks for a wave of `units` from src to land on dst (travel + drain time).
 * Uses the SOURCE's packet speed, so a wave launched from a relay is correctly
 * timed as the faster one it actually is.
 */
function waveTicks(state: GameState, src: Node, dst: Node, units: number): number {
  return travelTicks(state, src, dst) + units * EMIT_EVERY;
}

/** Hostile packets needed per defender. Fortress armor absorbs every second one. */
function defenceMultiplier(n: Node): number {
  return n.kind === KIND_FORTRESS ? 2 : 1;
}

/**
 * Units the target will gain while the wave is in the air.
 *
 * Neutrals are normally static, but a NURSERY grows while unowned — without
 * this the AI would chronically under-commit against exactly the node whose
 * whole point is that ignoring it costs you.
 */
function growthDuringTravel(state: GameState, n: Node, src: Node, waveSize: number): number {
  const ticks = waveTicks(state, src, n, waveSize);
  if (n.owner !== NEUTRAL) return Math.ceil(ticks / prodInterval(state, n));
  if (n.kind === KIND_NURSERY) return Math.ceil(ticks / NURSERY_NEUTRAL_INTERVAL);
  return 0;
}

/**
 * Units needed to take `n` with a wave from `src`: defenders at arrival
 * (doubled behind fortress armor), production landing during travel, plus
 * the capture unit.
 */
function killCost(state: GameState, n: Node, src: Node, waveSize: number): number {
  const def = Math.max(0, effDef(n)) * defenceMultiplier(n);
  return def + growthDuringTravel(state, n, src, waveSize) + 1;
}

function hasFlow(state: GameState, nodeId: number): boolean {
  return state.flows.some((f) => f.from === nodeId);
}

/**
 * Every node this faction owns is sitting at its unit cap.
 *
 * A faction in that state is earning NOTHING — production is stopped
 * everywhere — so waiting for a safer moment is strictly dominated: the rival
 * keeps producing (or is equally frozen, in which case the board is a
 * standoff that only an attack can end). This is the sim-level pressure
 * valve behind the all-capped-standoff fix: a capped bot attacks with the
 * brake off (see certaintyFor and normalDecision), which makes an eternal
 * L1 freeze structurally impossible instead of merely unlikely. Transient in
 * live fights — an emitting node is below cap by definition — so the
 * relaxation binds exactly when the game has stalled and nowhere else.
 */
function allOwnCapped(state: GameState, self: Faction): boolean {
  let any = false;
  for (const n of state.nodes) {
    if (n.owner !== self) continue;
    any = true;
    if (n.units < unitCap(n.size, n.kind)) return false;
  }
  return any;
}

function certaintyFor(state: GameState, self: Faction, victim: Faction): number {
  const c = state.cfg.aiKillCertainty;
  const base = victim === PLAYER ? c * state.cfg.aiKillPlayerBias : c;
  // Capped everywhere = nothing to lose by going: halve the brake, floored at
  // committed-force parity. This is what actually ends a passive-player L1 —
  // the tier-1 finisher's force can never reach 3× a capped garrison's cost,
  // and certainty tuning only moves which seeds stall, not whether they can.
  return allOwnCapped(state, self) ? Math.max(1.1, base * 0.5) : base;
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
  if (force < certaintyFor(state, self, victim) * totalCost) return false;

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
  const certainty = certaintyFor(state, self, target.owner);
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

/**
 * How much the AI wants a node for its kind alone, before geometry and cost.
 *
 * A Record rather than an array on purpose: `tsc` then fails the build when a
 * kind is added without a weight. As a tuple this was `KIND_LURE[n.kind]` →
 * `undefined` → `NaN` score → the AI silently stops preferring anything, which
 * is the kind of bug that never shows up as a crash.
 */
const KIND_LURE: Record<NodeKind, number> = {
  [KIND_STANDARD]: 0,
  [KIND_FACTORY]: 6,
  [KIND_FORTRESS]: -2, // costs double to take
  [KIND_TURRET]: 4,
  [KIND_RELAY]: 5, // a forward staging post
  [KIND_VOLATILE]: -4, // taking it hurts whatever you already own nearby
  [KIND_BEACON]: 6, // lifts a whole cluster, so worth as much as a factory
  [KIND_SIPHON]: 5, // denies the owner AND feeds you
  [KIND_VAULT]: 3, // a big bank, but slow to fill
  [KIND_NURSERY]: 4, // free units if you leave it, better if you take it
  [KIND_CORRUPTER]: 6, // every stolen unit is a two-unit swing, so worth a factory
  [KIND_RIFT]: 2, // worth little alone and a great deal as a PAIR, which this
  //                 flat table cannot express — see riftPairBonus below
};

/**
 * Tier-5+ reading of the board's kinds, beyond the static KIND_LURE weight.
 *
 * Two judgements a lower tier cannot make:
 *  - taking a volatile costs you units on everything you already own nearby,
 *    so the blast is priced in rather than discovered afterwards;
 *  - a hostile siphon next door drains whatever you park there, so a node in
 *    its reach is worth less than the same node out of it.
 */
function kindAwareAdjust(state: GameState, self: Faction, n: Node): number {
  let adj = 0;
  if (n.kind === KIND_VOLATILE) {
    const r2 = VOLATILE_RADIUS * VOLATILE_RADIUS;
    for (const m of state.nodes) {
      if (m.id === n.id || m.owner !== self) continue;
      const dx = m.x - n.x;
      const dy = m.y - n.y;
      if (dx * dx + dy * dy <= r2) adj -= Math.min(VOLATILE_DAMAGE, m.units);
    }
  }
  // A rift is worth almost nothing alone and a great deal as a PAIR — it is
  // the only kind whose value depends on what its owner already holds, which
  // is exactly what the flat KIND_LURE table cannot express. Without this the
  // AI rates the second rift the same as the first and never completes a link.
  if (n.kind === KIND_RIFT) {
    for (const m of state.nodes) {
      if (m.id !== n.id && m.kind === KIND_RIFT && m.owner === self) {
        adj += 8;
        break;
      }
    }
  }
  const sr2 = SIPHON_RANGE * SIPHON_RANGE;
  for (const m of state.nodes) {
    // `m.id === n.id` matters: without it the hostile siphon penalises ITSELF
    // as a target, netting −1 against KIND_LURE's +5 and making a kind-aware
    // tier refuse to capture the very node draining it — measured, tier 4 took
    // the siphon and tier 5 walked past it. Taking it is the direct counter.
    if (m.id === n.id || m.kind !== KIND_SIPHON || m.owner === NEUTRAL || m.owner === self) {
      continue;
    }
    const dx = m.x - n.x;
    const dy = m.y - n.y;
    // `<` not `<=`, matching siphonDrain's own exclusive range test.
    if (dx * dx + dy * dy < sr2) adj -= 6;
  }
  return adj;
}

/**
 * The objective's pull on target scoring — the KIND_LURE of the win condition.
 *
 * Only `hold` lures attackers: the hill is worth contesting for every faction,
 * or the level's centrepiece is just another node and the ring fills against
 * an indifferent board. A crown lures nobody here — a rival taking another
 * rival's crown wins nothing (defence of one's OWN crown is
 * tryGarrisonObjective's job, a send toward a node scoreTarget never scores).
 */
const HILL_LURE = 15;

function objectiveLure(state: GameState, n: Node): number {
  const obj = state.cfg.objective;
  return obj?.type === "hold" && obj.targetNodeId === n.id ? HILL_LURE : 0;
}

function scoreTarget(
  state: GameState,
  self: Faction,
  persona: Persona,
  tier: Tier,
  alive: number,
  avgMaterial: number,
  src: Node,
  n: Node,
  waveSize: number,
): number {
  // Anti-snowball: bias attacks toward the material leader (only meaningful
  // in 3+-faction fights; 1v1 keeps the classic scoring exactly).
  const threat =
    n.owner === NEUTRAL || alive < 3
      ? 0
      : 12 * Math.max(0, material[n.owner]! / avgMaterial - 1) * persona.opportunism;
  return (
    60 / (1 + dist(src, n) / DIST_FALLOFF) +
    (n.owner === NEUTRAL
      ? state.cfg.aiNeutralBonus * persona.expansion
      : 8 * persona.aggression) +
    4 * n.size +
    KIND_LURE[n.kind] +
    objectiveLure(state, n) -
    effDef(n) -
    growthDuringTravel(state, n, src, waveSize) +
    threat +
    (tier.kindAware ? kindAwareAdjust(state, self, n) : 0)
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
    const score = scoreTarget(state, self, persona, tier, alive, avgMaterial, src, n, wave);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  if (!best) return false;

  // Capped everywhere: the overkill margin protects production that has
  // already stopped — drop it. See allOwnCapped.
  const margin = allOwnCapped(state, self) ? 0 : Math.ceil(cfg.aiOverkillMargin / persona.aggression);
  const need = Math.max(0, effDef(best)) * defenceMultiplier(best) + margin;
  if (wave > need) {
    startFlow(state, src.id, best.id, sendFraction);
    return true;
  }

  // Focus fire: converge free nodes on one target when the prize is worth it.
  //
  // `focusSources` was a hard-coded pair. Generalising it is not a bigger
  // number so much as a different set of reachable targets: a node garrisoned
  // above what any TWO of the AI's nodes can raise was simply off the board
  // before, however long the AI sat there.
  if (tier.focusFire) {
    const allies: Node[] = [];
    let raised = wave;
    while (allies.length < tier.focusSources - 1) {
      let ally: Node | null = null;
      for (const n of state.nodes) {
        if (n.owner !== self || n.id === src.id || decided.has(n.id)) continue;
        if (allies.includes(n) || hasFlow(state, n.id) || n.units < cfg.aiMinUnits / 2) continue;
        // Past the historic pair only: never strip a node that is itself under
        // attack. Emptying three nodes at once is how "more sources" turns into
        // a weaker AI — it buys one node and offers two back. The pair path is
        // left exactly as calibrated.
        if (allies.length >= 1 && inboundHostile[n.id]! > 0) continue;
        if (!ally || n.units > ally.units) ally = n;
      }
      if (!ally) break;
      allies.push(ally);
      raised += Math.floor(ally.units * sendFraction);
      // Stop as soon as the wave is sufficient — committing a third node to a
      // target two already cover is how a "more sources" tier turns into a
      // worse one.
      if (raised > need + margin) break;
    }
    if (allies.length && raised > need + margin) {
      startFlow(state, src.id, best.id, sendFraction);
      for (const ally of allies) {
        decided.add(ally.id);
        startFlow(state, ally.id, best.id, sendFraction);
      }
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

/**
 * Tier 5+: save the node that is about to fall, REDIRECTING if it has to.
 *
 * Runs before the attack loop, and deliberately considers sources that already
 * have an outgoing stream — the same licence `redirectForKill` gives the kill
 * layer. Without that it is nearly a no-op: an AI commits its big node early,
 * and by the time a threat is visible in `inboundHostile` there is no idle
 * source left, so the branch never fires. That is what "stops feeding nodes it
 * is about to lose" has to mean to be worth a tier.
 *
 * Below tier 5 the only defensive move is the no-safe-attack fallback at the
 * bottom of normalDecision, which never fires while any target looks affordable.
 */
function tryReinforce(state: GameState, self: Faction, persona: Persona, tier: Tier): boolean {
  if (!tier.reinforceThreatened) return false;

  // The own node with the largest shortfall against what is already in flight.
  let doomed: Node | null = null;
  let worst = 0;
  for (const n of state.nodes) {
    if (n.owner !== self) continue;
    const deficit = inboundHostile[n.id]! - n.units - inboundFriendly[n.id]!;
    if (deficit > worst) {
      worst = deficit;
      doomed = n;
    }
  }
  if (!doomed) return false;

  const sendFraction = Math.min(0.95, state.cfg.aiSendFraction / persona.turtle);
  let src: Node | null = null;
  let bestD = Infinity;
  for (const n of state.nodes) {
    if (n.owner !== self || n.id === doomed.id) continue;
    // Already feeding it — leave that stream alone rather than resetting it.
    if (state.flows.some((f) => f.from === n.id && f.to === doomed!.id)) return false;
    if (Math.floor(n.units * sendFraction) <= worst) continue;
    const d = dist(n, doomed);
    if (d < bestD) {
      bestD = d;
      src = n;
    }
  }
  if (!src) return false;
  startFlow(state, src.id, doomed.id, sendFraction);
  return true;
}

/**
 * Tier 9: walk the garrison out of a node that is already lost.
 *
 * `tryReinforce` handles the nodes that can be saved. This is the other half —
 * what to do about the ones that cannot — and every tier below simply leaves
 * the units standing there, where a capture hands them to the attacker as its
 * new garrison. Evacuating loses the node either way (a little sooner, since
 * the defenders leave), but the material walks away instead of changing sides,
 * which is a two-for-one swing on the board.
 *
 * Deliberately narrow, so it cannot turn into "retreat whenever pressed":
 *  - the node must already be lost on the packets ALREADY in the air, not on a
 *    guess about what might come;
 *  - nothing friendly may be inbound, or this would race tryReinforce and
 *    cancel a rescue that was working;
 *  - the destination must not itself be under threat, or the units are just
 *    donated one node later;
 *  - it must not already have an outgoing stream, so the retreat cannot be
 *    restarted every wake.
 */
function tryEvacuate(state: GameState, self: Faction, persona: Persona, tier: Tier): boolean {
  if (!tier.evacuate) return false;

  let doomed: Node | null = null;
  let worst = 0;
  for (const n of state.nodes) {
    if (n.owner !== self || hasFlow(state, n.id)) continue;
    if (inboundFriendly[n.id]! > 0) continue; // a rescue is in flight — leave it
    const deficit = inboundHostile[n.id]! - n.units;
    if (deficit > 0 && deficit > worst) {
      worst = deficit;
      doomed = n;
    }
  }
  if (!doomed) return false;

  let dst: Node | null = null;
  let bestD = Infinity;
  for (const n of state.nodes) {
    if (n.owner !== self || n.id === doomed.id) continue;
    if (inboundHostile[n.id]! >= n.units) continue; // falling too — no refuge
    const d = dist(n, doomed);
    if (d < bestD) {
      bestD = d;
      dst = n;
    }
  }
  if (!dst) return false;

  startFlow(state, doomed.id, dst.id, Math.min(0.95, state.cfg.aiSendFraction / persona.turtle));
  return true;
}

/**
 * Tier-gated economy move: upgrade the richest safe node(s).
 *
 * The tier-2 escape hatch used to read `tier.killCheckTicks === 30`, i.e. it
 * identified a tier by one of its stat values because Tier carried no id.
 * That is now `tier.id === 2` — same behaviour, but retuning a cadence can no
 * longer silently hand or revoke AMBER's economy.
 *
 * Tier 6+ builds two per wake and accepts hostiles far closer (upgradeSafeMul),
 * which is what turns a late-game AI from "expands when left alone" into one
 * that compounds while the fight is on.
 */
function tryUpgrade(state: GameState, self: Faction, persona: Persona, tier: Tier): void {
  if (!tier.upgrades && !(tier.id === 2 && persona.expansion >= 1.2)) return;
  const safeDist = UPGRADE_SAFE_DIST * tier.upgradeSafeMul;
  const started = new Set<number>();
  for (let round = 0; round < tier.upgradesPerWake; round++) {
    let pick: Node | null = null;
    for (const n of state.nodes) {
      if (n.owner !== self || n.size >= 2 || n.upgrading !== 0 || hasFlow(state, n.id)) continue;
      if (started.has(n.id)) continue;
      if (n.units < UPGRADE_COST[n.size as 0 | 1] + state.cfg.aiMinUnits) continue;
      // Safety: nothing hostile within the tier's safe distance.
      let safe = true;
      for (const h of state.nodes) {
        if (h.owner === self || h.owner === NEUTRAL) continue;
        if (dist(n, h) < safeDist) {
          safe = false;
          break;
        }
      }
      if (safe && (!pick || n.units > pick.units)) pick = n;
    }
    if (!pick) return;
    started.add(pick.id);
    applyUpgrade(state, pick.id, self);
  }
}

/**
 * Objective garrison: the faction that owns the marked node keeps it fed.
 *
 * tryReinforce only reacts to packets ALREADY in the air, which is the right
 * brake for ordinary nodes and the wrong one for a node whose loss ends the
 * level: by the time the deficit is visible, a crown with 3 defenders is
 * already gone. This tops the marked node up toward a standing floor instead,
 * every tier, so a crown or contested hill reads as *defended* rather than as
 * the cheapest snipe on the board.
 *
 * Deliberately mild: one feeder, only when below the floor, never a node that
 * is itself the objective, and never re-issued over an existing feed — the
 * objective must make the fight's shape different, not make the AI unbeatable.
 */
function tryGarrisonObjective(state: GameState, self: Faction, persona: Persona): boolean {
  const obj = state.cfg.objective;
  if (!obj || obj.targetNodeId === undefined) return false;
  if (obj.type !== "crown" && obj.type !== "hold") return false;
  const marked = state.nodes[obj.targetNodeId];
  if (!marked || marked.owner !== self) return false;

  const floor = state.cfg.aiMinUnits + 4;
  if (effDef(marked) >= floor) return false;
  if (state.flows.some((f) => f.to === marked.id && state.nodes[f.from]!.owner === self)) {
    return false; // a feed is already flowing — let it land
  }

  const sendFraction = Math.min(0.95, state.cfg.aiSendFraction / persona.turtle);
  let src: Node | null = null;
  let bestD = Infinity;
  for (const n of state.nodes) {
    if (n.owner !== self || n.id === marked.id || hasFlow(state, n.id)) continue;
    if (Math.floor(n.units * sendFraction) < floor - effDef(marked)) continue;
    const d = dist(n, marked);
    if (d < bestD) {
      bestD = d;
      src = n;
    }
  }
  if (!src) return false;
  startFlow(state, src.id, marked.id, sendFraction);
  return true;
}

/**
 * Fire any scripted opening due this tick for this faction.
 *
 * Runs BEFORE the firstMoveTick gate — the whole point is authored life in
 * the window where the decision layers are still asleep. Role resolution is
 * deterministic: richest own node as the source, nearest/farthest matching
 * target, all ties broken by lowest id via strict comparison. No RNG, so a
 * board with openings screens and replays byte-identically.
 */
function runOpenings(state: GameState, fc: FactionCfg): void {
  const openings = state.cfg.openings;
  if (!openings) return;
  for (const o of openings) {
    if (o.faction !== fc.faction || o.tick !== state.tick) continue;
    let src: Node | null = null;
    for (const n of state.nodes) {
      if (n.owner !== fc.faction) continue;
      if (!src || n.units > src.units) src = n;
    }
    if (!src) continue;
    let best: Node | null = null;
    let bestD = o.to === "farNeutral" ? -Infinity : Infinity;
    for (const n of state.nodes) {
      const wanted = o.to === "playerNearest" ? n.owner === PLAYER : n.owner === NEUTRAL;
      if (!wanted) continue;
      const d = dist(src, n);
      if (o.to === "farNeutral" ? d > bestD : d < bestD) {
        bestD = d;
        best = n;
      }
    }
    if (best) startFlow(state, src.id, best.id, o.fraction ?? state.cfg.aiSendFraction);
  }
}

/* -------------------------------------------------------------- entry point */

function aiDecideFaction(state: GameState, fc: FactionCfg): void {
  const { cfg } = state;
  const self = fc.faction;
  runOpenings(state, fc);
  if (state.tick < fc.firstMoveTick) return;
  // Per-faction override first: on a boss level one named rival outclasses the
  // rest of the board, and late levels mix capability as well as personality.
  const tier = tierFor(fc.tier ?? cfg.aiTier);

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
  // Defence before offence, at the tiers that have it. The objective garrison
  // runs first and at EVERY tier (a crown must read as defended on L6, not
  // from tier 5 up); then save what can be saved, then evacuate what cannot —
  // in that order, so a node with a rescue already inbound is never abandoned.
  tryGarrisonObjective(state, self, fc.persona);
  tryReinforce(state, self, fc.persona, tier);
  tryEvacuate(state, self, fc.persona, tier);
  const decided = new Set<number>();
  for (let i = 0; i < tier.maxDecisions; i++) {
    if (!normalDecision(state, self, fc.persona, tier, decided)) break;
  }
  tryUpgrade(state, self, fc.persona, tier);
}

export function aiDecide(state: GameState): void {
  for (const fc of state.cfg.ais) aiDecideFaction(state, fc);
}
