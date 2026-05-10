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
} from "../../lib/munch/protocol.js";
import type { Game, Player } from "./game.js";

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/** World units a bot reacts within. ~700 matches the default desktop
 *  viewport, so bots roughly react to anything that would be on their
 *  screen — no superhuman omniscience, no blindness. */
const SIGHT_RADIUS = 700;

/** Min ms between bot AI decisions. Between decisions the bot keeps
 *  moving toward its cached target — looks goal-directed without
 *  burning CPU re-scanning every tick. */
const DECISION_INTERVAL_MS = 270;

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

    // 2. Adjust population toward the target.
    const target = this.botFloorActive() ? Math.max(0, BOT_FLOOR - this.humanCount()) : 0;
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
          this.game.respawn(p.id);
          p.bot.diedAt = 0;
          p.bot.hasTarget = false;
          p.bot.fleeing = false;
          p.bot.lastDecisionAt = 0;
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
    this.game.addBot(id, name);
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

    // Throttle decisions — between them, just keep walking toward target.
    if (now - bot.lastDecisionAt > DECISION_INTERVAL_MS) {
      bot.lastDecisionAt = now;
      this.decide(p);
    }

    if (bot.hasTarget) {
      const cx = centroidX(p);
      const cy = centroidY(p);
      const dx = bot.targetX - cx;
      const dy = bot.targetY - cy;
      const len = Math.hypot(dx, dy);
      if (len > 0.01) {
        const sign = bot.fleeing ? -1 : 1;
        const ux = (sign * dx) / len;
        const uy = (sign * dy) / len;
        p.inputDir = { x: ux, y: uy };
        p.lastAim = { x: ux, y: uy };
      }
    } else {
      // Wander: drift the heading by a small random amount each tick.
      bot.wanderAngle += (Math.random() - 0.5) * WANDER_NOISE;
      const ux = Math.cos(bot.wanderAngle);
      const uy = Math.sin(bot.wanderAngle);
      p.inputDir = { x: ux, y: uy };
      p.lastAim = { x: ux, y: uy };
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

    let closestThreat: Player | null = null;
    let closestThreatDist = Infinity;
    let closestPrey: Player | null = null;
    let closestPreyDist = Infinity;

    for (const other of this.game.players.values()) {
      if (other.id === p.id) continue;
      if (!other.alive) continue;
      const otherMass = totalMass(other);
      const ocx = centroidX(other);
      const ocy = centroidY(other);
      const dist = Math.hypot(ocx - myCx, ocy - myCy);
      if (dist > SIGHT_RADIUS) continue;
      if (otherMass > myMass * EAT_RATIO) {
        if (dist < closestThreatDist) {
          closestThreat = other;
          closestThreatDist = dist;
        }
      } else if (myMass > otherMass * EAT_RATIO) {
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
      bot.targetX = centroidX(closestPrey);
      bot.targetY = centroidY(closestPrey);
      bot.hasTarget = true;
      bot.fleeing = false;

      // Project where a split would land: SPLIT_EJECT_SPEED runs for
      // SPLIT_PULL_DELAY_MS before gravity engages. After that the eject
      // momentum decays — but the initial reach is the dominant term.
      const splitReach = (SPLIT_EJECT_SPEED * SPLIT_PULL_DELAY_MS) / 1000;
      const projectedHalf = myMass / 2;
      const preyMass = totalMass(closestPrey);
      if (
        closestPreyDist < splitReach &&
        projectedHalf > preyMass * EAT_RATIO &&
        Math.random() < SPLIT_FIRE_PROBABILITY
      ) {
        p.splitRequested = true;
      }
      return;
    }

    // 3) Food.
    let bestFoodX = 0;
    let bestFoodY = 0;
    let bestFoodDist = Infinity;
    for (const f of this.game.food.values()) {
      const dist = Math.hypot(f.x - myCx, f.y - myCy);
      if (dist > SIGHT_RADIUS) continue;
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

    // 4) Wander.
    bot.hasTarget = false;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

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
