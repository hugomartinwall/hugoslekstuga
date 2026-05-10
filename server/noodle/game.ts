// Server-authoritative simulation for Noodle.
//
// Each player controls a snake — a head plus a chain of body segments
// trailing along the head's recent path. The head is a circle that
// moves forward at HEAD_SPEED (or BOOST_SPEED while boosting). Body
// segments aren't simulated independently; they're sampled at uniform
// distance intervals along the head's trail of past positions.
//
// One tick per ~33 ms (TICK_HZ). All state lives here; the WebSocket
// layer feeds inputs in and pulls snapshots out.

import {
  BOOST_LENGTH_DRAIN_PER_SEC,
  BOOST_SPEED,
  DEATH_FOOD_RADIUS,
  FOOD_RADIUS,
  FOOD_TARGET,
  GROW_PER_DEATH_FOOD,
  GROW_PER_FOOD,
  HEAD_RADIUS,
  HEAD_SPEED,
  INITIAL_LENGTH,
  SEGMENT_GAP,
  SEGMENT_RADIUS,
  SPAWN_PROTECT_MS,
  TICK_HZ,
  TURN_RATE,
  WORLD_SIZE,
  type FoodView,
  type LeaderboardEntry,
  type SnakeView,
} from "../../lib/noodle/protocol.js";
import { SpatialGrid } from "../munch/spatial.js";

const PALETTE = [
  "#ff5a3c",
  "#4f66f2",
  "#ffc233",
  "#ff7ab2",
  "#2bb37c",
  "#9333ea",
  "#fb923c",
  "#14b8a6",
];

/** Minimum length — a snake can't drain itself below this via boost. */
const MIN_LENGTH = 4;

/** Cap on trail history kept per snake. Long enough to support a
 *  ~250-segment snake at boost speed; longer than the body needs. */
const MAX_TRAIL_LEN = 1200;

/** Per-bot AI state. Lives on the Snake so the bot tick loop reads
 *  and mutates without juggling parallel maps. Null on humans. */
export type BotState = {
  spawnedAtMs: number;
  diedAt: number;
  /** Personality: scales the bot's foraging sight radius. ~0.7-1.3. */
  sightFactor: number;
  /** Personality: per-bot decision interval (ms). ~150-280. */
  decisionMs: number;
  /** Personality: aim noise magnitude (rad). ~0-0.25 — wobbly heads. */
  jitterAmp: number;
  /** Throttles foraging re-evaluation. */
  lastDecisionAt: number;
  /** Cached current chase target (food id or coordinates). */
  targetX: number;
  targetY: number;
  hasTarget: boolean;
  /** Wander heading (radians) when nothing of interest is in range. */
  wanderAngle: number;
  /** True when actively hunting a smaller snake. Foraging is paused. */
  hunting: boolean;
  /** id of the prey snake while hunting. Empty string otherwise. */
  huntTargetId: string;
};

export type Snake = {
  id: string;
  name: string;
  color: string;
  alive: boolean;
  /** Head position. */
  head: { x: number; y: number };
  /** Heading angle in radians. atan2 convention: 0 = +x, π/2 = +y. */
  heading: number;
  /** Aim direction (unit vector). Server steers heading toward this. */
  aim: { x: number; y: number };
  /** Boost requested this tick. */
  boost: boolean;
  /** Total snake length in segments (including head). */
  length: number;
  /** Fractional length drain accumulator from boost. When ≥ 1, drop a
   *  segment and decrement by 1. */
  boostDrainAcc: number;
  /** Trail of recent head positions, head first (index 0 = current). */
  trail: { x: number; y: number }[];
  /** Epoch ms of spawn — for spawn protection. */
  spawnedAt: number;
  /** Last reported canvas aspect ratio. */
  aspect: number | null;
  /** Last input epoch ms — for AFK kick. */
  lastInputAt: number;
  /** Set on death. */
  killedBy: string | null;
  /** Length at death — final score. */
  finalLength: number;
  /** True for server-controlled bots. Server-only; identical on wire. */
  isBot: boolean;
  /** AI state for bots; null on humans. */
  bot: BotState | null;
};

