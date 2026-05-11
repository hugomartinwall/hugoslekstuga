// Server-side AI for Noodle bots.
//
// Bots fill the room when humans are sparse so the world never feels
// dead. Same model as Munch's BotManager: floor of BOT_FLOOR total
// players, evict-oldest-on-human-join, MAX_PLAYERS hard cap, ?nobots
// flag to pause.
//
// Snake AI per decision tick:
//   0. Hunt — if a smaller snake is within HUNT_RANGE and we're bigger
//      by EAT_RATIO, aim at the prey's predicted future head position;
//      boost when within BOOST_CHASE_RANGE.
//   1. Wall avoid — if heading toward a wall within projected reach,
//      override aim toward the centre. Cancels any boost in progress.
//   2. Body avoid — query the game's body-segment grid for segments
//      ahead of the head; if any are within swerve range, point
//      perpendicular away from the closest one. Also cancels boost.
//   3. Forage — head toward the nearest food in personal sight radius.
//   4. Wander — drift along a slowly-changing heading.

import {
  BOOST_SPEED,
  BOT_FLOOR,
  HEAD_RADIUS,
  HEAD_SPEED,
  MAX_PLAYERS,
  SEGMENT_RADIUS,
  SPAWN_PROTECT_MS,
  WORLD_SIZE,
} from "../../lib/noodle/protocol.js";
import type { Game, Snake } from "./game.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** Foraging sight — how far a bot looks for food. Multiplied by the
 *  bot's personal sightFactor. */
const FOOD_SIGHT = 320;

/** How far the bot projects its head forward to test for wall hits.
 *  Widened with the world to give bots time to commit to a turn
 *  before hitting the boundary at boost speed. */
const WALL_LOOKAHEAD = 280;

/** How far the bot projects to test for body collisions. Slightly
 *  shorter than the wall lookahead since dense bodies need finer
 *  granularity, not longer reach. */
const BODY_LOOKAHEAD = 160;

/** Distance from the projected ray within which a body segment
 *  triggers swerve. Roughly head + segment radii + buffer. */
const BODY_AVOID_RADIUS = HEAD_RADIUS + SEGMENT_RADIUS + 12;

/** Margin from the world edge inside which the bot starts steering
 *  away. Bigger than WALL_LOOKAHEAD so the bot has room to commit
 *  before the wall hits. */
const WALL_MARGIN = 350;

/** Hunting reach — how far a bot will look for a smaller snake to
 *  chase. ~10% of world width feels lethal-but-not-omniscient. */
const HUNT_RANGE = 600;

/** Bot's predicted aim-ahead time for prey. Dialled back from 1.5 s
 *  so bots don't intercept on a perfect curve every time — they
 *  miss now and then, which is what makes them catchable. */
const HUNT_PREDICT_S = 1.0;

/** Hunter must be at least this many times the prey's length to
 *  consider chasing. Discourages bots from spinning forever after
 *  prey they can barely catch. Also doubles as the threshold for
 *  fleeing — a predator must be EAT_RATIO× bigger than us. */
const EAT_RATIO = 1.3;

/** When actively hunting and within this range of the prey's head,
 *  the bot boosts to close the gap. Same threshold reused for fleeing
 *  so both sides of a chase commit at roughly the same distance. */
const BOOST_CHASE_RANGE = 220;

/** A bot detects predators (bigger snakes) within this range and
 *  starts heading away. Shorter than HUNT_RANGE so the hunter sees
 *  prey before the prey sees the hunter — chases have a moment of
 *  initiative before the prey reacts. */
const FLEE_RANGE = 500;

/** Bot waits this long after death before respawning. */
const RESPAWN_COOLDOWN_MS = 4000;

/** Throttles bot spawning so an empty room ramps in over a couple of
 *  seconds rather than 8 bots popping in simultaneously. */
const SPAWN_RATE_MS = 250;

/** Wander-heading drift per tick (radians). Small noise applied on
 *  top of the destination-aim so the path isn't a perfect straight
 *  line. */
