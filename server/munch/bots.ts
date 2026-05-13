// Server-side AI for Munch bots.
//
// Bots fill the room when humans are sparse so the world never feels
// dead. They look identical to humans on the wire — same Player struct,
// same snapshot path, same colours, just driven by this AI loop instead
// of a WebSocket. Names come from a curated friendly list (mushrooms).
//
// Population rule:
//   - Maintain a floor of BOT_FLOOR total players.
//     bots = max(0, BOT_FLOOR - humans).
//   - Each tick the manager nudges botCount toward that target: spawning
//     one bot per SPAWN_RATE_MS when below; evicting the oldest bot
//     immediately when above (a human just took its slot).
//   - Hard cap: MAX_PLAYERS total. Spawns refused beyond it.
//   - The ?nobots URL flag pauses the floor for the duration of that
//     human's session — useful for solo testing.
//
// AI per bot per decision tick:
//   1. Flee — any other player within sight whose mass could eat us.
//   2. Chase — closest smaller player within sight; occasionally
//      split-fire when a projected half-mass would still eat them.
//   3. Food — nearest pellet within sight.
//   4. Wander — drift along a heading with mild noise.

import {
  BOT_FLOOR,
  EAT_RATIO,
  MAX_PLAYERS,
  SPLIT_EJECT_SPEED,
  SPLIT_PULL_DELAY_MS,
  START_MASS,
  WORLD_SIZE,
} from "../../lib/munch/protocol.js";
import type { Game, Player } from "./game.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** Threshold for "the room has enough humans" — at or above this many
 *  human players, the bot floor collapses to BUSY_BOT_FLOOR. Bots
 *  exist to fill empty rooms; once humans show up the bots can step
 *  back. Per the lag stabilisation plan. */
const BUSY_HUMAN_COUNT = 3;

/** Bot count when the room is busy. Two bots keep the world feeling
 *  inhabited without costing per-tick CPU that 9-10 grown bots do. */
const BUSY_BOT_FLOOR = 2;

/** Base sight radius at START_MASS. Scales up with mass^0.35 (matching
 *  the per-player viewport scale in the protocol) so a mass-400 bot
 *  sees ~2000 units instead of always-700 — bigger blobs see further,
 *  same as humans. Without this, late-game bots would ignore prey just
 *  outside their viewport while humans see them perfectly fine. */
const SIGHT_RADIUS_BASE = 700;
const SIGHT_MASS_EXPONENT = 0.35;

/** Probability per decision tick that a bot fires a split when a viable
 *  chase target is within projected eject range. Roughly once per second
 *  when a target persists. */
const SPLIT_FIRE_PROBABILITY = 0.25;

/** Bot waits this long after death before respawning. */
const RESPAWN_COOLDOWN_MS = 5000;

/** Throttles bot spawning so an empty room ramps in over a couple of
 *  seconds rather than 10 bots popping in simultaneously. */
const SPAWN_RATE_MS = 200;

/** Max wander-angle drift per tick (radians). Keeps motion alive without
 *  looking jittery. */
const WANDER_NOISE = 0.08;

/** Probability that a bot picks a *random* in-sight prey instead of the
 *  closest one. Adds unpredictability so a player can't reliably bait
 *  the same bot the same way twice. */
const RANDOM_PREY_PROBABILITY = 0.3;

/** Margin from the world edge where bots start to feel the wall.
 *  Inside this distance, the wall-ward component of their input
 *  direction is dampened so they don't run head-first into a wall.
 *  Without this, a player can herd bots into corners and trap them. */
const WALL_AVOID_MARGIN = 500;

/* ------------------------------------------------------------------ */
/* Friendly bot names — mushrooms                                       */
/* ------------------------------------------------------------------ */

const BOT_NAMES: string[] = [
  "chanterelle",
  "morel",
  "porcini",
  "shiitake",
  "enoki",
  "truffle",
  "portobello",
  "maitake",
  "reishi",
  "puffball",
  "hedgehog",
  "lobster",
  "parasol",
  "beech",
  "oyster",
  "button",
  "cremini",
  "blewit",
  "milkcap",
  "prince",
  "fairy-ring",
  "blusher",
  "miller",
  "deceiver",
  "brittlegill",
  "inkcap",
  "bonnet",
  "scarletina",
  "cep",
  "cordyceps",
  "indigo",
  "lavender",
  "candy-cap",
  "rosy",
  "slippery-jack",
  "panther",
  "sulphur",
  "smooth-cap",
  "plum-cap",
  "apricot",
];

