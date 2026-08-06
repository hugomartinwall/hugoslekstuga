import type {
  FactionCfg,
  Faction,
  GameState,
  LevelCfg,
  Node,
  NodeKind,
  NodeSize,
  Persona,
  Rng,
} from "./state";
import {
  KIND_FACTORY,
  KIND_FORTRESS,
  KIND_STANDARD,
  KIND_TURRET,
  NEUTRAL,
  PLAYER,
  rngNext,
  WORLD_H,
  WORLD_W,
} from "./state";
import {
  MAP_MARGIN,
  MIN_SPACING,
  MIN_SPACING_3WAY,
  PROD_INTERVAL,
  SPECIAL_NEUTRAL_CHANCE,
  UPGRADE_COST,
  UPGRADE_TICKS,
} from "./constants";
import { AMBER, BALANCED, CRIMSON, VIOLET } from "./ai";

/**
 * Procedural level generation. Same level number ⇒ same map, forever —
 * retrying a lost level replays the exact same board, which is learnable.
 * Fairness by construction: every faction's view of the board is congruent —
 * mirror symmetry for duels, Klein-group reflections for 4-way, true 120°
 * rotation inside the centered disc for 3-way.
 */

/* -------------------------------------------------------- meta-progression */

/** Permanent player boosts folded into the level at creation. */
export interface PlayerBoosts {
  startUnits: number;
  prodInterval: readonly [number, number, number];
  upgradeCost: readonly [number, number];
  upgradeTicks: number;
}

export const DEFAULT_BOOSTS: PlayerBoosts = {
  startUnits: 0,
  prodInterval: PROD_INTERVAL,
  upgradeCost: UPGRADE_COST,
  upgradeTicks: UPGRADE_TICKS,
};

/* ------------------------------------------------------------- difficulty */

interface LevelParams extends Omit<LevelCfg, "ais" | "playerProdInterval" | "playerUpgradeCost" | "playerUpgradeTicks"> {
  nodeCount: number;
  neutralLo: number;
  neutralHi: number;
  playerStart: number;
  enemyStart: number;
}

/** How many factions (incl. the player) fight on level L. */
export function factionsForLevel(L: number): number {
  if (L <= 5) return 2; // onboarding + teaching levels stay duels
  if (L <= 11) return L === 8 ? 2 : 3; // 3-way debuts at 6; L8 = breather duel
  return [4, 3, 4, 2][(L - 12) % 4]!;
}

/** Persona casting per level — variety and drama, per the design table. */
export function personasForLevel(L: number): Persona[] {
  const CAST: Record<number, Persona[]> = {
    6: [AMBER, VIOLET], // gentlest possible 3-way intro
    7: [CRIMSON, AMBER], // crimson grabs the turret and shreds amber on camera
    8: [CRIMSON], // breather brawl duel
    9: [CRIMSON, VIOLET],
    10: [CRIMSON, AMBER],
    11: [VIOLET, VIOLET],
    12: [CRIMSON, AMBER, VIOLET], // full-cast 4-way poster level
    13: [CRIMSON, CRIMSON],
    14: [AMBER, AMBER, VIOLET],
    15: [AMBER],
    16: [CRIMSON, CRIMSON, AMBER],
    17: [AMBER, VIOLET],
    18: [CRIMSON, VIOLET, VIOLET],
    19: [VIOLET],
    20: [CRIMSON, AMBER, VIOLET],
    21: [CRIMSON, CRIMSON],
    22: [AMBER, VIOLET, VIOLET],
    23: [CRIMSON],
    24: [CRIMSON, CRIMSON, VIOLET],
    25: [CRIMSON, VIOLET],
  };
  if (CAST[L]) return CAST[L]!;
  const k = factionsForLevel(L);
  if (k === 2) return [BALANCED];
  // Deterministic rotation for 26+.
  const pool = [CRIMSON, AMBER, VIOLET];
  const out: Persona[] = [];
  for (let i = 0; i < k - 1; i++) out.push(pool[(L + i) % 3]!);
  return out;
}