const WANDER_NOISE = 0.05;

/** How long (ms) a bot commits to a wander destination before
 *  picking a new one — even if it hasn't reached the old one. */
const WANDER_HOLD_MIN_MS = 7000;
const WANDER_HOLD_MAX_MS = 14000;

/** A wander destination is considered "reached" within this radius. */
const WANDER_REACHED_RADIUS = 160;

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
          p.bot.hunting = false;
          p.bot.huntTargetId = "";
          p.bot.fleeing = false;
          p.bot.fleeFromId = "";
          p.bot.hasWanderTarget = false;
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

  /** Per-tick AI for one bot. Sets snake.aim and snake.boost. */
  private runAI(p: Snake, now: number): void {
    const bot = p.bot!;

    // Throttle high-level decisions per personality. Decide() picks
    // fleeing target > hunting target > food target > neither.
    if (now - bot.lastDecisionAt > bot.decisionMs) {
      bot.lastDecisionAt = now;
      this.decide(p);
    }

    // ---- compute base aim from current mode (flee > hunt > food > wander) ----
    let aimX = 0;
    let aimY = 0;
    let wantBoost = false;

    if (bot.fleeing && bot.fleeFromId !== "") {
      const predator = this.game.players.get(bot.fleeFromId);
      if (predator && predator.alive) {
        // Aim directly away from the predator's current head.
        aimX = p.head.x - predator.head.x;
        aimY = p.head.y - predator.head.y;
        // Boost-flee at the same range threshold as boost-chase so
        // both sides of a hunt commit at the same distance.
        const dx = predator.head.x - p.head.x;
        const dy = predator.head.y - p.head.y;
        if (dx * dx + dy * dy < BOOST_CHASE_RANGE * BOOST_CHASE_RANGE) {
          wantBoost = true;
        }
      } else {
        bot.fleeing = false;
        bot.fleeFromId = "";
      }
    } else if (bot.hunting && bot.huntTargetId !== "") {
      const prey = this.game.players.get(bot.huntTargetId);
      if (prey && prey.alive) {
        // Predict where the prey will be HUNT_PREDICT_S seconds from
        // now if it stays on its current heading. Bot aims there so
        // its curve intercepts rather than tail-chases.
        const preySpeed = prey.boost ? BOOST_SPEED : HEAD_SPEED;
        const px = prey.head.x + Math.cos(prey.heading) * preySpeed * HUNT_PREDICT_S;
        const py = prey.head.y + Math.sin(prey.heading) * preySpeed * HUNT_PREDICT_S;
        aimX = px - p.head.x;
        aimY = py - p.head.y;
        const dx = prey.head.x - p.head.x;
        const dy = prey.head.y - p.head.y;
        if (dx * dx + dy * dy < BOOST_CHASE_RANGE * BOOST_CHASE_RANGE) {
          wantBoost = true;
        }
      } else {
        bot.hunting = false;
        bot.huntTargetId = "";
      }
    }

    if (!bot.fleeing && !bot.hunting) {
      if (bot.hasTarget) {
        aimX = bot.targetX - p.head.x;
        aimY = bot.targetY - p.head.y;
      } else {
        // Purposeful wander — pick a random destination far away and
        // commit to it for several seconds. When reached or expired,
        // pick another. Reads as "this bot is going somewhere"
        // instead of "this bot is spinning in place".
        if (
          !bot.hasWanderTarget ||
          now > bot.wanderUntil
        ) {
          this.pickWanderTarget(bot, now);
        } else {
          const dx = bot.wanderTargetX - p.head.x;
          const dy = bot.wanderTargetY - p.head.y;
          if (
            dx * dx + dy * dy < WANDER_REACHED_RADIUS * WANDER_REACHED_RADIUS
          ) {
            this.pickWanderTarget(bot, now);
          }
        }
        aimX = bot.wanderTargetX - p.head.x;
        aimY = bot.wanderTargetY - p.head.y;
        // Small noise drift so the path isn't a laser-perfect straight
        // line — keeps motion looking organic.
        bot.wanderAngle += (Math.random() - 0.5) * WANDER_NOISE;
        const noise = bot.wanderAngle;
        const cosN = Math.cos(noise * 0.1);
        const sinN = Math.sin(noise * 0.1);
        const rx = aimX * cosN - aimY * sinN;
        const ry = aimX * sinN + aimY * cosN;
        aimX = rx;
        aimY = ry;
      }
    }

    // -------- safety overrides (run every tick, not throttled) --------

    // Wall avoidance — if the projected head would clip a wall, steer
    // inward. Strong override; happens BEFORE body avoid since walls
    // are instant kill. Also cancels boost so the bot doesn't launch
    // itself into a wall during a hunt.
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
      wantBoost = false;
    }

    // Body avoidance — sample points along the head's projected path
    // and look for nearby body segments. If found, swerve perpendicular
    // and abort any chase boost — colliding with a body kills.
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
      wantBoost = false;
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
    p.boost = wantBoost;
    p.lastInputAt = now; // keep AFK kick happy
  }

  /** Re-evaluate behaviour. Flee wins over hunt wins over forage. */
  private decide(p: Snake): void {
    const bot = p.bot!;
    const now = Date.now();

    // 1. Flee — find the nearest bigger snake within FLEE_RANGE.
    let predatorId = "";
    let predatorDist2 = Infinity;
    const fleeRange2 = FLEE_RANGE * FLEE_RANGE;
    for (const other of this.game.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      // Bigger by EAT_RATIO → a real threat.
      if (other.length < p.length * EAT_RATIO) continue;
      const dx = other.head.x - p.head.x;
      const dy = other.head.y - p.head.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > fleeRange2) continue;
      if (d2 < predatorDist2) {
        predatorId = other.id;
        predatorDist2 = d2;
      }
    }
    if (predatorId !== "") {
      bot.fleeing = true;
      bot.fleeFromId = predatorId;
      bot.hunting = false;
      bot.huntTargetId = "";
      bot.hasTarget = false;
      return;
    }
    bot.fleeing = false;
    bot.fleeFromId = "";

    // 2. Hunt — find the nearest smaller snake within HUNT_RANGE.
    let preyId = "";
    let preyDist2 = Infinity;
    const huntRange2 = HUNT_RANGE * HUNT_RANGE;
    for (const other of this.game.players.values()) {
      if (other.id === p.id || !other.alive) continue;
      if (other.spawnedAt > 0 && now - other.spawnedAt < SPAWN_PROTECT_MS) continue;
      if (p.length < other.length * EAT_RATIO) continue;
      const dx = other.head.x - p.head.x;
      const dy = other.head.y - p.head.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > huntRange2) continue;
      if (d2 < preyDist2) {
        preyId = other.id;
        preyDist2 = d2;
      }
    }
    if (preyId !== "") {
      bot.hunting = true;
      bot.huntTargetId = preyId;
      bot.hasTarget = false;
      return;
    }
    bot.hunting = false;
    bot.huntTargetId = "";

    // 3. Foraging — nearest food in personal sight radius.
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

  /** Pick a new wander destination, far from walls and far from the
   *  bot's current position so the journey is meaningful. Held for
   *  WANDER_HOLD_MIN_MS..WANDER_HOLD_MAX_MS. */
  private pickWanderTarget(bot: Snake["bot"], now: number): void {
    if (!bot) return;
    const margin = WALL_MARGIN + 80;
    bot.wanderTargetX = margin + Math.random() * (WORLD_SIZE - margin * 2);
    bot.wanderTargetY = margin + Math.random() * (WORLD_SIZE - margin * 2);
    bot.wanderUntil =
      now + WANDER_HOLD_MIN_MS + Math.random() * (WANDER_HOLD_MAX_MS - WANDER_HOLD_MIN_MS);
    bot.hasWanderTarget = true;
  }
}
