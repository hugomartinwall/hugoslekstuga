import type { GameState, LevelCfg, Node, NodeSize, Owner, Rng } from "./state";
import { rngNext, WORLD_H, WORLD_W } from "./state";
import { MAP_MARGIN, MIN_SPACING } from "./constants";

/**
 * Procedural level generation. Same level number ⇒ same map, forever —
 * retrying a lost level replays the exact same board, which is learnable.
 * Fairness by construction: the enemy's start and every neutral are point
 * mirrors of player-side placements through the board center.
 */

interface LevelParams extends LevelCfg {
  nodeCount: number;
  neutralLo: number;
  neutralHi: number;
  playerStart: number;
  enemyStart: number;
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
  const base: LevelParams = {
    level: L,
    nodeCount: Math.min(21, 7 + 2 * Math.floor((L - 1) / 2)),
    neutralLo: Math.min(15, 4 + L),
    neutralHi: Math.min(30, 8 + 2 * L),
    playerStart: 10,
    // Capped: with a competent AI, raw start-material asymmetry stops being
    // "difficulty" and becomes an unwinnable opening rush. Skill knobs below
    // carry the curve instead.
    enemyStart: Math.min(14, 10 + L),
    aiFirstMoveTick: Math.max(45, 210 - 30 * L),
    aiIntervalTicks: Math.max(45, 195 - 12 * L),
    aiMinUnits: Math.max(6, 16 - L),
    aiOverkillMargin: Math.max(2, Math.round(10 - 0.8 * L)),
    aiTier: L <= 3 ? 1 : L <= 7 ? 2 : L <= 12 ? 3 : 4,
    aiKillCertainty: L <= 3 ? 3.0 : Math.max(1.25, 3.0 - 0.2 * (L - 3)),
    aiSendFraction: Math.min(0.85, 0.65 + 0.015 * Math.max(0, L - 3)),
    aiNeutralBonus: Math.max(6, 25 - 2 * Math.max(0, L - 3)),
  };
  return { ...base, ...tuned[L] };
}

function mirror(p: { x: number; y: number }): { x: number; y: number } {
  return { x: WORLD_W - p.x, y: WORLD_H - p.y };
}

/** Rejection-sample a point at least `spacing` from all placed nodes. */
function place(
  rng: Rng,
  placed: readonly { x: number; y: number }[],
  xMin: number,
  xMax: number,
): { x: number; y: number } {
  let spacing = MIN_SPACING;
  for (;;) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const p = {
        x: xMin + rngNext(rng) * (xMax - xMin),
        y: MAP_MARGIN + rngNext(rng) * (WORLD_H - 2 * MAP_MARGIN),
      };
      if (placed.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= spacing)) return p;
    }
    spacing -= 2; // relax and retry — guaranteed termination, still deterministic
  }
}

function rollSize(rng: Rng): NodeSize {
  const r = rngNext(rng);
  return r < 0.5 ? 0 : r < 0.85 ? 1 : 2;
}

/**
 * Build the full starting state for a level.
 * @param bonusUnits future rewarded-ad seam: extra starting units for the player.
 */
export function createLevel(level: number, bonusUnits = 0): GameState {
  const rng: Rng = { s: (Math.imul(level, 0x9e3779b1) ^ 0xc0ffee) | 0 };
  const p = levelParams(level);

  const pts: { x: number; y: number }[] = [];
  const nodes: Node[] = [];
  const push = (pos: { x: number; y: number }, owner: Owner, units: number, size: NodeSize) => {
    pts.push(pos);
    // node.id === array index — startFlow and packets rely on this
    nodes.push({ id: nodes.length, x: pos.x, y: pos.y, owner, units, size, selected: false });
  };

  // Starts: player in the left 40%, enemy mirrored. Both medium.
  const playerPos = place(rng, pts, MAP_MARGIN, WORLD_W * 0.4);
  push(playerPos, "player", p.playerStart + bonusUnits, 1);
  push(mirror(playerPos), "enemy", p.enemyStart, 1);

  // Neutrals: mirrored pairs sharing size and defenders (symmetric value).
  const pairs = Math.floor((p.nodeCount - 2) / 2);
  for (let i = 0; i < pairs; i++) {
    const pos = place(rng, pts, MAP_MARGIN, WORLD_W / 2 - MIN_SPACING / 2);
    const size = rollSize(rng);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    push(pos, "neutral", units, size);
    push(mirror(pos), "neutral", units, size);
  }
  // Odd node count: one contested node on the center column.
  if ((p.nodeCount - 2) % 2 === 1) {
    const pos = place(rng, pts, WORLD_W / 2, WORLD_W / 2);
    const units = p.neutralLo + Math.floor(rngNext(rng) * (p.neutralHi - p.neutralLo + 1));
    push(pos, "neutral", units, rollSize(rng));
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
  };

  return {
    tick: 0,
    rng,
    status: "playing",
    cfg,
    nodes,
    flows: [],
    packets: [],
    nextAiTick: p.aiFirstMoveTick,
    firstSendDone: false,
  };
}