/** L1–3 are hand-tuned for onboarding; formulas take over from L4. */
export function levelParams(level: number): LevelParams {
  const L = level;
  const tuned: Record<number, Partial<LevelParams>> = {
    1: { nodeCount: 5, neutralLo: 2, neutralHi: 4, playerStart: 20, enemyStart: 8,
         aiFirstMoveTick: 450, aiIntervalTicks: 240, aiMinUnits: 15, aiOverkillMargin: 10 },
    2: { nodeCount: 7, neutralLo: 3, neutralHi: 6, playerStart: 15, enemyStart: 10,
         aiFirstMoveTick: 300, aiIntervalTicks: 210, aiMinUnits: 14, aiOverkillMargin: 8 },
    3: { nodeCount: 9, neutralLo: 4, neutralHi: 8, playerStart: 12, enemyStart: 12,
         aiFirstMoveTick: 240, aiIntervalTicks: 180, aiMinUnits: 12, aiOverkillMargin: 7 },
  };
  const factionCount = factionsForLevel(L);
  const base: LevelParams = {
    level: L,
    nodeCount:
      factionCount === 3
        ? Math.min(15, 9 + 3 * Math.floor((L - 4) / 4))
        : Math.min(21, 7 + 2 * Math.floor((L - 1) / 2)),
    neutralLo: Math.min(15, 4 + L),
    neutralHi: Math.min(30, 8 + 2 * L),
    playerStart: 10,
    // Capped: with a competent AI, raw start-material asymmetry becomes an
    // unwinnable opening rush. Skill knobs carry the curve instead.
    enemyStart: Math.min(14, 10 + L),
    aiFirstMoveTick: Math.max(45, 210 - 30 * L),
    aiIntervalTicks: Math.max(45, 195 - 12 * L),
    aiMinUnits: Math.max(6, 16 - L),
    aiOverkillMargin: Math.max(2, Math.round(10 - 0.8 * L)),
    aiTier: L <= 3 ? 1 : L <= 7 ? 2 : L <= 12 ? 3 : 4,
    aiKillCertainty: L <= 3 ? 3.0 : Math.max(1.25, 3.0 - 0.2 * (L - 3)),
    aiSendFraction: Math.min(0.85, 0.65 + 0.015 * Math.max(0, L - 3)),
    aiNeutralBonus: Math.max(6, 25 - 2 * Math.max(0, L - 3)),
    aiKillPlayerBias: 1.0,
    factionCount,
  };
  return { ...base, ...tuned[L] };
}

/* ---------------------------------------------------------------- geometry */

function mirror(p: { x: number; y: number }): { x: number; y: number } {
  return { x: WORLD_W - p.x, y: WORLD_H - p.y };
}

const CX = WORLD_W / 2;
const CY = WORLD_H / 2;
const DISC_R = WORLD_H / 2 - MAP_MARGIN; // 31: rotations stay in-bounds

function rotate(p: { x: number; y: number }, k: number, n: number): { x: number; y: number } {
  const a = (2 * Math.PI * k) / n;
  const dx = p.x - CX;
  const dy = p.y - CY;
  return {
    x: CX + dx * Math.cos(a) - dy * Math.sin(a),
    y: CY + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

/** Rejection-sample a point at least `spacing` from all placed nodes. */
function place(
  rng: Rng,
  placed: readonly { x: number; y: number }[],
  sample: () => { x: number; y: number },
  spacing: number,
): { x: number; y: number } {
  let s = spacing;
  for (;;) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = sample();
      if (placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= s)) return p;
    }
    s -= 2; // relax and retry — guaranteed termination, still deterministic
  }
}

function rollSize(rng: Rng): NodeSize {
  const r = rngNext(rng);
  return r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
}

function rollKind(rng: Rng, level: number): NodeKind {
  if (level < 9) return KIND_STANDARD; // teaching levels hand-place kinds
  if (rngNext(rng) >= SPECIAL_NEUTRAL_CHANCE) return KIND_STANDARD;
  const r = rngNext(rng);
  return r < 0.34 ? KIND_FACTORY : r < 0.67 ? KIND_FORTRESS : KIND_TURRET;
}

/* ---------------------------------------------------------------- builders */

interface Builder {
  pts: { x: number; y: number }[];
  nodes: Node[];
}

function push(
  b: Builder,
  pos: { x: number; y: number },
  owner: Faction,
  units: number,
  size: NodeSize,
  kind: NodeKind,
): void {
  b.pts.push(pos);
  // node.id === array index — startFlow and packets rely on this
  b.nodes.push({
    id: b.nodes.length,
    x: pos.x,
    y: pos.y,
    owner,
    units,
    size,
    kind,
    guard: 0,
    upgrading: 0,
    selected: false,
  });
}