export type Food = {
  id: number;
  x: number;
  y: number;
  color: string;
  /** Visual radius — small for normal, larger for death-drop. */
  r: number;
  /** True if dropped from a snake's death (worth more growth). */
  fromDeath: boolean;
};

export class Game {
  players = new Map<string, Snake>();
  food = new Map<number, Food>();
  /** Body-segment spatial grid built each tick during collision
   *  resolution. Re-used by the bot manager to query for nearby
   *  bodies when deciding whether to swerve. Stays valid until the
   *  next tick. */
  bodyGrid = new SpatialGrid<{
    id: number;
    x: number;
    y: number;
    ownerId: string;
  }>(WORLD_SIZE, 150);

  private nextFoodId = 1;

  constructor() {
    this.refillFood();
  }

  /* -------------------------- player ops -------------------------- */

  addPlayer(id: string, name: string, x?: number, y?: number): Snake {
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const headX = typeof x === "number" ? x : Math.random() * WORLD_SIZE;
    const headY = typeof y === "number" ? y : Math.random() * WORLD_SIZE;
    const heading = Math.random() * Math.PI * 2;
    const snake: Snake = {
      id,
      name,
      color,
      alive: true,
      head: { x: headX, y: headY },
      heading,
      aim: { x: Math.cos(heading), y: Math.sin(heading) },
      boost: false,
      length: INITIAL_LENGTH,
      boostDrainAcc: 0,
      trail: [{ x: headX, y: headY }],
      spawnedAt: Date.now(),
      aspect: null,
      lastInputAt: Date.now(),
      killedBy: null,
      finalLength: 0,
      isBot: false,
      bot: null,
    };
    this.players.set(id, snake);
    return snake;
  }

  /** Spawn a server-controlled bot. Same shape as a human snake plus
   *  the bot AI fields. The wire format is identical — clients can't
   *  tell humans from bots. */
  addBot(id: string, name: string, x?: number, y?: number): Snake {
    const snake = this.addPlayer(id, name, x, y);
    snake.isBot = true;
    snake.bot = {
      spawnedAtMs: Date.now(),
      diedAt: 0,
      sightFactor: 0.7 + Math.random() * 0.6,   // 0.7 - 1.3
      decisionMs: 150 + Math.random() * 130,    // 150 - 280
      jitterAmp: Math.random() * 0.15,          // 0 - 0.15
      lastDecisionAt: 0,
      targetX: 0,
      targetY: 0,
      hasTarget: false,
      wanderAngle: Math.random() * Math.PI * 2,
      hunting: false,
      huntTargetId: "",
    };
    return snake;
  }

  removePlayer(id: string): void {
    this.players.delete(id);
  }

  setInput(
    id: string,
    aim: { x: number; y: number },
    boost: boolean,
    aspect?: number,
  ): void {
    const s = this.players.get(id);
    if (!s) return;
    const len = Math.hypot(aim.x, aim.y);
    if (len > 0.001) {
      s.aim = { x: aim.x / len, y: aim.y / len };
    }
    s.boost = boost && s.alive && s.length > MIN_LENGTH;
    if (typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0) {
      s.aspect = Math.max(0.2, Math.min(5, aspect));
    }
    s.lastInputAt = Date.now();
  }

  respawn(id: string, x?: number, y?: number): void {
    const s = this.players.get(id);
    if (!s) return;
    const headX = typeof x === "number" ? x : Math.random() * WORLD_SIZE;
    const headY = typeof y === "number" ? y : Math.random() * WORLD_SIZE;
    const heading = Math.random() * Math.PI * 2;
    s.head = { x: headX, y: headY };
    s.heading = heading;
    s.aim = { x: Math.cos(heading), y: Math.sin(heading) };
    s.boost = false;
    s.length = INITIAL_LENGTH;
    s.boostDrainAcc = 0;
    s.trail = [{ x: headX, y: headY }];
    s.alive = true;
    s.spawnedAt = Date.now();
    s.killedBy = null;
    s.finalLength = 0;
  }

  /* -------------------------- main tick --------------------------- */

