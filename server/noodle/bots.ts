// Server-side AI for Noodle bots.
//
// Bots fill the room when humans are sparse so the world never feels
// dead. Same model as Munch's BotManager: floor of BOT_FLOOR total
// players, evict-oldest-on-human-join, MAX_PLAYERS hard cap, ?nobots
// flag to pause.
//
// Snake AI per decision tick:
//   1. Wall avoid — if heading toward a wall within projected reach,
//      override aim toward the centre.
//   2. Body avoid — query the game's body-segment grid for segments
//      ahead of the head; if any are within swerve range, point
//      perpendicular away from the closest one.
//   3. Forage — head toward the nearest food in personal sight radius.
//   4. Wander — drift along a slowly-changing heading.
//
// Bots never boost in this version — boost adds complexity (length
// drain, food-trail) that's better tuned in v2.

import {
  BOT_FLOOR,
  HEAD_RADIUS,
  MAX_PLAYERS,
  SEGMENT_RADIUS,
  WORLD_SIZE,
} from "../../lib/noodle/protocol.js";
import type { Game, Snake } from "./game.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** Foraging sight — how far a bot looks for food. Multiplied by the
 *  bot's personal sightFactor. */
const FOOD_SIGHT = 320;

/** How far the bot projects its head forward to test for wall hits. */
const WALL_LOOKAHEAD = 200;

/** How far the bot projects to test for body collisions. Slightly
 *  shorter than the wall lookahead since dense bodies need finer
 *  granularity, not longer reach. */
const BODY_LOOKAHEAD = 140;

/** Distance from the projected ray within which a body segment
 *  triggers swerve. Roughly head + segment radii + buffer. */
const BODY_AVOID_RADIUS = HEAD_RADIUS + SEGMENT_RADIUS + 12;

/** Margin from the world edge inside which the bot starts steering
 *  away. Bigger than WALL_LOOKAHEAD so the bot has room to commit
 *  before the wall hits. */
const WALL_MARGIN = 250;

/** Bot waits this long after death before respawning. */
const RESPAWN_COOLDOWN_MS = 4000;

/** Throttles bot spawning so an empty room ramps in over a couple of
 *  seconds rather than 8 bots popping in simultaneously. */
const SPAWN_RATE_MS = 250;

/** Wander-heading drift per tick (radians). Subtle — the bot's path
 *  curves rather than veering. */
const WANDER_NOISE = 0.05;

/* ------------------------------------------------------------------ */
/* Pasta-themed bot names                                              */
/* ------------------------------------------------------------------ */

const BOT_NAMES: string[] = [
  "spaghetti",
  "fettuccine",
  "linguine",
  "fusilli",
  "penne",
  "rigatoni",
  "farfalle",
  "orecchiette",
  "ravioli",
  "gnocchi",
  "lasagna",
  "conchiglie",
  "capellini",
  "tagliatelle",
  "pappardelle",
  "tortellini",
  "vermicelli",
  "rotini",
  "ziti",
  "orzo",
  "bucatini",
  "paccheri",
  "gemelli",
  "mafalda",
  "casarecce",
  "radiatori",
  "anelli",
  "ditali",
  "manicotti",
  "cavatappi",
];

/* ------------------------------------------------------------------ */
/* BotManager                                                           */
/* ------------------------------------------------------------------ */

export class BotManager {
  private game: Game;
  private nameQueue: string[] = [];
  private nextBotId = 1;
  private lastSpawnAt = 0;
  /** Set of human player ids that joined with the nobots flag. */
  private nobotsClients = new Set<string>();

  constructor(game: Game) {
    this.game = game;
    this.refillNames();
  }

  /* -------------------- public surface ------------------------- */

  setNobots(playerId: string, on: boolean): void {
    if (on) this.nobotsClients.add(playerId);
    else this.nobotsClients.delete(playerId);
  }