/** Classic duel: point-mirror symmetry. Byte-identical to the historic path. */
function genMirror(rng: Rng, b: Builder, p: LevelParams, boosts: PlayerBoosts): void {
  const sampleLeft = () => ({
    x: MAP_MARGIN + rngNext(rng) * (WORLD_W * 0.4 - MAP_MARGIN),
    y: MAP_MARGIN + rngNext(rng) * (WORLD_H - 2 * MAP_MARGIN),
  });
  const playerPos = place(rng, b.pts, sampleLeft, MIN_SPACING);
  push(b, playerPos, PLAYER, p.playerStart + boosts.startUnits, 1, KIND_STANDARD);
  push(b, mirror(playerPos), 2, p.enemyStart, 1, KIND_STANDARD);

  const sampleHalf = () => ({
    x: MAP_MARGIN + rngNext(rng) * (WORLD_W / 2 - MIN_SPACING / 2 - MAP_MARGIN),
    y: MAP_MARGIN + rngNext(rng) * (WORLD_H - 2 * MAP_MARGIN),
  });
  const pairs = Math.floor((p.nodeCount - 2) / 2);
  for (let i = 0; i < pairs; i++) {
    const pos = place(rng, b.pts, sampleHalf, MIN_SPACING);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    const kind = rollKind(rng, p.level);
    push(b, pos, NEUTRAL, units, size, kind);
    push(b, mirror(pos), NEUTRAL, units, size, kind);
  }
  if ((p.nodeCount - 2) % 2 === 1) {
    const sampleCenter = () => {
      rngNext(rng); // historic draw order: x was sampled degenerately — keep the sequence
      return {
        x: WORLD_W / 2,
        y: MAP_MARGIN + rngNext(rng) * (WORLD_H - 2 * MAP_MARGIN),
      };
    };
    const pos = place(rng, b.pts, sampleCenter, MIN_SPACING);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    push(b, pos, NEUTRAL, units, rollSize(rng), rollKind(rng, p.level));
  }
}