  tick(): void {
    const dt = 1 / TICK_HZ;
    const now = Date.now();

    // ---- 1. integrate motion ----
    for (const s of this.players.values()) {
      if (!s.alive) continue;

      // Steer heading toward aim, capped at TURN_RATE per second.
      const targetAngle = Math.atan2(s.aim.y, s.aim.x);
      let diff = targetAngle - s.heading;
      // Wrap diff into [-π, π].
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const maxTurn = TURN_RATE * dt;
      if (diff > maxTurn) diff = maxTurn;
      else if (diff < -maxTurn) diff = -maxTurn;
      s.heading += diff;

      // Move head forward.
      const speed = s.boost ? BOOST_SPEED : HEAD_SPEED;
      s.head.x += Math.cos(s.heading) * speed * dt;
      s.head.y += Math.sin(s.heading) * speed * dt;

      // Boost drains length over time. Drops the bit of length as a
      // small food pellet behind the snake — same as slither.io's
      // "boost cost feeds the world" loop.
      if (s.boost && s.length > MIN_LENGTH) {
        // Boost cancels spawn protection so it can't be exploited.
        s.spawnedAt = 0;
        s.boostDrainAcc += BOOST_LENGTH_DRAIN_PER_SEC * dt;
        while (s.boostDrainAcc >= 1 && s.length > MIN_LENGTH) {
          s.length -= 1;
          s.boostDrainAcc -= 1;
          // Drop a small food pellet at the current tail position.
          const tailIdx = Math.min(s.trail.length - 1, s.length * SEGMENT_GAP);
          const tail = s.trail[Math.max(0, Math.floor(tailIdx))] ?? s.head;
          this.spawnFoodAt(
            tail.x + (Math.random() - 0.5) * 4,
            tail.y + (Math.random() - 0.5) * 4,
            s.color,
            false,
          );
        }
      } else {
        s.boostDrainAcc = 0;
      }

      // Push new head position to the trail.
      s.trail.unshift({ x: s.head.x, y: s.head.y });
      if (s.trail.length > MAX_TRAIL_LEN) s.trail.length = MAX_TRAIL_LEN;

      // Wall — kill on contact (choice 1A: classic-slither).
      if (
        s.head.x < HEAD_RADIUS ||
        s.head.x > WORLD_SIZE - HEAD_RADIUS ||
        s.head.y < HEAD_RADIUS ||
        s.head.y > WORLD_SIZE - HEAD_RADIUS
      ) {
        this.killSnake(s, null);
      }
    }

    // ---- 2. resolve eats (head vs food) ----
    const foodGrid = new SpatialGrid<{ id: number; x: number; y: number; r: number }>(
      WORLD_SIZE,
      200,
    );
    foodGrid.clear();
    for (const f of this.food.values()) {
      foodGrid.insert({ id: f.id, x: f.x, y: f.y, r: f.r });
    }

    for (const s of this.players.values()) {
      if (!s.alive) continue;
      const reach = HEAD_RADIUS + DEATH_FOOD_RADIUS + 4;
      const nearby = foodGrid.nearby(s.head.x, s.head.y, reach);
      for (const cand of nearby) {
        const f = this.food.get(cand.id);
        if (!f) continue;
        const dx = f.x - s.head.x;
        const dy = f.y - s.head.y;
        const d2 = dx * dx + dy * dy;
        const r2 = (HEAD_RADIUS + f.r) * (HEAD_RADIUS + f.r);
        if (d2 < r2) {
          s.length += f.fromDeath ? GROW_PER_DEATH_FOOD : GROW_PER_FOOD;
          this.food.delete(f.id);
        }
      }
    }

    // ---- 3. resolve head-vs-body collisions ----
    //
    // Build a spatial grid of all body segments (skipping each snake's
    // own head and own segments — choice 3A: self-collision allowed).
    // Then for each alive snake's head, check nearby segments.
    // The grid stays exposed on `this.bodyGrid` so the bot manager
    // can query it for swerve decisions next tick.
    const bodyGrid = this.bodyGrid;
    bodyGrid.clear();
    let segIdCounter = 1;
    // Cache body computations so we don't recompute for collision +
    // snapshot.
    const bodyCache = new Map<string, { x: number; y: number }[]>();
    for (const s of this.players.values()) {
      if (!s.alive) continue;
      const body = computeBody(s);
      bodyCache.set(s.id, body);
      // Insert all segments (except the head, index 0) into the grid.
      for (let i = 1; i < body.length; i++) {
        bodyGrid.insert({
          id: segIdCounter++,
          x: body[i].x,
          y: body[i].y,
          ownerId: s.id,
        });
      }
    }

    type Kill = { victim: Snake; killer: Snake | null };
    const kills: Kill[] = [];
    for (const s of this.players.values()) {
      if (!s.alive) continue;
      if (isProtected(s, now)) continue;
      const reach = HEAD_RADIUS + SEGMENT_RADIUS + 4;
      const nearby = bodyGrid.nearby(s.head.x, s.head.y, reach);
      for (const seg of nearby) {
        if (seg.ownerId === s.id) continue; // self-collision allowed
        const owner = this.players.get(seg.ownerId);
        if (!owner) continue;
        if (isProtected(owner, now)) continue;
        const dx = seg.x - s.head.x;
        const dy = seg.y - s.head.y;
        const d2 = dx * dx + dy * dy;
        const r2 = (HEAD_RADIUS + SEGMENT_RADIUS) * (HEAD_RADIUS + SEGMENT_RADIUS);
        if (d2 < r2) {
          kills.push({ victim: s, killer: owner });
          break;
        }
      }
    }
    for (const k of kills) {
      // killSnake also drops the body as food, so it modifies the
      // bodyCache state — but we don't read it again this tick.
      const body = bodyCache.get(k.victim.id) ?? computeBody(k.victim);
      this.killSnake(k.victim, k.killer, body);
    }

    // ---- 4. refill food ----
    if (this.food.size < FOOD_TARGET) {
      const need = Math.min(20, FOOD_TARGET - this.food.size);
      for (let i = 0; i < need; i++) this.spawnFood();
    }
  }