  /** Per-tick: maintain population floor + run AI for every bot.
   *  Run AFTER game.tick() so the body grid is current. The aim set
   *  here is consumed by next tick's game.tick(). */
  tick(): void {
    const now = Date.now();

    // 1. Note newly-dead bots so the respawn cooldown clock starts.
    for (const p of this.game.players.values()) {
      if (!p.isBot || !p.bot) continue;
      if (!p.alive && p.bot.diedAt === 0) p.bot.diedAt = now;
    }

    // 2. Population steering.
    const target = this.botFloorActive() ? Math.max(0, BOT_FLOOR - this.humanCount()) : 0;
    const have = this.botCount();
    if (have < target) {
      if (this.game.players.size < MAX_PLAYERS && now - this.lastSpawnAt > SPAWN_RATE_MS) {
        this.spawnBot();
        this.lastSpawnAt = now;
      }
    } else if (have > target) {
      this.evictOldest();
    }

    // 3. Run AI on each living bot; respawn any whose cooldown elapsed.
    for (const p of this.game.players.values()) {
      if (!p.isBot || !p.bot) continue;
      if (!p.alive) {
        if (p.bot.diedAt > 0 && now - p.bot.diedAt >= RESPAWN_COOLDOWN_MS) {
          this.game.respawn(p.id);
          p.bot.diedAt = 0;
          p.bot.lastDecisionAt = 0;
          p.bot.hasTarget = false;
          p.bot.spawnedAtMs = Date.now();
          p.bot.wanderAngle = Math.random() * Math.PI * 2;
        }
        continue;
      }
      this.runAI(p, now);
    }
  }

  /* -------------------- internals ------------------------------ */

  private botFloorActive(): boolean {
    return this.nobotsClients.size === 0;
  }

  private humanCount(): number {
    let n = 0;
    for (const p of this.game.players.values()) if (!p.isBot) n++;
    return n;
  }

  private botCount(): number {
    let n = 0;
    for (const p of this.game.players.values()) if (p.isBot) n++;
    return n;
  }

  private refillNames(): void {
    const arr = [...BOT_NAMES];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.nameQueue = arr;
  }

  private nextName(): string {
    if (this.nameQueue.length === 0) this.refillNames();
    return this.nameQueue.shift()!;
  }

  private spawnBot(): void {
    const id = `bot-${this.nextBotId++}`;
    const name = this.nextName();
    // Random start position, away from walls.
    const margin = WALL_MARGIN + 50;
    const x = margin + Math.random() * (WORLD_SIZE - margin * 2);
    const y = margin + Math.random() * (WORLD_SIZE - margin * 2);
    this.game.addBot(id, name, x, y);
  }

  /** Pick the oldest bot — same eviction rule as Munch. */
  private evictOldest(): void {
    let pick: Snake | null = null;
    for (const p of this.game.players.values()) {
      if (!p.isBot || !p.bot) continue;
      if (!pick) {
        pick = p;
        continue;
      }
      if (p.bot.spawnedAtMs < pick.bot!.spawnedAtMs) pick = p;
    }
    if (pick) this.game.removePlayer(pick.id);
  }