/** 3-way: true 120° rotation inside the centered disc. */
function genTriad(rng: Rng, b: Builder, p: LevelParams, boosts: PlayerBoosts): void {
  // Player start in the lower wedge (toward the bottom of the disc).
  const sampleStart = () => {
    const a = Math.PI / 2 + (rngNext(rng) - 0.5) * 0.9; // around "down"
    const r = DISC_R * (0.55 + rngNext(rng) * 0.35);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const playerPos = place(rng, b.pts, sampleStart, MIN_SPACING_3WAY);
  push(b, playerPos, PLAYER, p.playerStart + boosts.startUnits, 1, KIND_STANDARD);
  push(b, rotate(playerPos, 1, 3), 2, p.enemyStart, 1, KIND_STANDARD);
  push(b, rotate(playerPos, 2, 3), 3, p.enemyStart, 1, KIND_STANDARD);

  const sampleDisc = () => {
    const a = rngNext(rng) * Math.PI * 2;
    const r = Math.sqrt(rngNext(rng)) * (DISC_R - 2);
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const orbits = Math.floor((p.nodeCount - 3) / 3);
  for (let i = 0; i < orbits; i++) {
    const pos = place(rng, b.pts, sampleDisc, MIN_SPACING_3WAY);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    const kind = rollKind(rng, p.level);
    for (let k = 0; k < 3; k++) push(b, rotate(pos, k, 3), NEUTRAL, units, size, kind);
  }
  // Contested center (fixed point of the rotation) — a natural fight magnet.
  if ((p.nodeCount - 3) % 3 !== 0) {
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    push(b, { x: CX, y: CY }, NEUTRAL, units, 1, p.level >= 9 ? KIND_FACTORY : KIND_STANDARD);
  }
}

/** 4-way: Klein four-group reflections — one start per quadrant. */
function genQuad(rng: Rng, b: Builder, p: LevelParams, boosts: PlayerBoosts): void {
  const images = (pos: { x: number; y: number }) => [
    pos,
    { x: WORLD_W - pos.x, y: pos.y },
    { x: pos.x, y: WORLD_H - pos.y },
    { x: WORLD_W - pos.x, y: WORLD_H - pos.y },
  ];
  const sampleQuadrant = () => ({
    x: MAP_MARGIN + rngNext(rng) * (WORLD_W / 2 - MIN_SPACING / 2 - MAP_MARGIN),
    y: MAP_MARGIN + rngNext(rng) * (WORLD_H / 2 - MIN_SPACING / 2 - MAP_MARGIN),
  });
  // Player bottom-left: sample in the top-left fundamental domain, then take
  // the vertical reflection as the player's start.
  const seed = place(rng, b.pts, sampleQuadrant, MIN_SPACING);
  const starts = images(seed);
  push(b, starts[2]!, PLAYER, p.playerStart + boosts.startUnits, 1, KIND_STANDARD); // bottom-left
  push(b, starts[3]!, 2, p.enemyStart, 1, KIND_STANDARD); // bottom-right
  push(b, starts[0]!, 3, p.enemyStart, 1, KIND_STANDARD); // top-left
  push(b, starts[1]!, 4, p.enemyStart, 1, KIND_STANDARD); // top-right

  const orbits = Math.floor((p.nodeCount - 4) / 4);
  for (let i = 0; i < orbits; i++) {
    const pos = place(rng, b.pts, sampleQuadrant, MIN_SPACING);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    const kind = rollKind(rng, p.level);
    for (const img of images(pos)) push(b, img, NEUTRAL, units, size, kind);
  }
  if ((p.nodeCount - 4) % 4 !== 0) {
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    push(b, { x: CX, y: CY }, NEUTRAL, units, 1, KIND_STANDARD);
  }
}

/* ---------------------------------------------------- teaching-level kinds */

/**
 * L4–L7 hand-place their special kinds after generation so each mechanic has
 * a designed debut (zero-text teaching). Symmetric twins share the kind so
 * fairness holds.
 */
function applyTeachingKinds(nodes: Node[], level: number): void {
  const player = nodes.find((n) => n.owner === PLAYER)!;
  const neutrals = nodes.filter((n) => n.owner === NEUTRAL);
  const byDist = (from: Node) =>
    [...neutrals].sort(
      (a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y),
    );
  const twinOf = (n: Node): Node | undefined =>
    neutrals.find(
      (m) =>
        m.id !== n.id &&
        Math.abs(m.x - (WORLD_W - n.x)) < 0.01 &&
        Math.abs(m.y - (WORLD_H - n.y)) < 0.01,
    );
  const setPair = (n: Node, mut: (m: Node) => void) => {
    mut(n);
    const t = twinOf(n);
    if (t) mut(t);
  };

  if (level === 4) {
    // Factory debut: nearest neutral to the player start becomes a factory —
    // grab it and FEEL the production difference.
    const near = byDist(player)[0];
    if (near) setPair(near, (m) => {
      m.kind = KIND_FACTORY;
      m.size = 1;
      m.units = 6;
    });
  } else if (level === 5) {
    // Fortress debut guarding the short lane + a cheap small node so the
    // upgrade nudge has its moment.
    const sorted = byDist(player);
    if (sorted[0]) setPair(sorted[0], (m) => {
      m.kind = KIND_FORTRESS;
      m.size = 1;
      m.units = 12;
    });
    if (sorted[1]) setPair(sorted[1], (m) => {
      m.size = 0;
      m.units = 4;
    });
  } else if (level === 7) {
    // Turret demo: the neutral nearest CRIMSON's start (faction 2), far from
    // the player, becomes a cheap turret — the player learns by watching it
    // shred AMBER's streams before ever facing one.
    const crimson = nodes.find((n) => n.owner === 2)!;
    const candidates = neutrals
      .filter((n) => Math.hypot(n.x - player.x, n.y - player.y) > 35)
      .sort(
        (a, b) =>
          Math.hypot(a.x - crimson.x, a.y - crimson.y) -
          Math.hypot(b.x - crimson.x, b.y - crimson.y),
      );
    const pick = candidates[0];
    if (pick) {
      // 3-way orbits: apply to the whole orbit (all nodes at the same radius
      // pattern) — find rotational twins by unit/size/kind match at same dist
      // from center; simplest deterministic approach: set only this node.
      // Fairness note: turret is neutral and dormant; asymmetry until captured
      // is acceptable for the teaching level.
      pick.kind = KIND_TURRET;
      pick.size = 0;
      pick.units = 3;
    }
  }
}

/* ------------------------------------------------------------ createLevel */

/**
 * Build the full starting state for a level.
 * @param boosts permanent meta-progression boosts (player only).
 */
export function createLevel(level: number, boosts: PlayerBoosts = DEFAULT_BOOSTS): GameState {
  const rng: Rng = { s: (Math.imul(level, 0x9e3779b1) ^ 0xc0ffee) | 0 };
  const p = levelParams(level);
  const b: Builder = { pts: [], nodes: [] };

  if (p.factionCount === 3) genTriad(rng, b, p, boosts);
  else if (p.factionCount === 4) genQuad(rng, b, p, boosts);
  else genMirror(rng, b, p, boosts);

  applyTeachingKinds(b.nodes, level);

  const personas = personasForLevel(level);
  const ais: FactionCfg[] = [];
  for (let i = 0; i < p.factionCount - 1; i++) {
    ais.push({
      faction: (2 + i) as Faction,
      persona: personas[i] ?? personas[0]!,
      firstMoveTick: p.aiFirstMoveTick + i * 17, // staggered wakes
    });
  }

  const cfg: LevelCfg = {
    level,
    aiFirstMoveTick: p.aiFirstMoveTick,
    aiIntervalTicks: p.aiIntervalTicks,
    aiMinUnits: p.aiMinUnits,
    aiOverkillMargin: p.aiOverkillMargin,
    aiTier: p.aiTier,
    aiKillCertainty: p.aiKillCertainty,
    aiSendFraction: p.aiSendFraction,
    aiNeutralBonus: p.aiNeutralBonus,
    aiKillPlayerBias: p.aiKillPlayerBias,
    factionCount: p.factionCount,
    ais,
    playerProdInterval: boosts.prodInterval,
    playerUpgradeCost: boosts.upgradeCost,
    playerUpgradeTicks: boosts.upgradeTicks,
  };

  const nextAiTick = [0, 0, 0, 0, 0];
  for (const fc of ais) nextAiTick[fc.faction] = fc.firstMoveTick;

  return {
    tick: 0,
    rng,
    status: "playing",
    cfg,
    nodes: b.nodes,
    flows: [],
    packets: [],
    nextAiTick,
    firstSendDone: false,
  };
}

/* -------------------------------------------------------------------- daily */

export const DAILY_MUTATORS = [
  "ALL FACTORIES",
  "FORTIFIED",
  "TURRET GRID",
  "RICH START",
  "SWARM",
] as const;

/**
 * Daily challenge: one 4-way full-cast board (L12-grade knobs) seeded by the
 * UTC date, plus one board-wide mutator. Same map worldwide, all day.
 */
export function createDailyLevel(
  seed: number,
  boosts: PlayerBoosts = DEFAULT_BOOSTS,
): { state: GameState; mutator: string } {
  const rng: Rng = { s: seed | 0 };
  const p = levelParams(12); // full-cast 4-way, tier-3 knobs
  const b: Builder = { pts: [], nodes: [] };
  const mutatorIdx = Math.floor(rngNext(rng) * DAILY_MUTATORS.length);

  genQuad(rng, b, p, boosts);

  switch (mutatorIdx) {
    case 0: // ALL FACTORIES
      for (const n of b.nodes) if (n.owner === NEUTRAL) n.kind = KIND_FACTORY;
      break;
    case 1: // FORTIFIED
      for (const n of b.nodes) if (n.owner === NEUTRAL) n.kind = KIND_FORTRESS;
      break;
    case 2: // TURRET GRID
      for (const n of b.nodes) if (n.owner === NEUTRAL && n.id % 2 === 0) n.kind = KIND_TURRET;
      break;
    case 3: // RICH START
      for (const n of b.nodes) if (n.owner !== NEUTRAL) n.units += 10;
      break;
    case 4: // SWARM
      for (const n of b.nodes) if (n.owner === NEUTRAL) n.units = Math.max(1, n.units >> 1);
      break;
  }

  const personas = [CRIMSON, AMBER, VIOLET];
  const ais: FactionCfg[] = personas.map((persona, i) => ({
    faction: (2 + i) as Faction,
    persona,
    firstMoveTick: p.aiFirstMoveTick + i * 17,
  }));

  const cfg: LevelCfg = {
    level: 12,
    aiFirstMoveTick: p.aiFirstMoveTick,
    aiIntervalTicks: p.aiIntervalTicks,
    aiMinUnits: p.aiMinUnits,
    aiOverkillMargin: p.aiOverkillMargin,
    aiTier: 3,
    aiKillCertainty: p.aiKillCertainty,
    aiSendFraction: p.aiSendFraction,
    aiNeutralBonus: p.aiNeutralBonus,
    aiKillPlayerBias: p.aiKillPlayerBias,
    factionCount: 4,
    ais,
    playerProdInterval: boosts.prodInterval,
    playerUpgradeCost: boosts.upgradeCost,
    playerUpgradeTicks: boosts.upgradeTicks,
  };

  const nextAiTick = [0, 0, 0, 0, 0];
  for (const fc of ais) nextAiTick[fc.faction] = fc.firstMoveTick;

  return {
    state: {
      tick: 0,
      rng,
      status: "playing",
      cfg,
      nodes: b.nodes,
      flows: [],
      packets: [],
      nextAiTick,
      firstSendDone: true, // no hint arrow on dailies
    },
    mutator: DAILY_MUTATORS[mutatorIdx]!,
  };
}