  /* -------------------------- snapshots --------------------------- */

  snapshotFor(playerId: string, viewHx: number, viewHy: number): {
    you: {
      head: { x: number; y: number } | null;
      segments: { x: number; y: number }[];
      length: number;
      alive: boolean;
      boosting: boolean;
      protUntil: number;
    };
    snakes: SnakeView[];
    food: FoodView[];
    leaderboard: LeaderboardEntry[];
  } {
    const me = this.players.get(playerId);
    const now = Date.now();
    if (!me) {
      return {
        you: { head: null, segments: [], length: 0, alive: false, boosting: false, protUntil: 0 },
        snakes: [],
        food: [],
        leaderboard: this.leaderboard(),
      };
    }

    const cx = me.head.x;
    const cy = me.head.y;
    const cull = (px: number, py: number, pad: number) =>
      Math.abs(px - cx) > viewHx + pad || Math.abs(py - cy) > viewHy + pad;

    // Snakes: include any snake with at least one segment inside the
    // viewport (head or body). Bodies we send are clipped to visible
    // segments only — labels and shadows are drawn just outside view
    // at the edges.
    const snakes: SnakeView[] = [];
    for (const s of this.players.values()) {
      if (!s.alive) continue;
      if (s.id === playerId) continue;
      const body = computeBody(s);
      const visible: { x: number; y: number }[] = [];
      for (const seg of body) {
        if (!cull(seg.x, seg.y, 80)) visible.push(seg);
      }
      if (visible.length === 0) continue;
      snakes.push({
        id: s.id,
        name: s.name,
        color: s.color,
        segments: visible,
        totalLength: s.length,
        boosting: s.boost,
        prot: isProtected(s, now),
      });
    }

    const food: FoodView[] = [];
    for (const f of this.food.values()) {
      if (cull(f.x, f.y, 20)) continue;
      food.push({ id: f.id, x: f.x, y: f.y, color: f.color, r: f.r });
    }

    // Self body — full, no viewport cull. The player always sees
    // their own whole snake, which is what makes turning around a
    // long body legible.
    const myBody = me.alive ? computeBody(me) : [];

    return {
      you: {
        head: { x: me.head.x, y: me.head.y },
        segments: myBody,
        length: me.length,
        alive: me.alive,
        boosting: me.boost,
        protUntil: me.spawnedAt > 0 ? me.spawnedAt + SPAWN_PROTECT_MS : 0,
      },
      snakes,
      food,
      leaderboard: this.leaderboard(),
    };
  }