/* ------------------------------------------------------------------ */
/* BotManager                                                           */
/* ------------------------------------------------------------------ */

export class BotManager {
  private game: Game;
  private nameQueue: string[] = [];
  private nextBotId = 1;
  private lastSpawnAt = 0;
  /** Set of human player ids that joined with the nobots flag. While
   *  non-empty, the bot floor is treated as 0. */
  private nobotsClients = new Set<string>();

  constructor(game: Game) {
    this.game = game;
    this.refillNames();
  }

  /* -------------------- public surface ------------------------- */

  /** Mark a human as having (or no longer having) the nobots flag. */
  setNobots(playerId: string, on: boolean): void {
    if (on) this.nobotsClients.add(playerId);
    else this.nobotsClients.delete(playerId);
  }

  /** Per-tick: maintain population floor + run AI for every bot. Run
   *  this BEFORE Game.tick() so bot inputs are consumed in the same
   *  physics step as human inputs. */
  tick(): void {
    const now = Date.now();

    // 1. Note newly-dead bots so the respawn cooldown clock starts.
    for (const p of this.game.players.values()) {
      if (!p.isBot || !p.bot) continue;
      if (!p.alive && p.bot.diedAt === 0) p.bot.diedAt = now;
    }

    // 2. Adjust population toward the target. Once the room has enough
    //    humans (BUSY_HUMAN_COUNT) we drop hard to BUSY_BOT_FLOOR — bots
    //    are there to fill empty rooms; humans don't need them and the
    //    server CPU is better spent on the human cells.
    const humans = this.humanCount();
    let target = 0;
    if (this.botFloorActive()) {
      target = humans >= BUSY_HUMAN_COUNT
        ? BUSY_BOT_FLOOR
        : Math.max(0, BOT_FLOOR - humans);
    }
    const have = this.botCount();
    if (have < target) {
      const cap = MAX_PLAYERS;
      if (
        this.game.players.size < cap &&
        now - this.lastSpawnAt > SPAWN_RATE_MS
      ) {
        this.spawnBot();
        this.lastSpawnAt = now;
      }
    } else if (have > target) {
      // Evict immediately so a human who just joined takes the slot.
      this.evictOldest();
    }

    // 3. Run AI on each living bot; respawn any whose cooldown elapsed.
    for (const p of this.game.players.values()) {
      if (!p.isBot || !p.bot) continue;
      if (!p.alive) {
        if (p.bot.diedAt > 0 && now - p.bot.diedAt >= RESPAWN_COOLDOWN_MS) {
          // Respawn near a human if any are connected, same logic as
          // the initial bot spawn — keeps the room feeling lived-in.
          const { x, y } = this.pickSpawnPosition();
          this.game.respawn(p.id, x, y);
          p.bot.diedAt = 0;
          p.bot.hasTarget = false;
          p.bot.fleeing = false;
          p.bot.lastDecisionAt = 0;
          p.bot.spawnedAtMs = Date.now();
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
    // Shuffle (Fisher-Yates) so consecutive spawns aren't alphabetical.
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
    const { x, y } = this.pickSpawnPosition();
    this.game.addBot(id, name, x, y);
  }

  /** Choose a spawn position for a new HUMAN — the inverse of bot
   *  spawn. Place them near a random alive bot at 500–800 units, so
   *  the bot is inside the human's mass-20 snapshot box (half-extents
   *  ~780×580). The human sees company on their first frame instead
   *  of an empty world for 2–3 seconds while bots converge. Spawn
   *  protection (1.5s) keeps them safe from being eaten while they
   *  orient.
   *
   *  Falls back to random world position if there are no bots —
   *  shouldn't happen in practice (bots fill the floor) but covers
   *  the edge case cleanly. */
  pickHumanSpawnPosition(): { x: number; y: number } {
    const bots: Player[] = [];
    for (const p of this.game.players.values()) {
      if (p.isBot && p.alive && p.cells.length > 0) bots.push(p);
    }
    if (bots.length === 0) {
      return {
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
      };
    }
    const target = bots[Math.floor(Math.random() * bots.length)];
    const cx = centroidX(target);
    const cy = centroidY(target);
    const angle = Math.random() * Math.PI * 2;
    const dist = 500 + Math.random() * 300;
    return {
      x: clamp(cx + Math.cos(angle) * dist, 100, WORLD_SIZE - 100),
      y: clamp(cy + Math.sin(angle) * dist, 100, WORLD_SIZE - 100),
    };
  }

  /** Place a new (or respawning) bot near a random connected human if
   *  there is one, otherwise random world position. The "near a human"
   *  case picks a random angle and a 800–2500 unit radius — close
   *  enough that the bot will be in the human's snapshot viewport
   *  (~1500×1100 box server-side) within a few seconds of wandering,
   *  far enough that they don't spawn directly in the human's mouth. */
  private pickSpawnPosition(): { x: number; y: number } {
    const humans: Player[] = [];
    for (const p of this.game.players.values()) {
      if (!p.isBot && p.alive && p.cells.length > 0) humans.push(p);
    }
    if (humans.length === 0) {
      return {
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
      };
    }
    const target = humans[Math.floor(Math.random() * humans.length)];
    const cx = centroidX(target);
    const cy = centroidY(target);
    const angle = Math.random() * Math.PI * 2;
    const dist = 800 + Math.random() * 1700;
    return {
      x: clamp(cx + Math.cos(angle) * dist, 100, WORLD_SIZE - 100),
      y: clamp(cy + Math.sin(angle) * dist, 100, WORLD_SIZE - 100),
    };
  }

  /** Pick the oldest bot (longest spawnedAtMs ago); ties broken by
   *  smaller current mass. Lets new humans displace stale, unimpressive
   *  bots first while keeping the populous, large-mass top of the
   *  leaderboard intact. */
  private evictOldest(): void {
    let pick: Player | null = null;
    let pickMass = Infinity;
    for (const p of this.game.players.values()) {
      if (!p.isBot || !p.bot) continue;
      if (!pick) {
        pick = p;
        pickMass = totalMass(p);
        continue;
      }
      const pSpawn = p.bot.spawnedAtMs;
      const pickSpawn = pick.bot!.spawnedAtMs;
      if (pSpawn < pickSpawn) {
        pick = p;
        pickMass = totalMass(p);
      } else if (pSpawn === pickSpawn) {
        const m = totalMass(p);
        if (m < pickMass) {
          pick = p;
          pickMass = m;
        }
      }
    }
    if (pick) this.game.removePlayer(pick.id);
  }

  private runAI(p: Player, now: number): void {
    const bot = p.bot!;

    // Per-bot decision interval — staggers AI thinking across the
    // population so they don't all turn on the same beat.
    if (now - bot.lastDecisionAt > bot.decisionMs) {
      bot.lastDecisionAt = now;
      this.decide(p);
    }

    let ux = 0;
    let uy = 0;
    if (bot.hasTarget) {
      const cx = centroidX(p);
      const cy = centroidY(p);
      const dx = bot.targetX - cx;
      const dy = bot.targetY - cy;
      const len = Math.hypot(dx, dy);
      if (len > 0.01) {
        const sign = bot.fleeing ? -1 : 1;
        ux = (sign * dx) / len;
        uy = (sign * dy) / len;
      }
    } else {
      // Wander: drift the heading by a small random amount each tick.
      bot.wanderAngle += (Math.random() - 0.5) * WANDER_NOISE;
      ux = Math.cos(bot.wanderAngle);
      uy = Math.sin(bot.wanderAngle);
    }

    // Per-bot path jitter — each tick perturb the heading by a small
    // random angle. Higher jitterAmp = curvier paths. Without this
    // bots travel in dead-straight lines, which is easy to predict
    // and exploit.
    if (bot.jitterAmp > 0 && (ux !== 0 || uy !== 0)) {
      const jitter = (Math.random() - 0.5) * bot.jitterAmp;
      const cosJ = Math.cos(jitter);
      const sinJ = Math.sin(jitter);
      const rx = ux * cosJ - uy * sinJ;
      const ry = ux * sinJ + uy * cosJ;
      ux = rx;
      uy = ry;
    }

    // Wall awareness — if our heading would push us into a wall we're
    // already close to, zero that component out. Slides the bot along
    // the wall instead of running into it. Closes the player exploit
    // of herding bots into corners.
    const myCx = centroidX(p);
    const myCy = centroidY(p);
    if (myCx < WALL_AVOID_MARGIN && ux < 0) {
      const t = myCx / WALL_AVOID_MARGIN;
      ux *= t;
    } else if (myCx > WORLD_SIZE - WALL_AVOID_MARGIN && ux > 0) {
      const t = (WORLD_SIZE - myCx) / WALL_AVOID_MARGIN;
      ux *= t;
    }
    if (myCy < WALL_AVOID_MARGIN && uy < 0) {
      const t = myCy / WALL_AVOID_MARGIN;
      uy *= t;
    } else if (myCy > WORLD_SIZE - WALL_AVOID_MARGIN && uy > 0) {
      const t = (WORLD_SIZE - myCy) / WALL_AVOID_MARGIN;
      uy *= t;
    }

    // Renormalise after jitter + wall avoidance so dampened components
    // don't make the bot move slower than its full speed.
    const finalLen = Math.hypot(ux, uy);
    if (finalLen > 0.01) {
      p.inputDir = { x: ux / finalLen, y: uy / finalLen };
      p.lastAim = { x: ux / finalLen, y: uy / finalLen };
    } else {
      // Fully cornered — pick perpendicular escape so the bot doesn't
      // freeze. Bias whichever axis has more room.
      const escapeX = myCx < WORLD_SIZE / 2 ? 1 : -1;
      const escapeY = myCy < WORLD_SIZE / 2 ? 1 : -1;
      // Pick the axis the bot is further from a wall on.
      const xRoom = Math.min(myCx, WORLD_SIZE - myCx);
      const yRoom = Math.min(myCy, WORLD_SIZE - myCy);
      if (xRoom > yRoom) {
        p.inputDir = { x: escapeX, y: 0 };
      } else {
        p.inputDir = { x: 0, y: escapeY };
      }
      p.lastAim = { ...p.inputDir };
    }

    // Bots aren't subject to AFK kick — keep their lastInputAt fresh
    // even though they have no socket to be "inactive on".
    p.lastInputAt = now;
  }

  /** Re-evaluate priority targets and pick a new behaviour. */
  private decide(p: Player): void {
    const bot = p.bot!;
    const myCx = centroidX(p);
    const myCy = centroidY(p);
    const myMass = totalMass(p);

    // Sight scales with mass^0.35, mirroring the per-player viewport.
    // Bigger bots see further. Then multiplied by the bot's personal
    // sightFactor — sharper-eyed bots see further than fuzzier ones.
    const sight =
      SIGHT_RADIUS_BASE *
      bot.sightFactor *
      Math.pow(Math.max(1, myMass / START_MASS), SIGHT_MASS_EXPONENT);

    let closestThreat: Player | null = null;
    let closestThreatDist = Infinity;
    let closestPrey: Player | null = null;
    let closestPreyDist = Infinity;
    // Track all in-sight prey so the bot can occasionally pick a
    // non-closest one — keeps players from baiting bots predictably.
    const allPrey: { player: Player; dist: number }[] = [];

    // Long-range wander attractor: the closest HUMAN who isn't a
    // meaningful threat. Used only when nothing in close sight — so
    // bots converge slowly toward where the action actually is rather
    // than getting pinned eating pellets in an empty corner. Bot-bot
    // attraction was tried first but bots clustered at equal masses
    // and starved (no eat ratio between them); only humans pull, so
    // bots in an empty room still seek food normally and grow.
    let wanderTarget: Player | null = null;
    let wanderTargetDist = Infinity;

    for (const other of this.game.players.values()) {
      if (other.id === p.id) continue;
      if (!other.alive) continue;
      const otherMass = totalMass(other);
      const ocx = centroidX(other);
      const ocy = centroidY(other);
      const dist = Math.hypot(ocx - myCx, ocy - myCy);

      // Long-range attractor: humans only, skip much-bigger threats.
      if (
        !other.isBot &&
        otherMass <= myMass * 1.5 &&
        dist < wanderTargetDist
      ) {
        wanderTarget = other;
        wanderTargetDist = dist;
      }

      // Close-range flee/chase logic — only in mass-scaled sight.
      if (dist > sight) continue;
      if (otherMass > myMass * EAT_RATIO) {
        if (dist < closestThreatDist) {
          closestThreat = other;
          closestThreatDist = dist;
        }
      } else if (myMass > otherMass * EAT_RATIO) {
        allPrey.push({ player: other, dist });
        if (dist < closestPreyDist) {
          closestPrey = other;
          closestPreyDist = dist;
        }
      }
    }

    // 1) Flee.
    if (closestThreat) {
      bot.targetX = centroidX(closestThreat);
      bot.targetY = centroidY(closestThreat);
      bot.hasTarget = true;
      bot.fleeing = true;
      return;
    }

    // 2) Chase + maybe split-fire.
    if (closestPrey) {
      // Most of the time, chase the closest prey. Some of the time,
      // pick a random in-sight prey instead — this is what makes
      // bots stop being trivially predictable. A player can't bait
      // the same bot the same way twice with confidence.
      let prey = closestPrey;
      let preyDist = closestPreyDist;
      if (allPrey.length > 1 && Math.random() < RANDOM_PREY_PROBABILITY) {
        const random = allPrey[Math.floor(Math.random() * allPrey.length)];
        prey = random.player;
        preyDist = random.dist;
      }
      bot.targetX = centroidX(prey);
      bot.targetY = centroidY(prey);
      bot.hasTarget = true;
      bot.fleeing = false;

      // Project where a split would land: SPLIT_EJECT_SPEED runs for
      // SPLIT_PULL_DELAY_MS before gravity engages. After that the eject
      // momentum decays — but the initial reach is the dominant term.
      const splitReach = (SPLIT_EJECT_SPEED * SPLIT_PULL_DELAY_MS) / 1000;
      const projectedHalf = myMass / 2;
      const preyMass = totalMass(prey);
      if (
        preyDist < splitReach &&
        projectedHalf > preyMass * EAT_RATIO &&
        Math.random() < SPLIT_FIRE_PROBABILITY
      ) {
        p.splitRequested = true;
      }
      return;
    }

    // 3) Long-range attractor — drift toward the nearest non-threat
    // player. Comes BEFORE food so bots don't get pinned eating pellets
    // forever when there's a 1400-pellet uniform distribution covering
    // every sight cone. They still pick up food en route — the bot's
    // path crosses pellets and the eat-resolution loop catches them
    // automatically.
    if (wanderTarget) {
      bot.targetX = centroidX(wanderTarget);
      bot.targetY = centroidY(wanderTarget);
      bot.hasTarget = true;
      bot.fleeing = false;
      return;
    }

    // 4) Food (within close-range sight) — fallback when there are no
    // other players at all (truly empty room with one lone bot).
    let bestFoodX = 0;
    let bestFoodY = 0;
    let bestFoodDist = Infinity;
    for (const f of this.game.food.values()) {
      const dist = Math.hypot(f.x - myCx, f.y - myCy);
      if (dist > sight) continue;
      if (dist < bestFoodDist) {
        bestFoodX = f.x;
        bestFoodY = f.y;
        bestFoodDist = dist;
      }
    }
    if (bestFoodDist < Infinity) {
      bot.targetX = bestFoodX;
      bot.targetY = bestFoodY;
      bot.hasTarget = true;
      bot.fleeing = false;
      return;
    }

    // 5) True wander — heading drift only. Reached only when there's
    // nothing in any direction.
    bot.hasTarget = false;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function totalMass(p: Player): number {
  let s = 0;
  for (const c of p.cells) s += c.mass;
  return s;
}

function centroidX(p: Player): number {
  let cx = 0;
  let sum = 0;
  for (const c of p.cells) {
    cx += c.x * c.mass;
    sum += c.mass;
  }
  return sum > 0 ? cx / sum : 0;
}

function centroidY(p: Player): number {
  let cy = 0;
  let sum = 0;
  for (const c of p.cells) {
    cy += c.y * c.mass;
    sum += c.mass;
  }
  return sum > 0 ? cy / sum : 0;
}