  /** Per-tick AI for one bot. Sets snake.aim (and never boosts). */
  private runAI(p: Snake, now: number): void {
    const bot = p.bot!;

    // Throttle decisions per personality.
    if (now - bot.lastDecisionAt > bot.decisionMs) {
      bot.lastDecisionAt = now;
      this.decide(p);
    }

    // Compute the aim each tick (decision picks the target; aim is
    // updated every tick so the heading stays current as the head moves).
    let aimX = 0;
    let aimY = 0;
    if (bot.hasTarget) {
      aimX = bot.targetX - p.head.x;
      aimY = bot.targetY - p.head.y;
    } else {
      // Wander: slowly drift the heading.
      bot.wanderAngle += (Math.random() - 0.5) * WANDER_NOISE;
      aimX = Math.cos(bot.wanderAngle);
      aimY = Math.sin(bot.wanderAngle);
    }

    // -------- safety overrides (run every tick, not throttled) --------

    // Wall avoidance — if the projected head would clip a wall, steer
    // inward. Strong override; happens BEFORE body avoid since walls
    // are instant kill, body collisions only trigger close-up.
    const lx = p.head.x + Math.cos(p.heading) * WALL_LOOKAHEAD;
    const ly = p.head.y + Math.sin(p.heading) * WALL_LOOKAHEAD;
    if (
      lx < WALL_MARGIN ||
      lx > WORLD_SIZE - WALL_MARGIN ||
      ly < WALL_MARGIN ||
      ly > WORLD_SIZE - WALL_MARGIN
    ) {
      // Aim toward centre, blend with current aim so the turn isn't
      // dead-eyed straight at the middle every time.
      const cx = WORLD_SIZE / 2;
      const cy = WORLD_SIZE / 2;
      const wallAimX = cx - p.head.x;
      const wallAimY = cy - p.head.y;
      aimX = wallAimX * 0.8 + aimX * 0.2;
      aimY = wallAimY * 0.8 + aimY * 0.2;
    }

    // Body avoidance — sample points along the head's projected path
    // and look for nearby body segments. If found, swerve perpendicular.
    const grid = this.game.bodyGrid;
    const stepCount = 4;
    const stepDist = BODY_LOOKAHEAD / stepCount;
    let avoidX = 0;
    let avoidY = 0;
    let hasAvoid = false;
    for (let i = 1; i <= stepCount; i++) {
      const sx = p.head.x + Math.cos(p.heading) * i * stepDist;
      const sy = p.head.y + Math.sin(p.heading) * i * stepDist;
      const nearby = grid.nearby(sx, sy, BODY_AVOID_RADIUS);
      for (const seg of nearby) {
        if (seg.ownerId === p.id) continue;
        const dx = seg.x - sx;
        const dy = seg.y - sy;
        const d2 = dx * dx + dy * dy;
        if (d2 > BODY_AVOID_RADIUS * BODY_AVOID_RADIUS) continue;
        // Perpendicular to current heading; pick whichever direction
        // points away from the segment.
        const px = -Math.sin(p.heading);
        const py = Math.cos(p.heading);
        const offX = seg.x - p.head.x;
        const offY = seg.y - p.head.y;
        const dot = px * offX + py * offY;
        const sign = dot > 0 ? -1 : 1;
        avoidX += px * sign;
        avoidY += py * sign;
        hasAvoid = true;
      }
      if (hasAvoid) break; // first hit is enough, more is just noise
    }
    if (hasAvoid) {
      // Strong override — swerve dominates while the body is near.
      aimX = avoidX * 0.7 + aimX * 0.3;
      aimY = avoidY * 0.7 + aimY * 0.3;
    }

    // -------- jitter --------
    if (bot.jitterAmp > 0) {
      const jitter = (Math.random() - 0.5) * bot.jitterAmp;
      const cosJ = Math.cos(jitter);
      const sinJ = Math.sin(jitter);
      const rx = aimX * cosJ - aimY * sinJ;
      const ry = aimX * sinJ + aimY * cosJ;
      aimX = rx;
      aimY = ry;
    }

    // Normalise + push to the snake.
    const len = Math.hypot(aimX, aimY);
    if (len > 0.001) {
      p.aim = { x: aimX / len, y: aimY / len };
    }
    p.lastInputAt = now; // keep AFK kick happy
  }

  /** Re-evaluate foraging target. Cheap; called every bot.decisionMs. */
  private decide(p: Snake): void {
    const bot = p.bot!;
    const sight = FOOD_SIGHT * bot.sightFactor;
    const sight2 = sight * sight;
    let bestX = 0;
    let bestY = 0;
    let bestDist2 = Infinity;
    for (const f of this.game.food.values()) {
      const dx = f.x - p.head.x;
      const dy = f.y - p.head.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > sight2) continue;
      if (d2 < bestDist2) {
        bestX = f.x;
        bestY = f.y;
        bestDist2 = d2;
      }
    }
    if (bestDist2 < Infinity) {
      bot.targetX = bestX;
      bot.targetY = bestY;
      bot.hasTarget = true;
    } else {
      bot.hasTarget = false;
    }
  }
}