  leaderboard(): LeaderboardEntry[] {
    const out: LeaderboardEntry[] = [];
    for (const s of this.players.values()) {
      if (!s.alive) continue;
      out.push({ id: s.id, name: s.name, length: s.length });
    }
    return out.sort((a, b) => b.length - a.length).slice(0, 10);
  }

  /* -------------------------- helpers ----------------------------- */

  private killSnake(
    snake: Snake,
    killer: Snake | null,
    bodyOverride?: { x: number; y: number }[],
  ): void {
    if (!snake.alive) return;
    snake.alive = false;
    snake.killedBy = killer?.name ?? null;
    snake.finalLength = snake.length;
    // Drop the body as food. Spaced so we don't dump 100 pellets on
    // one spot and crush the food cap.
    const body = bodyOverride ?? computeBody(snake);
    const stride = 2; // every other segment becomes food
    for (let i = 0; i < body.length; i += stride) {
      this.spawnFoodAt(
        body[i].x + (Math.random() - 0.5) * 6,
        body[i].y + (Math.random() - 0.5) * 6,
        snake.color,
        true,
      );
    }
  }

  private spawnFood(): void {
    const id = this.nextFoodId++;
    this.food.set(id, {
      id,
      x: Math.random() * WORLD_SIZE,
      y: Math.random() * WORLD_SIZE,
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      r: FOOD_RADIUS,
      fromDeath: false,
    });
  }

  private spawnFoodAt(
    x: number,
    y: number,
    color: string,
    fromDeath: boolean,
  ): void {
    const id = this.nextFoodId++;
    this.food.set(id, {
      id,
      x: Math.max(0, Math.min(WORLD_SIZE, x)),
      y: Math.max(0, Math.min(WORLD_SIZE, y)),
      color,
      r: fromDeath ? DEATH_FOOD_RADIUS : FOOD_RADIUS,
      fromDeath,
    });
  }

  private refillFood(): void {
    while (this.food.size < FOOD_TARGET) this.spawnFood();
  }
}

/* ----- module helpers ----- */

/** Sample body segments at uniform-distance intervals along the snake's
 *  trail. Returns head-first (index 0 = head). */
function computeBody(snake: Snake): { x: number; y: number }[] {
  const trail = snake.trail;
  if (trail.length === 0) return [];
  const segments: { x: number; y: number }[] = [];
  // Head is segment 0.
  segments.push({ x: trail[0].x, y: trail[0].y });
  if (snake.length <= 1) return segments;

  let cumDist = 0;
  let trailIdx = 0;
  for (let k = 1; k < snake.length; k++) {
    const targetDist = k * SEGMENT_GAP;
    while (trailIdx + 1 < trail.length) {
      const a = trail[trailIdx];
      const b = trail[trailIdx + 1];
      const segLen = Math.hypot(a.x - b.x, a.y - b.y);
      if (cumDist + segLen >= targetDist) break;
      cumDist += segLen;
      trailIdx++;
    }
    if (trailIdx + 1 >= trail.length) {
      const last = trail[trail.length - 1];
      segments.push({ x: last.x, y: last.y });
      continue;
    }
    const a = trail[trailIdx];
    const b = trail[trailIdx + 1];
    const segLen = Math.hypot(a.x - b.x, a.y - b.y);
    const t = segLen > 0 ? (targetDist - cumDist) / segLen : 0;
    segments.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    });
  }
  return segments;
}

/** Spawn protection — true while the snake is freshly spawned and
 *  hasn't boosted yet. */
function isProtected(snake: Snake, now: number): boolean {
  return snake.spawnedAt > 0 && now - snake.spawnedAt < SPAWN_PROTECT_MS;
}

